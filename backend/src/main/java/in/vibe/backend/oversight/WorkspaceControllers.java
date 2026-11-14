package in.vibe.backend.oversight;

import in.vibe.backend.common.ApiException;
import in.vibe.backend.security.AdminAccess;
import in.vibe.backend.security.StaffPrincipal;
import in.vibe.backend.settlement.PayRuns;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.UUID;

/**
 * The admin dashboard by category: the category switcher, the overview cards, the to-do list, merchants (with KYC, bank and agreement in one
 * place), merchant balances and the settlement pay run. The category being looked at comes in the X-Vibe-Workspace header.
 */
@RestController
public class WorkspaceControllers {
    private final Workspaces workspaces;
    private final PayRuns payRuns;
    private final AdminAccess access;

    WorkspaceControllers(Workspaces workspaces, PayRuns payRuns, AdminAccess access) {
        this.workspaces = workspaces;
        this.payRuns = payRuns;
        this.access = access;
    }

    @GetMapping("/v1/admin/workspaces")
    Workspaces.WorkspaceList list(@AuthenticationPrincipal Jwt jwt) { return workspaces.list(StaffPrincipal.from(jwt)); }

    @GetMapping("/v1/admin/workspaces/overview")
    Workspaces.Overview overview(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) LocalDate from, @RequestParam(required = false) LocalDate to) {
        requireArea(jwt, "reports");
        return workspaces.overview(StaffPrincipal.from(jwt), from, to);
    }

    @GetMapping("/v1/admin/workspaces/overview.csv")
    ResponseEntity<byte[]> overviewCsv(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) LocalDate from, @RequestParam(required = false) LocalDate to) {
        requireArea(jwt, "reports");
        return workspaces.overviewCsv(StaffPrincipal.from(jwt), from, to);
    }

    @GetMapping("/v1/admin/todo")
    Workspaces.TodoList todo(@AuthenticationPrincipal Jwt jwt) { return workspaces.todo(StaffPrincipal.from(jwt)); }

    @GetMapping("/v1/admin/merchants")
    Workspaces.MerchantPage merchants(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) String q, @RequestParam(required = false) String kyc, @RequestParam(required = false) String agreement,
                                      @RequestParam(required = false) Boolean live, @RequestParam(required = false) String category, @RequestParam(defaultValue = "50") int limit,
                                      @RequestParam(defaultValue = "0") int offset) {
        return workspaces.merchants(StaffPrincipal.from(jwt), q, kyc, agreement, live, category, limit, offset);
    }

    @GetMapping("/v1/admin/merchants.csv")
    ResponseEntity<byte[]> merchantsCsv(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) String q, @RequestParam(required = false) String kyc, @RequestParam(required = false) String agreement,
                                        @RequestParam(required = false) Boolean live, @RequestParam(required = false) String category) {
        return workspaces.merchantsCsv(StaffPrincipal.from(jwt), q, kyc, agreement, live, category);
    }

    @GetMapping("/v1/admin/merchants/categories")
    Workspaces.MerchantCategories merchantCategories(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) String parent) { return workspaces.merchantCategories(StaffPrincipal.from(jwt), parent); }

    @GetMapping("/v1/admin/merchants/categories.csv")
    ResponseEntity<byte[]> merchantCategoriesCsv(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) String parent) { return workspaces.merchantCategoriesCsv(StaffPrincipal.from(jwt), parent); }

    @GetMapping("/v1/admin/merchants/{id}/payments")
    Workspaces.MerchantPayments merchantPayments(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @RequestParam(required = false) String settled,
                                                 @RequestParam(defaultValue = "50") int limit, @RequestParam(defaultValue = "0") int offset) {
        return workspaces.merchantPayments(StaffPrincipal.from(jwt), uuid(id), settled, limit, offset);
    }

    @GetMapping("/v1/admin/merchants/{id}/payments.csv")
    ResponseEntity<byte[]> merchantPaymentsCsv(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @RequestParam(required = false) String settled) {
        return workspaces.merchantPaymentsCsv(StaffPrincipal.from(jwt), uuid(id), settled);
    }

    @GetMapping("/v1/admin/merchants/{id}")
    Workspaces.MerchantProfile merchant(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) { return workspaces.merchant(StaffPrincipal.from(jwt), uuid(id)); }

    @GetMapping("/v1/admin/balances")
    Workspaces.Balances balances(@AuthenticationPrincipal Jwt jwt, @RequestParam(defaultValue = "true") boolean active) { return workspaces.balances(StaffPrincipal.from(jwt), active); }

    @GetMapping("/v1/admin/balances.csv")
    ResponseEntity<byte[]> balancesCsv(@AuthenticationPrincipal Jwt jwt) { return workspaces.balancesCsv(StaffPrincipal.from(jwt)); }

    @PostMapping("/v1/admin/settlements/run")
    PayRuns.RunResult run(@AuthenticationPrincipal Jwt jwt, @RequestBody(required = false) PayRuns.RunInput in) { return payRuns.run(StaffPrincipal.from(jwt), in); }

    @GetMapping("/v1/admin/settlements/bank-file.csv")
    ResponseEntity<byte[]> bankFile(@AuthenticationPrincipal Jwt jwt) { return payRuns.bankFile(StaffPrincipal.from(jwt)); }

    private void requireArea(Jwt jwt, String area) {
        if (!access.access(StaffPrincipal.from(jwt)).can(area)) throw ApiException.forbidden("Your access doesn’t include this. Ask a VIBE admin.");
    }

    private static UUID uuid(String s) {
        try {
            return UUID.fromString(s);
        } catch (IllegalArgumentException e) {
            throw ApiException.notFound("Not found.");
        }
    }
}
