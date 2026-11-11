package in.vibe.backend.oversight;

import in.vibe.backend.audit.AuditService;
import in.vibe.backend.billing.Redemptions;
import in.vibe.backend.common.ApiException;
import in.vibe.backend.customer.Customers;
import in.vibe.backend.membership.Memberships;
import in.vibe.backend.security.StaffPrincipal;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * What VIBE staff need to see across the platform: a daily overview, every customer, every transaction, members, and deletion requests.
 * Customers' phone numbers are masked everywhere; revealing one is a separate action that is written to the audit log.
 */
@Service
public class AdminOversight {
    // ---------- overview ----------
    public record DayTotal(String day, long amount, int count) {}

    public record Overview(int customers, int newCustomers7d, int activeMembers, int redemptionsToday, int paidToday, long collectedToday, long collected7d, long membershipRevenue30d, long savedByMembers30d,
                           int liveBusinesses, int pendingOffers, int pendingEvents, int pendingApplications, int pendingDeletions, List<DayTotal> last14Days) {}

    // ---------- customers ----------
    public record CustomerRow(String id, String name, String vibeId, String phoneMasked, String area, OffsetDateTime joinedAt, boolean member, int paidRedemptions, long totalPaid) {}

    public record CustomerPage(List<CustomerRow> items, int total) {}

    public record RedemptionLine(String id, String businessName, String offerTitle, String status, Long payable, OffsetDateTime at) {}

    public record PaymentLine(String reference, String kind, String status, String payee, long amount, long savings, OffsetDateTime at) {}

    public record CustomerDetail(String id, String name, String vibeId, String phoneMasked, String area, OffsetDateTime joinedAt, Memberships.View membership, List<RedemptionLine> redemptions,
                                 List<PaymentLine> payments, boolean deletionRequested) {}

    // ---------- transactions ----------
    public record TransactionRow(String reference, String kind, String status, String method, long amount, long savings, String customerName, String vibeId, String payee, String provider,
                                 OffsetDateTime createdAt, OffsetDateTime verifiedAt) {}

    public record TransactionTotals(int count, long verifiedAmount, long savings) {}

    public record TransactionPage(List<TransactionRow> items, int total, TransactionTotals totals) {}

    public record TransactionDetail(TransactionRow row, String failureReason, String providerPaymentId, String billRef, String raisedBy, List<Redemptions.BillLine> lines, long eligibleAmount, long discount, String discountLabel, List<String> providerEvents) {}

    // ---------- members ----------
    public record MemberRow(String customerId, String name, String vibeId, String memberNo, String plan, String status, OffsetDateTime joinedAt, OffsetDateTime validUntil, long totalPaid, long totalSaved) {}

    public record MemberPage(List<MemberRow> items, int total) {}

    // ---------- deletion requests ----------
    public record DeletionRow(String id, String customerId, String name, String vibeId, String status, OffsetDateTime requestedAt) {}

    private final JdbcClient jdbc;
    private final AuditService audit;
    private final Clock clock;
    private final Memberships memberships;

    AdminOversight(JdbcClient jdbc, AuditService audit, Clock clock, Memberships memberships) {
        this.jdbc = jdbc;
        this.audit = audit;
        this.clock = clock;
        this.memberships = memberships;
    }

    private OffsetDateTime today() { return OffsetDateTime.now(clock).toLocalDate().atStartOfDay(clock.getZone()).toOffsetDateTime(); }

