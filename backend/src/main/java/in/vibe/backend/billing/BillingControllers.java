package in.vibe.backend.billing;

import in.vibe.backend.catalogue.Businesses;
import in.vibe.backend.common.ApiException;
import in.vibe.backend.customer.CustomerPrincipal;
import in.vibe.backend.customer.Customers;
import in.vibe.backend.security.StaffPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Customer sign-in, Pay & Redeem, payments and the merchant's bills screen. Thin on purpose: the rules live in the services. */
public class BillingControllers {

    static UUID uuid(String raw) {
        try { return UUID.fromString(raw); } catch (IllegalArgumentException e) { throw ApiException.notFound("Not found."); }
    }

    public record OtpVerify(@NotBlank String requestId, @NotBlank String code) {}

    public record Refresh(@NotBlank String refreshToken) {}

    /** mode: "bill" (get the bill in the app, pay through VIBE) or "code" (show a code, pay the place). Bill when left out. */
    public record Redeem(@NotBlank String offerId, String mode) {}

    // ---------- sign-in ----------
    @RestController
    @RequestMapping("/v1/auth")
    public static class AuthApi {
        private final Customers customers;

        AuthApi(Customers customers) { this.customers = customers; }

        @PostMapping("/otp")
        Customers.OtpChallenge otp(@Valid @RequestBody Customers.PhoneInput in) { return customers.requestOtp(in.phone()); }

        @PostMapping("/otp/verify")
        Customers.AuthResult verify(@Valid @RequestBody OtpVerify in) { return customers.verifyOtp(in.requestId(), in.code()); }

        @PostMapping("/refresh")
        Customers.AuthResult refresh(@Valid @RequestBody Refresh in) { return customers.refresh(in.refreshToken()); }

        @PostMapping("/logout")
        ResponseEntity<Void> logout(@AuthenticationPrincipal Jwt jwt) {
            customers.logout(CustomerPrincipal.from(jwt));
            return ResponseEntity.noContent().build();
        }
    }

    // ---------- the customer's own account ----------
    @RestController
    @RequestMapping("/v1/me")
    public static class MeApi {
        private final Customers customers;
        private final Notifications notifications;

        MeApi(Customers customers, Notifications notifications) {
            this.customers = customers;
            this.notifications = notifications;
        }

        @GetMapping
        Customers.User me(@AuthenticationPrincipal Jwt jwt) { return customers.me(CustomerPrincipal.from(jwt).id()); }

        @PatchMapping
        Customers.User update(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody Customers.ProfilePatch in) { return customers.update(CustomerPrincipal.from(jwt), in); }

        @PostMapping("/deletion-request")
        ResponseEntity<Void> deletion(@AuthenticationPrincipal Jwt jwt) {
            customers.requestDeletion(CustomerPrincipal.from(jwt));
            return ResponseEntity.noContent().build();
        }

        @GetMapping("/notifications")
        List<Notifications.Item> notifications(@AuthenticationPrincipal Jwt jwt, @RequestParam(defaultValue = "false") boolean unread) { return notifications.list(CustomerPrincipal.from(jwt).id(), unread); }

        @PostMapping("/notifications/read")
        ResponseEntity<Void> readAll(@AuthenticationPrincipal Jwt jwt) {
            notifications.markAllRead(CustomerPrincipal.from(jwt).id());
            return ResponseEntity.noContent().build();
        }

        @PostMapping("/notifications/{id}/read")
        ResponseEntity<Void> read(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) {
            notifications.markRead(CustomerPrincipal.from(jwt).id(), uuid(id));
            return ResponseEntity.noContent().build();
        }

        /** Registers the phone for push notifications. Push itself needs Firebase and Apple push accounts, not connected yet. */
        @PutMapping("/devices")
        ResponseEntity<Void> device(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody Notifications.DeviceInput in) {
            notifications.registerDevice(CustomerPrincipal.from(jwt).id(), in);
            return ResponseEntity.noContent().build();
        }
    }

    // ---------- Pay & Redeem, customer side ----------
    @RestController
    public static class CustomerBillingApi {
        private final Businesses businesses;
        private final Redemptions redemptions;
        private final Payments payments;

