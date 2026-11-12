package in.vibe.backend.settlement;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/** What VIBE has done for one business: customers it brought, what they spent there, the discount the business gave, and the money on its way. */
@Service
public class MerchantResults {
    public record Day(String day, long sales, int bills) {}

    public record OfferResult(String offerId, String title, String reviewStatus, boolean live, int redemptions, int paid, long sales, long discount) {}

    public record Results(int days, int customers, int repeatCustomers, int redemptionsStarted, int paidBills, long sales, long discountGiven, long averageBill, int offersLive, int offersPending,
                          int eventsLive, int eventsPending, Settlements.Balance unsettled, long awaitingPayout, long paidOut, List<OfferResult> offers, List<Day> lastDays) {}

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private final JdbcClient jdbc;
    private final Settlements settlements;
    private final Clock clock;

    MerchantResults(JdbcClient jdbc, Settlements settlements, Clock clock) {
        this.jdbc = jdbc;
        this.settlements = settlements;
        this.clock = clock;
    }

    public Results results(UUID b, int days) {
        int span = Math.min(Math.max(days, 1), 365);
        OffsetDateTime now = OffsetDateTime.now(clock), since = now.minusDays(span);
        String paidAtB = " from payments p join payment_requests pr on pr.id = p.payment_request_id where pr.business_id = :b and p.status = 'verified' and p.verified_at >= :s";
        long[] t = jdbc.sql("select count(*), coalesce(sum(p.amount), 0), coalesce(sum(p.savings), 0), count(distinct p.customer_id)" + paidAtB).param("b", b).param("s", since)
                .query((rs, i) -> new long[]{rs.getLong(1), rs.getLong(2), rs.getLong(3), rs.getLong(4)}).single();
        int repeat = jdbc.sql("select count(*) from (select p.customer_id" + paidAtB + " group by p.customer_id having count(*) > 1) x").param("b", b).param("s", since).query(Integer.class).single();
        int started = jdbc.sql("select count(*) from redemptions where business_id = :b and created_at >= :s").param("b", b).param("s", since).query(Integer.class).single();
        int offersLive = jdbc.sql("select count(*) from offers where business_id = :b and review_status = 'approved' and active and starts_at <= :n and ends_at > :n").param("b", b).param("n", now).query(Integer.class).single();
        int offersPending = jdbc.sql("select count(*) from offers where business_id = :b and review_status = 'pending'").param("b", b).query(Integer.class).single();
        int eventsLive = jdbc.sql("select count(*) from events where business_id = :b and status = 'published' and starts_at > :n").param("b", b).param("n", now).query(Integer.class).single();
        int eventsPending = jdbc.sql("select count(*) from events where business_id = :b and status = 'pending'").param("b", b).query(Integer.class).single();

        List<OfferResult> offers = jdbc.sql("select o.id, o.title, o.review_status, (o.review_status = 'approved' and o.active and o.starts_at <= :n and o.ends_at > :n) live, count(distinct r.id) started, "
                        + "count(distinct p.id) paid, coalesce(sum(p.amount), 0) sales, coalesce(sum(p.savings), 0) discount from offers o "
                        + "left join redemptions r on r.offer_id = o.id and r.created_at >= :s left join payment_requests pr on pr.redemption_id = r.id "
                        + "left join payments p on p.payment_request_id = pr.id and p.status = 'verified' where o.business_id = :b group by o.id, o.title, o.review_status, o.active, o.starts_at, o.ends_at "
                        + "order by sales desc, started desc, o.title")
                .param("b", b).param("s", since).param("n", now)
                .query((rs, i) -> new OfferResult(rs.getString("id"), rs.getString("title"), rs.getString("review_status"), rs.getBoolean("live"), rs.getInt("started"), rs.getInt("paid"),
                        rs.getLong("sales"), rs.getLong("discount"))).list();

        OffsetDateTime today = now.atZoneSameInstant(IST).toLocalDate().atStartOfDay(IST).toOffsetDateTime();
        List<Day> lastDays = new ArrayList<>();
        for (int d = 13; d >= 0; d--) {
            OffsetDateTime from = today.minusDays(d);
            long[] r = jdbc.sql("select count(*), coalesce(sum(p.amount), 0) from payments p join payment_requests pr on pr.id = p.payment_request_id "
                            + "where pr.business_id = :b and p.status = 'verified' and p.verified_at >= :f and p.verified_at < :u").param("b", b).param("f", from).param("u", from.plusDays(1))
                    .query((rs, i) -> new long[]{rs.getLong(1), rs.getLong(2)}).single();
            lastDays.add(new Day(from.toLocalDate().toString(), r[1], (int) r[0]));
        }
        Settlements.MerchantView money = settlements.merchantView(b);
        return new Results(span, (int) t[3], repeat, started, (int) t[0], t[1], t[2], t[0] == 0 ? 0 : t[1] / t[0], offersLive, offersPending, eventsLive, eventsPending,
                money.unsettled(), money.awaitingPayout(), money.paidOut(), offers, lastDays);
    }
}
