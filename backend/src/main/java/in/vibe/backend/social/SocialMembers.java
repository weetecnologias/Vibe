package in.vibe.backend.social;

import in.vibe.backend.audit.AuditService;
import in.vibe.backend.common.ApiException;
import in.vibe.backend.security.StaffPrincipal;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.Period;
import java.time.ZoneId;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Who may take part in Social, and on what terms. Every member: signed in with a verified phone, a profile (gender, who they're open to
 * meeting, 18+ confirmed, an age band) and the community guidelines accepted. Hosts additionally hold an active VIBE membership and pass
 * VIBE's check of their ID details. Members can block each other and report anything; VIBE's team handles reports and can suspend.
 */
@Service
public class SocialMembers {
    public static final int GUIDELINES_VERSION = 1;
    public static final List<String> COMMUNITY_GUIDELINES = List.of(
            "You are 18 or older, and you are who you say you are.",
            "Meet only at the VIBE venue in the plan, in public, at the time agreed. Tell a friend where you’re going.",
            "No contact details in chat: no phone numbers, emails, social handles or links. Sharing one closes the chat and blocks you both.",
            "Be respectful. No harassment, pressure, hate or explicit content. “No” ends it.",
            "Turn up, or cancel at least 3 hours before. After that the venue keeps your deposit.",
            "Report anything that feels wrong. VIBE’s team reviews every report and can suspend accounts.");
    public static final List<String> HOST_GUIDELINES = List.of(
            "Hosts are verified: your legal name and ID details must match. VIBE may ask to see the ID itself.",
            "Host only at VIBE venues, with the venue’s agreement, and describe the plan honestly, including any cost.",
            "Keep everyone safe: you’re responsible for the plan running as described and for reporting problems.",
            "No selling, recruiting or promotions to members unless VIBE has approved it.",
            "Breaking the guidelines removes your host badge and can suspend your account.");

    public record Guidelines(int version, List<String> community, List<String> host) {}

    /** What other members see is only firstName, gender, ageBand and whether they're a verified host. */
    public record Profile(String memberId, String firstName, String gender, String meetPreference, boolean ageConfirmed18, String ageBand, boolean guidelinesAccepted,
                          String status, String hostStatus) {}

    public record ProfileInput(@NotBlank String gender, @NotBlank String meetPreference, boolean ageConfirmed18, String ageBand, Boolean acceptGuidelines) {}

    public record HostApplication(String status, String legalName, String idType, String idLast4, LocalDate dateOfBirth, String city, String about, OffsetDateTime submittedAt,
                                  OffsetDateTime reviewedAt, String reviewNote, boolean member) {}

    public record HostInput(@NotBlank @Size(min = 2, max = 120) String legalName, @NotBlank String idType, @NotBlank @Size(min = 4, max = 4) String idLast4, @NotNull LocalDate dateOfBirth,
                            @Size(max = 60) String city, @Size(max = 600) String about, Boolean acceptHostGuidelines) {}

    public record ReportInput(@NotBlank String targetType, @NotBlank @Size(max = 64) String targetId, @NotBlank String reason, @Size(max = 500) String note) {}

    /** A member as other members see them. verified = an approved host. */
    public record MemberCard(String id, String firstName, String ageBand, String gender, boolean verified) {}

    private static final List<String> GENDERS = List.of("man", "woman", "nonbinary", "undisclosed"), PREFS = List.of("men", "women", "anyone"),
            BANDS = List.of("18-24", "25-34", "35-44", "45+"), ID_TYPES = List.of("aadhaar", "pan", "passport", "driving_licence", "voter_id"),
            REASONS = List.of("harassment", "unsafe", "spam", "inappropriate", "underage", "other"), TARGETS = List.of("user", "meetup", "activity", "group");

    private final JdbcClient jdbc;
    private final AuditService audit;
    private final Clock clock;

    SocialMembers(JdbcClient jdbc, AuditService audit, Clock clock) {
        this.jdbc = jdbc;
        this.audit = audit;
        this.clock = clock;
    }

