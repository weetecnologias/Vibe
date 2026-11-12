package in.vibe.backend.billing;

import in.vibe.backend.audit.AuditService;
import in.vibe.backend.common.ApiException;
import in.vibe.backend.customer.Customers;
import in.vibe.backend.security.StaffPrincipal;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * Refunds on verified payments. A refund is first "due" (raised by VIBE staff, or by the system when an event is cancelled), then "refunded"
 * once the money has gone back through the payment partner, with the partner's refund reference. Every step is in the audit log, and the
 * customer is told. A payment with a refund is left out of the business's settlement; one already settled can't be refunded here (it's
 * recovered from the business first).
 */
@Service
public class Refunds {
    public record RaiseInput(Long amount, @NotBlank @Size(max = 300) String reason) {}

    public record DoneInput(@NotBlank @Size(max = 100) String partnerReference) {}

    public record Row(String reference, String kind, String payee, String customerName, String vibeId, long paid, long refundAmount, String reason, String status,
                      OffsetDateTime paidAt, OffsetDateTime requestedAt, String requestedBy, OffsetDateTime refundedAt, String refundedBy, String partnerReference) {}

    public record Totals(int due, long dueAmount, int refunded, long refundedAmount) {}

    public record Page(List<Row> items, Totals totals) {}

    private final JdbcClient jdbc;
    private final AuditService audit;
    private final Notifications notifications;

    Refunds(JdbcClient jdbc, AuditService audit, Notifications notifications) {
        this.jdbc = jdbc;
        this.audit = audit;
        this.notifications = notifications;
    }

    private static final String FROM = " from payments p join payment_requests pr on pr.id = p.payment_request_id join customers c on c.id = p.customer_id left join businesses b on b.id = pr.business_id "
            + "left join staff_users rq on rq.id = p.refund_requested_by left join staff_users rd on rd.id = p.refunded_by ";

    /** status: due, refunded, or empty for both. scope: from AdminAccess.businessScope on pr.business_id. Oldest due first. */
    public Page list(String status, String scope) {
        String where = " where p.refund_status is not null" + scope + (status == null || status.isBlank() ? "" : " and p.refund_status = :s");
        JdbcClient.StatementSpec s = jdbc.sql("select p.reference, pr.kind, coalesce(b.name, case pr.kind when 'tickets' then 'VIBE Events' else 'VIBE Membership' end) payee, c.name cname, c.vibe_id, p.amount, "
                + "p.refund_amount, p.refund_reason, p.refund_status, p.verified_at, p.refund_requested_at, coalesce(rq.name, 'VIBE (automatic)') rqname, p.refunded_at, rd.name rdname, p.refund_reference"
                + FROM + where + " order by (p.refund_status = 'due') desc, p.refund_requested_at limit 500");
        if (status != null && !status.isBlank()) s.param("s", status);
        List<Row> items = s.query((rs, i) -> new Row(rs.getString("reference"), rs.getString("kind"), rs.getString("payee"), Customers.displayName(rs.getString("cname")), rs.getString("vibe_id"),
                rs.getLong("amount"), rs.getLong("refund_amount"), rs.getString("refund_reason"), rs.getString("refund_status"), rs.getObject("verified_at", OffsetDateTime.class),
                rs.getObject("refund_requested_at", OffsetDateTime.class), rs.getString("rqname"), rs.getObject("refunded_at", OffsetDateTime.class), rs.getString("rdname"), rs.getString("refund_reference"))).list();
        Totals t = jdbc.sql("select count(*) filter (where p.refund_status = 'due'), coalesce(sum(p.refund_amount) filter (where p.refund_status = 'due'), 0), "
                        + "count(*) filter (where p.refund_status = 'refunded'), coalesce(sum(p.refund_amount) filter (where p.refund_status = 'refunded'), 0)" + FROM + " where p.refund_status is not null" + scope)
                .query((rs, i) -> new Totals(rs.getInt(1), rs.getLong(2), rs.getInt(3), rs.getLong(4))).single();
        return new Page(items, t);
    }

    /** The business a payment went to (null for VIBE's own: membership), for checking a category manager may act on it. */
    public UUID businessOf(String reference) {
        return jdbc.sql("select pr.business_id from payments p join payment_requests pr on pr.id = p.payment_request_id where p.reference = :r").param("r", reference)
                .query((rs, i) -> (UUID) rs.getObject(1)).optional().orElseThrow(() -> ApiException.notFound("Transaction not found."));
    }

