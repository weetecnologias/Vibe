package in.vibe.backend.compliance;

import in.vibe.backend.audit.AuditService;
import in.vibe.backend.billing.Notifications;
import in.vibe.backend.billing.Refunds;
import in.vibe.backend.common.ApiException;
import in.vibe.backend.customer.Customers;
import in.vibe.backend.notify.StaffNotifications;
import in.vibe.backend.security.StaffPrincipal;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * Disputes: a customer reports a problem with a payment (not received, wrong amount, charged twice, poor service). It lands in VIBE's queue with a
 * deadline (5 days), the business is told, and VIBE either refunds (full or part, borne by the business or VIBE) or declines with a reason. The
 * customer is told either way. One open dispute per payment, within 90 days of paying.
 */
@Service
public class Disputes {
    public static final int RESPOND_DAYS = 5, WINDOW_DAYS = 90;
    public static final List<String> REASONS = List.of("not_received", "wrong_amount", "charged_twice", "poor_service", "other");

    public record RaiseInput(@NotBlank String reason, @Size(max = 1000) String details) {}

    /** outcome: refund or reject. amount (paise) only for a part refund. bearer: merchant (default) or vibe. */
    public record ResolveInput(@NotBlank String outcome, Long amount, String bearer, @Size(max = 300) String note) {}

    public record Row(String reference, String paymentReference, String businessId, String businessName, String customerName, String vibeId, String reason, String details, String status, String resolutionNote,
                      Long refundAmount, OffsetDateTime createdAt, OffsetDateTime dueBy, OffsetDateTime resolvedAt, boolean overdue, long paid) {}

    private static final String ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private final SecureRandom random = new SecureRandom();
    private final JdbcClient jdbc;
    private final Refunds refunds;
    private final AuditService audit;
    private final Notifications notifications;
    private final StaffNotifications staffNotifications;
    private final Clock clock;

    Disputes(JdbcClient jdbc, Refunds refunds, AuditService audit, Notifications notifications, StaffNotifications staffNotifications, Clock clock) {
        this.jdbc = jdbc;
        this.refunds = refunds;
        this.audit = audit;
        this.notifications = notifications;
        this.staffNotifications = staffNotifications;
        this.clock = clock;
    }

    @Transactional
    public Row raise(UUID customer, String paymentReference, RaiseInput in) {
        if (!REASONS.contains(in.reason())) throw ApiException.badRequest("reason", "Choose what went wrong.");
        record P(UUID id, String status, OffsetDateTime at, UUID business, String refund, long amount) {}
        P p = jdbc.sql("select p.id, p.status, p.verified_at, pr.business_id, p.refund_status, p.amount from payments p join payment_requests pr on pr.id = p.payment_request_id where p.reference = :r and p.customer_id = :c")
                .param("r", paymentReference).param("c", customer).query((rs, i) -> new P((UUID) rs.getObject(1), rs.getString(2), rs.getObject(3, OffsetDateTime.class), (UUID) rs.getObject(4), rs.getString(5), rs.getLong(6))).optional()
                .orElseThrow(() -> ApiException.notFound("Payment not found."));
        OffsetDateTime now = OffsetDateTime.now(clock);
        if (!"verified".equals(p.status())) throw ApiException.conflict("not_paid", "Only a payment that went through can be reported. A failed payment wasn’t charged.");
        if (p.refund() != null) throw ApiException.conflict("refunded", "This payment is already being refunded.");
        if (p.at().plusDays(WINDOW_DAYS).isBefore(now)) throw ApiException.conflict("too_old", "Problems can be reported within " + WINDOW_DAYS + " days of paying.");
        if (jdbc.sql("select count(*) from disputes where payment_id = :p and status = 'open'").param("p", p.id()).query(Integer.class).single() > 0) throw ApiException.conflict("already_open", "You’ve already reported this one. VIBE is looking into it.");
        UUID id = UUID.randomUUID();
        String ref = reference();
        jdbc.sql("insert into disputes (id, reference, payment_id, customer_id, business_id, reason, details, due_by) values (:id, :ref, :p, :c, :b, :r, :d, :due)")
                .param("id", id).param("ref", ref).param("p", p.id()).param("c", customer).param("b", p.business()).param("r", in.reason()).param("d", in.details() == null ? "" : in.details().trim()).param("due", now.plusDays(RESPOND_DAYS)).update();
        String name = jdbc.sql("select name from customers where id = :c").param("c", customer).query(String.class).single();
        staffNotifications.toAdmins("dispute_open", "Customer reported a problem", Customers.displayName(name) + " reported " + in.reason().replace('_', ' ') + " on " + paymentReference + " (" + ref + "). Respond within " + RESPOND_DAYS + " days.", "/disputes");
        if (p.business() != null) staffNotifications.toBusiness(p.business(), "dispute_opened", "A customer reported a problem", "Payment " + paymentReference + ": " + in.reason().replace('_', ' ') + ". VIBE is looking into it.", "/settlements");
        notifications.notify(customer, "dispute_received", "We’ve got your report", "VIBE will look into " + paymentReference + " and get back to you within " + RESPOND_DAYS + " days. Reference " + ref + ".", "payment", p.id().toString());
        return one(ref);
    }

