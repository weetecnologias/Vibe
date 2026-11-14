package in.vibe.backend.social;

import in.vibe.backend.audit.AuditService;
import in.vibe.backend.common.ApiException;
import in.vibe.backend.common.Csv;
import in.vibe.backend.customer.Customers;
import in.vibe.backend.security.StaffPrincipal;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * VIBE's view of Social: every meetup with who created and joined it (name and VIBE ID), its venue, reservation and every payment and
 * refund by transaction ID; reports to act on; host applications; and members, who can be suspended.
 * Privacy: staff see first name + initial and VIBE ID, never phone numbers here. A meetup's chat is shown only when something was
 * reported on it or on either person, or it was closed for sharing a contact detail; otherwise it stays private to the two people.
 */
@Service
public class SocialAdmin {
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    public record Person(String name, String vibeId) {}

    public record Overview(int members, int suspended, int hostsApproved, int hostsPending, Map<String, Integer> meetups, int upcomingBooked, int reportsOpen, int contactShared,
                           long depositsCollected, long depositsRefunded, int venuesTakingMeetups) {}

    public record MeetupRow(String id, String reference, OffsetDateTime createdAt, OffsetDateTime startsAt, String venue, String area, String kind, String activity, Person host, Person partner,
                            String payMode, long deposit, String status, String reservationStatus, String hostPayment, String hostPaymentStatus, String partnerPayment, String partnerPaymentStatus,
                            int requests, int reports, String cancelledBy, String cancelReason) {}

    public record MeetupPage(int total, List<MeetupRow> rows) {}

    public record RequestRow(Person person, String status, OffsetDateTime at) {}

    public record ChatLine(String from, String text, OffsetDateTime at) {}

    /** chat is null when it is private (nothing reported); chatNote says why. */
    public record MeetupDetail(MeetupRow meetup, List<RequestRow> requests, List<ChatLine> chat, String chatNote, List<ReportRow> reports) {}

    public record ReportRow(String id, Person reporter, String targetType, String targetId, String target, String reason, String note, String status, String resolution, OffsetDateTime createdAt,
                            String targetCustomerId) {}

    public record HostRow(String customerId, Person person, String phoneMasked, boolean member, String status, String legalName, String idType, String idLast4, LocalDate dateOfBirth, String city,
                          String about, OffsetDateTime submittedAt, OffsetDateTime reviewedAt, String reviewNote) {}

    public record MemberRow(String customerId, Person person, String gender, String ageBand, String status, String suspendedReason, boolean host, int hosted, int joined, int reportsAgainst,
                            OffsetDateTime joinedSocial) {}

    private final JdbcClient jdbc;
    private final SocialMembers members;
    private final AuditService audit;

    SocialAdmin(JdbcClient jdbc, SocialMembers members, AuditService audit) {
        this.jdbc = jdbc;
        this.members = members;
        this.audit = audit;
    }

    private static Person person(String name, String vibeId) { return name == null ? null : new Person(Customers.displayName(name), vibeId); }

    public Overview overview() {
        int[] m = jdbc.sql("select count(*), count(*) filter (where status = 'suspended') from social_profiles").query((rs, i) -> new int[]{rs.getInt(1), rs.getInt(2)}).single();
        int[] h = jdbc.sql("select count(*) filter (where status = 'approved'), count(*) filter (where status = 'pending') from social_hosts").query((rs, i) -> new int[]{rs.getInt(1), rs.getInt(2)}).single();
        Map<String, Integer> byStatus = new LinkedHashMap<>();
        for (String s : List.of("draft", "open", "awaiting_payment", "matched", "completed", "cancelled", "expired")) byStatus.put(s, 0);
        jdbc.sql("select status, count(*) from meetups group by status").query((rs, i) -> byStatus.put(rs.getString(1), rs.getInt(2))).list();
        int upcoming = jdbc.sql("select count(*) from meetups where status = 'matched' and starts_at > now()").query(Integer.class).single();
        int reports = jdbc.sql("select count(*) from social_reports where status = 'open'").query(Integer.class).single();
        int contact = jdbc.sql("select count(*) from meetups where chat_closed_reason = 'contact_shared'").query(Integer.class).single();
        long[] money = jdbc.sql("select coalesce(sum(p.amount), 0), coalesce(sum(p.refund_amount) filter (where p.refund_status is not null), 0) from payments p join payment_requests pr on pr.id = p.payment_request_id "
                + "where pr.kind = 'meetup' and p.status = 'verified'").query((rs, i) -> new long[]{rs.getLong(1), rs.getLong(2)}).single();
        int venues = jdbc.sql("select count(*) from reservation_settings rs join businesses b on b.id = rs.business_id join business_kyc k on k.business_id = b.id and k.status = 'verified' where rs.enabled and b.active and (rs.table_fee is not null or rs.slot_fee is not null)")
                .query(Integer.class).single();
        return new Overview(m[0], m[1], h[0], h[1], byStatus, upcoming, reports, contact, money[0], money[1], venues);
    }

