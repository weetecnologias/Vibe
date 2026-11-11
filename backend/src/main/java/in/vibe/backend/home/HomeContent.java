package in.vibe.backend.home;

import in.vibe.backend.audit.AuditService;
import in.vibe.backend.catalogue.Businesses;
import in.vibe.backend.common.ApiException;
import in.vibe.backend.events.Events;
import in.vibe.backend.membership.Plans;
import in.vibe.backend.security.StaffPrincipal;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Types;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * What the customer app's home screen shows: the sliding banners VIBE sets, and the places, offers and events VIBE pins to a section.
 * With nothing pinned a section falls back to an automatic pick, so the home screen is never empty.
 */
@Service
public class HomeContent {
    static final int MAX_PICKS = 12;

    public record BannerInput(
            @Size(max = 40) String eyebrow,
            @NotBlank @Size(max = 80) String title,
            @Size(max = 160) String subtitle,
            @Size(max = 30) String cta,
            @Pattern(regexp = "^https?://\\S+$", message = "must be an http(s) link") String imageUrl,
            @NotBlank @Pattern(regexp = "offer|events|category") String targetType,
            String targetId,
            @Min(0) Integer sortOrder,
            Boolean active,
            OffsetDateTime startsAt,
            OffsetDateTime endsAt) {}

    public record BannerRow(String id, String eyebrow, String title, String subtitle, String cta, String imageUrl, String targetType, String targetId, int sortOrder, boolean active,
                            OffsetDateTime startsAt, OffsetDateTime endsAt, boolean liveNow) {}

    /** What the customer app receives (`HomeFeed.banners`). */
    public record Target(String type, String id) {}

    public record Banner(String id, String eyebrow, String title, String subtitle, String cta, String imageUrl, Target target) {}

    public record Pick(String id, String label, String sub) {}

    public record Promo(long price, String interval) {}

    public record Feed(List<Banner> banners, List<Businesses.Summary> trending, List<Businesses.OfferView> offers, List<Events.PublicSummary> events, List<Businesses.Summary> nearby,
                       List<Events.PublicSummary> experiences, List<Object> activities, List<Businesses.Summary> recentlyAdded, Promo membershipPromo) {}

    private final JdbcClient jdbc;
    private final AuditService audit;
    private final Businesses businesses;
    private final Events events;
    private final Plans plans;
    private final Clock clock;

    HomeContent(JdbcClient jdbc, AuditService audit, Businesses businesses, Events events, Plans plans, Clock clock) {
        this.jdbc = jdbc;
        this.audit = audit;
        this.businesses = businesses;
        this.events = events;
        this.plans = plans;
        this.clock = clock;
    }

    // ---------- banners ----------
    private BannerRow map(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        OffsetDateTime s = rs.getObject("starts_at", OffsetDateTime.class), e = rs.getObject("ends_at", OffsetDateTime.class), now = OffsetDateTime.now(clock);
        boolean live = rs.getBoolean("active") && (s == null || !s.isAfter(now)) && (e == null || e.isAfter(now));
        return new BannerRow(rs.getString("id"), rs.getString("eyebrow"), rs.getString("title"), rs.getString("subtitle"), rs.getString("cta"), rs.getString("image_url"), rs.getString("target_type"),
                rs.getString("target_id"), rs.getInt("sort_order"), rs.getBoolean("active"), s, e, live);
    }

    public List<BannerRow> banners() {
        return jdbc.sql("select * from home_banners order by sort_order, created_at").query(this::map).list();
    }

    @Transactional
    public BannerRow createBanner(StaffPrincipal who, BannerInput in) {
        UUID target = checkBanner(in);
        UUID id = UUID.randomUUID();
        jdbc.sql("insert into home_banners (id, eyebrow, title, subtitle, cta, image_url, target_type, target_id, sort_order, active, starts_at, ends_at) values (:id, :e, :t, :s, :c, :i, :tt, :ti, :o, :a, :st, :en)")
                .param("id", id).param("e", text(in.eyebrow())).param("t", in.title().trim()).param("s", text(in.subtitle())).param("c", in.cta() == null || in.cta().isBlank() ? "Explore" : in.cta().trim())
                .param("i", blank(in.imageUrl())).param("tt", in.targetType()).param("ti", target, Types.OTHER).param("o", in.sortOrder() == null ? 0 : in.sortOrder())
                .param("a", in.active() == null || in.active()).param("st", in.startsAt(), Types.TIMESTAMP_WITH_TIMEZONE).param("en", in.endsAt(), Types.TIMESTAMP_WITH_TIMEZONE).update();
        audit.record(who, "create", "banner", id, in.title());
        return banner(id);
    }

    @Transactional
    public BannerRow updateBanner(StaffPrincipal who, UUID id, BannerInput in) {
        banner(id);
        UUID target = checkBanner(in);
        jdbc.sql("update home_banners set eyebrow = :e, title = :t, subtitle = :s, cta = :c, image_url = :i, target_type = :tt, target_id = :ti, sort_order = :o, active = :a, starts_at = :st, ends_at = :en, updated_at = now() where id = :id")
                .param("id", id).param("e", text(in.eyebrow())).param("t", in.title().trim()).param("s", text(in.subtitle())).param("c", in.cta() == null || in.cta().isBlank() ? "Explore" : in.cta().trim())
                .param("i", blank(in.imageUrl())).param("tt", in.targetType()).param("ti", target, Types.OTHER).param("o", in.sortOrder() == null ? 0 : in.sortOrder())
                .param("a", in.active() == null || in.active()).param("st", in.startsAt(), Types.TIMESTAMP_WITH_TIMEZONE).param("en", in.endsAt(), Types.TIMESTAMP_WITH_TIMEZONE).update();
        audit.record(who, "update", "banner", id, in.title());
        return banner(id);
    }

