package in.vibe.backend.oversight;

import in.vibe.backend.common.ApiException;
import in.vibe.backend.common.Csv;
import in.vibe.backend.compliance.Kyc;
import in.vibe.backend.security.AdminAccess;
import in.vibe.backend.security.StaffPrincipal;
import in.vibe.backend.settlement.Settlements;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The admin dashboard, organised by category. "All of VIBE" shows one card per top-level category (Food and dining, Movies, Sports...);
 * inside a category the same cards are its subcategories. Each card answers: how much was sold, how much VIBE still has to pay the
 * businesses, and what is waiting for someone at VIBE. The to-do list, the merchant list and merchant balances use the same category filter
 * (AdminAccess.businessScope, which includes the workspace header), so a category's team only ever sees their own businesses.
 */
@Service
public class Workspaces {
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    public record Workspace(String id, String name) {}

    /** all: whether this person may look at all of VIBE at once (category managers can't). */
    public record WorkspaceList(boolean all, List<Workspace> categories) {}

    /** salesByKind: confirmed payments by what was sold (redemption = bills, tickets, movie, slots = bookings, pass = venue memberships). */
    public record Card(String id, String name, boolean hasChildren, int outlets, int liveOutlets, int sales, long collected, Map<String, Integer> salesByKind,
                       long toSettle, long awaitingPayout, long paidOut, int payoutsHeld, int kycWaiting, int applications, int reviews, int disputes, int refundsDue, int waiting) {}

    public record Overview(LocalDate from, LocalDate to, String workspaceName, List<Card> cards, Card total) {}

    /** link: where in the admin dashboard to deal with it. */
    public record Todo(String type, String id, String title, String detail, String category, OffsetDateTime since, String link) {}

    public record TodoList(Map<String, Integer> counts, List<Todo> items) {}

    /** agreementVersion: the merchant agreement version this business last accepted; currentAgreement: the one in force (null if none published). */
    /** category: the business's own (sub)category; topCategory: the top-level one it sits under (Movies, Food and dining...). received: everything paid through VIBE. */
    public record MerchantRow(String id, String name, String area, String category, String topCategory, boolean live, OffsetDateTime joinedAt, String kycStatus, Integer agreementVersion,
                              Integer currentAgreement, long sales30d, long received, long paidOut, long awaitingPayout, long owed, OffsetDateTime lastSaleAt, OffsetDateTime lastPaidAt) {}

    public record MerchantPage(int total, List<MerchantRow> rows) {}

    public record Application(String id, String status, String contactName, String email, String phone, OffsetDateTime submittedAt, OffsetDateTime decidedAt, String note) {}

    public record Acceptance(int version, String title, OffsetDateTime acceptedAt, String acceptedBy) {}

    public record MerchantProfile(MerchantRow merchant, String categoryPath, Application application, Kyc.View kyc, List<Acceptance> agreements,
                                  Settlements.MerchantView money, int liveOffers, int teamMembers) {}

    /** earned = gross - VIBE fees - commission - GST - refunds + adjustments. owed = earned - paid out; awaiting is part of owed. */
    public record Balance(String id, String name, String category, String kycStatus, int payments, long gross, long vibeFees, long commission, long gst, long refunds,
                          long adjustments, long earned, long paidOut, long awaitingPayout, long owed, OffsetDateTime lastSaleAt) {}

    public record Balances(List<Balance> rows, Balance total) {}

    private final JdbcClient jdbc;
    private final AdminAccess access;
    private final Kyc kyc;
    private final Settlements settlements;
    private final Clock clock;

    Workspaces(JdbcClient jdbc, AdminAccess access, Kyc kyc, Settlements settlements, Clock clock) {
        this.jdbc = jdbc;
        this.access = access;
        this.kyc = kyc;
        this.settlements = settlements;
        this.clock = clock;
    }

    // ---------- the switcher ----------
    public WorkspaceList list(StaffPrincipal who) {
        AdminAccess.Access a = access.access(who);
        if (a.scoped()) {
            List<Workspace> mine = new ArrayList<>();
            for (UUID id : a.categoryIds()) jdbc.sql("select id, name from categories where id = :id").param("id", id).query((rs, i) -> new Workspace(rs.getString(1), rs.getString(2))).optional().ifPresent(mine::add);
            return new WorkspaceList(false, mine);
        }
        return new WorkspaceList(true, jdbc.sql("select id, name from categories where parent_id is null and active order by sort_order, name").query((rs, i) -> new Workspace(rs.getString(1), rs.getString(2))).list());
    }

