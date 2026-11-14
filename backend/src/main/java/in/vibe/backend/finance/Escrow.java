package in.vibe.backend.finance;

import in.vibe.backend.audit.AuditService;
import in.vibe.backend.common.ApiException;
import in.vibe.backend.common.Csv;
import in.vibe.backend.security.StaffPrincipal;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeFormatterBuilder;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * Model A money checks. Customers pay through the gateway; the gateway pays VIBE's escrow bank account (less its charges); VIBE pays each
 * business from that account. Finance uploads two files and VIBE matches them:
 *  - the gateway's settlement report (every payment and refund in each gateway payout, with its charges): check 1, every customer payment
 *    is in a gateway payout, exactly once and for the right amount; the charges are booked as VIBE's cost;
 *  - the escrow account's bank statement: check 2, each gateway payout arrived (matched by its UTR, or amount and date); check 3, each payout
 *    VIBE marked as paid to a business left the account (matched by the bank reference entered when it was marked paid).
 * Anything that doesn't match is listed until it's sorted out or explained with a note. Uploading the same file or an overlapping statement
 * again changes nothing: gateway payouts are kept once by their id and bank lines once by date, reference, amount and narration.
 */
@Service
public class Escrow {
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final int MAX_ROWS = 50_000;
    private static final int GRACE_DAYS = 3;

    public record GatewayPayout(String id, String providerSettlementId, String utr, LocalDate settledOn, long paymentsAmount, long refundsAmount, long fees, long tax, long net, int lineCount,
                                int problems, String status, LocalDate bankDate, String fileName, OffsetDateTime importedAt) {}

    public record GatewayLine(int lineNo, String type, String key, String paymentReference, long amount, long fee, long tax, Long vibeAmount, String result) {}

    public record GatewayPayoutDetail(GatewayPayout payout, List<GatewayLine> lines) {}

    public record GatewayImport(int payouts, int alreadyImported, int lines, int matched, int problems, long net, List<GatewayPayout> imported) {}

    public record BankLine(String id, LocalDate valueDate, String narration, String reference, long credit, long debit, String result, String gatewayPayout, String settlementRef, String businessName, String note) {}

    public record BankImport(String statementId, int lines, int newLines, int alreadySeen, int matched, int unmatched, Long closingBalance) {}

    public record Problem(String kind, String reference, String detail, long amount, OffsetDateTime since, String bankLineId) {}

    /**
     * check1: customer payments not yet in a gateway payout, and gateway lines that don't match. check2: gateway payouts not yet seen in the
     * bank, matched and with a different amount. check3: payouts to businesses marked paid, how many were seen leaving the bank, and the rest.
     * atGateway: what the gateway still holds for VIBE by VIBE's books; escrowBooks: the escrow account by VIBE's books; escrowBank: the
     * closing balance on the latest statement.
     */
    public record Overview(int awaitingGatewayCount, long awaitingGatewayAmount, OffsetDateTime awaitingGatewaySince, int gatewayLineProblems,
                           int payoutsAwaitingBank, long payoutsAwaitingBankAmount, int payoutsMatched, int payoutsMismatched,
                           int merchantPayoutsPaid, int merchantPayoutsInBank, int merchantPayoutsNotInBank, long merchantPayoutsNotInBankAmount,
                           int unknownCredits, int unknownDebits, long atGateway, long escrowBooks, Long escrowBank, LocalDate statementTo, List<Problem> exceptions) {}

    private final JdbcClient jdbc;
    private final Ledger ledger;
    private final AuditService audit;
    private final Clock clock;

    Escrow(JdbcClient jdbc, Ledger ledger, AuditService audit, Clock clock) {
        this.jdbc = jdbc;
        this.ledger = ledger;
        this.audit = audit;
        this.clock = clock;
    }

    // ---------- parsing ----------
    private record Sheet(List<String> header, List<List<String>> rows, List<Integer> lineNos) {}

