package in.vibe.backend.membership;

import in.vibe.backend.audit.AuditService;
import in.vibe.backend.common.ApiException;
import in.vibe.backend.security.StaffPrincipal;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

/** What VIBE membership costs. Customers see only active plans; admins manage all of them. */
@Service
public class Plans {
    /** What the customer app shows (`MembershipPlan`), plus the benefit list. */
    public record PublicPlan(String id, String name, String interval, long price, String note, String savingsLabel, List<String> benefits) {}

    public record Row(String id, String name, String interval, long price, String note, String savingsLabel, List<String> benefits, int sortOrder, boolean active) {}

    public record Input(@NotBlank @Size(max = 60) String name, @NotBlank @Pattern(regexp = "month|year") String interval, @NotNull @Min(0) @Max(100_000_00) Long price,
                        @Size(max = 160) String note, @Size(max = 60) String savingsLabel, @Size(max = 12) List<@NotBlank @Size(max = 120) String> benefits,
                        @Min(0) Integer sortOrder, Boolean active) {}

    private final JdbcClient jdbc;
    private final AuditService audit;

    Plans(JdbcClient jdbc, AuditService audit) {
        this.jdbc = jdbc;
        this.audit = audit;
    }

    private static Row map(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        java.sql.Array b = rs.getArray("benefits");
        return new Row(rs.getString("id"), rs.getString("name"), rs.getString("interval"), rs.getLong("price"), rs.getString("note"), rs.getString("savings_label"),
                b == null ? List.of() : List.of((String[]) b.getArray()), rs.getInt("sort_order"), rs.getBoolean("active"));
    }

    public List<PublicPlan> publicList() {
        return jdbc.sql("select * from membership_plans where active order by sort_order, price").query(Plans::map).list().stream()
                .map(r -> new PublicPlan(r.id(), r.name(), r.interval(), r.price(), r.note(), r.savingsLabel(), r.benefits())).toList();
    }

    public List<Row> adminList() {
        return jdbc.sql("select * from membership_plans order by sort_order, price").query(Plans::map).list();
    }

    @Transactional
    public Row create(StaffPrincipal who, Input in) {
        UUID id = UUID.randomUUID();
        jdbc.sql("insert into membership_plans (id, name, interval, price, note, savings_label, benefits, sort_order, active) values (:id, :n, :i, :p, :no, :sl, :b, :o, :a)")
                .param("id", id).param("n", in.name().trim()).param("i", in.interval()).param("p", in.price()).param("no", text(in.note())).param("sl", blank(in.savingsLabel()))
                .param("b", benefits(in)).param("o", in.sortOrder() == null ? 0 : in.sortOrder()).param("a", in.active() == null || in.active()).update();
        audit.record(who, "create", "membership_plan", id, in.name());
        return get(id);
    }

    @Transactional
    public Row update(StaffPrincipal who, UUID id, Input in) {
        get(id);
        jdbc.sql("update membership_plans set name = :n, interval = :i, price = :p, note = :no, savings_label = :sl, benefits = :b, sort_order = :o, active = :a, updated_at = now() where id = :id")
                .param("id", id).param("n", in.name().trim()).param("i", in.interval()).param("p", in.price()).param("no", text(in.note())).param("sl", blank(in.savingsLabel()))
                .param("b", benefits(in)).param("o", in.sortOrder() == null ? 0 : in.sortOrder()).param("a", in.active() == null || in.active()).update();
        audit.record(who, "update", "membership_plan", id, in.name());
        return get(id);
    }

    /** Switching a plan off hides it from new members without touching people who already have it. Deleting is for plans nobody has used. */
    @Transactional
    public void delete(StaffPrincipal who, UUID id) {
        Row r = get(id);
        jdbc.sql("delete from membership_plans where id = :id").param("id", id).update();
        audit.record(who, "delete", "membership_plan", id, r.name());
    }

    private Row get(UUID id) {
        return jdbc.sql("select * from membership_plans where id = :id").param("id", id).query(Plans::map).optional().orElseThrow(() -> ApiException.notFound("Plan not found."));
    }

    private static String[] benefits(Input in) { return (in.benefits() == null ? List.<String>of() : in.benefits().stream().map(String::trim).toList()).toArray(new String[0]); }
    private static String text(String s) { return s == null ? "" : s.trim(); }
    private static String blank(String s) { return s == null || s.isBlank() ? null : s.trim(); }
}
