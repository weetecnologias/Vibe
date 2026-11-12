package in.vibe.backend.catalogue;

import in.vibe.backend.common.ApiException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.DayOfWeek;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZonedDateTime;
import java.time.format.TextStyle;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * What the customer app reads: the shapes below match the app's `BusinessSummary`, `BusinessDetail` and `OfferSummary` types.
 * Ratings, reviews and branches arrive with their own modules, so they are empty or zero for now.
 */
@Service
public class Businesses {
    /** Distances are measured from this point until the app sends the member's area. */
    static final double REF_LAT = 17.4326, REF_LNG = 78.4071; // Jubilee Hills

    public record OpenStatus(boolean open, String label, String tone) {}

    public record Summary(String id, String name, String primaryCategoryId, List<String> categoryIds, String categoryLabel, String area, double distanceKm,
                          double rating, int reviewCount, int priceLevel, Long costForTwo, OpenStatus status, String coverUrl, String logoUrl,
                          String offerBadge, boolean hasMemberOffer, boolean isNew) {}

    public record OfferView(String id, String businessId, String businessName, String businessLogoUrl, String area, String title, String type, String headline,
                            String headlineSub, boolean memberOnly, String coverUrl, String scheduleLabel, OffsetDateTime endsAt, Long maxDiscount, Long minBill) {}

    public record MenuView(String id, String name, String note, long price, String imageUrl, String section) {}

    public record HourView(String day, String hours, boolean today) {}

    public record CategoryName(String id, String name, boolean primary) {}

    public record Detail(String id, String name, String primaryCategoryId, List<String> categoryIds, String categoryLabel, String area, double distanceKm,
                         double rating, int reviewCount, int priceLevel, Long costForTwo, OpenStatus status, String coverUrl, String logoUrl,
                         String offerBadge, boolean hasMemberOffer, boolean isNew,
                         String description, boolean verified, List<CategoryName> categoryNames, String address, Map<String, Double> location,
                         List<HourView> hours, List<String> photos, List<MenuView> menu, List<OfferView> offers, List<Object> branches, List<Object> reviews,
                         List<String> terms, boolean bookingEnabled) {}

    public record Page<T>(List<T> items, int total, Integer nextOffset) {}

    public record Example(long bill, long discount, long payable) {}

    /** The customer app's OfferDetail: the offer, how it applies, and a worked example priced by the same code that prices real bills. */
    public record OfferDetail(String id, String businessId, String businessName, String businessLogoUrl, String area, String title, String type, String headline, String headlineSub, boolean memberOnly,
                              String coverUrl, String scheduleLabel, OffsetDateTime endsAt, Long maxDiscount, Long minBill, String appliesTo, String excludes, List<String> channels, List<String> terms, Example example,
                              List<String> redeemModes) {}

    private final JdbcClient jdbc;
    private final Clock clock;

    private final in.vibe.backend.reviews.Reviews reviews;

    Businesses(JdbcClient jdbc, Clock clock, in.vibe.backend.reviews.Reviews reviews) {
        this.reviews = reviews;
        this.jdbc = jdbc;
        this.clock = clock;
    }

