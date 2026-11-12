package in.vibe.backend.slots;

import in.vibe.backend.audit.AuditService;
import in.vibe.backend.billing.Notifications;
import in.vibe.backend.common.ApiException;
import in.vibe.backend.customer.Customers;
import in.vibe.backend.notify.StaffNotifications;
import in.vibe.backend.security.StaffPrincipal;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * Monthly memberships at a gym, a yoga or meditation studio, or a personal trainer: the customer chooses a plan (1, 3, 6 or 12 months), picks the
 * day it starts, and pays through VIBE. The pass is held for a few minutes while paying, then valid from the start day to the day before the same date
 * N months later, with a code for the front desk. A trial or a single day is booked as a session by the slot instead.
 */
@Service
public class VenuePasses {
    public static final int HOLD_MINUTES = 10, START_WITHIN_DAYS = 60;
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH);
    private static final String ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    public record PlanInput(@NotBlank @Size(min = 2, max = 80) String name, @Size(max = 300) String description, @NotNull Integer months, @NotNull @Min(1) Long price,
                            @Size(max = 8) List<@NotBlank @Size(max = 100) String> benefits, Boolean active, @Min(0) Integer sortOrder) {}

    public record Plan(String id, String name, String description, int months, long price, long perMonth, List<String> benefits, boolean active, int sortOrder) {}

    public record BuyInput(@NotBlank String planId, @NotNull LocalDate startsOn) {}

    public record Pass(String id, String businessId, String businessName, String area, String address, String planName, int months, String status, LocalDate startsOn, LocalDate endsOn,
                       boolean activeNow, int daysLeft, String passRef, String passCode, long total, OffsetDateTime expiresAt, String paymentRequestId, OffsetDateTime paidAt, int checkIns) {}

    public record Member(String passId, String passRef, String customerName, String vibeId, String planName, LocalDate startsOn, LocalDate endsOn, boolean activeNow, int checkIns, OffsetDateTime lastCheckIn) {}

    private final SecureRandom random = new SecureRandom();
    private final JdbcClient jdbc;
    private final Notifications notifications;
    private final StaffNotifications staffNotifications;
    private final AuditService audit;
    private final Clock clock;
    private final long bookingFee;

    VenuePasses(JdbcClient jdbc, Notifications notifications, StaffNotifications staffNotifications, AuditService audit, Clock clock, @Value("${vibe.billing.booking-fee:0}") long bookingFee) {
        this.jdbc = jdbc;
        this.notifications = notifications;
        this.staffNotifications = staffNotifications;
        this.audit = audit;
        this.clock = clock;
        this.bookingFee = bookingFee;
    }

    private LocalDate today() { return OffsetDateTime.now(clock).atZoneSameInstant(IST).toLocalDate(); }

    // ---------- plans ----------
    private static Plan plan(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        int months = rs.getInt("months");
        long price = rs.getLong("price");
        return new Plan(rs.getString("id"), rs.getString("name"), rs.getString("description"), months, price, price / months, Arrays.asList((String[]) rs.getArray("benefits").getArray()),
                rs.getBoolean("active"), rs.getInt("sort_order"));
    }

    public List<Plan> plans(UUID business, boolean activeOnly) {
        return jdbc.sql("select * from venue_plans where business_id = :b" + (activeOnly ? " and active" : "") + " order by sort_order, months, price").param("b", business).query(VenuePasses::plan).list();
    }

    private void check(PlanInput in) {
        if (!List.of(1, 3, 6, 12).contains(in.months())) throw ApiException.badRequest("months", "A plan runs for 1, 3, 6 or 12 months.");
    }

    @Transactional
    public Plan addPlan(StaffPrincipal who, PlanInput in) {
        check(in);
        UUID id = UUID.randomUUID();
        jdbc.sql("insert into venue_plans (id, business_id, name, description, months, price, benefits, active, sort_order) values (:id, :b, :n, :d, :m, :p, :ben, :a, :s)")
                .param("id", id).param("b", who.requireBusiness()).param("n", in.name().trim()).param("d", in.description() == null ? "" : in.description().trim()).param("m", in.months())
                .param("p", in.price()).param("ben", benefits(in)).param("a", in.active() == null || in.active()).param("s", in.sortOrder() == null ? 0 : in.sortOrder()).update();
        audit.record(who, "create", "venue_plan", id, in.name());
        return one(who.requireBusiness(), id);
    }

    /** A price change applies to new purchases; passes already bought keep what was paid. */
    @Transactional
    public Plan updatePlan(StaffPrincipal who, UUID id, PlanInput in) {
        check(in);
        one(who.requireBusiness(), id);
        jdbc.sql("update venue_plans set name = :n, description = :d, months = :m, price = :p, benefits = :ben, active = :a, sort_order = :s where id = :id and business_id = :b")
                .param("id", id).param("b", who.requireBusiness()).param("n", in.name().trim()).param("d", in.description() == null ? "" : in.description().trim()).param("m", in.months())
                .param("p", in.price()).param("ben", benefits(in)).param("a", in.active() == null || in.active()).param("s", in.sortOrder() == null ? 0 : in.sortOrder()).update();
        audit.record(who, "update", "venue_plan", id, in.name());
        return one(who.requireBusiness(), id);
    }

    @Transactional
    public void deletePlan(StaffPrincipal who, UUID id) {
        one(who.requireBusiness(), id);
        if (jdbc.sql("select count(*) from venue_passes where plan_id = :id").param("id", id).query(Integer.class).single() > 0) {
            throw ApiException.conflict("in_use", "Customers have bought this plan, so it’s kept for their passes. Switch it off to stop selling it.");
        }
        jdbc.sql("delete from venue_plans where id = :id").param("id", id).update();
        audit.record(who, "delete", "venue_plan", id, "");
    }

    private static String[] benefits(PlanInput in) {
        return (in.benefits() == null ? List.<String>of() : in.benefits().stream().map(String::trim).filter(s -> !s.isEmpty()).toList()).toArray(new String[0]);
    }

    private Plan one(UUID business, UUID id) {
        return jdbc.sql("select * from venue_plans where id = :id and business_id = :b").param("id", id).param("b", business).query(VenuePasses::plan).optional()
                .orElseThrow(() -> ApiException.notFound("Not found."));
    }

    // ---------- buying ----------
    @Transactional
    public Pass buy(UUID customer, BuyInput in) {
        UUID planId = SlotBooking.parse(in.planId());
        record P(UUID business, String name, int months, long price, String bname) {}
        P p = jdbc.sql("select p.business_id, p.name, p.months, p.price, b.name from venue_plans p join businesses b on b.id = p.business_id where p.id = :id and p.active and b.active")
                .param("id", planId).query((rs, i) -> new P((UUID) rs.getObject(1), rs.getString(2), rs.getInt(3), rs.getLong(4), rs.getString(5))).optional()
                .orElseThrow(() -> ApiException.notFound("This plan isn’t on sale any more."));
        LocalDate start = in.startsOn();
        if (start.isBefore(today()) || start.isAfter(today().plusDays(START_WITHIN_DAYS))) throw ApiException.badRequest("start", "Choose a start date from today to " + START_WITHIN_DAYS + " days ahead.");
        LocalDate end = start.plusMonths(p.months()).minusDays(1);
        // A new pass replaces this customer's earlier unpaid one at the same place.
        String unpaid = "v.customer_id = :c and v.business_id = :b and v.status = 'held' and not exists (select 1 from payments x where x.payment_request_id = v.payment_request_id and x.status in ('pending', 'verified'))";
        jdbc.sql("update payment_requests set status = 'void' where id in (select v.payment_request_id from venue_passes v where " + unpaid + ")").param("c", customer).param("b", p.business()).update();
        jdbc.sql("update venue_passes v set status = 'released' where " + unpaid).param("c", customer).param("b", p.business()).update();

        UUID id = UUID.randomUUID(), pr = UUID.randomUUID();
        OffsetDateTime expires = OffsetDateTime.now(clock).plusMinutes(HOLD_MINUTES);
        String ref = "VBP-" + code(4) + "-" + code(4);
        jdbc.sql("insert into payment_requests (id, kind, business_id, customer_id, bill_ref, raised_by, eligible_amount, discount, discount_label, vibe_fee, payable, expires_at) "
                        + "values (:id, 'pass', :b, :c, :ref, 'VIBE Memberships', :t, 0, '', :fee, :t + :fee, :x)")
                .param("id", pr).param("b", p.business()).param("c", customer).param("ref", ref).param("t", p.price()).param("fee", bookingFee).param("x", expires).update();
        jdbc.sql("insert into payment_request_lines (payment_request_id, position, label, amount) values (:p, 0, :l, :a)")
                .param("p", pr).param("l", p.name() + " · " + DAY.format(start) + " – " + DAY.format(end)).param("a", p.price()).update();
        jdbc.sql("insert into venue_passes (id, business_id, customer_id, plan_id, starts_on, ends_on, total, expires_at, payment_request_id, pass_ref) values (:id, :b, :c, :plan, :s, :e, :t, :x, :pr, :ref)")
                .param("id", id).param("b", p.business()).param("c", customer).param("plan", planId).param("s", start).param("e", end).param("t", p.price()).param("x", expires).param("pr", pr).param("ref", ref).update();
        return pass(customer, id);
    }

    /** Called once, inside the transaction that marks the payment verified. */
    public void confirm(UUID paymentRequestId) {
        record V(UUID id, UUID business, UUID customer, String status, String ref, String plan, LocalDate start, LocalDate end) {}
        V v = jdbc.sql("select v.id, v.business_id, v.customer_id, v.status, v.pass_ref, p.name, v.starts_on, v.ends_on from venue_passes v join venue_plans p on p.id = v.plan_id where v.payment_request_id = :pr for update of v")
                .param("pr", paymentRequestId).query((rs, i) -> new V((UUID) rs.getObject(1), (UUID) rs.getObject(2), (UUID) rs.getObject(3), rs.getString(4), rs.getString(5), rs.getString(6),
                        rs.getObject(7, LocalDate.class), rs.getObject(8, LocalDate.class))).single();
        if ("paid".equals(v.status())) return;
        for (int attempt = 0; ; attempt++) {
            try {
                jdbc.sql("update venue_passes set status = 'paid', paid_at = now(), pass_code = :code where id = :id").param("code", code(3) + "-" + code(3)).param("id", v.id()).update();
                break;
            } catch (DuplicateKeyException e) {
                if (attempt >= 4) throw e;
            }
        }
        String bname = jdbc.sql("select name from businesses where id = :id").param("id", v.business()).query(String.class).single();
        notifications.notify(v.customer(), "pass_bought", "Membership confirmed: " + bname, v.plan() + ", " + DAY.format(v.start()) + " to " + DAY.format(v.end()) + ". Show your pass code at the front desk.", "venue_pass", v.id().toString());
        String who = jdbc.sql("select name from customers where id = :id").param("id", v.customer()).query((rs, i) -> Customers.displayName(rs.getString(1))).single();
        staffNotifications.toBusiness(v.business(), "pass_bought", "New member: " + who, v.plan() + " from " + DAY.format(v.start()) + " to " + DAY.format(v.end()) + ", paid through VIBE. Pass " + v.ref() + ".", "/bookings");
    }

    private static final String SELECT = "select v.*, p.name pname, p.months, z.name bname, z.area, z.address from venue_passes v join venue_plans p on p.id = v.plan_id join businesses z on z.id = v.business_id ";

    private Pass map(java.sql.ResultSet rs) throws java.sql.SQLException {
        String status = rs.getString("status");
        OffsetDateTime expires = rs.getObject("expires_at", OffsetDateTime.class);
        if ("held".equals(status) && expires.isBefore(OffsetDateTime.now(clock)) && jdbc.sql("select count(*) from payments where payment_request_id = :p and status = 'pending'")
                .param("p", rs.getObject("payment_request_id")).query(Integer.class).single() == 0) status = "released";
        LocalDate start = rs.getObject("starts_on", LocalDate.class), end = rs.getObject("ends_on", LocalDate.class), t = today();
        boolean active = "paid".equals(status) && !t.isBefore(start) && !t.isAfter(end);
        int left = "paid".equals(status) && !t.isAfter(end) ? (int) java.time.temporal.ChronoUnit.DAYS.between(t.isBefore(start) ? start : t, end) + 1 : 0;
        return new Pass(rs.getString("id"), rs.getString("business_id"), rs.getString("bname"), rs.getString("area"), rs.getString("address"), rs.getString("pname"), rs.getInt("months"), status,
                start, end, active, left, rs.getString("pass_ref"), "paid".equals(status) ? rs.getString("pass_code") : null, rs.getLong("total"), expires, rs.getString("payment_request_id"),
                rs.getObject("paid_at", OffsetDateTime.class), rs.getInt("check_ins"));
    }

    public Pass pass(UUID customer, UUID id) {
        return jdbc.sql(SELECT + "where v.id = :id and v.customer_id = :c").param("id", id).param("c", customer).query((rs, i) -> map(rs)).optional()
                .orElseThrow(() -> ApiException.notFound("Membership not found."));
    }

    public List<Pass> mine(UUID customer) {
        return jdbc.sql(SELECT + "where v.customer_id = :c and v.status = 'paid' order by v.ends_on desc limit 50").param("c", customer).query((rs, i) -> map(rs)).list();
    }

    public String passIdFor(UUID paymentRequestId) {
        return jdbc.sql("select id from venue_passes where payment_request_id = :p").param("p", paymentRequestId).query(String.class).optional().orElse(null);
    }

    // ---------- the venue ----------
    public List<Member> members(UUID business) {
        LocalDate t = today();
        return jdbc.sql("select v.id, v.pass_ref, c.name, c.vibe_id, p.name pname, v.starts_on, v.ends_on, v.check_ins, v.last_check_in from venue_passes v join venue_plans p on p.id = v.plan_id "
                        + "join customers c on c.id = v.customer_id where v.business_id = :b and v.status = 'paid' order by v.ends_on desc limit 300")
                .param("b", business).query((rs, i) -> {
                    LocalDate s = rs.getObject("starts_on", LocalDate.class), e = rs.getObject("ends_on", LocalDate.class);
                    return new Member(rs.getString(1), rs.getString(2), Customers.displayName(rs.getString(3)), rs.getString(4), rs.getString("pname"), s, e, !t.isBefore(s) && !t.isAfter(e),
                            rs.getInt("check_ins"), rs.getObject("last_check_in", OffsetDateTime.class));
                }).list();
    }

    /** Front desk: a member's pass code. Valid only inside its dates; each visit is counted. Null when the code isn't a pass at this venue. */
    @Transactional
    public SlotBooking.CheckIn checkIn(StaffPrincipal who, String code) {
        UUID business = who.requireBusiness();
        record V(UUID id, String ref, String cname, String plan, LocalDate start, LocalDate end) {}
        V v = jdbc.sql("select v.id, v.pass_ref, c.name, p.name, v.starts_on, v.ends_on from venue_passes v join customers c on c.id = v.customer_id join venue_plans p on p.id = v.plan_id "
                        + "where v.business_id = :b and v.pass_code = :code and v.status = 'paid' for update of v").param("b", business).param("code", code)
                .query((rs, i) -> new V((UUID) rs.getObject(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getObject(5, LocalDate.class), rs.getObject(6, LocalDate.class))).optional().orElse(null);
        if (v == null) return null;
        String who2 = Customers.displayName(v.cname());
        LocalDate t = today();
        if (t.isBefore(v.start())) return new SlotBooking.CheckIn("not_started", "Membership starts on " + DAY.format(v.start()) + ".", v.ref(), who2, List.of());
        if (t.isAfter(v.end())) return new SlotBooking.CheckIn("expired", "Membership ended on " + DAY.format(v.end()) + ". They can renew in the app.", v.ref(), who2, List.of());
        jdbc.sql("update venue_passes set check_ins = check_ins + 1, last_check_in = now() where id = :id").param("id", v.id()).update();
        audit.record(who, "check_in", "venue_pass", v.id(), v.ref());
        return new SlotBooking.CheckIn("admitted", "Member: " + v.plan() + ", valid until " + DAY.format(v.end()) + ".", v.ref(), who2, List.of());
    }

    private String code(int n) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) sb.append(ALPHABET.charAt(random.nextInt(ALPHABET.length())));
        return sb.toString();
    }
}
