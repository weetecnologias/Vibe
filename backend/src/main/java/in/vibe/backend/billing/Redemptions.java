package in.vibe.backend.billing;

import in.vibe.backend.audit.AuditService;
import in.vibe.backend.common.ApiException;
import in.vibe.backend.customer.Customers;
import in.vibe.backend.notify.StaffNotifications;
import in.vibe.backend.security.StaffPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Pay & Redeem. A customer taps Redeem and the redemption waits for the merchant. Staff find the customer, enter the bill, and the server
 * prices it from the offer's rule and sends it to the customer. The customer pays through the app. Nobody but the server decides a discount.
 */
@Service
public class Redemptions {
    static final long MAX_BILL = 100_000_000L; // ₹10,00,000

    // ---- what the customer app reads ----
    public record BillLine(String label, long amount) {}

    public record PaymentRequestView(String id, String billRef, String raisedBy, OffsetDateTime raisedAt, List<BillLine> lines, long eligibleAmount, long discount, String discountLabel,
                                     Long taxes, long vibeFee, long payable, String currency, Object appliedOffer, OffsetDateTime expiresAt) {}

    public record RedemptionView(String id, String offerId, String businessName, String branchName, String customerDisplayName, String vibeId, String status, OffsetDateTime expiresAt,
                                 PaymentRequestView paymentRequest) {}

    public record Eligibility(boolean eligible, String reason, Integer redemptionsLeftToday, OffsetDateTime memberValidUntil) {}

    // ---- what the merchant dashboard reads and sends ----
    public record Line(@NotBlank @Size(max = 80) String label, @NotNull @Min(1) @Max(MAX_BILL) Long amount) {}

    public record BillInput(@NotEmpty @Size(max = 30) List<@Valid Line> lines, @Size(max = 40) String billRef, Boolean confirmLarge) {}

    public record Preview(long eligibleAmount, long discount, String discountLabel, String reason, long vibeFee, long customerPays, boolean needsConfirmation) {}

    public record BillInfo(String billRef, long eligibleAmount, long discount, long payable, OffsetDateTime raisedAt, OffsetDateTime expiresAt, String raisedBy, String paymentStatus) {}

    public record Row(String id, String customerName, String vibeId, String offerTitle, String status, OffsetDateTime requestedAt, OffsetDateTime expiresAt, OffsetDateTime paidAt, BillInfo bill) {}

    public record Summary(int paidToday, long paidTodayAmount, long savedTodayAmount) {}

    public record Board(List<Row> rows, Summary summary) {}

    private final JdbcClient jdbc;
    private final AuditService audit;
    private final Notifications notifications;
    private final StaffNotifications staffNotifications;
    private final in.vibe.backend.catalogue.BillingRules billingRules;
    private final Clock clock;
    private final int redemptionMinutes, billMinutes;
    private final long largeBill, vibeFee;
    private final SecureRandom random = new SecureRandom();

    Redemptions(JdbcClient jdbc, AuditService audit, Notifications notifications, StaffNotifications staffNotifications, in.vibe.backend.catalogue.BillingRules billingRules, Clock clock, @Value("${vibe.billing.redemption-minutes}") int redemptionMinutes,
                @Value("${vibe.billing.bill-minutes}") int billMinutes, @Value("${vibe.billing.large-bill}") long largeBill, @Value("${vibe.billing.vibe-fee}") long vibeFee) {
        this.jdbc = jdbc;
        this.audit = audit;
        this.notifications = notifications;
        this.staffNotifications = staffNotifications;
        this.billingRules = billingRules;
        this.clock = clock;
        this.redemptionMinutes = redemptionMinutes;
        this.billMinutes = billMinutes;
        this.largeBill = largeBill;
        this.vibeFee = vibeFee;
    }

    private OffsetDateTime now() { return OffsetDateTime.now(clock); }

    private OffsetDateTime startOfToday() { return now().toLocalDate().atStartOfDay(clock.getZone()).toOffsetDateTime(); }

