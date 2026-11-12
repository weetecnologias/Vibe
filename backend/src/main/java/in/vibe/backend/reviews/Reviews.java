package in.vibe.backend.reviews;

import in.vibe.backend.audit.AuditService;
import in.vibe.backend.common.ApiException;
import in.vibe.backend.customer.Customers;
import in.vibe.backend.notify.StaffNotifications;
import in.vibe.backend.security.StaffPrincipal;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Ratings from real visits only: a customer can rate a redemption once it was confirmed (code) or paid (bill), once. The place's rating is the
 * average of visible reviews. VIBE can hide a review that breaks the rules (with a reason, audited); the merchant sees every review of their place.
 */
@Service
public class Reviews {
    public record Input(@NotNull @Min(1) @Max(5) Integer rating, @Size(max = 500) String comment) {}

    public record HideInput(@NotBlank @Size(max = 200) String reason) {}

    /** What the customer app calls a Review. */
    public record PublicReview(String id, String authorName, int rating, String text, OffsetDateTime createdAt, boolean verifiedVisit) {}

    public record Item(String id, String businessId, String businessName, String customerName, String vibeId, int rating, String comment, String offerTitle, String mode, boolean hidden, String hiddenReason,
                       OffsetDateTime createdAt) {}

    public record Stats(double average, int count, List<Integer> byStars) {}

    public record MerchantView(Stats stats, List<Item> items) {}

    private final JdbcClient jdbc;
    private final StaffNotifications staffNotifications;
    private final AuditService audit;

    Reviews(JdbcClient jdbc, StaffNotifications staffNotifications, AuditService audit) {
        this.jdbc = jdbc;
        this.staffNotifications = staffNotifications;
        this.audit = audit;
    }

    @Transactional
    public void submit(UUID customer, UUID redemptionId, Input in) {
        record R(UUID business, String status, String bname) {}
        R r = jdbc.sql("select r.business_id, r.status, b.name from redemptions r join businesses b on b.id = r.business_id where r.id = :id and r.customer_id = :c").param("id", redemptionId).param("c", customer)
                .query((rs, i) -> new R((UUID) rs.getObject(1), rs.getString(2), rs.getString(3))).optional().orElseThrow(() -> ApiException.notFound("Redemption not found."));
        if (!"redeemed".equals(r.status()) && !"paid".equals(r.status())) throw ApiException.conflict("not_visited", "You can rate a visit once your code is confirmed or your bill is paid.");
        String comment = in.comment() == null ? "" : in.comment().trim();
        try {
            jdbc.sql("insert into reviews (id, customer_id, business_id, redemption_id, rating, comment) values (:id, :c, :b, :r, :rating, :comment)")
                    .param("id", UUID.randomUUID()).param("c", customer).param("b", r.business()).param("r", redemptionId).param("rating", in.rating()).param("comment", comment).update();
        } catch (DuplicateKeyException e) {
            throw ApiException.conflict("already_reviewed", "You’ve already rated this visit. Thank you!");
        }
        staffNotifications.toBusiness(r.business(), "review_received", "New rating: " + "★".repeat(in.rating()) + "☆".repeat(5 - in.rating()),
                comment.isEmpty() ? "A customer rated their visit " + in.rating() + " out of 5." : "“" + (comment.length() > 140 ? comment.substring(0, 140) + "…" : comment) + "”", "/reviews");
    }

    /** Average and count of visible reviews per business, for lists and pages. */
    public Map<UUID, double[]> ratings(List<UUID> businesses) {
        Map<UUID, double[]> out = new HashMap<>();
        if (businesses.isEmpty()) return out;
        jdbc.sql("select business_id, avg(rating), count(*) from reviews where not hidden and business_id in (:ids) group by business_id").param("ids", businesses)
                .query((rs, i) -> out.put((UUID) rs.getObject(1), new double[]{Math.round(rs.getDouble(2) * 10) / 10.0, rs.getInt(3)})).list();
        return out;
    }

    public List<PublicReview> latest(UUID business, int limit) {
        return jdbc.sql("select r.id, c.name, r.rating, r.comment, r.created_at from reviews r join customers c on c.id = r.customer_id where r.business_id = :b and not r.hidden order by r.created_at desc limit :n")
                .param("b", business).param("n", Math.min(Math.max(limit, 1), 50))
                .query((rs, i) -> new PublicReview(rs.getString(1), Customers.displayName(rs.getString(2)), rs.getInt(3), rs.getString(4), rs.getObject(5, OffsetDateTime.class), true)).list();
    }

    private static final String ITEM = "select r.id, r.business_id, b.name bname, c.name cname, c.vibe_id, r.rating, r.comment, o.title, red.mode, r.hidden, r.hidden_reason, r.created_at "
            + "from reviews r join businesses b on b.id = r.business_id join customers c on c.id = r.customer_id join redemptions red on red.id = r.redemption_id join offers o on o.id = red.offer_id ";

    private static Item item(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        return new Item(rs.getString(1), rs.getString(2), rs.getString(3), Customers.displayName(rs.getString(4)), rs.getString(5), rs.getInt(6), rs.getString(7), rs.getString(8), rs.getString(9),
                rs.getBoolean(10), rs.getString(11), rs.getObject(12, OffsetDateTime.class));
    }

    public Stats stats(UUID business) {
        Integer[] stars = {0, 0, 0, 0, 0};
        jdbc.sql("select rating, count(*) from reviews where business_id = :b and not hidden group by rating").param("b", business).query((rs, i) -> stars[rs.getInt(1) - 1] = rs.getInt(2)).list();
        double[] r = ratings(List.of(business)).getOrDefault(business, new double[]{0, 0});
        return new Stats(r[0], (int) r[1], List.of(stars));
    }

    public MerchantView forMerchant(UUID business) {
        return new MerchantView(stats(business), jdbc.sql(ITEM + "where r.business_id = :b order by r.created_at desc limit 200").param("b", business).query(Reviews::item).list());
    }

    public List<Item> forAdmin(String filter) {
        String where = "hidden".equals(filter) ? "where r.hidden " : "low".equals(filter) ? "where r.rating <= 2 " : "";
        return jdbc.sql(ITEM + where + "order by r.created_at desc limit 300").query(Reviews::item).list();
    }

    @Transactional
    public void setHidden(StaffPrincipal who, UUID id, boolean hidden, String reason) {
        if (jdbc.sql("update reviews set hidden = :h, hidden_reason = :r where id = :id").param("h", hidden).param("r", hidden ? reason.trim() : null).param("id", id).update() == 0) throw ApiException.notFound("Review not found.");
        audit.record(who, hidden ? "hide" : "unhide", "review", id, hidden ? reason.trim() : "");
    }
}
