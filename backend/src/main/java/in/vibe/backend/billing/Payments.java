package in.vibe.backend.billing;

import in.vibe.backend.billing.PaymentProviders.PaymentProvider;
import in.vibe.backend.common.ApiException;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Taking a payment. The rule that matters most: **a payment counts only when the payment partner says so**, through a signed webhook
 * (or, in development, the simulated partner going through the same code). The app never marks anything paid, and the side effects of a
 * payment (the redemption becomes paid, the savings are recorded, the customer is told) happen exactly once even if the partner repeats itself.
 */
@Service
public class Payments {
    private static final Logger log = LoggerFactory.getLogger(Payments.class);
    private static final String ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    public record StartInput(@NotBlank @Pattern(regexp = "upi|card|netbanking") String method) {}

    public record Start(String reference, Map<String, Object> checkout) {}

    /** The bill plus who it is for, as the checkout screen reads it. */
    public record CheckoutRequest(String id, String billRef, String raisedBy, OffsetDateTime raisedAt, List<Redemptions.BillLine> lines, long eligibleAmount, long discount, String discountLabel,
                                  Long taxes, long vibeFee, long payable, String currency, Object appliedOffer, OffsetDateTime expiresAt, String payeeName, String kind) {}

    public record PaymentView(String reference, String kind, String status, String method, long amount, long savings, String payeeName, String providerPaymentId, OffsetDateTime verifiedAt,
                              String failureReason, List<Redemptions.BillLine> lines, List<String> ticketIds, String offerTitle) {}

    private final JdbcClient jdbc;
    private final Redemptions redemptions;
    private final Notifications notifications;
    private final PaymentProvider provider;
    private final JsonMapper json;
    private final Clock clock;
    private final String webhookSecret;
    private final long simulateAfterMs;
    private final SecureRandom random = new SecureRandom();

    Payments(JdbcClient jdbc, Redemptions redemptions, Notifications notifications, PaymentProvider provider, JsonMapper json, Clock clock,
             @Value("${vibe.payments.webhook-secret:}") String webhookSecret, @Value("${vibe.payments.simulate-after-ms:0}") long simulateAfterMs) {
        this.jdbc = jdbc;
        this.redemptions = redemptions;
        this.notifications = notifications;
        this.provider = provider;
        this.json = json;
        this.clock = clock;
        this.webhookSecret = webhookSecret;
        this.simulateAfterMs = simulateAfterMs;
    }

    private OffsetDateTime now() { return OffsetDateTime.now(clock); }

    // ---------- the bill, as the checkout screen reads it ----------
    public CheckoutRequest paymentRequest(UUID customer, UUID id) {
        var owner = jdbc.sql("select p.status, b.name from payment_requests p join businesses b on b.id = p.business_id where p.id = :id and p.customer_id = :c").param("id", id).param("c", customer)
                .query((rs, i) -> new String[]{rs.getString(1), rs.getString(2)}).optional().orElseThrow(() -> ApiException.notFound("This bill is no longer available."));
        if ("void".equals(owner[0])) throw ApiException.notFound("This bill was withdrawn.");
        Redemptions.PaymentRequestView v = redemptions.paymentRequest(id);
        return new CheckoutRequest(v.id(), v.billRef(), v.raisedBy(), v.raisedAt(), v.lines(), v.eligibleAmount(), v.discount(), v.discountLabel(), v.taxes(), v.vibeFee(), v.payable(), v.currency(), v.appliedOffer(), v.expiresAt(), owner[1], "redemption");
    }

