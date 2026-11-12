package in.vibe.backend.dev;

import in.vibe.backend.catalogue.BusinessStore;
import in.vibe.backend.catalogue.Categories;
import in.vibe.backend.events.Events;
import in.vibe.backend.security.StaffPrincipal;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.simple.JdbcClient;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.InputStream;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Development only: loads the customer app's demo catalogue (every category, a place in each, menus, photos, offers and events) into the real
 * backend, so the app looks the same in live mode as in demo mode. Exported from apps/customer/src/api/demo/catalog.ts to dev/demo-catalogue.json.
 * Every place is fictional. Offers are approved and run for the next 90 days; events are moved to the coming weeks.
 */
final class DemoCatalogue {
    /** Kinds of business that sell tickets or aren't places, so they get no bill offers. */
    private static final Set<String> NO_BILLS = Set.of("movies", "events", "social", "offers");
    private static final DateTimeFormatter TWELVE = DateTimeFormatter.ofPattern("h:mm a", Locale.ENGLISH);
    private static final Map<String, Integer> DOW = Map.of("Monday", 0, "Tuesday", 1, "Wednesday", 2, "Thursday", 3, "Friday", 4, "Saturday", 5, "Sunday", 6);

    private final JsonNode root;
    private final JdbcClient jdbc;
    private final Categories categories;
    private final BusinessStore businesses;
    private final Events events;
    /** Category slug (the demo id, e.g. food.restaurants) to its id in the database. */
    final Map<String, String> categoryIds = new HashMap<>();
    /** Demo business id (e.g. b-saffron) to its id in the database. */
    final Map<String, UUID> businessIds = new LinkedHashMap<>();
    final Map<String, UUID> byName = new HashMap<>();

    DemoCatalogue(JsonMapper json, JdbcClient jdbc, Categories categories, BusinessStore businesses, Events events) {
        this.jdbc = jdbc;
        this.categories = categories;
        this.businesses = businesses;
        this.events = events;
        try (InputStream in = new ClassPathResource("dev/demo-catalogue.json").getInputStream()) {
            this.root = json.readTree(in);
        } catch (Exception e) {
            throw new IllegalStateException("dev/demo-catalogue.json is missing or unreadable", e);
        }
    }

    // ---------- categories ----------
    void categories(StaffPrincipal admin) {
        int sort = 1;
        for (JsonNode n : root.get("categories")) category(admin, null, n, sort++);
    }

    private void category(StaffPrincipal admin, String parent, JsonNode n, int sort) {
        String slug = text(n, "id");
        String top = slug.contains(".") ? slug.substring(0, slug.indexOf('.')) : slug;
        String label = switch (top) { case "food" -> "Menu"; case "shopping" -> "Price list"; case "fitness", "beauty", "kids" -> "Services"; default -> null; };
        String id = categories.create(admin, new Categories.Input(parent, slug, text(n, "name"), text(n, "icon"), null, url(text(n, "imageUrl")), sort, true,
                !NO_BILLS.contains(top), slug.equals(top) ? label : null)).id();
        categoryIds.put(slug, id);
        int i = 1;
        for (JsonNode c : n.withArray("children")) category(admin, id, c, i++);
    }

    /** The demo's category, or the nearest parent that exists. */
    private String categoryFor(String slug) {
        for (String s = slug; s != null; s = s.contains(".") ? s.substring(0, s.lastIndexOf('.')) : null) {
            if (categoryIds.containsKey(s)) return categoryIds.get(s);
        }
        return categoryIds.values().iterator().next();
    }

    // ---------- places, with menus and photos ----------
    void businesses(StaffPrincipal admin) {
        for (JsonNode b : root.get("businesses")) {
            String primary = categoryFor(text(b, "primaryCategoryId"));
            List<String> cats = new ArrayList<>();
            cats.add(primary);
            for (JsonNode c : b.withArray("categoryIds")) { String id = categoryFor(c.asString()); if (!cats.contains(id)) cats.add(id); }
            List<String> photos = new ArrayList<>();
            for (JsonNode p : b.withArray("photos")) if (photos.size() < 12 && url(p.asString()) != null) photos.add(p.asString());
            List<String> terms = new ArrayList<>();
            for (JsonNode t : b.withArray("terms")) if (terms.size() < 10) terms.add(t.asString());
            JsonNode loc = b.get("location");
            Long costForTwo = b.hasNonNull("costForTwo") ? b.get("costForTwo").asLong() : null;
            var profile = new BusinessStore.Profile(text(b, "name"), text(b, "area"), text(b, "address"), loc == null ? null : loc.get("lat").asDouble(), loc == null ? null : loc.get("lng").asDouble(),
                    text(b, "description"), null, url(text(b, "coverUrl")), b.get("priceLevel").asInt(), costForTwo, terms, b.get("bookingEnabled").asBoolean(), photos, hours(b.withArray("hours")));
            UUID id = UUID.fromString(businesses.create(admin, new BusinessStore.AdminInput(primary, cats, profile, b.get("verified").asBoolean(), b.get("isNew").asBoolean(), true)).id());
            businessIds.put(text(b, "id"), id);
            byName.put(text(b, "name"), id);
            int n = 0;
            for (JsonNode m : b.withArray("menu")) {
                jdbc.sql("insert into menu_items (id, business_id, name, note, price, section, image_url, sort_order) values (:id, :b, :n, :note, :p, :s, :img, :o)")
                        .param("id", UUID.randomUUID()).param("b", id).param("n", text(m, "name")).param("note", text(m, "note") == null ? "" : text(m, "note")).param("p", m.get("price").asLong())
                        .param("s", text(m, "section")).param("img", url(text(m, "imageUrl"))).param("o", n++).update();
            }
        }
    }

