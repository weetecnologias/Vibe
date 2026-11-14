package in.vibe.backend.finance;

import in.vibe.backend.common.ApiException;
import in.vibe.backend.security.AdminAccess;
import in.vibe.backend.security.StaffPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/** The Model A money checks: upload the gateway's settlement report and the escrow account's statement; see what matches and what doesn't. */
@RestController
public class EscrowControllers {
    public record Upload(@Size(max = 200) String fileName, @NotBlank @Size(max = 12_000_000) String csv) {}

    public record Note(@NotBlank @Size(max = 300) String note) {}

    private final Escrow escrow;
    private final AdminAccess access;

    EscrowControllers(Escrow escrow, AdminAccess access) {
        this.escrow = escrow;
        this.access = access;
    }

    /** Money checks cover every payment and the escrow account, so category managers don't get them. */
    private StaffPrincipal finance(Jwt jwt) {
        StaffPrincipal who = StaffPrincipal.from(jwt);
        if (access.access(who).scoped()) throw ApiException.forbidden("The money checks cover all of VIBE’s money, so they are for VIBE’s finance team and admins.");
        return who;
    }

    @GetMapping("/v1/admin/escrow/overview")
    Escrow.Overview overview(@AuthenticationPrincipal Jwt jwt) { finance(jwt); return escrow.overview(); }

    @GetMapping("/v1/admin/escrow/problems.csv")
    ResponseEntity<byte[]> problems(@AuthenticationPrincipal Jwt jwt) { finance(jwt); return escrow.exceptionsCsv(); }

    @PostMapping("/v1/admin/escrow/gateway-report")
    Escrow.GatewayImport gatewayReport(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody Upload in) { return escrow.importGatewayReport(finance(jwt), in.fileName(), in.csv()); }

    @GetMapping("/v1/admin/escrow/gateway-payouts")
    List<Escrow.GatewayPayout> payouts(@AuthenticationPrincipal Jwt jwt) { finance(jwt); return escrow.payouts(); }

    @GetMapping("/v1/admin/escrow/gateway-payouts/{id}")
    Escrow.GatewayPayoutDetail payout(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) { finance(jwt); return escrow.payoutDetail(uuid(id)); }

    @PostMapping("/v1/admin/escrow/bank-statement")
    Escrow.BankImport bankStatement(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody Upload in) { return escrow.importBankStatement(finance(jwt), in.fileName(), in.csv()); }

    @GetMapping("/v1/admin/escrow/bank-lines")
    List<Escrow.BankLine> bankLines(@AuthenticationPrincipal Jwt jwt, @RequestParam(defaultValue = "false") boolean problems) { finance(jwt); return escrow.bankLines(problems); }

    @PostMapping("/v1/admin/escrow/bank-lines/{id}/explain")
    Escrow.BankLine explain(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @Valid @RequestBody Note in) { return escrow.explain(finance(jwt), uuid(id), in.note()); }

    private static UUID uuid(String s) {
        try {
            return UUID.fromString(s);
        } catch (IllegalArgumentException e) {
            throw ApiException.notFound("Not found.");
        }
    }
}
