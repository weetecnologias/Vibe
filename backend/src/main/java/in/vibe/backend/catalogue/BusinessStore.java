package in.vibe.backend.catalogue;

import in.vibe.backend.audit.AuditService;
import in.vibe.backend.common.ApiException;
import in.vibe.backend.security.StaffPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Types;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/** Creating and editing businesses from the admin and merchant dashboards. */
@Service
public class BusinessStore {
    static final String HTTP_URL = Categories.HTTP_URL;

    public record Hour(@Min(0) @Max(6) int dow, @Pattern(regexp = "^([01]\\d|2[0-3]):[0-5]\\d$", message = "must be HH:mm") String opens,
                       @Pattern(regexp = "^([01]\\d|2[0-3]):[0-5]\\d$", message = "must be HH:mm") String closes) {}

    /** The profile a merchant may edit about their own place. */
    public record Profile(
            @NotBlank @Size(max = 120) String name,
            @NotBlank @Size(max = 80) String area,
            @Size(max = 300) String address,
            @DecimalMin("-90") @DecimalMax("90") Double lat,
            @DecimalMin("-180") @DecimalMax("180") Double lng,
            @Size(max = 2000) String description,
            @Pattern(regexp = HTTP_URL, message = "must be an http(s) link") String logoUrl,
            @Pattern(regexp = HTTP_URL, message = "must be an http(s) link") String coverUrl,
            @Min(1) @Max(4) Integer priceLevel,
            @Min(0) Long costForTwo,
            @Size(max = 10) List<@Size(max = 200) String> terms,
            Boolean bookingEnabled,
            @Size(max = 12) List<@Pattern(regexp = HTTP_URL, message = "must be an http(s) link") String> photos,
            @Size(max = 7) List<@Valid Hour> hours) {}

    /** What an admin sets: the profile plus categories and the flags only VIBE controls. */
    public record AdminInput(
            @NotBlank String primaryCategoryId,
            List<String> categoryIds,
            @Valid Profile profile,
            Boolean verified,
            Boolean isNew,
            Boolean active) {}

    public record Editable(String id, String name, String primaryCategoryId, List<String> categoryIds, String area, String address, Double lat, Double lng, String description,
                           String logoUrl, String coverUrl, int priceLevel, Long costForTwo, List<String> terms, boolean bookingEnabled, boolean verified, boolean isNew, boolean active,
                           List<String> photos, List<Hour> hours) {}

    public record ListRow(String id, String name, String primaryCategoryId, String categoryName, String area, boolean verified, boolean active, long merchantAccounts) {}

    public record ListPage(List<ListRow> items, int total) {}

    private final JdbcClient jdbc;
    private final AuditService audit;

    BusinessStore(JdbcClient jdbc, AuditService audit) {
        this.jdbc = jdbc;
        this.audit = audit;
    }

    public ListPage list(String q, int limit, int offset) { return list(q, limit, offset, ""); }

    /** scope: from AdminAccess.businessScope, so a category manager sees only their categories. */
    public ListPage list(String q, int limit, int offset, String scope) {
        String like = q == null || q.isBlank() ? null : "%" + q.trim().toLowerCase().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%";
        String where = " where true" + scope + (like == null ? "" : " and lower(b.name) like :q escape '\\'");
        JdbcClient.StatementSpec c = jdbc.sql("select count(*) from businesses b" + where);
        JdbcClient.StatementSpec s = jdbc.sql("select b.id, b.name, b.primary_category_id, c.name cname, b.area, b.verified, b.active, "
                + "(select count(*) from staff_users u where u.business_id = b.id and u.active) accounts from businesses b join categories c on c.id = b.primary_category_id"
                + where + " order by lower(b.name) limit :lim offset :off");
        if (like != null) { c.param("q", like); s.param("q", like); }
        int total = c.query(Integer.class).single();
        List<ListRow> items = s.param("lim", Math.min(Math.max(limit, 1), 100)).param("off", Math.max(offset, 0))
                .query((rs, i) -> new ListRow(rs.getString("id"), rs.getString("name"), rs.getString("primary_category_id"), rs.getString("cname"), rs.getString("area"),
                        rs.getBoolean("verified"), rs.getBoolean("active"), rs.getLong("accounts"))).list();
        return new ListPage(items, total);
    }

    public Editable get(UUID id) {
        return jdbc.sql("select * from businesses where id = :id").param("id", id).query((rs, i) -> {
            Object cost = rs.getObject("cost_for_two"), lat = rs.getObject("lat"), lng = rs.getObject("lng");
            java.sql.Array terms = rs.getArray("terms");
            return new Editable(rs.getString("id"), rs.getString("name"), rs.getString("primary_category_id"), categoryIds(id), rs.getString("area"), rs.getString("address"),
                    lat == null ? null : ((Number) lat).doubleValue(), lng == null ? null : ((Number) lng).doubleValue(), rs.getString("description"), rs.getString("logo_url"),
                    rs.getString("cover_url"), rs.getInt("price_level"), cost == null ? null : ((Number) cost).longValue(), terms == null ? List.of() : List.of((String[]) terms.getArray()),
                    rs.getBoolean("booking_enabled"), rs.getBoolean("verified"), rs.getBoolean("is_new"), rs.getBoolean("active"),
                    jdbc.sql("select url from business_photos where business_id = :id order by sort_order, id").param("id", id).query(String.class).list(),
                    jdbc.sql("select dow, opens, closes from business_hours where business_id = :id order by dow").param("id", id)
                            .query((h, j) -> new Hour(h.getInt("dow"), h.getTime("opens") == null ? null : h.getTime("opens").toLocalTime().toString().substring(0, 5),
                                    h.getTime("closes") == null ? null : h.getTime("closes").toLocalTime().toString().substring(0, 5))).list());
        }).optional().orElseThrow(() -> ApiException.notFound("Business not found."));
    }

