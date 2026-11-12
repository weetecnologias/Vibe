package in.vibe.backend.backoffice;

import in.vibe.backend.audit.AuditService;
import in.vibe.backend.common.ApiException;
import in.vibe.backend.security.AdminAccess;
import in.vibe.backend.security.StaffPrincipal;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * VIBE's own team: super admins, admins (CEO level) and staff with chosen areas and, optionally, chosen categories (category managers).
 * A super admin manages everyone. An admin manages staff accounts only. Nobody changes their own role, and the last super admin stays.
 */
@Service
public class AdminTeam {
    public static final List<String> ROLES = List.of("super_admin", "admin", "staff");

    public record CategoryRef(String id, String name) {}

    /** What the signed-in person may do, for the dashboard's menu. allAreas: every area with its description, for the team page. */
    public record Me(String id, String name, String email, String role, List<String> areas, List<CategoryRef> categories, Map<String, String> allAreas) {}

    public record Member(String id, String email, String name, String role, List<String> areas, List<CategoryRef> categories, boolean active, boolean mustChangePassword, OffsetDateTime createdAt) {}

    public record NewMember(@NotBlank @Email @Size(max = 200) String email, @NotBlank @Size(max = 120) String name, @NotBlank @Size(min = StaffService.MIN_PASSWORD, max = 100) String password,
                            @NotBlank String role, List<String> areas, List<String> categoryIds) {}

    public record AccessInput(@NotBlank String role, List<String> areas, List<String> categoryIds) {}

    private final JdbcClient jdbc;
    private final AdminAccess access;
    private final PasswordEncoder encoder;
    private final AuditService audit;

    AdminTeam(JdbcClient jdbc, AdminAccess access, PasswordEncoder encoder, AuditService audit) {
        this.jdbc = jdbc;
        this.access = access;
        this.encoder = encoder;
        this.audit = audit;
    }

    private List<CategoryRef> names(List<UUID> ids) {
        if (ids.isEmpty()) return List.of();
        Map<String, String> byId = new java.util.HashMap<>();
        jdbc.sql("select id, name from categories where id in (:ids)").param("ids", ids).query((rs, i) -> byId.put(rs.getString(1), rs.getString(2))).list();
        return ids.stream().map(u -> new CategoryRef(u.toString(), byId.getOrDefault(u.toString(), "Removed category"))).toList();
    }

    public Me me(StaffPrincipal who) {
        AdminAccess.Access a = access.access(who);
        if (!a.signedIn()) throw ApiException.forbidden("Please sign in.");
        return jdbc.sql("select name, email from staff_users where id = :id").param("id", who.id())
                .query((rs, i) -> new Me(who.id().toString(), rs.getString(1), rs.getString(2), a.role(), a.full() ? List.copyOf(AdminAccess.AREAS.keySet()) : a.areas(), names(a.categoryIds()), AdminAccess.AREAS)).single();
    }

    private Member member(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new Member(rs.getString("id"), rs.getString("email"), rs.getString("name"), rs.getString("admin_role"), List.of((String[]) rs.getArray("admin_areas").getArray()),
                names(Arrays.asList((UUID[]) rs.getArray("admin_category_ids").getArray())), rs.getBoolean("active"), rs.getBoolean("must_change_password"), rs.getObject("created_at", OffsetDateTime.class));
    }

    public List<Member> list() {
        return jdbc.sql("select * from staff_users where role = 'ADMIN' order by array_position(array['super_admin', 'admin', 'staff'], admin_role), lower(name)").query((rs, i) -> member(rs)).list();
    }

    private Member one(UUID id) {
        return jdbc.sql("select * from staff_users where id = :id and role = 'ADMIN'").param("id", id).query((rs, i) -> member(rs)).optional().orElseThrow(() -> ApiException.notFound("Account not found."));
    }

