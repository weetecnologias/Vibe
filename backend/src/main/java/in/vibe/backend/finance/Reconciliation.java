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
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

/**
 * Reconciliation: the payment partner sends a settlement file (every payment it took), and VIBE checks it against its own records. For each line:
 * matched, a different amount, a different status, or not known to VIBE; and every VIBE payment in the period that the file doesn't have. The
 * file needs a header with a column for the VIBE reference or the partner's payment id, an amount in rupees, and optionally a status. Every run and
 * every difference is kept, so nothing is lost between what customers paid and what the bank received.
 */
@Service
public class Reconciliation {
    public record Run(String id, String fileName, LocalDate from, LocalDate to, String uploadedBy, OffsetDateTime uploadedAt, int partnerRows, int matched, int mismatched, int missingInVibe,
                      int missingAtPartner, long partnerAmount, long vibeAmount) {}

    public record Item(int line, String key, String result, Long partnerAmount, Long vibeAmount, String partnerStatus, String paymentReference) {}

    public record Detail(Run run, List<Item> items) {}

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final int MAX_ROWS = 20_000;

    private final JdbcClient jdbc;
    private final AuditService audit;

    Reconciliation(JdbcClient jdbc, AuditService audit) {
        this.jdbc = jdbc;
        this.audit = audit;
    }

    /** One CSV line into cells, with quotes and doubled quotes handled. */
    static List<String> cells(String line) {
        List<String> out = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        boolean quoted = false;
        for (int i = 0; i < line.length(); i++) {
            char ch = line.charAt(i);
            if (quoted) {
                if (ch == '"' && i + 1 < line.length() && line.charAt(i + 1) == '"') { cur.append('"'); i++; }
                else if (ch == '"') quoted = false;
                else cur.append(ch);
            } else if (ch == '"') quoted = true;
            else if (ch == ',') { out.add(cur.toString().trim()); cur.setLength(0); }
            else cur.append(ch);
        }
        out.add(cur.toString().trim());
        return out;
    }

    private static int col(List<String> header, String... names) {
        for (int i = 0; i < header.size(); i++) {
            String h = header.get(i).toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
            for (String n : names) if (h.equals(n)) return i;
        }
        return -1;
    }

    private static String normalise(String status) {
        String s = status == null ? "" : status.toLowerCase(Locale.ROOT).trim();
        if (List.of("captured", "success", "successful", "paid", "verified", "settled", "authorized", "authorised", "").contains(s)) return "verified";
        if (List.of("failed", "failure", "declined", "cancelled", "canceled").contains(s)) return "failed";
        return s;
    }