    /** "12:00 PM – 11:30 PM" per day name, to opening times (Monday is 0). */
    private static List<BusinessStore.Hour> hours(JsonNode days) {
        List<BusinessStore.Hour> out = new ArrayList<>();
        for (JsonNode d : days) {
            Integer dow = DOW.get(text(d, "day"));
            String[] range = text(d, "hours").split("\\s*[–-]\\s*");
            if (dow == null || range.length != 2) continue;
            try {
                out.add(new BusinessStore.Hour(dow, LocalTime.parse(range[0].trim().toUpperCase(Locale.ENGLISH), TWELVE).toString(), LocalTime.parse(range[1].trim().toUpperCase(Locale.ENGLISH), TWELVE).toString()));
            } catch (Exception ignored) {
                // a day the demo marks as closed
            }
        }
        return out;
    }

    // ---------- offers ----------
    /** Approved, running from yesterday for 90 days. `skip` are places whose offers the seed makes itself. */
    void offers(Set<String> skip) {
        OffsetDateTime from = OffsetDateTime.now().minusDays(1), to = OffsetDateTime.now().plusDays(90);
        for (JsonNode o : root.get("offers")) {
            UUID biz = businessIds.get(text(o, "businessId"));
            if (biz == null || skip.contains(text(o, "businessId"))) continue;
            String top = jdbc.sql("select c.slug from businesses b join categories c on c.id = b.primary_category_id where b.id = :b").param("b", biz).query(String.class).single();
            if (NO_BILLS.contains(top.contains(".") ? top.substring(0, top.indexOf('.')) : top)) continue;
            JsonNode r = o.get("rule");
            boolean pct = "percentage".equals(text(r, "kind"));
            jdbc.sql("insert into offers (id, business_id, title, kind, rate_bps, flat_amount, max_discount, min_bill, member_only, schedule_label, starts_at, ends_at, active, review_status, reviewed_at) "
                            + "values (:id, :b, :t, :k, :bps, :flat, :max, :min, :m, :sl, :s, :e, true, 'approved', now())")
                    .param("id", UUID.randomUUID()).param("b", biz).param("t", text(o, "title")).param("k", pct ? "percentage" : "flat")
                    .param("bps", pct ? r.get("rateBps").asInt() : null, java.sql.Types.INTEGER).param("flat", pct ? null : r.get("amount").asLong(), java.sql.Types.BIGINT)
                    .param("max", pct && r.hasNonNull("maxDiscount") ? r.get("maxDiscount").asLong() : null, java.sql.Types.BIGINT)
                    .param("min", r.hasNonNull("minBill") ? r.get("minBill").asLong() : null, java.sql.Types.BIGINT)
                    .param("m", o.get("memberOnly").asBoolean()).param("sl", text(o, "scheduleLabel")).param("s", from).param("e", to).update();
        }
    }

    // ---------- events ----------
    /** VIBE-run events, moved into the coming weeks (the demo's dates are fixed at export). `existing` are titles the seed already made. */
    void events(StaffPrincipal admin, Set<String> existing) {
        int i = 0;
        for (JsonNode e : root.get("events")) {
            if (existing.contains(text(e, "title")) || "Movies".equals(text(e, "kind"))) continue;
            OffsetDateTime starts = OffsetDateTime.now().plusDays(5 + 3L * i++).withHour(19).withMinute(0).withSecond(0).withNano(0);
            List<Events.TicketTypeInput> types = new ArrayList<>();
            for (JsonNode t : e.withArray("ticketTypes")) {
                types.add(new Events.TicketTypeInput(text(t, "name"), text(t, "description"), t.get("price").asLong(), Math.max(t.get("remaining").asInt(), 1), Math.min(Math.max(t.get("maxPerOrder").asInt(), 1), 20), null));
            }
            if (types.isEmpty()) continue;
            List<String> terms = new ArrayList<>();
            for (JsonNode t : e.withArray("terms")) terms.add(t.asString());
            Integer age = e.hasNonNull("ageLimit") ? e.get("ageLimit").asInt() : null;
            events.adminCreate(admin, new Events.Input(text(e, "title"), text(e, "kind"), text(e, "description"), text(e, "venue"), text(e, "area"), starts, starts.minusMinutes(30), url(text(e, "coverUrl")),
                    age, terms, text(e, "organiser"), e.get("featured").asBoolean(), types));
        }
    }

