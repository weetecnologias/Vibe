package in.vibe.backend.oversight;

import in.vibe.backend.common.Csv;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The admin's reports. By category: partners onboarded, applications waiting, payments (confirmed, failed), refunds and VIBE's fees, for every
 * category and subcategory (a business counts in its main category and every category above it). Members: how many customers have joined,
 * are members now, have let it lapse or never joined. Both download as Excel-ready CSV. Amounts are in paise.
 */
@Service
public class Reports {
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    public record CategoryRow(String id, String parentId, int level, String name, String path, boolean active, int partners, int livePartners, int pendingApplications,
                              int payments, long collected, int failed, int refundsDue, long refundDueAmount, int refunded, long refundedAmount, long vibeFees, long vibeFunded) {}

    /** membership: VIBE's own sales (membership), which belong to no category. */
    public record CategoryReport(LocalDate from, LocalDate to, List<CategoryRow> rows, CategoryRow total, CategoryRow membership) {}

    public record PlanRow(String plan, int active, int joined30d, long revenue30d) {}

    public record MembersReport(int customers, int newCustomers30d, int activeMembers, int cancelledStillValid, int lapsed, int neverJoined, int joined30d, long revenue30d,
                                long savedByMembers30d, List<PlanRow> plans) {}

    private final JdbcClient jdbc;
    private final Clock clock;

    Reports(JdbcClient jdbc, Clock clock) {
        this.jdbc = jdbc;
        this.clock = clock;
    }

    private record Cat(UUID id, UUID parent, String name, boolean active, int sort) {}

    private record Agg(int payments, long collected, int failed, int refundsDue, long refundDueAmount, int refunded, long refundedAmount, long fees, long funded) {
        static final Agg ZERO = new Agg(0, 0, 0, 0, 0, 0, 0, 0, 0);
        Agg plus(Agg o) {
            return new Agg(payments + o.payments, collected + o.collected, failed + o.failed, refundsDue + o.refundsDue, refundDueAmount + o.refundDueAmount, refunded + o.refunded,
                    refundedAmount + o.refundedAmount, fees + o.fees, funded + o.funded);
        }
    }

    private static final String AGG = "count(*) filter (where p.status = 'verified'), coalesce(sum(p.amount) filter (where p.status = 'verified'), 0), count(*) filter (where p.status = 'failed'), "
            + "count(*) filter (where p.refund_status = 'due'), coalesce(sum(p.refund_amount) filter (where p.refund_status = 'due'), 0), count(*) filter (where p.refund_status = 'refunded'), "
            + "coalesce(sum(p.refund_amount) filter (where p.refund_status = 'refunded'), 0), coalesce(sum(pr.vibe_fee) filter (where p.status = 'verified'), 0), coalesce(sum(pr.vibe_funded) filter (where p.status = 'verified'), 0)";

    private static Agg agg(java.sql.ResultSet rs, int at) throws java.sql.SQLException {
        return new Agg(rs.getInt(at), rs.getLong(at + 1), rs.getInt(at + 2), rs.getInt(at + 3), rs.getLong(at + 4), rs.getInt(at + 5), rs.getLong(at + 6), rs.getLong(at + 7), rs.getLong(at + 8));
    }