    private static final String MEETUP_SELECT = "select m.id, m.reservation_ref, m.created_at, m.starts_at, b.name bname, b.area, m.kind, m.activity, hc.name hname, hc.vibe_id hvibe, pc.name pname, pc.vibe_id pvibe, "
            + "m.pay_mode, m.deposit, m.status, m.reservation_status, m.cancelled_by, m.cancel_reason, "
            + "hp.reference href, case when hp.refund_status is not null then 'refund ' || hp.refund_status else hp.status end hstat, "
            + "pp.reference pref, case when pp.refund_status is not null then 'refund ' || pp.refund_status else pp.status end pstat, "
            + "(select count(*) from meetup_requests r where r.meetup_id = m.id) nreq, "
            + "(select count(*) from social_reports sr where sr.target_type = 'meetup' and sr.target_id = m.id::text) nrep "
            + "from meetups m join businesses b on b.id = m.business_id join customers hc on hc.id = m.host_id left join customers pc on pc.id = m.partner_id "
            + "left join payments hp on hp.payment_request_id = m.host_payment_request_id and hp.status in ('pending', 'verified') "
            + "left join payments pp on pp.payment_request_id = m.partner_payment_request_id and pp.status in ('pending', 'verified')";

    private static MeetupRow row(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new MeetupRow(rs.getString("id"), rs.getString("reservation_ref"), rs.getObject("created_at", OffsetDateTime.class), rs.getObject("starts_at", OffsetDateTime.class), rs.getString("bname"),
                rs.getString("area"), rs.getString("kind"), rs.getString("activity"), person(rs.getString("hname"), rs.getString("hvibe")), person(rs.getString("pname"), rs.getString("pvibe")),
                rs.getString("pay_mode"), rs.getLong("deposit"), rs.getString("status"), rs.getString("reservation_status"), rs.getString("href"), rs.getString("hstat"), rs.getString("pref"),
                rs.getString("pstat"), rs.getInt("nreq"), rs.getInt("nrep"), rs.getString("cancelled_by"), rs.getString("cancel_reason"));
    }

    /** q: a VIBE ID, a reservation reference (VBM-…) or a transaction ID (VB-…). */
    public MeetupPage meetups(String status, String q, int limit, int offset) {
        StringBuilder w = new StringBuilder(" where true");
        Map<String, Object> p = new HashMap<>();
        if (status != null && !status.isBlank()) { w.append(" and m.status = :s"); p.put("s", status); }
        if (q != null && !q.isBlank()) {
            w.append(" and (hc.vibe_id = :q or pc.vibe_id = :q or upper(m.reservation_ref) = upper(:q) or upper(hp.reference) = upper(:q) or upper(pp.reference) = upper(:q))");
            p.put("q", q.trim());
        }
        JdbcClient.StatementSpec count = jdbc.sql("select count(*) from (" + MEETUP_SELECT + w + ") x");
        JdbcClient.StatementSpec rows = jdbc.sql(MEETUP_SELECT + w + " order by m.starts_at desc limit :lim offset :off").param("lim", Math.max(1, Math.min(limit, 2000))).param("off", Math.max(0, offset));
        p.forEach((k, v) -> { count.param(k, v); rows.param(k, v); });
        return new MeetupPage(count.query(Integer.class).single(), rows.query((rs, i) -> row(rs)).list());
    }

