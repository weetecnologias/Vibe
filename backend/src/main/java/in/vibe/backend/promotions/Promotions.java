package in.vibe.backend.promotions;

import in.vibe.backend.audit.AuditService;
import in.vibe.backend.catalogue.Businesses;
import in.vibe.backend.common.ApiException;
import in.vibe.backend.notify.StaffNotifications;
import in.vibe.backend.security.StaffPrincipal;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Promotions: a business promotes itself in the customer app's Discover tab. The merchant writes a headline, a short message and an optional photo,
 * and picks where a tap goes (its page, or one of its live offers). VIBE reviews each one before customers see it, like offers; businesses VIBE
 * trusts go live straight away. Changing the words, photo, offer or dates sends it back for review; switching it on or off does not.
 */
@Service
public class Promotions {
    /** Live (or waiting) promotions a business can have at once, so Discover isn't flooded by one place. */
    public static final int MAX_CURRENT = 3;
    static final Duration MAX_LENGTH = Duration.ofDays(90);

    public record Input(@NotBlank @Size(min = 3, max = 80) String title, @Size(max = 240) String message, @Size(max = 1000) String imageUrl, String offerId,
                        @NotNull OffsetDateTime startsAt, @NotNull OffsetDateTime endsAt, Boolean active) {}

    /** What the merchant and VIBE's reviewers see. */
    public record Row(String id, String businessId, String businessName, String title, String message, String imageUrl, String offerId, String offerTitle, OffsetDateTime startsAt,
                      OffsetDateTime endsAt, boolean active, String reviewStatus, String reviewNote, boolean autoApproved, int taps, boolean liveNow, OffsetDateTime createdAt) {}

    /** What customers see in Discover. imageUrl falls back to the place's cover photo; offerHeadline is set when the linked offer is live. */
    public record Card(String id, String businessId, String businessName, String businessLogoUrl, String area, double distanceKm, String categoryLabel, String primaryCategorySlug,
                       Businesses.OpenStatus status, String title, String message, String imageUrl, String offerId, String offerHeadline, OffsetDateTime endsAt) {}

    private final JdbcClient jdbc;
    private final Businesses businesses;
    private final AuditService audit;
    private final StaffNotifications staffNotifications;
    private final Clock clock;

    Promotions(JdbcClient jdbc, Businesses businesses, AuditService audit, StaffNotifications staffNotifications, Clock clock) {
        this.jdbc = jdbc;
        this.businesses = businesses;
        this.audit = audit;
        this.staffNotifications = staffNotifications;
        this.clock = clock;
    }

    private static final String SELECT = "select p.*, b.name bname, o.title otitle from promotions p join businesses b on b.id = p.business_id left join offers o on o.id = p.offer_id ";

    private Row map(ResultSet rs, int i) throws SQLException {
        OffsetDateTime now = OffsetDateTime.now(clock), s = rs.getObject("starts_at", OffsetDateTime.class), e = rs.getObject("ends_at", OffsetDateTime.class);
        boolean live = rs.getBoolean("active") && "approved".equals(rs.getString("review_status")) && !s.isAfter(now) && e.isAfter(now);
        return new Row(rs.getString("id"), rs.getString("business_id"), rs.getString("bname"), rs.getString("title"), rs.getString("message"), rs.getString("image_url"), rs.getString("offer_id"),
                rs.getString("otitle"), s, e, rs.getBoolean("active"), rs.getString("review_status"), rs.getString("review_note"), rs.getBoolean("auto_approved"), rs.getInt("taps"), live,
                rs.getObject("created_at", OffsetDateTime.class));
    }

    // ---------- merchant ----------
    public List<Row> mine(UUID business) {
        return jdbc.sql(SELECT + "where p.business_id = :b order by p.ends_at < now(), p.created_at desc").param("b", business).query(this::map).list();
    }

    private Row one(UUID business, UUID id) {
        return jdbc.sql(SELECT + "where p.id = :id and p.business_id = :b").param("id", id).param("b", business).query(this::map).optional()
                .orElseThrow(() -> ApiException.notFound("Promotion not found."));
    }

    private UUID check(UUID business, Input in) {
        if (!in.endsAt().isAfter(in.startsAt())) throw ApiException.badRequest("dates", "The end must be after the start.");
        if (Duration.between(in.startsAt(), in.endsAt()).compareTo(MAX_LENGTH) > 0) throw ApiException.badRequest("dates", "A promotion runs for up to 90 days. Add another one after it.");
        if (!in.endsAt().isAfter(OffsetDateTime.now(clock))) throw ApiException.badRequest("dates", "The end date has already passed.");
        String img = in.imageUrl() == null ? "" : in.imageUrl().trim();
        if (!img.isEmpty() && !img.matches("^https?://\\S+$")) throw ApiException.badRequest("image", "Upload a photo, or paste a web link to one.");
        if (in.offerId() == null || in.offerId().isBlank()) return null;
        UUID offer;
        try { offer = UUID.fromString(in.offerId()); } catch (IllegalArgumentException bad) { throw ApiException.badRequest("offer", "Choose one of your offers."); }
        if (jdbc.sql("select count(*) from offers where id = :o and business_id = :b").param("o", offer).param("b", business).query(Integer.class).single() == 0) {
            throw ApiException.badRequest("offer", "Choose one of your offers.");
        }
        return offer;
    }