    // ---------- offers ----------
    private record OfferRow(UUID id, UUID businessId, String businessName, String businessArea, String title, String kind, Integer rateBps, Long flatAmount, Long maxDiscount, Long minBill, boolean memberOnly) {}

    private static OfferRow offerRow(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        Object bps = rs.getObject("rate_bps"), flat = rs.getObject("flat_amount"), max = rs.getObject("max_discount"), min = rs.getObject("min_bill");
        return new OfferRow((UUID) rs.getObject("id"), (UUID) rs.getObject("business_id"), rs.getString("bname"), rs.getString("barea"), rs.getString("title"), rs.getString("kind"),
                bps == null ? null : ((Number) bps).intValue(), flat == null ? null : ((Number) flat).longValue(), max == null ? null : ((Number) max).longValue(), min == null ? null : ((Number) min).longValue(), rs.getBoolean("member_only"));
    }

    /** An offer customers can redeem right now: approved, switched on, inside its dates, at a business that is live. */
    private OfferRow liveOffer(UUID id) {
        return jdbc.sql("select o.*, b.name bname, b.area barea from offers o join businesses b on b.id = o.business_id where o.id = :id and b.active and o.active and o.review_status = 'approved' "
                        + "and o.starts_at <= :now and o.ends_at > :now").param("id", id).param("now", now()).query(Redemptions::offerRow).optional()
                .orElseThrow(() -> ApiException.notFound("This offer has ended or was withdrawn."));
    }

    private OfferRow anyOffer(UUID id) {
        return jdbc.sql("select o.*, b.name bname, b.area barea from offers o join businesses b on b.id = o.business_id where o.id = :id").param("id", id).query(Redemptions::offerRow).optional()
                .orElseThrow(() -> ApiException.notFound("Offer not found."));
    }

    // ---------- eligibility ----------
    private OffsetDateTime memberUntil(UUID customer) {
        return jdbc.sql("select valid_until from memberships where customer_id = :c and valid_until > :now").param("c", customer).param("now", now()).query(OffsetDateTime.class).optional().orElse(null);
    }

    public Eligibility eligibility(UUID customer, UUID offerId) {
        OfferRow o = liveOffer(offerId);
        if (!billingRules.forBusiness(o.businessId()).payRedeem()) return new Eligibility(false, "Bills aren’t used at this place.", null, null);
        OffsetDateTime until = memberUntil(customer);
        if (o.memberOnly() && until == null) return new Eligibility(false, "This offer is for VIBE members.", null, null);
        int used = jdbc.sql("select count(*) from redemptions where customer_id = :c and offer_id = :o and status = 'paid' and paid_at >= :d").param("c", customer).param("o", offerId).param("d", startOfToday()).query(Integer.class).single();
        if (used >= 1) return new Eligibility(false, "You’ve already used this offer today.", 0, until);
        return new Eligibility(true, o.memberOnly() ? "Active VIBE member" : "Available to all VIBE users", 1 - used, until);
    }

