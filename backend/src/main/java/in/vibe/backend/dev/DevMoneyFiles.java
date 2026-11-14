package in.vibe.backend.dev;

import in.vibe.backend.common.Csv;
import org.springframework.context.annotation.Profile;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Random;

/**
 * Development only: the payment partner is simulated, so there is no real gateway report or bank statement. These make believable ones from
 * VIBE's own data (2% gateway charge plus 18% GST on it), so the money checks can be tried end to end. Never available outside the dev profile.
 */
@RestController
@Profile("dev")
class DevMoneyFiles {
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private final JdbcClient jdbc;
    private final Random random = new Random();

    DevMoneyFiles(JdbcClient jdbc) { this.jdbc = jdbc; }

    private String code(int n) {
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < n; i++) b.append((char) ('A' + random.nextInt(26)));
        return b.toString();
    }

    /** One gateway payout for every confirmed payment not yet in one. */
    @GetMapping("/v1/admin/dev/sample-gateway-report.csv")
    ResponseEntity<byte[]> gatewayReport() {
        String setl = "setl_" + code(10), utr = "UTR" + (100000000L + random.nextInt(899999999));
        Csv csv = new Csv().row("settlement_id", "utr", "settled_on", "type", "reference", "order_id", "payment_id", "amount", "fee", "tax");
        List<Object[]> rows = jdbc.sql("select reference, provider_order_id, coalesce(provider_payment_id, ''), amount from payments where status = 'verified' and gateway_settlement_id is null order by verified_at")
                .query((rs, i) -> new Object[]{rs.getString(1), rs.getString(2), rs.getString(3), rs.getLong(4)}).list();
        for (Object[] r : rows) {
            long amount = (Long) r[3], fee = Math.round(amount * 0.02), tax = Math.round(fee * 0.18);
            csv.row(setl, utr, LocalDate.now(IST), "payment", r[0], r[1], r[2], Csv.rupees(amount), Csv.rupees(fee), Csv.rupees(tax));
        }
        return csv.download("sample-gateway-report-" + LocalDate.now(IST) + ".csv");
    }

    /** The escrow account: a credit for each gateway payout not yet seen, a debit for each business payout marked paid but not yet seen. */
    @GetMapping("/v1/admin/dev/sample-bank-statement.csv")
    ResponseEntity<byte[]> bankStatement() {
        long balance = jdbc.sql("select coalesce((select closing_balance from bank_statements where closing_balance is not null order by period_to desc nulls last, imported_at desc limit 1), 0)").query(Long.class).single();
        Csv csv = new Csv().row("Date", "Narration", "Reference", "Debit", "Credit", "Balance");
        String today = LocalDate.now(IST).toString();
        for (Object[] g : jdbc.sql("select provider_settlement_id, utr, net from gateway_settlements where status = 'awaiting_bank' order by settled_on")
                .query((rs, i) -> new Object[]{rs.getString(1), rs.getString(2), rs.getLong(3)}).list()) {
            balance += (Long) g[2];
            csv.row(today, "NEFT CR PAYMENT GATEWAY SETTLEMENT " + g[0], g[1], "", Csv.rupees((Long) g[2]), Csv.rupees(balance));
        }
        for (Object[] s : jdbc.sql("select s.payout_ref, s.payout, b.name from settlements s join businesses b on b.id = s.business_id where s.status = 'paid' and s.bank_line_id is null order by s.paid_at")
                .query((rs, i) -> new Object[]{rs.getString(1), rs.getLong(2), rs.getString(3)}).list()) {
            balance -= (Long) s[1];
            csv.row(today, "NEFT DR " + s[2].toString().toUpperCase(), s[0], Csv.rupees((Long) s[1]), "", Csv.rupees(balance));
        }
        return csv.download("sample-escrow-statement-" + today + ".csv");
    }
}