    private static String clean(String s) { return s == null ? "" : s.trim(); }

    @Transactional
    public Row add(StaffPrincipal who, Input in) {
        UUID b = who.requireBusiness(), id = UUID.randomUUID();
        jdbc.sql("select id from businesses where id = :b for update").param("b", b).query(UUID.class).single(); // one at a time per business, for the limit below
        UUID offer = check(b, in);
        int current = jdbc.sql("select count(*) from promotions where business_id = :b and active and review_status <> 'rejected' and ends_at > now()").param("b", b).query(Integer.class).single();
        if (current >= MAX_CURRENT) throw ApiException.conflict("too_many", "You can run up to " + MAX_CURRENT + " promotions at a time. Switch one off or let it end first.");
        String img = clean(in.imageUrl());
        jdbc.sql("insert into promotions (id, business_id, title, message, image_url, offer_id, starts_at, ends_at, active) values (:id, :b, :t, :m, :img, :o, :s, :e, :a)")
                .param("id", id).param("b", b).param("t", in.title().trim()).param("m", clean(in.message())).param("img", img.isEmpty() ? null : img).param("o", offer)
                .param("s", in.startsAt()).param("e", in.endsAt()).param("a", in.active() == null || in.active()).update();
        audit.record(who, "create", "promotion", id, in.title());
        submitted(b, id, in.title().trim(), false);
        return one(b, id);
    }

    @Transactional
    public Row update(StaffPrincipal who, UUID id, Input in) {
        UUID b = who.requireBusiness();
        Row before = one(b, id);
        UUID offer = check(b, in);
        String img = clean(in.imageUrl());
        boolean changed = !before.title().equals(in.title().trim()) || !before.message().equals(clean(in.message())) || !java.util.Objects.equals(before.imageUrl(), img.isEmpty() ? null : img)
                || !java.util.Objects.equals(before.offerId(), offer == null ? null : offer.toString()) || !before.startsAt().toInstant().equals(in.startsAt().toInstant())
                || !before.endsAt().toInstant().equals(in.endsAt().toInstant());
        jdbc.sql("update promotions set title = :t, message = :m, image_url = :img, offer_id = :o, starts_at = :s, ends_at = :e, active = :a, updated_at = now()"
                        + (changed ? ", review_status = 'pending', auto_approved = false, review_note = null, reviewed_at = null, reviewed_by = null" : "") + " where id = :id and business_id = :b")
                .param("id", id).param("b", b).param("t", in.title().trim()).param("m", clean(in.message())).param("img", img.isEmpty() ? null : img).param("o", offer)
                .param("s", in.startsAt()).param("e", in.endsAt()).param("a", in.active() == null || in.active()).update();
        audit.record(who, "update", "promotion", id, in.title());
        if (changed) submitted(b, id, in.title().trim(), true);
        return one(b, id);
    }

    @Transactional
    public void delete(StaffPrincipal who, UUID id) {
        UUID b = who.requireBusiness();
        Row r = one(b, id);
        jdbc.sql("delete from promotions where id = :id and business_id = :b").param("id", id).param("b", b).update();
        audit.record(who, "delete", "promotion", id, r.title());
    }

    /** Trusted businesses go live at once (VIBE is still told and can reject later); everyone else waits for review. */
    private void submitted(UUID business, UUID id, String title, boolean changed) {
        String name = jdbc.sql("select name from businesses where id = :b").param("b", business).query(String.class).single();
        if (jdbc.sql("select auto_approve from businesses where id = :b").param("b", business).query(Boolean.class).single()) {
            jdbc.sql("update promotions set review_status = 'approved', auto_approved = true, review_note = null, reviewed_at = now(), reviewed_by = null where id = :id").param("id", id).update();
            audit.record(null, "auto_approve", "promotion", id, title);
            staffNotifications.toAdmins("promotion_auto", "Promotion live (auto-approved)", name + ": " + title, "/promotions");
        } else {
            staffNotifications.toAdmins("promotion_review", changed ? "Promotion changed, waiting for review" : "Promotion waiting for review", name + ": " + title, "/promotions");
        }
    }

    // ---------- VIBE review ----------
    /** Waiting ones first, oldest first. */
    public List<Row> list(String status) {
        String where = status == null || status.isBlank() ? "" : "where p.review_status = :s ";
        JdbcClient.StatementSpec s = jdbc.sql(SELECT + where + "order by (p.review_status = 'pending') desc, case when p.review_status = 'pending' then p.updated_at end asc, p.updated_at desc limit 200");
        if (!where.isEmpty()) s.param("s", status);
        return s.query(this::map).list();
    }

