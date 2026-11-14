package in.vibe.backend.social;

import in.vibe.backend.billing.Notifications;
import in.vibe.backend.billing.Refunds;
import in.vibe.backend.common.ApiException;
import in.vibe.backend.notify.StaffNotifications;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * One-on-one meetups that reserve a place before they go live, so only serious plans appear.
 * <ol>
 * <li>The creator picks a verified VIBE venue that takes meetup reservations, a time at least 4 hours ahead, and who pays: the creator in
 * full, or split 50/50. They pay their share of the venue's deposit; until then the plan is a draft only they can see.</li>
 * <li>Paid: the plan is live. Matching members (by who each is open to meeting) ask to join; the creator accepts one.</li>
 * <li>Paid in full: accepting books the table. Split: the person accepted has 30 minutes (and no later than the cut-off) to pay their
 * half; then the table is booked. Not paid in time: the plan goes back to open.</li>
 * <li>Cancel up to 3 hours before the start: every deposit is refunded. After that, nothing is refunded and the venue keeps the
 * deposit, which otherwise comes off the bill there. Nobody joins by the cut-off: the plan expires and the creator is refunded.</li>
 * <li>The venue holds the table until 30 minutes after the start and marks the guests arrived, or a no-show.</li>
 * </ol>
 * Chat opens when both are in, for meeting details only: sharing a contact detail closes it, blocks both people and raises a report.
 */
@Service
public class Meetups {
    private static final Logger log = LoggerFactory.getLogger(Meetups.class);
    public static final Duration CANCEL_CUTOFF = Duration.ofHours(3), HOLD_AFTER_START = Duration.ofMinutes(30), PARTNER_PAY_WINDOW = Duration.ofMinutes(30),
            HOST_PAY_WINDOW = Duration.ofMinutes(15), MIN_LEAD = Duration.ofHours(4), CHAT_AFTER_START = Duration.ofHours(2);
    public static final int MAX_DAYS_AHEAD = 14, CHAT_LIMIT = 30;
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final DateTimeFormatter WHEN = DateTimeFormatter.ofPattern("EEE d MMM, h:mm a", Locale.ENGLISH).withZone(IST);
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("h:mm a", Locale.ENGLISH).withZone(IST);
    private static final double HOME_LAT = 17.4326, HOME_LNG = 78.4071; // Jubilee Hills, when the member's area has no places to place it by

    public record Reservation(String kind, String title, String detail, long amount, String reference, OffsetDateTime confirmedAt, String policy) {}

    public record ReservationOption(String kind, String title, String description, Long fee, String policy) {}

    /** What I have to pay, when I have to: the creator for a draft, the person accepted for their half. */
    public record MyPayment(String paymentRequestId, long amount, OffsetDateTime payBy) {}

    public record Invite(String id, String kind, String activity, String note, String venueName, String venueBusinessId, String area, OffsetDateTime startsAt, int durationMin, String costNote,
                         SocialMembers.MemberCard host, String openTo, String status, String myStatus, List<SocialMembers.MemberCard> requests, SocialMembers.MemberCard matchedWith,
                         String coverUrl, double distanceKm, Reservation reservation, ReservationOption reservationOption, String payMode, long deposit, long share,
                         OffsetDateTime cancelBy, OffsetDateTime holdUntil, MyPayment myPayment, String cancelledReason) {}

    public record Input(@NotBlank String kind, @NotBlank @Size(min = 2, max = 60) String activity, @NotBlank String venueBusinessId, @NotNull OffsetDateTime startsAt,
                        @NotBlank String openTo, @Size(max = 140) String note, String payMode) {}

    public record Venue(String businessId, String name, String area, String kind, long deposit, String policy, String coverUrl, double distanceKm) {}

    public record ChatMessage(String id, String from, String text, OffsetDateTime at, boolean quick) {}

    public record Chat(String inviteId, SocialMembers.MemberCard counterpart, String venueName, OffsetDateTime startsAt, String status, String closedReason, List<ChatMessage> messages,
                       int used, int limit, OffsetDateTime closesAt, Reservation reservation) {}

    public record SendInput(String template, @Size(max = 120) String value, @Size(max = 300) String text) {}

    public record SendResult(boolean delivered, String rejection, Chat chat) {}

    /** A meetup reservation as the venue sees it: first names only, the reference to seat them by, the deposit to take off the bill. */
    public record VenueReservation(String reference, OffsetDateTime startsAt, OffsetDateTime holdUntil, int party, String guests, String activity, String status, long deposit,
                                   long depositPaid, String payMode) {}

    private final JdbcClient jdbc;
    private final SocialMembers members;
    private final Refunds refunds;
    private final Notifications notifications;
    private final StaffNotifications staff;
    private final Clock clock;
    private final SecureRandom random = new SecureRandom();

    Meetups(JdbcClient jdbc, SocialMembers members, Refunds refunds, Notifications notifications, StaffNotifications staff, Clock clock) {
        this.jdbc = jdbc;
        this.members = members;
        this.refunds = refunds;
        this.notifications = notifications;
        this.staff = staff;
        this.clock = clock;
    }

    private OffsetDateTime now() { return OffsetDateTime.now(clock); }