    /** from/to: India dates, inclusive; null means from the start / up to today. scope: from AdminAccess.businessScope on b.id (category managers). */
    public CategoryReport categories(LocalDate from, LocalDate to, String scope) {
        OffsetDateTime f = from == null ? OffsetDateTime.parse("2000-01-01T00:00:00Z") : from.atStartOfDay(IST).toOffsetDateTime();
        OffsetDateTime u = (to == null ? LocalDate.now(clock.withZone(IST)) : to).plusDays(1).atStartOfDay(IST).toOffsetDateTime();

        List<Cat> cats = jdbc.sql("select id, parent_id, name, active, sort_order from categories order by sort_order, name")
                .query((rs, i) -> new Cat((UUID) rs.getObject(1), (UUID) rs.getObject(2), rs.getString(3), rs.getBoolean(4), rs.getInt(5))).list();
        Map<UUID, Cat> byId = new HashMap<>();
        cats.forEach(c -> byId.put(c.id(), c));

        // Each business, its main category, whether it's live, and its money in the period.
        record Biz(UUID category, boolean live, Agg agg) {}
        List<Biz> businesses = jdbc.sql("select b.primary_category_id, b.active, " + AGG.replace("count(*)", "count(p.id)")
                        + " from businesses b left join payment_requests pr on pr.business_id = b.id left join payments p on p.payment_request_id = pr.id and p.created_at >= :f and p.created_at < :u"
                        + " where true" + scope + " group by b.id, b.primary_category_id, b.active").param("f", f).param("u", u)
                .query((rs, i) -> new Biz((UUID) rs.getObject(1), rs.getBoolean(2), agg(rs, 3))).list();
        Map<UUID, Integer> pending = new HashMap<>();
        jdbc.sql("select category_id, count(*) from merchant_applications where status in ('pending', 'changes_requested') and category_id is not null group by category_id")
                .query((rs, i) -> pending.put((UUID) rs.getObject(1), rs.getInt(2))).list();

        // Roll everything up to the category and each one above it.
        Map<UUID, int[]> counts = new HashMap<>(); // partners, live, pending applications
        Map<UUID, Agg> money = new HashMap<>();
        for (Biz b : businesses) {
            for (Cat c = byId.get(b.category()); c != null; c = c.parent() == null ? null : byId.get(c.parent())) {
                int[] n = counts.computeIfAbsent(c.id(), k -> new int[3]);
                n[0]++;
                if (b.live()) n[1]++;
                money.merge(c.id(), b.agg(), Agg::plus);
            }
        }
        boolean scoped = !scope.isEmpty();
        pending.forEach((cat, n) -> { for (Cat c = byId.get(cat); c != null; c = c.parent() == null ? null : byId.get(c.parent())) counts.computeIfAbsent(c.id(), k -> new int[3])[2] += n; });

        List<CategoryRow> rows = new ArrayList<>();
        walk(null, 1, "", cats, counts, money, rows);
        if (scoped) rows.removeIf(r -> r.partners() == 0 && r.pendingApplications() == 0);
        Agg total = businesses.stream().map(Biz::agg).reduce(Agg.ZERO, Agg::plus);
        int totalPending = scoped ? 0 : pending.values().stream().mapToInt(Integer::intValue).sum();
        CategoryRow totalRow = row("total", null, 0, "All categories", "All categories", true, businesses.size(), (int) businesses.stream().filter(Biz::live).count(), totalPending, total);
        Agg vibe = scoped ? Agg.ZERO : jdbc.sql("select " + AGG + " from payments p join payment_requests pr on pr.id = p.payment_request_id where pr.business_id is null and p.created_at >= :f and p.created_at < :u")
                .param("f", f).param("u", u).query((rs, i) -> agg(rs, 1)).single();
        return new CategoryReport(from, to, rows, totalRow, row("membership", null, 0, "VIBE Membership", "VIBE Membership", true, 0, 0, 0, vibe));
    }

    private static CategoryRow row(String id, String parent, int level, String name, String path, boolean active, int partners, int live, int pending, Agg a) {
        return new CategoryRow(id, parent, level, name, path, active, partners, live, pending, a.payments(), a.collected(), a.failed(), a.refundsDue(), a.refundDueAmount(), a.refunded(), a.refundedAmount(), a.fees(), a.funded());
    }

    private void walk(UUID parent, int level, String prefix, List<Cat> cats, Map<UUID, int[]> counts, Map<UUID, Agg> money, List<CategoryRow> out) {
        for (Cat c : cats) {
            if (!java.util.Objects.equals(c.parent(), parent)) continue;
            int[] n = counts.getOrDefault(c.id(), new int[3]);
            String path = prefix.isEmpty() ? c.name() : prefix + " › " + c.name();
            out.add(row(c.id().toString(), parent == null ? null : parent.toString(), level, c.name(), path, c.active(), n[0], n[1], n[2], money.getOrDefault(c.id(), Agg.ZERO)));
            walk(c.id(), level + 1, path, cats, counts, money, out);
        }
    }

