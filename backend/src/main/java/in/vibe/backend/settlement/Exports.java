package in.vibe.backend.settlement;

import in.vibe.backend.common.Csv;
import in.vibe.backend.oversight.AdminOversight;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.UUID;

import static in.vibe.backend.common.Csv.rupees;

/** Spreadsheet downloads for the admin (and a merchant's own settlements). The same queries as the screens, so the file always matches what is shown. */
@Service
public class Exports {
    private static final int PAGE = 100, MAX_ROWS = 50_000;
    private final AdminOversight oversight;
    private final Settlements settlements;

    Exports(AdminOversight oversight, Settlements settlements) {
        this.oversight = oversight;
        this.settlements = settlements;
    }

    private static String stamp() { return LocalDate.now(ZoneId.of("Asia/Kolkata")).toString(); }

    private static String kind(String k) { return switch (k) { case "redemption" -> "Bill"; case "membership" -> "Membership"; case "tickets" -> "Tickets"; case "slots" -> "Court booking"; case "pass" -> "Venue membership"; default -> k; }; }

    public ResponseEntity<byte[]> transactions(String status, String kind, String q) { return transactions(status, kind, q, ""); }

    public ResponseEntity<byte[]> transactions(String status, String kind, String q, String scope) {
        Csv csv = new Csv().row("Transaction ID", "Type", "Status", "Method", "Amount (Rs)", "Customer saved (Rs)", "Customer", "VIBE ID", "Paid to", "Payment partner", "Started", "Confirmed", "Refund", "Refund (Rs)");
        for (int off = 0; off < MAX_ROWS; off += PAGE) {
            var page = oversight.transactions(status, kind, q, PAGE, off, scope);
            for (var r : page.items()) csv.row(r.reference(), kind(r.kind()), r.status(), r.method(), rupees(r.amount()), rupees(r.savings()), r.customerName(), r.vibeId(), r.payee(), r.provider(), r.createdAt(), r.verifiedAt(),
                    r.refundStatus() == null ? "" : r.refundStatus(), r.refundAmount() == null ? "" : rupees(r.refundAmount()));
            if (page.items().size() < PAGE) break;
        }
        return csv.download("vibe-transactions-" + stamp() + ".csv");
    }

    public ResponseEntity<byte[]> members(String status, String q) {
        Csv csv = new Csv().row("Member no", "Name", "VIBE ID", "Plan", "Status", "Member since", "Valid until", "Paid for membership (Rs)", "Saved with VIBE (Rs)");
        for (int off = 0; off < MAX_ROWS; off += PAGE) {
            var page = oversight.members(status, q, PAGE, off);
            for (var m : page.items()) csv.row(m.memberNo(), m.name(), m.vibeId(), m.plan(), m.status(), m.joinedAt(), m.validUntil(), rupees(m.totalPaid()), rupees(m.totalSaved()));
            if (page.items().size() < PAGE) break;
        }
        return csv.download("vibe-members-" + stamp() + ".csv");
    }

    /** Phone numbers stay masked in the file, as on screen. */
    public ResponseEntity<byte[]> customers(String q) {
        Csv csv = new Csv().row("VIBE ID", "Name", "Phone", "Area", "Joined", "Member", "Paid bills", "Total paid (Rs)");
        for (int off = 0; off < MAX_ROWS; off += PAGE) {
            var page = oversight.customers(q, PAGE, off);
            for (var c : page.items()) csv.row(c.vibeId(), c.name(), c.phoneMasked(), c.area(), c.joinedAt(), c.member() ? "Yes" : "No", c.paidRedemptions(), rupees(c.totalPaid()));
            if (page.items().size() < PAGE) break;
        }
        return csv.download("vibe-customers-" + stamp() + ".csv");
    }

    public ResponseEntity<byte[]> settlementList(String status) { return settlementList(status, ""); }

    public ResponseEntity<byte[]> settlementList(String status, String scope) {
        Csv csv = new Csv().row("Settlement ID", "Merchant", "From", "To", "Payments", "Collected (Rs)", "VIBE fees (Rs)", "Commission %", "Commission (Rs)", "Payout (Rs)", "Customer savings (Rs)",
                "Status", "Drawn up", "Paid on", "Bank reference");
        for (var s : settlements.list(status, null, scope)) {
            csv.row(s.reference(), s.businessName(), s.periodFrom(), s.periodTo(), s.paymentCount(), rupees(s.gross()), rupees(s.vibeFees()), String.format("%.2f", s.commissionBps() / 100.0),
                    rupees(s.commission()), rupees(s.payout()), rupees(s.customerSavings()), s.status(), s.createdAt(), s.paidAt(), s.payoutRef());
        }
        return csv.download("vibe-settlements-" + stamp() + ".csv");
    }

    public ResponseEntity<byte[]> dueList() { return dueList(""); }

    public ResponseEntity<byte[]> dueList(String scope) {
        Csv csv = new Csv().row("Merchant", "Area", "Payments", "Collected (Rs)", "VIBE fees (Rs)", "Commission %", "Commission (Rs)", "To pay (Rs)", "Oldest payment", "Newest payment");
        for (var d : settlements.due(scope)) {
            csv.row(d.businessName(), d.area(), d.count(), rupees(d.gross()), rupees(d.vibeFees()), String.format("%.2f", d.commissionBps() / 100.0), rupees(d.commission()), rupees(d.payout()), d.oldest(), d.newest());
        }
        return csv.download("vibe-to-settle-" + stamp() + ".csv");
    }

    /** Every payment in one settlement. `business` limits it to a merchant's own. */
    public ResponseEntity<byte[]> settlement(UUID id, UUID business) {
        var d = settlements.detail(id, business);
        Csv csv = new Csv().row("Transaction ID", "Paid at", "Customer", "VIBE ID", "Bill no", "Offer", "Collected (Rs)", "VIBE fee (Rs)", "Commission (Rs)", "Payout (Rs)", "Customer saved (Rs)");
        for (var i : d.items()) {
            csv.row(i.paymentReference(), i.paidAt(), i.customerName(), i.vibeId(), i.billRef(), i.offerTitle(), rupees(i.amount()), rupees(i.vibeFee()), rupees(i.commission()), rupees(i.payout()), rupees(i.customerSaved()));
        }
        var s = d.summary();
        csv.row().row("Total", null, null, null, null, s.paymentCount() + " payments", rupees(s.gross()), rupees(s.vibeFees()), rupees(s.commission()), rupees(s.payout()), rupees(s.customerSavings()));
        return csv.download(s.reference() + ".csv");
    }
}
