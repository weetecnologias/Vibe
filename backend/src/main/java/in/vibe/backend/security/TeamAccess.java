package in.vibe.backend.security;

import in.vibe.backend.common.ApiException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * What each person on a merchant's team may do. The owner may do everything. Everyone else has a role the owner chose:
 * a manager runs the place (everything except the team), a cashier or waiter handles bills only, or a custom set of areas.
 * Read from the database on every request, so a change by the owner applies at once, without signing anyone out.
 */
@Service
public class TeamAccess {
    /** The areas of the merchant dashboard, in the order they are shown. The team itself is the owner's alone. */
    public static final Map<String, String> AREAS = areas();
    public static final List<String> MANAGER = List.of("bills", "offers", "events", "menu", "profile", "reservations", "money");
    public static final List<String> CASHIER = List.of("bills");

    /** Which area each staff alert belongs to, so a cashier sees bill alerts and not settlements. Kinds not listed are shown to everyone. */
    static final Map<String, String> ALERT_AREA = Map.of(
            "redeem_started", "bills", "redeem_cancelled", "bills", "payment_received", "bills",
            "offer_decision", "offers", "auto_approve", "offers", "event_decision", "events",
            "settlement_created", "money", "settlement_paid", "money", "tickets_sold", "events", "review_received", "profile");

    /** signedIn is false when the login no longer exists or the owner switched it off: the person must be signed out. */
    public record Access(boolean signedIn, boolean owner, String staffRole, List<String> permissions) {
        public boolean can(String area) { return owner || permissions.contains(area); }
    }

    private static Map<String, String> areas() {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("bills", "Bills: see waiting customers, raise and withdraw bills");
        m.put("offers", "Offers: create, change, stop and delete");
        m.put("events", "Events: create, change and cancel");
        m.put("menu", "Menu or price list: change items");
        m.put("profile", "Profile and photos");
        m.put("reservations", "Reservation fees and policy");
        m.put("money", "Results and settlements");
        return java.util.Collections.unmodifiableMap(m);
    }

    private final JdbcClient jdbc;

    TeamAccess(JdbcClient jdbc) { this.jdbc = jdbc; }

    public Access access(StaffPrincipal who) {
        if (!"MERCHANT".equals(who.role())) return new Access(true, false, null, List.of());
        return jdbc.sql("select owner, staff_role, permissions from staff_users where id = :id and active").param("id", who.id())
                .query((rs, i) -> {
                    boolean owner = rs.getBoolean("owner");
                    java.sql.Array a = rs.getArray("permissions");
                    List<String> p = a == null ? List.of() : Arrays.asList((String[]) a.getArray());
                    return new Access(true, owner, owner ? null : rs.getString("staff_role"), owner ? List.copyOf(AREAS.keySet()) : p);
                }).optional().orElse(new Access(false, false, null, List.of()));
    }

    public void require(StaffPrincipal who, String area) {
        if (!access(who).can(area)) throw ApiException.forbidden("Your role doesn’t include " + AREAS.getOrDefault(area, area).split(":")[0].toLowerCase() + ". Ask the owner if you need it.");
    }

    /** Alert kinds this person should not see. */
    public List<String> hiddenAlertKinds(StaffPrincipal who) {
        Access a = access(who);
        if (!"MERCHANT".equals(who.role()) || a.owner()) return List.of();
        return ALERT_AREA.entrySet().stream().filter(e -> !a.can(e.getValue())).map(Map.Entry::getKey).sorted().toList();
    }

    /** Turns the owner's choice into the stored areas. A preset always means the same areas; a custom role needs at least one known area. */
    public static List<String> permissionsFor(String staffRole, List<String> chosen) {
        return switch (staffRole == null ? "" : staffRole) {
            case "manager" -> MANAGER;
            case "cashier" -> CASHIER;
            case "custom" -> {
                List<String> p = chosen == null ? List.of() : chosen.stream().distinct().toList();
                if (p.isEmpty()) throw ApiException.badRequest("permissions_required", "Choose at least one area for a custom role.");
                Set<String> unknown = new java.util.TreeSet<>(p);
                unknown.removeAll(AREAS.keySet());
                if (!unknown.isEmpty()) throw ApiException.badRequest("unknown_area", "Unknown area: " + String.join(", ", unknown) + ".");
                yield AREAS.keySet().stream().filter(p::contains).toList();
            }
            default -> throw ApiException.badRequest("role_required", "Choose a role: manager, cashier or custom.");
        };
    }

    /** The area a merchant request belongs to, or null when anyone on the team may make it. `team` means the owner only. */
    static String areaFor(String method, String path) {
        String p = path.substring("/v1/merchant".length());
        if (p.startsWith("/bills")) return "bills";
        if (p.startsWith("/menu")) return "GET".equals(method) ? "bills|menu" : "menu"; // staff raising a bill pick items from the menu
        if (p.startsWith("/offers")) return "offers";
        if (p.startsWith("/events")) return "events";
        if (p.startsWith("/business") || p.startsWith("/reviews")) return "profile";
        if (p.startsWith("/reservation-settings")) return "reservations";
        if (p.startsWith("/settlements") || p.startsWith("/results")) return "money";
        if (p.startsWith("/team")) return "team";
        return null;
    }
}