    public ResponseEntity<byte[]> meetupsCsv(String status, String q) {
        Csv csv = new Csv().row("Reference", "Created", "Starts", "Venue", "Area", "Kind", "Plan", "Host", "Host VIBE ID", "Guest", "Guest VIBE ID", "Who pays", "Deposit (Rs)", "Status", "Reservation",
                "Host transaction", "Host payment", "Guest transaction", "Guest payment", "Requests", "Reports", "Cancelled by", "Reason");
        for (MeetupRow r : meetups(status, q, 2000, 0).rows()) {
            csv.row(r.reference(), r.createdAt().atZoneSameInstant(IST).toLocalDateTime(), r.startsAt().atZoneSameInstant(IST).toLocalDateTime(), r.venue(), r.area(), r.kind(), r.activity(),
                    r.host().name(), r.host().vibeId(), r.partner() == null ? "" : r.partner().name(), r.partner() == null ? "" : r.partner().vibeId(), "split".equals(r.payMode()) ? "Split 50/50" : "Host in full",
                    Csv.rupees(r.deposit()), r.status(), r.reservationStatus(), r.hostPayment() == null ? "" : r.hostPayment(), r.hostPaymentStatus() == null ? "" : r.hostPaymentStatus(),
                    r.partnerPayment() == null ? "" : r.partnerPayment(), r.partnerPaymentStatus() == null ? "" : r.partnerPaymentStatus(), r.requests(), r.reports(),
                    r.cancelledBy() == null ? "" : r.cancelledBy(), r.cancelReason() == null ? "" : r.cancelReason());
        }
        return csv.download("vibe-social-meetups.csv");
    }

    public MeetupDetail meetup(StaffPrincipal who, UUID id) {
        MeetupRow r = jdbc.sql(MEETUP_SELECT + " where m.id = :id").param("id", id).query((rs, i) -> row(rs)).optional().orElseThrow(() -> ApiException.notFound("Meetup not found."));
        List<RequestRow> requests = jdbc.sql("select c.name, c.vibe_id, r.status, r.created_at from meetup_requests r join customers c on c.id = r.customer_id where r.meetup_id = :id order by r.created_at")
                .param("id", id).query((rs, i) -> new RequestRow(person(rs.getString(1), rs.getString(2)), rs.getString(3), rs.getObject(4, OffsetDateTime.class))).list();
        record Parties(UUID host, UUID partner, String reason) {}
        Parties parties = jdbc.sql("select host_id, partner_id, chat_closed_reason from meetups where id = :id").param("id", id)
                .query((rs, i) -> new Parties((UUID) rs.getObject(1), (UUID) rs.getObject(2), rs.getString(3))).single();
        List<ReportRow> reports = reports(null).stream().filter(x -> ("meetup".equals(x.targetType()) && x.targetId().equals(id.toString()))
                || ("user".equals(x.targetType()) && (memberOf(parties.host()).equals(x.targetId()) || (parties.partner() != null && memberOf(parties.partner()).equals(x.targetId()))))).toList();
        boolean open = !reports.isEmpty() || "contact_shared".equals(parties.reason());
        List<ChatLine> chat = null;
        String note = "Private: the chat is shown only when something is reported on this meetup or either person.";
        if (open) {
            chat = jdbc.sql("select s.name, m.text, m.created_at from meetup_messages m left join customers s on s.id = m.sender_id where m.meetup_id = :id order by m.created_at").param("id", id)
                    .query((rs, i) -> new ChatLine(rs.getString(1) == null ? "VIBE" : Customers.displayName(rs.getString(1)), rs.getString(2), rs.getObject(3, OffsetDateTime.class))).list();
            note = "Shown because of a report or a closed chat. Opening it is recorded in the audit log.";
            audit.record(who, "social_chat_view", "meetup", id, r.reference());
        }
        return new MeetupDetail(r, requests, chat, note, reports);
    }

    private String memberOf(UUID customer) {
        return jdbc.sql("select member_id::text from social_profiles where customer_id = :c").param("c", customer).query(String.class).optional().orElse("-");
    }

    // ---------- reports ----------
    public List<ReportRow> reports(String status) {
        return jdbc.sql("select r.id, c.name, c.vibe_id, r.target_type, r.target_id, r.reason, r.note, r.status, r.resolution, r.created_at, "
                        + "case when r.target_type = 'user' then (select tc.name || ' · VIBE ID ' || tc.vibe_id from social_profiles sp join customers tc on tc.id = sp.customer_id where sp.member_id::text = r.target_id) "
                        + "when r.target_type = 'meetup' then (select m.reservation_ref || ' · ' || m.activity from meetups m where m.id::text = r.target_id) else r.target_id end target, "
                        + "case when r.target_type = 'user' then (select sp.customer_id::text from social_profiles sp where sp.member_id::text = r.target_id) end target_customer "
                        + "from social_reports r left join customers c on c.id = r.reporter_id" + (status == null || status.isBlank() ? "" : " where r.status = :s") + " order by (r.status = 'open') desc, r.created_at desc limit 500")
                .param("s", status == null ? "" : status)
                .query((rs, i) -> new ReportRow(rs.getString(1), rs.getString(2) == null ? new Person("VIBE (automatic)", "") : person(rs.getString(2), rs.getString(3)), rs.getString(4), rs.getString(5),
                        rs.getString("target"), rs.getString(6), rs.getString(7), rs.getString(8), rs.getString(9), rs.getObject(10, OffsetDateTime.class),
                        rs.getString("target_customer"))).list();
    }