    @Transactional
    public Row decide(StaffPrincipal who, UUID id, boolean approve, String note) {
        if (!approve && (note == null || note.isBlank())) throw ApiException.badRequest("note_required", "Tell the business what to change.");
        Row before = jdbc.sql(SELECT + "where p.id = :id").param("id", id).query(this::map).optional().orElseThrow(() -> ApiException.notFound("Promotion not found."));
        jdbc.sql("update promotions set review_status = :st, auto_approved = false, review_note = :n, reviewed_at = now(), reviewed_by = :by where id = :id")
                .param("st", approve ? "approved" : "rejected").param("n", approve ? null : note.trim()).param("by", who.id()).param("id", id).update();
        audit.record(who, approve ? "approve" : "reject", "promotion", id, before.businessName() + ": " + before.title());
        staffNotifications.toBusiness(UUID.fromString(before.businessId()), "promotion_decision", approve ? "Promotion approved" : "Promotion not approved",
                before.title() + (approve ? " is approved and shows in Discover in its dates." : ": " + note.trim()), "/promotions");
        return jdbc.sql(SELECT + "where p.id = :id").param("id", id).query(this::map).single();
    }

    // ---------- customers ----------
    /** Live promotions, nearest place first, optionally only places in a category (and everything under it). */
    public List<Card> feed(UUID categoryId, int limit) {
        int lim = Math.min(Math.max(limit, 1), 50);
        Map<String, Object> p = new HashMap<>();
        p.put("now", OffsetDateTime.now(clock));
        String cte = "", cat = "";
        if (categoryId != null) {
            cte = "with recursive tree as (select id from categories where id = :cat union all select c.id from categories c join tree t on c.parent_id = t.id) ";
            cat = " and exists (select 1 from business_categories bc where bc.business_id = b.id and bc.category_id in (select id from tree))";
            p.put("cat", categoryId);
        }
        JdbcClient.StatementSpec spec = jdbc.sql(cte + "select p.*, b.name bname, b.logo_url, b.cover_url, b.area, b.lat, b.lng, c.name clabel, c.slug cslug, o.kind okind, o.rate_bps, o.flat_amount, "
                + "(o.id is not null and o.active and o.review_status = 'approved' and o.starts_at <= :now and o.ends_at > :now) olive "
                + "from promotions p join businesses b on b.id = p.business_id join categories c on c.id = b.primary_category_id left join offers o on o.id = p.offer_id "
                + "where b.active and p.active and p.review_status = 'approved' and p.starts_at <= :now and p.ends_at > :now" + cat
                + " order by " + Businesses.distanceSql("b") + ", p.created_at desc limit " + lim);
        p.forEach(spec::param);
        record R(UUID business, Card card) {}
        List<R> rows = spec.query((rs, i) -> {
            UUID bid = (UUID) rs.getObject("business_id");
            Object lat = rs.getObject("lat"), lng = rs.getObject("lng");
            boolean olive = rs.getBoolean("olive");
            int bps = rs.getInt("rate_bps");
            String headline = !olive ? null : "percentage".equals(rs.getString("okind")) ? (bps % 100 == 0 ? String.valueOf(bps / 100) : String.valueOf(bps / 100.0)) + "% off" : "₹" + rs.getLong("flat_amount") / 100 + " off";
            String img = rs.getString("image_url");
            return new R(bid, new Card(rs.getString("id"), bid.toString(), rs.getString("bname"), rs.getString("logo_url"), rs.getString("area"),
                    Businesses.distance(lat == null ? null : ((Number) lat).doubleValue(), lng == null ? null : ((Number) lng).doubleValue()), rs.getString("clabel"), rs.getString("cslug"), null,
                    rs.getString("title"), rs.getString("message"), img == null ? rs.getString("cover_url") : img, olive ? rs.getString("offer_id") : null, headline, rs.getObject("ends_at", OffsetDateTime.class)));
        }).list();
        Map<UUID, Businesses.OpenStatus> st = businesses.statuses(rows.stream().map(R::business).distinct().toList());
        return rows.stream().map(r -> {
            Card c = r.card();
            return new Card(c.id(), c.businessId(), c.businessName(), c.businessLogoUrl(), c.area(), c.distanceKm(), c.categoryLabel(), c.primaryCategorySlug(), st.get(r.business()), c.title(),
                    c.message(), c.imageUrl(), c.offerId(), c.offerHeadline(), c.endsAt());
        }).toList();
    }

    /** Counts a customer opening a promotion, for the business's results. Only live promotions count. */
    public void tap(UUID id) {
        jdbc.sql("update promotions set taps = taps + 1 where id = :id and active and review_status = 'approved' and starts_at <= now() and ends_at > now()").param("id", id).update();
    }
}