    // ---------- overview ----------
    public Overview overview(StaffPrincipal who, LocalDate from, LocalDate to) {
        LocalDate today = LocalDate.now(clock.withZone(IST));
        LocalDate f = from == null ? today : from, t = to == null ? today : to;
        if (t.isBefore(f)) throw ApiException.badRequest("bad_period", "The end date is before the start date.");
        OffsetDateTime fa = f.atStartOfDay(IST).toOffsetDateTime(), ua = t.plusDays(1).atStartOfDay(IST).toOffsetDateTime();
        UUID ws = access.workspace();
        String scope = access.businessScope(who, "b.id"), catScope = access.categoryScope(who, "ma.category_id");

        String wsName = ws == null ? null : jdbc.sql("select name from categories where id = :id").param("id", ws).query(String.class).optional().orElseThrow(() -> ApiException.notFound("Category not found."));
        record Cat(UUID id, String name, boolean children) {}
        List<Cat> cats = jdbc.sql("select c.id, c.name, exists (select 1 from categories k where k.parent_id = c.id) from categories c where c.active and " + (ws == null ? "c.parent_id is null" : "c.parent_id = :w") + " order by c.sort_order, c.name")
                .param("w", ws == null ? UUID.randomUUID() : ws).query((rs, i) -> new Cat((UUID) rs.getObject(1), rs.getString(2), rs.getBoolean(3))).list();
        if (ws != null && cats.isEmpty()) cats = List.of(new Cat(ws, wsName, false)); // a category with nothing below it is its own only card

        List<Card> cards = new ArrayList<>();
        for (Cat c : cats) {
            Card card = card(c.id().toString(), c.name(), c.children(), "(" + AdminAccess.treeOf(List.of(c.id())) + ")", scope, catScope, fa, ua);
            if (access.access(who).scoped() && card.outlets() == 0 && card.applications() == 0) continue; // a category manager sees only categories with their businesses
            cards.add(card);
        }
        String all = ws == null ? "(select id from categories)" : "(" + AdminAccess.treeOf(List.of(ws)) + ")";
        Card total = card("total", ws == null ? "All of VIBE" : "All of " + wsName, false, all, scope, catScope, fa, ua);
        return new Overview(f, t, wsName, cards, total);
    }

    private Card card(String id, String name, boolean children, String cats, String scope, String catScope, OffsetDateTime f, OffsetDateTime u) {
        String inCat = " and b.primary_category_id in " + cats + scope;
        int[] outlets = jdbc.sql("select count(*), count(*) filter (where b.active) from businesses b where true" + inCat).query((rs, i) -> new int[]{rs.getInt(1), rs.getInt(2)}).single();
        Map<String, Integer> byKind = new LinkedHashMap<>();
        long[] sold = {0, 0};
        jdbc.sql("select pr.kind, count(*), coalesce(sum(p.amount + pr.vibe_funded), 0) from payments p join payment_requests pr on pr.id = p.payment_request_id join businesses b on b.id = pr.business_id "
                        + "where p.status = 'verified' and p.verified_at >= :f and p.verified_at < :u" + inCat + " group by pr.kind order by 2 desc").param("f", f).param("u", u)
                .query((rs, i) -> {
                    byKind.put(rs.getString(1), rs.getInt(2));
                    sold[0] += rs.getInt(2);
                    sold[1] += rs.getLong(3);
                    return 0;
                }).list();
        long unsettled = jdbc.sql("select coalesce(sum(p.amount + pr.vibe_funded - pr.vibe_fee - p.commission - p.gst - p.refund_merchant_share), 0)" + Settlements.UNSETTLED + inCat).query(Long.class).single()
                + jdbc.sql("select coalesce(sum(a.amount), 0) from settlement_adjustments a join businesses b on b.id = a.business_id where a.settlement_id is null" + inCat).query(Long.class).single();
        long awaiting = jdbc.sql("select coalesce(sum(s.payout), 0) from settlements s join businesses b on b.id = s.business_id where s.status = 'pending'" + inCat).query(Long.class).single();
        long paid = jdbc.sql("select coalesce(sum(s.payout), 0) from settlements s join businesses b on b.id = s.business_id where s.status = 'paid' and s.paid_at >= :f and s.paid_at < :u" + inCat)
                .param("f", f).param("u", u).query(Long.class).single();
        int held = jdbc.sql("select count(distinct b.id)" + Settlements.UNSETTLED + inCat + " and not exists (select 1 from business_kyc k where k.business_id = b.id and k.status = 'verified')").query(Integer.class).single();
        int kycWaiting = count("select count(*) from business_kyc k join businesses b on b.id = k.business_id where k.status = 'submitted'" + inCat);
        int applications = count("select count(*) from merchant_applications ma where ma.status in ('pending', 'changes_requested') and ma.category_id in " + cats + catScope);
        int reviews = count("select count(*) from offers o join businesses b on b.id = o.business_id where o.review_status = 'pending'" + inCat)
                + count("select count(*) from promotions o join businesses b on b.id = o.business_id where o.review_status = 'pending'" + inCat)
                + count("select count(*) from events e join businesses b on b.id = e.business_id where e.status = 'pending'" + inCat);
        int disputes = count("select count(*) from disputes d join businesses b on b.id = d.business_id where d.status = 'open'" + inCat);
        int refunds = count("select count(*) from payments p join payment_requests pr on pr.id = p.payment_request_id join businesses b on b.id = pr.business_id where p.refund_status = 'due'" + inCat);
        return new Card(id, name, children, outlets[0], outlets[1], (int) sold[0], sold[1], byKind, unsettled + awaiting, awaiting, paid, held, kycWaiting, applications, reviews, disputes, refunds,
                kycWaiting + applications + reviews + disputes + refunds);
    }

    private int count(String sql) { return jdbc.sql(sql).query(Integer.class).single(); }

