package in.vibe.backend.customer;

import in.vibe.backend.common.ApiException;
import in.vibe.backend.security.JwtService;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.crypto.Mac;
import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.HexFormat;
import java.util.UUID;

/** Customer sign-in with a phone number and a one-time code, the customer's own profile, and refresh tokens. */
@Service
public class Customers {
    static final int OTP_MINUTES = 5, OTP_ATTEMPTS = 3, RESEND_SECONDS = 30, MAX_REQUESTS_PER_HOUR = 5;
    static final Duration REFRESH_TTL = Duration.ofDays(30);

    public record OtpChallenge(String requestId, String maskedPhone, int expiresInSec, int resendInSec, int attemptsLeft) {}

    /** What the customer app calls `User`. */
    public record User(String id, String name, String phoneMasked, String vibeId, String area, boolean isMember) {}

    public record AuthResult(String accessToken, String refreshToken, User user, boolean isNewUser) {}

    public record ProfilePatch(@Size(min = 2, max = 60) String name, @Size(max = 80) String area) {}

    public record PhoneInput(@NotBlank String phone) {}

    private final JdbcClient jdbc;
    private final JwtService jwt;
    private final SecretKey key;
    private final SmsPorts.OtpCodes codes;
    private final SmsPorts.OtpSender sender;
    private final Clock clock;
    private final SecureRandom random = new SecureRandom();

    Customers(JdbcClient jdbc, JwtService jwt, SecretKey jwtKey, SmsPorts.OtpCodes codes, SmsPorts.OtpSender sender, Clock clock) {
        this.jdbc = jdbc;
        this.jwt = jwt;
        this.key = jwtKey;
        this.codes = codes;
        this.sender = sender;
        this.clock = clock;
    }

    /** "+91 98765 43210", "09876543210" and "9876543210" are all the same Indian mobile number. */
    static String normalize(String raw) {
        String d = raw == null ? "" : raw.replaceAll("[\\s\\-()]", "");
        if (d.startsWith("+91")) d = d.substring(3);
        else if (d.startsWith("91") && d.length() == 12) d = d.substring(2);
        else if (d.startsWith("0") && d.length() == 11) d = d.substring(1);
        if (!d.matches("[6-9][0-9]{9}")) throw ApiException.badRequest("invalid_phone", "Enter a valid 10-digit Indian mobile number.");
        return d;
    }

    static String masked(String phone) { return "+91 " + phone.substring(0, 5) + " •••" + phone.substring(8); }

