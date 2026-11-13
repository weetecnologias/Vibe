package in.vibe.backend.settlement;

import in.vibe.backend.audit.AuditService;
import in.vibe.backend.common.ApiException;
import in.vibe.backend.common.Csv;
import in.vibe.backend.compliance.Kyc;
import in.vibe.backend.security.AdminAccess;
import in.vibe.backend.security.StaffPrincipal;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * A pay run: the three steps finance follows to pay a category's businesses.
 * 1. Review what each business is owed (Settlements.due, limited to the category being looked at).
 * 2. Create the settlements for every business that can be paid, in one go, and download the bank file to pay them from the bank.
 *    Businesses whose KYC and bank details aren't verified, or who owe VIBE money after refunds, are held back with the reason.
 * 3. Mark each settlement paid with the bank's reference (UTR) once the money has gone.
 * Each settlement is created in its own transaction (through the Settlements proxy), so one business that can't be settled doesn't stop the rest.
 */
@Service
public class PayRuns {
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    public record Held(String businessId, String businessName, long amount, String reason) {}

    public record RunResult(List<Settlements.Summary> created, List<Held> held, long total) {}

    public record RunInput(OffsetDateTime upTo, List<String> businessIds) {}

    private final Settlements settlements;
    private final Kyc kyc;
    private final AdminAccess access;
    private final AuditService audit;

    PayRuns(Settlements settlements, Kyc kyc, AdminAccess access, AuditService audit) {
        this.settlements = settlements;
        this.kyc = kyc;
        this.access = access;
        this.audit = audit;
    }

    /** businessIds: only these businesses (empty or null: every business owed money in the category being looked at). */
    public RunResult run(StaffPrincipal who, RunInput in) {
        List<String> only = in == null || in.businessIds() == null ? List.of() : in.businessIds();
        OffsetDateTime upTo = in == null ? null : in.upTo();
        List<Settlements.Summary> created = new ArrayList<>();
        List<Held> held = new ArrayList<>();
        for (Settlements.Due d : settlements.due(access.businessScope(who, "b.id"))) {
            if (!only.isEmpty() && !only.contains(d.businessId())) continue;
            if (!"verified".equals(d.kycStatus())) {
                held.add(new Held(d.businessId(), d.businessName(), d.payout(), "KYC and bank details are " + d.kycStatus().replace('_', ' ') + ". Verify them first."));
                continue;
            }
            if (d.payout() <= 0) {
                held.add(new Held(d.businessId(), d.businessName(), d.payout(), "Refunds and adjustments are more than their sales. Nothing to pay yet."));
                continue;
            }
            try {
                created.add(settlements.create(who, new Settlements.CreateInput(d.businessId(), upTo)).summary());
            } catch (ApiException e) {
                held.add(new Held(d.businessId(), d.businessName(), d.payout(), e.getMessage()));
            }
        }
        long total = created.stream().mapToLong(Settlements.Summary::payout).sum();
        if (!created.isEmpty()) audit.record(who, "pay_run", "settlement", null, created.size() + " settlements, ₹" + total / 100 + ", " + held.size() + " held");
        return new RunResult(created, held, total);
    }

    /**
     * The bank file: every settlement waiting to be paid in the category being looked at, with the account to pay. It carries full account
     * numbers, so each download is written to the audit log.
     */
    public ResponseEntity<byte[]> bankFile(StaffPrincipal who) {
        List<Settlements.Summary> pending = settlements.list("pending", null, access.businessScope(who, "b.id"));
        Csv csv = new Csv().row("Reference", "Business", "Account holder", "Account number", "IFSC", "Bank", "Amount (Rs)", "Payments from", "Payments to", "KYC");
        long total = 0;
        for (Settlements.Summary s : pending) {
            Kyc.View k = kyc.get(UUID.fromString(s.businessId()));
            csv.row(s.reference(), s.businessName(), nz(k.bankAccountName()), nz(k.bankAccountNo()), nz(k.bankIfsc()), nz(k.bankName()), Csv.rupees(s.payout()),
                    s.periodFrom() == null ? "" : s.periodFrom().atZoneSameInstant(IST).toLocalDate(), s.periodTo() == null ? "" : s.periodTo().atZoneSameInstant(IST).toLocalDate(), k.status().replace('_', ' '));
            total += s.payout();
        }
        csv.row().row("Total", "", "", "", "", "", Csv.rupees(total));
        audit.record(who, "bank_file", "settlement", null, pending.size() + " settlements, ₹" + total / 100);
        return csv.download("vibe-bank-file-" + LocalDate.now(IST) + ".csv");
    }

    private static String nz(String s) { return s == null ? "" : s; }
}