    // ---------- start paying ----------
    /**
     * The same Idempotency-Key always returns the same payment, so a double tap or a retry never creates two. Only one payment can be in flight
     * or settled for a bill (the database enforces it), and a bill past its time can't be paid.
     */
    @Transactional
    public Start start(UUID customer, UUID requestId, String method, String idempotencyKey) {
        if (idempotencyKey == null || idempotencyKey.trim().length() < 8 || idempotencyKey.length() > 100) throw ApiException.badRequest("idempotency_key", "A payment needs an Idempotency-Key header.");
        var prior = jdbc.sql("select reference, customer_id, payment_request_id, provider_order_id from payments where idempotency_key = :k").param("k", idempotencyKey)
                .query((rs, i) -> new Object[]{rs.getString(1), rs.getObject(2), rs.getObject(3), rs.getString(4)}).optional();
        if (prior.isPresent()) {
            if (!customer.equals(prior.get()[1]) || !requestId.equals(prior.get()[2])) throw ApiException.conflict("key_reuse", "That payment key was already used for something else.");
            return new Start((String) prior.get()[0], provider.simulated() ? Map.of("mode", "demo") : Map.of("mode", "provider", "provider", provider.name(), "orderId", prior.get()[3], "publicKey", ""));
        }
        record Pr(String status, OffsetDateTime expiresAt, long payable, long discount, UUID redemption) {}
        Pr pr = jdbc.sql("select status, expires_at, payable, discount, redemption_id from payment_requests where id = :id and customer_id = :c for update").param("id", requestId).param("c", customer)
                .query((rs, i) -> new Pr(rs.getString(1), rs.getObject(2, OffsetDateTime.class), rs.getLong(3), rs.getLong(4), (UUID) rs.getObject(5))).optional().orElseThrow(() -> ApiException.notFound("This bill is no longer available."));
        if (pr.status().equals("void")) throw ApiException.notFound("This bill was withdrawn.");
        if (pr.status().equals("paid")) throw ApiException.conflict("already_paid", "This bill is already paid.");
        if (pr.expiresAt().isBefore(now())) throw new ApiException(HttpStatus.GONE, "expired", "This bill has expired. Ask the staff to send it again.");
        String reference = "VB-" + code(4) + "-" + code(4);
        PaymentProviders.Order order = provider.createOrder(reference, pr.payable(), method); // refuses when no partner is connected
        try {
            jdbc.sql("insert into payments (id, reference, payment_request_id, customer_id, method, amount, savings, provider, provider_order_id, idempotency_key) values (:id, :r, :pr, :c, :m, :a, :s, :p, :o, :k)")
                    .param("id", UUID.randomUUID()).param("r", reference).param("pr", requestId).param("c", customer).param("m", method).param("a", pr.payable()).param("s", pr.discount())
                    .param("p", provider.name()).param("o", order.orderId()).param("k", idempotencyKey).update();
        } catch (DuplicateKeyException e) {
            throw ApiException.conflict("already_paid", "This bill is already being paid.");
        }
        return new Start(reference, order.checkout());
    }

    // ---------- reading a payment ----------
    @Transactional
    public PaymentView get(UUID customer, String reference) {
        var p = jdbc.sql("select id, status, created_at, provider from payments where reference = :r and customer_id = :c").param("r", reference).param("c", customer)
                .query((rs, i) -> new Object[]{rs.getObject(1), rs.getString(2), rs.getObject(3, OffsetDateTime.class), rs.getString(4)}).optional().orElseThrow(() -> ApiException.notFound("Payment not found."));
        // Development stand-in for the partner's webhook: confirms a payment a moment after it starts, through the same path.
        if (provider.simulated() && "pending".equals(p[1]) && provider.name().equals(p[3]) && ((OffsetDateTime) p[2]).plusNanos(simulateAfterMs * 1_000_000).isBefore(now())) {
            applyVerified((UUID) p[0], "pay_sim_" + code(10));
        }
        return jdbc.sql("select p.*, b.name bname, pr.discount_label, pr.id prid from payments p join payment_requests pr on pr.id = p.payment_request_id join businesses b on b.id = pr.business_id where p.reference = :r").param("r", reference)
                .query((rs, i) -> new PaymentView(rs.getString("reference"), "redemption", rs.getString("status"), rs.getString("method"), rs.getLong("amount"), rs.getLong("savings"), rs.getString("bname"), rs.getString("provider_payment_id"),
                        rs.getObject("verified_at", OffsetDateTime.class), rs.getString("failure_reason"), redemptions.paymentRequest((UUID) rs.getObject("prid")).lines(), List.of(), rs.getLong("savings") > 0 ? rs.getString("discount_label") : null)).single();
    }

