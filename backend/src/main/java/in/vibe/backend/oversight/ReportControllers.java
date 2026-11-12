package in.vibe.backend.oversight;

import in.vibe.backend.billing.Refunds;
import in.vibe.backend.common.ApiException;
import in.vibe.backend.security.AdminAccess;
import in.vibe.backend.security.StaffPrincipal;
import jakarta.validation.Valid;
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

/** Admin reports (by category, members) with downloads, and the refunds list. Category managers see only their categories. */
@RestController
public class ReportControllers {
    private final Reports reports;
    private final Refunds refunds;
    private final AdminAccess access;

    ReportControllers(Reports reports, Refunds refunds, AdminAccess access) {
        this.reports = reports;
        this.refunds = refunds;
        this.access = access;
    }

    static LocalDate day(String raw) {
        if (raw == null || raw.isBlank()) return null;
        try { return LocalDate.parse(raw); } catch (RuntimeException e) { throw ApiException.badRequest("date", "Use a date like 2026-11-01."); }
    }

    private String scope(Jwt jwt, String column) { return access.businessScope(StaffPrincipal.from(jwt), column); }

    @GetMapping("/v1/admin/reports/categories")
    Reports.CategoryReport categories(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) String from, @RequestParam(required = false) String to) {
        return reports.categories(day(from), day(to), scope(jwt, "b.id"));
    }

    @GetMapping("/v1/admin/reports/categories.csv")
    ResponseEntity<byte[]> categoriesCsv(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) String from, @RequestParam(required = false) String to) {
        return reports.categoriesCsv(day(from), day(to), scope(jwt, "b.id"));
    }

    @GetMapping("/v1/admin/reports/members")
    Reports.MembersReport members() { return reports.members(); }

    @GetMapping("/v1/admin/reports/members.csv")
    ResponseEntity<byte[]> membersCsv() { return reports.membersCsv(); }

    // ---------- refunds ----------
    @GetMapping("/v1/admin/refunds")
    Refunds.Page refunds(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) String status) { return refunds.list(status, scope(jwt, "pr.business_id")); }

    private void inScope(Jwt jwt, String reference) {
        java.util.UUID b = refunds.businessOf(reference);
        AdminAccess.Access a = access.access(StaffPrincipal.from(jwt));
        if (b == null) { if (a.scoped()) throw ApiException.forbidden("VIBE Membership payments are outside the categories you look after."); return; }
        access.requireBusiness(StaffPrincipal.from(jwt), b);
    }

    @PostMapping("/v1/admin/transactions/{reference}/refund")
    Refunds.Row raise(@AuthenticationPrincipal Jwt jwt, @PathVariable String reference, @Valid @RequestBody Refunds.RaiseInput in) {
        inScope(jwt, reference);
        return refunds.raise(StaffPrincipal.from(jwt), reference, in);
    }

    @PostMapping("/v1/admin/refunds/{reference}/done")
    Refunds.Row done(@AuthenticationPrincipal Jwt jwt, @PathVariable String reference, @Valid @RequestBody Refunds.DoneInput in) {
        inScope(jwt, reference);
        return refunds.markRefunded(StaffPrincipal.from(jwt), reference, in);
    }
}
