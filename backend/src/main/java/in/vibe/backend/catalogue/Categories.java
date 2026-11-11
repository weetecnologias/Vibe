package in.vibe.backend.catalogue;

import in.vibe.backend.audit.AuditService;
import in.vibe.backend.common.ApiException;
import in.vibe.backend.security.StaffPrincipal;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The category tree. Depth is data, not code: an admin adds categories and the customer app shows them on its next load.
 * The tree is limited to 3 levels (category, subcategory, sub-subcategory), which is what the app's menus are designed for.
 */
@Service
public class Categories {
    public static final int MAX_LEVEL = 3;
    static final String HTTP_URL = "^https?://\\S+$";

    /** What the customer app receives. `icon` is a built-in icon name; `iconUrl` (an uploaded SVG or PNG) wins when set. */
    public record Node(String id, String slug, String name, String icon, String iconUrl, String imageUrl, List<Node> children) {}

    /** The admin's flat view, including inactive categories. */
    public record Row(String id, String parentId, int level, String slug, String name, String icon, String iconUrl, String imageUrl, int sortOrder, boolean active, int businessCount, boolean payRedeem, String menuLabel) {}

    public record Input(
            String parentId,
            @NotBlank @Size(max = 80) @Pattern(regexp = "^[a-z0-9]+([.-][a-z0-9]+)*$", message = "must be lower-case letters, numbers, dots or dashes") String slug,
            @NotBlank @Size(max = 80) String name,
            @Size(max = 40) String icon,
            @Pattern(regexp = HTTP_URL, message = "must be an http(s) link") String iconUrl,
            @Pattern(regexp = HTTP_URL, message = "must be an http(s) link") String imageUrl,
            @Min(0) Integer sortOrder,
            Boolean active,
            /** Whether businesses here use Pay & Redeem bills. Off for cinemas and event organisers. Default on. */
            Boolean payRedeem,
            /** What the item list is called: Menu, Price list, Services. Empty means the parent's, or Menu. */
            @Size(max = 30) String menuLabel) {}

    private final JdbcClient jdbc;
    private final AuditService audit;

    Categories(JdbcClient jdbc, AuditService audit) {
        this.jdbc = jdbc;
        this.audit = audit;
    }

    private record Flat(UUID id, UUID parentId, String slug, String name, String icon, String iconUrl, String imageUrl, int sortOrder, boolean active, boolean payRedeem, String menuLabel) {}

    private List<Flat> flat(boolean activeOnly) {
        return jdbc.sql("select id, parent_id, slug, name, icon, icon_url, image_url, sort_order, active, pay_redeem, menu_label from categories "
                        + (activeOnly ? "where active " : "") + "order by sort_order, name")
                .query((rs, i) -> new Flat((UUID) rs.getObject("id"), (UUID) rs.getObject("parent_id"), rs.getString("slug"), rs.getString("name"),
                        rs.getString("icon"), rs.getString("icon_url"), rs.getString("image_url"), rs.getInt("sort_order"), rs.getBoolean("active"), rs.getBoolean("pay_redeem"), rs.getString("menu_label")))
                .list();
    }

    /** Public tree of active categories. A category under an inactive parent is hidden with it. */
    public List<Node> tree() {
        List<Flat> all = flat(true);
        Map<UUID, List<Flat>> byParent = new HashMap<>();
        for (Flat f : all) byParent.computeIfAbsent(f.parentId(), k -> new ArrayList<>()).add(f);
        return build(null, byParent);
    }

    private List<Node> build(UUID parent, Map<UUID, List<Flat>> byParent) {
        List<Node> out = new ArrayList<>();
        for (Flat f : byParent.getOrDefault(parent, List.of())) {
            out.add(new Node(f.id().toString(), f.slug(), f.name(), f.icon(), f.iconUrl(), f.imageUrl(), build(f.id(), byParent)));
        }
        return out;
    }

    public List<Row> adminList() {
        List<Flat> all = flat(false);
        Map<UUID, Flat> byId = new HashMap<>();
        all.forEach(f -> byId.put(f.id(), f));
        Map<UUID, Integer> counts = new HashMap<>();
        jdbc.sql("select category_id, count(*) n from business_categories group by category_id")
                .query((rs, i) -> { counts.put((UUID) rs.getObject(1), rs.getInt(2)); return 0; }).list();
        return all.stream().map(f -> new Row(f.id().toString(), f.parentId() == null ? null : f.parentId().toString(), levelOf(f.id(), byId), f.slug(), f.name(),
                f.icon(), f.iconUrl(), f.imageUrl(), f.sortOrder(), f.active(), counts.getOrDefault(f.id(), 0), f.payRedeem(), f.menuLabel())).toList();
    }