    private List<String> categoryIds(UUID id) {
        return jdbc.sql("select category_id::text from business_categories where business_id = :id").param("id", id).query(String.class).list();
    }

    @Transactional
    public Editable create(StaffPrincipal who, AdminInput in) {
        if (in.profile() == null) throw ApiException.badRequest("validation", "profile is required");
        UUID id = UUID.randomUUID();
        UUID primary = categoryId(in.primaryCategoryId());
        jdbc.sql("insert into businesses (id, name, primary_category_id, area) values (:id, :n, :c, :a)").param("id", id).param("n", in.profile().name().trim()).param("c", primary)
                .param("a", in.profile().area().trim()).update();
        applyProfile(id, in.profile());
        applyAdminFields(id, in, primary);
        audit.record(who, "create", "business", id, in.profile().name());
        return get(id);
    }

    @Transactional
    public Editable adminUpdate(StaffPrincipal who, UUID id, AdminInput in) {
        get(id);
        if (in.profile() == null) throw ApiException.badRequest("validation", "profile is required");
        applyProfile(id, in.profile());
        applyAdminFields(id, in, categoryId(in.primaryCategoryId()));
        audit.record(who, "update", "business", id, in.profile().name());
        return get(id);
    }

    /** A merchant changes only their own profile. Categories, verification and visibility stay with VIBE. */
    @Transactional
    public Editable merchantUpdate(StaffPrincipal who, Profile p) {
        UUID id = who.requireBusiness();
        get(id);
        applyProfile(id, p);
        audit.record(who, "update", "business", id, p.name());
        return get(id);
    }

    private void applyProfile(UUID id, Profile p) {
        jdbc.sql("update businesses set name = :n, area = :a, address = :ad, lat = :lat, lng = :lng, description = :d, logo_url = :logo, cover_url = :cover, "
                        + "price_level = :pl, cost_for_two = :cft, terms = :terms, booking_enabled = :bk, updated_at = now() where id = :id")
                .param("id", id).param("n", p.name().trim()).param("a", p.area().trim()).param("ad", p.address() == null ? "" : p.address().trim())
                .param("lat", p.lat(), Types.DOUBLE).param("lng", p.lng(), Types.DOUBLE).param("d", p.description() == null ? "" : p.description().trim())
                .param("logo", blank(p.logoUrl())).param("cover", blank(p.coverUrl())).param("pl", p.priceLevel() == null ? 2 : p.priceLevel())
                .param("cft", p.costForTwo(), Types.BIGINT).param("terms", (p.terms() == null ? List.<String>of() : p.terms()).toArray(new String[0]))
                .param("bk", p.bookingEnabled() != null && p.bookingEnabled()).update();
        if (p.photos() != null) {
            jdbc.sql("delete from business_photos where business_id = :id").param("id", id).update();
            int n = 0;
            for (String url : p.photos()) {
                jdbc.sql("insert into business_photos (id, business_id, url, sort_order) values (:i, :b, :u, :o)").param("i", UUID.randomUUID()).param("b", id).param("u", url).param("o", n++).update();
            }
        }
        if (p.hours() != null) {
            jdbc.sql("delete from business_hours where business_id = :id").param("id", id).update();
            List<Integer> seen = new ArrayList<>();
            for (Hour h : p.hours()) {
                if (seen.contains(h.dow())) throw ApiException.badRequest("hours", "Each day can appear only once.");
                seen.add(h.dow());
                if ((h.opens() == null) != (h.closes() == null)) throw ApiException.badRequest("hours", "Give both an opening and a closing time, or neither for a closed day.");
                jdbc.sql("insert into business_hours (business_id, dow, opens, closes) values (:b, :d, :o, :c)").param("b", id).param("d", h.dow())
                        .param("o", h.opens() == null ? null : LocalTime.parse(h.opens()), Types.TIME).param("c", h.closes() == null ? null : LocalTime.parse(h.closes()), Types.TIME).update();
            }
        }
    }

    private void applyAdminFields(UUID id, AdminInput in, UUID primary) {
        jdbc.sql("update businesses set primary_category_id = :c, verified = :v, is_new = :n, active = :a where id = :id").param("id", id).param("c", primary)
                .param("v", in.verified() != null && in.verified()).param("n", in.isNew() != null && in.isNew()).param("a", in.active() == null || in.active()).update();
        List<UUID> ids = new ArrayList<>();
        ids.add(primary);
        if (in.categoryIds() != null) for (String c : in.categoryIds()) { UUID u = categoryId(c); if (!ids.contains(u)) ids.add(u); }
        jdbc.sql("delete from business_categories where business_id = :id").param("id", id).update();
        for (UUID c : ids) jdbc.sql("insert into business_categories (business_id, category_id) values (:b, :c)").param("b", id).param("c", c).update();
    }

    private UUID categoryId(String raw) {
        UUID id;
        try { id = UUID.fromString(raw); } catch (RuntimeException e) { throw ApiException.badRequest("category", "Choose a valid category."); }
        if (jdbc.sql("select count(*) from categories where id = :id").param("id", id).query(Integer.class).single() == 0) throw ApiException.badRequest("category", "That category doesn’t exist.");
        return id;
    }

    private static String blank(String s) { return s == null || s.isBlank() ? null : s.trim(); }
}
