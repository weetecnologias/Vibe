package in.vibe.backend.coupons;

import in.vibe.backend.audit.AuditService;
import in.vibe.backend.catalogue.OfferRules;
import in.vibe.backend.common.ApiException;
import in.vibe.backend.security.StaffPrincipal;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Types;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * Codes customers can apply when paying for movie or event tickets. Admins define them here; the checkout module applies them and
 * checks who may use them (members, first booking, limits) when payments arrive.
 */
@Service
public class Coupons {
    public record Input(
            @NotBlank @Pattern(regexp = "^[A-Za-z0-9]{3,20}$", message = "must be 3 to 20 letters or numbers") String code,
            @NotBlank @Size(max = 120) String title,
            @Size(max = 200) String description,
            Boolean memberOnly,
            @NotEmpty List<@Pattern(regexp = "tickets|movie") String> kinds,
            @NotBlank @Pattern(regexp = "percentage|flat") String kind,
            @Min(1) @Max(9000) Integer rateBps, @Min(1) Long flatAmount, @Min(1) Long maxDiscount, @Min(0) Long minBill,
            Boolean firstBookingOnly, @Min(1) Integer maxUsesPerUser, @Size(max = 8) List<@NotBlank @Size(max = 200) String> terms,
            @NotNull OffsetDateTime startsAt, @NotNull OffsetDateTime endsAt, Boolean active) {}

    public record Row(String id, String code, String title, String description, boolean memberOnly, List<String> kinds, String kind, Integer rateBps, Long flatAmount, Long maxDiscount,
                      Long minBill, boolean firstBookingOnly, Integer maxUsesPerUser, List<String> terms, OffsetDateTime startsAt, OffsetDateTime endsAt, boolean active) {}

    private final JdbcClient jdbc;
    private final AuditService audit;

    Coupons(JdbcClient jdbc, AuditService audit) {
        this.jdbc = jdbc;
        this.audit = audit;
    }

    private static Row map(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        Object bps = rs.getObject("rate_bps"), flat = rs.getObject("flat_amount"), max = rs.getObject("max_discount"), min = rs.getObject("min_bill"), uses = rs.getObject("max_uses_per_user");
        return new Row(rs.getString("id"), rs.getString("code"), rs.getString("title"), rs.getString("description"), rs.getBoolean("member_only"), List.of((String[]) rs.getArray("kinds").getArray()),
                rs.getString("kind"), bps == null ? null : ((Number) bps).intValue(), flat == null ? null : ((Number) flat).longValue(), max == null ? null : ((Number) max).longValue(),
                min == null ? null : ((Number) min).longValue(), rs.getBoolean("first_booking_only"), uses == null ? null : ((Number) uses).intValue(), List.of((String[]) rs.getArray("terms").getArray()),
                rs.getObject("starts_at", OffsetDateTime.class), rs.getObject("ends_at", OffsetDateTime.class), rs.getBoolean("active"));
    }

    public List<Row> list() {
        return jdbc.sql("select * from checkout_coupons order by active desc, ends_at desc").query(Coupons::map).list();
    }

    @Transactional
    public Row create(StaffPrincipal who, Input in) {
        OfferRules.check(in.kind(), in.rateBps(), in.flatAmount(), in.maxDiscount(), in.minBill(), in.startsAt(), in.endsAt());
        UUID id = UUID.randomUUID();
        write("insert into checkout_coupons (id, code, title, description, member_only, kinds, kind, rate_bps, flat_amount, max_discount, min_bill, first_booking_only, max_uses_per_user, terms, starts_at, ends_at, active) "
                + "values (:id, :code, :t, :d, :m, :k, :kind, :bps, :flat, :max, :min, :fb, :uses, :terms, :s, :e, :a)", id, in);
        audit.record(who, "create", "coupon", id, in.code().toUpperCase(Locale.ROOT));
        return get(id);
    }

    @Transactional
    public Row update(StaffPrincipal who, UUID id, Input in) {
        get(id);
        OfferRules.check(in.kind(), in.rateBps(), in.flatAmount(), in.maxDiscount(), in.minBill(), in.startsAt(), in.endsAt());
        write("update checkout_coupons set code = :code, title = :t, description = :d, member_only = :m, kinds = :k, kind = :kind, rate_bps = :bps, flat_amount = :flat, max_discount = :max, "
                + "min_bill = :min, first_booking_only = :fb, max_uses_per_user = :uses, terms = :terms, starts_at = :s, ends_at = :e, active = :a, updated_at = now() where id = :id", id, in);
        audit.record(who, "update", "coupon", id, in.code().toUpperCase(Locale.ROOT));
        return get(id);
    }

    @Transactional
    public void delete(StaffPrincipal who, UUID id) {
        Row r = get(id);
        jdbc.sql("delete from checkout_coupons where id = :id").param("id", id).update();
        audit.record(who, "delete", "coupon", id, r.code());
    }

    private void write(String sql, UUID id, Input in) {
        jdbc.sql(sql).param("id", id).param("code", in.code().trim().toUpperCase(Locale.ROOT)).param("t", in.title().trim()).param("d", in.description() == null ? "" : in.description().trim())
                .param("m", in.memberOnly() != null && in.memberOnly()).param("k", in.kinds().stream().distinct().toArray(String[]::new)).param("kind", in.kind())
                .param("bps", in.rateBps(), Types.INTEGER).param("flat", in.flatAmount(), Types.BIGINT).param("max", in.maxDiscount(), Types.BIGINT).param("min", in.minBill(), Types.BIGINT)
                .param("fb", in.firstBookingOnly() != null && in.firstBookingOnly()).param("uses", in.maxUsesPerUser(), Types.INTEGER)
                .param("terms", (in.terms() == null ? List.<String>of() : in.terms().stream().map(String::trim).toList()).toArray(new String[0]))
                .param("s", in.startsAt()).param("e", in.endsAt()).param("a", in.active() == null || in.active()).update();
    }

    private Row get(UUID id) {
        return jdbc.sql("select * from checkout_coupons where id = :id").param("id", id).query(Coupons::map).optional().orElseThrow(() -> ApiException.notFound("Coupon not found."));
    }
}
