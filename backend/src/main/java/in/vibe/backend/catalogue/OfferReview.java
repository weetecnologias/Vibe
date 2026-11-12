package in.vibe.backend.catalogue;

import in.vibe.backend.audit.AuditService;
import in.vibe.backend.common.ApiException;
import in.vibe.backend.security.StaffPrincipal;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/** VIBE's review of merchant offers. Only approved offers are shown to customers. */
@Service
public class OfferReview {
    public record Row(String id, String businessId, String businessName, String title, String kind, Integer rateBps, Long flatAmount, Long maxDiscount, Long minBill, boolean memberOnly,
                      OffsetDateTime startsAt, OffsetDateTime endsAt, boolean active, String reviewStatus, String reviewNote, OffsetDateTime reviewedAt, boolean autoApproved) {}

    private final JdbcClient jdbc;
    private final AuditService audit;
    private final in.vibe.backend.notify.StaffNotifications staffNotifications;

    OfferReview(JdbcClient jdbc, AuditService audit, in.vibe.backend.notify.StaffNotifications staffNotifications) {
        this.jdbc = jdbc;
        this.audit = audit;
        this.staffNotifications = staffNotifications;
    }

    private static Row map(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        Object bps = rs.getObject("rate_bps"), flat = rs.getObject("flat_amount"), max = rs.getObject("max_discount"), min = rs.getObject("min_bill");
        return new Row(rs.getString("id"), rs.getString("business_id"), rs.getString("bname"), rs.getString("title"), rs.getString("kind"), bps == null ? null : ((Number) bps).intValue(),
                flat == null ? null : ((Number) flat).longValue(), max == null ? null : ((Number) max).longValue(), min == null ? null : ((Number) min).longValue(), rs.getBoolean("member_only"),
                rs.getObject("starts_at", OffsetDateTime.class), rs.getObject("ends_at", OffsetDateTime.class), rs.getBoolean("active"), rs.getString("review_status"), rs.getString("review_note"),
                rs.getObject("reviewed_at", OffsetDateTime.class), rs.getBoolean("auto_approved"));
    }

    /** Offers waiting for review come first, oldest first, so nothing waits forever. */
    public List<Row> list(String status) {
        String where = status == null || status.isBlank() ? "" : " where o.review_status = :s";
        JdbcClient.StatementSpec s = jdbc.sql("select o.*, b.name bname from offers o join businesses b on b.id = o.business_id" + where
                + " order by (o.review_status = 'pending') desc, case when o.review_status = 'pending' then o.updated_at end asc, o.updated_at desc limit 200");
        if (!where.isEmpty()) s.param("s", status);
        return s.query(OfferReview::map).list();
    }

    @Transactional
    public Row decide(StaffPrincipal who, UUID id, boolean approve, String note) {
        if (!approve && (note == null || note.isBlank())) throw ApiException.badRequest("note_required", "Tell the merchant what to change.");
        Row before = jdbc.sql("select o.*, b.name bname from offers o join businesses b on b.id = o.business_id where o.id = :id").param("id", id).query(OfferReview::map).optional()
                .orElseThrow(() -> ApiException.notFound("Offer not found."));
        jdbc.sql("update offers set review_status = :st, auto_approved = false, review_note = :n, reviewed_at = now(), reviewed_by = :by where id = :id")
                .param("st", approve ? "approved" : "rejected").param("n", approve ? null : note.trim()).param("by", who.id()).param("id", id).update();
        audit.record(who, approve ? "approve" : "reject", "offer", id, before.businessName() + ": " + before.title());
        staffNotifications.toBusiness(UUID.fromString(before.businessId()), "offer_decision", approve ? "Offer approved" : "Offer not approved", before.title() + (approve ? " is approved and goes live in its dates." : ": " + note.trim()), "/offers");
        return jdbc.sql("select o.*, b.name bname from offers o join businesses b on b.id = o.business_id where o.id = :id").param("id", id).query(OfferReview::map).single();
    }
}
