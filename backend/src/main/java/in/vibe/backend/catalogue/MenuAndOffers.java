package in.vibe.backend.catalogue;

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

import java.sql.Types;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/** A merchant's menu and Pay & Redeem offers. Every method works on one business, taken from the token and never from the request. */
@Service
public class MenuAndOffers {
    public record MenuInput(@NotBlank @Size(max = 120) String name, @Size(max = 200) String note, @NotNull @Min(0) Long price, @Size(max = 60) String section,
                            @Pattern(regexp = Categories.HTTP_URL, message = "must be an http(s) link") String imageUrl, @Min(0) Integer sortOrder, Boolean active) {}

    public record MenuRow(String id, String name, String note, long price, String section, String imageUrl, int sortOrder, boolean active) {}

    /** Percentage offers use `rateBps` (basis points: 3000 = 30%) and an optional cap; flat offers use `flatAmount` in paise. */
    public record OfferInput(@NotBlank @Size(max = 120) String title, @NotBlank @Pattern(regexp = "percentage|flat") String kind,
                             @Min(1) @Max(9000) Integer rateBps, @Min(1) Long flatAmount, @Min(1) Long maxDiscount, @Min(0) Long minBill, Boolean memberOnly,
                             @Size(max = 80) String scheduleLabel, @NotNull OffsetDateTime startsAt, @NotNull OffsetDateTime endsAt, Boolean active) {}

    /** reviewStatus: pending (waiting for VIBE), approved (can go live) or rejected (see reviewNote). */
    public record OfferRow(String id, String title, String kind, Integer rateBps, Long flatAmount, Long maxDiscount, Long minBill, boolean memberOnly, String scheduleLabel,
                           OffsetDateTime startsAt, OffsetDateTime endsAt, boolean active, String reviewStatus, String reviewNote) {}

    private final JdbcClient jdbc;
    private final AuditService audit;
    private final BillingRules rules;
    private final in.vibe.backend.notify.StaffNotifications staffNotifications;

    MenuAndOffers(JdbcClient jdbc, AuditService audit, BillingRules rules, in.vibe.backend.notify.StaffNotifications staffNotifications) {
        this.jdbc = jdbc;
        this.audit = audit;
        this.rules = rules;
        this.staffNotifications = staffNotifications;
    }

    // ---------- menu ----------
    public List<MenuRow> menu(UUID business) {
        return jdbc.sql("select * from menu_items where business_id = :b order by sort_order, name").param("b", business)
                .query((rs, i) -> new MenuRow(rs.getString("id"), rs.getString("name"), rs.getString("note"), rs.getLong("price"), rs.getString("section"), rs.getString("image_url"),
                        rs.getInt("sort_order"), rs.getBoolean("active"))).list();
    }

    @Transactional
    public MenuRow addMenu(StaffPrincipal who, MenuInput in) {
        UUID b = who.requireBusiness(), id = UUID.randomUUID();
        jdbc.sql("insert into menu_items (id, business_id, name, note, price, section, image_url, sort_order, active) values (:id, :b, :n, :no, :p, :s, :im, :o, :a)")
                .param("id", id).param("b", b).param("n", in.name().trim()).param("no", in.note() == null ? "" : in.note().trim()).param("p", in.price())
                .param("s", blank(in.section())).param("im", blank(in.imageUrl())).param("o", in.sortOrder() == null ? 0 : in.sortOrder()).param("a", in.active() == null || in.active()).update();
        audit.record(who, "create", "menu_item", id, in.name());
        return menuRow(b, id);
    }

    @Transactional
    public MenuRow updateMenu(StaffPrincipal who, UUID id, MenuInput in) {
        UUID b = who.requireBusiness();
        int n = jdbc.sql("update menu_items set name = :n, note = :no, price = :p, section = :s, image_url = :im, sort_order = :o, active = :a where id = :id and business_id = :b")
                .param("id", id).param("b", b).param("n", in.name().trim()).param("no", in.note() == null ? "" : in.note().trim()).param("p", in.price()).param("s", blank(in.section()))
                .param("im", blank(in.imageUrl())).param("o", in.sortOrder() == null ? 0 : in.sortOrder()).param("a", in.active() == null || in.active()).update();
        if (n == 0) throw ApiException.notFound("Menu item not found.");
        audit.record(who, "update", "menu_item", id, in.name());
        return menuRow(b, id);
    }