    public Guidelines guidelines() { return new Guidelines(GUIDELINES_VERSION, COMMUNITY_GUIDELINES, HOST_GUIDELINES); }

    // ---------- profile ----------
    public Optional<Profile> profile(UUID customer) {
        return jdbc.sql("select p.member_id, c.name, p.gender, p.meet_preference, p.age_confirmed_18, p.age_band, p.guidelines_version, p.status, h.status hstatus "
                        + "from social_profiles p join customers c on c.id = p.customer_id left join social_hosts h on h.customer_id = p.customer_id where p.customer_id = :c").param("c", customer)
                .query((rs, i) -> new Profile(rs.getString(1), firstName(rs.getString(2)), rs.getString(3), rs.getString(4), rs.getBoolean(5), rs.getString(6), rs.getInt(7) >= GUIDELINES_VERSION,
                        rs.getString(8), rs.getString("hstatus"))).optional();
    }

    static String firstName(String name) {
        String n = name == null ? "" : name.trim();
        return n.isEmpty() ? "Member" : n.split("\\s+")[0];
    }

    @Transactional
    public Profile saveProfile(UUID customer, ProfileInput in) {
        if (!GENDERS.contains(in.gender())) throw ApiException.badRequest("gender", "Choose how you describe yourself.");
        if (!PREFS.contains(in.meetPreference())) throw ApiException.badRequest("meet_preference", "Choose who you’re open to meeting.");
        if (!in.ageConfirmed18()) throw ApiException.badRequest("age", "Social is for people 18 and over.");
        if (in.ageBand() != null && !in.ageBand().isBlank() && !BANDS.contains(in.ageBand())) throw ApiException.badRequest("age_band", "Choose an age band.");
        boolean exists = jdbc.sql("select count(*) from social_profiles where customer_id = :c").param("c", customer).query(Integer.class).single() > 0;
        boolean accepts = Boolean.TRUE.equals(in.acceptGuidelines());
        // A new member, or one whose accepted version is old, must accept the current guidelines.
        boolean current = exists && jdbc.sql("select guidelines_version from social_profiles where customer_id = :c").param("c", customer).query(Integer.class).single() >= GUIDELINES_VERSION;
        if (!current && !accepts) throw ApiException.badRequest("guidelines", "Read and accept the community guidelines to use Social.");
        String band = in.ageBand() == null || in.ageBand().isBlank() ? null : in.ageBand();
        if (!exists) {
            jdbc.sql("insert into social_profiles (customer_id, member_id, gender, meet_preference, age_confirmed_18, age_band, guidelines_version, guidelines_accepted_at) values (:c, :m, :g, :p, true, :b, :v, now())")
                    .param("c", customer).param("m", UUID.randomUUID()).param("g", in.gender()).param("p", in.meetPreference()).param("b", band).param("v", GUIDELINES_VERSION).update();
        } else {
            jdbc.sql("update social_profiles set gender = :g, meet_preference = :p, age_band = :b, updated_at = now()" + (accepts ? ", guidelines_version = :v, guidelines_accepted_at = now()" : "") + " where customer_id = :c")
                    .param("c", customer).param("g", in.gender()).param("p", in.meetPreference()).param("b", band).param("v", GUIDELINES_VERSION).update();
        }
        return profile(customer).orElseThrow();
    }

    /** Refuses anyone who can't take part: no profile, old guidelines, or suspended. */
    public void requireActive(UUID customer) {
        Profile p = profile(customer).orElseThrow(() -> ApiException.conflict("no_profile", "Set up your Social profile and accept the guidelines first."));
        if ("suspended".equals(p.status())) throw ApiException.forbidden("Your Social access is suspended. Contact VIBE support.");
        if (!p.guidelinesAccepted()) throw ApiException.conflict("guidelines", "The community guidelines have changed. Read and accept them to carry on.");
    }