    public ResponseEntity<byte[]> overviewCsv(StaffPrincipal who, LocalDate from, LocalDate to) {
        Overview o = overview(who, from, to);
        Csv csv = new Csv().row(o.workspaceName() == null ? "VIBE by category" : "VIBE · " + o.workspaceName(), o.from() + " to " + o.to()).row();
        csv.row("Category", "Outlets", "Live outlets", "Sales (count)", "Collected (Rs)", "Bills", "Tickets", "Movie tickets", "Bookings", "Venue memberships", "To settle (Rs)", "Settlements awaiting payout (Rs)",
                "Paid out in period (Rs)", "Payouts held (no KYC)", "KYC waiting", "Applications waiting", "Reviews waiting", "Open disputes", "Refunds due");
        List<Card> all = new ArrayList<>(o.cards());
        all.add(o.total());
        for (Card c : all) {
            csv.row(c.name(), c.outlets(), c.liveOutlets(), c.sales(), Csv.rupees(c.collected()), c.salesByKind().getOrDefault("redemption", 0), c.salesByKind().getOrDefault("tickets", 0), c.salesByKind().getOrDefault("movie", 0),
                    c.salesByKind().getOrDefault("slots", 0), c.salesByKind().getOrDefault("pass", 0), Csv.rupees(c.toSettle()), Csv.rupees(c.awaitingPayout()), Csv.rupees(c.paidOut()), c.payoutsHeld(), c.kycWaiting(),
                    c.applications(), c.reviews(), c.disputes(), c.refundsDue());
        }
        return csv.download("vibe-overview-" + o.from() + "-to-" + o.to() + ".csv");
    }

    // ---------- to do ----------
    /** Everything waiting for someone at VIBE, oldest first, limited to the areas this person may open. */
    public TodoList todo(StaffPrincipal who) {
        AdminAccess.Access a = access.access(who);
        String scope = access.businessScope(who, "b.id"), catScope = access.categoryScope(who, "ma.category_id");
        List<Todo> items = new ArrayList<>();
        String bizCat = " join categories c on c.id = b.primary_category_id";
        if (a.can("partners")) {
            items.addAll(jdbc.sql("select ma.id, ma.business_name, ma.area, ma.status, coalesce(c.name, 'No category') cname, ma.created_at from merchant_applications ma left join categories c on c.id = ma.category_id "
                            + "where ma.status in ('pending', 'changes_requested')" + catScope + " order by ma.created_at limit 200")
                    .query((rs, i) -> new Todo("application", rs.getString(1), "New business: " + rs.getString(2), rs.getString(3) + ("changes_requested".equals(rs.getString(4)) ? " · waiting for the business to make changes" : " · decide approve or reject"),
                            rs.getString(5), rs.getObject(6, OffsetDateTime.class), "/applications")).list());
            items.addAll(jdbc.sql("select b.id, b.name, c.name, k.submitted_at from business_kyc k join businesses b on b.id = k.business_id" + bizCat + " where k.status = 'submitted'" + scope + " order by k.submitted_at limit 200")
                    .query((rs, i) -> new Todo("kyc", rs.getString(1), "Check KYC and bank: " + rs.getString(2), "PAN, GST and bank account sent for checking. Payouts wait until it’s verified.", rs.getString(3),
                            rs.getObject(4, OffsetDateTime.class), "/merchants/" + rs.getString(1) + "?tab=kyc")).list());
        }
        if (a.can("content")) {
            items.addAll(jdbc.sql("select o.id, o.title, b.name, c.name, o.created_at from offers o join businesses b on b.id = o.business_id" + bizCat + " where o.review_status = 'pending'" + scope + " order by o.created_at limit 200")
                    .query((rs, i) -> new Todo("offer", rs.getString(1), "Review offer: " + rs.getString(2), rs.getString(3), rs.getString(4), rs.getObject(5, OffsetDateTime.class), "/offers")).list());
            items.addAll(jdbc.sql("select o.id, o.title, b.name, c.name, o.created_at from promotions o join businesses b on b.id = o.business_id" + bizCat + " where o.review_status = 'pending'" + scope + " order by o.created_at limit 200")
                    .query((rs, i) -> new Todo("promotion", rs.getString(1), "Review promotion: " + rs.getString(2), rs.getString(3), rs.getString(4), rs.getObject(5, OffsetDateTime.class), "/promotions")).list());
            items.addAll(jdbc.sql("select e.id, e.title, b.name, c.name, e.created_at from events e join businesses b on b.id = e.business_id" + bizCat + " where e.status = 'pending'" + scope + " order by e.created_at limit 200")
                    .query((rs, i) -> new Todo("event", rs.getString(1), "Review event: " + rs.getString(2), rs.getString(3), rs.getString(4), rs.getObject(5, OffsetDateTime.class), "/events/" + rs.getString(1))).list());
        }
        if (a.can("money")) {
            items.addAll(jdbc.sql("select d.reference, b.name, c.name, d.created_at from disputes d join businesses b on b.id = d.business_id" + bizCat + " where d.status = 'open'" + scope + " order by d.created_at limit 200")
                    .query((rs, i) -> new Todo("dispute", rs.getString(1), "Customer dispute " + rs.getString(1), rs.getString(2) + " · decide refund or reject", rs.getString(3), rs.getObject(4, OffsetDateTime.class), "/disputes")).list());
            items.addAll(jdbc.sql("select p.reference, b.name, c.name, coalesce(p.refund_requested_at, p.created_at), p.refund_amount from payments p join payment_requests pr on pr.id = p.payment_request_id join businesses b on b.id = pr.business_id" + bizCat
                            + " where p.refund_status = 'due'" + scope + " order by p.refund_requested_at limit 200")
                    .query((rs, i) -> new Todo("refund", rs.getString(1), "Refund due: " + rs.getString(1), rs.getString(2) + " · ₹" + rs.getLong(5) / 100 + " to send back to the customer", rs.getString(3),
                            rs.getObject(4, OffsetDateTime.class), "/refunds")).list());
        }
        if (a.can("customers") && access.workspace() == null && !a.scoped()) {
            items.addAll(jdbc.sql("select d.id, d.requested_at from deletion_requests d where d.status = 'pending' order by d.requested_at limit 200")
                    .query((rs, i) -> new Todo("deletion", rs.getString(1), "Customer asked to delete their account", "Remove their personal details within the legal deadline.", "Customers",
                            rs.getObject(2, OffsetDateTime.class), "/deletions")).list());
        }
        items.sort(Comparator.comparing(Todo::since, Comparator.nullsLast(Comparator.naturalOrder())));
        Map<String, Integer> counts = new LinkedHashMap<>();
        for (Todo t : items) counts.merge(t.type(), 1, Integer::sum);
        return new TodoList(counts, items);
    }

