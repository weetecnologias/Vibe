package in.vibe.backend.reviews;

import in.vibe.backend.billing.Redemptions;
import in.vibe.backend.common.ApiException;
import in.vibe.backend.customer.CustomerPrincipal;
import in.vibe.backend.security.StaffPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Redeem codes at the counter, the merchant's payment setting, and ratings. Thin on purpose: the rules live in the services. */
public class RedeemControllers {
    static UUID uuid(String s) {
        try { return UUID.fromString(s); } catch (IllegalArgumentException e) { throw ApiException.notFound("Not found."); }
    }

    public record PaymentSetting(@NotNull Boolean acceptsVibePayments) {}

    @RestController
    public static class CustomerReviewApi {
        private final Reviews reviews;

        CustomerReviewApi(Reviews reviews) { this.reviews = reviews; }

        @PostMapping("/v1/redemptions/{id}/review")
        ResponseEntity<Void> review(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @Valid @RequestBody Reviews.Input in) {
            reviews.submit(CustomerPrincipal.from(jwt).id(), uuid(id), in);
            return ResponseEntity.noContent().build();
        }
    }

    @RestController
    public static class MerchantCounterApi {
        private final Redemptions redemptions;
        private final Reviews reviews;
        private final org.springframework.jdbc.core.simple.JdbcClient jdbc;
        private final in.vibe.backend.audit.AuditService audit;

        MerchantCounterApi(Redemptions redemptions, Reviews reviews, org.springframework.jdbc.core.simple.JdbcClient jdbc, in.vibe.backend.audit.AuditService audit) {
            this.redemptions = redemptions;
            this.reviews = reviews;
            this.jdbc = jdbc;
            this.audit = audit;
        }

        /** Look up the code a customer shows (optionally with the bill, to see the discount to give). */
        @PostMapping("/v1/merchant/bills/codes/check")
        Redemptions.CodeCheck check(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody Redemptions.CodeInput in) { return redemptions.checkCode(StaffPrincipal.from(jwt), in.code(), in.billAmount()); }

        /** "Yes, redeemed". */
        @PostMapping("/v1/merchant/bills/{id}/redeem")
        Redemptions.CodeCheck redeem(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @Valid @RequestBody Redemptions.RedeemInput in) {
            return redemptions.redeemCode(StaffPrincipal.from(jwt), uuid(id), in.billAmount());
        }

        @GetMapping("/v1/merchant/reviews")
        Reviews.MerchantView myReviews(@AuthenticationPrincipal Jwt jwt) { return reviews.forMerchant(StaffPrincipal.from(jwt).requireBusiness()); }

        @GetMapping("/v1/merchant/business/payment-setting")
        PaymentSetting paymentSetting(@AuthenticationPrincipal Jwt jwt) { return new PaymentSetting(redemptions.acceptsVibePayments(StaffPrincipal.from(jwt).requireBusiness())); }

        /** Whether customers can get their bill in the app and pay through VIBE. Off means codes only (pay at the counter). */
        @PutMapping("/v1/merchant/business/payment-setting")
        PaymentSetting setPaymentSetting(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody PaymentSetting in) {
            StaffPrincipal who = StaffPrincipal.from(jwt);
            jdbc.sql("update businesses set accepts_vibe_payments = :a, updated_at = now() where id = :b").param("a", in.acceptsVibePayments()).param("b", who.requireBusiness()).update();
            audit.record(who, "payment_setting", "business", who.requireBusiness(), "accepts VIBE payments: " + in.acceptsVibePayments());
            return in;
        }
    }

    @RestController
    public static class AdminReviewApi {
        private final Reviews reviews;

        AdminReviewApi(Reviews reviews) { this.reviews = reviews; }

        @GetMapping("/v1/admin/reviews")
        List<Reviews.Item> list(@RequestParam(required = false) String filter) { return reviews.forAdmin(filter); }

        @PostMapping("/v1/admin/reviews/{id}/hide")
        Map<String, Boolean> hide(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @Valid @RequestBody Reviews.HideInput in) {
            reviews.setHidden(StaffPrincipal.from(jwt), uuid(id), true, in.reason());
            return Map.of("hidden", true);
        }

        @PostMapping("/v1/admin/reviews/{id}/unhide")
        Map<String, Boolean> unhide(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) {
            reviews.setHidden(StaffPrincipal.from(jwt), uuid(id), false, null);
            return Map.of("hidden", false);
        }
    }
}