    // ---------- customer: redeem ----------
    /** Starting again while a redemption for the same offer is still open returns that one, so a reload never creates a second. */
    @Transactional
    public RedemptionView create(UUID customer, UUID offerId) {
        OfferRow o = liveOffer(offerId);
        Eligibility e = eligibility(customer, offerId);
        if (!e.eligible()) {
            boolean member = o.memberOnly() && memberUntil(customer) == null;
            throw member ? new ApiException(HttpStatus.FORBIDDEN, "membership_required", e.reason()) : ApiException.conflict("limit_reached", e.reason());
        }
        var open = jdbc.sql("select id, status, expires_at from redemptions where customer_id = :c and offer_id = :o and status in ('awaiting_bill', 'bill_ready') for update").param("c", customer).param("o", offerId)
                .query((rs, i) -> new Object[]{rs.getObject(1), rs.getString(2), rs.getObject(3, OffsetDateTime.class)}).optional();
        if (open.isPresent()) {
            UUID id = (UUID) open.get()[0];
            if (effective((String) open.get()[1], (OffsetDateTime) open.get()[2], null).equals("expired")) {
                jdbc.sql("update redemptions set status = 'cancelled', updated_at = now() where id = :id").param("id", id).update();
            } else {
                return view(customer, id);
            }
        }
        UUID id = UUID.randomUUID();
        jdbc.sql("insert into redemptions (id, customer_id, offer_id, business_id, status, expires_at) values (:id, :c, :o, :b, 'awaiting_bill', :e)").param("id", id).param("c", customer).param("o", offerId)
                .param("b", o.businessId()).param("e", now().plusMinutes(redemptionMinutes)).update();
        String who = jdbc.sql("select name, vibe_id from customers where id = :id").param("id", customer).query((rs, i) -> Customers.displayName(rs.getString(1)) + " (VIBE ID " + rs.getString(2) + ")").single();
        staffNotifications.toBusiness(o.businessId(), "redeem_started", who + " wants to redeem", o.title() + ". Open Bills to raise their bill.", "/bills");
        return view(customer, id);
    }

    /** The status a person should see: an unbilled redemption, or an unpaid bill, past its time is expired. */
    private String effective(String status, OffsetDateTime redemptionExpires, OffsetDateTime billExpires) {
        if ("awaiting_bill".equals(status) && redemptionExpires.isBefore(now())) return "expired";
        if ("bill_ready".equals(status) && billExpires != null && billExpires.isBefore(now())) return "expired";
        return status;
    }

