package in.vibe.backend.finance;

import in.vibe.backend.audit.AuditService;
import in.vibe.backend.common.ApiException;
import in.vibe.backend.security.StaffPrincipal;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * VIBE's commission rates, with history. The rate for a payment is the business's own card, else the nearest category card up the tree, else the
 * platform card, as of when the payment was confirmed. Cards are only ever added, never edited, so what was agreed on any date can be shown.
 * Also the GST rate charged on VIBE's commission.
 */
@Service
public class RateCards {
    public static final String GST_KEY = "commission_gst_bps";

    /** source: business, category, platform or none (no card anywhere: 0%). */
    public record Rate(int bps, String source, String sourceName, String cardId) {}

    public record Card(String id, String scope, String targetId, String targetName, int commissionBps, OffsetDateTime effectiveFrom, String reason, String createdBy, OffsetDateTime createdAt) {}

    /** scope: platform, category or business. */
    public record Input(@NotBlank String scope, String targetId, @NotNull @Min(0) @Max(5000) Integer commissionBps, OffsetDateTime effectiveFrom, @NotBlank @Size(min = 3, max = 200) String reason) {}

    public record Tax(int commissionGstBps) {}

    private final JdbcClient jdbc;
    private final AuditService audit;
    private final Clock clock;

    RateCards(JdbcClient jdbc, AuditService audit, Clock clock) {
        this.jdbc = jdbc;
        this.audit = audit;
        this.clock = clock;
    }

    /** The rate a business pays at a moment. */
    public Rate rateFor(UUID business, OffsetDateTime at) {
        var own = jdbc.sql("select id, commission_bps from rate_cards where business_id = :b and effective_from <= :at order by effective_from desc, created_at desc limit 1").param("b", business).param("at", at)
                .query((rs, i) -> new Rate(rs.getInt(2), "business", "", rs.getString(1))).optional();
        if (own.isPresent()) return own.get();
        var cat = jdbc.sql("""
                with recursive chain as (
                    select c.id, c.parent_id, c.name, 0 depth from categories c join businesses b on b.primary_category_id = c.id where b.id = :b
                    union all
                    select p.id, p.parent_id, p.name, ch.depth + 1 from categories p join chain ch on p.id = ch.parent_id)
                select rc.id, rc.commission_bps, ch.name from chain ch join rate_cards rc on rc.category_id = ch.id and rc.effective_from <= :at
                order by ch.depth, rc.effective_from desc, rc.created_at desc limit 1
                """).param("b", business).param("at", at).query((rs, i) -> new Rate(rs.getInt(2), "category", rs.getString(3), rs.getString(1))).optional();
        if (cat.isPresent()) return cat.get();
        return jdbc.sql("select id, commission_bps from rate_cards where business_id is null and category_id is null and effective_from <= :at order by effective_from desc, created_at desc limit 1").param("at", at)
                .query((rs, i) -> new Rate(rs.getInt(2), "platform", "Platform", rs.getString(1))).optional().orElse(new Rate(0, "none", "", null));
    }

    public Rate rateNow(UUID business) { return rateFor(business, OffsetDateTime.now(clock)); }

    // ---------- GST on commission ----------
    public int gstBps() {
        return jdbc.sql("select value from platform_settings where key = :k").param("k", GST_KEY).query(String.class).optional().map(Integer::parseInt).orElse(0);
    }

    @Transactional
    public Tax setGst(StaffPrincipal who, int bps) {
        if (bps < 0 || bps > 4000) throw ApiException.badRequest("gst", "GST on commission must be between 0% and 40%.");
        int before = gstBps();
        jdbc.sql("insert into platform_settings (key, value, updated_by) values (:k, :v, :by) on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by")
                .param("k", GST_KEY).param("v", String.valueOf(bps)).param("by", who.id()).update();
        audit.record(who, "gst", "platform", null, "GST on commission " + before / 100.0 + "% -> " + bps / 100.0 + "%. Applies to payments confirmed from now on.");
        return new Tax(bps);
    }