    private static Sheet sheet(String csv) {
        if (csv == null || csv.isBlank()) throw ApiException.badRequest("file", "The file is empty.");
        String[] lines = csv.replace("\r", "").replace("﻿", "").split("\n");
        int at = 0;
        while (at < lines.length && lines[at].isBlank()) at++;
        if (at >= lines.length) throw ApiException.badRequest("file", "The file is empty.");
        if (lines.length - at - 1 > MAX_ROWS) throw ApiException.badRequest("file", "That file has more than " + MAX_ROWS + " rows. Split it by date.");
        List<List<String>> rows = new ArrayList<>();
        List<Integer> nos = new ArrayList<>();
        for (int i = at + 1; i < lines.length; i++) {
            if (lines[i].isBlank()) continue;
            rows.add(Reconciliation.cells(lines[i]));
            nos.add(i + 1);
        }
        return new Sheet(Reconciliation.cells(lines[at]), rows, nos);
    }

    private static String cell(List<String> row, int col) { return col >= 0 && col < row.size() ? row.get(col).trim() : ""; }

    /** Rupees ("1,234.50", "₹620") to paise; blank is 0. */
    private static long paise(String raw, int line) {
        String s = raw.replaceFirst("^'", "").replace(",", "").replace("₹", "").replace("INR", "").replace("Rs.", "").replace("Rs", "").trim();
        if (s.isEmpty() || s.equals("-")) return 0;
        try {
            return new BigDecimal(s).movePointRight(2).setScale(0, java.math.RoundingMode.HALF_UP).longValueExact();
        } catch (RuntimeException e) {
            throw ApiException.badRequest("row", "Line " + line + ": “" + raw + "” isn’t an amount in rupees.");
        }
    }

    private static final List<DateTimeFormatter> DATES = List.of(DateTimeFormatter.ISO_LOCAL_DATE, DateTimeFormatter.ofPattern("dd/MM/yyyy"), DateTimeFormatter.ofPattern("dd-MM-yyyy"),
            DateTimeFormatter.ofPattern("dd/MM/yy"), DateTimeFormatter.ofPattern("dd-MM-yy"), DateTimeFormatter.ofPattern("d/M/yyyy"),
            new DateTimeFormatterBuilder().parseCaseInsensitive().appendPattern("dd-MMM-yyyy").toFormatter(Locale.ENGLISH),
            new DateTimeFormatterBuilder().parseCaseInsensitive().appendPattern("dd MMM yyyy").toFormatter(Locale.ENGLISH));

    private static LocalDate date(String raw, int line) {
        String s = raw.trim();
        if (s.length() > 10 && s.charAt(4) == '-') s = s.substring(0, 10); // 2026-11-13T10:00:00
        for (DateTimeFormatter f : DATES) {
            try { return LocalDate.parse(s, f); } catch (RuntimeException ignored) { /* next format */ }
        }
        throw ApiException.badRequest("row", "Line " + line + ": “" + raw + "” isn’t a date. Use 2026-11-13 or 13/11/2026.");
    }

