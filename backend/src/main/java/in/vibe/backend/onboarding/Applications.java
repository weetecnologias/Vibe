package in.vibe.backend.onboarding;

import in.vibe.backend.audit.AuditService;
import in.vibe.backend.backoffice.StaffService;
import in.vibe.backend.catalogue.BusinessStore;
import in.vibe.backend.common.ApiException;
import in.vibe.backend.notify.StaffNotifications;
import in.vibe.backend.security.StaffPrincipal;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * A business applies to join VIBE, VIBE reviews it, and approval creates the listing and the owner's login. Nothing goes live by itself:
 * the new listing starts switched off, and the owner fills in photos, menu and hours before VIBE switches it on.
 * Which documents VIBE must collect (GST, FSSAI and so on) is a business and legal decision, so the form takes links to whatever VIBE asks for.
 */
@Service
public class Applications {
    public record Input(
            @NotBlank @Size(max = 120) String businessName,
            String categoryId,
            @NotBlank @Size(max = 80) String area,
            @Size(max = 300) String address,
            @NotBlank @Size(max = 120) String contactName,
            @NotBlank @Email @Size(max = 200) String email,
            @NotBlank @Size(max = 20) String phone,
            @Size(max = 1000) String about,
            @Size(max = 5) List<@Pattern(regexp = "^https?://\\S+$", message = "must be an http(s) link") String> documents) {}

    public record Submitted(String id, String statusToken) {}

    /** What the applicant sees when they check back. */
    public record StatusView(String id, String businessName, String status, String reviewNote, OffsetDateTime submittedAt, OffsetDateTime decidedAt) {}

    public record Row(String id, String businessName, String categoryName, String area, String contactName, String email, String phone, String status, OffsetDateTime submittedAt) {}

    public record Detail(Row row, String categoryId, String address, String about, List<String> documents, String reviewNote, OffsetDateTime decidedAt, String businessId) {}

    public record Approved(String businessId, String loginEmail, String temporaryPassword) {}

    private final JdbcClient jdbc;
    private final AuditService audit;
    private final StaffNotifications staffNotifications;
    private final StaffService staff;
    private final BusinessStore businesses;
    private final Clock clock;
    private final in.vibe.backend.catalogue.MerchantFeatures merchantFeatures;
    private final SecureRandom random = new SecureRandom();

    Applications(JdbcClient jdbc, AuditService audit, StaffNotifications staffNotifications, StaffService staff, BusinessStore businesses, Clock clock, in.vibe.backend.catalogue.MerchantFeatures merchantFeatures) {
        this.merchantFeatures = merchantFeatures;
        this.jdbc = jdbc;
        this.audit = audit;
        this.staffNotifications = staffNotifications;
        this.staff = staff;
        this.businesses = businesses;
        this.clock = clock;
    }

    private OffsetDateTime now() { return OffsetDateTime.now(clock); }