    private String hash(UUID requestId, String phone, String code) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(key);
            return HexFormat.of().formatHex(mac.doFinal(("otp:" + requestId + ":" + phone + ":" + code).getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    // ---------- sign-in ----------
    @Transactional
    public OtpChallenge requestOtp(String rawPhone) {
        String phone = normalize(rawPhone);
        OffsetDateTime now = OffsetDateTime.now(clock);
        if (jdbc.sql("select count(*) from otp_requests where phone = :p and created_at > :t").param("p", phone).param("t", now.minusHours(1)).query(Integer.class).single() >= MAX_REQUESTS_PER_HOUR) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "too_many_requests", "Too many codes requested. Try again in an hour.");
        }
        OffsetDateTime last = jdbc.sql("select max(created_at) from otp_requests where phone = :p").param("p", phone).query(OffsetDateTime.class).optional().orElse(null);
        if (last != null && last.plusSeconds(RESEND_SECONDS).isAfter(now)) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "resend_too_soon", "Wait a few seconds before asking for another code.");
        }
        UUID id = UUID.randomUUID();
        String code = codes.next();
        sender.send(phone, code); // throws when no SMS provider is connected, so no code is stored for a message that was never sent
        jdbc.sql("insert into otp_requests (id, phone, code_hash, attempts_left, expires_at, created_at) values (:id, :p, :h, :a, :e, :c)")
                .param("id", id).param("p", phone).param("h", hash(id, phone, code)).param("a", OTP_ATTEMPTS).param("e", now.plusMinutes(OTP_MINUTES)).param("c", now).update();
        return new OtpChallenge(id.toString(), masked(phone), OTP_MINUTES * 60, RESEND_SECONDS, OTP_ATTEMPTS);
    }

    // The error is thrown after the failed try is counted, so the count must be kept.
    @Transactional(noRollbackFor = ApiException.class)
    public AuthResult verifyOtp(String requestId, String code) {
        UUID id;
        try { id = UUID.fromString(requestId); } catch (RuntimeException e) { throw wrong(0); }
        record Row(String phone, String hash, int attemptsLeft, OffsetDateTime expiresAt, boolean consumed) {}
        // Locked so two guesses can't be tried at once.
        Row r = jdbc.sql("select phone, code_hash, attempts_left, expires_at, consumed from otp_requests where id = :id for update").param("id", id)
                .query((rs, i) -> new Row(rs.getString(1), rs.getString(2), rs.getInt(3), rs.getObject(4, OffsetDateTime.class), rs.getBoolean(5))).optional().orElseThrow(() -> wrong(0));
        if (r.consumed() || r.expiresAt().isBefore(OffsetDateTime.now(clock))) throw new ApiException(HttpStatus.GONE, "otp_expired", "That code has expired. Ask for a new one.");
        if (r.attemptsLeft() <= 0) throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "otp_locked", "Too many wrong codes. Ask for a new one.");
        boolean ok = code != null && MessageDigest.isEqual(hash(id, r.phone(), code.trim()).getBytes(StandardCharsets.UTF_8), r.hash().getBytes(StandardCharsets.UTF_8));
        if (!ok) {
            jdbc.sql("update otp_requests set attempts_left = attempts_left - 1 where id = :id").param("id", id).update();
            throw wrong(r.attemptsLeft() - 1);
        }
        jdbc.sql("update otp_requests set consumed = true where id = :id").param("id", id).update();

        var existing = jdbc.sql("select id from customers where phone = :p").param("p", r.phone()).query((rs, i) -> (UUID) rs.getObject(1)).optional();
        boolean isNew = existing.isEmpty();
        UUID customer = existing.orElseGet(() -> createCustomer(r.phone()));
        return session(customer, isNew);
    }

    private ApiException wrong(int left) {
        return new ApiException(HttpStatus.UNAUTHORIZED, "wrong_code", left > 0 ? "That code isn’t right. " + left + (left == 1 ? " try" : " tries") + " left." : "That code isn’t right.");
    }

    private UUID createCustomer(String phone) {
        UUID id = UUID.randomUUID();
        for (int attempt = 0; attempt < 20; attempt++) {
            String vibeId = String.valueOf(100_000 + random.nextInt(900_000));
            if (jdbc.sql("insert into customers (id, phone, name, vibe_id) values (:id, :p, 'VIBE member', :v) on conflict (vibe_id) do nothing").param("id", id).param("p", phone).param("v", vibeId).update() == 1) return id;
        }
        throw new IllegalStateException("Couldn’t allocate a VIBE ID");
    }

    private AuthResult session(UUID customer, boolean isNew) {
        JwtService.Issued access = jwt.issueCustomer(customer);
        byte[] raw = new byte[32];
        random.nextBytes(raw);
        String refresh = Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
        jdbc.sql("insert into refresh_tokens (id, customer_id, token_hash, expires_at) values (:id, :c, :h, :e)").param("id", UUID.randomUUID()).param("c", customer)
                .param("h", sha256(refresh)).param("e", OffsetDateTime.now(clock).plus(REFRESH_TTL)).update();
        return new AuthResult(access.token(), refresh, me(customer), isNew);
    }

    private static String sha256(String s) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8))); } catch (Exception e) { throw new IllegalStateException(e); }
    }

    /** Swaps a refresh token for a new pair. Each refresh token works once; a reused one signs the customer out everywhere. */
    // A replayed token revokes every session and then fails; the revocation must be kept.
    @Transactional(noRollbackFor = ApiException.class)
    public AuthResult refresh(String refreshToken) {
        record Row(UUID id, UUID customer, boolean revoked, OffsetDateTime expiresAt) {}
        Row r = jdbc.sql("select id, customer_id, revoked, expires_at from refresh_tokens where token_hash = :h for update").param("h", sha256(refreshToken == null ? "" : refreshToken))
                .query((rs, i) -> new Row((UUID) rs.getObject(1), (UUID) rs.getObject(2), rs.getBoolean(3), rs.getObject(4, OffsetDateTime.class))).optional()
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "unauthorized", "Please sign in again."));
        if (r.revoked()) {
            // Someone is replaying a used token: end every session for this customer.
            jdbc.sql("update refresh_tokens set revoked = true where customer_id = :c").param("c", r.customer()).update();
            throw new ApiException(HttpStatus.UNAUTHORIZED, "unauthorized", "Please sign in again.");
        }
        if (r.expiresAt().isBefore(OffsetDateTime.now(clock))) throw new ApiException(HttpStatus.UNAUTHORIZED, "unauthorized", "Please sign in again.");
        jdbc.sql("update refresh_tokens set revoked = true where id = :id").param("id", r.id()).update();
        return session(r.customer(), false);
    }

    @Transactional
    public void logout(CustomerPrincipal who) {
        jdbc.sql("update refresh_tokens set revoked = true where customer_id = :c").param("c", who.id()).update();
    }

    // ---------- profile ----------
    public User me(UUID id) {
        return jdbc.sql("select c.id, c.name, c.phone, c.vibe_id, c.area, coalesce((select m.valid_until > now() from memberships m where m.customer_id = c.id), false) member from customers c where c.id = :id")
                .param("id", id).query((rs, i) -> new User(rs.getString("id"), rs.getString("name"), masked(rs.getString("phone")), rs.getString("vibe_id"), rs.getString("area"), rs.getBoolean("member")))
                .optional().orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "unauthorized", "Please sign in."));
    }

    @Transactional
    public User update(CustomerPrincipal who, ProfilePatch p) {
        me(who.id());
        if (p.name() != null && !p.name().isBlank()) jdbc.sql("update customers set name = :n where id = :id").param("n", p.name().trim()).param("id", who.id()).update();
        if (p.area() != null) jdbc.sql("update customers set area = :a where id = :id").param("a", p.area().isBlank() ? null : p.area().trim()).param("id", who.id()).update();
        return me(who.id());
    }

    @Transactional
    public void requestDeletion(CustomerPrincipal who) {
        me(who.id());
        if (jdbc.sql("select count(*) from deletion_requests where customer_id = :c and status = 'pending'").param("c", who.id()).query(Integer.class).single() == 0) {
            jdbc.sql("insert into deletion_requests (id, customer_id) values (:id, :c)").param("id", UUID.randomUUID()).param("c", who.id()).update();
        }
    }

    /** "Aarav R." is all that staff see of a customer, with their VIBE ID. */
    public static String displayName(String fullName) {
        String[] parts = fullName.trim().split("\\s+");
        return parts.length > 1 ? parts[0] + " " + Character.toUpperCase(parts[1].charAt(0)) + "." : parts[0];
    }
}
