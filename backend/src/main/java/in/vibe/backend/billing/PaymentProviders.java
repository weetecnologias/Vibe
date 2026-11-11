package in.vibe.backend.billing;

import in.vibe.backend.common.ApiException;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.UUID;

/**
 * The payment partner. One implementation per aggregator (it must be RBI-authorised and support splitting money between VIBE and merchants);
 * none is chosen yet. The rest of the system talks only to this interface, so adding the real one changes nothing else.
 */
public final class PaymentProviders {
    private PaymentProviders() {}

    public record Order(String orderId, Map<String, Object> checkout) {}

    public interface PaymentProvider {
        /** Short name stored with each payment and used in the webhook address. */
        String name();

        /** Creates the order at the partner. The returned `checkout` goes to the app so it can open the partner's payment sheet. */
        Order createOrder(String reference, long amountPaise, String method);

        /** True only for the development stand-in, which confirms payments by itself after a moment. */
        default boolean simulated() { return false; }
    }

    /** DEVELOPMENT ONLY: no money moves. The payment confirms itself a moment after it starts, through the same path a real webhook uses. */
    @Component
    @Profile("dev")
    static class Simulated implements PaymentProvider {
        @Override public String name() { return "simulated"; }
        @Override public Order createOrder(String reference, long amountPaise, String method) { return new Order("sim_" + UUID.randomUUID().toString().replace("-", ""), Map.of("mode", "demo")); }
        @Override public boolean simulated() { return true; }
    }

    /** Refuses to take payments until a real partner is connected, rather than pretending. */
    @Component
    @Profile("!dev")
    static class NotConnected implements PaymentProvider {
        @Override public String name() { return "none"; }
        @Override public Order createOrder(String reference, long amountPaise, String method) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "payments_not_configured", "Online payment isn’t connected yet. No money has been taken.");
        }
    }
}
