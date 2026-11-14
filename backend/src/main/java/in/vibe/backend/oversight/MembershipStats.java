package in.vibe.backend.oversight;

import in.vibe.backend.common.ApiException;
import in.vibe.backend.common.Csv;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.List;

/**
 * VIBE Membership at a glance: how many people registered, how many hold a membership now, how many never took one and how many let it
 * lapse, and the membership fees collected. Those fees are VIBE's own income (booked to membership_income); they belong to no business
 * and are never part of a settlement. Not limited by category, because membership is VIBE-wide.
 */
@Service
public class MembershipStats {
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    /**
     * membersNow = autoRenewing + cancelledStillValid (cancelled, but paid time left). neverJoined: registered and never held a membership.
     * joined: first membership in the period; renewed: paid again in the period; granted: given free by VIBE staff in the period.
     */
    public record Summary(LocalDate from, LocalDate to, int registered, int registeredInPeriod, int membersNow, int autoRenewing, int cancelledStillValid, int lapsed, int neverJoined,
                          int joined, int renewed, int granted, long feesInPeriod, int paymentsInPeriod, long feesAllTime, long savedInPeriod, List<Plan> plans) {}

    public record Plan(String name, long price, String period, boolean onSale, int membersNow, int paidInPeriod, long feesInPeriod) {}

    private final JdbcClient jdbc;
    private final Clock clock;

    MembershipStats(JdbcClient jdbc, Clock clock) {
        this.jdbc = jdbc;
        this.clock = clock;
    }

    public Summary summary(LocalDate from, LocalDate to) {
        LocalDate today = LocalDate.now(clock.withZone(IST));
        LocalDate f = from == null ? today.minusDays(29) : from, t = to == null ? today : to;
        if (t.isBefore(f)) throw ApiException.badRequest("bad_period", "The end date is before the start date.");
        OffsetDateTime fa = f.atStartOfDay(IST).toOffsetDateTime(), ua = t.plusDays(1).atStartOfDay(IST).toOffsetDateTime(), now = OffsetDateTime.now(clock);

        int registered = count("select count(*) from customers", null, null);
        int registeredIn = count("select count(*) from customers where created_at >= :f and created_at < :u", fa, ua);
        int[] m = jdbc.sql("select count(*) filter (where valid_until > :n and status = 'active'), count(*) filter (where valid_until > :n and status = 'cancelled'), count(*) filter (where valid_until <= :n) from memberships")
                .param("n", now).query((rs, i) -> new int[]{rs.getInt(1), rs.getInt(2), rs.getInt(3)}).single();
        int never = count("select count(*) from customers c where not exists (select 1 from memberships m where m.customer_id = c.id)", null, null);
        int joined = count("select count(*) from (select customer_id, min(created_at) first from membership_payments group by customer_id) x where x.first >= :f and x.first < :u", fa, ua);
        int renewed = count("select count(distinct p.customer_id) from membership_payments p where p.source = 'paid' and p.created_at >= :f and p.created_at < :u "
                + "and exists (select 1 from membership_payments e where e.customer_id = p.customer_id and e.created_at < p.created_at)", fa, ua);
        int granted = count("select count(*) from membership_payments where source = 'granted' and created_at >= :f and created_at < :u", fa, ua);
        long[] fees = jdbc.sql("select coalesce(sum(amount) filter (where created_at >= :f and created_at < :u), 0), count(*) filter (where created_at >= :f and created_at < :u), coalesce(sum(amount), 0) "
                        + "from membership_payments where source = 'paid'").param("f", fa).param("u", ua)
                .query((rs, i) -> new long[]{rs.getLong(1), rs.getLong(2), rs.getLong(3)}).single();
        long saved = jdbc.sql("select coalesce(sum(saved), 0) from savings_events where at >= :f and at < :u").param("f", fa).param("u", ua).query(Long.class).single();
        List<Plan> plans = jdbc.sql("select mp.name, mp.price, mp.interval, mp.active, "
                        + "(select count(*) from memberships x where x.plan_id = mp.id and x.valid_until > :n), "
                        + "(select count(*) from membership_payments y where y.plan_id = mp.id and y.source = 'paid' and y.created_at >= :f and y.created_at < :u), "
                        + "(select coalesce(sum(y.amount), 0) from membership_payments y where y.plan_id = mp.id and y.source = 'paid' and y.created_at >= :f and y.created_at < :u) "
                        + "from membership_plans mp order by mp.sort_order, mp.name").param("n", now).param("f", fa).param("u", ua)
                .query((rs, i) -> new Plan(rs.getString(1), rs.getLong(2), rs.getString(3), rs.getBoolean(4), rs.getInt(5), rs.getInt(6), rs.getLong(7))).list();
        return new Summary(f, t, registered, registeredIn, m[0] + m[1], m[0], m[1], m[2], never, joined, renewed, granted, fees[0], (int) fees[1], fees[2], saved, plans);
    }

    private int count(String sql, OffsetDateTime f, OffsetDateTime u) {
        JdbcClient.StatementSpec s = jdbc.sql(sql);
        if (f != null) s.param("f", f).param("u", u);
        return s.query(Integer.class).single();
    }

    public ResponseEntity<byte[]> csv(LocalDate from, LocalDate to) {
        Summary s = summary(from, to);
        Csv csv = new Csv().row("VIBE Membership", s.from() + " to " + s.to()).row()
                .row("Registered customers", s.registered()).row("Registered in the period", s.registeredInPeriod())
                .row("Members now", s.membersNow()).row("  renewing automatically", s.autoRenewing()).row("  cancelled, time left", s.cancelledStillValid())
                .row("Registered, never a member", s.neverJoined()).row("Membership ended (lapsed)", s.lapsed())
                .row("Joined in the period", s.joined()).row("Renewed in the period", s.renewed()).row("Given free by VIBE in the period", s.granted())
                .row("Membership fees in the period (Rs) - VIBE income", Csv.rupees(s.feesInPeriod())).row("Membership payments in the period", s.paymentsInPeriod())
                .row("Membership fees, all time (Rs)", Csv.rupees(s.feesAllTime())).row("Saved by members in the period (Rs)", Csv.rupees(s.savedInPeriod())).row()
                .row("Plan", "Price (Rs)", "Billing", "On sale", "Members now", "Paid in the period", "Fees in the period (Rs)");
        for (Plan p : s.plans()) csv.row(p.name(), Csv.rupees(p.price()), p.period(), p.onSale() ? "Yes" : "No", p.membersNow(), p.paidInPeriod(), Csv.rupees(p.feesInPeriod()));
        return csv.download("vibe-membership-" + s.from() + "-to-" + s.to() + ".csv");
    }
}