    // ---------- 1. the gateway's settlement report ----------
    /**
     * Columns (any order, common names accepted): settlement_id, utr, settled_on, type (payment / refund / adjustment), the payment
     * (reference = VIBE's transaction ID, order_id or payment_id = the gateway's), amount, fee and tax in rupees.
     */
    @Transactional
    public GatewayImport importGatewayReport(StaffPrincipal who, String fileName, String csv) {
        Sheet s = sheet(csv);
        int sid = Reconciliation.col(s.header(), "settlementid", "settlement", "payoutid", "setlid");
        int utr = Reconciliation.col(s.header(), "utr", "settlementutr", "bankreference", "bankutr");
        int on = Reconciliation.col(s.header(), "settledon", "settledat", "settlementdate", "date");
        int type = Reconciliation.col(s.header(), "type", "entitytype", "transactiontype");
        int ref = Reconciliation.col(s.header(), "reference", "vibereference", "merchantreference", "vibeid");
        int oid = Reconciliation.col(s.header(), "orderid", "providerorderid");
        int pid = Reconciliation.col(s.header(), "paymentid", "entityid", "providerpaymentid", "transactionid");
        int amt = Reconciliation.col(s.header(), "amount", "grossamount", "amountrs", "amountinr");
        int fee = Reconciliation.col(s.header(), "fee", "fees", "gatewayfee", "mdr");
        int tax = Reconciliation.col(s.header(), "tax", "gst", "taxonfee", "gstonfee");
        if (sid < 0) throw ApiException.badRequest("columns", "The report needs a settlement_id column: the gateway’s id for each payout.");
        if (ref < 0 && oid < 0 && pid < 0) throw ApiException.badRequest("columns", "The report needs a column for the payment: reference (VIBE’s), order_id or payment_id (the gateway’s).");
        if (amt < 0) throw ApiException.badRequest("columns", "The report needs an amount column, in rupees.");

        Map<String, List<Integer>> groups = new LinkedHashMap<>();
        for (int i = 0; i < s.rows().size(); i++) {
            String g = cell(s.rows().get(i), sid);
            if (g.isEmpty()) throw ApiException.badRequest("row", "Line " + s.lineNos().get(i) + " has no settlement id.");
            groups.computeIfAbsent(g, k -> new ArrayList<>()).add(i);
        }
        List<GatewayPayout> imported = new ArrayList<>();
        int skipped = 0, lines = 0, matched = 0, problems = 0;
        long netTotal = 0;
        for (var g : groups.entrySet()) {
            if (jdbc.sql("select count(*) from gateway_settlements where provider_settlement_id = :p").param("p", g.getKey()).query(Integer.class).single() > 0) { skipped++; continue; }
            UUID id = UUID.randomUUID();
            List<Object[]> items = new ArrayList<>();
            long pay = 0, refunds = 0, fees = 0, taxes = 0;
            int bad = 0;
            String payoutUtr = "";
            LocalDate settled = null;
            List<UUID> settledPayments = new ArrayList<>();
            for (int i : g.getValue()) {
                List<String> row = s.rows().get(i);
                int line = s.lineNos().get(i);
                if (payoutUtr.isEmpty()) payoutUtr = cell(row, utr);
                if (settled == null && !cell(row, on).isEmpty()) settled = date(cell(row, on), line);
                String t = cell(row, type).toLowerCase(Locale.ROOT);
                String kind = t.contains("refund") ? "refund" : t.contains("adjust") ? "adjustment" : "payment";
                long a = Math.abs(paise(cell(row, amt), line)), f = paise(cell(row, fee), line), x = paise(cell(row, tax), line);
                String r = cell(row, ref), o = cell(row, oid), p = cell(row, pid);
                String key = !r.isEmpty() ? r : !o.isEmpty() ? o : p;
                fees += f;
                taxes += x;
                if ("adjustment".equals(kind)) {
                    fees += a; // a charge or correction the gateway made; counted with its charges
                    items.add(new Object[]{line, kind, key.isEmpty() ? "adjustment" : key, null, a, f, x, "matched"});
                    matched++;
                    continue;
                }
                var vp = jdbc.sql("select id, amount, status, gateway_settlement_id, refund_status from payments where (:r <> '' and reference = :r) or (:o <> '' and provider_order_id = :o) or (:p <> '' and provider_payment_id = :p) limit 1")
                        .param("r", r).param("o", o).param("p", p)
                        .query((rs, n) -> new Object[]{rs.getObject(1, UUID.class), rs.getLong(2), rs.getString(3), rs.getObject(4, UUID.class), rs.getString(5)}).optional();
                String result;
                UUID paymentId = null;
                if (vp.isEmpty()) result = "unknown";
                else {
                    paymentId = (UUID) vp.get()[0];
                    long vibeAmount = (Long) vp.get()[1];
                    if ("refund".equals(kind)) result = vp.get()[4] == null ? "status_mismatch" : a > vibeAmount ? "amount_mismatch" : "matched";
                    else if (vp.get()[3] != null || settledPayments.contains(paymentId)) result = "duplicate"; // already in another gateway payout: the gateway counted it twice
                    else if (!"verified".equals(vp.get()[2])) result = "status_mismatch";
                    else if (a != vibeAmount) result = "amount_mismatch";
                    else {
                        result = "matched";
                        settledPayments.add(paymentId);
                    }
                }
                if ("refund".equals(kind)) refunds += a; else pay += a;
                if ("matched".equals(result)) matched++; else bad++;
                items.add(new Object[]{line, kind, key, paymentId, a, f, x, result});
            }
            long net = pay - refunds - fees - taxes;
            jdbc.sql("insert into gateway_settlements (id, provider_settlement_id, utr, settled_on, payments_amount, refunds_amount, fees, tax, net, line_count, problems, file_name, imported_by) "
                            + "values (:id, :p, :u, :d, :pay, :ref, :f, :t, :n, :c, :b, :fn, :by)")
                    .param("id", id).param("p", g.getKey()).param("u", payoutUtr).param("d", settled == null ? LocalDate.now(clock.withZone(IST)) : settled).param("pay", pay).param("ref", refunds)
                    .param("f", fees).param("t", taxes).param("n", net).param("c", items.size()).param("b", bad).param("fn", name(fileName)).param("by", who.id()).update();
            for (Object[] it : items) {
                jdbc.sql("insert into gateway_settlement_items (settlement_id, line_no, type, key, payment_id, amount, fee, tax, result) values (:s, :l, :t, :k, :p, :a, :f, :x, :r)")
                        .param("s", id).param("l", it[0]).param("t", it[1]).param("k", it[2]).param("p", it[3], java.sql.Types.OTHER).param("a", it[4]).param("f", it[5]).param("x", it[6]).param("r", it[7]).update();
            }
            for (UUID p : settledPayments) jdbc.sql("update payments set gateway_settlement_id = :s where id = :p and gateway_settlement_id is null").param("s", id).param("p", p).update();
            // The gateway moved the money to the escrow account and kept its charges (VIBE's cost; the GST on them can be claimed back).
            ledger.post("gateway_payout", "gateway_settlement", g.getKey(), "Gateway payout " + g.getKey() + (payoutUtr.isEmpty() ? "" : ", UTR " + payoutUtr),
                    List.of(Ledger.Line.dr("escrow_bank", net), Ledger.Line.dr("gateway_charges", fees), Ledger.Line.dr("gst_input", taxes), Ledger.Line.cr("gateway", pay - refunds)));
            lines += items.size();
            problems += bad;
            netTotal += net;
            imported.add(payout(id));
        }
        audit.record(who, "import", "gateway_report", null, name(fileName) + ": " + imported.size() + " payouts, " + problems + " lines to look at");
        return new GatewayImport(imported.size(), skipped, lines, matched, problems, netTotal, imported);
    }