    private static final String SELECT = "select d.*, p.reference preference, p.amount paid, c.name cname, c.vibe_id, b.name bname from disputes d join payments p on p.id = d.payment_id join customers c on c.id = d.customer_id left join businesses b on b.id = d.business_id ";

    private Row row(java.sql.ResultSet rs) throws java.sql.SQLException {
        OffsetDateTime due = rs.getObject("due_by", OffsetDateTime.class);
        return new Row(rs.getString("reference"), rs.getString("preference"), rs.getString("business_id"), rs.getString("bname"), Customers.displayName(rs.getString("cname")), rs.getString("vibe_id"), rs.getString("reason"),
                rs.getString("details"), rs.getString("status"), rs.getString("resolution_note"), (Long) rs.getObject("refund_amount"), rs.getObject("created_at", OffsetDateTime.class), due,
                rs.getObject("resolved_at", OffsetDateTime.class), "open".equals(rs.getString("status")) && due.isBefore(OffsetDateTime.now(clock)), rs.getLong("paid"));
    }

    public Row one(String reference) {
        return jdbc.sql(SELECT + "where d.reference = :r").param("r", reference).query((rs, i) -> row(rs)).optional().orElseThrow(() -> ApiException.notFound("Dispute not found."));
    }

    public List<Row> mine(UUID customer) {
        return jdbc.sql(SELECT + "where d.customer_id = :c order by d.created_at desc").param("c", customer).query((rs, i) -> row(rs)).list();
    }

    /** status: open, refund, rejected or empty. scope: from AdminAccess.businessScope on d.business_id. Open ones first, most overdue first. */
    public List<Row> list(String status, String scope) {
        return jdbc.sql(SELECT + "where true" + scope + (status == null || status.isBlank() ? "" : " and d.status = :s") + " order by (d.status = 'open') desc, d.due_by limit 300")
                .param("s", status == null ? "" : status).query((rs, i) -> row(rs)).list();
    }

    public UUID businessOf(String reference) {
        return jdbc.sql("select business_id from disputes where reference = :r").param("r", reference).query((rs, i) -> (UUID) rs.getObject(1)).optional().orElseThrow(() -> ApiException.notFound("Dispute not found."));
    }

    @Transactional
    public Row resolve(StaffPrincipal who, String reference, ResolveInput in) {
        record D(UUID id, UUID customer, String status, String paymentReference) {}
        D d = jdbc.sql("select d.id, d.customer_id, d.status, p.reference from disputes d join payments p on p.id = d.payment_id where d.reference = :r for update of d").param("r", reference)
                .query((rs, i) -> new D((UUID) rs.getObject(1), (UUID) rs.getObject(2), rs.getString(3), rs.getString(4))).optional().orElseThrow(() -> ApiException.notFound("Dispute not found."));
        if (!"open".equals(d.status())) throw ApiException.conflict("resolved", "This dispute has already been resolved.");
        String note = in.note() == null ? "" : in.note().trim();
        if ("refund".equals(in.outcome())) {
            var r = refunds.raise(who, d.paymentReference(), new Refunds.RaiseInput(in.amount(), "Dispute " + reference + (note.isEmpty() ? "" : ": " + note), in.bearer()));
            jdbc.sql("update disputes set status = 'refund', resolution_note = :n, refund_amount = :a, resolved_by = :by, resolved_at = now() where id = :id").param("n", note).param("a", r.refundAmount()).param("by", who.id()).param("id", d.id()).update();
            notifications.notify(d.customer(), "dispute_resolved", "We’re refunding you", "VIBE is refunding ₹" + String.format("%.2f", r.refundAmount() / 100.0) + " for " + d.paymentReference() + "." + (note.isEmpty() ? "" : " " + note), "payment", d.id().toString());
        } else if ("reject".equals(in.outcome())) {
            if (note.isEmpty()) throw ApiException.badRequest("note_required", "Tell the customer why, so they understand.");
            jdbc.sql("update disputes set status = 'rejected', resolution_note = :n, resolved_by = :by, resolved_at = now() where id = :id").param("n", note).param("by", who.id()).param("id", d.id()).update();
            notifications.notify(d.customer(), "dispute_resolved", "About your report", "VIBE looked into " + d.paymentReference() + " and couldn’t refund it. " + note, "payment", d.id().toString());
        } else {
            throw ApiException.badRequest("outcome", "Choose refund or reject.");
        }
        audit.record(who, "dispute_" + in.outcome(), "dispute", d.id(), reference + (note.isEmpty() ? "" : ": " + note));
        return one(reference);
    }

    private String reference() {
        StringBuilder s = new StringBuilder("DSP-");
        for (int i = 0; i < 6; i++) s.append(ALPHABET.charAt(random.nextInt(ALPHABET.length())));
        return s.toString();
    }
}