    private static String like(String q) { return "%" + q.trim().toLowerCase().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"; }

    // ---------- overview ----------
    public Overview overview() {
        OffsetDateTime t = today(), now = OffsetDateTime.now(clock);
        int customers = count("select count(*) from customers"), newCustomers = count("select count(*) from customers where created_at > :a", "a", now.minusDays(7));
        int members = count("select count(*) from memberships where valid_until > :n and status = 'active'", "n", now);
        int redemptionsToday = count("select count(*) from redemptions where created_at >= :t", "t", t);
        var paid = jdbc.sql("select count(*), coalesce(sum(amount), 0) from payments where status = 'verified' and verified_at >= :t").param("t", t).query((rs, i) -> new long[]{rs.getLong(1), rs.getLong(2)}).single();
        long c7 = jdbc.sql("select coalesce(sum(amount), 0) from payments where status = 'verified' and verified_at >= :a").param("a", t.minusDays(6)).query(Long.class).single();
        long membership30 = jdbc.sql("select coalesce(sum(amount), 0) from membership_payments where source = 'paid' and created_at > :a").param("a", now.minusDays(30)).query(Long.class).single();
        long saved30 = jdbc.sql("select coalesce(sum(saved), 0) from savings_events where at > :a").param("a", now.minusDays(30)).query(Long.class).single();
        List<DayTotal> days = new ArrayList<>();
        for (int d = 13; d >= 0; d--) {
            OffsetDateTime from = t.minusDays(d);
            var r = jdbc.sql("select count(*), coalesce(sum(amount), 0) from payments where status = 'verified' and verified_at >= :f and verified_at < :u").param("f", from).param("u", from.plusDays(1)).query((rs, i) -> new long[]{rs.getLong(1), rs.getLong(2)}).single();
            days.add(new DayTotal(from.toLocalDate().toString(), r[1], (int) r[0]));
        }
        return new Overview(customers, newCustomers, members, redemptionsToday, (int) paid[0], paid[1], c7, membership30, saved30,
                count("select count(*) from businesses where active"), count("select count(*) from offers where review_status = 'pending'"), count("select count(*) from events where status = 'pending'"),
                count("select count(*) from merchant_applications where status = 'pending'"), count("select count(*) from deletion_requests where status = 'pending'"), days);
    }

    private int count(String sql, Object... params) {
        JdbcClient.StatementSpec s = jdbc.sql(sql);
        for (int i = 0; i < params.length; i += 2) s = s.param((String) params[i], params[i + 1]);
        return s.query(Integer.class).single();
    }

    // ---------- customers ----------
    public CustomerPage customers(String q, int limit, int offset) {
        String where = " where true";
        Map<String, Object> p = new HashMap<>();
        if (q != null && !q.isBlank()) {
            String t = q.trim();
            if (t.matches("\\d{3,10}")) { where += " and (c.vibe_id like :d or c.phone like :d)"; p.put("d", t + "%"); }
            else { where += " and lower(c.name) like :n escape '\\'"; p.put("n", like(t)); }
        }
        JdbcClient.StatementSpec cnt = jdbc.sql("select count(*) from customers c" + where);
        JdbcClient.StatementSpec list = jdbc.sql("select c.id, c.name, c.vibe_id, c.phone, c.area, c.created_at, coalesce((select m.valid_until > now() from memberships m where m.customer_id = c.id), false) member, "
                + "(select count(*) from redemptions r where r.customer_id = c.id and r.status = 'paid') paid_n, (select coalesce(sum(amount), 0) from payments y where y.customer_id = c.id and y.status = 'verified') paid_sum "
                + "from customers c" + where + " order by c.created_at desc limit :lim offset :off");
        p.forEach((k, v) -> { cnt.param(k, v); list.param(k, v); });
        int total = cnt.query(Integer.class).single();
        List<CustomerRow> items = list.param("lim", Math.min(Math.max(limit, 1), 100)).param("off", Math.max(offset, 0))
                .query((rs, i) -> new CustomerRow(rs.getString("id"), rs.getString("name"), rs.getString("vibe_id"), masked(rs.getString("phone")), rs.getString("area"), rs.getObject("created_at", OffsetDateTime.class),
                        rs.getBoolean("member"), rs.getInt("paid_n"), rs.getLong("paid_sum"))).list();
        return new CustomerPage(items, total);
    }

    static String masked(String phone) { return "+91 " + phone.substring(0, 5) + " •••" + phone.substring(8); }

    public CustomerDetail customer(UUID id) {
        var c = jdbc.sql("select id, name, vibe_id, phone, area, created_at from customers where id = :id").param("id", id)
                .query((rs, i) -> new Object[]{rs.getString(1), rs.getString(2), rs.getString(3), masked(rs.getString(4)), rs.getString(5), rs.getObject(6, OffsetDateTime.class)}).optional().orElseThrow(() -> ApiException.notFound("Customer not found."));
        List<RedemptionLine> reds = jdbc.sql("select r.id, b.name, o.title, r.status, pr.payable, r.created_at from redemptions r join businesses b on b.id = r.business_id join offers o on o.id = r.offer_id "
                        + "left join payment_requests pr on pr.id = r.payment_request_id where r.customer_id = :c order by r.created_at desc limit 20").param("c", id)
                .query((rs, i) -> new RedemptionLine(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getObject(5) == null ? null : rs.getLong(5), rs.getObject(6, OffsetDateTime.class))).list();
        List<PaymentLine> pays = jdbc.sql("select p.reference, pr.kind, p.status, coalesce(b.name, 'VIBE Membership'), p.amount, p.savings, p.created_at from payments p join payment_requests pr on pr.id = p.payment_request_id "
                        + "left join businesses b on b.id = pr.business_id where p.customer_id = :c order by p.created_at desc limit 20").param("c", id)
                .query((rs, i) -> new PaymentLine(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getLong(5), rs.getLong(6), rs.getObject(7, OffsetDateTime.class))).list();
        boolean deletion = count("select count(*) from deletion_requests where customer_id = :c and status = 'pending'", "c", id) > 0;
        return new CustomerDetail((String) c[0], (String) c[1], (String) c[2], (String) c[3], (String) c[4], (OffsetDateTime) c[5], memberships.view(id), reds, pays, deletion);
    }

    /** The full number, for a support call. Every reveal is written to the audit log with who looked. */
    @Transactional
    public Map<String, String> revealPhone(StaffPrincipal who, UUID id) {
        String phone = jdbc.sql("select phone from customers where id = :id").param("id", id).query(String.class).optional().orElseThrow(() -> ApiException.notFound("Customer not found."));
        audit.record(who, "reveal_phone", "customer", id, "");
        return Map.of("phone", "+91 " + phone);
    }

    // ---------- transactions ----------
    public TransactionPage transactions(String status, String kind, String q, int limit, int offset) {
        StringBuilder where = new StringBuilder(" where true");
        Map<String, Object> p = new HashMap<>();
        if (status != null && !status.isBlank()) { where.append(" and p.status = :st"); p.put("st", status); }
        if (kind != null && !kind.isBlank()) { where.append(" and pr.kind = :k"); p.put("k", kind); }
        if (q != null && !q.isBlank()) {
            String t = q.trim();
            if (t.matches("\\d{3,6}")) { where.append(" and c.vibe_id like :v"); p.put("v", t + "%"); }
            else { where.append(" and (lower(p.reference) like :r escape '\\' or lower(coalesce(b.name, 'vibe membership')) like :r escape '\\')"); p.put("r", like(t)); }
        }
        String from = " from payments p join payment_requests pr on pr.id = p.payment_request_id join customers c on c.id = p.customer_id left join businesses b on b.id = pr.business_id";
        JdbcClient.StatementSpec cnt = jdbc.sql("select count(*), coalesce(sum(p.amount) filter (where p.status = 'verified'), 0), coalesce(sum(p.savings) filter (where p.status = 'verified'), 0)" + from + where);
        JdbcClient.StatementSpec list = jdbc.sql("select p.reference, pr.kind, p.status, p.method, p.amount, p.savings, c.name cname, c.vibe_id, coalesce(b.name, 'VIBE Membership') payee, p.provider, p.created_at, p.verified_at" + from + where + " order by p.created_at desc limit :lim offset :off");
        p.forEach((k, v) -> { cnt.param(k, v); list.param(k, v); });
        TransactionTotals totals = cnt.query((rs, i) -> new TransactionTotals(rs.getInt(1), rs.getLong(2), rs.getLong(3))).single();
        List<TransactionRow> items = list.param("lim", Math.min(Math.max(limit, 1), 100)).param("off", Math.max(offset, 0)).query((rs, i) -> row(rs)).list();
        return new TransactionPage(items, totals.count(), totals);
    }

    private static TransactionRow row(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new TransactionRow(rs.getString("reference"), rs.getString("kind"), rs.getString("status"), rs.getString("method"), rs.getLong("amount"), rs.getLong("savings"), Customers.displayName(rs.getString("cname")), rs.getString("vibe_id"),
                rs.getString("payee"), rs.getString("provider"), rs.getObject("created_at", OffsetDateTime.class), rs.getObject("verified_at", OffsetDateTime.class));
    }

    public TransactionDetail transaction(String reference) {
        var d = jdbc.sql("select p.reference, pr.kind, p.status, p.method, p.amount, p.savings, c.name cname, c.vibe_id, coalesce(b.name, 'VIBE Membership') payee, p.provider, p.created_at, p.verified_at, p.failure_reason, p.provider_payment_id, "
                        + "p.provider_order_id, pr.id prid, pr.bill_ref, pr.raised_by, pr.eligible_amount, pr.discount, pr.discount_label from payments p join payment_requests pr on pr.id = p.payment_request_id join customers c on c.id = p.customer_id "
                        + "left join businesses b on b.id = pr.business_id where p.reference = :r").param("r", reference).query((rs, i) -> new Object[]{row(rs), rs.getString("failure_reason"), rs.getString("provider_payment_id"), rs.getString("bill_ref"),
                        rs.getString("raised_by"), (UUID) rs.getObject("prid"), rs.getLong("eligible_amount"), rs.getLong("discount"), rs.getString("discount_label"), rs.getString("provider_order_id")}).optional()
                .orElseThrow(() -> ApiException.notFound("Transaction not found."));
        List<Redemptions.BillLine> lines = jdbc.sql("select label, amount from payment_request_lines where payment_request_id = :id order by position").param("id", d[5]).query((rs, i) -> new Redemptions.BillLine(rs.getString(1), rs.getLong(2))).list();
        List<String> events = jdbc.sql("select received_at || ' ' || event_id from provider_events where payload like :o order by id").param("o", "%" + d[9] + "%").query(String.class).list();
        return new TransactionDetail((TransactionRow) d[0], (String) d[1], (String) d[2], (String) d[3], (String) d[4], lines, (Long) d[6], (Long) d[7], (String) d[8], events);
    }

    // ---------- members ----------
    public MemberPage members(String status, String q, int limit, int offset) {
        StringBuilder where = new StringBuilder(" where true");
        Map<String, Object> p = new HashMap<>();
        if ("active".equals(status)) where.append(" and m.valid_until > now() and m.status = 'active'");
        else if ("cancelled".equals(status)) where.append(" and m.valid_until > now() and m.status = 'cancelled'");
        else if ("expired".equals(status)) where.append(" and m.valid_until <= now()");
        if (q != null && !q.isBlank()) {
            String t = q.trim();
            if (t.matches("\\d{3,10}")) { where.append(" and (c.vibe_id like :d or c.phone like :d)"); p.put("d", t + "%"); }
            else { where.append(" and lower(c.name) like :n escape '\\'"); p.put("n", like(t)); }
        }
        String from = " from memberships m join customers c on c.id = m.customer_id left join membership_plans pl on pl.id = m.plan_id";
        JdbcClient.StatementSpec cnt = jdbc.sql("select count(*)" + from + where);
        JdbcClient.StatementSpec list = jdbc.sql("select c.id, c.name, c.vibe_id, m.member_no, coalesce(pl.name, '') plan, m.status, m.valid_until, m.started_at, "
                + "(select coalesce(sum(amount), 0) from membership_payments x where x.customer_id = c.id and x.source = 'paid') paid, (select coalesce(sum(saved), 0) from savings_events s where s.customer_id = c.id) saved" + from + where + " order by m.started_at desc limit :lim offset :off");
        p.forEach((k, v) -> { cnt.param(k, v); list.param(k, v); });
        int total = cnt.query(Integer.class).single();
        OffsetDateTime now = OffsetDateTime.now(clock);
        List<MemberRow> items = list.param("lim", Math.min(Math.max(limit, 1), 100)).param("off", Math.max(offset, 0)).query((rs, i) -> {
            OffsetDateTime until = rs.getObject("valid_until", OffsetDateTime.class);
            String st = !until.isAfter(now) ? "expired" : rs.getString("status");
            return new MemberRow(rs.getString("id"), rs.getString("name"), rs.getString("vibe_id"), rs.getString("member_no"), rs.getString("plan"), st, rs.getObject("started_at", OffsetDateTime.class), until, rs.getLong("paid"), rs.getLong("saved"));
        }).list();
        return new MemberPage(items, total);
    }

    // ---------- deletion requests ----------
    public List<DeletionRow> deletions(String status) {
        return jdbc.sql("select d.id, d.customer_id, c.name, c.vibe_id, d.status, d.requested_at from deletion_requests d join customers c on c.id = d.customer_id" + (status == null || status.isBlank() ? "" : " where d.status = :s")
                + " order by d.requested_at desc limit 200").param("s", status == null ? "" : status).query((rs, i) -> new DeletionRow(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5), rs.getObject(6, OffsetDateTime.class))).list();
    }

    /** Marks the request handled once the customer's personal data has been erased. The erasure itself is a manual process for now, and the retention rules for payment records need legal advice. */
    @Transactional
    public void completeDeletion(StaffPrincipal who, UUID id) {
        if (jdbc.sql("update deletion_requests set status = 'done' where id = :id and status = 'pending'").param("id", id).update() == 0) throw ApiException.conflict("not_pending", "That request is already done.");
        audit.record(who, "complete_deletion", "deletion_request", id, "");
    }
}
