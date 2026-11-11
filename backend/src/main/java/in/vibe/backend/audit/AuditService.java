package in.vibe.backend.audit;

import in.vibe.backend.security.StaffPrincipal;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/** Who changed what. Written in the same transaction as the change. */
@Service
public class AuditService {
    private final JdbcClient jdbc;

    AuditService(JdbcClient jdbc) { this.jdbc = jdbc; }

    public void record(StaffPrincipal who, String action, String entity, Object entityId, String detail) {
        jdbc.sql("insert into audit_log (actor_id, actor_role, action, entity, entity_id, detail) values (:a, :r, :act, :e, :eid, :d)")
                .param("a", who == null ? null : who.id()).param("r", who == null ? "SYSTEM" : who.role())
                .param("act", action).param("e", entity).param("eid", String.valueOf(entityId)).param("d", detail == null ? "" : detail)
                .update();
    }

    public record Entry(long id, OffsetDateTime at, UUID actorId, String actorRole, String action, String entity, String entityId, String detail) {}

    public List<Entry> latest(int limit) {
        return jdbc.sql("select * from audit_log order by id desc limit :n").param("n", Math.min(Math.max(limit, 1), 200))
                .query((rs, i) -> new Entry(rs.getLong("id"), rs.getObject("at", OffsetDateTime.class), (UUID) rs.getObject("actor_id"),
                        rs.getString("actor_role"), rs.getString("action"), rs.getString("entity"), rs.getString("entity_id"), rs.getString("detail")))
                .list();
    }
}
