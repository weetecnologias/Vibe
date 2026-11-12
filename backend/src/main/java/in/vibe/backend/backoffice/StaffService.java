package in.vibe.backend.backoffice;

import in.vibe.backend.audit.AuditService;
import in.vibe.backend.common.ApiException;
import in.vibe.backend.security.JwtService;
import in.vibe.backend.security.StaffPrincipal;
import in.vibe.backend.security.TeamAccess;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/** Admin and merchant accounts: sign-in, creation, and switching accounts off. */
@Service
public class StaffService {
    public static final int MIN_PASSWORD = 10;
    private static final int MAX_FAILURES = 5;
    private static final long WINDOW_MS = 15 * 60_000L;

    public record Login(@NotBlank @Email String email, @NotBlank String password) {}

    public record NewMerchant(@NotBlank @Email @Size(max = 200) String email, @NotBlank @Size(max = 120) String name, @NotBlank @Size(min = MIN_PASSWORD, max = 100) String password) {}

    public record PasswordChange(@NotBlank String current, @NotBlank @Size(min = MIN_PASSWORD, max = 100) String next) {}

    public record PasswordReset(@NotBlank @Size(min = MIN_PASSWORD, max = 100) String password) {}

    /** owner: the first login for a business. Only an owner can add and manage the rest of the team. */
    public record Staff(String id, String email, String name, String role, String businessId, boolean active, boolean owner, boolean mustChangePassword) {}

    public record Session(String token, Instant expiresAt, Staff staff) {}

    /** A person on a merchant's team, with the role the owner gave them. The owner has every area. */
    public record TeamMember(String id, String email, String name, boolean active, boolean owner, boolean mustChangePassword, String staffRole, List<String> permissions) {}

    public record TeamInput(@NotBlank @Email @Size(max = 200) String email, @NotBlank @Size(max = 120) String name, @NotBlank @Size(min = MIN_PASSWORD, max = 100) String password,
                            @NotBlank String staffRole, List<String> permissions) {}

    public record AccessInput(@NotBlank String staffRole, List<String> permissions) {}

    private final JdbcClient jdbc;
    private final PasswordEncoder encoder;
    private final JwtService jwt;
    private final AuditService audit;
    private final Clock clock;
    // In memory is enough for one instance. Move to Redis before running more than one.
    private final Map<String, Deque<Long>> failures = new ConcurrentHashMap<>();
    private final String dummyHash;

    StaffService(JdbcClient jdbc, PasswordEncoder encoder, JwtService jwt, AuditService audit, Clock clock) {
        this.jdbc = jdbc;
        this.encoder = encoder;
        this.jwt = jwt;
        this.audit = audit;
        this.clock = clock;
        this.dummyHash = encoder.encode("not-a-real-password");
    }

    private record Row(UUID id, String email, String name, String hash, String role, UUID businessId, boolean active, boolean owner, boolean mustChange) {}

    private java.util.Optional<Row> byEmail(String email) {
        return jdbc.sql("select * from staff_users where email = :e").param("e", email)
                .query((rs, i) -> new Row((UUID) rs.getObject("id"), rs.getString("email"), rs.getString("name"), rs.getString("password_hash"), rs.getString("role"),
                        (UUID) rs.getObject("business_id"), rs.getBoolean("active"), rs.getBoolean("owner"), rs.getBoolean("must_change_password"))).optional();
    }

