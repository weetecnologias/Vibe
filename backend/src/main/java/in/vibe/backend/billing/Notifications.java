package in.vibe.backend.billing;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * Tells customers things like "your bill is ready". Every notification is saved to the customer's inbox, which the app reads,
 * and is handed to the push service. Push needs Firebase and Apple push accounts, which are not connected yet, so for now
 * the app finds out by asking (the redeem screen checks every few seconds) and by reading its inbox.
 */
@Service
public class Notifications {
    public record Target(String type, String id) {}

    public record Item(String id, String kind, String title, String body, Target target, OffsetDateTime createdAt, boolean read) {}

    public record DeviceInput(@NotBlank @Size(max = 4096) String token, @NotBlank @Pattern(regexp = "android|ios|web") String platform) {}

    /** Sends a push to a customer's registered devices. */
    public interface PushSender {
        void send(List<String> deviceTokens, String title, String body);
    }

    /** Stands in until Firebase and Apple push are connected. It sends nothing. */
    @Component
    static class NoPush implements PushSender {
        private static final Logger log = LoggerFactory.getLogger(NoPush.class);

        @Override public void send(List<String> deviceTokens, String title, String body) { log.info("Push not connected; not sent to {} device(s): {}", deviceTokens.size(), title); }
    }

    private final JdbcClient jdbc;
    private final PushSender push;

    Notifications(JdbcClient jdbc, PushSender push) {
        this.jdbc = jdbc;
        this.push = push;
    }

    /** Saved in the same transaction as whatever caused it, then pushed. */
    public void notify(UUID customer, String kind, String title, String body, String targetType, String targetId) {
        jdbc.sql("insert into notifications (id, customer_id, kind, title, body, target_type, target_id) values (:id, :c, :k, :t, :b, :tt, :ti)")
                .param("id", UUID.randomUUID()).param("c", customer).param("k", kind).param("t", title).param("b", body).param("tt", targetType).param("ti", targetId).update();
        List<String> tokens = jdbc.sql("select token from device_tokens where customer_id = :c").param("c", customer).query(String.class).list();
        if (!tokens.isEmpty()) push.send(tokens, title, body);
    }

    public List<Item> list(UUID customer, boolean unreadOnly) {
        return jdbc.sql("select * from notifications where customer_id = :c" + (unreadOnly ? " and read_at is null" : "") + " order by created_at desc limit 50").param("c", customer)
                .query((rs, i) -> new Item(rs.getString("id"), rs.getString("kind"), rs.getString("title"), rs.getString("body"),
                        rs.getString("target_type") == null ? null : new Target(rs.getString("target_type"), rs.getString("target_id")), rs.getObject("created_at", OffsetDateTime.class), rs.getObject("read_at") != null)).list();
    }

    @Transactional
    public void markRead(UUID customer, UUID id) {
        jdbc.sql("update notifications set read_at = now() where id = :id and customer_id = :c and read_at is null").param("id", id).param("c", customer).update();
    }

    @Transactional
    public void markAllRead(UUID customer) {
        jdbc.sql("update notifications set read_at = now() where customer_id = :c and read_at is null").param("c", customer).update();
    }

    @Transactional
    public void registerDevice(UUID customer, DeviceInput in) {
        jdbc.sql("insert into device_tokens (token, customer_id, platform, updated_at) values (:t, :c, :p, now()) on conflict (token) do update set customer_id = :c, platform = :p, updated_at = now()")
                .param("t", in.token()).param("c", customer).param("p", in.platform()).update();
    }
}
