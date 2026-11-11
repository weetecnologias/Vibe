package in.vibe.backend.backoffice;

import in.vibe.backend.audit.AuditService;
import in.vibe.backend.common.ApiException;
import in.vibe.backend.security.JwtService;
import in.vibe.backend.security.StaffPrincipal;
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

    public record PasswordReset(@NotBlank @Size(min = MIN_PASSWORD, max = 100) String password) {}

    /** owner: the first login for a business. Only an owner can add and manage the rest of the team. */
    public record Staff(String id, String email, String name, String role, String businessId, boolean active, boolean owner) {}

    public record Session(String token, Instant expiresAt, Staff staff) {}

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

    private record Row(UUID id, String email, String name, String hash, String role, UUID businessId, boolean active, boolean owner) {}

    private java.util.Optional<Row> byEmail(String email) {
        return jdbc.sql("select * from staff_users where email = :e").param("e", email)
                .query((rs, i) -> new Row((UUID) rs.getObject("id"), rs.getString("email"), rs.getString("name"), rs.getString("password_hash"), rs.getString("role"),
                        (UUID) rs.getObject("business_id"), rs.getBoolean("active"), rs.getBoolean("owner"))).optional();
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
        JwtService.Issued token = jwt.issue(row.id(), row.role(), row.businessId());
        return new Session(token.token(), token.expiresAt(), view(row));
    }

    public Staff me(StaffPrincipal who) {
        return jdbc.sql("select * from staff_users where id = :id and active").param("id", who.id())
                .query((rs, i) -> new Staff(rs.getString("id"), rs.getString("email"), rs.getString("name"), rs.getString("role"), rs.getString("business_id"), rs.getBoolean("active"), rs.getBoolean("owner")))
                .optional().orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "unauthorized", "Please sign in."));
    }

    public List<Staff> list() {
        return jdbc.sql("select * from staff_users order by role, lower(email)")
                .query((rs, i) -> new Staff(rs.getString("id"), rs.getString("email"), rs.getString("name"), rs.getString("role"), rs.getString("business_id"), rs.getBoolean("active"), rs.getBoolean("owner"))).list();
    }

    @Transactional
    public Staff createMerchant(StaffPrincipal who, UUID businessId, NewMerchant in) {
        if (jdbc.sql("select count(*) from businesses where id = :id").param("id", businessId).query(Integer.class).single() == 0) throw ApiException.notFound("Business not found.");
        String email = in.email().trim().toLowerCase(Locale.ROOT);
        if (byEmail(email).isPresent()) throw ApiException.conflict("duplicate", "That email already has an account.");
        UUID id = UUID.randomUUID();
        boolean first = jdbc.sql("select count(*) from staff_users where business_id = :b").param("b", businessId).query(Integer.class).single() == 0;
        jdbc.sql("insert into staff_users (id, email, name, password_hash, role, business_id, owner) values (:id, :e, :n, :h, 'MERCHANT', :b, :o)")
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
        if (jdbc.sql("update staff_users set password_hash = :h where id = :id").param("h", encoder.encode(password)).param("id", id).update() == 0) throw ApiException.notFound("Account not found.");
        audit.record(who, "reset_password", "staff", id, "");
    }

    // ---------- a merchant's own team ----------
    private Staff requireOwner(StaffPrincipal who) {
        Staff me = me(who);
        if (!me.owner()) throw ApiException.forbidden("Only the account owner can manage the team.");
        return me;
    }

    /** Everyone with a login for this business. */
    public List<Staff> team(StaffPrincipal who) {
        UUID b = who.requireBusiness();
        return jdbc.sql("select * from staff_users where business_id = :b order by owner desc, lower(email)").param("b", b)
                .query((rs, i) -> new Staff(rs.getString("id"), rs.getString("email"), rs.getString("name"), rs.getString("role"), rs.getString("business_id"), rs.getBoolean("active"), rs.getBoolean("owner"))).list();
    }

    @Transactional
    public Staff addTeamMember(StaffPrincipal who, NewMerchant in) {
        requireOwner(who);
        String email = in.email().trim().toLowerCase(Locale.ROOT);
        if (byEmail(email).isPresent()) throw ApiException.conflict("duplicate", "That email already has an account.");
        UUID id = UUID.randomUUID();
        jdbc.sql("insert into staff_users (id, email, name, password_hash, role, business_id, owner) values (:id, :e, :n, :h, 'MERCHANT', :b, false)")
                .param("id", id).param("e", email).param("n", in.name().trim()).param("h", encoder.encode(in.password())).param("b", who.requireBusiness()).update();
        audit.record(who, "create", "staff", id, email);
        return me(new StaffPrincipal(id, "MERCHANT", who.requireBusiness()));
    }

    /** The target must be on the owner's own team. The owner can't switch themselves off, and nobody can touch another owner. */
    private Staff teamTarget(StaffPrincipal who, UUID id) {
        requireOwner(who);
        return team(who).stream().filter(s -> s.id().equals(id.toString())).findFirst().orElseThrow(() -> ApiException.notFound("Account not found."));
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

    /** Used by the dev seed. */
    @Transactional
    public UUID createAdmin(String email, String name, String password) {
        UUID id = UUID.randomUUID();
        jdbc.sql("insert into staff_users (id, email, name, password_hash, role) values (:id, :e, :n, :h, 'ADMIN')")
                .param("id", id).param("e", email.toLowerCase(Locale.ROOT)).param("n", name).param("h", encoder.encode(password)).update();
        return id;
    }

    private static Staff view(Row r) {
        return new Staff(r.id().toString(), r.email(), r.name(), r.role(), r.businessId() == null ? null : r.businessId().toString(), r.active(), r.owner());
    }
}