    private static String sha256(String s) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8))); } catch (Exception e) { throw new IllegalStateException(e); }
    }

    /** "+91 98765 43210", "09876543210" and "9876543210" are the same number. */
    private static String phone(String raw) {
        String d = raw.replaceAll("[\\s\\-()]", "");
        if (d.startsWith("+91")) d = d.substring(3);
        else if (d.startsWith("0") && d.length() == 11) d = d.substring(1);
        if (!d.matches("[6-9][0-9]{9}")) throw ApiException.badRequest("invalid_phone", "Enter a valid 10-digit Indian mobile number.");
        return d;
    }

    /** Required: the category decides what the business gets on VIBE. It must be one a merchant can be in (has at least one feature). */
    private UUID category(String raw) {
        if (raw == null || raw.isBlank()) throw ApiException.badRequest("category", "Choose what kind of business this is, like Food & Dining → Cafés.");
        UUID id;
        try { id = UUID.fromString(raw); } catch (RuntimeException e) { throw ApiException.badRequest("category", "Choose a valid category."); }
        if (jdbc.sql("select count(*) from categories where id = :id and active").param("id", id).query(Integer.class).single() == 0) throw ApiException.badRequest("category", "That category isn’t available.");
        if (jdbc.sql("select count(*) from categories where id = :id").param("id", id).query(Integer.class).single() > 0 && merchantFeatures.forCategory(id).features().isEmpty()) {
            throw ApiException.badRequest("category", "Businesses can’t join VIBE in that category. Choose the one closest to what you do.");
        }
        return id;
    }

    // ---------- the applicant ----------
    /** The token returned here is the only way back to the application; only its hash is kept. At most 3 applications per email per day. */
    @Transactional
    public Submitted submit(Input in) {
        String email = in.email().trim().toLowerCase(Locale.ROOT);
        if (jdbc.sql("select count(*) from merchant_applications where lower(email) = :e and created_at > :t").param("e", email).param("t", now().minusDays(1)).query(Integer.class).single() >= 3) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "too_many_applications", "You’ve already applied a few times today. Please wait for VIBE to get back to you.");
        }
        UUID cat = category(in.categoryId());
        byte[] raw = new byte[24];
        random.nextBytes(raw);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
        UUID id = UUID.randomUUID();
        jdbc.sql("insert into merchant_applications (id, business_name, category_id, area, address, contact_name, email, phone, about, documents, token_hash) values (:id, :bn, :c, :a, :ad, :cn, :e, :p, :ab, :d, :t)")
                .param("id", id).param("bn", in.businessName().trim()).param("c", cat, java.sql.Types.OTHER).param("a", in.area().trim()).param("ad", in.address() == null ? "" : in.address().trim()).param("cn", in.contactName().trim())
                .param("e", email).param("p", phone(in.phone())).param("ab", in.about() == null ? "" : in.about().trim()).param("d", docs(in)).param("t", sha256(token)).update();
        staffNotifications.toAdmins("application", "New business application", in.businessName().trim() + " in " + in.area().trim() + " wants to join VIBE.", "/applications");
        return new Submitted(id.toString(), token);
    }

    private static String[] docs(Input in) { return (in.documents() == null ? List.<String>of() : in.documents().stream().map(String::trim).toList()).toArray(new String[0]); }

    private record Auth(UUID id, String status) {}

    private Auth authenticate(UUID id, String token) {
        return jdbc.sql("select id, status from merchant_applications where id = :id and token_hash = :t").param("id", id).param("t", sha256(token == null ? "" : token))
                .query((rs, i) -> new Auth((UUID) rs.getObject(1), rs.getString(2))).optional().orElseThrow(() -> ApiException.notFound("We couldn’t find that application."));
    }

    public StatusView status(UUID id, String token) {
        authenticate(id, token);
        return jdbc.sql("select id, business_name, status, review_note, created_at, decided_at from merchant_applications where id = :id").param("id", id)
                .query((rs, i) -> new StatusView(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getObject(5, OffsetDateTime.class), rs.getObject(6, OffsetDateTime.class))).single();
    }

    /** When VIBE asks for changes, the applicant corrects the form and sends it back for another look. */
    @Transactional
    public StatusView resubmit(UUID id, String token, Input in) {
        Auth a = authenticate(id, token);
        if (!a.status().equals("changes_requested")) throw ApiException.conflict("not_editable", "This application can’t be changed right now.");
        UUID cat = category(in.categoryId());
        jdbc.sql("update merchant_applications set business_name = :bn, category_id = :c, area = :a, address = :ad, contact_name = :cn, phone = :p, about = :ab, documents = :d, status = 'pending', updated_at = now() where id = :id")
                .param("id", id).param("bn", in.businessName().trim()).param("c", cat, java.sql.Types.OTHER).param("a", in.area().trim()).param("ad", in.address() == null ? "" : in.address().trim()).param("cn", in.contactName().trim())
                .param("p", phone(in.phone())).param("ab", in.about() == null ? "" : in.about().trim()).param("d", docs(in)).update();
        staffNotifications.toAdmins("application", "Application updated", in.businessName().trim() + " sent the changes you asked for.", "/applications");
        return status(id, token);
    }

    // ---------- VIBE ----------
    private static Row row(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        return new Row(rs.getString("id"), rs.getString("business_name"), rs.getString("cname"), rs.getString("area"), rs.getString("contact_name"), rs.getString("email"), rs.getString("phone"), rs.getString("status"), rs.getObject("created_at", OffsetDateTime.class));
    }

    /** Waiting ones first, oldest first. */
    public List<Row> list(String status) { return list(status, ""); }

    /** scope: from AdminAccess.categoryScope on a.category_id. */
    public List<Row> list(String status, String scope) {
        return jdbc.sql("select a.*, c.name cname from merchant_applications a left join categories c on c.id = a.category_id where true" + scope + (status == null || status.isBlank() ? "" : " and a.status = :s")
                + " order by (a.status = 'pending') desc, case when a.status = 'pending' then a.created_at end asc, a.created_at desc limit 200").param("s", status == null ? "" : status).query(Applications::row).list();
    }

    public Detail get(UUID id) {
        return jdbc.sql("select a.*, c.name cname from merchant_applications a left join categories c on c.id = a.category_id where a.id = :id").param("id", id)
                .query((rs, i) -> new Detail(row(rs, i), rs.getString("category_id"), rs.getString("address"), rs.getString("about"), List.of((String[]) rs.getArray("documents").getArray()), rs.getString("review_note"),
                        rs.getObject("decided_at", OffsetDateTime.class), rs.getString("business_id"))).optional().orElseThrow(() -> ApiException.notFound("Application not found."));
    }

    private Detail openForDecision(UUID id) {
        Detail d = get(id);
        if (!d.row().status().equals("pending")) throw ApiException.conflict("decided", "This application has already been decided.");
        return d;
    }

    @Transactional
    public Detail requestChanges(StaffPrincipal who, UUID id, String note) {
        openForDecision(id);
        if (note == null || note.isBlank()) throw ApiException.badRequest("note_required", "Tell the applicant what to change.");
        jdbc.sql("update merchant_applications set status = 'changes_requested', review_note = :n, decided_by = :by, updated_at = now() where id = :id").param("n", note.trim()).param("by", who.id()).param("id", id).update();
        audit.record(who, "request_changes", "application", id, note.trim());
        return get(id);
    }

    @Transactional
    public Detail reject(StaffPrincipal who, UUID id, String note) {
        openForDecision(id);
        if (note == null || note.isBlank()) throw ApiException.badRequest("note_required", "Give a reason. The applicant will see it.");
        jdbc.sql("update merchant_applications set status = 'rejected', review_note = :n, decided_at = now(), decided_by = :by, updated_at = now() where id = :id").param("n", note.trim()).param("by", who.id()).param("id", id).update();
        audit.record(who, "reject", "application", id, note.trim());
        return get(id);
    }

    /**
     * Creates the listing (switched off, not verified) and the owner's login. The temporary password is returned once, here, and never stored in clear;
     * the owner must choose their own at first sign-in. Until email is connected, VIBE passes the login details on by hand.
     */
    @Transactional
    public Approved approve(StaffPrincipal who, UUID id, String categoryOverride) {
        Detail d = openForDecision(id);
        if (staff.emailTaken(d.row().email())) throw ApiException.conflict("duplicate", "That email already has an account.");
        String cat = categoryOverride != null && !categoryOverride.isBlank() ? categoryOverride : d.categoryId();
        if (cat == null) throw ApiException.badRequest("category", "Choose the main category for this business.");
        BusinessStore.Profile profile = new BusinessStore.Profile(d.row().businessName(), d.row().area(), d.address(), null, null, d.about(), null, null, 2, null, List.of(), false, List.of(), null);
        BusinessStore.Editable b = businesses.create(who, new BusinessStore.AdminInput(cat, List.of(cat), profile, false, true, false));
        String temp = temporaryPassword();
        staff.createOwner(who, UUID.fromString(b.id()), d.row().email(), d.row().contactName(), temp);
        jdbc.sql("update merchant_applications set status = 'approved', business_id = :b, decided_at = now(), decided_by = :by, review_note = null, updated_at = now() where id = :id").param("b", UUID.fromString(b.id())).param("by", who.id()).param("id", id).update();
        audit.record(who, "approve", "application", id, d.row().businessName());
        return new Approved(b.id(), d.row().email(), temp);
    }

    private String temporaryPassword() {
        String alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 14; i++) sb.append(alphabet.charAt(random.nextInt(alphabet.length())));
        return sb.toString();
    }
}
