package in.vibe.backend.finance;

import in.vibe.backend.common.ApiException;
import in.vibe.backend.security.AdminAccess;
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
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** Admin → Money: rate cards and tax, the ledger, adjustments and reconciliation. Category managers see and act only on their categories' businesses. */
@RestController
public class FinanceControllers {
    public record Upload(String fileName, @NotBlank String csv, String from, String to) {}

    private final RateCards rates;
    private final Ledger ledger;
    private final Adjustments adjustments;
    private final Reconciliation reconciliation;
    private final AdminAccess access;

    FinanceControllers(RateCards rates, Ledger ledger, Adjustments adjustments, Reconciliation reconciliation, AdminAccess access) {
        this.rates = rates;
        this.ledger = ledger;
        this.adjustments = adjustments;
        this.reconciliation = reconciliation;
        this.access = access;
    }

    static UUID id(String raw) {
        try { return UUID.fromString(raw); } catch (IllegalArgumentException e) { throw ApiException.notFound("Not found."); }
    }

    private static LocalDate day(String raw) {
        if (raw == null || raw.isBlank()) return null;
        try { return LocalDate.parse(raw); } catch (RuntimeException e) { throw ApiException.badRequest("date", "Use a date like 2026-11-01."); }
    }

    // ---------- rate cards and tax ----------
    @GetMapping("/v1/admin/rate-cards")
    List<RateCards.Card> cards(@RequestParam(required = false) String scope, @RequestParam(required = false) String target) { return rates.list(scope, target); }

    @PostMapping("/v1/admin/rate-cards")
    ResponseEntity<RateCards.Card> addCard(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody RateCards.Input in) {
        if ("business".equals(in.scope()) && in.targetId() != null) access.requireBusiness(StaffPrincipal.from(jwt), id(in.targetId()));
        else if ("category".equals(in.scope()) && in.targetId() != null) access.requireCategory(StaffPrincipal.from(jwt), id(in.targetId()));
        else if (access.access(StaffPrincipal.from(jwt)).scoped()) throw ApiException.forbidden("Platform-wide rates are for admins.");
        return ResponseEntity.status(HttpStatus.CREATED).body(rates.add(StaffPrincipal.from(jwt), in));
    }

    /** The rate a business pays now, and where it comes from. */
    @GetMapping("/v1/admin/rate-cards/effective/{businessId}")
    RateCards.Rate effective(@AuthenticationPrincipal Jwt jwt, @PathVariable String businessId) {
        access.requireBusiness(StaffPrincipal.from(jwt), id(businessId));
        return rates.rateNow(id(businessId));
    }

    @GetMapping("/v1/admin/rate-cards/tax")
    RateCards.Tax tax() { return new RateCards.Tax(rates.gstBps()); }

    @PutMapping("/v1/admin/rate-cards/tax")
    RateCards.Tax setTax(@AuthenticationPrincipal Jwt jwt, @RequestBody RateCards.Tax in) {
        if (access.access(StaffPrincipal.from(jwt)).scoped()) throw ApiException.forbidden("Tax settings are for admins.");
        return rates.setGst(StaffPrincipal.from(jwt), in.commissionGstBps());
    }

    // ---------- ledger ----------
    @GetMapping("/v1/admin/ledger/trial-balance")
    Ledger.TrialBalance trialBalance() { return ledger.trialBalance(); }

    @GetMapping("/v1/admin/ledger/entries")
    List<Ledger.Entry> entries(@RequestParam(required = false) String account, @RequestParam(required = false) String ref, @RequestParam(defaultValue = "200") int limit) { return ledger.entries(account, ref, limit); }

    // ---------- adjustments ----------
    @GetMapping("/v1/admin/adjustments")
    List<Adjustments.Row> adjustments(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) String businessId, @RequestParam(defaultValue = "false") boolean pending) {
        if (businessId != null && !businessId.isBlank()) access.requireBusiness(StaffPrincipal.from(jwt), id(businessId));
        else if (access.access(StaffPrincipal.from(jwt)).scoped()) throw ApiException.forbidden("Choose a business.");
        return adjustments.list(businessId == null || businessId.isBlank() ? null : id(businessId), pending);
    }

    @PostMapping("/v1/admin/businesses/{businessId}/adjustments")
    ResponseEntity<Adjustments.Row> addAdjustment(@AuthenticationPrincipal Jwt jwt, @PathVariable String businessId, @Valid @RequestBody Adjustments.Input in) {
        access.requireBusiness(StaffPrincipal.from(jwt), id(businessId));
        return ResponseEntity.status(HttpStatus.CREATED).body(adjustments.add(StaffPrincipal.from(jwt), id(businessId), in));
    }

    // ---------- reconciliation ----------
    @PostMapping("/v1/admin/reconciliation")
    Reconciliation.Detail reconcile(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody Upload in) {
        if (access.access(StaffPrincipal.from(jwt)).scoped()) throw ApiException.forbidden("Reconciliation covers every payment, so it is for admins.");
        return reconciliation.run(StaffPrincipal.from(jwt), in.fileName(), in.csv(), day(in.from()), day(in.to()));
    }

    @GetMapping("/v1/admin/reconciliation")
    List<Reconciliation.Run> runs() { return reconciliation.runs(); }

    @GetMapping("/v1/admin/reconciliation/{id}")
    Reconciliation.Detail run(@PathVariable String id) { return reconciliation.detail(id(id)); }

    @GetMapping("/v1/admin/reconciliation/{id}.csv")
    ResponseEntity<byte[]> runCsv(@PathVariable String id) { return reconciliation.download(id(id)); }
}