    // ---------- merchants ----------
    private static final String TOP_CATEGORY = "(with recursive up as (select id, parent_id, name from categories where id = b.primary_category_id "
            + "union all select c2.id, c2.parent_id, c2.name from categories c2 join up on c2.id = up.parent_id) select name from up where parent_id is null limit 1)";

    private static final String MERCHANT_SELECT = "select b.id, b.name, b.area, c.name cname, " + TOP_CATEGORY + " top, b.active, b.created_at, coalesce(k.status, 'not_submitted') kyc, "
            + "(select max(v.version) from agreement_acceptances aa join agreement_versions v on v.id = aa.version_id where aa.business_id = b.id) agreed, "
            + "(select coalesce(sum(p.amount + pr.vibe_funded), 0) from payments p join payment_requests pr on pr.id = p.payment_request_id where pr.business_id = b.id and p.status = 'verified' and p.verified_at > :m) sales30, "
            + "(select max(s.paid_at) from settlements s where s.business_id = b.id and s.status = 'paid') last_paid "
            + "from businesses b join categories c on c.id = b.primary_category_id left join business_kyc k on k.business_id = b.id";

    private static UUID categoryId(String raw) {
        try {
            return UUID.fromString(raw.trim());
        } catch (IllegalArgumentException e) {
            throw ApiException.badRequest("bad_category", "That category isn’t valid.");
        }
    }

    /**
     * kyc: not_submitted, submitted, verified, rejected. agreement: "missing" for businesses that haven't accepted the version in force.
     * category: only businesses whose main category is this one or below it (Movies, Food and dining › Cafes...).
     */
    public MerchantPage merchants(StaffPrincipal who, String q, String kycStatus, String agreement, Boolean live, String category, int limit, int offset) {
        Integer current = currentAgreement();
        StringBuilder w = new StringBuilder(" where true").append(access.businessScope(who, "b.id"));
        Map<String, Object> p = new HashMap<>();
        if (q != null && !q.isBlank()) { w.append(" and (b.name ilike :q or b.area ilike :q)"); p.put("q", "%" + q.trim().replace("%", "") + "%"); }
        if (kycStatus != null && !kycStatus.isBlank()) { w.append(" and coalesce(k.status, 'not_submitted') = :k"); p.put("k", kycStatus); }
        if ("missing".equals(agreement) && current != null) w.append(" and not exists (select 1 from agreement_acceptances aa join agreement_versions v on v.id = aa.version_id where aa.business_id = b.id and v.version = ").append(current).append(")");
        if (live != null) { w.append(" and b.active = :live"); p.put("live", live); }
        if (category != null && !category.isBlank()) w.append(" and b.primary_category_id in (").append(AdminAccess.treeOf(List.of(categoryId(category)))).append(")");
        JdbcClient.StatementSpec count = jdbc.sql("select count(*) from businesses b left join business_kyc k on k.business_id = b.id" + w);
        p.forEach(count::param);
        int total = count.query(Integer.class).single();
        JdbcClient.StatementSpec rows = jdbc.sql(MERCHANT_SELECT + w + " order by (coalesce(k.status, '') = 'submitted') desc, b.name limit :lim offset :off")
                .param("m", OffsetDateTime.now(clock).minusDays(30)).param("lim", Math.max(1, Math.min(limit, 2000))).param("off", Math.max(0, offset));
        p.forEach(rows::param);
        Map<String, Balance> money = balancesById();
        return new MerchantPage(total, rows.query((rs, i) -> merchantRow(rs, current, money)).list());
    }

    private MerchantRow merchantRow(java.sql.ResultSet rs, Integer current, Map<String, Balance> money) throws java.sql.SQLException {
        int agreed = rs.getInt("agreed"); // versions start at 1, so 0 means none accepted
        Balance b = money.get(rs.getString("id"));
        return new MerchantRow(rs.getString("id"), rs.getString("name"), rs.getString("area"), rs.getString("cname"), rs.getString("top"), rs.getBoolean("active"), rs.getObject("created_at", OffsetDateTime.class),
                rs.getString("kyc"), agreed == 0 ? null : agreed, current, rs.getLong("sales30"), b == null ? 0 : b.gross(), b == null ? 0 : b.paidOut(), b == null ? 0 : b.awaitingPayout(),
                b == null ? 0 : b.owed(), b == null ? null : b.lastSaleAt(), rs.getObject("last_paid", OffsetDateTime.class));
    }