    private static int levelOf(UUID id, Map<UUID, Flat> byId) {
        int level = 1;
        for (Flat f = byId.get(id); f != null && f.parentId() != null; f = byId.get(f.parentId())) level++;
        return level;
    }

    @Transactional
    public Row create(StaffPrincipal who, Input in) {
        UUID parent = parse(in.parentId());
        checkDepth(parent, null);
        UUID id = UUID.randomUUID();
        jdbc.sql("insert into categories (id, parent_id, slug, name, icon, icon_url, image_url, sort_order, active, pay_redeem, menu_label) values (:id, :p, :s, :n, :i, :iu, :im, :o, :a, :pr, :ml)")
                .param("id", id).param("p", parent, java.sql.Types.OTHER).param("s", in.slug()).param("n", in.name().trim()).param("i", blank(in.icon()))
                .param("iu", blank(in.iconUrl())).param("im", blank(in.imageUrl())).param("o", in.sortOrder() == null ? 0 : in.sortOrder())
                .param("a", in.active() == null || in.active()).param("pr", in.payRedeem() == null || in.payRedeem()).param("ml", blank(in.menuLabel())).update();
        audit.record(who, "create", "category", id, in.slug());
        return row(id);
    }

    @Transactional
    public Row update(StaffPrincipal who, UUID id, Input in) {
        row(id);
        UUID parent = parse(in.parentId());
        checkDepth(parent, id);
        jdbc.sql("update categories set parent_id = :p, slug = :s, name = :n, icon = :i, icon_url = :iu, image_url = :im, sort_order = :o, active = :a, pay_redeem = :pr, menu_label = :ml, updated_at = now() where id = :id")
                .param("id", id).param("p", parent, java.sql.Types.OTHER).param("s", in.slug()).param("n", in.name().trim()).param("i", blank(in.icon()))
                .param("iu", blank(in.iconUrl())).param("im", blank(in.imageUrl())).param("o", in.sortOrder() == null ? 0 : in.sortOrder())
                .param("a", in.active() == null || in.active()).param("pr", in.payRedeem() == null || in.payRedeem()).param("ml", blank(in.menuLabel())).update();
        audit.record(who, "update", "category", id, in.slug());
        return row(id);
    }

    /** Only an unused category can be deleted. Otherwise switch it off (inactive), which hides it without losing anything. */
    @Transactional
    public void delete(StaffPrincipal who, UUID id) {
        Row r = row(id);
        if (jdbc.sql("select count(*) from categories where parent_id = :id").param("id", id).query(Integer.class).single() > 0) {
            throw ApiException.conflict("has_children", "This category has subcategories. Move or delete them first, or switch it off instead.");
        }
        if (r.businessCount() > 0 || jdbc.sql("select count(*) from businesses where primary_category_id = :id").param("id", id).query(Integer.class).single() > 0) {
            throw ApiException.conflict("in_use", "Businesses use this category. Switch it off instead of deleting it.");
        }
        jdbc.sql("delete from categories where id = :id").param("id", id).update();
        audit.record(who, "delete", "category", id, r.slug());
    }

    public Row row(UUID id) {
        return adminList().stream().filter(r -> r.id().equals(id.toString())).findFirst().orElseThrow(() -> ApiException.notFound("Category not found."));
    }

    /** The new parent must exist, can't be the category itself or one of its descendants, and the whole subtree must still fit in 3 levels. */
    private void checkDepth(UUID parent, UUID self) {
        List<Flat> all = flat(false);
        Map<UUID, Flat> byId = new HashMap<>();
        all.forEach(f -> byId.put(f.id(), f));
        int parentLevel = 0;
        if (parent != null) {
            if (!byId.containsKey(parent)) throw ApiException.badRequest("parent", "That parent category doesn’t exist.");
            for (UUID p = parent; p != null; p = byId.get(p).parentId()) {
                if (p.equals(self)) throw ApiException.badRequest("cycle", "A category can’t sit inside itself.");
            }
            parentLevel = levelOf(parent, byId);
        }
        int below = self == null ? 0 : subtreeHeight(self, all);
        if (parentLevel + 1 + below > MAX_LEVEL) {
            throw ApiException.badRequest("too_deep", "Categories can go " + MAX_LEVEL + " levels deep: category, subcategory, sub-subcategory.");
        }
    }

    private static int subtreeHeight(UUID id, List<Flat> all) {
        int h = 0;
        for (Flat f : all) if (id.equals(f.parentId())) h = Math.max(h, 1 + subtreeHeight(f.id(), all));
        return h;
    }

    private static UUID parse(String id) {
        if (id == null || id.isBlank()) return null;
        try { return UUID.fromString(id); } catch (IllegalArgumentException e) { throw ApiException.badRequest("parent", "That parent category isn’t valid."); }
    }

    private static String blank(String s) { return s == null || s.isBlank() ? null : s.trim(); }
}
