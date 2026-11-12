package in.vibe.backend.settlement;

import in.vibe.backend.audit.AuditService;
import in.vibe.backend.common.ApiException;
import in.vibe.backend.customer.Customers;
import in.vibe.backend.notify.StaffNotifications;
import in.vibe.backend.security.StaffPrincipal;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.text.NumberFormat;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * What VIBE owes each business, and paying it. Every confirmed payment made at a business (bills today, tickets and reservations later) is owed to that
 * business, less VIBE's fee (if the customer paid one) and VIBE's commission. A settlement gathers all of a business's unsettled payments up to a date,
 * once: the database allows a payment in one settlement only. The business is told when a settlement is drawn up and when it has been paid.
 */
@Service
public class Settlements {
    public record Due(String businessId, String businessName, String area, int commissionBps, int count, long gross, long vibeFees, long commission, long payout, long customerSavings,
                      OffsetDateTime oldest, OffsetDateTime newest) {}

    public record Summary(String id, String reference, String businessId, String businessName, OffsetDateTime periodFrom, OffsetDateTime periodTo, int paymentCount, long gross, long vibeFees,
                          int commissionBps, long commission, long payout, long customerSavings, String status, OffsetDateTime createdAt, OffsetDateTime paidAt, String payoutRef, String note) {}

    public record Item(String paymentReference, OffsetDateTime paidAt, String customerName, String vibeId, String billRef, String offerTitle, long amount, long vibeFee, long commission, long payout,
                       long customerSaved) {}

    public record Detail(Summary summary, List<Item> items) {}

    public record Balance(int count, long gross, long commission, long payout) {}

    public record MerchantView(Balance unsettled, long awaitingPayout, long paidOut, int commissionBps, List<Summary> settlements) {}

    public record CreateInput(@NotBlank String businessId, OffsetDateTime upTo) {}

    public record PaidInput(@NotBlank @Size(max = 60) String payoutRef, @Size(max = 300) String note) {}

    public record Terms(String businessId, String businessName, int commissionBps, boolean autoApprove) {}

    public record TermsInput(@NotNull @Min(0) @Max(5000) Integer commissionBps, @NotNull Boolean autoApprove, @NotBlank @Size(max = 200) String reason) {}

    /** Confirmed payments at a business that no settlement includes yet. */
    /** Verified payments to businesses not yet in a settlement and without a refund. */
    public static final String UNSETTLED = " from payments p join payment_requests pr on pr.id = p.payment_request_id join businesses b on b.id = pr.business_id "
            + "where p.status = 'verified' and p.refund_status is null and pr.business_id is not null and not exists (select 1 from settlement_items si where si.payment_id = p.id)";

    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("d MMM").withZone(ZoneId.of("Asia/Kolkata"));
    private static final String ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private final SecureRandom random = new SecureRandom();

    private final JdbcClient jdbc;
    private final AuditService audit;
    private final StaffNotifications staffNotifications;
    private final Clock clock;

    Settlements(JdbcClient jdbc, AuditService audit, StaffNotifications staffNotifications, Clock clock) {
        this.jdbc = jdbc;
        this.audit = audit;
        this.staffNotifications = staffNotifications;
        this.clock = clock;
    }

    static String inr(long paise) {
        NumberFormat f = NumberFormat.getCurrencyInstance(Locale.of("en", "IN"));
        f.setMaximumFractionDigits(paise % 100 == 0 ? 0 : 2);
        return f.format(paise / 100.0);
    }

    // ---------- admin ----------
    public List<Due> due() {
        return jdbc.sql("select b.id, b.name, b.area, b.commission_bps, count(*) n, sum(p.amount + pr.vibe_funded) gross, sum(pr.vibe_fee) fees, sum(((p.amount + pr.vibe_funded - pr.vibe_fee) * b.commission_bps) / 10000) comm, "
                        + "sum(p.savings) saved, min(p.verified_at) oldest, max(p.verified_at) newest" + UNSETTLED + " group by b.id, b.name, b.area, b.commission_bps order by min(p.verified_at)")
                .query((rs, i) -> {
                    long gross = rs.getLong("gross"), fees = rs.getLong("fees"), comm = rs.getLong("comm");
                    return new Due(rs.getString("id"), rs.getString("name"), rs.getString("area"), rs.getInt("commission_bps"), rs.getInt("n"), gross, fees, comm, gross - fees - comm, rs.getLong("saved"),
                            rs.getObject("oldest", OffsetDateTime.class), rs.getObject("newest", OffsetDateTime.class));
                }).list();
    }

    private record Owed(UUID paymentId, long amount, long vibeFee, long savings, OffsetDateTime at) {}