    /** Checks the role, areas and categories sent, and that this person may hand out that role. Returns [role, areas, categories]. */
    private Object[] check(StaffPrincipal who, String role, List<String> areas, List<String> categoryIds) {
        if (!ROLES.contains(role)) throw ApiException.badRequest("role", "Choose super admin, admin or staff.");
        AdminAccess.Access me = access.access(who);
        if (!"super_admin".equals(me.role()) && !"staff".equals(role)) throw ApiException.forbidden("Only a super admin can make someone an admin or super admin.");
        List<String> a = "staff".equals(role) ? AdminAccess.AREAS.keySet().stream().filter(k -> areas != null && areas.contains(k)).toList() : List.of();
        if ("staff".equals(role) && a.isEmpty()) throw ApiException.badRequest("areas", "Tick at least one area for a staff account.");
        if (areas != null && "staff".equals(role) && a.size() != areas.stream().distinct().count()) throw ApiException.badRequest("areas", "Choose from: " + String.join(", ", AdminAccess.AREAS.keySet()) + ".");
        List<UUID> cats = new ArrayList<>();
        if ("staff".equals(role) && categoryIds != null) {
            for (String c : categoryIds) {
                UUID id;
                try { id = UUID.fromString(c); } catch (RuntimeException e) { throw ApiException.badRequest("categories", "Choose categories from the list."); }
                if (jdbc.sql("select count(*) from categories where id = :id").param("id", id).query(Integer.class).single() == 0) throw ApiException.badRequest("categories", "Choose categories from the list.");
                if (!cats.contains(id)) cats.add(id);
            }
        }
        return new Object[]{role, a, cats};
    }

    @Transactional
    public Member add(StaffPrincipal who, NewMember in) {
        Object[] c = check(who, in.role(), in.areas(), in.categoryIds());
        String email = in.email().trim().toLowerCase(Locale.ROOT);
        if (jdbc.sql("select count(*) from staff_users where email = :e").param("e", email).query(Integer.class).single() > 0) throw ApiException.conflict("email_taken", "Someone already signs in with that email.");
        UUID id = UUID.randomUUID();
        @SuppressWarnings("unchecked") List<String> areas = (List<String>) c[1];
        @SuppressWarnings("unchecked") List<UUID> cats = (List<UUID>) c[2];
        jdbc.sql("insert into staff_users (id, email, name, password_hash, role, admin_role, admin_areas, admin_category_ids, must_change_password) values (:id, :e, :n, :h, 'ADMIN', :r, :a, :c, true)")
                .param("id", id).param("e", email).param("n", in.name().trim()).param("h", encoder.encode(in.password())).param("r", c[0])
                .param("a", areas.toArray(new String[0]), java.sql.Types.ARRAY).param("c", cats.toArray(new UUID[0]), java.sql.Types.ARRAY).update();
        audit.record(who, "create", "admin", id, email + " as " + c[0] + (areas.isEmpty() ? "" : " · " + String.join(", ", areas)));
        return one(id);
    }

    @Transactional
    public Member update(StaffPrincipal who, UUID id, AccessInput in) {
        if (id.equals(who.id())) throw ApiException.conflict("self", "You can’t change your own access. Ask another super admin.");
        Member before = one(id);
        guard(who, before);
        Object[] c = check(who, in.role(), in.areas(), in.categoryIds());
        if ("super_admin".equals(before.role()) && !"super_admin".equals(c[0]) && superAdmins() <= 1) throw ApiException.conflict("last_super_admin", "VIBE needs at least one super admin.");
        @SuppressWarnings("unchecked") List<String> areas = (List<String>) c[1];
        @SuppressWarnings("unchecked") List<UUID> cats = (List<UUID>) c[2];
        jdbc.sql("update staff_users set admin_role = :r, admin_areas = :a, admin_category_ids = :c where id = :id").param("id", id).param("r", c[0])
                .param("a", areas.toArray(new String[0]), java.sql.Types.ARRAY).param("c", cats.toArray(new UUID[0]), java.sql.Types.ARRAY).update();
        audit.record(who, "update_access", "admin", id, before.email() + ": " + c[0] + (areas.isEmpty() ? "" : " · " + String.join(", ", areas)));
        return one(id);
    }

    private int superAdmins() {
        return jdbc.sql("select count(*) from staff_users where role = 'ADMIN' and admin_role = 'super_admin' and active").query(Integer.class).single();
    }

    /** An admin may only manage staff accounts; a super admin may manage anyone. Used for switching off and password resets too. */
    void guard(StaffPrincipal who, Member target) {
        AdminAccess.Access me = access.access(who);
        if (!"super_admin".equals(me.role()) && !"staff".equals(target.role())) throw ApiException.forbidden("Only a super admin can change another admin’s account.");
    }

    /** Called before switching off or resetting any staff_users row from the admin dashboard. Merchant logins aren't affected. */
    public void guardAccount(StaffPrincipal who, UUID id, boolean deactivating) {
        Member target = jdbc.sql("select * from staff_users where id = :id and role = 'ADMIN'").param("id", id).query((rs, i) -> member(rs)).optional().orElse(null);
        if (target == null) return;
        guard(who, target);
        if (deactivating && "super_admin".equals(target.role()) && superAdmins() <= 1) throw ApiException.conflict("last_super_admin", "VIBE needs at least one super admin.");
    }
}