    public MemberCard card(UUID customer) {
        return jdbc.sql("select p.member_id, c.name, p.age_band, p.gender, coalesce(h.status = 'approved', false) from social_profiles p join customers c on c.id = p.customer_id "
                        + "left join social_hosts h on h.customer_id = p.customer_id where p.customer_id = :c").param("c", customer)
                .query((rs, i) -> new MemberCard(rs.getString(1), firstName(rs.getString(2)), rs.getString(3), rs.getString(4), rs.getBoolean(5))).optional()
                .orElse(new MemberCard(customer.toString(), "Member", null, "undisclosed", false));
    }

    /** The customer behind a member id (the only id other members ever see). */
    public UUID customerOf(String memberId) {
        UUID m;
        try { m = UUID.fromString(memberId); } catch (IllegalArgumentException e) { throw ApiException.notFound("Member not found."); }
        return jdbc.sql("select customer_id from social_profiles where member_id = :m").param("m", m).query(UUID.class).optional().orElseThrow(() -> ApiException.notFound("Member not found."));
    }

    public boolean blockedEitherWay(UUID a, UUID b) {
        return jdbc.sql("select count(*) from social_blocks where (blocker_id = :a and blocked_id = :b) or (blocker_id = :b and blocked_id = :a)").param("a", a).param("b", b).query(Integer.class).single() > 0;
    }

    @Transactional
    public void block(UUID customer, String memberId) {
        UUID other = customerOf(memberId);
        if (other.equals(customer)) throw ApiException.badRequest("self", "You can’t block yourself.");
        jdbc.sql("insert into social_blocks (blocker_id, blocked_id) values (:a, :b) on conflict do nothing").param("a", customer).param("b", other).update();
    }

    @Transactional
    public String report(UUID customer, ReportInput in) {
        if (!TARGETS.contains(in.targetType())) throw ApiException.badRequest("target", "Choose what you’re reporting.");
        if (!REASONS.contains(in.reason())) throw ApiException.badRequest("reason", "Choose a reason.");
        UUID id = UUID.randomUUID();
        jdbc.sql("insert into social_reports (id, reporter_id, target_type, target_id, reason, note) values (:id, :r, :t, :tid, :reason, :n)")
                .param("id", id).param("r", customer).param("t", in.targetType()).param("tid", in.targetId().trim()).param("reason", in.reason()).param("n", in.note() == null ? "" : in.note().trim()).update();
        return id.toString();
    }

    /** VIBE raises a report itself, for example when a contact detail is shared in chat. */
    void systemReport(String targetType, String targetId, String reason, String note) {
        jdbc.sql("insert into social_reports (id, target_type, target_id, reason, note) values (:id, :t, :tid, :r, :n)").param("id", UUID.randomUUID()).param("t", targetType).param("tid", targetId)
                .param("r", reason).param("n", note).update();
    }

    // ---------- hosts ----------
    public Optional<HostApplication> host(UUID customer) {
        boolean member = isMember(customer);
        return jdbc.sql("select status, legal_name, id_type, id_last4, date_of_birth, city, about, submitted_at, reviewed_at, review_note from social_hosts where customer_id = :c").param("c", customer)
                .query((rs, i) -> new HostApplication(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getObject(5, LocalDate.class), rs.getString(6), rs.getString(7),
                        rs.getObject(8, OffsetDateTime.class), rs.getObject(9, OffsetDateTime.class), rs.getString(10), member)).optional();
    }

    public boolean isMember(UUID customer) {
        return jdbc.sql("select count(*) from memberships where customer_id = :c and valid_until > now()").param("c", customer).query(Integer.class).single() > 0;
    }