    private Integer currentAgreement() {
        return jdbc.sql("select max(version) from agreement_versions").query((rs, i) -> { int v = rs.getInt(1); return rs.wasNull() ? null : v; }).single();
    }

    /** Everything about each business on one row: category, contact, KYC (legal and tax ids), bank (account number masked), agreement and money. */
    public ResponseEntity<byte[]> merchantsCsv(StaffPrincipal who, String q, String kycStatus, String agreement, Boolean live, String category) {
        MerchantPage page = merchants(who, q, kycStatus, agreement, live, category, 2000, 0);
        Csv csv = new Csv().row("Business", "Category", "Subcategory", "Area", "Live", "Joined", "Contact", "Email", "Phone", "KYC and bank", "Legal name", "PAN", "GSTIN", "FSSAI", "Account holder", "Bank",
                "IFSC", "Account (last 4)", "Agreement accepted", "Agreement in force", "Received through VIBE (Rs)", "Sales last 30 days (Rs)", "Paid out (Rs)", "Waiting for bank transfer (Rs)",
                "VIBE owes them now (Rs)", "Last sale", "Last payout");
        for (MerchantRow r : page.rows()) {
            Kyc.View k = kyc.get(UUID.fromString(r.id()));
            String[] contact = jdbc.sql("select contact_name, email, phone from merchant_applications where business_id = :b order by created_at desc limit 1").param("b", UUID.fromString(r.id()))
                    .query((rs, i) -> new String[]{rs.getString(1), rs.getString(2), rs.getString(3)}).optional().orElse(new String[]{"", "", ""});
            String acct = k.bankAccountNo() == null ? "" : k.bankAccountNo().replaceAll("\\D", "");
            csv.row(r.name(), r.topCategory(), r.category(), r.area(), r.live() ? "Yes" : "No", day(r.joinedAt()), contact[0], contact[1], contact[2], kycLabel(r.kycStatus()), nz(k.legalName()), nz(k.pan()),
                    nz(k.gstin()), nz(k.fssai()), nz(k.bankAccountName()), nz(k.bankName()), nz(k.bankIfsc()), acct.length() >= 4 ? "XXXX" + acct.substring(acct.length() - 4) : "",
                    r.agreementVersion() == null ? "None" : "v" + r.agreementVersion(), r.currentAgreement() == null ? "" : "v" + r.currentAgreement(), Csv.rupees(r.received()), Csv.rupees(r.sales30d()),
                    Csv.rupees(r.paidOut()), Csv.rupees(r.awaitingPayout()), Csv.rupees(r.owed()), day(r.lastSaleAt()), day(r.lastPaidAt()));
        }
        return csv.download("vibe-merchants.csv");
    }

    private static String nz(String s) { return s == null ? "" : s; }

    private static String day(OffsetDateTime t) { return t == null ? "" : t.atZoneSameInstant(IST).toLocalDate().toString(); }

    private static String kycLabel(String s) {
        return switch (s) {
            case "verified" -> "Verified";
            case "submitted" -> "Sent, to check";
            case "rejected" -> "Sent back";
            default -> "Not sent";
        };
    }

    // ---------- merchants by category ----------
    public record MerchantCategory(String id, String name, boolean hasChildren, int merchants, int live, int kycVerified, int kycToCheck, int kycSentBack, int kycNotSent, int agreementMissing,
                                   long received, long paidOut, long awaitingPayout, long owed) {}

    public record MerchantCategories(String parentId, String parentName, List<MerchantCategory> rows, MerchantCategory total) {}

    /**
     * The merchants page starts here: one row per category (Movies, Food and dining, Sports...) with how many businesses it has, how many have
     * verified KYC and bank details, and the money: received through VIBE, paid out, waiting for the bank transfer and still owed.
     * parent: a category to open (its subcategories); otherwise the category being looked at, or the top-level categories.
     */
    public MerchantCategories merchantCategories(StaffPrincipal who, String parent) {
        UUID p = parent != null && !parent.isBlank() ? categoryId(parent) : access.workspace();
        String scope = access.businessScope(who, "b.id");
        String parentName = p == null ? null : jdbc.sql("select name from categories where id = :id").param("id", p).query(String.class).optional().orElseThrow(() -> ApiException.notFound("Category not found."));
        record Cat(UUID id, String name, boolean children) {}
        List<Cat> cats = jdbc.sql("select c.id, c.name, exists (select 1 from categories k where k.parent_id = c.id) from categories c where c.active and " + (p == null ? "c.parent_id is null" : "c.parent_id = :p")
                        + " order by c.sort_order, c.name").param("p", p == null ? UUID.randomUUID() : p).query((rs, i) -> new Cat((UUID) rs.getObject(1), rs.getString(2), rs.getBoolean(3))).list();
        if (p != null && cats.isEmpty()) cats = List.of(new Cat(p, parentName, false));
        Integer current = currentAgreement();
        Map<String, Balance> money = balancesById();
        boolean scoped = access.access(who).scoped();
        List<MerchantCategory> rows = new ArrayList<>();
        for (Cat c : cats) {
            MerchantCategory row = categoryRow(c.id().toString(), c.name(), c.children(), "(" + AdminAccess.treeOf(List.of(c.id())) + ")", scope, current, money);
            if (scoped && row.merchants() == 0) continue;
            rows.add(row);
        }
        String all = p == null ? "(select id from categories)" : "(" + AdminAccess.treeOf(List.of(p)) + ")";
        return new MerchantCategories(p == null ? null : p.toString(), parentName, rows, categoryRow("total", p == null ? "All categories" : "All of " + parentName, false, all, scope, current, money));
    }