    // ---------- the payment partner says it is paid ----------
    /**
     * Marks a pending payment verified and applies its effects, once. A second call for the same payment does nothing, so repeated webhooks are harmless.
     * Returns whether this call was the one that applied it.
     */
    @Transactional
    public boolean applyVerified(UUID paymentId, String providerPaymentId) {
        int n = jdbc.sql("update payments set status = 'verified', verified_at = now(), provider_payment_id = :pp where id = :id and status = 'pending'").param("id", paymentId).param("pp", providerPaymentId).update();
        if (n == 0) return false;
        record P(UUID pr, UUID customer, long amount, long savings) {}
        P p = jdbc.sql("select payment_request_id, customer_id, amount, savings from payments where id = :id").param("id", paymentId)
                .query((rs, i) -> new P((UUID) rs.getObject(1), (UUID) rs.getObject(2), rs.getLong(3), rs.getLong(4))).single();
        var pr = jdbc.sql("select redemption_id, business_id from payment_requests where id = :id").param("id", p.pr()).query((rs, i) -> new UUID[]{(UUID) rs.getObject(1), (UUID) rs.getObject(2)}).single();
        jdbc.sql("update payment_requests set status = 'paid' where id = :id").param("id", p.pr()).update();
        if (pr[0] != null) jdbc.sql("update redemptions set status = 'paid', paid_at = now(), updated_at = now() where id = :id").param("id", pr[0]).update();
        if (p.savings() > 0) {
            jdbc.sql("insert into savings_events (id, customer_id, business_id, payment_id, paid, saved) values (:id, :c, :b, :p, :paid, :s)").param("id", UUID.randomUUID()).param("c", p.customer()).param("b", pr[1])
                    .param("p", paymentId).param("paid", p.amount()).param("s", p.savings()).update();
        }
        String biz = jdbc.sql("select name from businesses where id = :id").param("id", pr[1]).query(String.class).single();
        notifications.notify(p.customer(), "payment_verified", "Payment received", "₹" + Redemptions.rupees(p.amount()) + " paid to " + biz + (p.savings() > 0 ? ". You saved ₹" + Redemptions.rupees(p.savings()) + "." : "."), "payment", paymentId.toString());
        return true;
    }

    @Transactional
    public void markFailed(UUID paymentId, String reason) {
        jdbc.sql("update payments set status = 'failed', failure_reason = :r where id = :id and status = 'pending'").param("id", paymentId).param("r", reason == null || reason.isBlank() ? "The payment didn’t go through." : reason).update();
    }

    // ---------- webhook ----------
    /** `sha256=<hex>` or plain hex of HMAC-SHA256(secret, raw body). Compared in constant time. */
    boolean signatureOk(String signature, String rawBody) {
        if (webhookSecret.isBlank() || signature == null) return false;
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(webhookSecret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            String expected = HexFormat.of().formatHex(mac.doFinal(rawBody.getBytes(StandardCharsets.UTF_8)));
            String given = signature.startsWith("sha256=") ? signature.substring(7) : signature;
            return MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8), given.trim().toLowerCase().getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * The partner's signed message that a payment succeeded or failed. The body is checked against the signature before anything else,
     * every event is kept (and repeats are ignored), and the amount must match what we asked for.
     */
    @Transactional
    public String webhook(String providerName, String signature, String rawBody) {
        if (webhookSecret.isBlank()) throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "webhooks_not_configured", "Payment notifications aren’t set up yet.");
        if (!signatureOk(signature, rawBody)) {
            log.warn("Webhook for {} refused: bad signature", providerName);
            throw new ApiException(HttpStatus.UNAUTHORIZED, "bad_signature", "The signature doesn’t match.");
        }
        JsonNode body;
        try { body = json.readTree(rawBody); } catch (Exception e) { throw ApiException.badRequest("validation", "The notification couldn’t be read."); }
        String eventId = text(body, "eventId"), orderId = text(body, "providerOrderId"), status = text(body, "status");
        if (eventId == null || orderId == null || status == null) throw ApiException.badRequest("validation", "The notification is missing fields.");
        if (jdbc.sql("insert into provider_events (provider, event_id, payload) values (:p, :e, :b) on conflict (provider, event_id) do nothing").param("p", providerName).param("e", eventId).param("b", rawBody).update() == 0) return "duplicate";
        var pay = jdbc.sql("select id, amount from payments where provider = :p and provider_order_id = :o").param("p", providerName).param("o", orderId)
                .query((rs, i) -> new Object[]{rs.getObject(1), rs.getLong(2)}).optional().orElseThrow(() -> ApiException.notFound("No payment for that order."));
        JsonNode amount = body.get("amount");
        if (amount != null && amount.isNumber() && amount.asLong() != (Long) pay[1]) throw ApiException.conflict("amount_mismatch", "The amount doesn’t match the payment.");
        if ("paid".equals(status)) return applyVerified((UUID) pay[0], text(body, "providerPaymentId") == null ? "pay_" + code(10) : text(body, "providerPaymentId")) ? "applied" : "already_applied";
        if ("failed".equals(status)) { markFailed((UUID) pay[0], text(body, "reason")); return "failed"; }
        throw ApiException.badRequest("validation", "Unknown payment status.");
    }

    private static String text(JsonNode n, String field) { JsonNode v = n.get(field); return v == null || v.isNull() ? null : v.asString(); }

    private String code(int n) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) sb.append(ALPHABET.charAt(random.nextInt(ALPHABET.length())));
        return sb.toString();
    }
}