    @Transactional
    public Detail run(StaffPrincipal who, String fileName, String csv, LocalDate from, LocalDate to) {
        if (csv == null || csv.isBlank()) throw ApiException.badRequest("file", "The file is empty.");
        String[] lines = csv.replace("\r", "").split("\n");
        int headerAt = 0;
        while (headerAt < lines.length && lines[headerAt].isBlank()) headerAt++;
        if (headerAt >= lines.length) throw ApiException.badRequest("file", "The file is empty.");
        List<String> header = cells(lines[headerAt]);
        int ref = col(header, "reference", "vibereference", "vibeid", "orderid", "merchantreference"), pid = col(header, "providerpaymentid", "paymentid", "partnerpaymentid", "transactionid", "utr"), amt = col(header, "amount", "amountrs", "amountinr", "grossamount");
        int status = col(header, "status", "paymentstatus");
        if (ref < 0 && pid < 0) throw ApiException.badRequest("columns", "The file needs a column named reference (VIBE’s) or payment_id (the partner’s).");
        if (amt < 0) throw ApiException.badRequest("columns", "The file needs an amount column, in rupees.");
        if (lines.length - headerAt - 1 > MAX_ROWS) throw ApiException.badRequest("file", "That file has more than " + MAX_ROWS + " rows. Split it by date.");

        UUID runId = UUID.randomUUID();
        List<Item> items = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        long partnerTotal = 0, vibeTotal = 0;
        int matched = 0, mismatched = 0, missingVibe = 0, rows = 0;
        OffsetDateTime lo = null, hi = null;
        for (int i = headerAt + 1; i < lines.length; i++) {
            if (lines[i].isBlank()) continue;
            List<String> c = cells(lines[i]);
            String key = (ref >= 0 && ref < c.size() && !c.get(ref).isBlank()) ? c.get(ref) : (pid >= 0 && pid < c.size() ? c.get(pid) : "");
            if (key.isBlank()) throw ApiException.badRequest("row", "Line " + (i + 1) + " has no reference or payment id.");
            long partnerAmount;
            try { partnerAmount = new BigDecimal(c.get(amt).replace(",", "").replace("₹", "").trim()).movePointRight(2).longValueExact(); }
            catch (RuntimeException e) { throw ApiException.badRequest("row", "Line " + (i + 1) + ": the amount isn’t a number of rupees."); }
            String pStatus = status >= 0 && status < c.size() ? normalise(c.get(status)) : "verified";
            rows++;
            if (!seen.add(key)) { items.add(new Item(i + 1, key, "amount_mismatch", partnerAmount, null, pStatus, null)); mismatched++; continue; } // listed twice by the partner
            var vp = jdbc.sql("select reference, amount, status, verified_at from payments where reference = :k or provider_payment_id = :k").param("k", key)
                    .query((rs, j) -> new Object[]{rs.getString(1), rs.getLong(2), rs.getString(3), rs.getObject(4, OffsetDateTime.class)}).optional();
            if (vp.isEmpty()) { items.add(new Item(i + 1, key, "missing_in_vibe", partnerAmount, null, pStatus, null)); missingVibe++; if ("verified".equals(pStatus)) partnerTotal += partnerAmount; continue; }
            String vref = (String) vp.get()[0];
            long vamount = (Long) vp.get()[1];
            String vstatus = (String) vp.get()[2];
            OffsetDateTime vat = (OffsetDateTime) vp.get()[3];
            seen.add(vref);
            if ("verified".equals(pStatus)) partnerTotal += partnerAmount;
            if ("verified".equals(vstatus)) vibeTotal += vamount;
            if (vat != null) { lo = lo == null || vat.isBefore(lo) ? vat : lo; hi = hi == null || vat.isAfter(hi) ? vat : hi; }
            String result = !pStatus.equals(vstatus) && !(("refunded".equals(pStatus)) && "verified".equals(vstatus)) ? "status_mismatch" : partnerAmount != vamount ? "amount_mismatch" : "matched";
            if ("matched".equals(result)) matched++; else mismatched++;
            items.add(new Item(i + 1, key, result, partnerAmount, vamount, pStatus, vref));
        }

        // VIBE payments in the period that the file doesn't have.
        OffsetDateTime f = from != null ? from.atStartOfDay(IST).toOffsetDateTime() : lo, t = to != null ? to.plusDays(1).atStartOfDay(IST).toOffsetDateTime() : hi == null ? null : hi.plusSeconds(1);
        int missingPartner = 0;
        if (f != null && t != null) {
            var ours = jdbc.sql("select reference, provider_payment_id, amount from payments where status = 'verified' and verified_at >= :f and verified_at < :t order by verified_at").param("f", f).param("t", t)
                    .query((rs, j) -> new Object[]{rs.getString(1), rs.getString(2), rs.getLong(3)}).list();
            for (Object[] o : ours) {
                if (seen.contains((String) o[0]) || (o[1] != null && seen.contains((String) o[1]))) continue;
                items.add(new Item(0, (String) o[0], "missing_at_partner", null, (Long) o[2], null, (String) o[0]));
                vibeTotal += (Long) o[2];
                missingPartner++;
            }
        }

        jdbc.sql("insert into reconciliation_runs (id, file_name, period_from, period_to, uploaded_by, partner_rows, matched, mismatched, missing_in_vibe, missing_at_partner, partner_amount, vibe_amount) "
                        + "values (:id, :fn, :f, :t, :by, :n, :m, :mm, :miv, :map, :pa, :va)")
                .param("id", runId).param("fn", fileName == null || fileName.isBlank() ? "pasted.csv" : fileName.trim()).param("f", from).param("t", to).param("by", who.id()).param("n", rows).param("m", matched).param("mm", mismatched)
                .param("miv", missingVibe).param("map", missingPartner).param("pa", partnerTotal).param("va", vibeTotal).update();
        int n = 0;
        for (Item it : items) {
            if ("matched".equals(it.result())) continue; // only differences are kept line by line; matched ones are counted
            jdbc.sql("insert into reconciliation_items (run_id, line_no, key, result, partner_amount, vibe_amount, partner_status, payment_reference) values (:r, :l, :k, :res, :pa, :va, :ps, :pr)")
                    .param("r", runId).param("l", it.line() == 0 ? 100_000 + n++ : it.line()).param("k", it.key()).param("res", it.result()).param("pa", it.partnerAmount()).param("va", it.vibeAmount()).param("ps", it.partnerStatus()).param("pr", it.paymentReference()).update();
        }
        audit.record(who, "reconcile", "reconciliation", runId, (fileName == null ? "file" : fileName) + ": " + matched + " matched, " + (mismatched + missingVibe + missingPartner) + " to look at");
        return detail(runId);
    }