    // ---------- courts, turfs, nets and classes for sports and fitness places ----------
    private record Setup(String sport, String name, String kind, int count, int capacity, long price, Long peak, String peakFrom, String peakTo, boolean weekendPeak) {}

    /** What each kind of place offers, by its category. Prices in paise; peak is evenings and (where set) weekends. */
    private static final Map<String, List<Setup>> SLOTS = Map.ofEntries(
            Map.entry("fitness.sports.badminton", List.of(new Setup("Badminton", "Court", "court", 4, 1, 35000, 50000L, "18:00", "22:00", true), new Setup("Pickleball", "Pickleball court", "court", 2, 1, 40000, 55000L, "18:00", "22:00", true))),
            Map.entry("fitness.sports.tennis", List.of(new Setup("Tennis", "Hard court", "court", 3, 1, 60000, 80000L, "17:00", "21:00", true))),
            Map.entry("fitness.sports.football", List.of(new Setup("Football", "5-a-side turf", "court", 2, 1, 120000, 160000L, "18:00", "23:00", true))),
            Map.entry("fitness.sports.cricket", List.of(new Setup("Cricket", "Net", "court", 3, 1, 50000, 70000L, "17:00", "21:00", true), new Setup("Box cricket", "Box turf", "court", 1, 1, 140000, 180000L, "18:00", "23:00", true))),
            Map.entry("fitness.sports.swimming", List.of(new Setup("Swimming", "Pool session", "spots", 1, 25, 20000, null, null, null, false))),
            Map.entry("fitness.sports.skating", List.of(new Setup("Skating", "Rink session", "spots", 1, 20, 25000, null, null, null, false))),
            Map.entry("fitness.sports.martial-arts", List.of(new Setup("Martial arts", "Open class", "spots", 1, 15, 30000, null, null, null, false))),
            Map.entry("fitness.yoga", List.of(new Setup("Yoga", "Yoga class", "spots", 1, 15, 30000, 40000L, "06:00", "08:00", false))),
            Map.entry("fitness.gyms", List.of(new Setup("Gym", "Gym session", "spots", 1, 40, 25000, null, null, null, false))),
            Map.entry("fitness.training", List.of(new Setup("Personal training", "Coach", "court", 2, 1, 80000, null, null, null, false))),
            Map.entry("fitness.wellness", List.of(new Setup("Recovery", "Recovery session", "spots", 1, 6, 90000, null, null, null, false))),
            Map.entry("kids.sports.swimming", List.of(new Setup("Kids swimming", "Learn-to-swim class", "spots", 1, 10, 35000, null, null, null, false))),
            Map.entry("kids.sports.skating", List.of(new Setup("Kids skating", "Kids rink class", "spots", 1, 12, 30000, null, null, null, false))),
            Map.entry("kids.sports.martial-arts", List.of(new Setup("Kids martial arts", "Little ninjas class", "spots", 1, 12, 30000, null, null, null, false))));

    /** Gives every sports and fitness place its bookable courts or classes. */
    void slots() {
        for (JsonNode b : root.get("businesses")) {
            List<Setup> setups = SLOTS.get(text(b, "primaryCategoryId"));
            UUID biz = businessIds.get(text(b, "id"));
            if (setups == null || biz == null) continue;
            int sort = 0;
            for (Setup st : setups) {
                for (int n = 1; n <= st.count(); n++) {
                    jdbc.sql("insert into venue_resources (id, business_id, sport, name, kind, capacity, slot_minutes, price, peak_price, peak_from, peak_to, weekend_peak, sort_order) "
                                    + "values (:id, :b, :sport, :name, :kind, :cap, 60, :price, :peak, cast(:pf as time), cast(:pt as time), :wp, :sort)")
                            .param("id", UUID.randomUUID()).param("b", biz).param("sport", st.sport()).param("name", st.count() > 1 ? st.name() + " " + n : st.name()).param("kind", st.kind())
                            .param("cap", st.capacity()).param("price", st.price()).param("peak", st.peak(), java.sql.Types.BIGINT).param("pf", st.peakFrom(), java.sql.Types.VARCHAR)
                            .param("pt", st.peakTo(), java.sql.Types.VARCHAR).param("wp", st.weekendPeak()).param("sort", sort++).update();
                }
            }
        }
    }

    private static String text(JsonNode n, String field) {
        JsonNode v = n == null ? null : n.get(field);
        return v == null || v.isNull() ? null : v.asString();
    }

    private static String url(String s) { return s != null && s.matches("^https?://\\S+$") ? s : null; }
}
