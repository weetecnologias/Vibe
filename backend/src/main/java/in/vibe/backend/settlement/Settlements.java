package in.vibe.backend.settlement;

import in.vibe.backend.audit.AuditService;
import in.vibe.backend.common.ApiException;
import in.vibe.backend.customer.Customers;
import in.vibe.backend.finance.Ledger;
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
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * What VIBE owes each business, and paying it. Every confirmed payment made at a business (bills today, tickets and reservations later) is owed to that
 * business, less VIBE's fee (if the customer paid one) and VIBE's commission. A settlement gathers all of a business's unsettled payments up to a date,
 * once: the database allows a payment in one settlement only. The business is told when a settlement is drawn up and when it has been paid.
 */
@Service
public class Settlements {
    /** commissionBps is the rate now; commission and gst are what the payments were actually charged. kycStatus: whether VIBE may pay this business out. */
    public record Due(String businessId, String businessName, String area, int commissionBps, int count, long gross, long vibeFees, long commission, long payout, long customerSavings,
                      OffsetDateTime oldest, OffsetDateTime newest, long gst, long refundDeductions, long adjustments, String kycStatus) {}

    public record Summary(String id, String reference, String businessId, String businessName, OffsetDateTime periodFrom, OffsetDateTime periodTo, int paymentCount, long gross, long vibeFees,
                          int commissionBps, long commission, long payout, long customerSavings, String status, OffsetDateTime createdAt, OffsetDateTime paidAt, String payoutRef, String note,
                          long gst, long refundDeductions, long adjustments) {}

    public record Item(String paymentReference, OffsetDateTime paidAt, String customerName, String vibeId, String billRef, String offerTitle, long amount, long vibeFee, long commission, long payout,
                       long customerSaved, long gst, long refundShare) {}

    public record Detail(Summary summary, List<Item> items, List<in.vibe.backend.finance.Adjustments.Row> adjustments) {}

    public record Balance(int count, long gross, long commission, long payout) {}

    public record MerchantView(Balance unsettled, long awaitingPayout, long paidOut, int commissionBps, List<Summary> settlements) {}

    public record CreateInput(@NotBlank String businessId, OffsetDateTime upTo) {}

    public record PaidInput(@NotBlank @Size(max = 60) String payoutRef, @Size(max = 300) String note) {}

    public record Terms(String businessId, String businessName, int commissionBps, boolean autoApprove, String rateSource, String rateSourceName, int gstBps) {}

    public record TermsInput(@NotNull @Min(0) @Max(5000) Integer commissionBps, @NotNull Boolean autoApprove, @NotBlank @Size(max = 200) String reason) {}

    /** Confirmed payments at a business that no settlement includes yet. */
    /** Verified payments to businesses not yet in a settlement, except those whose whole sale was refunded. */
    public static final String UNSETTLED = " from payments p join payment_requests pr on pr.id = p.payment_request_id join businesses b on b.id = pr.business_id "
            + "where p.status = 'verified' and not p.refund_full_reversal and pr.business_id is not null and not exists (select 1 from settlement_items si where si.payment_id = p.id)";

    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("d MMM").withZone(ZoneId.of("Asia/Kolkata"));
    private static final String ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private final SecureRandom random = new SecureRandom();

    private final JdbcClient jdbc;
    private final AuditService audit;
    private final StaffNotifications staffNotifications;
    private final Clock clock;

    private final in.vibe.backend.finance.RateCards rateCards;
    private final in.vibe.backend.finance.Ledger ledger;
    private final in.vibe.backend.finance.Adjustments adjustments;
    private final in.vibe.backend.compliance.Kyc kyc;