    public Session login(String rawEmail, String password) {
        String email = rawEmail.trim().toLowerCase(Locale.ROOT);
        long now = clock.millis();
        Deque<Long> recent = failures.computeIfAbsent(email, k -> new ArrayDeque<>());
        synchronized (recent) {
            while (!recent.isEmpty() && now - recent.peekFirst() > WINDOW_MS) recent.pollFirst();
            if (recent.size() >= MAX_FAILURES) throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "too_many_attempts", "Too many attempts. Try again in a few minutes.");
        }
        Row row = byEmail(email).orElse(null);
        // Always check a hash, so a wrong email and a wrong password take the same time.
        boolean ok = encoder.matches(password, row == null ? dummyHash : row.hash()) && row != null && row.active();
        if (!ok) {
            synchronized (recent) { recent.addLast(now); }
            throw new ApiException(HttpStatus.UNAUTHORIZED, "bad_credentials", "That email and password don’t match.");
        }
        failures.remove(email);
        JwtService.Issued token = jwt.issue(row.id(), row.role(), row.businessId(), row.mustChange());
        return new Session(token.token(), token.expiresAt(), view(row));
    }

    public Staff me(StaffPrincipal who) {
        return jdbc.sql("select * from staff_users where id = :id and active").param("id", who.id())
                .query((rs, i) -> new Staff(rs.getString("id"), rs.getString("email"), rs.getString("name"), rs.getString("role"), rs.getString("business_id"), rs.getBoolean("active"), rs.getBoolean("owner"), rs.getBoolean("must_change_password")))
                .optional().orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "unauthorized", "Please sign in."));
    }

    public List<Staff> list() {
        return jdbc.sql("select * from staff_users order by role, lower(email)")
                .query((rs, i) -> new Staff(rs.getString("id"), rs.getString("email"), rs.getString("name"), rs.getString("role"), rs.getString("business_id"), rs.getBoolean("active"), rs.getBoolean("owner"), rs.getBoolean("must_change_password"))).list();
    }

    @Transactional
    public Staff createMerchant(StaffPrincipal who, UUID businessId, NewMerchant in) {
        if (jdbc.sql("select count(*) from businesses where id = :id").param("id", businessId).query(Integer.class).single() == 0) throw ApiException.notFound("Business not found.");
        String email = in.email().trim().toLowerCase(Locale.ROOT);
        if (byEmail(email).isPresent()) throw ApiException.conflict("duplicate", "That email already has an account.");
        UUID id = UUID.randomUUID();
        boolean first = jdbc.sql("select count(*) from staff_users where business_id = :b").param("b", businessId).query(Integer.class).single() == 0;
        jdbc.sql("insert into staff_users (id, email, name, password_hash, role, business_id, owner, must_change_password) values (:id, :e, :n, :h, 'MERCHANT', :b, :o, true)")
                .param("id", id).param("e", email).param("n", in.name().trim()).param("h", encoder.encode(in.password())).param("b", businessId).param("o", first).update();
        audit.record(who, "create", "staff", id, email);
        return me(new StaffPrincipal(id, "MERCHANT", businessId));
    }

    @Transactional
    public void setActive(StaffPrincipal who, UUID id, boolean active) {
        if (id.equals(who.id()) && !active) throw ApiException.conflict("self", "You can’t switch off your own account.");
        if (jdbc.sql("update staff_users set active = :a where id = :id").param("a", active).param("id", id).update() == 0) throw ApiException.notFound("Account not found.");
        audit.record(who, active ? "activate" : "deactivate", "staff", id, "");
    }

    @Transactional
    public void resetPassword(StaffPrincipal who, UUID id, String password) {
        if (jdbc.sql("update staff_users set password_hash = :h, must_change_password = true where id = :id").param("h", encoder.encode(password)).param("id", id).update() == 0) throw ApiException.notFound("Account not found.");
        audit.record(who, "reset_password", "staff", id, "");
    }

    // ---------- a merchant's own team ----------
    private Staff requireOwner(StaffPrincipal who) {
        Staff me = me(who);
        if (!me.owner()) throw ApiException.forbidden("Only the account owner can manage the team.");
        return me;
    }

    /** Everyone with a login for this business, with their role. */
    public List<TeamMember> team(StaffPrincipal who) {
        UUID b = who.requireBusiness();
        return jdbc.sql("select * from staff_users where business_id = :b order by owner desc, lower(email)").param("b", b)
                .query((rs, i) -> {
                    boolean owner = rs.getBoolean("owner");
                    java.sql.Array a = rs.getArray("permissions");
                    List<String> p = owner ? List.copyOf(TeamAccess.AREAS.keySet()) : a == null ? List.of() : java.util.Arrays.asList((String[]) a.getArray());
                    return new TeamMember(rs.getString("id"), rs.getString("email"), rs.getString("name"), rs.getBoolean("active"), owner, rs.getBoolean("must_change_password"), owner ? null : rs.getString("staff_role"), p);
                }).list();
    }

    /** The owner adds someone and decides what they may do: manager, cashier (bills only) or a custom set of areas. */
    @Transactional
    public TeamMember addTeamMember(StaffPrincipal who, TeamInput in) {
        requireOwner(who);
        List<String> perms = TeamAccess.permissionsFor(in.staffRole(), in.permissions());
        String email = in.email().trim().toLowerCase(Locale.ROOT);
        if (byEmail(email).isPresent()) throw ApiException.conflict("duplicate", "That email already has an account.");
        UUID id = UUID.randomUUID();
        jdbc.sql("insert into staff_users (id, email, name, password_hash, role, business_id, owner, must_change_password, staff_role, permissions) values (:id, :e, :n, :h, 'MERCHANT', :b, false, true, :r, :p)")
                .param("id", id).param("e", email).param("n", in.name().trim()).param("h", encoder.encode(in.password())).param("b", who.requireBusiness())
                .param("r", in.staffRole()).param("p", perms.toArray(new String[0])).update();
        audit.record(who, "create", "staff", id, email + " as " + in.staffRole() + " " + perms);
        return teamMember(who, id);
    }

    /** The owner changes what someone may do. It applies on their next click; nobody has to sign in again. The owner's own access can't be limited. */
    @Transactional
    public TeamMember updateAccess(StaffPrincipal who, UUID id, AccessInput in) {
        Staff t = teamTarget(who, id);
        if (t.owner()) throw ApiException.conflict("owner", "The owner can always do everything.");
        List<String> perms = TeamAccess.permissionsFor(in.staffRole(), in.permissions());
        jdbc.sql("update staff_users set staff_role = :r, permissions = :p where id = :id").param("r", in.staffRole()).param("p", perms.toArray(new String[0])).param("id", id).update();
        audit.record(who, "access", "staff", id, t.email() + " -> " + in.staffRole() + " " + perms);
        return teamMember(who, id);
    }

    private TeamMember teamMember(StaffPrincipal who, UUID id) {
        return team(who).stream().filter(m -> m.id().equals(id.toString())).findFirst().orElseThrow(() -> ApiException.notFound("Account not found."));
    }

    /** The target must be on the owner's own team. The owner can't switch themselves off, and nobody can touch another owner. */
    private Staff teamTarget(StaffPrincipal who, UUID id) {
        requireOwner(who);
        UUID b = who.requireBusiness();
        return jdbc.sql("select * from staff_users where id = :id and business_id = :b").param("id", id).param("b", b)
                .query((rs, i) -> new Staff(rs.getString("id"), rs.getString("email"), rs.getString("name"), rs.getString("role"), rs.getString("business_id"), rs.getBoolean("active"), rs.getBoolean("owner"), rs.getBoolean("must_change_password")))
                .optional().orElseThrow(() -> ApiException.notFound("Account not found."));
    }

    @Transactional
    public void setTeamActive(StaffPrincipal who, UUID id, boolean active) {
        Staff t = teamTarget(who, id);
        if (t.owner()) throw ApiException.conflict("owner", "The owner’s account can’t be switched off here. Ask the VIBE team.");
        jdbc.sql("update staff_users set active = :a where id = :id").param("a", active).param("id", id).update();
        audit.record(who, active ? "activate" : "deactivate", "staff", id, t.email());
    }

    @Transactional
    public void resetTeamPassword(StaffPrincipal who, UUID id, String password) {
        Staff t = teamTarget(who, id);
        if (t.owner() && !id.equals(who.id())) throw ApiException.forbidden("You can’t change another owner’s password.");
        jdbc.sql("update staff_users set password_hash = :h where id = :id").param("h", encoder.encode(password)).param("id", id).update();
        audit.record(who, "reset_password", "staff", id, t.email());
    }

    /** The person signed in chooses their own password. Everything else is refused until they do, so a password someone else knew can't be used for long. */
    @Transactional
    public Session changePassword(StaffPrincipal who, String current, String next) {
        Row row = jdbc.sql("select * from staff_users where id = :id and active").param("id", who.id())
                .query((rs, i) -> new Row((UUID) rs.getObject("id"), rs.getString("email"), rs.getString("name"), rs.getString("password_hash"), rs.getString("role"), (UUID) rs.getObject("business_id"),
                        rs.getBoolean("active"), rs.getBoolean("owner"), rs.getBoolean("must_change_password"))).optional().orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "unauthorized", "Please sign in."));
        if (!encoder.matches(current, row.hash())) throw ApiException.badRequest("wrong_password", "That isn’t your current password.");
        if (current.equals(next)) throw ApiException.badRequest("same_password", "Choose a password you haven’t used here.");
        jdbc.sql("update staff_users set password_hash = :h, must_change_password = false where id = :id").param("h", encoder.encode(next)).param("id", who.id()).update();
        audit.record(who, "change_password", "staff", who.id(), "");
        JwtService.Issued token = jwt.issue(row.id(), row.role(), row.businessId(), false);
        return new Session(token.token(), token.expiresAt(), view(new Row(row.id(), row.email(), row.name(), row.hash(), row.role(), row.businessId(), row.active(), row.owner(), false)));
    }

    /** The first login for a business, made when VIBE approves it. The password is shown once to the admin, who passes it on; it must be changed at first sign-in. */
    @Transactional
    public Staff createOwner(StaffPrincipal who, UUID businessId, String email, String name, String password) {
        String e = email.trim().toLowerCase(Locale.ROOT);
        if (byEmail(e).isPresent()) throw ApiException.conflict("duplicate", "That email already has an account.");
        UUID id = UUID.randomUUID();
        jdbc.sql("insert into staff_users (id, email, name, password_hash, role, business_id, owner, must_change_password) values (:id, :e, :n, :h, 'MERCHANT', :b, true, true)")
                .param("id", id).param("e", e).param("n", name.trim()).param("h", encoder.encode(password)).param("b", businessId).update();
        audit.record(who, "create", "staff", id, e);
        return me(new StaffPrincipal(id, "MERCHANT", businessId));
    }

    public boolean emailTaken(String email) { return byEmail(email.trim().toLowerCase(Locale.ROOT)).isPresent(); }

    /** Used by the dev seed. */
    @Transactional
    public UUID createAdmin(String email, String name, String password) {
        UUID id = UUID.randomUUID();
        jdbc.sql("insert into staff_users (id, email, name, password_hash, role, admin_role) values (:id, :e, :n, :h, 'ADMIN', case when exists (select 1 from staff_users where role = 'ADMIN') then 'admin' else 'super_admin' end)")
                .param("id", id).param("e", email.toLowerCase(Locale.ROOT)).param("n", name).param("h", encoder.encode(password)).update();
        return id;
    }

    private static Staff view(Row r) {
        return new Staff(r.id().toString(), r.email(), r.name(), r.role(), r.businessId() == null ? null : r.businessId().toString(), r.active(), r.owner(), r.mustChange());
    }
}