    private String code(int n) {
        String letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < n; i++) b.append(letters.charAt(random.nextInt(letters.length())));
        return b.toString();
    }

    static String rupees(long paise) { return in.vibe.backend.billing.Redemptions.rupees(paise); }

    // ---------- the meetup row ----------
    private record M(UUID id, UUID host, String kind, String activity, String note, UUID business, OffsetDateTime startsAt, int duration, String openTo, String payMode, String resKind,
                     long deposit, String status, UUID partner, OffsetDateTime partnerPayBy, UUID hostPr, UUID partnerPr, String ref, String resStatus, String chatStatus, String chatReason,
                     String cancelledBy, String cancelReason, OffsetDateTime createdAt) {
        OffsetDateTime cutoff() { return startsAt.minus(CANCEL_CUTOFF); }
        OffsetDateTime holdUntil() { return startsAt.plus(HOLD_AFTER_START); }
        long partnerShare() { return "split".equals(payMode) ? deposit / 2 : 0; }
        long hostShare() { return deposit - partnerShare(); }
    }

    private static final String M_COLS = "id, host_id, kind, activity, note, business_id, starts_at, duration_min, open_to, pay_mode, reservation_kind, deposit, status, partner_id, partner_pay_by, "
            + "host_payment_request_id, partner_payment_request_id, reservation_ref, reservation_status, chat_status, chat_closed_reason, cancelled_by, cancel_reason, created_at";

    private M m(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new M((UUID) rs.getObject("id"), (UUID) rs.getObject("host_id"), rs.getString("kind"), rs.getString("activity"), rs.getString("note"), (UUID) rs.getObject("business_id"),
                rs.getObject("starts_at", OffsetDateTime.class), rs.getInt("duration_min"), rs.getString("open_to"), rs.getString("pay_mode"), rs.getString("reservation_kind"), rs.getLong("deposit"),
                rs.getString("status"), (UUID) rs.getObject("partner_id"), rs.getObject("partner_pay_by", OffsetDateTime.class), (UUID) rs.getObject("host_payment_request_id"),
                (UUID) rs.getObject("partner_payment_request_id"), rs.getString("reservation_ref"), rs.getString("reservation_status"), rs.getString("chat_status"), rs.getString("chat_closed_reason"),
                rs.getString("cancelled_by"), rs.getString("cancel_reason"), rs.getObject("created_at", OffsetDateTime.class));
    }

    private M load(UUID id, boolean lock) {
        return jdbc.sql("select " + M_COLS + " from meetups where id = :id" + (lock ? " for update" : "")).param("id", id).query((rs, i) -> m(rs)).optional()
                .orElseThrow(() -> ApiException.notFound("This plan isn’t available."));
    }

    static UUID uuid(String s) {
        try { return UUID.fromString(s); } catch (IllegalArgumentException e) { throw ApiException.notFound("Not found."); }
    }

    // ---------- venues ----------
    private static String topSlug(String kind) {
        return switch (kind) {
            case "coffee", "food" -> "food";
            case "sport" -> "fitness";
            case "movie" -> throw ApiException.conflict("movies_soon", "Movie meetups arrive with movie tickets on VIBE. Choose coffee, food or sport for now.");
            default -> throw ApiException.badRequest("kind", "Choose coffee, food, sport or movie.");
        };
    }

    private static final String VENUE_WHERE = "from businesses b join reservation_settings rs on rs.business_id = b.id join business_kyc k on k.business_id = b.id and k.status = 'verified' "
            + "where b.active and rs.enabled and b.primary_category_id in (with recursive t as (select id from categories where slug = :slug union all select c.id from categories c join t on c.parent_id = t.id) select id from t)";

    /** Venues that take meetup reservations for this kind of plan: active, KYC-verified, reservations on, and a deposit set. */
    public List<Venue> venues(UUID customer, String kind) {
        String slug = topSlug(kind);
        String fee = "fitness".equals(slug) ? "rs.slot_fee" : "rs.table_fee";
        double[] home = home(customer);
        return jdbc.sql("select b.id, b.name, b.area, " + fee + " fee, rs.policy, b.cover_url, b.lat, b.lng " + VENUE_WHERE + " and " + fee + " is not null order by b.name limit 40").param("slug", slug)
                .query((rs, i) -> new Venue(rs.getString(1), rs.getString(2), rs.getString(3), "fitness".equals(slug) ? "slot" : "table", rs.getLong(4), policy(rs.getString(5)), rs.getString(6),
                        km(home, rs.getObject(7, Double.class), rs.getObject(8, Double.class)))).list()
                .stream().sorted(java.util.Comparator.comparingDouble(Venue::distanceKm)).toList();
    }

    static String policy(String venuePolicy) {
        String base = "Cancel up to 3 hours before for a full refund. After that the venue keeps the deposit. The table is held until 30 minutes after the start, and the deposit comes off your bill there.";
        return venuePolicy == null || venuePolicy.isBlank() ? base : base + " " + venuePolicy.trim();
    }

    private double[] home(UUID customer) {
        return jdbc.sql("select avg(b.lat), avg(b.lng) from businesses b join customers c on c.area = b.area where c.id = :c and b.lat is not null").param("c", customer)
                .query((rs, i) -> rs.getObject(1) == null ? new double[]{HOME_LAT, HOME_LNG} : new double[]{rs.getDouble(1), rs.getDouble(2)}).single();
    }

    private static double km(double[] from, Double lat, Double lng) {
        if (lat == null || lng == null) return 0;
        double dLat = Math.toRadians(lat - from[0]), dLng = Math.toRadians(lng - from[1]);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(Math.toRadians(from[0])) * Math.cos(Math.toRadians(lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return Math.round(6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10.0;
    }

    // ---------- create ----------
    @Transactional
    public Invite create(UUID customer, Input in) {
        members.requireActive(customer);
        String slug = topSlug(in.kind());
        if (!List.of("men", "women", "anyone").contains(in.openTo())) throw ApiException.badRequest("open_to", "Choose who can join.");
        String payMode = in.payMode() == null || in.payMode().isBlank() ? "full" : in.payMode();
        if (!List.of("full", "split").contains(payMode)) throw ApiException.badRequest("pay_mode", "Choose who pays: you in full, or split 50/50.");
        OffsetDateTime start = in.startsAt();
        if (start.isBefore(now().plus(MIN_LEAD))) throw ApiException.badRequest("starts_at", "Choose a time at least 4 hours from now, so there’s time for someone to join before the 3-hour cut-off.");
        if (start.isAfter(now().plusDays(MAX_DAYS_AHEAD))) throw ApiException.badRequest("starts_at", "Choose a time within the next " + MAX_DAYS_AHEAD + " days.");
        UUID business = uuid(in.venueBusinessId());
        String fee = "fitness".equals(slug) ? "rs.slot_fee" : "rs.table_fee";
        record V(String name, Long fee, int perHour) {}
        V v = jdbc.sql("select b.name, " + fee + ", rs.meetups_per_hour " + VENUE_WHERE + " and b.id = :b").param("slug", slug).param("b", business)
                .query((rs, i) -> new V(rs.getString(1), rs.getObject(2, Long.class), rs.getInt(3))).optional()
                .orElseThrow(() -> ApiException.conflict("venue", "That place doesn’t take meetup reservations. Choose one from the list."));
        if (v.fee() == null) throw ApiException.conflict("venue", "That place hasn’t set a deposit for meetups yet.");
        if ("split".equals(payMode) && v.fee() < 200) throw ApiException.badRequest("pay_mode", "This deposit is too small to split.");
        // One open plan per person at a time, and no more meetups in that hour than the venue takes.
        int mine = jdbc.sql("select count(*) from meetups where host_id = :c and status in ('draft', 'open', 'awaiting_payment')").param("c", customer).query(Integer.class).single();
        if (mine >= 2) throw ApiException.conflict("too_many", "You already have open plans. Wait for someone to join, or cancel one first.");
        OffsetDateTime hour = start.withMinute(0).withSecond(0).withNano(0);
        int taken = jdbc.sql("select count(*) from meetups where business_id = :b and status in ('open', 'awaiting_payment', 'matched') and starts_at >= :h and starts_at < :h2")
                .param("b", business).param("h", hour).param("h2", hour.plusHours(1)).query(Integer.class).single();
        if (taken >= v.perHour()) throw ApiException.conflict("full", v.name() + " is fully reserved for meetups at that time. Choose another time or place.");

        UUID id = UUID.randomUUID();
        String ref = "VBM-" + code(4) + "-" + code(4);
        jdbc.sql("insert into meetups (id, host_id, kind, activity, note, business_id, starts_at, open_to, pay_mode, reservation_kind, deposit, reservation_ref) "
                        + "values (:id, :h, :k, :a, :n, :b, :s, :o, :p, :rk, :d, :ref)")
                .param("id", id).param("h", customer).param("k", in.kind()).param("a", in.activity().trim()).param("n", in.note() == null ? "" : in.note().trim()).param("b", business).param("s", start)
                .param("o", in.openTo()).param("p", payMode).param("rk", "fitness".equals(slug) ? "slot" : "table").param("d", v.fee()).param("ref", ref).update();
        M m = load(id, true);
        UUID pr = paymentRequest(m, customer, m.hostShare(), now().plus(HOST_PAY_WINDOW), "split".equals(payMode) ? "your half" : "in full");
        jdbc.sql("update meetups set host_payment_request_id = :pr where id = :id").param("pr", pr).param("id", id).update();
        return invite(customer, id);
    }

    private UUID paymentRequest(M m, UUID customer, long amount, OffsetDateTime expires, String whose) {
        UUID pr = UUID.randomUUID();
        String venue = jdbc.sql("select name from businesses where id = :b").param("b", m.business()).query(String.class).single();
        jdbc.sql("insert into payment_requests (id, kind, business_id, customer_id, bill_ref, raised_by, eligible_amount, discount, discount_label, vibe_fee, payable, expires_at, meetup_id) "
                        + "values (:id, 'meetup', :b, :c, :ref, 'VIBE Social', :a, 0, '', 0, :a, :x, :m)")
                .param("id", pr).param("b", m.business()).param("c", customer).param("ref", m.ref()).param("a", amount).param("x", expires).param("m", m.id()).update();
        jdbc.sql("insert into payment_request_lines (payment_request_id, position, label, amount) values (:p, 0, :l, :a)")
                .param("p", pr).param("l", ("table".equals(m.resKind()) ? "Table" : "Slot") + " deposit at " + venue + " · " + WHEN.format(m.startsAt()) + " (" + whose + ")").param("a", amount).update();
        return pr;
    }

    /** Pay (again) for a draft, or pay my half once accepted. Returns the payment request to check out. */
    @Transactional
    public String reservationPayment(UUID customer, UUID id) {
        sweep();
        M m = load(id, true);
        if (m.host().equals(customer) && "draft".equals(m.status())) {
            if (open(m.hostPr())) return m.hostPr().toString();
            UUID pr = paymentRequest(m, customer, m.hostShare(), now().plus(HOST_PAY_WINDOW), "split".equals(m.payMode()) ? "your half" : "in full");
            jdbc.sql("update meetups set host_payment_request_id = :pr, updated_at = now() where id = :id").param("pr", pr).param("id", id).update();
            return pr.toString();
        }
        if (customer.equals(m.partner()) && "awaiting_payment".equals(m.status()) && m.partnerPr() != null) return m.partnerPr().toString();
        throw ApiException.conflict("nothing_to_pay", "There’s nothing for you to pay on this plan.");
    }

    private boolean open(UUID pr) {
        return pr != null && jdbc.sql("select count(*) from payment_requests where id = :p and status = 'open' and expires_at > :n").param("p", pr).param("n", now()).query(Integer.class).single() > 0;
    }

    /** A payment that's under way or confirmed (so the plan mustn't be undone under it). */
    private boolean paying(UUID pr) {
        return pr != null && jdbc.sql("select count(*) from payments where payment_request_id = :p and status in ('pending', 'verified')").param("p", pr).query(Integer.class).single() > 0;
    }

    private String paidReference(UUID pr) {
        if (pr == null) return null;
        return jdbc.sql("select reference from payments where payment_request_id = :p and status = 'verified'").param("p", pr).query(String.class).optional().orElse(null);
    }

    // ---------- payment confirmed (inside the transaction that verifies it) ----------
    public void paid(UUID paymentRequest) {
        M m = jdbc.sql("select " + M_COLS + " from meetups where host_payment_request_id = :p or partner_payment_request_id = :p for update").param("p", paymentRequest).query((rs, i) -> m(rs)).optional().orElse(null);
        if (m == null) return;
        String venue = jdbc.sql("select name from businesses where id = :b").param("b", m.business()).query(String.class).single();
        if (paymentRequest.equals(m.hostPr())) {
            if ("draft".equals(m.status())) {
                jdbc.sql("update meetups set status = 'open', updated_at = now() where id = :id").param("id", m.id()).update();
                notifications.notify(m.host(), "meetup_live", "Your plan is live", m.activity() + " at " + venue + ", " + WHEN.format(m.startsAt())
                        + ". If nobody joins by " + TIME.format(m.cutoff()) + ", it ends and your deposit is refunded.", "meetup", m.id().toString());
            } else {
                refundPayment(paymentRequest, "Paid after the plan had ended", m.host());
            }
            return;
        }
        if (paymentRequest.equals(m.partnerPr())) {
            if ("awaiting_payment".equals(m.status()) && m.partner() != null) matched(m, venue);
            else refundPayment(paymentRequest, "Paid after the plan had changed", m.partner());
        }
    }

    private void matched(M m, String venue) {
        jdbc.sql("update meetups set status = 'matched', reservation_status = 'confirmed', partner_pay_by = null, updated_at = now() where id = :id").param("id", m.id()).update();
        jdbc.sql("update meetup_requests set status = 'accepted', updated_at = now() where meetup_id = :id and customer_id = :p").param("id", m.id()).param("p", m.partner()).update();
        for (UUID other : jdbc.sql("select customer_id from meetup_requests where meetup_id = :id and status = 'requested'").param("id", m.id()).query(UUID.class).list()) {
            notifications.notify(other, "meetup_declined", "That plan is taken", m.activity() + " at " + venue + " found someone. Have a look at other plans.", "meetup", m.id().toString());
        }
        jdbc.sql("update meetup_requests set status = 'declined', updated_at = now() where meetup_id = :id and status = 'requested'").param("id", m.id()).update();
        String partnerName = members.card(m.partner()).firstName(), hostName = members.card(m.host()).firstName();
        String plan = venue + ", " + WHEN.format(m.startsAt()) + ". Your table is held until " + TIME.format(m.holdUntil()) + "; the ₹" + rupees(m.deposit()) + " deposit comes off the bill.";
        notifications.notify(m.host(), "meetup_matched", "You’re meeting " + partnerName, plan, "meetup", m.id().toString());
        notifications.notify(m.partner(), "meetup_matched", "You’re meeting " + hostName, plan, "meetup", m.id().toString());
        system(m.id(), "Booked: " + ("table".equals(m.resKind()) ? "table for 2" : "a slot for 2") + " at " + plan + " Reference " + m.ref() + ".");
        staff.toBusiness(m.business(), "meetup_reserved", ("table".equals(m.resKind()) ? "Table" : "Slot") + " reserved for 2 · " + WHEN.format(m.startsAt()),
                "VIBE meetup " + m.ref() + ". Hold it until " + TIME.format(m.holdUntil()) + ". Take the ₹" + rupees(m.deposit()) + " deposit off their bill.", "/reservations");
    }

    private void system(UUID meetup, String text) {
        jdbc.sql("insert into meetup_messages (id, meetup_id, sender_id, text) values (:id, :m, null, :t)").param("id", UUID.randomUUID()).param("m", meetup).param("t", text.length() > 300 ? text.substring(0, 300) : text).update();
    }

    // ---------- refunds ----------
    /** Raises a full refund of one deposit payment. The venue bears it unless it has already been paid out, when VIBE does. */
    private void refundPayment(UUID pr, String reason, UUID customer) {
        String ref = paidReference(pr);
        if (ref == null) return;
        boolean already = jdbc.sql("select refund_status is not null from payments where reference = :r").param("r", ref).query(Boolean.class).single();
        if (already) return;
        boolean settled = jdbc.sql("select exists (select 1 from settlement_items si join payments p on p.id = si.payment_id where p.reference = :r)").param("r", ref).query(Boolean.class).single();
        refunds.raise(null, ref, new Refunds.RaiseInput(null, reason, settled ? "vibe" : "merchant"));
        if (customer != null) notifications.notify(customer, "meetup_refund", "Your deposit is being refunded", reason + ". Transaction " + ref + ".", "payment", ref);
    }

    private void refundAll(M m, String reason) {
        refundPayment(m.hostPr(), reason, m.host());
        refundPayment(m.partnerPr(), reason, m.partner());
        jdbc.sql("update meetups set refunded = true where id = :id").param("id", m.id()).update();
    }

    private void voidRequest(UUID pr) {
        if (pr != null) jdbc.sql("update payment_requests set status = 'void' where id = :p and status = 'open' and not exists (select 1 from payments x where x.payment_request_id = :p and x.status in ('pending', 'verified'))")
                .param("p", pr).update();
    }

    // ---------- ask, accept, cancel ----------
    @Transactional
    public Invite request(UUID customer, UUID id) {
        members.requireActive(customer);
        sweep();
        M m = load(id, true);
        if (m.host().equals(customer)) throw ApiException.badRequest("own", "This is your own plan.");
        if (!"open".equals(m.status())) throw ApiException.conflict("not_open", "This plan isn’t taking requests any more.");
        if (!now().isBefore(m.cutoff())) throw ApiException.conflict("too_late", "It’s too close to the start to join.");
        if (members.blockedEitherWay(customer, m.host())) throw ApiException.notFound("This plan isn’t available.");
        if (!suits(m.host(), m.openTo(), customer)) throw ApiException.forbidden("This plan is for people the host is open to meeting.");
        jdbc.sql("insert into meetup_requests (meetup_id, customer_id) values (:m, :c) on conflict (meetup_id, customer_id) do update set status = 'requested', updated_at = now()")
                .param("m", id).param("c", customer).update();
        notifications.notify(m.host(), "meetup_request", members.card(customer).firstName() + " wants to join", m.activity() + ", " + WHEN.format(m.startsAt()) + ". Accept or decline in Social.", "meetup", id.toString());
        return invite(customer, id);
    }

    /** Both ways: the host is open to the requester's gender, and the requester is open to the host's. */
    private boolean suits(UUID host, String hostOpenTo, UUID customer) {
        String[] g = jdbc.sql("select (select gender from social_profiles where customer_id = :h), (select meet_preference from social_profiles where customer_id = :c), (select gender from social_profiles where customer_id = :c)")
                .param("h", host).param("c", customer).query((rs, i) -> new String[]{rs.getString(1), rs.getString(2), rs.getString(3)}).single();
        return fits(hostOpenTo, g[2]) && fits(g[1], g[0]);
    }

    private static boolean fits(String openTo, String gender) {
        return "anyone".equals(openTo) || ("men".equals(openTo) && "man".equals(gender)) || ("women".equals(openTo) && "woman".equals(gender));
    }

    @Transactional
    public Invite respond(UUID customer, UUID id, String memberId, boolean accept) {
        sweep();
        M m = load(id, true);
        if (!m.host().equals(customer)) throw ApiException.forbidden("Only the host can answer requests.");
        UUID requester = members.customerOf(memberId);
        String rs = jdbc.sql("select status from meetup_requests where meetup_id = :m and customer_id = :c").param("m", id).param("c", requester).query(String.class).optional().orElse(null);
        if (!"requested".equals(rs)) throw ApiException.conflict("no_request", "That request isn’t waiting any more.");
        String venue = jdbc.sql("select name from businesses where id = :b").param("b", m.business()).query(String.class).single();
        if (!accept) {
            jdbc.sql("update meetup_requests set status = 'declined', updated_at = now() where meetup_id = :m and customer_id = :c").param("m", id).param("c", requester).update();
            notifications.notify(requester, "meetup_declined", "Not this time", "The host went with someone else for " + m.activity() + ". Have a look at other plans.", "meetup", id.toString());
            return invite(customer, id);
        }
        if (!"open".equals(m.status())) throw ApiException.conflict("not_open", "You’ve already accepted someone for this plan.");
        if (!now().isBefore(m.cutoff())) throw ApiException.conflict("too_late", "It’s past the cut-off for this plan.");
        jdbc.sql("update meetups set partner_id = :p, updated_at = now() where id = :id").param("p", requester).param("id", id).update();
        if ("full".equals(m.payMode())) {
            matched(load(id, true), venue);
        } else {
            OffsetDateTime payBy = now().plus(PARTNER_PAY_WINDOW);
            if (payBy.isAfter(m.cutoff())) payBy = m.cutoff();
            M now = load(id, true);
            UUID pr = paymentRequest(now, requester, now.partnerShare(), payBy, "your half");
            jdbc.sql("update meetups set status = 'awaiting_payment', partner_pay_by = :by, partner_payment_request_id = :pr, updated_at = now() where id = :id")
                    .param("by", payBy).param("pr", pr).param("id", id).update();
            jdbc.sql("update meetup_requests set status = 'accepted', updated_at = now() where meetup_id = :m and customer_id = :c").param("m", id).param("c", requester).update();
            notifications.notify(requester, "meetup_pay", members.card(m.host()).firstName() + " accepted: pay your half", "Pay ₹" + rupees(now.partnerShare()) + " by " + TIME.format(payBy)
                    + " to book the table at " + venue + ". It comes off your bill there.", "meetup", id.toString());
        }
        return invite(customer, id);
    }

    /** The host cancels the plan, the person in it cancels, or someone who asked withdraws. Refunds only before the cut-off. */
    @Transactional
    public void cancel(UUID customer, UUID id) {
        sweep();
        M m = load(id, true);
        String venue = jdbc.sql("select name from businesses where id = :b").param("b", m.business()).query(String.class).single();
        boolean beforeCutoff = now().isBefore(m.cutoff());
        if (m.host().equals(customer)) {
            if (List.of("cancelled", "expired", "completed").contains(m.status())) throw ApiException.conflict("over", "This plan has already ended.");
            if ("draft".equals(m.status())) {
                if (paying(m.hostPr())) throw ApiException.conflict("paying", "Your payment is going through. Wait a moment, then cancel.");
                voidRequest(m.hostPr());
                end(m, "cancelled", "host", "Cancelled before paying");
                return;
            }
            end(m, "cancelled", "host", beforeCutoff ? "Cancelled by the host" : "Cancelled by the host after the cut-off");
            if (beforeCutoff) refundAll(m, "The plan was cancelled more than 3 hours before the start");
            voidRequest(m.partnerPr());
            tell(m, m.partner(), "Plan cancelled", m.activity() + " at " + venue + " was cancelled by the host." + (beforeCutoff && m.partner() != null && paidReference(m.partnerPr()) != null ? " Your deposit is being refunded." : ""));
            for (UUID r : jdbc.sql("select customer_id from meetup_requests where meetup_id = :m and status = 'requested'").param("m", id).query(UUID.class).list()) {
                notifications.notify(r, "meetup_cancelled", "Plan cancelled", m.activity() + " at " + venue + " was cancelled by the host.", "meetup", id.toString());
            }
            return;
        }
        if (customer.equals(m.partner())) {
            if ("awaiting_payment".equals(m.status())) {
                if (paying(m.partnerPr())) throw ApiException.conflict("paying", "Your payment is going through. Wait a moment, then cancel.");
                voidRequest(m.partnerPr());
                reopen(m, "withdrawn");
                notifications.notify(m.host(), "meetup_reopened", "Your plan is open again", members.card(customer).firstName() + " stepped back. Others can ask to join.", "meetup", id.toString());
                return;
            }
            if ("matched".equals(m.status())) {
                end(m, "cancelled", "partner", beforeCutoff ? "Cancelled by the guest" : "Cancelled by the guest after the cut-off");
                if (beforeCutoff) refundAll(m, "The plan was cancelled more than 3 hours before the start");
                tell(m, m.host(), "Plan cancelled", members.card(customer).firstName() + " cancelled " + m.activity() + " at " + venue + "." + (beforeCutoff ? " Your deposit is being refunded." : ""));
                return;
            }
            throw ApiException.conflict("over", "This plan has already ended.");
        }
        int n = jdbc.sql("update meetup_requests set status = 'withdrawn', updated_at = now() where meetup_id = :m and customer_id = :c and status = 'requested'").param("m", id).param("c", customer).update();
        if (n == 0) throw ApiException.conflict("nothing", "You’re not part of this plan.");
    }

    private void tell(M m, UUID who, String title, String body) {
        if (who != null) notifications.notify(who, "meetup_cancelled", title, body, "meetup", m.id().toString());
    }

    private void end(M m, String status, String by, String reason) {
        jdbc.sql("update meetups set status = :s, cancelled_by = :by, cancel_reason = :r, cancelled_at = now(), reservation_status = case when reservation_status in ('arrived', 'no_show') then reservation_status else 'released' end, "
                        + "chat_status = 'closed', chat_closed_reason = coalesce(chat_closed_reason, 'cancelled'), updated_at = now() where id = :id")
                .param("s", status).param("by", by).param("r", reason).param("id", m.id()).update();
        if ("matched".equals(m.status()) || "awaiting_payment".equals(m.status())) {
            staff.toBusiness(m.business(), "meetup_released", "Meetup reservation released · " + WHEN.format(m.startsAt()), "VIBE meetup " + m.ref() + " won’t be coming. " + reason + ".", "/reservations");
        }
    }

    private void reopen(M m, String requestStatus) {
        jdbc.sql("update meetups set status = 'open', partner_id = null, partner_pay_by = null, partner_payment_request_id = null, updated_at = now() where id = :id").param("id", m.id()).update();
        jdbc.sql("update meetup_requests set status = :s, updated_at = now() where meetup_id = :m and customer_id = :c").param("s", requestStatus).param("m", m.id()).param("c", m.partner()).update();
    }

    // ---------- time-based changes ----------
    /** Runs every minute, and before anything that depends on time. Each change is made once, under a row lock. */
    @Scheduled(fixedDelay = 60_000, initialDelay = 30_000)
    @Transactional
    public void sweep() {
        OffsetDateTime n = now();
        // Drafts never paid.
        for (UUID id : jdbc.sql("select m.id from meetups m join payment_requests pr on pr.id = m.host_payment_request_id where m.status = 'draft' and pr.expires_at < :n").param("n", n).query(UUID.class).list()) {
            M m = load(id, true);
            if (!"draft".equals(m.status()) || paying(m.hostPr())) continue;
            voidRequest(m.hostPr());
            end(m, "cancelled", "system", "Not paid in time");
        }
        // Accepted, but the half wasn't paid in time: open again.
        for (UUID id : jdbc.sql("select id from meetups where status = 'awaiting_payment' and partner_pay_by < :n").param("n", n).query(UUID.class).list()) {
            M m = load(id, true);
            if (!"awaiting_payment".equals(m.status()) || paying(m.partnerPr())) continue;
            voidRequest(m.partnerPr());
            reopen(m, "lapsed");
            notifications.notify(m.partner(), "meetup_lapsed", "Time to pay ran out", "Your place on " + m.activity() + " was released because your half wasn’t paid in time.", "meetup", id.toString());
            notifications.notify(m.host(), "meetup_reopened", "Your plan is open again", "The person you accepted didn’t pay in time. Others can ask to join.", "meetup", id.toString());
        }
        // Nobody in by the cut-off: the plan ends and the deposit goes back.
        for (UUID id : jdbc.sql("select id from meetups where status in ('open', 'awaiting_payment') and starts_at <= :c").param("c", n.plus(CANCEL_CUTOFF)).query(UUID.class).list()) {
            M m = load(id, true);
            if (!List.of("open", "awaiting_payment").contains(m.status()) || paying(m.partnerPr()) && "awaiting_payment".equals(m.status()) && paidReference(m.partnerPr()) == null) continue;
            voidRequest(m.partnerPr());
            end(m, "expired", "system", "Nobody joined before the cut-off");
            refundAll(m, "Nobody joined your plan before the 3-hour cut-off");
            jdbc.sql("update meetup_requests set status = 'lapsed', updated_at = now() where meetup_id = :m and status in ('requested', 'accepted')").param("m", id).update();
        }
        // Over: the chat closes.
        jdbc.sql("update meetups set status = 'completed', chat_status = 'closed', chat_closed_reason = coalesce(chat_closed_reason, 'ended'), updated_at = now() "
                + "where status = 'matched' and starts_at + make_interval(mins => duration_min) < :n").param("n", n).update();
    }

    // ---------- reading ----------
    public List<Invite> list(UUID customer, String when, boolean nearMe) {
        members.requireActive(customer);
        sweep();
        OffsetDateTime n = now();
        StringBuilder w = new StringBuilder();
        if ("hour".equals(when)) w.append(" and m.starts_at < :n + interval '1 hour'");
        else if ("today".equals(when)) w.append(" and (m.starts_at at time zone 'Asia/Kolkata')::date = (:n at time zone 'Asia/Kolkata')::date");
        else if ("week".equals(when)) w.append(" and m.starts_at < :n + interval '7 days'");
        List<UUID> ids = jdbc.sql("select m.id from meetups m join social_profiles hp on hp.customer_id = m.host_id where "
                        + "(m.host_id = :c and (m.status <> 'cancelled' or m.cancelled_by <> 'system' and m.updated_at > :n - interval '2 days') and m.starts_at > :n - interval '1 day') "
                        + "or (m.partner_id = :c and m.starts_at > :n - interval '1 day') "
                        + "or (exists (select 1 from meetup_requests r where r.meetup_id = m.id and r.customer_id = :c and r.status in ('requested', 'accepted')) and m.starts_at > :n) "
                        + "or (m.status = 'open' and m.host_id <> :c and hp.status = 'active' and m.starts_at > :n + interval '3 hours'" + w
                        + " and not exists (select 1 from social_blocks b where (b.blocker_id = :c and b.blocked_id = m.host_id) or (b.blocker_id = m.host_id and b.blocked_id = :c))) "
                        + "order by m.starts_at limit 100")
                .param("c", customer).param("n", n).query(UUID.class).list();
        List<Invite> out = new ArrayList<>();
        for (UUID id : ids) {
            Invite i = invite(customer, id);
            if ("none".equals(i.myStatus())) {
                M m = load(id, false);
                if (!suits(m.host(), m.openTo(), customer)) continue;
                if (nearMe && i.distanceKm() > 6) continue;
            }
            out.add(i);
        }
        return out;
    }

    public Invite invite(UUID customer, UUID id) {
        M m = load(id, false);
        boolean host = m.host().equals(customer), partner = customer.equals(m.partner());
        String requestStatus = jdbc.sql("select status from meetup_requests where meetup_id = :m and customer_id = :c").param("m", id).param("c", customer).query(String.class).optional().orElse(null);
        if (!host && !partner && requestStatus == null && !"open".equals(m.status())) throw ApiException.notFound("This plan isn’t available.");
        if ("draft".equals(m.status()) && !host) throw ApiException.notFound("This plan isn’t available.");
        record B(String name, String area, String cover, Double lat, Double lng) {}
        B b = jdbc.sql("select name, area, cover_url, lat, lng from businesses where id = :b").param("b", m.business())
                .query((rs, i) -> new B(rs.getString(1), rs.getString(2), rs.getString(3), rs.getObject(4, Double.class), rs.getObject(5, Double.class))).single();
        String myStatus = host ? "host" : partner && "awaiting_payment".equals(m.status()) ? "pay" : partner ? "confirmed" : "requested".equals(requestStatus) ? "requested" : "none";
        List<SocialMembers.MemberCard> requests = host ? jdbc.sql("select customer_id from meetup_requests where meetup_id = :m and status = 'requested' order by created_at").param("m", id)
                .query(UUID.class).list().stream().map(members::card).toList() : List.of();
        SocialMembers.MemberCard matchedWith = (host || partner) && m.partner() != null ? members.card(host ? m.partner() : m.host()) : null;
        boolean insider = host || partner;
        Reservation reservation = null;
        if (!"draft".equals(m.status()) && !List.of("cancelled", "expired").contains(m.status()) || insider && paidReference(m.hostPr()) != null && !"draft".equals(m.status())) {
            boolean booked = "matched".equals(m.status()) || "completed".equals(m.status());
            String title = ("table".equals(m.resKind()) ? "Table for 2" : "Slot for 2") + (booked ? " · booked" : " · booked when someone joins");
            reservation = new Reservation(m.resKind(), title, insider ? "Held until " + TIME.format(m.holdUntil()) + " · ₹" + rupees(m.deposit()) + " deposit comes off the bill" : null,
                    // What has actually been paid so far: in a split plan, only the creator's half until the guest pays theirs.
                    jdbc.sql("select coalesce(sum(p.amount), 0) from payments p join payment_requests pr on pr.id = p.payment_request_id where pr.meetup_id = :m and p.status = 'verified' and p.refund_status is null")
                            .param("m", m.id()).query(Long.class).single(),
                    insider ? m.ref() : null, m.createdAt(), policy(null));
        }
        ReservationOption option = host && "draft".equals(m.status())
                ? new ReservationOption(m.resKind(), "table".equals(m.resKind()) ? "Table for 2" : "Slot for 2", "Your plan goes live once your deposit is paid. The table is booked when someone joins.",
                m.hostShare(), policy(null)) : null;
        MyPayment pay = null;
        if (host && "draft".equals(m.status()) && m.hostPr() != null) pay = new MyPayment(m.hostPr().toString(), m.hostShare(), prExpiry(m.hostPr()));
        if (partner && "awaiting_payment".equals(m.status()) && m.partnerPr() != null) pay = new MyPayment(m.partnerPr().toString(), m.partnerShare(), m.partnerPayBy());
        String cost = "split".equals(m.payMode()) ? "₹" + rupees(m.deposit()) + " table deposit, split 50/50 · comes off the bill" : "₹" + rupees(m.deposit()) + " table deposit, paid by the host · comes off the bill";
        if ("slot".equals(m.resKind())) cost = cost.replace("table deposit", "slot deposit");
        long share = host ? m.hostShare() : "split".equals(m.payMode()) ? m.partnerShare() : 0;
        return new Invite(id.toString(), m.kind(), m.activity(), m.note(), b.name(), m.business().toString(), b.area(), m.startsAt(), m.duration(), cost, members.card(m.host()), m.openTo(), m.status(),
                myStatus, requests, matchedWith, b.cover(), km(home(customer), b.lat(), b.lng()), reservation, option, m.payMode(), m.deposit(), share, m.cutoff(), m.holdUntil(), pay,
                List.of("cancelled", "expired").contains(m.status()) ? m.cancelReason() : null);
    }

    private OffsetDateTime prExpiry(UUID pr) { return jdbc.sql("select expires_at from payment_requests where id = :p").param("p", pr).query(OffsetDateTime.class).single(); }

    // ---------- chat ----------
    private static final Pattern CONTACT = Pattern.compile("(?i)(\\+?\\d[\\d\\s().-]{8,}\\d)|([\\w.+-]+@[\\w-]+\\.[\\w.]+)|(https?://|www\\.)|(\\b[\\w-]+\\.(com|in|net|org|me|io)\\b)"
            + "|(\\b(whats\\s?app|insta(gram)?|telegram|snap(chat)?|facebook|fb|signal|discord)\\b)|(@[a-z0-9_.]{3,})");

    public Chat chat(UUID customer, UUID id) {
        sweep();
        M m = load(id, false);
        if (!m.host().equals(customer) && !customer.equals(m.partner())) throw ApiException.notFound("Chat not found.");
        if (!List.of("matched", "completed", "cancelled").contains(m.status()) || m.partner() == null) throw ApiException.conflict("no_chat", "The chat opens once you’re both in.");
        UUID other = m.host().equals(customer) ? m.partner() : m.host();
        List<ChatMessage> messages = jdbc.sql("select id, sender_id, text, created_at, quick from meetup_messages where meetup_id = :m order by created_at").param("m", id)
                .query((rs, i) -> {
                    UUID s = (UUID) rs.getObject(2);
                    return new ChatMessage(rs.getString(1), s == null ? "system" : s.equals(customer) ? "me" : "them", rs.getString(3), rs.getObject(4, OffsetDateTime.class), rs.getBoolean(5));
                }).list();
        int used = (int) messages.stream().filter(x -> !"system".equals(x.from())).count();
        OffsetDateTime closes = m.startsAt().plus(CHAT_AFTER_START);
        String status = "closed".equals(m.chatStatus()) || now().isAfter(closes) ? "closed" : used >= CHAT_LIMIT ? "limit_reached" : "open";
        String reason = "closed".equals(status) ? (m.chatReason() != null ? m.chatReason() : "ended") : null;
        Invite i = invite(customer, id);
        return new Chat(id.toString(), members.card(other), i.venueName(), m.startsAt(), status, reason, messages, used, CHAT_LIMIT, closes, i.reservation());
    }

    @Transactional
    public SendResult send(UUID customer, UUID id, SendInput in) {
        Chat c = chat(customer, id);
        if (!"open".equals(c.status())) throw ApiException.conflict("chat_closed", "This chat is closed.");
        String text;
        boolean quick = in.template() != null && !in.template().isBlank();
        if (quick) {
            String v = in.value() == null ? "" : in.value().trim();
            text = switch (in.template()) {
                case "dress" -> "I’m wearing " + v;
                case "table" -> "I’m at table " + v;
                case "seat" -> "I’m sitting " + v;
                case "spot" -> "I’m at " + v;
                case "status" -> v;
                default -> throw ApiException.badRequest("template", "Unknown quick reply.");
            };
        } else {
            text = in.text() == null ? "" : in.text().trim();
        }
        if (text.isBlank() || text.length() > 300) throw ApiException.badRequest("text", "Write a short message.");
        M m = load(id, true);
        if (CONTACT.matcher(text).find()) {
            UUID other = m.host().equals(customer) ? m.partner() : m.host();
            jdbc.sql("update meetups set chat_status = 'closed', chat_closed_reason = 'contact_shared', updated_at = now() where id = :id").param("id", id).update();
            jdbc.sql("insert into social_blocks (blocker_id, blocked_id) values (:a, :b), (:b, :a) on conflict do nothing").param("a", customer).param("b", other).update();
            system(id, "Chat closed: a contact detail was shared, which the guidelines don’t allow. You’ve both been blocked. VIBE will review it.");
            members.systemReport("meetup", id.toString(), "contact_shared", "A contact detail was shared in chat and the message was stopped.");
            return new SendResult(false, "contact_shared", chat(customer, id));
        }
        jdbc.sql("insert into meetup_messages (id, meetup_id, sender_id, text, quick) values (:id, :m, :s, :t, :q)").param("id", UUID.randomUUID()).param("m", id).param("s", customer)
                .param("t", text).param("q", quick).update();
        return new SendResult(true, null, chat(customer, id));
    }

    // ---------- the venue's side ----------
    public List<VenueReservation> forVenue(UUID business, LocalDate day) {
        sweep();
        OffsetDateTime from = day.atStartOfDay(IST).toOffsetDateTime(), to = day.plusDays(1).atStartOfDay(IST).toOffsetDateTime();
        return jdbc.sql("select m.reservation_ref, m.starts_at, m.activity, m.status, m.reservation_status, m.deposit, m.pay_mode, hc.name hname, pc.name pname, "
                        + "(select coalesce(sum(p.amount), 0) from payments p join payment_requests pr on pr.id = p.payment_request_id where pr.meetup_id = m.id and p.status = 'verified' and p.refund_status is null) paid "
                        + "from meetups m join customers hc on hc.id = m.host_id left join customers pc on pc.id = m.partner_id "
                        + "where m.business_id = :b and m.status in ('open', 'awaiting_payment', 'matched', 'completed', 'cancelled') and m.starts_at >= :f and m.starts_at < :t "
                        + "and not (m.status = 'cancelled' and m.reservation_status = 'pending') order by m.starts_at").param("b", business).param("f", from).param("t", to)
                .query((rs, i) -> {
                    String status = rs.getString("status"), res = rs.getString("reservation_status");
                    String shown = "matched".equals(status) || "completed".equals(status) ? res : "cancelled".equals(status) ? "released" : "pending";
                    String guests = SocialMembers.firstName(rs.getString("hname")) + (rs.getString("pname") == null ? "" : " and " + SocialMembers.firstName(rs.getString("pname")));
                    OffsetDateTime s = rs.getObject("starts_at", OffsetDateTime.class);
                    return new VenueReservation(rs.getString("reservation_ref"), s, s.plus(HOLD_AFTER_START), 2, guests, rs.getString("activity"), shown, rs.getLong("deposit"), rs.getLong("paid"), rs.getString("pay_mode"));
                }).list();
    }

    /** The venue marks the guests arrived (from an hour before) or a no-show (once the hold has run out). */
    @Transactional
    public VenueReservation mark(UUID business, String reference, String what) {
        M m = jdbc.sql("select " + M_COLS + " from meetups where reservation_ref = :r and business_id = :b for update").param("r", reference).param("b", business).query((rs, i) -> m(rs)).optional()
                .orElseThrow(() -> ApiException.notFound("Reservation not found."));
        if (!List.of("matched", "completed").contains(m.status())) throw ApiException.conflict("not_booked", "This reservation isn’t booked.");
        if ("arrived".equals(what)) {
            if (now().isBefore(m.startsAt().minusHours(1))) throw ApiException.conflict("too_early", "You can mark guests arrived from an hour before.");
        } else if ("no_show".equals(what)) {
            if (now().isBefore(m.holdUntil())) throw ApiException.conflict("too_early", "The table is held until " + TIME.format(m.holdUntil()) + ". Mark a no-show after that.");
        } else throw ApiException.badRequest("what", "Mark arrived or no-show.");
        jdbc.sql("update meetups set reservation_status = :s, updated_at = now() where id = :id").param("s", what).param("id", m.id()).update();
        LocalDate day = m.startsAt().atZoneSameInstant(IST).toLocalDate();
        return forVenue(business, day).stream().filter(v -> v.reference().equals(reference)).findFirst().orElseThrow();
    }

    void logSweepError(RuntimeException e) { log.warn("Meetup sweep failed: {}", e.getMessage()); }
}