    Settlements(JdbcClient jdbc, AuditService audit, StaffNotifications staffNotifications, Clock clock, in.vibe.backend.finance.RateCards rateCards, in.vibe.backend.finance.Ledger ledger,
                in.vibe.backend.finance.Adjustments adjustments, in.vibe.backend.compliance.Kyc kyc) {
        this.rateCards = rateCards;
        this.ledger = ledger;
        this.adjustments = adjustments;
        this.kyc = kyc;
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
        Map<String, Long> pending = new HashMap<>();
        jdbc.sql("select business_id, sum(amount) from settlement_adjustments where settlement_id is null group by business_id").query((rs, i) -> pending.put(rs.getString(1), rs.getLong(2))).list();
        return jdbc.sql("select b.id, b.name, b.area, count(*) n, sum(p.amount + pr.vibe_funded) gross, sum(pr.vibe_fee) fees, sum(p.commission) comm, sum(p.gst) gst, sum(p.refund_merchant_share) refunds, "
                        + "sum(p.savings) saved, min(p.verified_at) oldest, max(p.verified_at) newest" + UNSETTLED + " group by b.id, b.name, b.area order by min(p.verified_at)")
                .query((rs, i) -> {
                    long gross = rs.getLong("gross"), fees = rs.getLong("fees"), comm = rs.getLong("comm"), gst = rs.getLong("gst"), refunds = rs.getLong("refunds"), adj = pending.getOrDefault(rs.getString("id"), 0L);
                    UUID biz = UUID.fromString(rs.getString("id"));
                    return new Due(rs.getString("id"), rs.getString("name"), rs.getString("area"), rateCards.rateNow(biz).bps(), rs.getInt("n"), gross, fees, comm, gross - fees - comm - gst - refunds + adj, rs.getLong("saved"),
                            rs.getObject("oldest", OffsetDateTime.class), rs.getObject("newest", OffsetDateTime.class), gst, refunds, adj, kyc.status(biz));
                }).list();
    }

    private record Owed(UUID paymentId, long amount, long vibeFee, long commission, long gst, long refundShare, long savings, OffsetDateTime at) {}

    @Transactional
    public Detail create(StaffPrincipal who, CreateInput in) {
        UUID business = uuid(in.businessId());
        Terms terms = terms(business);
        OffsetDateTime upTo = in.upTo() == null ? OffsetDateTime.now(clock) : in.upTo();
        // Two admins pressing the button together must not draw up two settlements for the same payments.
        jdbc.sql("select pg_advisory_xact_lock(hashtext(:k))").param("k", "settle:" + business).query((rs, i) -> 0).list();
        List<Owed> owed = jdbc.sql("select p.id, p.amount + pr.vibe_funded amount, pr.vibe_fee, p.commission, p.gst, p.refund_merchant_share, p.savings, p.verified_at" + UNSETTLED + " and pr.business_id = :b and p.verified_at <= :u order by p.verified_at")
                .param("b", business).param("u", upTo)
                .query((rs, i) -> new Owed((UUID) rs.getObject("id"), rs.getLong("amount"), rs.getLong("vibe_fee"), rs.getLong("commission"), rs.getLong("gst"), rs.getLong("refund_merchant_share"), rs.getLong("savings"),
                        rs.getObject("verified_at", OffsetDateTime.class))).list();
        if (owed.isEmpty()) throw ApiException.conflict("nothing_to_settle", "There are no confirmed payments to settle for this business up to that date.");

        UUID id = UUID.randomUUID();
        long gross = 0, fees = 0, commission = 0, gst = 0, refunds = 0, saved = 0;
        for (Owed o : owed) {
            gross += o.amount();
            fees += o.vibeFee();
            commission += o.commission();
            gst += o.gst();
            refunds += o.refundShare();
            saved += o.savings();
        }
        long adj = adjustments.lockPending(business).stream().mapToLong(x -> x[0]).sum();
        long payout = gross - fees - commission - gst - refunds + adj;
        if (payout < 0) throw ApiException.conflict("negative_payout", "This business owes VIBE " + inr(-payout) + " after adjustments and refunds. Wait for more payments, or review the adjustments.");
        String reference = reference();
        jdbc.sql("insert into settlements (id, reference, business_id, period_from, period_to, payment_count, gross, vibe_fees, commission_bps, commission, payout, customer_savings, created_by, gst, refund_deductions, adjustments) "
                        + "values (:id, :ref, :b, :f, :t, :n, :g, :fees, :bps, :c, :p, :s, :by, :gst, :rd, :adj)")
                .param("id", id).param("ref", reference).param("b", business).param("f", owed.getFirst().at()).param("t", upTo).param("n", owed.size()).param("g", gross).param("fees", fees)
                .param("bps", terms.commissionBps()).param("c", commission).param("p", payout).param("s", saved).param("by", who.id()).param("gst", gst).param("rd", refunds).param("adj", adj).update();
        for (Owed o : owed) {
            jdbc.sql("insert into settlement_items (settlement_id, payment_id, amount, vibe_fee, commission, payout, gst, refund_share) values (:s, :p, :a, :f, :c, :o, :g, :r)")
                    .param("s", id).param("p", o.paymentId()).param("a", o.amount()).param("f", o.vibeFee()).param("c", o.commission()).param("o", o.amount() - o.vibeFee() - o.commission() - o.gst() - o.refundShare())
                    .param("g", o.gst()).param("r", o.refundShare()).update();
        }
        jdbc.sql("update settlement_adjustments set settlement_id = :s where business_id = :b and settlement_id is null").param("s", id).param("b", business).update();
        audit.record(who, "create", "settlement", id, reference + " " + terms.businessName() + " " + inr(payout));
        staffNotifications.toBusiness(business, "settlement_created", "Settlement " + reference + ": " + inr(payout),
                owed.size() + " payments, " + DAY.format(owed.getFirst().at()) + " to " + DAY.format(upTo) + ". VIBE will pay it to your bank and tell you here.", "/settlements");
        return detail(id, null);
    }

