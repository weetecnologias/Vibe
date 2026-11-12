package in.vibe.backend.backoffice;

import in.vibe.backend.catalogue.BillingRules;
import in.vibe.backend.common.ApiException;
import in.vibe.backend.customer.CustomerPrincipal;
import in.vibe.backend.membership.Memberships;
import in.vibe.backend.notify.StaffNotifications;
import in.vibe.backend.onboarding.Applications;
import in.vibe.backend.oversight.AdminOversight;
import in.vibe.backend.security.StaffPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Membership, merchant applications, staff alerts, and the admin overview. Thin on purpose: the rules live in the services. */
public class PlatformControllers {

    static UUID uuid(String raw) { return Controllers.uuid(raw); }

    public record PlanChoice(@NotBlank String planId) {}

    public record Note(String note) {}

    public record Approve(String categoryId) {}

    // ---------- customer: membership ----------
    @RestController
    @RequestMapping("/v1/membership")
    public static class MembershipApi {
        private final Memberships memberships;

        MembershipApi(Memberships memberships) { this.memberships = memberships; }

        @GetMapping
        Memberships.View mine(@AuthenticationPrincipal Jwt jwt) { return memberships.view(CustomerPrincipal.from(jwt).id()); }

        /** Starts a purchase: returns the bill to pay through the normal payment flow. The membership starts when the payment is confirmed. */
        @PostMapping("/subscriptions")
        ResponseEntity<Memberships.Subscribed> subscribe(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody PlanChoice in) {
            return ResponseEntity.status(HttpStatus.CREATED).body(memberships.subscribe(CustomerPrincipal.from(jwt).id(), uuid(in.planId())));
        }

        @PostMapping("/plan-change")
        Memberships.View change(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody PlanChoice in) { return memberships.changePlan(CustomerPrincipal.from(jwt).id(), uuid(in.planId())); }

        @PostMapping("/cancel")
        Memberships.View cancel(@AuthenticationPrincipal Jwt jwt) { return memberships.cancel(CustomerPrincipal.from(jwt).id()); }
    }

    // ---------- a business applying to join (no sign-in) ----------
    @RestController
    @RequestMapping("/v1/business-applications")
    public static class ApplicationsPublicApi {
        private final Applications applications;

        ApplicationsPublicApi(Applications applications) { this.applications = applications; }

        @PostMapping
        ResponseEntity<Applications.Submitted> submit(@Valid @RequestBody Applications.Input in) { return ResponseEntity.status(HttpStatus.CREATED).body(applications.submit(in)); }

        @GetMapping("/{id}")
        Applications.StatusView status(@PathVariable String id, @RequestParam String token) { return applications.status(uuid(id), token); }

        @PutMapping("/{id}")
        Applications.StatusView resubmit(@PathVariable String id, @RequestParam String token, @Valid @RequestBody Applications.Input in) { return applications.resubmit(uuid(id), token, in); }
    }

    // ---------- alerts on the dashboards ----------
    @RestController
    @RequestMapping("/v1/staff/notifications")
    public static class StaffNotificationsApi {
        private final StaffNotifications notifications;

        StaffNotificationsApi(StaffNotifications notifications) { this.notifications = notifications; }

        /** The dashboards ask for this every few seconds and make a sound when `unread` goes up. */
        @GetMapping
        StaffNotifications.Inbox inbox(@AuthenticationPrincipal Jwt jwt, @RequestParam(defaultValue = "30") int limit) { return notifications.inbox(StaffPrincipal.from(jwt), limit); }

        @PostMapping("/read")
        ResponseEntity<Void> readAll(@AuthenticationPrincipal Jwt jwt) {
            notifications.markAllRead(StaffPrincipal.from(jwt));
            return ResponseEntity.noContent().build();
        }

        @PostMapping("/{id}/read")
        ResponseEntity<Void> read(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) {
            notifications.markRead(StaffPrincipal.from(jwt), uuid(id));
            return ResponseEntity.noContent().build();
        }
    }

    // ---------- merchant ----------
    @RestController
    @RequestMapping("/v1/merchant/settings")
    public static class MerchantSettingsApi {
        private final BillingRules rules;
        private final in.vibe.backend.security.TeamAccess access;

        MerchantSettingsApi(BillingRules rules, in.vibe.backend.security.TeamAccess access) {
            this.rules = rules;
            this.access = access;
        }