    @Transactional
    public void deleteMenu(StaffPrincipal who, UUID id) {
        if (jdbc.sql("delete from menu_items where id = :id and business_id = :b").param("id", id).param("b", who.requireBusiness()).update() == 0) throw ApiException.notFound("Menu item not found.");
        audit.record(who, "delete", "menu_item", id, "");
    }

    private MenuRow menuRow(UUID b, UUID id) {
        return menu(b).stream().filter(m -> m.id().equals(id.toString())).findFirst().orElseThrow(() -> ApiException.notFound("Menu item not found."));
    }

    // ---------- offers ----------
    public List<OfferRow> offers(UUID business) {
        return jdbc.sql("select * from offers where business_id = :b order by active desc, ends_at desc").param("b", business)
                .query((rs, i) -> {
                    Object bps = rs.getObject("rate_bps"), flat = rs.getObject("flat_amount"), max = rs.getObject("max_discount"), min = rs.getObject("min_bill");
                    return new OfferRow(rs.getString("id"), rs.getString("title"), rs.getString("kind"), bps == null ? null : ((Number) bps).intValue(), flat == null ? null : ((Number) flat).longValue(),
                            max == null ? null : ((Number) max).longValue(), min == null ? null : ((Number) min).longValue(), rs.getBoolean("member_only"), rs.getString("schedule_label"),
                            rs.getObject("starts_at", OffsetDateTime.class), rs.getObject("ends_at", OffsetDateTime.class), rs.getBoolean("active"), rs.getString("review_status"), rs.getString("review_note"));
                }).list();
    }

    @Transactional
    public OfferRow addOffer(StaffPrincipal who, OfferInput in) {
        UUID b = who.requireBusiness(), id = UUID.randomUUID();
        check(in);
        if (!rules.forBusiness(b).payRedeem()) throw ApiException.conflict("not_applicable", "Offers with bills aren’t used for this type of business. Tickets and bookings are set up under Events.");
        jdbc.sql("insert into offers (id, business_id, title, kind, rate_bps, flat_amount, max_discount, min_bill, member_only, schedule_label, starts_at, ends_at, active) "
                        + "values (:id, :b, :t, :k, :bps, :flat, :max, :min, :m, :sl, :s, :e, :a)")
                .param("id", id).param("b", b).param("t", in.title().trim()).param("k", in.kind()).param("bps", in.rateBps(), Types.INTEGER).param("flat", in.flatAmount(), Types.BIGINT)
                .param("max", in.maxDiscount(), Types.BIGINT).param("min", in.minBill(), Types.BIGINT).param("m", in.memberOnly() != null && in.memberOnly())
                .param("sl", in.scheduleLabel() == null || in.scheduleLabel().isBlank() ? "Every day" : in.scheduleLabel().trim()).param("s", in.startsAt()).param("e", in.endsAt())
                .param("a", in.active() == null || in.active()).update();
        audit.record(who, "create", "offer", id, in.title());
        if (autoApprove(b)) publishOnTrust(b, id, in.title());
        else staffNotifications.toAdmins("offer_review", "Offer waiting for review", businessName(b) + ": " + in.title(), "/offers");
        return offerRow(b, id);
    }