    @Transactional
    public Detail markPaid(StaffPrincipal who, UUID id, PaidInput in) {
        Summary s = summary(id, null);
        if ("paid".equals(s.status())) throw ApiException.conflict("already_paid", "This settlement is already marked as paid.");
        kyc.requireVerified(UUID.fromString(s.businessId()));
        jdbc.sql("update settlements set status = 'paid', paid_at = now(), paid_by = :by, payout_ref = :r, note = :n where id = :id and status = 'pending'")
                .param("by", who.id()).param("r", in.payoutRef().trim()).param("n", in.note() == null || in.note().isBlank() ? null : in.note().trim()).param("id", id).update();
        ledger.post("payout", "settlement", s.reference(), "Paid to " + s.businessName() + ", bank ref " + in.payoutRef().trim(),
                List.of(Ledger.Line.dr(Ledger.merchant(UUID.fromString(s.businessId())), s.payout()), Ledger.Line.cr("gateway", s.payout())));
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
        List<Item> items = jdbc.sql("select p.reference, p.verified_at, c.name, c.vibe_id, pr.bill_ref, coalesce(o.title, ev.title) title, si.amount, si.vibe_fee, si.commission, si.payout, p.savings, si.gst, si.refund_share "
                        + "from settlement_items si join payments p on p.id = si.payment_id join payment_requests pr on pr.id = p.payment_request_id join customers c on c.id = p.customer_id "
                        + "left join redemptions r on r.id = pr.redemption_id left join offers o on o.id = r.offer_id left join ticket_reservations tr on tr.id = pr.reservation_id left join events ev on ev.id = tr.event_id where si.settlement_id = :id order by p.verified_at")
                .param("id", id).query((rs, i) -> new Item(rs.getString("reference"), rs.getObject("verified_at", OffsetDateTime.class), Customers.displayName(rs.getString("name")), rs.getString("vibe_id"),
                        rs.getString("bill_ref"), rs.getString("title"), rs.getLong("amount"), rs.getLong("vibe_fee"), rs.getLong("commission"), rs.getLong("payout"), rs.getLong("savings"), rs.getLong("gst"), rs.getLong("refund_share"))).list();
        List<in.vibe.backend.finance.Adjustments.Row> adj = jdbc.sql("select id from settlement_adjustments where settlement_id = :s order by created_at").param("s", id).query(UUID.class).list().stream().map(adjustments::one).toList();
        return new Detail(s, items, adj);
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
                rs.getString("payout_ref"), rs.getString("note"), rs.getLong("gst"), rs.getLong("refund_deductions"), rs.getLong("adjustments"));
    }

    // ---------- commercial terms ----------
    public Terms terms(UUID business) {
        var rate = rateCards.rateNow(business);
        return jdbc.sql("select id, name, auto_approve from businesses where id = :id").param("id", business)
                .query((rs, i) -> new Terms(rs.getString("id"), rs.getString("name"), rate.bps(), rs.getBoolean("auto_approve"), rate.source(), rate.sourceName(), rateCards.gstBps())).optional()
                .orElseThrow(() -> ApiException.notFound("Business not found."));
    }

    /** Changing the commission applies to settlements drawn up from now on; ones already drawn up keep the rate they were made with. */
    @Transactional
    public Terms updateTerms(StaffPrincipal who, UUID business, TermsInput in) {
        Terms before = terms(business);
        jdbc.sql("update businesses set auto_approve = :a, updated_at = now() where id = :id").param("a", in.autoApprove()).param("id", business).update();
        if (before.commissionBps() != in.commissionBps() || !"business".equals(before.rateSource())) {
            rateCards.add(who, new in.vibe.backend.finance.RateCards.Input("business", business.toString(), in.commissionBps(), null, in.reason().trim()));
        }
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
        Balance unsettled = jdbc.sql("select count(*), coalesce(sum(p.amount + pr.vibe_funded), 0), coalesce(sum(p.commission), 0), coalesce(sum(p.amount + pr.vibe_funded - pr.vibe_fee - p.gst - p.refund_merchant_share), 0)" + UNSETTLED
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
