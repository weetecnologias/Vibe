package in.vibe.backend.compliance;

import in.vibe.backend.audit.AuditService;
import in.vibe.backend.common.ApiException;
import in.vibe.backend.notify.StaffNotifications;
import in.vibe.backend.security.StaffPrincipal;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * KYC: who a business legally is and where VIBE pays it. The checks that can be done without a provider are done here (formats, the GSTIN's own
 * check digit, the PAN inside the GSTIN, the bank holder's name against the legal name, FSSAI for food); a person then approves. A business
 * can't be paid out until it is verified, and changing its details sends it back for verification. A provider (penny-drop, PAN and GST lookups)
 * can be added behind {@link #checks} later without changing anything else.
 */
@Service
public class Kyc {
    public record Input(@NotBlank @Size(max = 150) String legalName, @NotBlank @Size(max = 12) String pan, @Size(max = 20) String gstin, @Size(max = 20) String fssai,
                        @NotBlank @Size(max = 150) String bankAccountName, @NotBlank @Size(max = 30) String bankAccountNo, @NotBlank @Size(max = 15) String bankIfsc, @Size(max = 100) String bankName,
                        List<@Size(max = 500) String> documents) {}

    public record Check(String key, String label, boolean ok, String message) {}

    /** status: not_submitted, submitted, verified or rejected. The account number is masked unless the viewer is VIBE. */
    public record View(String businessId, String businessName, String status, boolean fssaiRequired, String legalName, String pan, String gstin, String fssai, String bankAccountName, String bankAccountNo,
                       String bankIfsc, String bankName, List<String> documents, String reviewNote, OffsetDateTime submittedAt, OffsetDateTime reviewedAt, List<Check> checks) {}

    public record Row(String businessId, String businessName, String category, String status, String legalName, OffsetDateTime submittedAt, boolean checksPass) {}

    private static final Pattern PAN = Pattern.compile("^[A-Z]{5}[0-9]{4}[A-Z]$"), GSTIN = Pattern.compile("^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$"), IFSC = Pattern.compile("^[A-Z]{4}0[A-Z0-9]{6}$"),
            ACCOUNT = Pattern.compile("^[0-9]{9,18}$"), FSSAI = Pattern.compile("^[0-9]{14}$");
    private static final String GST_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

    private final JdbcClient jdbc;
    private final AuditService audit;
    private final StaffNotifications staffNotifications;

    Kyc(JdbcClient jdbc, AuditService audit, StaffNotifications staffNotifications) {
        this.jdbc = jdbc;
        this.audit = audit;
        this.staffNotifications = staffNotifications;
    }

    private static String up(String s) { return s == null ? "" : s.trim().toUpperCase(Locale.ROOT).replaceAll("\\s+", ""); }

    /** The GSTIN's last character is a check digit over the first fourteen. */
    static boolean gstinChecksum(String g) {
        int sum = 0;
        for (int i = 0; i < 14; i++) {
            int v = GST_CHARS.indexOf(g.charAt(i)) * (i % 2 == 0 ? 1 : 2);
            sum += v / 36 + v % 36;
        }
        return GST_CHARS.charAt((36 - sum % 36) % 36) == g.charAt(14);
    }

    private static List<String> words(String s) {
        return Arrays.stream(s.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9 ]", " ").split("\\s+")).filter(w -> w.length() > 2 && !List.of("pvt", "ltd", "llp", "private", "limited", "and", "the", "company", "co", "enterprises", "traders").contains(w)).toList();
    }

    /** The automatic checks, in the order a reviewer reads them. Pure: same input, same answer. */
    public static List<Check> checks(Input in, boolean fssaiRequired) {
        List<Check> out = new ArrayList<>();
        String pan = up(in.pan()), gst = up(in.gstin()), fssai = in.fssai() == null ? "" : in.fssai().trim(), ifsc = up(in.bankIfsc()), acct = in.bankAccountNo() == null ? "" : in.bankAccountNo().replaceAll("\\s+", "");
        boolean panOk = PAN.matcher(pan).matches() && "ABCFGHLJPT".indexOf(pan.charAt(3)) >= 0;
        out.add(new Check("pan", "PAN", panOk, panOk ? "Format is valid." : "A PAN looks like ABCDE1234F, and its fourth letter says what kind of holder it is."));
        if (!gst.isEmpty()) {
            boolean fmt = GSTIN.matcher(gst).matches();
            out.add(new Check("gstin", "GSTIN", fmt && gstinChecksum(gst), !fmt ? "A GSTIN has 15 characters, like 36ABCDE1234F1Z5." : gstinChecksum(gst) ? "Format and check digit are valid." : "The check digit doesn’t match: one character is wrong."));
            boolean same = fmt && panOk && gst.substring(2, 12).equals(pan);
            out.add(new Check("gstin_pan", "GSTIN matches PAN", same, same ? "The PAN inside the GSTIN is the same." : "The PAN inside the GSTIN (characters 3 to 12) must be the PAN above."));
        } else {
            out.add(new Check("gstin", "GSTIN", true, "Not given. Only needed if the business is registered for GST."));
        }
        boolean fssaiOk = fssai.isEmpty() ? !fssaiRequired : FSSAI.matcher(fssai).matches();
        out.add(new Check("fssai", "FSSAI licence", fssaiOk, fssai.isEmpty() ? (fssaiRequired ? "Food businesses need a 14-digit FSSAI licence number." : "Not needed for this kind of business.") : fssaiOk ? "Format is valid." : "An FSSAI number has 14 digits."));
        boolean ifscOk = IFSC.matcher(ifsc).matches();
        out.add(new Check("ifsc", "IFSC", ifscOk, ifscOk ? "Format is valid." : "An IFSC looks like HDFC0001234."));
        boolean acctOk = ACCOUNT.matcher(acct).matches();
        out.add(new Check("account", "Account number", acctOk, acctOk ? "Format is valid." : "An account number has 9 to 18 digits."));
        List<String> legal = words(in.legalName() == null ? "" : in.legalName()), holder = words(in.bankAccountName() == null ? "" : in.bankAccountName());
        boolean nameOk = legal.stream().anyMatch(holder::contains);
        out.add(new Check("holder", "Account holder", nameOk, nameOk ? "The account holder’s name shares a word with the legal name." : "The name on the bank account should match the legal name of the business or its owner."));
        return out;
    }

    private boolean fssaiRequired(UUID business) {
        return jdbc.sql("select exists (select 1 from businesses b join categories c on c.id = b.primary_category_id where b.id = :b and (c.slug = 'food' or c.slug like 'food.%'))").param("b", business).query(Boolean.class).single();
    }

    private static String mask(String account) { return account.length() <= 4 ? account : "•".repeat(account.length() - 4) + account.substring(account.length() - 4); }

    private View view(UUID business, boolean full) {
        String name = jdbc.sql("select name from businesses where id = :b").param("b", business).query(String.class).optional().orElseThrow(() -> ApiException.notFound("Business not found."));
        boolean fssaiReq = fssaiRequired(business);
        return jdbc.sql("select * from business_kyc where business_id = :b").param("b", business).query((rs, i) -> {
            Input in = new Input(rs.getString("legal_name"), rs.getString("pan"), rs.getString("gstin"), rs.getString("fssai"), rs.getString("bank_account_name"), rs.getString("bank_account_no"),
                    rs.getString("bank_ifsc"), rs.getString("bank_name"), List.of((String[]) rs.getArray("documents").getArray()));
            return new View(business.toString(), name, rs.getString("status"), fssaiReq, in.legalName(), in.pan(), in.gstin(), in.fssai(), in.bankAccountName(), full ? in.bankAccountNo() : mask(in.bankAccountNo()),
                    in.bankIfsc(), in.bankName(), in.documents(), rs.getString("review_note"), rs.getObject("submitted_at", OffsetDateTime.class), rs.getObject("reviewed_at", OffsetDateTime.class), checks(in, fssaiReq));
        }).optional().orElse(new View(business.toString(), name, "not_submitted", fssaiReq, "", "", "", "", "", "", "", "", List.of(), null, null, null, List.of()));
    }

    /** The business's own view (account number masked). */
    public View mine(UUID business) { return view(business, false); }

    /** VIBE's view. */
    public View get(UUID business) { return view(business, true); }

    public String status(UUID business) {
        return jdbc.sql("select status from business_kyc where business_id = :b").param("b", business).query(String.class).optional().orElse("not_submitted");
    }

    /** Payouts need a verified business. */
    public void requireVerified(UUID business) {
        String s = status(business);
        if (!"verified".equals(s)) throw ApiException.conflict("kyc_required", "This business can’t be paid out yet: its KYC is " + s.replace('_', ' ') + ". Verify it under KYC first.");
    }

    @Transactional
    public View submit(StaffPrincipal who, Input in) {
        UUID business = who.requireBusiness();
        List<Check> checks = checks(in, fssaiRequired(business));
        List<String> failed = checks.stream().filter(c -> !c.ok()).map(Check::label).toList();
        if (!failed.isEmpty()) throw ApiException.badRequest("kyc_invalid", "Please fix: " + String.join(", ", failed) + ".");
        jdbc.sql("""
                insert into business_kyc (business_id, legal_name, pan, gstin, fssai, bank_account_name, bank_account_no, bank_ifsc, bank_name, documents, status, submitted_by)
                values (:b, :ln, :pan, :gst, :fs, :han, :han_no, :ifsc, :bn, :docs, 'submitted', :by)
                on conflict (business_id) do update set legal_name = excluded.legal_name, pan = excluded.pan, gstin = excluded.gstin, fssai = excluded.fssai, bank_account_name = excluded.bank_account_name,
                    bank_account_no = excluded.bank_account_no, bank_ifsc = excluded.bank_ifsc, bank_name = excluded.bank_name, documents = excluded.documents, status = 'submitted', review_note = null,
                    reviewed_at = null, reviewed_by = null, submitted_at = now(), submitted_by = excluded.submitted_by
                """).param("b", business).param("ln", in.legalName().trim()).param("pan", up(in.pan())).param("gst", up(in.gstin()).isEmpty() ? null : up(in.gstin()))
                .param("fs", in.fssai() == null || in.fssai().isBlank() ? null : in.fssai().trim()).param("han", in.bankAccountName().trim()).param("han_no", in.bankAccountNo().replaceAll("\\s+", ""))
                .param("ifsc", up(in.bankIfsc())).param("bn", in.bankName() == null || in.bankName().isBlank() ? null : in.bankName().trim())
                .param("docs", (in.documents() == null ? List.<String>of() : in.documents()).stream().filter(d -> d != null && !d.isBlank()).toArray(String[]::new), java.sql.Types.ARRAY).param("by", who.id()).update();
        audit.record(who, "kyc_submit", "business", business, in.legalName().trim());
        String name = jdbc.sql("select name from businesses where id = :b").param("b", business).query(String.class).single();
        staffNotifications.toAdmins("kyc_review", "KYC waiting for review", name + " sent its legal and bank details.", "/kyc");
        return mine(business);
    }

    // ---------- VIBE ----------
    /** scope: from AdminAccess.businessScope on b.id. Waiting first, oldest first. */
    public List<Row> queue(String status, String scope) {
        return jdbc.sql("select b.id, b.name, c.name cname, k.status, k.legal_name, k.submitted_at, k.bank_ifsc, k.pan from business_kyc k join businesses b on b.id = k.business_id join categories c on c.id = b.primary_category_id where true"
                        + scope + (status == null || status.isBlank() ? "" : " and k.status = :s") + " order by (k.status = 'submitted') desc, k.submitted_at limit 300")
                .param("s", status == null ? "" : status).query((rs, i) -> new Row(rs.getString("id"), rs.getString("name"), rs.getString("cname"), rs.getString("status"), rs.getString("legal_name"),
                        rs.getObject("submitted_at", OffsetDateTime.class), get(UUID.fromString(rs.getString("id"))).checks().stream().allMatch(Check::ok))).list();
    }

    @Transactional
    public View approve(StaffPrincipal who, UUID business) {
        View v = get(business);
        if ("not_submitted".equals(v.status())) throw ApiException.conflict("not_submitted", "This business hasn’t sent its details.");
        if (!v.checks().stream().allMatch(Check::ok)) throw ApiException.conflict("checks_fail", "Some automatic checks fail. Ask the business to correct its details.");
        jdbc.sql("update business_kyc set status = 'verified', review_note = null, reviewed_at = now(), reviewed_by = :by where business_id = :b").param("by", who.id()).param("b", business).update();
        audit.record(who, "kyc_verify", "business", business, v.legalName());
        staffNotifications.toBusiness(business, "kyc_decision", "KYC verified", "Your legal and bank details are verified. VIBE can now pay your settlements to your bank account.", "/kyc");
        return get(business);
    }

    @Transactional
    public View reject(StaffPrincipal who, UUID business, String note) {
        if (note == null || note.isBlank()) throw ApiException.badRequest("note_required", "Tell the business what to correct.");
        if ("not_submitted".equals(status(business))) throw ApiException.conflict("not_submitted", "This business hasn’t sent its details.");
        jdbc.sql("update business_kyc set status = 'rejected', review_note = :n, reviewed_at = now(), reviewed_by = :by where business_id = :b").param("n", note.trim()).param("by", who.id()).param("b", business).update();
        audit.record(who, "kyc_reject", "business", business, note.trim());
        staffNotifications.toBusiness(business, "kyc_decision", "KYC needs changes", note.trim(), "/kyc");
        return get(business);
    }
}
