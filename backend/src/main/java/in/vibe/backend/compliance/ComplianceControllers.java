package in.vibe.backend.compliance;

import in.vibe.backend.common.ApiException;
import in.vibe.backend.customer.CustomerPrincipal;
import in.vibe.backend.security.AdminAccess;
import in.vibe.backend.security.StaffPrincipal;
import jakarta.servlet.http.HttpServletRequest;
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
import java.util.UUID;

/** The merchant agreement, KYC, and disputes: what the merchant, the customer and VIBE each see. */
@RestController
public class ComplianceControllers {
    public record Note(String note) {}

    private final Agreements agreements;
    private final Kyc kyc;
    private final Disputes disputes;
    private final AdminAccess access;

    ComplianceControllers(Agreements agreements, Kyc kyc, Disputes disputes, AdminAccess access) {
        this.agreements = agreements;
        this.kyc = kyc;
        this.disputes = disputes;
        this.access = access;
    }

    static UUID id(String raw) {
        try { return UUID.fromString(raw); } catch (IllegalArgumentException e) { throw ApiException.notFound("Not found."); }
    }

    private static String ip(HttpServletRequest r) { return r.getRemoteAddr(); }

    // ---------- the agreement ----------
    /** What an applicant reads and accepts. Empty when VIBE hasn't published one. */
    @GetMapping("/v1/business-applications/terms")
    ResponseEntity<Agreements.Version> terms() { return agreements.current().map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.noContent().build()); }

    @GetMapping("/v1/merchant/agreement")
    Agreements.Status myAgreement(@AuthenticationPrincipal Jwt jwt) { return agreements.status(StaffPrincipal.from(jwt).requireBusiness()); }

    @PostMapping("/v1/merchant/agreement/accept")
    Agreements.Status accept(@AuthenticationPrincipal Jwt jwt, HttpServletRequest request) { return agreements.accept(StaffPrincipal.from(jwt), ip(request)); }

    @GetMapping("/v1/admin/agreements")
    List<Agreements.Version> versions() { return agreements.versions(); }

    @PostMapping("/v1/admin/agreements")
    ResponseEntity<Agreements.Version> publish(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody Agreements.PublishInput in) {
        if (access.access(StaffPrincipal.from(jwt)).scoped()) throw ApiException.forbidden("Publishing the agreement is for admins.");
        return ResponseEntity.status(HttpStatus.CREATED).body(agreements.publish(StaffPrincipal.from(jwt), in));
    }

    @GetMapping("/v1/admin/agreements/acceptances")
    List<Agreements.Acceptance> acceptances(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) Integer version) {
        return agreements.acceptances(version, access.businessScope(StaffPrincipal.from(jwt), "b.id"));
    }

    // ---------- KYC ----------
    @GetMapping("/v1/merchant/kyc")
    Kyc.View myKyc(@AuthenticationPrincipal Jwt jwt) { return kyc.mine(StaffPrincipal.from(jwt).requireBusiness()); }

    @PutMapping("/v1/merchant/kyc")
    Kyc.View submitKyc(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody Kyc.Input in) { return kyc.submit(StaffPrincipal.from(jwt), in); }

    @GetMapping("/v1/admin/kyc")
    List<Kyc.Row> kycQueue(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) String status) { return kyc.queue(status, access.businessScope(StaffPrincipal.from(jwt), "b.id")); }

    @GetMapping("/v1/admin/kyc/{businessId}")
    Kyc.View kycOne(@AuthenticationPrincipal Jwt jwt, @PathVariable String businessId) {
        access.requireBusiness(StaffPrincipal.from(jwt), id(businessId));
        return kyc.get(id(businessId));
    }

    @PostMapping("/v1/admin/kyc/{businessId}/approve")
    Kyc.View approveKyc(@AuthenticationPrincipal Jwt jwt, @PathVariable String businessId) {
        access.requireBusiness(StaffPrincipal.from(jwt), id(businessId));
        return kyc.approve(StaffPrincipal.from(jwt), id(businessId));
    }

    @PostMapping("/v1/admin/kyc/{businessId}/reject")
    Kyc.View rejectKyc(@AuthenticationPrincipal Jwt jwt, @PathVariable String businessId, @RequestBody Note in) {
        access.requireBusiness(StaffPrincipal.from(jwt), id(businessId));
        return kyc.reject(StaffPrincipal.from(jwt), id(businessId), in.note());
    }

    // ---------- disputes ----------
    @PostMapping("/v1/payments/{reference}/dispute")
    ResponseEntity<Disputes.Row> raise(@AuthenticationPrincipal Jwt jwt, @PathVariable String reference, @Valid @RequestBody Disputes.RaiseInput in) {
        return ResponseEntity.status(HttpStatus.CREATED).body(disputes.raise(CustomerPrincipal.from(jwt).id(), reference, in));
    }

    @GetMapping("/v1/me/disputes")
    List<Disputes.Row> myDisputes(@AuthenticationPrincipal Jwt jwt) { return disputes.mine(CustomerPrincipal.from(jwt).id()); }

    @GetMapping("/v1/admin/disputes")
    List<Disputes.Row> disputeQueue(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) String status) { return disputes.list(status, access.businessScope(StaffPrincipal.from(jwt), "d.business_id")); }

    @PostMapping("/v1/admin/disputes/{reference}/resolve")
    Disputes.Row resolve(@AuthenticationPrincipal Jwt jwt, @PathVariable String reference, @Valid @RequestBody Disputes.ResolveInput in) {
        UUID business = disputes.businessOf(reference);
        if (business == null) { if (access.access(StaffPrincipal.from(jwt)).scoped()) throw ApiException.forbidden("This isn’t in the categories you look after."); }
        else access.requireBusiness(StaffPrincipal.from(jwt), business);
        return disputes.resolve(StaffPrincipal.from(jwt), reference, in);
    }
}