    private MerchantCategory categoryRow(String id, String name, boolean children, String cats, String scope, Integer current, Map<String, Balance> money) {
        int[] n = new int[7]; // merchants, live, verified, to check, sent back, not sent, agreement missing
        long[] m = new long[4]; // received, paid out, awaiting, owed
        jdbc.sql("select b.id, b.active, coalesce(k.status, 'not_submitted') kyc, " + (current == null ? "false" : "not exists (select 1 from agreement_acceptances aa join agreement_versions v on v.id = aa.version_id where aa.business_id = b.id and v.version = " + current + ")")
                        + " missing from businesses b left join business_kyc k on k.business_id = b.id where b.primary_category_id in " + cats + scope)
                .query((rs, i) -> {
                    n[0]++;
                    if (rs.getBoolean("active")) n[1]++;
                    switch (rs.getString("kyc")) {
                        case "verified" -> n[2]++;
                        case "submitted" -> n[3]++;
                        case "rejected" -> n[4]++;
                        default -> n[5]++;
                    }
                    if (rs.getBoolean("missing")) n[6]++;
                    Balance b = money.get(rs.getString("id"));
                    if (b != null) { m[0] += b.gross(); m[1] += b.paidOut(); m[2] += b.awaitingPayout(); m[3] += b.owed(); }
                    return 0;
                }).list();
        return new MerchantCategory(id, name, children, n[0], n[1], n[2], n[3], n[4], n[5], n[6], m[0], m[1], m[2], m[3]);
    }

    public ResponseEntity<byte[]> merchantCategoriesCsv(StaffPrincipal who, String parent) {
        MerchantCategories mc = merchantCategories(who, parent);
        Csv csv = new Csv().row("Merchants by category" + (mc.parentName() == null ? "" : " · " + mc.parentName()), "as of " + LocalDate.now(clock.withZone(IST))).row();
        csv.row("Category", "Merchants", "Live", "KYC and bank verified", "Sent, to check", "Sent back", "Not sent", "Agreement not accepted", "Received through VIBE (Rs)", "Paid out (Rs)",
                "Waiting for bank transfer (Rs)", "VIBE owes them now (Rs)");
        List<MerchantCategory> all = new ArrayList<>(mc.rows());
        all.add(mc.total());
        for (MerchantCategory r : all) {
            csv.row(r.name(), r.merchants(), r.live(), r.kycVerified(), r.kycToCheck(), r.kycSentBack(), r.kycNotSent(), r.agreementMissing(), Csv.rupees(r.received()), Csv.rupees(r.paidOut()),
                    Csv.rupees(r.awaitingPayout()), Csv.rupees(r.owed()));
        }
        return csv.download("vibe-merchants-by-category.csv");
    }

    // ---------- payments a business received ----------
    /**
     * One confirmed payment at a business and where its money is: settlementStatus null = not in a settlement yet (VIBE still owes it),
     * "pending" = in a settlement waiting for the bank transfer, "paid" = paid out (with the bank reference). payout is the business's share.
     */
    public record MerchantPayment(String reference, OffsetDateTime paidAt, String kind, String what, String customerName, String vibeId, long amount, long vibeFee, long commission, long gst,
                                  long refund, boolean refundedInFull, long payout, String settlementId, String settlementRef, String settlementStatus, OffsetDateTime settlementPaidAt, String payoutRef) {}

    public record MerchantPayments(int total, int notSettled, long notSettledAmount, List<MerchantPayment> rows) {}

