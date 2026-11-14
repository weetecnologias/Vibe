package in.vibe.backend.settlement;

import in.vibe.backend.security.StaffPrincipal;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
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

import static in.vibe.backend.settlement.Settlements.uuid;

/** Settlements, commercial terms, spreadsheet downloads and a merchant's results. Thin on purpose: the rules live in the services. */
public class SettlementControllers {

    @RestController
    public static class AdminSettlementApi {
        private final Settlements settlements;
        private final Exports exports;

        private final in.vibe.backend.security.AdminAccess adminAccess;

        AdminSettlementApi(Settlements settlements, Exports exports, in.vibe.backend.security.AdminAccess adminAccess) {
            this.adminAccess = adminAccess;
            this.settlements = settlements;
            this.exports = exports;
        }

        @GetMapping("/v1/admin/settlements/due")
        List<Settlements.Due> due(@AuthenticationPrincipal Jwt jwt) { return settlements.due(adminAccess.businessScope(StaffPrincipal.from(jwt), "b.id")); }

        @GetMapping("/v1/admin/settlements")
        List<Settlements.Summary> list(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) String status, @RequestParam(required = false) String businessId) {
            return settlements.list(status, businessId == null || businessId.isBlank() ? null : uuid(businessId), adminAccess.businessScope(StaffPrincipal.from(jwt), "b.id"));
        }

        @PostMapping("/v1/admin/settlements")
        ResponseEntity<Settlements.Detail> create(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody Settlements.CreateInput in) {
            adminAccess.requireBusiness(StaffPrincipal.from(jwt), uuid(in.businessId()));
            return ResponseEntity.status(HttpStatus.CREATED).body(settlements.create(StaffPrincipal.from(jwt), in));
        }

        @GetMapping("/v1/admin/settlements/{id}")
        Settlements.Detail detail(@PathVariable String id) { return settlements.detail(uuid(id), null); }

        @PostMapping("/v1/admin/settlements/{id}/paid")
        Settlements.Detail paid(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @Valid @RequestBody Settlements.PaidInput in) {
            return settlements.markPaid(StaffPrincipal.from(jwt), uuid(id), in);
        }

        @GetMapping("/v1/admin/businesses/{id}/terms")
        Settlements.Terms terms(@PathVariable String id) { return settlements.terms(uuid(id)); }

        @PutMapping("/v1/admin/businesses/{id}/terms")
        Settlements.Terms updateTerms(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @Valid @RequestBody Settlements.TermsInput in) {
            return settlements.updateTerms(StaffPrincipal.from(jwt), uuid(id), in);
        }

        // ---------- spreadsheet downloads ----------
        @GetMapping("/v1/admin/exports/transactions")
        ResponseEntity<byte[]> transactions(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) String status, @RequestParam(required = false) String kind, @RequestParam(required = false) String q) {
            return exports.transactions(status, kind, q, adminAccess.businessScope(StaffPrincipal.from(jwt), "pr.business_id"));
        }

        @GetMapping("/v1/admin/exports/members")
        ResponseEntity<byte[]> members(@RequestParam(required = false) String status, @RequestParam(required = false) String q) { return exports.members(status, q); }

        @GetMapping("/v1/admin/exports/customers")
        ResponseEntity<byte[]> customers(@RequestParam(required = false) String q, @RequestParam(required = false) String membership) { return exports.customers(q, membership); }

        @GetMapping("/v1/admin/exports/settlements")
        ResponseEntity<byte[]> settlementList(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) String status) { return exports.settlementList(status, adminAccess.businessScope(StaffPrincipal.from(jwt), "b.id")); }

        @GetMapping("/v1/admin/exports/settlements-due")
        ResponseEntity<byte[]> dueExport(@AuthenticationPrincipal Jwt jwt) { return exports.dueList(adminAccess.businessScope(StaffPrincipal.from(jwt), "b.id")); }

        @GetMapping("/v1/admin/exports/settlements/{id}")
        ResponseEntity<byte[]> settlement(@PathVariable String id) { return exports.settlement(uuid(id), null); }
    }

    @RestController
    public static class MerchantMoneyApi {
        private final Settlements settlements;
        private final Exports exports;
        private final MerchantResults results;

        MerchantMoneyApi(Settlements settlements, Exports exports, MerchantResults results) {
            this.settlements = settlements;
            this.exports = exports;
            this.results = results;
        }

        @GetMapping("/v1/merchant/settlements")
        Settlements.MerchantView mine(@AuthenticationPrincipal Jwt jwt) { return settlements.merchantView(StaffPrincipal.from(jwt).requireBusiness()); }

        @GetMapping("/v1/merchant/settlements/{id}")
        Settlements.Detail one(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) { return settlements.detail(uuid(id), StaffPrincipal.from(jwt).requireBusiness()); }

        @GetMapping("/v1/merchant/settlements/{id}/export")
        ResponseEntity<byte[]> export(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) { return exports.settlement(uuid(id), StaffPrincipal.from(jwt).requireBusiness()); }

        @GetMapping("/v1/merchant/results")
        MerchantResults.Results results(@AuthenticationPrincipal Jwt jwt, @RequestParam(defaultValue = "30") int days) { return results.results(StaffPrincipal.from(jwt).requireBusiness(), days); }
    }
}
