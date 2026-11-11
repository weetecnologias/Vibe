package in.vibe.backend.venue;

import in.vibe.backend.audit.AuditService;
import in.vibe.backend.common.ApiException;
import in.vibe.backend.security.StaffPrincipal;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Types;
import java.util.UUID;

/**
 * What a venue charges when someone reserves a table or a court slot for a one-on-one, and its cancellation policy.
 * The venue sets these; the social module reads them when a host reserves. Off by default.
 */
@Service
public class ReservationSettings {
    public record Settings(boolean enabled, Long tableFee, Long slotFee, String policy) {}

    public record Input(boolean enabled, @Min(1) Long tableFee, @Min(1) Long slotFee, @Size(max = 600) String policy) {}

    private final JdbcClient jdbc;
    private final AuditService audit;

    ReservationSettings(JdbcClient jdbc, AuditService audit) {
        this.jdbc = jdbc;
        this.audit = audit;
    }

    public Settings get(UUID business) {
        return jdbc.sql("select * from reservation_settings where business_id = :b").param("b", business).query((rs, i) -> {
            Object t = rs.getObject("table_fee"), s = rs.getObject("slot_fee");
            return new Settings(rs.getBoolean("enabled"), t == null ? null : ((Number) t).longValue(), s == null ? null : ((Number) s).longValue(), rs.getString("policy"));
        }).optional().orElse(new Settings(false, null, null, ""));
    }

    @Transactional
    public Settings save(StaffPrincipal who, Input in) {
        UUID b = who.requireBusiness();
        String policy = in.policy() == null ? "" : in.policy().trim();
        if (in.enabled()) {
            if (in.tableFee() == null && in.slotFee() == null) throw ApiException.badRequest("fees", "Set a table fee, a slot fee, or both, before turning reservations on.");
            if (policy.length() < 10) throw ApiException.badRequest("policy", "Write the cancellation policy customers will see, for example when the fee is refunded.");
        }
        jdbc.sql("insert into reservation_settings (business_id, enabled, table_fee, slot_fee, policy, updated_at) values (:b, :e, :t, :s, :p, now()) "
                        + "on conflict (business_id) do update set enabled = :e, table_fee = :t, slot_fee = :s, policy = :p, updated_at = now()")
                .param("b", b).param("e", in.enabled()).param("t", in.tableFee(), Types.BIGINT).param("s", in.slotFee(), Types.BIGINT).param("p", policy).update();
        audit.record(who, "update", "reservation_settings", b, in.enabled() ? "on" : "off");
        return get(b);
    }
}