    @Transactional
    public Detail create(StaffPrincipal who, CreateInput in) {
        UUID business = uuid(in.businessId());
        Terms terms = terms(business);
        OffsetDateTime upTo = in.upTo() == null ? OffsetDateTime.now(clock) : in.upTo();
        // Two admins pressing the button together must not draw up two settlements for the same payments.
        jdbc.sql("select pg_advisory_xact_lock(hashtext(:k))").param("k", "settle:" + business).query((rs, i) -> 0).list();
        List<Owed> owed = jdbc.sql("select p.id, p.amount + pr.vibe_funded amount, pr.vibe_fee, p.savings, p.verified_at" + UNSETTLED + " and pr.business_id = :b and p.verified_at <= :u order by p.verified_at")
                .param("b", business).param("u", upTo)
                .query((rs, i) -> new Owed((UUID) rs.getObject("id"), rs.getLong("amount"), rs.getLong("vibe_fee"), rs.getLong("savings"), rs.getObject("verified_at", OffsetDateTime.class))).list();
        if (owed.isEmpty()) throw ApiException.conflict("nothing_to_settle", "There are no confirmed payments to settle for this business up to that date.");

        UUID id = UUID.randomUUID();
        long gross = 0, fees = 0, commission = 0, saved = 0;
        for (Owed o : owed) {
            gross += o.amount();
            fees += o.vibeFee();
            commission += (o.amount() - o.vibeFee()) * terms.commissionBps() / 10000;
            saved += o.savings();
        }
        long payout = gross - fees - commission;
        String reference = reference();
        jdbc.sql("insert into settlements (id, reference, business_id, period_from, period_to, payment_count, gross, vibe_fees, commission_bps, commission, payout, customer_savings, created_by) "
                        + "values (:id, :ref, :b, :f, :t, :n, :g, :fees, :bps, :c, :p, :s, :by)")
                .param("id", id).param("ref", reference).param("b", business).param("f", owed.getFirst().at()).param("t", upTo).param("n", owed.size()).param("g", gross).param("fees", fees)
                .param("bps", terms.commissionBps()).param("c", commission).param("p", payout).param("s", saved).param("by", who.id()).update();
        for (Owed o : owed) {
            long c = (o.amount() - o.vibeFee()) * terms.commissionBps() / 10000;
            jdbc.sql("insert into settlement_items (settlement_id, payment_id, amount, vibe_fee, commission, payout) values (:s, :p, :a, :f, :c, :o)")
                    .param("s", id).param("p", o.paymentId()).param("a", o.amount()).param("f", o.vibeFee()).param("c", c).param("o", o.amount() - o.vibeFee() - c).update();
        }
        audit.record(who, "create", "settlement", id, reference + " " + terms.businessName() + " " + inr(payout));
        staffNotifications.toBusiness(business, "settlement_created", "Settlement " + reference + ": " + inr(payout),
                owed.size() + " payments, " + DAY.format(owed.getFirst().at()) + " to " + DAY.format(upTo) + ". VIBE will pay it to your bank and tell you here.", "/settlements");
        return detail(id, null);
    }

    @Transactional
    public Detail markPaid(StaffPrincipal who, UUID id, PaidInput in) {
        Summary s = summary(id, null);
        if ("paid".equals(s.status())) throw ApiException.conflict("already_paid", "This settlement is already marked as paid.");
        jdbc.sql("update settlements set status = 'paid', paid_at = now(), paid_by = :by, payout_ref = :r, note = :n where id = :id and status = 'pending'")
                .param("by", who.id()).param("r", in.payoutRef().trim()).param("n", in.note() == null || in.note().isBlank() ? null : in.note().trim()).param("id", id).update();
        audit.record(who, "paid", "settlement", id, s.reference() + " ref " + in.payoutRef().trim());
        staffNotifications.toBusiness(UUID.fromString(s.businessId()), "settlement_paid", "Paid: " + inr(s.payout()) + " for " + s.reference(),
                "Bank reference " + in.payoutRef().trim() + ". It may take a working day to show in your account.", "/settlements");
        return detail(id, null);
    }

    public List<Summary> list(String status, UUID business) {
        StringBuilder w = new StringBuilder(" where true");
        if (status != null && !status.isBlank()) w.append(" and s.status = :st");
        if (business != null) w.append(" and s.business_id = :b");
        JdbcClient.StatementSpec q = jdbc.sql("select s.*, b.name bname from settlements s join businesses b on b.id = s.business_id" + w + " order by s.created_at desc limit 500");
        if (status != null && !status.isBlank()) q.param("st", status);
        if (business != null) q.param("b", business);
        return q.query(Settlements::map).list();
    }

    /** `business` limits it to one business (a merchant may only open their own). */
    public Detail detail(UUID id, UUID business) {
        Summary s = summary(id, business);
        List<Item> items = jdbc.sql("select p.reference, p.verified_at, c.name, c.vibe_id, pr.bill_ref, coalesce(o.title, ev.title) title, si.amount, si.vibe_fee, si.commission, si.payout, p.savings "
                        + "from settlement_items si join payments p on p.id = si.payment_id join payment_requests pr on pr.id = p.payment_request_id join customers c on c.id = p.customer_id "
                        + "left join redemptions r on r.id = pr.redemption_id left join offers o on o.id = r.offer_id left join ticket_reservations tr on tr.id = pr.reservation_id left join events ev on ev.id = tr.event_id where si.settlement_id = :id order by p.verified_at")
                .param("id", id).query((rs, i) -> new Item(rs.getString("reference"), rs.getObject("verified_at", OffsetDateTime.class), Customers.displayName(rs.getString("name")), rs.getString("vibe_id"),
                        rs.getString("bill_ref"), rs.getString("title"), rs.getLong("amount"), rs.getLong("vibe_fee"), rs.getLong("commission"), rs.getLong("payout"), rs.getLong("savings"))).list();
        return new Detail(s, items);
    }

