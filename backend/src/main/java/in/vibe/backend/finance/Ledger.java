package in.vibe.backend.finance;

import in.vibe.backend.common.ApiException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * VIBE's books. Every movement of money is posted as lines that add up to nothing (debits equal credits), in the same database transaction as
 * the thing that moved it, so the books can't drift from the payments. Accounts:
 * <pre>
 * gateway            money held at the payment partner (debit = in, credit = paid out)
 * merchant:{id}      what VIBE owes a business (credit = owed, debit = paid or taken back)
 * vibe_fee_income    VIBE's fee on bookings          commission_income  VIBE's commission
 * gst_payable        GST on VIBE's commission        discount_expense   discounts VIBE funded
 * membership_income  VIBE Membership sales           vibe_event_income  tickets for VIBE-run events
 * refunds_payable    owed back to customers          refund_expense     refunds VIBE absorbs
 * adjustments        manual credits and recoveries
 * </pre>
 */
@Service
public class Ledger {
    public record Line(String account, long debit, long credit) {
        public static Line dr(String account, long amount) { return new Line(account, amount, 0); }
        public static Line cr(String account, long amount) { return new Line(account, 0, amount); }
    }

    public record Entry(long id, String txnId, String type, OffsetDateTime at, String account, long debit, long credit, String refType, String refId, String memo) {}

    public record AccountBalance(String account, long debit, long credit, long balance) {}

    public record TrialBalance(long debit, long credit, boolean balanced, List<AccountBalance> accounts) {}

    private final JdbcClient jdbc;

    Ledger(JdbcClient jdbc) { this.jdbc = jdbc; }

    public static String merchant(UUID business) { return "merchant:" + business; }

    /** Posts one transaction. Lines of zero are dropped; what's left must balance, or nothing is written. Joins the caller's transaction. */
    @Transactional
    public UUID post(String type, String refType, String refId, String memo, List<Line> lines) {
        List<Line> real = new ArrayList<>(lines.stream().filter(l -> l.debit() != 0 || l.credit() != 0).toList());
        long dr = real.stream().mapToLong(Line::debit).sum(), cr = real.stream().mapToLong(Line::credit).sum();
        if (dr != cr) throw new IllegalStateException("Ledger transaction " + type + " " + refId + " doesn't balance: debits " + dr + ", credits " + cr);
        if (real.isEmpty()) return null;
        UUID txn = UUID.randomUUID();
        for (Line l : real) {
            jdbc.sql("insert into ledger_entries (txn_id, txn_type, account, debit, credit, ref_type, ref_id, memo) values (:t, :ty, :a, :d, :c, :rt, :ri, :m)")
                    .param("t", txn).param("ty", type).param("a", l.account()).param("d", l.debit()).param("c", l.credit()).param("rt", refType).param("ri", refId).param("m", memo).update();
        }
        return txn;
    }

    public TrialBalance trialBalance() {
        List<AccountBalance> accounts = jdbc.sql("select account, sum(debit), sum(credit) from ledger_entries group by account order by "
                        + "case when account = 'gateway' then 0 when account like 'merchant:%' then 2 else 1 end, account")
                .query((rs, i) -> new AccountBalance(rs.getString(1), rs.getLong(2), rs.getLong(3), rs.getLong(2) - rs.getLong(3))).list();
        long dr = accounts.stream().mapToLong(AccountBalance::debit).sum(), cr = accounts.stream().mapToLong(AccountBalance::credit).sum();
        return new TrialBalance(dr, cr, dr == cr, accounts);
    }

    /** Newest first. account: exact name, or "merchant" for every business; ref: a payment reference or settlement reference. */
    public List<Entry> entries(String account, String ref, int limit) {
        StringBuilder w = new StringBuilder(" where true");
        if (account != null && !account.isBlank()) w.append("merchant".equals(account) ? " and account like 'merchant:%'" : " and account = :a");
        if (ref != null && !ref.isBlank()) w.append(" and ref_id = :r");
        JdbcClient.StatementSpec s = jdbc.sql("select * from ledger_entries" + w + " order by id desc limit :l");
        if (account != null && !account.isBlank() && !"merchant".equals(account)) s.param("a", account);
        if (ref != null && !ref.isBlank()) s.param("r", ref.trim());
        return s.param("l", Math.min(Math.max(limit, 1), 1000)).query((rs, i) -> new Entry(rs.getLong("id"), rs.getString("txn_id"), rs.getString("txn_type"), rs.getObject("at", OffsetDateTime.class),
                rs.getString("account"), rs.getLong("debit"), rs.getLong("credit"), rs.getString("ref_type"), rs.getString("ref_id"), rs.getString("memo"))).list();
    }

    /** What VIBE owes this business according to the books (credit minus debit). */
    public long owed(UUID business) {
        return jdbc.sql("select coalesce(sum(credit) - sum(debit), 0) from ledger_entries where account = :a").param("a", merchant(business)).query(Long.class).single();
    }

    static void requireKnown(String account) {
        if (account == null || account.isBlank()) throw ApiException.badRequest("account", "Choose an account.");
    }
}