    /** settled: "no" (not in a settlement yet), "pending" (waiting for the bank transfer), "paid"; anything else is every payment. */
    public MerchantPayments merchantPayments(StaffPrincipal who, UUID business, String settled, int limit, int offset) {
        access.requireBusiness(who, business);
        String filter = switch (settled == null ? "" : settled) {
            case "no" -> " and s.id is null";
            case "pending" -> " and s.status = 'pending'";
            case "paid" -> " and s.status = 'paid'";
            default -> "";
        };
        String from = " from payments p join payment_requests pr on pr.id = p.payment_request_id join customers c on c.id = p.customer_id "
                + "left join redemptions r on r.id = pr.redemption_id left join offers o on o.id = r.offer_id left join ticket_reservations tr on tr.id = pr.reservation_id left join events ev on ev.id = tr.event_id "
                + "left join settlement_items si on si.payment_id = p.id left join settlements s on s.id = si.settlement_id where pr.business_id = :b and p.status = 'verified'";
        int total = jdbc.sql("select count(*)" + from + filter).param("b", business).query(Integer.class).single();
        long[] open = jdbc.sql("select count(*), coalesce(sum(p.amount + pr.vibe_funded - pr.vibe_fee - p.commission - p.gst - p.refund_merchant_share), 0)" + from + " and s.id is null and not p.refund_full_reversal")
                .param("b", business).query((rs, i) -> new long[]{rs.getLong(1), rs.getLong(2)}).single();
        List<MerchantPayment> rows = jdbc.sql("select p.reference, p.verified_at, pr.kind, coalesce(o.title, ev.title, pr.bill_ref) what, c.name, c.vibe_id, p.amount + pr.vibe_funded amt, pr.vibe_fee, p.commission, p.gst, "
                        + "p.refund_merchant_share, p.refund_full_reversal, s.id sid, s.reference sref, s.status sst, s.paid_at, s.payout_ref" + from + filter + " order by p.verified_at desc limit :lim offset :off")
                .param("b", business).param("lim", Math.max(1, Math.min(limit, 2000))).param("off", Math.max(0, offset))
                .query((rs, i) -> {
                    long amt = rs.getLong("amt"), fee = rs.getLong("vibe_fee"), comm = rs.getLong("commission"), gst = rs.getLong("gst"), refund = rs.getLong("refund_merchant_share");
                    boolean full = rs.getBoolean("refund_full_reversal");
                    return new MerchantPayment(rs.getString("reference"), rs.getObject("verified_at", OffsetDateTime.class), rs.getString("kind"), rs.getString("what"),
                            in.vibe.backend.customer.Customers.displayName(rs.getString("name")), rs.getString("vibe_id"), amt, fee, comm, gst, refund, full, full ? 0 : amt - fee - comm - gst - refund,
                            rs.getString("sid"), rs.getString("sref"), rs.getString("sst"), rs.getObject("paid_at", OffsetDateTime.class), rs.getString("payout_ref"));
                }).list();
        return new MerchantPayments(total, (int) open[0], open[1], rows);
    }

    public ResponseEntity<byte[]> merchantPaymentsCsv(StaffPrincipal who, UUID business, String settled) {
        MerchantPayments mp = merchantPayments(who, business, settled, 2000, 0);
        String name = jdbc.sql("select name from businesses where id = :b").param("b", business).query(String.class).single();
        Csv csv = new Csv().row("Payments received · " + name, "as of " + LocalDate.now(clock.withZone(IST))).row();
        csv.row("Transaction ID", "Paid on", "Type", "For", "Customer", "VIBE ID", "Amount (Rs)", "VIBE fee (Rs)", "Commission (Rs)", "GST on commission (Rs)", "Refund charged (Rs)", "Business's share (Rs)",
                "Settlement", "Settlement status", "Paid out on", "Bank reference");
        for (MerchantPayment p : mp.rows()) {
            csv.row(p.reference(), day(p.paidAt()), p.kind(), nz(p.what()), p.customerName(), p.vibeId(), Csv.rupees(p.amount()), Csv.rupees(p.vibeFee()), Csv.rupees(p.commission()), Csv.rupees(p.gst()),
                    Csv.rupees(p.refund()), Csv.rupees(p.payout()), nz(p.settlementRef()),
                    p.refundedInFull() ? "Refunded in full, not paid out" : p.settlementStatus() == null ? "Not settled yet" : "paid".equals(p.settlementStatus()) ? "Paid out" : "Waiting for bank transfer",
                    day(p.settlementPaidAt()), nz(p.payoutRef()));
        }
        return csv.download("vibe-payments-" + name.toLowerCase().replaceAll("[^a-z0-9]+", "-") + ".csv");
    }