    public MembersReport members() {
        OffsetDateTime now = OffsetDateTime.now(clock), month = now.minusDays(30);
        int customers = jdbc.sql("select count(*) from customers").query(Integer.class).single();
        int newCustomers = jdbc.sql("select count(*) from customers where created_at > :m").param("m", month).query(Integer.class).single();
        int[] m = jdbc.sql("select count(*) filter (where status = 'active' and valid_until > :n), count(*) filter (where status = 'cancelled' and valid_until > :n), count(*) filter (where valid_until <= :n) from memberships")
                .param("n", now).query((rs, i) -> new int[]{rs.getInt(1), rs.getInt(2), rs.getInt(3)}).single();
        int ever = jdbc.sql("select count(distinct customer_id) from memberships").query(Integer.class).single();
        var joined = jdbc.sql("select count(distinct customer_id), coalesce(sum(amount) filter (where source = 'paid'), 0) from membership_payments where created_at > :m").param("m", month)
                .query((rs, i) -> new long[]{rs.getLong(1), rs.getLong(2)}).single();
        long saved = jdbc.sql("select coalesce(sum(saved), 0) from savings_events where at > :m").param("m", month).query(Long.class).single();
        List<PlanRow> plans = jdbc.sql("select mp.name, (select count(*) from memberships x where x.plan_id = mp.id and x.valid_until > :n and x.status in ('active', 'cancelled')), "
                        + "(select count(distinct y.customer_id) from membership_payments y where y.plan_id = mp.id and y.created_at > :m), "
                        + "(select coalesce(sum(y.amount), 0) from membership_payments y where y.plan_id = mp.id and y.created_at > :m and y.source = 'paid') from membership_plans mp order by mp.sort_order, mp.name")
                .param("n", now).param("m", month).query((rs, i) -> new PlanRow(rs.getString(1), rs.getInt(2), rs.getInt(3), rs.getLong(4))).list();
        return new MembersReport(customers, newCustomers, m[0], m[1], m[2], Math.max(0, customers - ever), (int) joined[0], joined[1], saved, plans);
    }

    // ---------- downloads ----------
    private static String rupees(long paise) { return String.format("%.2f", paise / 100.0); }

    public ResponseEntity<byte[]> categoriesCsv(LocalDate from, LocalDate to, String scope) {
        CategoryReport r = categories(from, to, scope);
        Csv csv = new Csv().row("VIBE report by category", (from == null ? "start" : from.toString()) + " to " + (to == null ? LocalDate.now(clock.withZone(IST)).toString() : to.toString())).row();
        csv.row("Category", "Level", "Active", "Partners", "Live partners", "Applications waiting", "Payments confirmed", "Collected (Rs)", "Failed payments", "Refunds due", "Refunds due (Rs)",
                "Refunded", "Refunded (Rs)", "VIBE fees (Rs)", "VIBE-funded discounts (Rs)");
        List<CategoryRow> all = new ArrayList<>(r.rows());
        all.add(r.membership());
        all.add(r.total());
        for (CategoryRow c : all) {
            csv.row(c.path(), c.level() == 0 ? "" : c.level(), c.active() ? "Yes" : "No", c.partners(), c.livePartners(), c.pendingApplications(), c.payments(), rupees(c.collected()), c.failed(),
                    c.refundsDue(), rupees(c.refundDueAmount()), c.refunded(), rupees(c.refundedAmount()), rupees(c.vibeFees()), rupees(c.vibeFunded()));
        }
        return csv.download("vibe-report-categories-" + LocalDate.now(clock.withZone(IST)) + ".csv");
    }

    public ResponseEntity<byte[]> membersCsv() {
        MembersReport m = members();
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("Customers", m.customers());
        summary.put("New customers (30 days)", m.newCustomers30d());
        summary.put("Members now", m.activeMembers());
        summary.put("Cancelled, still valid", m.cancelledStillValid());
        summary.put("Lapsed (membership ended)", m.lapsed());
        summary.put("Never joined", m.neverJoined());
        summary.put("Joined or renewed (30 days)", m.joined30d());
        summary.put("Membership revenue, 30 days (Rs)", rupees(m.revenue30d()));
        summary.put("Saved by members, 30 days (Rs)", rupees(m.savedByMembers30d()));
        Csv csv = new Csv().row("VIBE members report", LocalDate.now(clock.withZone(IST))).row();
        summary.forEach((k, v) -> csv.row(k, v));
        csv.row().row("Plan", "Members now", "Joined or renewed (30 days)", "Revenue, 30 days (Rs)");
        for (PlanRow p : m.plans()) csv.row(p.plan(), p.active(), p.joined30d(), rupees(p.revenue30d()));
        return csv.download("vibe-report-members-" + LocalDate.now(clock.withZone(IST)) + ".csv");
    }
}