    /** action: dismiss, or action (with suspendMemberId to suspend the person reported). */
    @Transactional
    public ReportRow resolveReport(StaffPrincipal who, UUID id, String action, String note, String suspendCustomerId) {
        if (!List.of("dismiss", "action").contains(action)) throw ApiException.badRequest("action", "Choose dismiss or take action.");
        if (note == null || note.isBlank()) throw ApiException.badRequest("note", "Say what you decided.");
        int n = jdbc.sql("update social_reports set status = :s, resolution = :n, handled_by = :by, handled_at = now() where id = :id and status = 'open'")
                .param("s", "dismiss".equals(action) ? "dismissed" : "actioned").param("n", note.trim()).param("by", who.id()).param("id", id).update();
        if (n == 0) throw ApiException.conflict("handled", "This report has already been handled.");
        if ("action".equals(action) && suspendCustomerId != null && !suspendCustomerId.isBlank()) members.setSuspended(who, UUID.fromString(suspendCustomerId), true, note.trim());
        audit.record(who, "social_report_" + action, "social_report", id, note.trim());
        return reports(null).stream().filter(r -> r.id().equals(id.toString())).findFirst().orElseThrow();
    }

    // ---------- hosts ----------
    public List<HostRow> hosts(String status) {
        return jdbc.sql("select h.customer_id, c.name, c.vibe_id, c.phone, exists (select 1 from memberships ms where ms.customer_id = c.id and ms.valid_until > now()) member, h.status, h.legal_name, h.id_type, "
                        + "h.id_last4, h.date_of_birth, h.city, h.about, h.submitted_at, h.reviewed_at, h.review_note from social_hosts h join customers c on c.id = h.customer_id"
                        + (status == null || status.isBlank() ? "" : " where h.status = :s") + " order by (h.status = 'pending') desc, h.submitted_at desc").param("s", status == null ? "" : status)
                .query((rs, i) -> new HostRow(rs.getString(1), person(rs.getString(2), rs.getString(3)), mask(rs.getString(4)), rs.getBoolean(5), rs.getString(6), rs.getString(7), rs.getString(8),
                        rs.getString(9), rs.getObject(10, LocalDate.class), rs.getString(11), rs.getString(12), rs.getObject(13, OffsetDateTime.class), rs.getObject(14, OffsetDateTime.class), rs.getString(15))).list();
    }

    private static String mask(String phone) { return phone == null || phone.length() < 4 ? "" : "+91 •••••" + phone.substring(phone.length() - 4); }

    // ---------- members ----------
    public List<MemberRow> members(String q, String status) {
        StringBuilder w = new StringBuilder(" where true");
        if (status != null && !status.isBlank()) w.append(" and p.status = :s");
        if (q != null && !q.isBlank()) w.append(" and (c.vibe_id = :q or lower(c.name) like lower(:ql))");
        return jdbc.sql("select p.customer_id, c.name, c.vibe_id, p.gender, p.age_band, p.status, p.suspended_reason, coalesce(h.status = 'approved', false) host, "
                        + "(select count(*) from meetups m where m.host_id = p.customer_id and m.status <> 'draft') hosted, (select count(*) from meetups m where m.partner_id = p.customer_id) joined, "
                        + "(select count(*) from social_reports r where r.target_type = 'user' and r.target_id = p.member_id::text) against, p.created_at "
                        + "from social_profiles p join customers c on c.id = p.customer_id left join social_hosts h on h.customer_id = p.customer_id" + w + " order by against desc, p.created_at desc limit 500")
                .param("s", status == null ? "" : status).param("q", q == null ? "" : q.trim()).param("ql", q == null ? "" : q.trim() + "%")
                .query((rs, i) -> new MemberRow(rs.getString(1), person(rs.getString(2), rs.getString(3)), rs.getString(4), rs.getString(5), rs.getString(6), rs.getString(7), rs.getBoolean(8),
                        rs.getInt(9), rs.getInt(10), rs.getInt(11), rs.getObject(12, OffsetDateTime.class))).list();
    }
}
