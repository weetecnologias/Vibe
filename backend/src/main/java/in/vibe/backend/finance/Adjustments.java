package in.vibe.backend.finance;

import in.vibe.backend.audit.AuditService;
import in.vibe.backend.common.ApiException;
import in.vibe.backend.notify.StaffNotifications;
import in.vibe.backend.security.StaffPrincipal;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * Manual corrections to what a business is owed: a credit (VIBE owes more: a payment taken outside, a goodwill amount), or a recovery or penalty
 * (VIBE takes back: a refund paid after the settlement, a fine), each with a reason. They are posted to the books at once and included in the
 * business's next settlement, so a settlement is never a surprise.
 */
@Service
public class Adjustments {
    /** amount is in paise and positive; the kind decides the direction (credit adds, recovery and penalty take away). */
    public record Input(@NotBlank String kind, @NotNull Long amount, @NotBlank @Size(min = 3, max = 300) String reason) {}

    public record Row(String id, String businessId, String businessName, String kind, long amount, String reason, String createdBy, OffsetDateTime createdAt, String settlementReference) {}

    private final JdbcClient jdbc;
    private final Ledger ledger;
    private final AuditService audit;
    private final StaffNotifications staffNotifications;

    Adjustments(JdbcClient jdbc, Ledger ledger, AuditService audit, StaffNotifications staffNotifications) {
        this.jdbc = jdbc;
        this.ledger = ledger;
        this.audit = audit;
        this.staffNotifications = staffNotifications;
    }

    @Transactional
    public Row add(StaffPrincipal who, UUID business, Input in) {
        if (!List.of("credit", "recovery", "penalty").contains(in.kind())) throw ApiException.badRequest("kind", "Choose credit, recovery or penalty.");
        if (in.amount() <= 0 || in.amount() > 100_000_000L) throw ApiException.badRequest("amount", "Enter an amount more than ₹0.");
        String name = jdbc.sql("select name from businesses where id = :id").param("id", business).query(String.class).optional().orElseThrow(() -> ApiException.notFound("Business not found."));
        long signed = "credit".equals(in.kind()) ? in.amount() : -in.amount();
        UUID id = UUID.randomUUID();
        jdbc.sql("insert into settlement_adjustments (id, business_id, kind, amount, reason, created_by) values (:id, :b, :k, :a, :r, :by)")
                .param("id", id).param("b", business).param("k", in.kind()).param("a", signed).param("r", in.reason().trim()).param("by", who.id()).update();
        ledger.post("adjustment", "adjustment", id.toString(), name + ": " + in.reason().trim(), signed > 0
                ? List.of(Ledger.Line.dr("adjustments", signed), Ledger.Line.cr(Ledger.merchant(business), signed))
                : List.of(Ledger.Line.dr(Ledger.merchant(business), -signed), Ledger.Line.cr("adjustments", -signed)));
        audit.record(who, "adjustment", "business", business, in.kind() + " " + signed / 100.0 + " · " + in.reason().trim());
        staffNotifications.toBusiness(business, "settlement_created", (signed > 0 ? "Credit" : "Deduction") + " of ₹" + String.format("%.2f", Math.abs(signed) / 100.0), in.reason().trim() + ". It is included in your next settlement.", "/settlements");
        return one(id);
    }

    private static final String SELECT = "select a.*, b.name bname, u.name uname, s.reference sref from settlement_adjustments a join businesses b on b.id = a.business_id left join staff_users u on u.id = a.created_by left join settlements s on s.id = a.settlement_id ";

    private Row row(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new Row(rs.getString("id"), rs.getString("business_id"), rs.getString("bname"), rs.getString("kind"), rs.getLong("amount"), rs.getString("reason"), rs.getString("uname"),
                rs.getObject("created_at", OffsetDateTime.class), rs.getString("sref"));
    }

    public Row one(UUID id) {
        return jdbc.sql(SELECT + "where a.id = :id").param("id", id).query((rs, i) -> row(rs)).optional().orElseThrow(() -> ApiException.notFound("Adjustment not found."));
    }

    /** business null: everyone's. pending: only those not yet in a settlement. */
    public List<Row> list(UUID business, boolean pendingOnly) {
        String w = " where true" + (business == null ? "" : " and a.business_id = :b") + (pendingOnly ? " and a.settlement_id is null" : "");
        JdbcClient.StatementSpec s = jdbc.sql(SELECT + w + " order by a.created_at desc limit 500");
        if (business != null) s.param("b", business);
        return s.query((rs, i) -> row(rs)).list();
    }

    /** The adjustments waiting for this business's next settlement, locked for the settlement being drawn up. */
    public List<long[]> lockPending(UUID business) {
        return jdbc.sql("select amount from settlement_adjustments where business_id = :b and settlement_id is null for update").param("b", business)
                .query((rs, i) -> new long[]{rs.getLong(1)}).list();
    }
}