    @Transactional
    public OfferRow updateOffer(StaffPrincipal who, UUID id, OfferInput in) {
        UUID b = who.requireBusiness();
        check(in);
        OfferRow before = offerRow(b, id);
        String sl = in.scheduleLabel() == null || in.scheduleLabel().isBlank() ? "Every day" : in.scheduleLabel().trim();
        // Changing what the offer is sends it back for review. Only switching it on or off does not.
        boolean changed = !before.title().equals(in.title().trim()) || !before.kind().equals(in.kind()) || !java.util.Objects.equals(before.rateBps(), in.rateBps())
                || !java.util.Objects.equals(before.flatAmount(), in.flatAmount()) || !java.util.Objects.equals(before.maxDiscount(), in.maxDiscount())
                || !java.util.Objects.equals(before.minBill(), in.minBill()) || before.memberOnly() != (in.memberOnly() != null && in.memberOnly()) || !before.scheduleLabel().equals(sl)
                || !before.startsAt().toInstant().equals(in.startsAt().toInstant()) || !before.endsAt().toInstant().equals(in.endsAt().toInstant());
        int n = jdbc.sql("update offers set title = :t, kind = :k, rate_bps = :bps, flat_amount = :flat, max_discount = :max, min_bill = :min, member_only = :m, schedule_label = :sl, "
                        + "starts_at = :s, ends_at = :e, active = :a, updated_at = now()" + (changed ? ", review_status = 'pending', auto_approved = false, review_note = null, reviewed_at = null, reviewed_by = null" : "") + " where id = :id and business_id = :b")
                .param("id", id).param("b", b).param("t", in.title().trim()).param("k", in.kind()).param("bps", in.rateBps(), Types.INTEGER).param("flat", in.flatAmount(), Types.BIGINT)
                .param("max", in.maxDiscount(), Types.BIGINT).param("min", in.minBill(), Types.BIGINT).param("m", in.memberOnly() != null && in.memberOnly())
                .param("sl", in.scheduleLabel() == null || in.scheduleLabel().isBlank() ? "Every day" : in.scheduleLabel().trim()).param("s", in.startsAt()).param("e", in.endsAt())
                .param("a", in.active() == null || in.active()).update();
        if (n == 0) throw ApiException.notFound("Offer not found.");
        audit.record(who, "update", "offer", id, in.title());
        if (changed && autoApprove(b)) publishOnTrust(b, id, in.title());
        else if (changed) staffNotifications.toAdmins("offer_review", "Offer changed, waiting for review", businessName(b) + ": " + in.title(), "/offers");
        return offerRow(b, id);
    }

    private boolean autoApprove(UUID b) {
        return jdbc.sql("select auto_approve from businesses where id = :b").param("b", b).query(Boolean.class).single();
    }

    /** A business VIBE trusts goes live without waiting. Admins are still told, and can switch the offer off or reject it later. */
    private void publishOnTrust(UUID b, UUID id, String title) {
        jdbc.sql("update offers set review_status = 'approved', auto_approved = true, review_note = null, reviewed_at = now(), reviewed_by = null where id = :id").param("id", id).update();
        audit.record(null, "auto_approve", "offer", id, title);
        staffNotifications.toAdmins("offer_auto", "Offer live (auto-approved)", businessName(b) + ": " + title, "/offers");
    }

    /** Offers that customers have already used can't be deleted, only switched off. Until redemptions exist, delete removes it. */
    @Transactional
    public void deleteOffer(StaffPrincipal who, UUID id) {
        if (jdbc.sql("delete from offers where id = :id and business_id = :b").param("id", id).param("b", who.requireBusiness()).update() == 0) throw ApiException.notFound("Offer not found.");
        audit.record(who, "delete", "offer", id, "");
    }

    private OfferRow offerRow(UUID b, UUID id) {
        return offers(b).stream().filter(o -> o.id().equals(id.toString())).findFirst().orElseThrow(() -> ApiException.notFound("Offer not found."));
    }

    /** The rule must be complete and the dates sensible: a percentage needs a rate, a flat offer needs an amount, and a cap only makes sense on a percentage. */
    private static void check(OfferInput in) {
        OfferRules.check(in.kind(), in.rateBps(), in.flatAmount(), in.maxDiscount(), in.minBill(), in.startsAt(), in.endsAt());
    }

    private String businessName(UUID b) { return jdbc.sql("select name from businesses where id = :id").param("id", b).query(String.class).single(); }

    private static String blank(String s) { return s == null || s.isBlank() ? null : s.trim(); }
}