        public record Settings(boolean payRedeem, String menuLabel, boolean owner, String staffRole, List<String> permissions, Map<String, String> areas) {}

        /** Whether this kind of business uses Pay & Redeem bills and what its item list is called (set by VIBE on the category), and what this person may do. */
        @GetMapping
        Settings settings(@AuthenticationPrincipal Jwt jwt) {
            StaffPrincipal who = StaffPrincipal.from(jwt);
            BillingRules.Rules r = rules.forBusiness(who.requireBusiness());
            in.vibe.backend.security.TeamAccess.Access a = access.access(who);
            return new Settings(r.payRedeem(), r.menuLabel(), a.owner(), a.staffRole(), a.permissions(), in.vibe.backend.security.TeamAccess.AREAS);
        }
    }

    // ---------- admin ----------
    @RestController
    @RequestMapping("/v1/admin")
    public static class AdminPlatformApi {
        private final AdminOversight oversight;
        private final Applications applications;
        private final Memberships memberships;

        AdminPlatformApi(AdminOversight oversight, Applications applications, Memberships memberships) {
            this.oversight = oversight;
            this.applications = applications;
            this.memberships = memberships;
        }

        @GetMapping("/overview")
        AdminOversight.Overview overview() { return oversight.overview(); }

        @GetMapping("/customers")
        AdminOversight.CustomerPage customers(@RequestParam(required = false) String q, @RequestParam(defaultValue = "25") int limit, @RequestParam(defaultValue = "0") int offset) { return oversight.customers(q, limit, offset); }

        @GetMapping("/customers/{id}")
        AdminOversight.CustomerDetail customer(@PathVariable String id) { return oversight.customer(uuid(id)); }

        @PostMapping("/customers/{id}/reveal-phone")
        Map<String, String> reveal(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) { return oversight.revealPhone(StaffPrincipal.from(jwt), uuid(id)); }

        @PostMapping("/customers/{id}/membership")
        Memberships.View grant(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @Valid @RequestBody Memberships.Grant in) { return memberships.grant(StaffPrincipal.from(jwt), uuid(id), in); }

        @GetMapping("/transactions")
        AdminOversight.TransactionPage transactions(@RequestParam(required = false) String status, @RequestParam(required = false) String kind, @RequestParam(required = false) String q,
                                                    @RequestParam(defaultValue = "25") int limit, @RequestParam(defaultValue = "0") int offset) { return oversight.transactions(status, kind, q, limit, offset); }

        @GetMapping("/transactions/{reference}")
        AdminOversight.TransactionDetail transaction(@PathVariable String reference) { return oversight.transaction(reference); }

        @GetMapping("/members")
        AdminOversight.MemberPage members(@RequestParam(required = false) String status, @RequestParam(required = false) String q, @RequestParam(defaultValue = "25") int limit, @RequestParam(defaultValue = "0") int offset) {
            return oversight.members(status, q, limit, offset);
        }

        @GetMapping("/deletion-requests")
        List<AdminOversight.DeletionRow> deletions(@RequestParam(required = false) String status) { return oversight.deletions(status); }

        @PostMapping("/deletion-requests/{id}/complete")
        ResponseEntity<Void> completeDeletion(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) {
            oversight.completeDeletion(StaffPrincipal.from(jwt), uuid(id));
            return ResponseEntity.noContent().build();
        }

        @GetMapping("/applications")
        List<Applications.Row> applications(@RequestParam(required = false) String status) { return applications.list(status); }

        @GetMapping("/applications/{id}")
        Applications.Detail application(@PathVariable String id) { return applications.get(uuid(id)); }

        @PostMapping("/applications/{id}/request-changes")
        Applications.Detail requestChanges(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @RequestBody Note in) { return applications.requestChanges(StaffPrincipal.from(jwt), uuid(id), in.note()); }

        @PostMapping("/applications/{id}/reject")
        Applications.Detail reject(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @RequestBody Note in) { return applications.reject(StaffPrincipal.from(jwt), uuid(id), in.note()); }

        @PostMapping("/applications/{id}/approve")
        Applications.Approved approve(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @RequestBody(required = false) Approve in) {
            return applications.approve(StaffPrincipal.from(jwt), uuid(id), in == null ? null : in.categoryId());
        }
    }

}