    public Page<Summary> search(String q, UUID categoryId, String sort, int limit, int offset) {
        int lim = Math.min(Math.max(limit, 1), 100);
        int off = Math.max(offset, 0);
        StringBuilder where = new StringBuilder(" where b.active");
        Map<String, Object> p = new HashMap<>();
        String cte = "";
        if (q != null && !q.isBlank()) {
            where.append(" and lower(b.name) like :q escape '\\'");
            p.put("q", "%" + q.trim().toLowerCase(Locale.ROOT).replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%");
        }
        if (categoryId != null) {
            // The category and everything under it, so "Food & Dining" finds restaurants and cafés too.
            cte = "with recursive tree as (select id from categories where id = :cat union all select c.id from categories c join tree t on c.parent_id = t.id) ";
            where.append(" and exists (select 1 from business_categories bc where bc.business_id = b.id and bc.category_id in (select id from tree))");
            p.put("cat", categoryId);
        }
        String distance = "(case when b.lat is null or b.lng is null then 9999 else 6371 * acos(least(1, cos(radians(" + REF_LAT + ")) * cos(radians(b.lat)) * cos(radians(b.lng) - radians(" + REF_LNG
                + ")) + sin(radians(" + REF_LAT + ")) * sin(radians(b.lat)))) end)";
        String order = "nearest".equals(sort) ? distance + ", lower(b.name)" : "newest".equals(sort) ? "b.created_at desc, lower(b.name)" : "lower(b.name)";
        String from = " from businesses b join categories c on c.id = b.primary_category_id";

        JdbcClient.StatementSpec count = jdbc.sql(cte + "select count(*)" + from + where);
        p.forEach(count::param);
        int total = count.query(Integer.class).single();

        JdbcClient.StatementSpec page = jdbc.sql(cte + "select b.*, c.name as category_label" + from + where + " order by " + order + " limit " + lim + " offset " + off);
        p.forEach(page::param);
        List<Row> rows = page.query(Businesses::row).list();
        List<Summary> items = summaries(rows);
        return new Page<>(items, total, off + lim < total ? off + lim : null);
    }

    public Detail detail(UUID id) {
        Row r = jdbc.sql("select b.*, c.name as category_label from businesses b join categories c on c.id = b.primary_category_id where b.id = :id and b.active")
                .param("id", id).query(Businesses::row).optional().orElseThrow(() -> ApiException.notFound("This place is no longer available."));
        Summary s = summaries(List.of(r)).get(0);
        List<CategoryName> names = jdbc.sql("select c.id, c.name from business_categories bc join categories c on c.id = bc.category_id where bc.business_id = :id order by c.name")
                .param("id", id).query((rs, i) -> new CategoryName(rs.getString("id"), rs.getString("name"), rs.getString("id").equals(r.primaryCategoryId))).list();
        List<String> photos = jdbc.sql("select url from business_photos where business_id = :id order by sort_order, id").param("id", id).query(String.class).list();
        List<MenuView> menu = jdbc.sql("select id, name, note, price, image_url, section from menu_items where business_id = :id and active order by sort_order, name")
                .param("id", id).query((rs, i) -> new MenuView(rs.getString("id"), rs.getString("name"), rs.getString("note"), rs.getLong("price"), rs.getString("image_url"), rs.getString("section"))).list();
        List<OfferView> offers = activeOffers(List.of(id)).getOrDefault(id, List.of());
        Map<String, Double> loc = r.lat == null || r.lng == null ? null : Map.of("lat", r.lat, "lng", r.lng);
        return new Detail(s.id(), s.name(), s.primaryCategoryId(), s.categoryIds(), s.categoryLabel(), s.area(), s.distanceKm(), s.rating(), s.reviewCount(), s.priceLevel(),
                s.costForTwo(), s.status(), s.coverUrl(), s.logoUrl(), s.offerBadge(), s.hasMemberOffer(), s.isNew(),
                r.description, r.verified, names, r.address, loc, hoursView(hoursOf(List.of(id)).getOrDefault(id, Map.of())), photos, menu, offers, List.of(), new ArrayList<>(reviews.latest(id, 10)), r.terms, r.bookingEnabled);
    }

    // ---------- helpers ----------
    private record Row(UUID id, String name, String primaryCategoryId, String categoryLabel, String area, String address, Double lat, Double lng, String description,
                       String logoUrl, String coverUrl, int priceLevel, Long costForTwo, boolean verified, boolean isNew, boolean bookingEnabled, List<String> terms) {}

    private static Row row(ResultSet rs, int i) throws SQLException {
        Object cost = rs.getObject("cost_for_two");
        Object lat = rs.getObject("lat"), lng = rs.getObject("lng");
        java.sql.Array terms = rs.getArray("terms");
        return new Row((UUID) rs.getObject("id"), rs.getString("name"), rs.getString("primary_category_id"), rs.getString("category_label"), rs.getString("area"), rs.getString("address"),
                lat == null ? null : ((Number) lat).doubleValue(), lng == null ? null : ((Number) lng).doubleValue(), rs.getString("description"), rs.getString("logo_url"),
                rs.getString("cover_url"), rs.getInt("price_level"), cost == null ? null : ((Number) cost).longValue(), rs.getBoolean("verified"), rs.getBoolean("is_new"),
                rs.getBoolean("booking_enabled"), terms == null ? List.of() : List.of((String[]) terms.getArray()));
    }

    private List<Summary> summaries(List<Row> rows) {
        if (rows.isEmpty()) return List.of();
        List<UUID> ids = rows.stream().map(Row::id).toList();
        Map<UUID, List<String>> cats = new HashMap<>();
        jdbc.sql("select business_id, category_id from business_categories where business_id in (:ids)").param("ids", ids)
                .query((rs, i) -> { cats.computeIfAbsent((UUID) rs.getObject(1), k -> new ArrayList<>()).add(rs.getString(2)); return 0; }).list();
        Map<UUID, List<OfferView>> offers = activeOffers(ids);
        Map<UUID, Map<Integer, LocalTime[]>> hours = hoursOf(ids);
        Map<UUID, double[]> ratings = reviews.ratings(ids);
        List<Summary> out = new ArrayList<>();
        for (Row r : rows) {
            List<OfferView> os = offers.getOrDefault(r.id, List.of());
            OfferView best = os.isEmpty() ? null : os.get(0);
            List<String> categoryIds = new ArrayList<>(cats.getOrDefault(r.id, List.of()));
            if (!categoryIds.contains(r.primaryCategoryId)) categoryIds.add(0, r.primaryCategoryId);
            out.add(new Summary(r.id.toString(), r.name, r.primaryCategoryId, categoryIds, r.categoryLabel, r.area, distance(r.lat, r.lng), ratings.getOrDefault(r.id, new double[2])[0], (int) ratings.getOrDefault(r.id, new double[2])[1], r.priceLevel, r.costForTwo,
                    status(hours.getOrDefault(r.id, Map.of())), r.coverUrl, r.logoUrl, best == null ? null : best.headline() + " " + best.headlineSub().toLowerCase(Locale.ROOT),
                    os.stream().anyMatch(OfferView::memberOnly), r.isNew));
        }
        return out;
    }

    /** Offers that are on right now (active, approved by VIBE, inside their dates), best first, grouped by business. */
    private Map<UUID, List<OfferView>> activeOffers(List<UUID> businessIds) {
        Map<UUID, List<OfferView>> out = new HashMap<>();
        for (OfferView o : liveOffers("and o.business_id in (:ids)", Map.of("ids", businessIds), "o.member_only desc, coalesce(o.rate_bps, 0) desc, o.flat_amount desc nulls last", 1000)) {
            out.computeIfAbsent(UUID.fromString(o.businessId()), k -> new ArrayList<>()).add(o);
        }
        return out;
    }

    private List<OfferView> liveOffers(String extraWhere, Map<String, Object> params, String orderBy, int limit) {
        JdbcClient.StatementSpec spec = jdbc.sql("select o.*, b.name bname, b.area, b.logo_url, b.cover_url from offers o join businesses b on b.id = o.business_id "
                + "where b.active and o.active and o.review_status = 'approved' and o.starts_at <= :now and o.ends_at > :now " + extraWhere + " order by " + orderBy + " limit " + limit).param("now", OffsetDateTime.now(clock));
        params.forEach(spec::param);
        return spec.query((rs, i) -> {
            UUID bid = (UUID) rs.getObject("business_id");
            boolean pct = "percentage".equals(rs.getString("kind"));
            String headline = pct ? trim(rs.getInt("rate_bps") / 100.0) + "%" : "₹" + (rs.getLong("flat_amount") / 100);
            Object max = rs.getObject("max_discount"), min = rs.getObject("min_bill");
            return new OfferView(rs.getString("id"), bid.toString(), rs.getString("bname"), rs.getString("logo_url"), rs.getString("area"), rs.getString("title"), rs.getString("kind"), headline, "OFF",
                    rs.getBoolean("member_only"), rs.getString("cover_url"), rs.getString("schedule_label"), rs.getObject("ends_at", OffsetDateTime.class),
                    max == null ? null : ((Number) max).longValue(), min == null ? null : ((Number) min).longValue());
        }).list();
    }

    /**
     * The offers list the customer app shows. view: all, member (members only), new (recently added), ending (within 7 days),
     * trending (the ones VIBE pinned, in order; falls back to the biggest discounts).
     */
    public List<OfferView> offers(String view, List<UUID> pinned, int limit) {
        int lim = Math.min(Math.max(limit, 1), 100);
        String v = view == null ? "all" : view;
        switch (v) {
            case "member": return liveOffers("and o.member_only", Map.of(), "o.ends_at", lim);
            case "new": return liveOffers("", Map.of(), "o.created_at desc", lim);
            case "ending": return liveOffers("and o.ends_at < :soon", Map.of("soon", OffsetDateTime.now(clock).plusDays(7)), "o.ends_at", lim);
            case "trending": {
                if (!pinned.isEmpty()) return pinnedOffers(pinned);
                return liveOffers("", Map.of(), "coalesce(o.rate_bps, 0) desc, o.flat_amount desc nulls last", lim);
            }
            default: return liveOffers("", Map.of(), "o.member_only desc, coalesce(o.rate_bps, 0) desc, o.flat_amount desc nulls last", lim);
        }
    }

    public OfferDetail offerDetail(UUID id) {
        OfferView o = liveOffers("and o.id = :oid", Map.of("oid", id), "o.created_at", 1).stream().findFirst().orElseThrow(() -> ApiException.notFound("This offer has ended or was withdrawn."));
        Example example = jdbc.sql("select kind, rate_bps, flat_amount, max_discount, min_bill from offers where id = :id").param("id", id).query((rs, i) -> {
            Object bps = rs.getObject(2), flat = rs.getObject(3), max = rs.getObject(4), min = rs.getObject(5);
            Long minBill = min == null ? null : ((Number) min).longValue();
            long bill = Math.max(100_000L, minBill == null ? 0 : minBill);
            var q = in.vibe.backend.billing.Pricing.quote(rs.getString(1), bps == null ? null : ((Number) bps).intValue(), flat == null ? null : ((Number) flat).longValue(), max == null ? null : ((Number) max).longValue(), minBill, bill);
            return new Example(bill, q.discount(), bill - q.discount());
        }).single();
        List<String> terms = List.of((String[]) jdbc.sql("select terms from businesses where id = :id").param("id", UUID.fromString(o.businessId())).query((rs, i) -> rs.getArray(1).getArray()).single());
        return new OfferDetail(o.id(), o.businessId(), o.businessName(), o.businessLogoUrl(), o.area(), o.title(), o.type(), o.headline(), o.headlineSub(), o.memberOnly(), o.coverUrl(), o.scheduleLabel(), o.endsAt(),
                o.maxDiscount(), o.minBill(), "Your bill at " + o.businessName(), "", List.of("In store"), terms, example,
                jdbc.sql("select accepts_vibe_payments from businesses where id = :id").param("id", UUID.fromString(o.businessId())).query(Boolean.class).single() ? List.of("code", "bill") : List.of("code"));
    }

    /** Pinned offers, in the order VIBE set. An offer that is no longer live is skipped. */
    public List<OfferView> pinnedOffers(List<UUID> ids) {
        if (ids.isEmpty()) return List.of();
        Map<String, OfferView> byId = new HashMap<>();
        for (OfferView o : liveOffers("and o.id in (:oids)", Map.of("oids", ids), "o.created_at", 100)) byId.put(o.id(), o);
        return ids.stream().map(u -> byId.get(u.toString())).filter(java.util.Objects::nonNull).toList();
    }

    /** Active businesses in the given order (for pinned trending places). */
    public List<Summary> byIds(List<UUID> ids) {
        if (ids.isEmpty()) return List.of();
        List<Row> rows = jdbc.sql("select b.*, c.name as category_label from businesses b join categories c on c.id = b.primary_category_id where b.active and b.id in (:ids)").param("ids", ids).query(Businesses::row).list();
        Map<String, Summary> byId = new HashMap<>();
        for (Summary s : summaries(rows)) byId.put(s.id(), s);
        return ids.stream().map(u -> byId.get(u.toString())).filter(java.util.Objects::nonNull).toList();
    }

    private static String trim(double v) { return v == Math.floor(v) ? String.valueOf((long) v) : String.valueOf(v); }

    private Map<UUID, Map<Integer, LocalTime[]>> hoursOf(List<UUID> ids) {
        Map<UUID, Map<Integer, LocalTime[]>> out = new HashMap<>();
        jdbc.sql("select business_id, dow, opens, closes from business_hours where business_id in (:ids)").param("ids", ids)
                .query((rs, i) -> {
                    java.sql.Time o = rs.getTime("opens"), c = rs.getTime("closes");
                    out.computeIfAbsent((UUID) rs.getObject("business_id"), k -> new HashMap<>())
                            .put(rs.getInt("dow"), o == null || c == null ? null : new LocalTime[]{o.toLocalTime(), c.toLocalTime()});
                    return 0;
                }).list();
        return out;
    }

    static double distance(Double lat, Double lng) {
        if (lat == null || lng == null) return 0;
        double dLat = Math.toRadians(lat - REF_LAT), dLng = Math.toRadians(lng - REF_LNG);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(Math.toRadians(REF_LAT)) * Math.cos(Math.toRadians(lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return Math.round(2 * 6371 * Math.asin(Math.sqrt(a)) * 10) / 10.0;
    }

    private static String clockLabel(LocalTime t) {
        int h = t.getHour() % 12 == 0 ? 12 : t.getHour() % 12;
        return h + (t.getMinute() == 0 ? "" : String.format(":%02d", t.getMinute())) + (t.getHour() < 12 ? " AM" : " PM");
    }

    /** Open or closed right now (India time), including a closing-soon warning in the last hour. Hours that run past midnight count for the day they start. */
    OpenStatus status(Map<Integer, LocalTime[]> week) {
        if (week.isEmpty()) return new OpenStatus(false, "Hours not set", "muted");
        ZonedDateTime now = ZonedDateTime.now(clock);
        int dow = now.getDayOfWeek().getValue() - 1;
        LocalTime t = now.toLocalTime();
        LocalTime[] today = week.get(dow);
        LocalTime[] yesterday = week.get((dow + 6) % 7);
        if (yesterday != null && yesterday[1].isBefore(yesterday[0]) && t.isBefore(yesterday[1])) return openUntil(yesterday[1], t);
        if (today != null) {
            boolean overnight = today[1].isBefore(today[0]) || today[1].equals(today[0]);
            if (!t.isBefore(today[0]) && (overnight || t.isBefore(today[1]))) return openUntil(today[1], t);
            if (t.isBefore(today[0])) return new OpenStatus(false, "Closed · opens " + clockLabel(today[0]), "muted");
        }
        for (int d = 1; d <= 7; d++) {
            LocalTime[] next = week.get((dow + d) % 7);
            if (next != null) return new OpenStatus(false, "Closed · opens " + (d == 1 ? "tomorrow " : DayOfWeek.of(((dow + d) % 7) + 1).getDisplayName(TextStyle.SHORT, Locale.ENGLISH) + " ") + clockLabel(next[0]), "muted");
        }
        return new OpenStatus(false, "Closed", "muted");
    }

    private static OpenStatus openUntil(LocalTime closes, LocalTime now) {
        long minsLeft = java.time.Duration.between(now, closes).toMinutes();
        if (minsLeft < 0) minsLeft += 24 * 60;
        return minsLeft <= 60 ? new OpenStatus(true, "Closing soon · " + clockLabel(closes), "warning") : new OpenStatus(true, "Open · closes " + clockLabel(closes), "success");
    }

    private List<HourView> hoursView(Map<Integer, LocalTime[]> week) {
        if (week.isEmpty()) return List.of();
        int today = ZonedDateTime.now(clock).getDayOfWeek().getValue() - 1;
        List<HourView> out = new ArrayList<>();
        for (int d = 0; d < 7; d++) {
            LocalTime[] h = week.get(d);
            out.add(new HourView(DayOfWeek.of(d + 1).getDisplayName(TextStyle.FULL, Locale.ENGLISH), h == null ? "Closed" : clockLabel(h[0]) + " – " + clockLabel(h[1]), d == today));
        }
        return out;
    }
}
