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

    private record Pr(UUID id, String kind, String status, long eligible, OffsetDateTime expiresAt, UUID couponId) {}

    private final JdbcClient jdbc;
    private final Payments payments;
    private final Clock clock;

    CheckoutOffers(JdbcClient jdbc, Payments payments, Clock clock) {
        this.jdbc = jdbc;
        this.payments = payments;
        this.clock = clock;
    }

    private Pr pr(UUID customer, UUID id, boolean lock) {
        return jdbc.sql("select id, kind, status, eligible_amount, expires_at, coupon_id from payment_requests where id = :id and customer_id = :c" + (lock ? " for update" : "")).param("id", id).param("c", customer)
                .query((rs, i) -> new Pr((UUID) rs.getObject(1), rs.getString(2), rs.getString(3), rs.getLong(4), rs.getObject(5, OffsetDateTime.class), (UUID) rs.getObject(6))).optional()
                .orElseThrow(() -> ApiException.notFound("This bill is no longer available."));
    }

    private List<Coupon> live() {
        OffsetDateTime now = OffsetDateTime.now(clock);
        return jdbc.sql("select * from checkout_coupons where active and 'tickets' = any(kinds) and starts_at <= :n and ends_at > :n order by member_only, created_at").param("n", now)
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
    private String reason(UUID customer, Coupon c, long amount) {
        if (c.minBill() != null && amount < c.minBill()) return "For orders of ₹" + c.minBill() / 100 + " or more.";
        if (c.memberOnly() && jdbc.sql("select count(*) from memberships where customer_id = :c and status = 'active' and valid_until > :n").param("c", customer).param("n", OffsetDateTime.now(clock)).query(Integer.class).single() == 0) {
            return "For VIBE members.";
        }
        if (c.firstOnly() && jdbc.sql("select count(*) from payments p join payment_requests pr on pr.id = p.payment_request_id where p.customer_id = :c and p.status = 'verified' and pr.kind = 'tickets'")
                .param("c", customer).query(Integer.class).single() > 0) return "For your first booking only.";
        if (c.maxUses() != null && jdbc.sql("select count(*) from payments p join payment_requests pr on pr.id = p.payment_request_id where p.customer_id = :c and p.status = 'verified' and pr.coupon_id = :k")
                .param("c", customer).param("k", c.id()).query(Integer.class).single() >= c.maxUses()) return "You’ve already used this the most times allowed.";
        if (saving(c, amount) == 0) return "This order is too small for this offer.";
        return null;
    }

    public Offers offers(UUID customer, UUID prId) {
        Pr pr = pr(customer, prId, false);
        if (!"tickets".equals(pr.kind())) return new Offers(null, List.of());
        AppliedOffer applied = pr.couponId() == null ? null : jdbc.sql("select id, code, title, member_only from checkout_coupons where id = :id").param("id", pr.couponId())
                .query((rs, i) -> new AppliedOffer(rs.getString(1), rs.getString(2), rs.getString(3), rs.getBoolean(4))).optional().orElse(null);
        List<Offer> list = live().stream().map(c -> {
            String why = reason(customer, c, pr.eligible());
            return new Offer(c.id().toString(), c.code(), c.title(), c.description(), c.memberOnly(), why == null, why, why == null ? saving(c, pr.eligible()) : 0, c.terms());
        }).toList();
        return new Offers(applied, list);
    }

    @Transactional
    public Payments.CheckoutRequest apply(UUID customer, UUID prId, String codeOrId) {
        Pr pr = editable(customer, prId);
        String key = codeOrId.trim();
        Coupon c = live().stream().filter(x -> x.id().toString().equals(key) || x.code().equals(key.toUpperCase(Locale.ROOT))).findFirst()
                .orElseThrow(() -> ApiException.conflict("unknown_code", "That code isn’t valid right now."));
        String why = reason(customer, c, pr.eligible());
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
        if (!"tickets".equals(pr.kind())) throw ApiException.conflict("not_applicable", "Offers at checkout are for tickets. Pay & Redeem offers are chosen before the bill.");
        if (!"open".equals(pr.status())) throw ApiException.conflict("not_open", "This order can’t be changed any more.");
        if (pr.expiresAt().isBefore(OffsetDateTime.now(clock))) throw new ApiException(HttpStatus.GONE, "expired", "Your tickets were released. Choose them again.");
        if (jdbc.sql("select count(*) from payments where payment_request_id = :id and status in ('pending', 'verified')").param("id", prId).query(Integer.class).single() > 0) {
            throw ApiException.conflict("payment_started", "Payment has already started, so the offer can’t be changed.");
        }
        return pr;
    }
}
