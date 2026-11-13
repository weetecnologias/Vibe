package in.vibe.backend.tickets;

import in.vibe.backend.billing.Payments;
import in.vibe.backend.common.ApiException;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * VIBE's checkout coupons on a ticket order. One coupon per order; the server works out the saving and reprices the bill. The discount is VIBE's
 * marketing, so it is recorded as VIBE-funded and the organiser is still settled the full price. A coupon can't be changed once payment has started.
 */
@Service
public class CheckoutOffers {
    public record AppliedOffer(String id, String code, String title, boolean memberOnly) {}

    public record Offer(String id, String code, String title, String description, boolean memberOnly, boolean eligible, String reason, long saving, List<String> terms) {}

    public record Offers(AppliedOffer applied, List<Offer> available) {}

    public record ApplyInput(@NotBlank @Size(max = 60) String code) {}

    private record Coupon(UUID id, String code, String title, String description, boolean memberOnly, String kind, Integer rateBps, Long flat, Long max, Long minBill, boolean firstOnly,
                          Integer maxUses, List<String> terms) {}

    private record Pr(UUID id, String kind, String status, long eligible, OffsetDateTime expiresAt, UUID couponId, UUID businessId, UUID redemptionId) {}

    private final JdbcClient jdbc;
    private final Payments payments;
    private final Clock clock;
    private final in.vibe.backend.billing.Redemptions redemptions;

    CheckoutOffers(JdbcClient jdbc, Payments payments, Clock clock, in.vibe.backend.billing.Redemptions redemptions) {
        this.redemptions = redemptions;
        this.jdbc = jdbc;
        this.payments = payments;
        this.clock = clock;
    }

    private Pr pr(UUID customer, UUID id, boolean lock) {
        return jdbc.sql("select id, kind, status, eligible_amount, expires_at, coupon_id, business_id, redemption_id from payment_requests where id = :id and customer_id = :c" + (lock ? " for update" : "")).param("id", id).param("c", customer)
                .query((rs, i) -> new Pr((UUID) rs.getObject(1), rs.getString(2), rs.getString(3), rs.getLong(4), rs.getObject(5, OffsetDateTime.class), (UUID) rs.getObject(6), (UUID) rs.getObject(7), (UUID) rs.getObject(8))).optional()
                .orElseThrow(() -> ApiException.notFound("This bill is no longer available."));
    }

    /** Order kinds that take VIBE coupons and member offers at checkout. */
    static final java.util.Set<String> KINDS = java.util.Set.of("tickets", "slots", "pass", "redemption");

    /** A bill at a restaurant, salon or shop is "redemption" as a payment and "bill" as a coupon kind. */
    private static String couponKind(String paymentKind) { return "redemption".equals(paymentKind) ? "bill" : paymentKind; }

    private List<Coupon> live(String kind) {
        OffsetDateTime now = OffsetDateTime.now(clock);
        return jdbc.sql("select * from checkout_coupons where active and :k = any(kinds) and starts_at <= :n and ends_at > :n order by member_only desc, created_at").param("n", now).param("k", kind)
                .query((rs, i) -> new Coupon((UUID) rs.getObject("id"), rs.getString("code"), rs.getString("title"), rs.getString("description"), rs.getBoolean("member_only"), rs.getString("kind"),
                        (Integer) rs.getObject("rate_bps"), (Long) rs.getObject("flat_amount"), (Long) rs.getObject("max_discount"), (Long) rs.getObject("min_bill"), rs.getBoolean("first_booking_only"),
                        (Integer) rs.getObject("max_uses_per_user"), Arrays.asList((String[]) rs.getArray("terms").getArray()))).list();
    }

    /** What it saves, never the whole bill: at least ₹1 is always paid, so every order goes through the payment partner. */
    static long saving(Coupon c, long amount) {
        long s = "percentage".equals(c.kind()) ? amount * c.rateBps() / 10000 : c.flat();
        if (c.max() != null) s = Math.min(s, c.max());
        return Math.max(0, Math.min(s, amount - 100));
    }

