package in.vibe.backend.security;

import in.vibe.backend.common.ApiException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Who in VIBE's own team may do what. Three levels:
 * super_admin: everything, including every admin account. admin (CEO level): everything, and staff accounts, but not other admins.
 * staff: only the areas ticked for them, and, when categories are chosen, only businesses in those categories (a category manager).
 * Read from the database on every request, so a change applies at once and a switched-off account is signed out on its next click.
 */
@Service
public class AdminAccess {
    /** The parts of the admin dashboard, in nav order. A staff account gets only the ones ticked. */
    public static final Map<String, String> AREAS = areas();

    private static Map<String, String> areas() {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("reports", "Overview and reports: numbers by category, members and money, with Excel downloads");
        m.put("partners", "Partners: applications and businesses");
        m.put("content", "Reviews: offers, promotions, events and customer reviews");
        m.put("customers", "Customers and members, and deletion requests");
        m.put("money", "Money: transactions, refunds and settlements");
        m.put("catalogue", "Catalogue: categories, home screen, membership plans and coupons");
        m.put("audit", "Audit log");
        return m;
    }

    /** categoryIds empty means every category. */
    public record Access(boolean signedIn, String role, List<String> areas, List<UUID> categoryIds) {
        public boolean full() { return "super_admin".equals(role) || "admin".equals(role); }
        public boolean can(String area) { return full() || areas.contains(area); }
        public boolean scoped() { return !full() && !categoryIds.isEmpty(); }
    }

    private final JdbcClient jdbc;

    AdminAccess(JdbcClient jdbc) { this.jdbc = jdbc; }

    public Access access(StaffPrincipal who) {
        return jdbc.sql("select admin_role, admin_areas, admin_category_ids from staff_users where id = :id and role = 'ADMIN' and active").param("id", who.id())
                .query((rs, i) -> new Access(true, rs.getString(1), List.of((String[]) rs.getArray(2).getArray()), Arrays.asList((UUID[]) rs.getArray(3).getArray())))
                .optional().orElse(new Access(false, null, List.of(), List.of()));
    }

    /** The area an admin request needs; "team" is the team page (super admin and admin only); null is open to every admin. Unknown paths need a full admin. */
    static String areaFor(String path) {
        String p = path.substring("/v1/admin".length());
        if (p.startsWith("/access")) return null;
        if (p.startsWith("/overview") || p.startsWith("/reports")) return "reports";
        if (p.contains("/adjustments") || p.startsWith("/rate-cards") || p.startsWith("/ledger") || p.startsWith("/reconciliation") || p.startsWith("/disputes")) return "money";
        if (p.startsWith("/applications") || p.startsWith("/businesses") || p.startsWith("/kyc") || p.startsWith("/agreements")) return "partners";
        if (p.startsWith("/offers") || p.startsWith("/promotions") || p.startsWith("/events") || p.startsWith("/reviews")) return "content";
        if (p.startsWith("/customers") || p.startsWith("/members") || p.startsWith("/deletion-requests") || p.startsWith("/exports/members") || p.startsWith("/exports/customers")) return "customers";
        if (p.startsWith("/transactions") || p.startsWith("/settlements") || p.startsWith("/refunds") || p.startsWith("/exports")) return "money";
        if (p.startsWith("/categories") || p.startsWith("/home") || p.startsWith("/plans") || p.startsWith("/coupons")) return "catalogue";
        if (p.startsWith("/audit")) return "audit";
        if (p.startsWith("/staff") || p.startsWith("/team")) return "team";
        return "full";
    }

    // ---------- category managers ----------
    /**
     * SQL that keeps only rows whose business is in this person's categories (or below them). Empty for anyone not limited to categories.
     * The ids are inlined: they come from the database as UUIDs, never from the request.
     */
    public String businessScope(StaffPrincipal who, String businessIdColumn) {
        Access a = access(who);
        if (!a.scoped()) return "";
        return " and " + businessIdColumn + " in (select bc.business_id from business_categories bc where bc.category_id in (" + tree(a.categoryIds()) + "))";
    }

    /** The same for a category column (applications carry a category, not yet a business). */
    public String categoryScope(StaffPrincipal who, String categoryIdColumn) {
        Access a = access(who);
        if (!a.scoped()) return "";
        return " and " + categoryIdColumn + " in (" + tree(a.categoryIds()) + ")";
    }

    private static String tree(List<UUID> ids) {
        String list = String.join(", ", ids.stream().map(u -> "'" + u + "'::uuid").toList());
        return "with recursive t as (select id from categories where id in (" + list + ") union all select c.id from categories c join t on c.parent_id = t.id) select id from t";
    }

    /** Refuses an action on a business outside this person's categories. */
    public void requireBusiness(StaffPrincipal who, UUID business) {
        String scope = businessScope(who, "b.id");
        if (scope.isEmpty()) return;
        if (jdbc.sql("select count(*) from businesses b where b.id = :b" + scope).param("b", business).query(Integer.class).single() == 0) {
            throw ApiException.forbidden("This business is outside the categories you look after.");
        }
    }

    /** Refuses an action on something in a category outside this person's categories. A missing category counts as outside. */
    public void requireCategory(StaffPrincipal who, UUID category) {
        String scope = categoryScope(who, "c.id");
        if (scope.isEmpty()) return;
        if (category == null || jdbc.sql("select count(*) from categories c where c.id = :c" + scope).param("c", category).query(Integer.class).single() == 0) {
            throw ApiException.forbidden("This is outside the categories you look after.");
        }
    }
}
