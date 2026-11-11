package in.vibe.backend.notify;

import in.vibe.backend.security.StaffPrincipal;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * The alerts shown on the merchant and admin dashboards: a customer wants to redeem, a payment arrived, something is waiting for review.
 * A merchant's alerts are shared by their whole team. The dashboards check for new ones every few seconds and make a sound and a banner;
 * there is no separate push channel for staff.
 */
@Service
public class StaffNotifications {
    public record Item(String id, String kind, String title, String body, String link, OffsetDateTime createdAt, boolean read) {}

    public record Inbox(int unread, List<Item> items) {}

    private final JdbcClient jdbc;

    StaffNotifications(JdbcClient jdbc) { this.jdbc = jdbc; }

    /** Saved in the same transaction as whatever caused it. `link` is a dashboard path such as "/bills". */
    public void toBusiness(UUID business, String kind, String title, String body, String link) {
        jdbc.sql("insert into staff_notifications (id, audience, business_id, kind, title, body, link) values (:id, 'merchant', :b, :k, :t, :body, :l)")
                .param("id", UUID.randomUUID()).param("b", business).param("k", kind).param("t", title).param("body", body == null ? "" : body).param("l", link).update();
    }

    public void toAdmins(String kind, String title, String body, String link) {
        jdbc.sql("insert into staff_notifications (id, audience, business_id, kind, title, body, link) values (:id, 'admin', null, :k, :t, :body, :l)")
                .param("id", UUID.randomUUID()).param("k", kind).param("t", title).param("body", body == null ? "" : body).param("l", link).update();
    }

    private record Scope(String audience, UUID business) {}

    private static Scope scope(StaffPrincipal who) {
        return "ADMIN".equals(who.role()) ? new Scope("admin", null) : new Scope("merchant", who.requireBusiness());
    }

    public Inbox inbox(StaffPrincipal who, int limit) {
        Scope s = scope(who);
        String where = "audience = :a and business_id is not distinct from :b";
        int unread = jdbc.sql("select count(*) from staff_notifications where " + where + " and read_at is null").param("a", s.audience()).param("b", s.business(), java.sql.Types.OTHER).query(Integer.class).single();
        List<Item> items = jdbc.sql("select * from staff_notifications where " + where + " order by created_at desc limit :n").param("a", s.audience()).param("b", s.business(), java.sql.Types.OTHER).param("n", Math.min(Math.max(limit, 1), 100))
                .query((rs, i) -> new Item(rs.getString("id"), rs.getString("kind"), rs.getString("title"), rs.getString("body"), rs.getString("link"), rs.getObject("created_at", OffsetDateTime.class), rs.getObject("read_at") != null)).list();
        return new Inbox(unread, items);
    }

    @Transactional
    public void markRead(StaffPrincipal who, UUID id) {
        Scope s = scope(who);
        jdbc.sql("update staff_notifications set read_at = now() where id = :id and audience = :a and business_id is not distinct from :b and read_at is null").param("id", id).param("a", s.audience()).param("b", s.business(), java.sql.Types.OTHER).update();
    }

    @Transactional
    public void markAllRead(StaffPrincipal who) {
        Scope s = scope(who);
        jdbc.sql("update staff_notifications set read_at = now() where audience = :a and business_id is not distinct from :b and read_at is null").param("a", s.audience()).param("b", s.business(), java.sql.Types.OTHER).update();
    }
}