    /** Why this customer can't use it on this order, or null. */
    private String reason(UUID customer, Coupon c, long amount, String kind) {
        if (c.minBill() != null && amount < c.minBill()) return "For orders of ₹" + c.minBill() / 100 + " or more.";
        if (c.memberOnly() && jdbc.sql("select count(*) from memberships where customer_id = :c and status = 'active' and valid_until > :n").param("c", customer).param("n", OffsetDateTime.now(clock)).query(Integer.class).single() == 0) {
            return "For VIBE members.";
        }
        if (c.firstOnly() && jdbc.sql("select count(*) from payments p join payment_requests pr on pr.id = p.payment_request_id where p.customer_id = :c and p.status = 'verified' and pr.kind = :k")
                .param("c", customer).param("k", kind).query(Integer.class).single() > 0) return "For your first booking only.";
        if (c.maxUses() != null && jdbc.sql("select count(*) from payments p join payment_requests pr on pr.id = p.payment_request_id where p.customer_id = :c and p.status = 'verified' and pr.coupon_id = :k")
                .param("c", customer).param("k", c.id()).query(Integer.class).single() >= c.maxUses()) return "You’ve already used this the most times allowed.";
        if (saving(c, amount) == 0) return "This order is too small for this offer.";
        return null;
    }

    public Offers offers(UUID customer, UUID prId) {
        Pr pr = pr(customer, prId, false);
        if (!KINDS.contains(pr.kind())) return new Offers(null, List.of());
        AppliedOffer applied = pr.couponId() == null ? null : jdbc.sql("select id, code, title, member_only from checkout_coupons where id = :id").param("id", pr.couponId())
                .query((rs, i) -> new AppliedOffer(rs.getString(1), rs.getString(2), rs.getString(3), rs.getBoolean(4))).optional().orElse(null);
        List<Offer> list = new java.util.ArrayList<>(pr.redemptionId() == null ? List.of() : businessOffers(customer, pr));
        list.addAll(live(couponKind(pr.kind())).stream().map(c -> {
            String why = reason(customer, c, pr.eligible(), pr.kind());
            return new Offer(c.id().toString(), c.code(), c.title(), c.description(), c.memberOnly(), why == null, why, why == null ? saving(c, pr.eligible()) : 0, c.terms());
        }).toList());
        return new Offers(applied != null ? applied : businessApplied(pr), list);
    }

    // ---------- a business's own offers on its bill ----------
    private record BizOffer(UUID id, String title, String kind, Integer rateBps, Long flat, Long max, Long minBill, boolean memberOnly) {}

    private List<BizOffer> liveBusinessOffers(UUID business) {
        return jdbc.sql("select id, title, kind, rate_bps, flat_amount, max_discount, min_bill, member_only from offers where business_id = :b and active and review_status = 'approved' and starts_at <= :n and ends_at > :n order by member_only desc, created_at")
                .param("b", business).param("n", OffsetDateTime.now(clock)).query((rs, i) -> new BizOffer((UUID) rs.getObject(1), rs.getString(2), rs.getString(3), (Integer) rs.getObject(4), (Long) rs.getObject(5), (Long) rs.getObject(6), (Long) rs.getObject(7), rs.getBoolean(8))).list();
    }

    private static in.vibe.backend.billing.Pricing.Quote quoteOf(BizOffer o, long eligible) {
        return in.vibe.backend.billing.Pricing.quote(o.kind(), o.rateBps(), o.flat(), o.max(), o.minBill(), eligible);
    }

    /** The business's offers the customer could use on this bill, with what each would save. */
    private List<Offer> businessOffers(UUID customer, Pr pr) {
        List<Offer> out = new java.util.ArrayList<>();
        for (BizOffer o : liveBusinessOffers(pr.businessId())) {
            var e = redemptions.eligibility(customer, o.id());
            var q = quoteOf(o, pr.eligible());
            boolean ok = e.eligible() && q.discount() > 0;
            out.add(new Offer(o.id().toString(), "", o.title(), "Offer from this business", o.memberOnly(), ok, ok ? null : !e.eligible() ? e.reason() : q.reason(), ok ? q.discount() : 0, List.of()));
        }
        return out;
    }

