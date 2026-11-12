package in.vibe.backend.catalogue;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * What a merchant gets depends on the category it onboarded in: a café gets bills, offers, its menu and reservations; a sports venue gets
 * slot bookings and memberships; an event organiser gets events. VIBE sets the features on a category (admin → Categories) and everything
 * under it follows unless it sets its own, so a new subcategory works the day it's added. A business follows its main category.
 *
 * Always there for every merchant, whatever the category: the profile, reviews, results and settlements, and the team.
 */
@Service
public class MerchantFeatures {
    /** Every feature a category can switch on, with what it means to a merchant. Order is the order shown. */
    public static final Map<String, String> ALL = all();

    private static Map<String, String> all() {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("bills", "Bills: send the bill to the customer's app and get paid through VIBE");
        m.put("offers", "Offers: discounts customers redeem at the counter or on the bill");
        m.put("menu", "Menu, price list or services");
        m.put("reservations", "Table and slot reservations");
        m.put("bookings", "Bookings by the hour: courts, turfs, classes, private screens");
        m.put("memberships", "Monthly memberships and members");
        m.put("events", "Events and tickets");
        m.put("promotions", "Promotions in Discover");
        return m;
    }

    /** features: what's switched on. explicit: false when no category up the tree has set any, so the business keeps everything (as before features existed). */
    public record Profile(List<String> features, boolean explicit, String categoryId, String categoryName, String topCategoryName) {
        public boolean has(String feature) { return features.contains(feature); }
    }

    private final JdbcClient jdbc;

    MerchantFeatures(JdbcClient jdbc) { this.jdbc = jdbc; }

    private static final String CHAIN = """
            with recursive chain as (
                select c.id, c.parent_id, c.name, c.features, c.pay_redeem, 0 depth from categories c where c.id = %s
                union all
                select p.id, p.parent_id, p.name, p.features, p.pay_redeem, ch.depth + 1 from categories p join chain ch on p.id = ch.parent_id)
            select id, name, features, pay_redeem, depth from chain order by depth
            """;

    private Profile resolve(JdbcClient.StatementSpec spec) {
        record Link(String id, String name, List<String> features, boolean payRedeem) {}
        List<Link> chain = spec.query((rs, i) -> {
            java.sql.Array f = rs.getArray("features");
            return new Link(rs.getString("id"), rs.getString("name"), f == null ? null : Arrays.asList((String[]) f.getArray()), rs.getBoolean("pay_redeem"));
        }).list();
        if (chain.isEmpty()) return new Profile(List.copyOf(ALL.keySet()), false, null, "", "");
        Link own = chain.get(0), top = chain.get(chain.size() - 1);
        for (Link l : chain) {
            // Keep the documented order whatever order the list was saved in.
            if (l.features() != null) return new Profile(ALL.keySet().stream().filter(l.features()::contains).toList(), true, own.id(), own.name(), top.name());
        }
        // Nothing set anywhere up the tree: everything, except bills and offers where the old "Pay & Redeem" switch is off.
        List<String> everything = new ArrayList<>(ALL.keySet());
        if (chain.stream().anyMatch(l -> !l.payRedeem())) everything.removeAll(List.of("bills", "offers"));
        return new Profile(everything, false, own.id(), own.name(), top.name());
    }

    public Profile forBusiness(UUID business) {
        return resolve(jdbc.sql(CHAIN.formatted("(select primary_category_id from businesses where id = :id)")).param("id", business));
    }

    public Profile forCategory(UUID category) {
        return resolve(jdbc.sql(CHAIN.formatted(":id")).param("id", category));
    }

    /** Checks a list sent by the admin: only known features, no repeats. Null (inherit) stays null. */
    public static List<String> clean(List<String> raw) {
        if (raw == null) return null;
        List<String> out = ALL.keySet().stream().filter(raw::contains).toList();
        if (out.size() != raw.stream().distinct().count()) throw in.vibe.backend.common.ApiException.badRequest("features", "Choose from: " + String.join(", ", ALL.keySet()) + ".");
        return out;
    }
}