    private Summary summary(UUID id, UUID business) {
        JdbcClient.StatementSpec q = jdbc.sql("select s.*, b.name bname from settlements s join businesses b on b.id = s.business_id where s.id = :id" + (business == null ? "" : " and s.business_id = :b")).param("id", id);
        if (business != null) q.param("b", business);
        return q.query(Settlements::map).optional().orElseThrow(() -> ApiException.notFound("Settlement not found."));
    }

    private static Summary map(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        return new Summary(rs.getString("id"), rs.getString("reference"), rs.getString("business_id"), rs.getString("bname"), rs.getObject("period_from", OffsetDateTime.class),
                rs.getObject("period_to", OffsetDateTime.class), rs.getInt("payment_count"), rs.getLong("gross"), rs.getLong("vibe_fees"), rs.getInt("commission_bps"), rs.getLong("commission"),
                rs.getLong("payout"), rs.getLong("customer_savings"), rs.getString("status"), rs.getObject("created_at", OffsetDateTime.class), rs.getObject("paid_at", OffsetDateTime.class),
                rs.getString("payout_ref"), rs.getString("note"));
    }

    // ---------- commercial terms ----------
    public Terms terms(UUID business) {
        return jdbc.sql("select id, name, commission_bps, auto_approve from businesses where id = :id").param("id", business)
                .query((rs, i) -> new Terms(rs.getString("id"), rs.getString("name"), rs.getInt("commission_bps"), rs.getBoolean("auto_approve"))).optional()
                .orElseThrow(() -> ApiException.notFound("Business not found."));
    }

    /** Changing the commission applies to settlements drawn up from now on; ones already drawn up keep the rate they were made with. */
    @Transactional
    public Terms updateTerms(StaffPrincipal who, UUID business, TermsInput in) {
        Terms before = terms(business);
        jdbc.sql("update businesses set commission_bps = :c, auto_approve = :a, updated_at = now() where id = :id").param("c", in.commissionBps()).param("a", in.autoApprove()).param("id", business).update();
        audit.record(who, "terms", "business", business, "commission " + before.commissionBps() / 100.0 + "% -> " + in.commissionBps() / 100.0 + "%, auto-approve " + before.autoApprove() + " -> "
                + in.autoApprove() + ". Reason: " + in.reason().trim());
        if (before.autoApprove() != in.autoApprove()) {
            staffNotifications.toBusiness(business, "auto_approve", in.autoApprove() ? "Your offers and events now go live straight away" : "Your offers and events are reviewed again",
                    in.autoApprove() ? "VIBE trusts your listings: new offers and events are published without waiting for review. VIBE can still switch them off." : "New and changed offers and events wait for VIBE’s review before customers see them.", "/offers");
        }
        return terms(business);
    }

    // ---------- merchant ----------
    public MerchantView merchantView(UUID business) {
        Balance unsettled = jdbc.sql("select count(*), coalesce(sum(p.amount + pr.vibe_funded), 0), coalesce(sum(((p.amount + pr.vibe_funded - pr.vibe_fee) * b.commission_bps) / 10000), 0), coalesce(sum(p.amount + pr.vibe_funded - pr.vibe_fee), 0)" + UNSETTLED
                        + " and pr.business_id = :b").param("b", business)
                .query((rs, i) -> new Balance(rs.getInt(1), rs.getLong(2), rs.getLong(3), rs.getLong(4) - rs.getLong(3))).single();
        long[] paid = jdbc.sql("select coalesce(sum(payout) filter (where status = 'pending'), 0), coalesce(sum(payout) filter (where status = 'paid'), 0) from settlements where business_id = :b")
                .param("b", business).query((rs, i) -> new long[]{rs.getLong(1), rs.getLong(2)}).single();
        return new MerchantView(unsettled, paid[0], paid[1], terms(business).commissionBps(), list(null, business));
    }

    private String reference() {
        StringBuilder s = new StringBuilder("ST-").append(DateTimeFormatter.ofPattern("yyMMdd").withZone(ZoneId.of("Asia/Kolkata")).format(OffsetDateTime.now(clock))).append('-');
        for (int i = 0; i < 4; i++) s.append(ALPHABET.charAt(random.nextInt(ALPHABET.length())));
        return s.toString();
    }

    static UUID uuid(String s) {
        try { return UUID.fromString(s); } catch (IllegalArgumentException e) { throw ApiException.notFound("Not found."); }
    }
}