        CustomerBillingApi(Businesses businesses, Redemptions redemptions, Payments payments) {
            this.businesses = businesses;
            this.redemptions = redemptions;
            this.payments = payments;
        }

        @GetMapping("/v1/offers/{id}")
        Businesses.OfferDetail offer(@PathVariable String id) { return businesses.offerDetail(uuid(id)); }

        @GetMapping("/v1/offers/{id}/eligibility")
        Redemptions.Eligibility eligibility(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) { return redemptions.eligibility(CustomerPrincipal.from(jwt).id(), uuid(id)); }

        @PostMapping("/v1/redemptions")
        ResponseEntity<Redemptions.RedemptionView> redeem(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody Redeem in) {
            return ResponseEntity.status(HttpStatus.CREATED).body(redemptions.create(CustomerPrincipal.from(jwt).id(), uuid(in.offerId()), in.mode()));
        }

        @GetMapping("/v1/redemptions/{id}")
        Redemptions.RedemptionView redemption(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) { return redemptions.view(CustomerPrincipal.from(jwt).id(), uuid(id)); }

        @PostMapping("/v1/redemptions/{id}/cancel")
        ResponseEntity<Void> cancel(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) {
            redemptions.cancel(CustomerPrincipal.from(jwt).id(), uuid(id));
            return ResponseEntity.noContent().build();
        }

        @GetMapping("/v1/payment-requests/{id}")
        Payments.CheckoutRequest paymentRequest(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) { return payments.paymentRequest(CustomerPrincipal.from(jwt).id(), uuid(id)); }

        @PostMapping("/v1/payment-requests/{id}/payments")
        ResponseEntity<Payments.Start> pay(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @RequestHeader(value = "Idempotency-Key", required = false) String key, @Valid @RequestBody Payments.StartInput in) {
            return ResponseEntity.status(HttpStatus.CREATED).body(payments.start(CustomerPrincipal.from(jwt).id(), uuid(id), in.method(), key));
        }

        @GetMapping("/v1/payments/{reference}")
        Payments.PaymentView payment(@AuthenticationPrincipal Jwt jwt, @PathVariable String reference) { return payments.get(CustomerPrincipal.from(jwt).id(), reference); }
    }

    // ---------- the payment partner's webhook ----------
    @RestController
    public static class WebhookApi {
        private final Payments payments;

        WebhookApi(Payments payments) { this.payments = payments; }

        /** Signed by the partner (`X-Vibe-Signature`: HMAC-SHA256 of the raw body). Read as raw text so the signature is checked on exactly what was sent. */
        @PostMapping("/v1/webhooks/{provider}")
        Map<String, String> webhook(@PathVariable String provider, @RequestHeader(value = "X-Vibe-Signature", required = false) String signature, @RequestBody String raw) {
            return Map.of("result", payments.webhook(provider, signature, raw));
        }
    }

    // ---------- merchant: the bills screen ----------
    @RestController
    @RequestMapping("/v1/merchant/bills")
    public static class MerchantBillsApi {
        private final Redemptions redemptions;

        MerchantBillsApi(Redemptions redemptions) { this.redemptions = redemptions; }

        /** `view=open` (default): customers waiting for a bill or to pay, oldest first, searchable by VIBE ID or first name. `view=today`: paid today. */
        @GetMapping
        Redemptions.Board board(@AuthenticationPrincipal Jwt jwt, @RequestParam(defaultValue = "open") String view, @RequestParam(required = false) String q) {
            return redemptions.board(StaffPrincipal.from(jwt), view, q);
        }

        @PostMapping("/{id}/preview")
        Redemptions.Preview preview(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @Valid @RequestBody Redemptions.BillInput in) { return redemptions.preview(StaffPrincipal.from(jwt), uuid(id), in); }

        @PostMapping("/{id}")
        ResponseEntity<Redemptions.Row> raise(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @Valid @RequestBody Redemptions.BillInput in) {
            return ResponseEntity.status(HttpStatus.CREATED).body(redemptions.raise(StaffPrincipal.from(jwt), uuid(id), in));
        }

        @PostMapping("/{id}/withdraw")
        Redemptions.Row withdraw(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) { return redemptions.cancelBill(StaffPrincipal.from(jwt), uuid(id)); }
    }
}
