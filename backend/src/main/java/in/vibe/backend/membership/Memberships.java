package in.vibe.backend.membership;

import in.vibe.backend.audit.AuditService;
import in.vibe.backend.common.ApiException;
import in.vibe.backend.security.StaffPrincipal;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * VIBE membership: buying a plan, what a member has saved, cancelling, and VIBE staff granting time (a trial or goodwill) with the reason recorded.
 * A membership is paid for through the normal payment flow, and starts only when the payment partner confirms it. Time stacks: buying again
 * (or switching plan) starts the new period when the current one ends. Automatic renewal needs the payment partner's recurring-payment feature, which isn't
 * connected, so a membership ends on its date unless the customer buys again.
 */
@Service
public class Memberships {
    public record PlanView(String id, String name, String interval, long price, String note, String savingsLabel) {}

    public record Savings(long total, long thisMonth, int redemptions, int places, OffsetDateTime since, List<CategorySaving> byCategory) {}

    public record CategorySaving(String name, long amount) {}

    public record RecentSaving(String id, String businessName, OffsetDateTime at, long paid, long saved) {}

    public record PaymentRow(String id, OffsetDateTime at, long amount, String status, String planName) {}

    /** The customer app's `Membership`. */
    public record View(String status, PlanView plan, String memberNo, OffsetDateTime validUntil, OffsetDateTime renewsAt, boolean autoRenew, Savings savings, List<RecentSaving> recentSavings, List<PaymentRow> payments) {}

    public record Subscribed(String paymentRequestId, long amount) {}

    public record Grant(@NotNull String planId, @NotNull @Min(1) @Max(366) Integer days, @NotBlank @Size(min = 5, max = 300) String reason) {}

    private final JdbcClient jdbc;
    private final AuditService audit;
    private final Clock clock;
    private final SecureRandom random = new SecureRandom();

    Memberships(JdbcClient jdbc, AuditService audit, Clock clock) {
        this.jdbc = jdbc;
        this.audit = audit;
        this.clock = clock;
    }

    private OffsetDateTime now() { return OffsetDateTime.now(clock); }

    // ---------- reading ----------
    public View view(UUID customer) {
        var m = jdbc.sql("select m.status, m.member_no, m.valid_until, m.started_at, m.plan_id, m.auto_renew from memberships m where m.customer_id = :c").param("c", customer)
                .query((rs, i) -> new Object[]{rs.getString(1), rs.getString(2), rs.getObject(3, OffsetDateTime.class), rs.getObject(4, OffsetDateTime.class), rs.getObject(5), rs.getBoolean(6)}).optional();
        OffsetDateTime until = m.map(a -> (OffsetDateTime) a[2]).orElse(null);
        boolean live = until != null && until.isAfter(now());
        String status = m.isEmpty() || !live ? "none" : "cancelled".equals(m.get()[0]) ? "cancelled" : "active";
        PlanView plan = m.isPresent() && m.get()[4] != null ? plan((UUID) m.get()[4]) : null;
        OffsetDateTime since = m.map(a -> (OffsetDateTime) a[3]).orElse(null);
        return new View(status, live ? plan : null, m.map(a -> (String) a[1]).orElse(null), live ? until : null, live && "active".equals(status) ? until : null, false, savings(customer, since),
                recent(customer), payments(customer));
    }

    private PlanView plan(UUID id) {
        return jdbc.sql("select id, name, interval, price, note, savings_label from membership_plans where id = :id").param("id", id)
                .query((rs, i) -> new PlanView(rs.getString(1), rs.getString(2), rs.getString(3), rs.getLong(4), rs.getString(5), rs.getString(6))).optional().orElse(null);
    }

    private Savings savings(UUID customer, OffsetDateTime since) {
        OffsetDateTime monthStart = now().withDayOfMonth(1).toLocalDate().atStartOfDay(clock.getZone()).toOffsetDateTime();
        var t = jdbc.sql("select coalesce(sum(saved), 0), coalesce(sum(saved) filter (where at >= :m), 0), count(*), count(distinct business_id) from savings_events where customer_id = :c").param("c", customer).param("m", monthStart)
                .query((rs, i) -> new long[]{rs.getLong(1), rs.getLong(2), rs.getLong(3), rs.getLong(4)}).single();
        List<CategorySaving> byCat = jdbc.sql("""
                with recursive roots as (
                    select id, name, parent_id, id as root_id, name as root_name from categories where parent_id is null
                    union all select c.id, c.name, c.parent_id, r.root_id, r.root_name from categories c join roots r on c.parent_id = r.id)
                select r.root_name, sum(s.saved) from savings_events s join businesses b on b.id = s.business_id join roots r on r.id = b.primary_category_id
                where s.customer_id = :c group by r.root_name order by 2 desc""").param("c", customer).query((rs, i) -> new CategorySaving(rs.getString(1), rs.getLong(2))).list();
        return new Savings(t[0], t[1], (int) t[2], (int) t[3], since, byCat);
    }

    private List<RecentSaving> recent(UUID customer) {
        return jdbc.sql("select s.id, b.name, s.at, s.paid, s.saved from savings_events s join businesses b on b.id = s.business_id where s.customer_id = :c order by s.at desc limit 5").param("c", customer)
                .query((rs, i) -> new RecentSaving(rs.getString(1), rs.getString(2), rs.getObject(3, OffsetDateTime.class), rs.getLong(4), rs.getLong(5))).list();
    }

    private List<PaymentRow> payments(UUID customer) {
        return jdbc.sql("select mp.id, mp.created_at, mp.amount, p.name from membership_payments mp join membership_plans p on p.id = mp.plan_id where mp.customer_id = :c and mp.source = 'paid' order by mp.created_at desc limit 12").param("c", customer)
                .query((rs, i) -> new PaymentRow(rs.getString(1), rs.getObject(2, OffsetDateTime.class), rs.getLong(3), "paid", rs.getString(4))).list();
    }