    public RedemptionView view(UUID customer, UUID id) {
        record R(String offerId, String bname, String barea, String cname, String vibeId, String status, OffsetDateTime expiresAt, UUID prId) {}
        R r = jdbc.sql("select r.offer_id, b.name bname, b.area barea, c.name cname, c.vibe_id, r.status, r.expires_at, r.payment_request_id from redemptions r join businesses b on b.id = r.business_id join customers c on c.id = r.customer_id "
                        + "where r.id = :id and r.customer_id = :c").param("id", id).param("c", customer)
                .query((rs, i) -> new R(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5), rs.getString(6), rs.getObject(7, OffsetDateTime.class), (UUID) rs.getObject(8))).optional()
                .orElseThrow(() -> ApiException.notFound("Redemption not found."));
        PaymentRequestView pr = r.prId() == null ? null : paymentRequest(r.prId());
        String status = effective(r.status(), r.expiresAt(), pr == null ? null : pr.expiresAt());
        return new RedemptionView(id.toString(), r.offerId(), r.bname(), r.barea(), Customers.displayName(r.cname()), r.vibeId(), status, r.expiresAt(), "bill_ready".equals(r.status()) || "paid".equals(r.status()) ? pr : null);
    }

    /** Customer leaves. A bill the customer has already started paying can't be walked away from. */
    @Transactional
    public void cancel(UUID customer, UUID id) {
        record R(String status, UUID prId) {}
        R r = jdbc.sql("select status, payment_request_id from redemptions where id = :id and customer_id = :c for update").param("id", id).param("c", customer)
                .query((rs, i) -> new R(rs.getString(1), (UUID) rs.getObject(2))).optional().orElseThrow(() -> ApiException.notFound("Redemption not found."));
        if (!r.status().equals("awaiting_bill") && !r.status().equals("bill_ready")) return;
        if (r.prId() != null) {
            if (paymentStarted(r.prId())) throw ApiException.conflict("payment_started", "You’ve already started paying this bill.");
            jdbc.sql("update payment_requests set status = 'void' where id = :id and status = 'open'").param("id", r.prId()).update();
        }
        jdbc.sql("update redemptions set status = 'cancelled', updated_at = now() where id = :id").param("id", id).update();
        var info = jdbc.sql("select r.business_id, c.name from redemptions r join customers c on c.id = r.customer_id where r.id = :id").param("id", id).query((rs, i) -> new Object[]{rs.getObject(1), rs.getString(2)}).single();
        staffNotifications.toBusiness((UUID) info[0], "redeem_cancelled", Customers.displayName((String) info[1]) + " cancelled", "The customer left without a bill. They are off your Bills list.", "/bills");
    }

    // ---------- payment request view ----------
    public PaymentRequestView paymentRequest(UUID id) {
        List<BillLine> lines = jdbc.sql("select label, amount from payment_request_lines where payment_request_id = :id order by position").param("id", id).query((rs, i) -> new BillLine(rs.getString(1), rs.getLong(2))).list();
        return jdbc.sql("select * from payment_requests where id = :id").param("id", id).query((rs, i) -> {
            Object taxes = rs.getObject("taxes");
            return new PaymentRequestView(rs.getString("id"), rs.getString("bill_ref"), rs.getString("raised_by"), rs.getObject("raised_at", OffsetDateTime.class), lines, rs.getLong("eligible_amount"),
                    rs.getLong("discount"), rs.getString("discount_label"), taxes == null ? null : ((Number) taxes).longValue(), rs.getLong("vibe_fee"), rs.getLong("payable"), "INR", null, rs.getObject("expires_at", OffsetDateTime.class));
        }).optional().orElseThrow(() -> ApiException.notFound("This bill is no longer available."));
    }

    private boolean paymentStarted(UUID paymentRequestId) {
        return jdbc.sql("select count(*) from payments where payment_request_id = :id and status in ('pending', 'verified')").param("id", paymentRequestId).query(Integer.class).single() > 0;
    }

    // ---------- merchant: the bills screen ----------
    /** open: waiting for a bill or waiting to be paid. today: paid since midnight (India time). */
    public Board board(StaffPrincipal who, String view, String q) {
        UUID b = who.requireBusiness();
        OffsetDateTime n = now();
        boolean today = "today".equals(view);
        String where = today ? " and r.status = 'paid' and r.paid_at >= :since" : " and r.status in ('awaiting_bill', 'bill_ready')";
        Map<String, Object> p = new HashMap<>();
        p.put("b", b);
        if (today) p.put("since", startOfToday());
        if (!today && q != null && !q.isBlank()) {
            String term = q.trim();
            if (term.matches("\\d{1,6}")) { where += " and c.vibe_id like :q"; p.put("q", term + "%"); }
            else { where += " and lower(c.name) like :q escape '\\'"; p.put("q", term.toLowerCase().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"); }
        }
        JdbcClient.StatementSpec s = jdbc.sql("select r.id, c.name cname, c.vibe_id, o.title otitle, r.status, r.created_at, r.expires_at, r.paid_at, r.payment_request_id from redemptions r join customers c on c.id = r.customer_id "
                + "join offers o on o.id = r.offer_id where r.business_id = :b" + where + " order by " + (today ? "r.paid_at desc" : "r.created_at asc") + " limit 100");
        p.forEach(s::param);
        List<Row> rows = new ArrayList<>();
        s.query((rs, i) -> {
            UUID prId = (UUID) rs.getObject("payment_request_id");
            PaymentRequestView pr = prId == null ? null : paymentRequest(prId);
            String status = effective(rs.getString("status"), rs.getObject("expires_at", OffsetDateTime.class), pr == null ? null : pr.expiresAt());
            if (!today && "expired".equals(status)) return 0; // expired ones drop off the open list
            BillInfo bill = pr == null ? null : new BillInfo(pr.billRef(), pr.eligibleAmount(), pr.discount(), pr.payable(), pr.raisedAt(), pr.expiresAt(), pr.raisedBy(), paymentStatus(prId, rs.getString("status")));
            rows.add(new Row(rs.getString("id"), Customers.displayName(rs.getString("cname")), rs.getString("vibe_id"), rs.getString("otitle"), status, rs.getObject("created_at", OffsetDateTime.class), rs.getObject("expires_at", OffsetDateTime.class),
                    rs.getObject("paid_at", OffsetDateTime.class), bill));
            return 0;
        }).list();
        var sum = jdbc.sql("select count(*), coalesce(sum(p.amount), 0), coalesce(sum(p.savings), 0) from payments p join payment_requests pr on pr.id = p.payment_request_id where pr.business_id = :b and p.status = 'verified' and p.verified_at >= :since")
                .param("b", b).param("since", startOfToday()).query((rs, i) -> new Summary(rs.getInt(1), rs.getLong(2), rs.getLong(3))).single();
        return new Board(rows, sum);
    }

    private String paymentStatus(UUID prId, String redemptionStatus) {
        if ("paid".equals(redemptionStatus)) return "paid";
        return jdbc.sql("select status from payments where payment_request_id = :id order by created_at desc limit 1").param("id", prId).query(String.class).optional().map(s -> "failed".equals(s) ? "failed" : "pending").orElse("not_started");
    }

    // ---------- merchant: raise a bill ----------
    private record Locked(UUID id, UUID customerId, UUID offerId, String status, OffsetDateTime expiresAt, UUID prId, String customerName) {}

    private Locked lock(UUID business, UUID id) {
        return jdbc.sql("select r.id, r.customer_id, r.offer_id, r.status, r.expires_at, r.payment_request_id, c.name from redemptions r join customers c on c.id = r.customer_id where r.id = :id and r.business_id = :b for update of r")
                .param("id", id).param("b", business).query((rs, i) -> new Locked((UUID) rs.getObject(1), (UUID) rs.getObject(2), (UUID) rs.getObject(3), rs.getString(4), rs.getObject(5, OffsetDateTime.class), (UUID) rs.getObject(6), rs.getString(7)))
                .optional().orElseThrow(() -> ApiException.notFound("That customer isn’t waiting at your place."));
    }

    private long total(BillInput in) {
        long sum = 0;
        for (Line l : in.lines()) sum += l.amount();
        if (sum > MAX_BILL) throw ApiException.badRequest("bill_too_large", "That bill is over ₹10,00,000. Check the amounts.");
        return sum;
    }

    private Preview quote(OfferRow o, long eligible, BillInput in) {
        Pricing.Quote q = Pricing.quote(o.kind(), o.rateBps(), o.flatAmount(), o.maxDiscount(), o.minBill(), eligible);
        return new Preview(eligible, q.discount(), q.discount() > 0 ? o.title() : o.title() + " — " + q.reason(), q.reason(), vibeFee, eligible - q.discount() + vibeFee, eligible >= largeBill);
    }

    /** What the customer would pay, without sending anything. Lets staff check the amount before they send it. */
    public Preview preview(StaffPrincipal who, UUID id, BillInput in) {
        Locked r = lock(who.requireBusiness(), id);
        if (!r.status().equals("awaiting_bill")) throw stateError(r);
        return quote(anyOffer(r.offerId()), total(in), in);
    }

    @Transactional
    public Row raise(StaffPrincipal who, UUID id, BillInput in) {
        UUID business = who.requireBusiness();
        Locked r = lock(business, id);
        if (!r.status().equals("awaiting_bill")) throw stateError(r);
        if (r.expiresAt().isBefore(now())) throw new ApiException(HttpStatus.GONE, "expired", "This customer’s request has expired. Ask them to tap Redeem again.");
        long eligible = total(in);
        Preview p = quote(anyOffer(r.offerId()), eligible, in);
        if (p.needsConfirmation() && !Boolean.TRUE.equals(in.confirmLarge())) throw ApiException.conflict("confirm_large", "This bill is ₹" + (eligible / 100) + ". Check the amount and confirm to send it.");
        String raisedBy = jdbc.sql("select name from staff_users where id = :id").param("id", who.id()).query(String.class).optional().orElse("Staff");
        String ref = in.billRef() == null || in.billRef().isBlank() ? "BILL-" + code(6) : in.billRef().trim();
        UUID pr = UUID.randomUUID();
        jdbc.sql("insert into payment_requests (id, kind, redemption_id, business_id, customer_id, bill_ref, raised_by, eligible_amount, discount, discount_label, vibe_fee, payable, expires_at) "
                        + "values (:id, 'redemption', :r, :b, :c, :ref, :by, :e, :d, :dl, :f, :p, :x)").param("id", pr).param("r", id).param("b", business).param("c", r.customerId()).param("ref", ref).param("by", raisedBy)
                .param("e", eligible).param("d", p.discount()).param("dl", p.discountLabel()).param("f", p.vibeFee()).param("p", p.customerPays()).param("x", now().plusMinutes(billMinutes)).update();
        int n = 0;
        for (Line l : in.lines()) jdbc.sql("insert into payment_request_lines (payment_request_id, position, label, amount) values (:p, :n, :l, :a)").param("p", pr).param("n", n++).param("l", l.label().trim()).param("a", l.amount()).update();
        jdbc.sql("update redemptions set status = 'bill_ready', payment_request_id = :p, updated_at = now() where id = :id").param("p", pr).param("id", id).update();
        audit.record(who, "raise_bill", "redemption", id, "₹" + eligible / 100 + " for " + Customers.displayName(r.customerName()));
        String biz = jdbc.sql("select name from businesses where id = :id").param("id", business).query(String.class).single();
        notifications.notify(r.customerId(), "bill_ready", "Your bill from " + biz + " is ready", "Pay ₹" + rupees(p.customerPays()) + (p.discount() > 0 ? " and save ₹" + rupees(p.discount()) : ""), "redemption", id.toString());
        return board(who, "open", null).rows().stream().filter(x -> x.id().equals(id.toString())).findFirst().orElseThrow();
    }

    /** Withdraw a bill that has the wrong amount, as long as the customer hasn't started paying. The customer's request stays open for a corrected bill. */
    @Transactional
    public Row cancelBill(StaffPrincipal who, UUID id) {
        UUID business = who.requireBusiness();
        Locked r = lock(business, id);
        if (!r.status().equals("bill_ready") || r.prId() == null) throw ApiException.conflict("no_bill", "There is no unpaid bill to withdraw.");
        if (paymentStarted(r.prId())) throw ApiException.conflict("payment_started", "The customer has already started paying, so the bill can’t be withdrawn.");
        jdbc.sql("update payment_requests set status = 'void' where id = :id").param("id", r.prId()).update();
        jdbc.sql("update redemptions set status = 'awaiting_bill', payment_request_id = null, expires_at = :e, updated_at = now() where id = :id").param("e", now().plusMinutes(redemptionMinutes)).param("id", id).update();
        audit.record(who, "withdraw_bill", "redemption", id, Customers.displayName(r.customerName()));
        notifications.notify(r.customerId(), "bill_withdrawn", "Your bill was withdrawn", "The staff are correcting it. A new bill is on its way.", "redemption", id.toString());
        return board(who, "open", null).rows().stream().filter(x -> x.id().equals(id.toString())).findFirst().orElseThrow();
    }

    private ApiException stateError(Locked r) {
        return switch (r.status()) {
            case "bill_ready" -> ApiException.conflict("already_billed", "A bill has already been sent. Withdraw it first to send a new one.");
            case "paid" -> ApiException.conflict("paid", "This one has already been paid.");
            default -> ApiException.conflict("cancelled", "The customer cancelled this request.");
        };
    }

    private String code(int n) {
        String alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) sb.append(alphabet.charAt(random.nextInt(alphabet.length())));
        return sb.toString();
    }

    static String rupees(long paise) { return paise % 100 == 0 ? String.valueOf(paise / 100) : String.format("%d.%02d", paise / 100, paise % 100); }
}