    /** Become a host: a VIBE member with a Social profile sends their ID details and accepts the host guidelines; VIBE reviews. */
    @Transactional
    public HostApplication applyToHost(UUID customer, HostInput in) {
        requireActive(customer);
        if (!isMember(customer)) throw ApiException.conflict("membership_required", "Hosting is for VIBE members. Join VIBE Membership first.");
        if (!Boolean.TRUE.equals(in.acceptHostGuidelines())) throw ApiException.badRequest("guidelines", "Read and accept the host guidelines.");
        if (!ID_TYPES.contains(in.idType())) throw ApiException.badRequest("id_type", "Choose the ID you’re using.");
        String last4 = in.idLast4().trim().toUpperCase();
        if (!last4.matches("[0-9A-Z]{4}")) throw ApiException.badRequest("id_last4", "Enter the last 4 characters of your ID number.");
        if (Period.between(in.dateOfBirth(), LocalDate.now(clock.withZone(ZoneId.of("Asia/Kolkata")))).getYears() < 18) throw ApiException.badRequest("age", "Hosts must be 18 or older.");
        String status = jdbc.sql("select status from social_hosts where customer_id = :c").param("c", customer).query(String.class).optional().orElse(null);
        if ("approved".equals(status)) throw ApiException.conflict("already_host", "You’re already a verified host.");
        if ("pending".equals(status)) throw ApiException.conflict("pending", "Your application is with VIBE. You’ll hear back soon.");
        jdbc.sql("insert into social_hosts (customer_id, status, legal_name, id_type, id_last4, date_of_birth, city, about, host_guidelines_accepted_at, submitted_at) "
                        + "values (:c, 'pending', :n, :t, :l, :d, :city, :about, now(), now()) on conflict (customer_id) do update set status = 'pending', legal_name = excluded.legal_name, id_type = excluded.id_type, "
                        + "id_last4 = excluded.id_last4, date_of_birth = excluded.date_of_birth, city = excluded.city, about = excluded.about, host_guidelines_accepted_at = now(), submitted_at = now(), "
                        + "reviewed_at = null, reviewed_by = null, review_note = null")
                .param("c", customer).param("n", in.legalName().trim()).param("t", in.idType()).param("l", last4).param("d", in.dateOfBirth())
                .param("city", in.city() == null || in.city().isBlank() ? "Hyderabad" : in.city().trim()).param("about", in.about() == null ? "" : in.about().trim()).update();
        return host(customer).orElseThrow();
    }

    /** VIBE's decision: approve, reject (with a note the applicant sees) or revoke an approved host. */
    @Transactional
    public void decideHost(StaffPrincipal who, UUID customer, String decision, String note) {
        String status = jdbc.sql("select status from social_hosts where customer_id = :c for update").param("c", customer).query(String.class).optional().orElseThrow(() -> ApiException.notFound("No host application."));
        String next = switch (decision) {
            case "approve" -> { if (!"pending".equals(status)) throw ApiException.conflict("not_pending", "Only a waiting application can be approved."); yield "approved"; }
            case "reject" -> { if (!"pending".equals(status)) throw ApiException.conflict("not_pending", "Only a waiting application can be rejected."); yield "rejected"; }
            case "revoke" -> { if (!"approved".equals(status)) throw ApiException.conflict("not_host", "Only an approved host can be revoked."); yield "revoked"; }
            default -> throw ApiException.badRequest("decision", "Choose approve, reject or revoke.");
        };
        if (!"approved".equals(next) && (note == null || note.isBlank())) throw ApiException.badRequest("note", "Say why: the member sees this.");
        jdbc.sql("update social_hosts set status = :s, reviewed_at = now(), reviewed_by = :by, review_note = :n where customer_id = :c").param("s", next).param("by", who.id())
                .param("n", note == null || note.isBlank() ? null : note.trim()).param("c", customer).update();
        audit.record(who, "host_" + decision, "social_host", customer, note == null ? "" : note.trim());
    }

    // ---------- suspension ----------
    @Transactional
    public void setSuspended(StaffPrincipal who, UUID customer, boolean suspend, String reason) {
        if (suspend && (reason == null || reason.isBlank())) throw ApiException.badRequest("reason", "Say why the account is suspended.");
        int n = jdbc.sql("update social_profiles set status = :s, suspended_reason = :r, suspended_at = case when :susp then now() else null end, suspended_by = :by, updated_at = now() where customer_id = :c")
                .param("s", suspend ? "suspended" : "active").param("r", suspend ? reason.trim() : null).param("susp", suspend).param("by", who.id()).param("c", customer).update();
        if (n == 0) throw ApiException.notFound("No Social profile for this customer.");
        audit.record(who, suspend ? "social_suspend" : "social_unsuspend", "customer", customer, suspend ? reason.trim() : "");
    }
}