    // ---------- buying ----------
    /** Creates the bill for a plan. Asking again for the same plan while a bill is open returns that bill. */
    @Transactional
    public Subscribed subscribe(UUID customer, UUID planId) {
        var plan = jdbc.sql("select name, price from membership_plans where id = :id and active").param("id", planId).query((rs, i) -> new Object[]{rs.getString(1), rs.getLong(2)}).optional()
                .orElseThrow(() -> ApiException.notFound("That plan isn’t available."));
        long price = (Long) plan[1];
        if (price <= 0) throw ApiException.badRequest("free_plan", "This plan can’t be bought online.");
        var open = jdbc.sql("select id from payment_requests where customer_id = :c and kind = 'membership' and plan_id = :p and status = 'open' and expires_at > :now").param("c", customer).param("p", planId).param("now", now())
                .query((rs, i) -> (UUID) rs.getObject(1)).optional();
        if (open.isPresent()) return new Subscribed(open.get().toString(), price);
        UUID id = UUID.randomUUID();
        jdbc.sql("insert into payment_requests (id, kind, customer_id, plan_id, bill_ref, raised_by, eligible_amount, discount, discount_label, vibe_fee, payable, expires_at) values (:id, 'membership', :c, :p, :ref, 'VIBE', :a, 0, '', 0, :a, :x)")
                .param("id", id).param("c", customer).param("p", planId).param("ref", "MEMBER-" + code(6)).param("a", price).param("x", now().plusMinutes(15)).update();
        jdbc.sql("insert into payment_request_lines (payment_request_id, position, label, amount) values (:p, 0, :l, :a)").param("p", id).param("l", plan[0] + " membership").param("a", price).update();
        return new Subscribed(id.toString(), price);
    }

    /** A plan change is a new purchase: the new plan starts when the current one ends, so nothing already paid for is lost. */
    public View changePlan(UUID customer, UUID planId) {
        throw ApiException.conflict("use_subscribe", "To switch plan, subscribe to the new plan. It starts when your current plan ends.");
    }

    /** Stops the membership from continuing. Benefits stay until the paid period ends. */
    @Transactional
    public View cancel(UUID customer) {
        if (jdbc.sql("update memberships set status = 'cancelled', cancelled_at = now(), auto_renew = false, updated_at = now() where customer_id = :c and status = 'active'").param("c", customer).update() == 0) {
            throw ApiException.conflict("not_active", "You don’t have an active membership to cancel.");
        }
        return view(customer);
    }

    // ---------- when the payment partner confirms the purchase ----------
    /** Called once by the payment code when a membership payment is verified. */
    public OffsetDateTime activate(UUID customer, UUID planId, UUID paymentId, long amount, String source, String note) {
        var plan = jdbc.sql("select interval from membership_plans where id = :id").param("id", planId).query(String.class).single();
        return extend(customer, planId, "year".equals(plan) ? 365 : 30, paymentId, amount, source, note);
    }

    private OffsetDateTime extend(UUID customer, UUID planId, int days, UUID paymentId, long amount, String source, String note) {
        OffsetDateTime current = jdbc.sql("select valid_until from memberships where customer_id = :c").param("c", customer).query(OffsetDateTime.class).optional().orElse(null);
        OffsetDateTime start = current != null && current.isAfter(now()) ? current : now();
        OffsetDateTime end = start.plusDays(days);
        jdbc.sql("""
                insert into memberships (customer_id, status, valid_until, plan_id, member_no, started_at, auto_renew) values (:c, 'active', :e, :p, :n, :s, false)
                on conflict (customer_id) do update set status = 'active', valid_until = :e, plan_id = :p, cancelled_at = null, updated_at = now(),
                    started_at = case when memberships.valid_until > :s then memberships.started_at else :s end,
                    member_no = coalesce(memberships.member_no, :n)""")
                .param("c", customer).param("e", end).param("p", planId).param("n", memberNo(customer)).param("s", now()).update();
        jdbc.sql("insert into membership_payments (id, customer_id, plan_id, payment_id, amount, period_start, period_end, source, note) values (:id, :c, :p, :pay, :a, :s, :e, :src, :n)")
                .param("id", UUID.randomUUID()).param("c", customer).param("p", planId).param("pay", paymentId, java.sql.Types.OTHER).param("a", amount).param("s", start).param("e", end).param("src", source).param("n", note).update();
        return end;
    }

    private String memberNo(UUID customer) {
        String vibeId = jdbc.sql("select vibe_id from customers where id = :c").param("c", customer).query(String.class).single();
        return "VB " + vibeId + " " + String.format("%04d", random.nextInt(10_000));
    }

    // ---------- VIBE staff ----------
    /** A trial or goodwill. The reason is required and kept with who gave it. */
    @Transactional
    public View grant(StaffPrincipal who, UUID customer, Grant in) {
        UUID planId;
        try { planId = UUID.fromString(in.planId()); } catch (RuntimeException e) { throw ApiException.badRequest("plan", "Choose a plan."); }
        if (plan(planId) == null) throw ApiException.badRequest("plan", "That plan doesn’t exist.");
        if (jdbc.sql("select count(*) from customers where id = :c").param("c", customer).query(Integer.class).single() == 0) throw ApiException.notFound("Customer not found.");
        extend(customer, planId, in.days(), null, 0, "granted", in.reason().trim());
        audit.record(who, "grant_membership", "customer", customer, in.days() + " days: " + in.reason().trim());
        return view(customer);
    }

    private String code(int n) {
        String alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) sb.append(alphabet.charAt(random.nextInt(alphabet.length())));
        return sb.toString();
    }

}