    public MerchantProfile merchant(StaffPrincipal who, UUID id) {
        access.requireBusiness(who, id);
        Integer current = currentAgreement();
        MerchantRow row = jdbc.sql(MERCHANT_SELECT + " where b.id = :id").param("id", id).param("m", OffsetDateTime.now(clock).minusDays(30))
                .query((rs, i) -> merchantRow(rs, current, balancesById())).optional().orElseThrow(() -> ApiException.notFound("Business not found."));
        String path = jdbc.sql("with recursive up as (select c.id, c.parent_id, c.name, 0 d from categories c join businesses b on b.primary_category_id = c.id where b.id = :id "
                + "union all select c.id, c.parent_id, c.name, up.d + 1 from categories c join up on c.id = up.parent_id) select string_agg(name, ' › ' order by d desc) from up").param("id", id).query(String.class).single();
        Application app = jdbc.sql("select id, status, contact_name, email, phone, created_at, decided_at, review_note from merchant_applications where business_id = :id order by created_at desc limit 1").param("id", id)
                .query((rs, i) -> new Application(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5), rs.getObject(6, OffsetDateTime.class), rs.getObject(7, OffsetDateTime.class), rs.getString(8)))
                .optional().orElse(null);
        List<Acceptance> agreements = jdbc.sql("select v.version, v.title, aa.accepted_at, s.name from agreement_acceptances aa join agreement_versions v on v.id = aa.version_id left join staff_users s on s.id = aa.staff_id "
                        + "where aa.business_id = :id order by aa.accepted_at desc").param("id", id)
                .query((rs, i) -> new Acceptance(rs.getInt(1), rs.getString(2), rs.getObject(3, OffsetDateTime.class), rs.getString(4))).list();
        int offers = count("select count(*) from offers where business_id = '" + id + "' and active and review_status = 'approved' and ends_at > now()");
        int team = count("select count(*) from staff_users where business_id = '" + id + "' and active");
        return new MerchantProfile(row, path, app, kyc.get(id), agreements, settlements.merchantView(id), offers, team);
    }

    // ---------- balances ----------
    private Map<String, Balance> balancesById() {
        Map<String, Balance> m = new HashMap<>();
        for (Balance b : balanceRows("")) m.put(b.id(), b);
        return m;
    }

    private List<Balance> balanceRows(String scope) {
        Map<String, Long> adj = new HashMap<>(), paid = new HashMap<>(), awaiting = new HashMap<>();
        jdbc.sql("select business_id, sum(amount) from settlement_adjustments group by business_id").query((rs, i) -> adj.put(rs.getString(1), rs.getLong(2))).list();
        jdbc.sql("select business_id, coalesce(sum(payout) filter (where status = 'paid'), 0), coalesce(sum(payout) filter (where status = 'pending'), 0) from settlements group by business_id")
                .query((rs, i) -> { paid.put(rs.getString(1), rs.getLong(2)); awaiting.put(rs.getString(1), rs.getLong(3)); return 0; }).list();
        return jdbc.sql("select b.id, b.name, c.name cname, coalesce(k.status, 'not_submitted') kyc, count(p.id) n, coalesce(sum(p.amount + pr.vibe_funded) filter (where p.id is not null), 0) gross, "
                        + "coalesce(sum(pr.vibe_fee) filter (where p.id is not null), 0) fees, coalesce(sum(p.commission), 0) comm, coalesce(sum(p.gst), 0) gst, coalesce(sum(p.refund_merchant_share), 0) refunds, max(p.verified_at) last_sale "
                        + "from businesses b join categories c on c.id = b.primary_category_id left join business_kyc k on k.business_id = b.id left join payment_requests pr on pr.business_id = b.id "
                        + "left join payments p on p.payment_request_id = pr.id and p.status = 'verified' and not p.refund_full_reversal where true" + scope + " group by b.id, b.name, c.name, k.status")
                .query((rs, i) -> {
                    String id = rs.getString("id");
                    long gross = rs.getLong("gross"), fees = rs.getLong("fees"), comm = rs.getLong("comm"), gst = rs.getLong("gst"), refunds = rs.getLong("refunds"), a = adj.getOrDefault(id, 0L);
                    long earned = gross - fees - comm - gst - refunds + a, out = paid.getOrDefault(id, 0L);
                    return new Balance(id, rs.getString("name"), rs.getString("cname"), rs.getString("kyc"), rs.getInt("n"), gross, fees, comm, gst, refunds, a, earned, out, awaiting.getOrDefault(id, 0L), earned - out,
                            rs.getObject("last_sale", OffsetDateTime.class));
                }).list();
    }

    public Balances balances(StaffPrincipal who, boolean onlyOwed) {
        List<Balance> rows = new ArrayList<>(balanceRows(access.businessScope(who, "b.id")));
        if (onlyOwed) rows.removeIf(b -> b.owed() == 0 && b.payments() == 0);
        rows.sort(Comparator.comparingLong(Balance::owed).reversed().thenComparing(Balance::name));
        Balance t = new Balance("total", "Total", "", "", rows.stream().mapToInt(Balance::payments).sum(), sum(rows, Balance::gross), sum(rows, Balance::vibeFees), sum(rows, Balance::commission), sum(rows, Balance::gst),
                sum(rows, Balance::refunds), sum(rows, Balance::adjustments), sum(rows, Balance::earned), sum(rows, Balance::paidOut), sum(rows, Balance::awaitingPayout), sum(rows, Balance::owed), null);
        return new Balances(rows, t);
    }

    private static long sum(List<Balance> rows, java.util.function.ToLongFunction<Balance> f) { return rows.stream().mapToLong(f).sum(); }

    public ResponseEntity<byte[]> balancesCsv(StaffPrincipal who) {
        Balances b = balances(who, true);
        String ws = access.workspace() == null ? "all" : jdbc.sql("select name from categories where id = :id").param("id", access.workspace()).query(String.class).optional().orElse("category");
        Csv csv = new Csv().row("Merchant balances · " + ws, "as of " + LocalDate.now(clock.withZone(IST))).row();
        csv.row("Business", "Category", "KYC and bank", "Payments", "Sales (Rs)", "VIBE fees (Rs)", "Commission (Rs)", "GST on commission (Rs)", "Refunds charged (Rs)", "Adjustments (Rs)", "Earned (Rs)", "Paid out (Rs)",
                "Awaiting payout (Rs)", "Owed now (Rs)", "Last sale");
        List<Balance> all = new ArrayList<>(b.rows());
        all.add(b.total());
        for (Balance r : all) {
            csv.row(r.name(), r.category(), r.kycStatus().replace('_', ' '), r.payments(), Csv.rupees(r.gross()), Csv.rupees(r.vibeFees()), Csv.rupees(r.commission()), Csv.rupees(r.gst()), Csv.rupees(r.refunds()),
                    Csv.rupees(r.adjustments()), Csv.rupees(r.earned()), Csv.rupees(r.paidOut()), Csv.rupees(r.awaitingPayout()), Csv.rupees(r.owed()), r.lastSaleAt() == null ? "" : r.lastSaleAt().atZoneSameInstant(IST).toLocalDate());
        }
        return csv.download("vibe-merchant-balances-" + ws.toLowerCase().replaceAll("[^a-z0-9]+", "-") + ".csv");
    }
}