    /** An offer of the business already on the bill (put there by the staff or chosen by the customer), shown as applied. */
    private AppliedOffer businessApplied(Pr pr) {
        if (pr.redemptionId() == null || pr.couponId() != null) return null;
        long discount = jdbc.sql("select discount from payment_requests where id = :id").param("id", pr.id()).query(Long.class).single();
        if (discount <= 0) return null;
        return jdbc.sql("select o.id, o.title, o.member_only from redemptions r join offers o on o.id = r.offer_id where r.id = :r").param("r", pr.redemptionId())
                .query((rs, i) -> new AppliedOffer(rs.getString(1), "", rs.getString(2), rs.getBoolean(3))).optional().orElse(null);
    }

    @Transactional
    public Payments.CheckoutRequest apply(UUID customer, UUID prId, String codeOrId) {
        Pr pr = editable(customer, prId);
        String key = codeOrId.trim();
        if (pr.redemptionId() != null) {
            BizOffer biz = liveBusinessOffers(pr.businessId()).stream().filter(o -> o.id().toString().equals(key)).findFirst().orElse(null);
            if (biz != null) {
                var e = redemptions.eligibility(customer, biz.id());
                if (!e.eligible()) throw ApiException.conflict("not_eligible", e.reason());
                var q = quoteOf(biz, pr.eligible());
                if (q.discount() <= 0) throw ApiException.conflict("not_eligible", q.reason() == null ? "This offer doesn’t apply to this bill." : q.reason());
                jdbc.sql("update payment_requests set coupon_id = null, discount = :s, vibe_funded = 0, discount_label = :l, payable = eligible_amount - :s + vibe_fee where id = :id").param("s", q.discount()).param("l", biz.title()).param("id", prId).update();
                try {
                    jdbc.sql("update redemptions set offer_id = :o, updated_at = now() where id = :r").param("o", biz.id()).param("r", pr.redemptionId()).update();
                } catch (org.springframework.dao.DuplicateKeyException clash) {
                    throw ApiException.conflict("offer_in_use", "You already have another open bill with that offer.");
                }
                return payments.paymentRequest(customer, prId);
            }
        }
        Coupon c = live(couponKind(pr.kind())).stream().filter(x -> x.id().toString().equals(key) || x.code().equals(key.toUpperCase(Locale.ROOT))).findFirst()
                .orElseThrow(() -> ApiException.conflict("unknown_code", "That code isn’t valid right now."));
        String why = reason(customer, c, pr.eligible(), pr.kind());
        if (why != null) throw ApiException.conflict("not_eligible", why);
        long s = saving(c, pr.eligible());
        jdbc.sql("update payment_requests set coupon_id = :k, discount = :s, vibe_funded = :s, discount_label = :l, payable = eligible_amount - :s + vibe_fee where id = :id")
                .param("k", c.id()).param("s", s).param("l", c.title()).param("id", prId).update();
        return payments.paymentRequest(customer, prId);
    }

    @Transactional
    public Payments.CheckoutRequest remove(UUID customer, UUID prId) {
        editable(customer, prId);
        jdbc.sql("update payment_requests set coupon_id = null, discount = 0, vibe_funded = 0, discount_label = '', payable = eligible_amount + vibe_fee where id = :id").param("id", prId).update();
        return payments.paymentRequest(customer, prId);
    }

    private Pr editable(UUID customer, UUID prId) {
        Pr pr = pr(customer, prId, true);
        if (!KINDS.contains(pr.kind())) throw ApiException.conflict("not_applicable", "Offers at checkout are for bills, tickets, bookings and memberships.");
        if (!"open".equals(pr.status())) throw ApiException.conflict("not_open", "This order can’t be changed any more.");
        if (pr.expiresAt().isBefore(OffsetDateTime.now(clock))) throw new ApiException(HttpStatus.GONE, "expired", "Your hold was released. Choose again.");
        if (jdbc.sql("select count(*) from payments where payment_request_id = :id and status in ('pending', 'verified')").param("id", prId).query(Integer.class).single() > 0) {
            throw ApiException.conflict("payment_started", "Payment has already started, so the offer can’t be changed.");
        }
        return pr;
    }
}