    @Transactional
    public void deleteBanner(StaffPrincipal who, UUID id) {
        BannerRow b = banner(id);
        jdbc.sql("delete from home_banners where id = :id").param("id", id).update();
        audit.record(who, "delete", "banner", id, b.title());
    }

    private BannerRow banner(UUID id) {
        return jdbc.sql("select * from home_banners where id = :id").param("id", id).query(this::map).optional().orElseThrow(() -> ApiException.notFound("Banner not found."));
    }

    /** A banner has to point somewhere that exists: a live offer, a category, or the events list. */
    private UUID checkBanner(BannerInput in) {
        if (in.endsAt() != null && in.startsAt() != null && !in.endsAt().isAfter(in.startsAt())) throw ApiException.badRequest("banner_dates", "The banner must end after it starts.");
        if ("events".equals(in.targetType())) return null;
        UUID target;
        try { target = UUID.fromString(in.targetId()); } catch (RuntimeException e) { throw ApiException.badRequest("banner_target", "Choose what the banner opens."); }
        String table = "offer".equals(in.targetType()) ? "offers" : "categories";
        if (jdbc.sql("select count(*) from " + table + " where id = :id").param("id", target).query(Integer.class).single() == 0) throw ApiException.badRequest("banner_target", "That " + in.targetType() + " doesn’t exist.");
        return target;
    }

    // ---------- pinned sections ----------
    private static String check(String section) {
        if (!List.of("trending", "offers", "events").contains(section)) throw ApiException.notFound("Unknown section.");
        return section;
    }

    public List<Pick> picks(String section) {
        check(section);
        List<UUID> ids = pinned(section);
        List<Pick> out = new ArrayList<>();
        for (UUID id : ids) {
            String sql = switch (section) {
                case "trending" -> "select id::text, name, area as sub from businesses where id = :id";
                case "offers" -> "select o.id::text, o.title as name, b.name as sub from offers o join businesses b on b.id = o.business_id where o.id = :id";
                default -> "select id::text, title as name, venue as sub from events where id = :id";
            };
            jdbc.sql(sql).param("id", id).query((rs, i) -> new Pick(rs.getString(1), rs.getString(2), rs.getString(3))).optional().ifPresent(out::add);
        }
        return out;
    }

    public List<UUID> pinned(String section) {
        return jdbc.sql("select ref_id from home_picks where section = :s order by sort_order").param("s", section).query((rs, i) -> (UUID) rs.getObject(1)).list();
    }

    /** Replaces the pinned list for a section. Only things that are live and visible to customers can be pinned. */
    @Transactional
    public List<Pick> setPicks(StaffPrincipal who, String section, List<String> rawIds) {
        check(section);
        if (rawIds == null) throw ApiException.badRequest("picks", "Send the list of items to pin.");
        if (rawIds.size() > MAX_PICKS) throw ApiException.badRequest("picks", "You can pin up to " + MAX_PICKS + " items.");
        List<UUID> ids = new ArrayList<>();
        for (String raw : rawIds) {
            UUID id;
            try { id = UUID.fromString(raw); } catch (RuntimeException e) { throw ApiException.badRequest("picks", "One of the items isn’t valid."); }
            if (ids.contains(id)) throw ApiException.badRequest("picks", "An item can only be pinned once.");
            String sql = switch (section) {
                case "trending" -> "select count(*) from businesses where id = :id and active";
                case "offers" -> "select count(*) from offers where id = :id and active and review_status = 'approved'";
                default -> "select count(*) from events where id = :id and status = 'published'";
            };
            if (jdbc.sql(sql).param("id", id).query(Integer.class).single() == 0) throw ApiException.badRequest("picks", "Only live items can be pinned. Check each one is switched on and approved.");
            ids.add(id);
        }
        jdbc.sql("delete from home_picks where section = :s").param("s", section).update();
        int n = 0;
        for (UUID id : ids) jdbc.sql("insert into home_picks (section, ref_id, sort_order) values (:s, :r, :o)").param("s", section).param("r", id).param("o", n++).update();
        audit.record(who, "update", "home_picks", section, ids.size() + " pinned");
        return picks(section);
    }

    // ---------- the feed the customer app reads ----------
    public Feed feed() {
        OffsetDateTime now = OffsetDateTime.now(clock);
        List<Banner> banners = banners().stream().filter(BannerRow::liveNow)
                .map(b -> new Banner(b.id(), b.eyebrow(), b.title(), b.subtitle(), b.cta(), b.imageUrl(), new Target(b.targetType(), b.targetId()))).toList();
        List<UUID> trendingIds = pinned("trending");
        List<Businesses.Summary> trending = trendingIds.isEmpty() ? businesses.search(null, null, "newest", 8, 0).items() : businesses.byIds(trendingIds);
        List<Businesses.OfferView> offers = businesses.offers("trending", pinned("offers"), 8);
        List<UUID> eventIds = pinned("events");
        List<Events.PublicSummary> evs = eventIds.isEmpty() ? events.publicList(null, 8) : events.publicByIds(eventIds);
        List<Plans.PublicPlan> ps = plans.publicList();
        Promo promo = ps.isEmpty() ? null : new Promo(ps.get(0).price(), ps.get(0).interval());
        return new Feed(banners, trending, offers, evs, businesses.search(null, null, "nearest", 8, 0).items(), events.publicList("Experiences", 8), List.of(),
                businesses.search(null, null, "newest", 8, 0).items(), promo);
    }

    private static String text(String s) { return s == null ? "" : s.trim(); }
    private static String blank(String s) { return s == null || s.isBlank() ? null : s.trim(); }
}