    /** VIBE staff raise a refund on a verified payment: the whole amount, or part of it. */
    @Transactional
    public Row raise(StaffPrincipal who, String reference, RaiseInput in) {
        record P(UUID id, String status, long amount, String refund, boolean settled) {}
        P p = jdbc.sql("select p.id, p.status, p.amount, p.refund_status, exists (select 1 from settlement_items si where si.payment_id = p.id) settled from payments p where p.reference = :r for update")
                .param("r", reference).query((rs, i) -> new P((UUID) rs.getObject(1), rs.getString(2), rs.getLong(3), rs.getString(4), rs.getBoolean(5))).optional()
                .orElseThrow(() -> ApiException.notFound("Transaction not found."));
        if (!"verified".equals(p.status())) throw ApiException.conflict("not_paid", "Only a confirmed payment can be refunded. A failed or pending one wasn’t charged.");
        if (p.refund() != null) throw ApiException.conflict("already", "This payment already has a refund (" + p.refund() + ").");
        if (p.settled()) throw ApiException.conflict("settled", "This payment has already been settled to the business. Recover it from the business first, then refund the customer.");
        long amount = in.amount() == null ? p.amount() : in.amount();
        if (amount <= 0 || amount > p.amount()) throw ApiException.badRequest("amount", "The refund must be more than ₹0 and no more than what was paid.");
        jdbc.sql("update payments set refund_status = 'due', refund_amount = :a, refund_reason = :r, refund_requested_at = now(), refund_requested_by = :by where id = :id")
                .param("a", amount).param("r", in.reason().trim()).param("by", who.id()).param("id", p.id()).update();
        audit.record(who, "refund_raise", "payment", p.id(), reference + ": ₹" + Redemptions.rupees(amount) + " · " + in.reason().trim());
        return one(reference);
    }

    /** The money has gone back through the payment partner. The customer is told. */
    @Transactional
    public Row markRefunded(StaffPrincipal who, String reference, DoneInput in) {
        record P(UUID id, UUID customer, String refund, long amount) {}
        P p = jdbc.sql("select id, customer_id, refund_status, coalesce(refund_amount, 0) from payments where reference = :r for update").param("r", reference)
                .query((rs, i) -> new P((UUID) rs.getObject(1), (UUID) rs.getObject(2), rs.getString(3), rs.getLong(4))).optional().orElseThrow(() -> ApiException.notFound("Transaction not found."));
        if (!"due".equals(p.refund())) throw ApiException.conflict("not_due", "There’s no refund waiting on this payment.");
        jdbc.sql("update payments set refund_status = 'refunded', refunded_at = now(), refunded_by = :by, refund_reference = :ref where id = :id")
                .param("by", who.id()).param("ref", in.partnerReference().trim()).param("id", p.id()).update();
        audit.record(who, "refund_done", "payment", p.id(), reference + ": ₹" + Redemptions.rupees(p.amount()) + " · partner ref " + in.partnerReference().trim());
        notifications.notify(p.customer(), "refund_done", "Refund sent", "₹" + Redemptions.rupees(p.amount()) + " for payment " + reference + " is on its way back to you. Banks usually take 5–7 working days.", "payment", p.id().toString());
        return one(reference);
    }

    /** An event was cancelled: every paid ticket order for it gets a full refund raised, so nothing is missed. Returns how many. */
    @Transactional
    public int raiseForEvent(UUID eventId, String title) {
        int n = jdbc.sql("update payments p set refund_status = 'due', refund_amount = p.amount, refund_reason = :r, refund_requested_at = now() "
                        + "from ticket_reservations tr where tr.payment_request_id = p.payment_request_id and tr.event_id = :e and p.status = 'verified' and p.refund_status is null and p.amount > 0")
                .param("r", "Event cancelled: " + title).param("e", eventId).update();
        if (n > 0) audit.record(null, "refund_raise", "event", eventId, n + " ticket orders · " + title);
        return n;
    }

    private Row one(String reference) {
        return list("", " and p.reference = '" + reference.replace("'", "''") + "'").items().stream().findFirst().orElseThrow(() -> ApiException.notFound("Transaction not found."));
    }
}