    // ---------- cards ----------
    @Transactional
    public Card add(StaffPrincipal who, Input in) {
        UUID target = null;
        switch (in.scope()) {
            case "platform" -> { }
            case "category" -> {
                target = id(in.targetId());
                if (jdbc.sql("select count(*) from categories where id = :id").param("id", target).query(Integer.class).single() == 0) throw ApiException.badRequest("target", "That category doesn’t exist.");
            }
            case "business" -> {
                target = id(in.targetId());
                if (jdbc.sql("select count(*) from businesses where id = :id").param("id", target).query(Integer.class).single() == 0) throw ApiException.badRequest("target", "That business doesn’t exist.");
            }
            default -> throw ApiException.badRequest("scope", "Choose platform, category or business.");
        }
        OffsetDateTime from = in.effectiveFrom() == null ? OffsetDateTime.now(clock) : in.effectiveFrom();
        UUID id = UUID.randomUUID();
        jdbc.sql("insert into rate_cards (id, category_id, business_id, commission_bps, effective_from, reason, created_by) values (:id, :c, :b, :bps, :f, :r, :by)")
                .param("id", id).param("c", "category".equals(in.scope()) ? target : null, java.sql.Types.OTHER).param("b", "business".equals(in.scope()) ? target : null, java.sql.Types.OTHER)
                .param("bps", in.commissionBps()).param("f", from).param("r", in.reason().trim()).param("by", who.id()).update();
        // Older screens still read the business's own number.
        if ("business".equals(in.scope())) jdbc.sql("update businesses set commission_bps = :c, updated_at = now() where id = :id").param("c", in.commissionBps()).param("id", target).update();
        audit.record(who, "rate_card", in.scope(), id, in.scope() + (target == null ? "" : " " + target) + " " + in.commissionBps() / 100.0 + "% from " + from + ". " + in.reason().trim());
        return one(id);
    }

    private static UUID id(String raw) {
        try { return UUID.fromString(raw); } catch (RuntimeException e) { throw ApiException.badRequest("target", "Choose a category or business."); }
    }

    private static final String SELECT = "select rc.*, coalesce(b.name, c.name) tname, u.name uname from rate_cards rc left join businesses b on b.id = rc.business_id left join categories c on c.id = rc.category_id "
            + "left join staff_users u on u.id = rc.created_by ";

    private Card map(java.sql.ResultSet rs) throws java.sql.SQLException {
        String scope = rs.getObject("business_id") != null ? "business" : rs.getObject("category_id") != null ? "category" : "platform";
        String target = rs.getObject("business_id") != null ? rs.getString("business_id") : rs.getString("category_id");
        return new Card(rs.getString("id"), scope, target, rs.getString("tname") == null ? "Whole platform" : rs.getString("tname"), rs.getInt("commission_bps"), rs.getObject("effective_from", OffsetDateTime.class),
                rs.getString("reason"), rs.getString("uname"), rs.getObject("created_at", OffsetDateTime.class));
    }

    public Card one(UUID id) {
        return jdbc.sql(SELECT + "where rc.id = :id").param("id", id).query((rs, i) -> map(rs)).optional().orElseThrow(() -> ApiException.notFound("Rate card not found."));
    }

    /** Newest first. scope and target narrow it. */
    public List<Card> list(String scope, String target) {
        StringBuilder w = new StringBuilder(" where true");
        if ("platform".equals(scope)) w.append(" and rc.business_id is null and rc.category_id is null");
        if ("category".equals(scope)) w.append(" and rc.category_id is not null");
        if ("business".equals(scope)) w.append(" and rc.business_id is not null");
        if (target != null && !target.isBlank()) w.append(" and (rc.business_id = :t or rc.category_id = :t)");
        JdbcClient.StatementSpec s = jdbc.sql(SELECT + w + " order by rc.effective_from desc, rc.created_at desc limit 500");
        if (target != null && !target.isBlank()) s.param("t", id(target));
        return s.query((rs, i) -> map(rs)).list();
    }
}