    private static String name(String f) { return f == null || f.isBlank() ? "pasted.csv" : f.trim(); }

    private static final String PAYOUT_SELECT = "select g.*, bl.value_date bank_date from gateway_settlements g left join bank_lines bl on bl.id = g.bank_line_id";

    private GatewayPayout payout(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new GatewayPayout(rs.getString("id"), rs.getString("provider_settlement_id"), rs.getString("utr"), rs.getObject("settled_on", LocalDate.class), rs.getLong("payments_amount"),
                rs.getLong("refunds_amount"), rs.getLong("fees"), rs.getLong("tax"), rs.getLong("net"), rs.getInt("line_count"), rs.getInt("problems"), rs.getString("status"),
                rs.getObject("bank_date", LocalDate.class), rs.getString("file_name"), rs.getObject("imported_at", OffsetDateTime.class));
    }

    private GatewayPayout payout(UUID id) { return jdbc.sql(PAYOUT_SELECT + " where g.id = :id").param("id", id).query((rs, i) -> payout(rs)).single(); }

    public List<GatewayPayout> payouts() { return jdbc.sql(PAYOUT_SELECT + " order by g.settled_on desc, g.imported_at desc limit 500").query((rs, i) -> payout(rs)).list(); }

    public GatewayPayoutDetail payoutDetail(UUID id) {
        GatewayPayout p = jdbc.sql(PAYOUT_SELECT + " where g.id = :id").param("id", id).query((rs, i) -> payout(rs)).optional().orElseThrow(() -> ApiException.notFound("Gateway payout not found."));
        List<GatewayLine> lines = jdbc.sql("select i.line_no, i.type, i.key, p.reference, i.amount, i.fee, i.tax, p.amount vamt, i.result from gateway_settlement_items i left join payments p on p.id = i.payment_id "
                        + "where i.settlement_id = :id order by (i.result = 'matched'), i.line_no").param("id", id)
                .query((rs, i) -> new GatewayLine(rs.getInt(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getLong(5), rs.getLong(6), rs.getLong(7), rs.getObject(8, Long.class), rs.getString(9))).list();
        return new GatewayPayoutDetail(p, lines);
    }

    // ---------- 2 and 3. the escrow account's bank statement ----------
    /** Columns: date, narration (description), reference (UTR / ref no), and either debit and credit or amount with a CR/DR type; balance if the bank gives it. */
    @Transactional
    public BankImport importBankStatement(StaffPrincipal who, String fileName, String csv) {
        Sheet s = sheet(csv);
        int dt = Reconciliation.col(s.header(), "date", "valuedate", "txndate", "transactiondate", "postingdate", "tranDate".toLowerCase());
        int nar = Reconciliation.col(s.header(), "narration", "description", "particulars", "remarks", "details");
        int ref = Reconciliation.col(s.header(), "reference", "utr", "refno", "referenceno", "chequeno", "chqrefno", "chqno", "transactionreference");
        int dr = Reconciliation.col(s.header(), "debit", "withdrawal", "withdrawalamt", "withdrawals", "dr", "debitamount");
        int cr = Reconciliation.col(s.header(), "credit", "deposit", "depositamt", "deposits", "cr", "creditamount");
        int amt = Reconciliation.col(s.header(), "amount", "amountrs", "transactionamount");
        int typ = Reconciliation.col(s.header(), "type", "crdr", "drcr", "transactiontype");
        int bal = Reconciliation.col(s.header(), "balance", "closingbalance", "runningbalance");
        if (dt < 0) throw ApiException.badRequest("columns", "The statement needs a date column.");
        if ((dr < 0 || cr < 0) && (amt < 0 || typ < 0)) throw ApiException.badRequest("columns", "The statement needs debit and credit columns, or an amount with a CR/DR type.");

        UUID statement = UUID.randomUUID();
        jdbc.sql("insert into bank_statements (id, file_name, line_count, new_lines, matched, unmatched, imported_by) values (:id, :fn, 0, 0, 0, 0, :by)").param("id", statement).param("fn", name(fileName)).param("by", who.id()).update();
        int total = 0, fresh = 0, matched = 0, unmatched = 0;
        LocalDate lo = null, hi = null;
        Long closing = null;
        for (int i = 0; i < s.rows().size(); i++) {
            List<String> row = s.rows().get(i);
            int line = s.lineNos().get(i);
            LocalDate d = date(cell(row, dt), line);
            long credit, debit;
            if (dr >= 0 && cr >= 0) {
                credit = Math.abs(paise(cell(row, cr), line));
                debit = Math.abs(paise(cell(row, dr), line));
            } else {
                long a = Math.abs(paise(cell(row, amt), line));
                boolean isCredit = cell(row, typ).toUpperCase(Locale.ROOT).startsWith("C");
                credit = isCredit ? a : 0;
                debit = isCredit ? 0 : a;
            }
            if ((credit > 0) == (debit > 0)) continue; // a line with no money, or both: a heading or a subtotal, not a transaction
            total++;
            lo = lo == null || d.isBefore(lo) ? d : lo;
            hi = hi == null || d.isAfter(hi) ? d : hi;
            if (bal >= 0 && !cell(row, bal).isEmpty()) closing = paise(cell(row, bal), line);
            String narration = cell(row, nar), reference = cell(row, ref);
            UUID id = UUID.randomUUID();
            int added = jdbc.sql("insert into bank_lines (id, statement_id, line_no, value_date, narration, reference, credit, debit, balance, result) values (:id, :s, :l, :d, :n, :r, :c, :db, :b, 'unknown') on conflict do nothing")
                    .param("id", id).param("s", statement).param("l", line).param("d", d).param("n", narration).param("r", reference).param("c", credit).param("db", debit)
                    .param("b", bal >= 0 && !cell(row, bal).isEmpty() ? paise(cell(row, bal), line) : null, java.sql.Types.BIGINT).update();
            if (added == 0) continue; // already uploaded in an earlier statement
            fresh++;
            String result = credit > 0 ? matchCredit(id, d, narration, reference, credit) : matchDebit(id, narration, reference, debit);
            if ("gateway_payout".equals(result) || "merchant_payout".equals(result)) matched++; else unmatched++;
        }
        jdbc.sql("update bank_statements set period_from = :f, period_to = :t, closing_balance = :c, line_count = :n, new_lines = :nn, matched = :m, unmatched = :u where id = :id")
                .param("f", lo, java.sql.Types.DATE).param("t", hi, java.sql.Types.DATE).param("c", closing, java.sql.Types.BIGINT).param("n", total).param("nn", fresh).param("m", matched).param("u", unmatched).param("id", statement).update();
        audit.record(who, "import", "bank_statement", statement, name(fileName) + ": " + fresh + " new lines, " + matched + " matched, " + unmatched + " to look at");
        return new BankImport(statement.toString(), total, fresh, total - fresh, matched, unmatched, closing);
    }

    /** Check 2: a credit is a gateway payout: by its UTR, or failing that the same amount within a few days of the payout date. */
    private String matchCredit(UUID line, LocalDate d, String narration, String reference, long credit) {
        var byUtr = jdbc.sql("select id, net from gateway_settlements where status = 'awaiting_bank' and utr <> '' and (upper(utr) = upper(:r) or position(upper(utr) in upper(:n)) > 0) order by settled_on limit 1")
                .param("r", reference).param("n", narration).query((rs, i) -> new Object[]{rs.getObject(1, UUID.class), rs.getLong(2)}).optional();
        var match = byUtr.isPresent() ? byUtr : jdbc.sql("select id, net from gateway_settlements where status = 'awaiting_bank' and net = :a and settled_on between :f and :t order by settled_on limit 1")
                .param("a", credit).param("f", d.minusDays(GRACE_DAYS)).param("t", d.plusDays(1)).query((rs, i) -> new Object[]{rs.getObject(1, UUID.class), rs.getLong(2)}).optional();
        if (match.isEmpty()) return "unknown";
        UUID g = (UUID) match.get()[0];
        boolean same = (Long) match.get()[1] == credit;
        String result = same ? "gateway_payout" : "amount_mismatch";
        jdbc.sql("update bank_lines set result = :r, gateway_settlement_id = :g where id = :id").param("r", result).param("g", g).param("id", line).update();
        jdbc.sql("update gateway_settlements set status = :s, bank_line_id = :l where id = :g").param("s", same ? "matched" : "amount_mismatch").param("l", line).param("g", g).update();
        return result;
    }

    /** Check 3: a debit is a payout VIBE marked as paid to a business, found by the bank reference entered when it was marked paid. */
    private String matchDebit(UUID line, String narration, String reference, long debit) {
        var m = jdbc.sql("select id, payout from settlements where status = 'paid' and bank_line_id is null and coalesce(payout_ref, '') <> '' "
                        + "and (upper(payout_ref) = upper(:r) or position(upper(payout_ref) in upper(:n)) > 0) order by paid_at limit 1")
                .param("r", reference).param("n", narration).query((rs, i) -> new Object[]{rs.getObject(1, UUID.class), rs.getLong(2)}).optional();
        if (m.isEmpty()) return "unknown";
        UUID s = (UUID) m.get()[0];
        String result = (Long) m.get()[1] == debit ? "merchant_payout" : "amount_mismatch";
        jdbc.sql("update bank_lines set result = :r, settlement_id = :s where id = :id").param("r", result).param("s", s).param("id", line).update();
        if ("merchant_payout".equals(result)) jdbc.sql("update settlements set bank_line_id = :l where id = :s").param("l", line).param("s", s).update();
        return result;
    }

    private static final String LINE_SELECT = "select bl.*, g.provider_settlement_id gp, s.reference sref, b.name bname from bank_lines bl left join gateway_settlements g on g.id = bl.gateway_settlement_id "
            + "left join settlements s on s.id = bl.settlement_id left join businesses b on b.id = s.business_id";

    private static BankLine line(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new BankLine(rs.getString("id"), rs.getObject("value_date", LocalDate.class), rs.getString("narration"), rs.getString("reference"), rs.getLong("credit"), rs.getLong("debit"),
                rs.getString("result"), rs.getString("gp"), rs.getString("sref"), rs.getString("bname"), rs.getString("note"));
    }

    /** problems: only lines that didn't match and haven't been explained. */
    public List<BankLine> bankLines(boolean problems) {
        return jdbc.sql(LINE_SELECT + (problems ? " where bl.result in ('unknown', 'amount_mismatch')" : "") + " order by bl.value_date desc, bl.line_no desc limit 1000").query((rs, i) -> line(rs)).list();
    }

    /** A bank line that isn't a gateway payout or a payout to a business (bank charges, VIBE moving its own income out...) is explained with a note. */
    @Transactional
    public BankLine explain(StaffPrincipal who, UUID id, String note) {
        if (note == null || note.trim().length() < 3) throw ApiException.badRequest("note", "Say what this line is, for example “Bank charges” or “VIBE commission moved to the operating account”.");
        int n = jdbc.sql("update bank_lines set result = 'explained', note = :n, explained_by = :by, explained_at = now() where id = :id and result in ('unknown', 'amount_mismatch')")
                .param("n", note.trim()).param("by", who.id()).param("id", id).update();
        if (n == 0) throw ApiException.conflict("not_open", "This line is already matched or explained.");
        audit.record(who, "explain", "bank_line", id, note.trim());
        return jdbc.sql(LINE_SELECT + " where bl.id = :id").param("id", id).query((rs, i) -> line(rs)).single();
    }

    // ---------- the three checks at a glance ----------
    public Overview overview() {
        OffsetDateTime now = OffsetDateTime.now(clock), old = now.minusDays(GRACE_DAYS);
        Object[] c1 = jdbc.sql("select count(*), coalesce(sum(amount), 0), min(verified_at) from payments where status = 'verified' and gateway_settlement_id is null")
                .query((rs, i) -> new Object[]{rs.getInt(1), rs.getLong(2), rs.getObject(3, OffsetDateTime.class)}).single();
        int lineProblems = count("select count(*) from gateway_settlement_items where result <> 'matched'");
        Object[] c2 = jdbc.sql("select count(*) filter (where status = 'awaiting_bank'), coalesce(sum(net) filter (where status = 'awaiting_bank'), 0), count(*) filter (where status = 'matched'), "
                + "count(*) filter (where status = 'amount_mismatch') from gateway_settlements").query((rs, i) -> new Object[]{rs.getInt(1), rs.getLong(2), rs.getInt(3), rs.getInt(4)}).single();
        Object[] c3 = jdbc.sql("select count(*), count(bank_line_id), count(*) filter (where bank_line_id is null), coalesce(sum(payout) filter (where bank_line_id is null), 0) from settlements where status = 'paid'")
                .query((rs, i) -> new Object[]{rs.getInt(1), rs.getInt(2), rs.getInt(3), rs.getLong(4)}).single();
        int unknownCredits = count("select count(*) from bank_lines where result in ('unknown', 'amount_mismatch') and credit > 0");
        int unknownDebits = count("select count(*) from bank_lines where result in ('unknown', 'amount_mismatch') and debit > 0");
        long atGateway = balance("gateway"), escrow = balance("escrow_bank");
        Object[] last = jdbc.sql("select closing_balance, period_to from bank_statements where closing_balance is not null order by period_to desc nulls last, imported_at desc limit 1")
                .query((rs, i) -> new Object[]{rs.getLong(1), rs.getObject(2, LocalDate.class)}).optional().orElse(new Object[]{null, null});

        List<Problem> ex = new ArrayList<>();
        jdbc.sql("select p.reference, p.amount, p.verified_at, coalesce(b.name, 'VIBE') from payments p join payment_requests pr on pr.id = p.payment_request_id left join businesses b on b.id = pr.business_id "
                        + "where p.status = 'verified' and p.gateway_settlement_id is null and p.verified_at < :o order by p.verified_at limit 100").param("o", old)
                .query((rs, i) -> ex.add(new Problem("not_in_gateway_payout", rs.getString(1), "Customer paid " + rs.getString(4) + "; no gateway payout includes it after " + GRACE_DAYS + " days",
                        rs.getLong(2), rs.getObject(3, OffsetDateTime.class), null))).list();
        jdbc.sql("select g.provider_settlement_id, i.key, i.result, i.amount, g.imported_at from gateway_settlement_items i join gateway_settlements g on g.id = i.settlement_id where i.result <> 'matched' order by g.imported_at desc limit 100")
                .query((rs, i) -> ex.add(new Problem("gateway_line_" + rs.getString(3), rs.getString(2), describe(rs.getString(3)) + " (gateway payout " + rs.getString(1) + ")", rs.getLong(4),
                        rs.getObject(5, OffsetDateTime.class), null))).list();
        jdbc.sql("select provider_settlement_id, utr, net, settled_on, status from gateway_settlements where status = 'amount_mismatch' or (status = 'awaiting_bank' and settled_on < :d) order by settled_on limit 100")
                .param("d", LocalDate.now(clock.withZone(IST)).minusDays(GRACE_DAYS))
                .query((rs, i) -> ex.add(new Problem("amount_mismatch".equals(rs.getString(5)) ? "gateway_payout_amount" : "gateway_payout_not_in_bank", rs.getString(1),
                        ("amount_mismatch".equals(rs.getString(5)) ? "Arrived in the escrow account with a different amount" : "Not seen in the escrow account") + (rs.getString(2) == null || rs.getString(2).isBlank() ? "" : " · UTR " + rs.getString(2)),
                        rs.getLong(3), rs.getObject(4, LocalDate.class).atStartOfDay(IST).toOffsetDateTime(), null))).list();
        jdbc.sql("select s.reference, b.name, s.payout, s.paid_at, s.payout_ref from settlements s join businesses b on b.id = s.business_id where s.status = 'paid' and s.bank_line_id is null and s.paid_at < :o order by s.paid_at limit 100")
                .param("o", old)
                .query((rs, i) -> ex.add(new Problem("merchant_payout_not_in_bank", rs.getString(1), "Marked paid to " + rs.getString(2) + " (bank ref " + rs.getString(5) + ") but not seen leaving the escrow account",
                        rs.getLong(3), rs.getObject(4, OffsetDateTime.class), null))).list();
        jdbc.sql("select id, value_date, narration, reference, credit, debit, result from bank_lines where result in ('unknown', 'amount_mismatch') order by value_date limit 200")
                .query((rs, i) -> ex.add(new Problem(rs.getLong(5) > 0 ? "bank_credit_unknown" : "bank_debit_unknown", rs.getString(4).isBlank() ? rs.getString(3) : rs.getString(4),
                        ("amount_mismatch".equals(rs.getString(7)) ? "Amount differs from what VIBE expected: " : rs.getLong(5) > 0 ? "Money in that VIBE can’t match: " : "Money out that VIBE can’t match: ") + rs.getString(3),
                        rs.getLong(5) > 0 ? rs.getLong(5) : rs.getLong(6), rs.getObject(2, LocalDate.class).atStartOfDay(IST).toOffsetDateTime(), rs.getString(1)))).list();

        return new Overview((Integer) c1[0], (Long) c1[1], (OffsetDateTime) c1[2], lineProblems, (Integer) c2[0], (Long) c2[1], (Integer) c2[2], (Integer) c2[3],
                (Integer) c3[0], (Integer) c3[1], (Integer) c3[2], (Long) c3[3], unknownCredits, unknownDebits, atGateway, escrow, (Long) last[0], (LocalDate) last[1], ex);
    }

    private static String describe(String result) {
        return switch (result) {
            case "unknown" -> "The gateway has a payment VIBE doesn’t know";
            case "duplicate" -> "The gateway paid out this payment twice";
            case "status_mismatch" -> "VIBE doesn’t have this payment as paid (or refunded)";
            case "amount_mismatch" -> "The gateway’s amount differs from VIBE’s";
            default -> result;
        };
    }

    private int count(String sql) { return jdbc.sql(sql).query(Integer.class).single(); }

    private long balance(String account) { return jdbc.sql("select coalesce(sum(debit) - sum(credit), 0) from ledger_entries where account = :a").param("a", account).query(Long.class).single(); }

    public ResponseEntity<byte[]> exceptionsCsv() {
        Overview o = overview();
        Csv csv = new Csv().row("VIBE money checks", "as of " + LocalDate.now(clock.withZone(IST))).row()
                .row("1. Customer payments not yet in a gateway payout", o.awaitingGatewayCount(), Csv.rupees(o.awaitingGatewayAmount()))
                .row("2. Gateway payouts not yet in the escrow account", o.payoutsAwaitingBank(), Csv.rupees(o.payoutsAwaitingBankAmount()))
                .row("3. Payouts to businesses not seen leaving the escrow account", o.merchantPayoutsNotInBank(), Csv.rupees(o.merchantPayoutsNotInBankAmount()))
                .row("Escrow account by VIBE's books (Rs)", Csv.rupees(o.escrowBooks())).row("Escrow account by the bank (Rs)", o.escrowBank() == null ? "" : Csv.rupees(o.escrowBank())).row()
                .row("What", "Reference", "Detail", "Amount (Rs)", "Since");
        for (Problem e : o.exceptions()) csv.row(e.kind(), e.reference(), e.detail(), Csv.rupees(e.amount()), e.since() == null ? "" : e.since().atZoneSameInstant(IST).toLocalDate());
        return csv.download("vibe-money-checks-" + LocalDate.now(clock.withZone(IST)) + ".csv");
    }
}