    private Run run(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new Run(rs.getString("id"), rs.getString("file_name"), rs.getObject("period_from", LocalDate.class), rs.getObject("period_to", LocalDate.class), rs.getString("uname"), rs.getObject("uploaded_at", OffsetDateTime.class),
                rs.getInt("partner_rows"), rs.getInt("matched"), rs.getInt("mismatched"), rs.getInt("missing_in_vibe"), rs.getInt("missing_at_partner"), rs.getLong("partner_amount"), rs.getLong("vibe_amount"));
    }

    public List<Run> runs() {
        return jdbc.sql("select r.*, u.name uname from reconciliation_runs r left join staff_users u on u.id = r.uploaded_by order by r.uploaded_at desc limit 100").query((rs, i) -> run(rs)).list();
    }

    public Detail detail(UUID id) {
        Run r = jdbc.sql("select r.*, u.name uname from reconciliation_runs r left join staff_users u on u.id = r.uploaded_by where r.id = :id").param("id", id).query((rs, i) -> run(rs)).optional().orElseThrow(() -> ApiException.notFound("Run not found."));
        List<Item> items = jdbc.sql("select * from reconciliation_items where run_id = :id order by result, line_no").param("id", id)
                .query((rs, i) -> new Item(rs.getInt("line_no") >= 100_000 ? 0 : rs.getInt("line_no"), rs.getString("key"), rs.getString("result"), (Long) rs.getObject("partner_amount"), (Long) rs.getObject("vibe_amount"),
                        rs.getString("partner_status"), rs.getString("payment_reference"))).list();
        return new Detail(r, items);
    }

    public ResponseEntity<byte[]> download(UUID id) {
        Detail d = detail(id);
        Csv csv = new Csv().row("Reconciliation", d.run().fileName(), d.run().uploadedAt()).row("Rows in file", d.run().partnerRows(), "Matched", d.run().matched(), "To look at", d.run().mismatched() + d.run().missingInVibe() + d.run().missingAtPartner()).row();
        csv.row("Result", "Line", "Reference or id", "Partner amount (Rs)", "VIBE amount (Rs)", "Partner status", "VIBE payment");
        for (Item i : d.items()) csv.row(i.result().replace('_', ' '), i.line() == 0 ? "" : i.line(), i.key(), i.partnerAmount() == null ? "" : Csv.rupees(i.partnerAmount()), i.vibeAmount() == null ? "" : Csv.rupees(i.vibeAmount()),
                i.partnerStatus() == null ? "" : i.partnerStatus(), i.paymentReference() == null ? "" : i.paymentReference());
        return csv.download("vibe-reconciliation-" + id.toString().substring(0, 8) + ".csv");
    }
}
