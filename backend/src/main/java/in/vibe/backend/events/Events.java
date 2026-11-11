package in.vibe.backend.events;

import in.vibe.backend.audit.AuditService;
import in.vibe.backend.common.ApiException;
import in.vibe.backend.security.StaffPrincipal;
import jakarta.validation.Valid;
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
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Events and their ticket types. A merchant's event waits for VIBE to publish it; VIBE's own events publish straight away.
 * Selling tickets (holds, payments, QR codes) arrives with the ticketing module, so `remaining` equals the capacity for now.
 */
@Service
public class Events {
    static final String KINDS = "Workshops|Meetups|Tours|Live Events|Experiences|Movies";

    public record TicketTypeInput(@NotBlank @Size(max = 80) String name, @Size(max = 200) String description, @NotNull @Min(0) Long price,
                                  @NotNull @Min(0) @Max(100_000) Integer capacity, @Min(1) @Max(20) Integer maxPerOrder) {}

    public record Input(
            @NotBlank @Size(max = 120) String title,
            @NotBlank @Pattern(regexp = KINDS) String kind,
            @Size(max = 4000) String description,
            @NotBlank @Size(max = 120) String venue,
            @NotBlank @Size(max = 80) String area,
            @NotNull OffsetDateTime startsAt,
            OffsetDateTime gatesOpenAt,
            @Pattern(regexp = "^https?://\\S+$", message = "must be an http(s) link") String coverUrl,
            @Min(5) @Max(99) Integer ageLimit,
            @Size(max = 10) List<@NotBlank @Size(max = 200) String> terms,
            @Size(max = 120) String organiser,
            Boolean featured,
            @NotEmpty @Size(max = 10) List<@Valid TicketTypeInput> ticketTypes) {}

    public record TicketTypeRow(String id, String name, String description, long price, int capacity, int maxPerOrder) {}

    public record Row(String id, String businessId, String businessName, String organiser, String title, String kind, String description, String venue, String area, OffsetDateTime startsAt,
                      OffsetDateTime gatesOpenAt, String coverUrl, Integer ageLimit, boolean featured, List<String> terms, String status, String reviewNote, List<TicketTypeRow> ticketTypes) {}

    public record ListRow(String id, String title, String kind, String organiser, String venue, OffsetDateTime startsAt, String status, long fromPrice, int capacity) {}

    // ---- what the customer app reads (EventSummary, EventDetail) ----
    public record Tag(String label, String tone) {}

    public record PublicSummary(String id, String title, String kind, OffsetDateTime startsAt, String venue, String area, long fromPrice, String coverUrl, Tag tag, boolean soldOut, boolean featured) {}

    public record PublicTicketType(String id, String name, String description, long price, int remaining, int maxPerOrder) {}

    public record PublicDetail(String id, String title, String kind, OffsetDateTime startsAt, String venue, String area, long fromPrice, String coverUrl, Tag tag, boolean soldOut, boolean featured,
                               String description, OffsetDateTime gatesOpenAt, String organiser, Integer ageLimit, List<PublicTicketType> ticketTypes, List<String> terms) {}

    private final JdbcClient jdbc;
    private final AuditService audit;
    private final Clock clock;
    private final in.vibe.backend.notify.StaffNotifications staffNotifications;

    Events(JdbcClient jdbc, AuditService audit, Clock clock, in.vibe.backend.notify.StaffNotifications staffNotifications) {
        this.jdbc = jdbc;
        this.audit = audit;
        this.clock = clock;
        this.staffNotifications = staffNotifications;
    }

    // ---------- reads ----------
    private static Row map(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        Object age = rs.getObject("age_limit");
        return new Row(rs.getString("id"), rs.getString("business_id"), rs.getString("bname"), rs.getString("organiser"), rs.getString("title"), rs.getString("kind"), rs.getString("description"),
                rs.getString("venue"), rs.getString("area"), rs.getObject("starts_at", OffsetDateTime.class), rs.getObject("gates_open_at", OffsetDateTime.class), rs.getString("cover_url"),
                age == null ? null : ((Number) age).intValue(), rs.getBoolean("featured"), List.of((String[]) rs.getArray("terms").getArray()), rs.getString("status"), rs.getString("review_note"), List.of());
    }

    private List<TicketTypeRow> types(UUID eventId) {
        return jdbc.sql("select * from ticket_types where event_id = :id order by sort_order, price").param("id", eventId)
                .query((rs, i) -> new TicketTypeRow(rs.getString("id"), rs.getString("name"), rs.getString("description"), rs.getLong("price"), rs.getInt("capacity"), rs.getInt("max_per_order"))).list();
    }

    public Row get(UUID id) {
        Row r = jdbc.sql("select e.*, b.name bname from events e left join businesses b on b.id = e.business_id where e.id = :id").param("id", id).query(Events::map).optional()
                .orElseThrow(() -> ApiException.notFound("Event not found."));
        return withTypes(r, id);
    }

    private Row withTypes(Row r, UUID id) {
        return new Row(r.id(), r.businessId(), r.businessName(), r.organiser(), r.title(), r.kind(), r.description(), r.venue(), r.area(), r.startsAt(), r.gatesOpenAt(), r.coverUrl(), r.ageLimit(),
                r.featured(), r.terms(), r.status(), r.reviewNote(), types(id));
    }

    /** Admin: every event, optionally by status. Merchant: pass their business id. */
    public List<ListRow> list(String status, UUID businessId) {
        StringBuilder w = new StringBuilder(" where true");
        Map<String, Object> p = new HashMap<>();
        if (status != null && !status.isBlank()) { w.append(" and e.status = :st"); p.put("st", status); }
        if (businessId != null) { w.append(" and e.business_id = :b"); p.put("b", businessId); }
        JdbcClient.StatementSpec s = jdbc.sql("select e.*, b.name bname, coalesce((select min(price) from ticket_types t where t.event_id = e.id), 0) from_price, "
                + "coalesce((select sum(capacity) from ticket_types t where t.event_id = e.id), 0) cap from events e left join businesses b on b.id = e.business_id" + w + " order by e.starts_at desc limit 200");
        p.forEach(s::param);
        return s.query((rs, i) -> new ListRow(rs.getString("id"), rs.getString("title"), rs.getString("kind"), rs.getString("organiser"), rs.getString("venue"),
                rs.getObject("starts_at", OffsetDateTime.class), rs.getString("status"), rs.getLong("from_price"), rs.getInt("cap"))).list();
    }

    // ---------- merchant: own events ----------
    public Row merchantGet(StaffPrincipal who, UUID id) {
        Row r = get(id);
        if (!who.requireBusiness().toString().equals(r.businessId())) throw ApiException.notFound("Event not found.");
        return r;
    }

    @Transactional
    public Row merchantCreate(StaffPrincipal who, Input in) {
        UUID business = who.requireBusiness();
        check(in, true);
        String name = jdbc.sql("select name from businesses where id = :id").param("id", business).query(String.class).single();
        UUID id = UUID.randomUUID();
        insert(id, business, name, in, "pending", false);
        audit.record(who, "create", "event", id, in.title());
        staffNotifications.toAdmins("event_review", "Event waiting for review", name + ": " + in.title(), "/events");
        return get(id);
    }

    /** Editing a published or rejected event sends it back for review. A cancelled event can't be edited. */
    @Transactional
    public Row merchantUpdate(StaffPrincipal who, UUID id, Input in) {
        Row before = merchantGet(who, id);
        if ("cancelled".equals(before.status())) throw ApiException.conflict("cancelled", "A cancelled event can’t be edited.");
        check(in, false);
        update(id, before.organiser(), in, "pending", before.featured());
        audit.record(who, "update", "event", id, in.title());
        staffNotifications.toAdmins("event_review", "Event changed, waiting for review", before.organiser() + ": " + in.title(), "/events");
        return get(id);
    }

    @Transactional
    public Row merchantCancel(StaffPrincipal who, UUID id) {
        Row before = merchantGet(who, id);
        setStatus(id, "cancelled", null);
        audit.record(who, "cancel", "event", id, before.title());
        return get(id);
    }

    // ---------- admin ----------
    @Transactional
    public Row adminCreate(StaffPrincipal who, Input in) {
        check(in, true);
        UUID id = UUID.randomUUID();
        insert(id, null, in.organiser() == null || in.organiser().isBlank() ? "VIBE Hosts" : in.organiser().trim(), in, "published", in.featured() != null && in.featured());
        audit.record(who, "create", "event", id, in.title());
        return get(id);
    }

    @Transactional
    public Row adminUpdate(StaffPrincipal who, UUID id, Input in) {
        Row before = get(id);
        check(in, false);
        update(id, in.organiser() == null || in.organiser().isBlank() ? before.organiser() : in.organiser().trim(), in, before.status(), in.featured() != null && in.featured());
        audit.record(who, "update", "event", id, in.title());
        return get(id);
    }

    @Transactional
    public Row review(StaffPrincipal who, UUID id, boolean approve, String note) {
        Row r = get(id);
        if ("cancelled".equals(r.status())) throw ApiException.conflict("cancelled", "This event was cancelled.");
        if (!approve && (note == null || note.isBlank())) throw ApiException.badRequest("note_required", "Tell the organiser what to change.");
        setStatus(id, approve ? "published" : "rejected", approve ? null : note.trim());
        audit.record(who, approve ? "approve" : "reject", "event", id, r.title());
        if (r.businessId() != null) staffNotifications.toBusiness(UUID.fromString(r.businessId()), "event_decision", approve ? "Event published" : "Event not approved", r.title() + (approve ? " is live in the app." : ": " + note.trim()), "/events");
        return get(id);
    }

    @Transactional
    public Row adminCancel(StaffPrincipal who, UUID id) {
        Row r = get(id);
        setStatus(id, "cancelled", null);
        audit.record(who, "cancel", "event", id, r.title());
        return get(id);
    }

    // ---------- public ----------
    public List<PublicSummary> publicList(String kind, int limit) {
        StringBuilder w = new StringBuilder(" where e.status = 'published' and e.starts_at > :now");
        Map<String, Object> p = new HashMap<>();
        p.put("now", OffsetDateTime.now(clock));
        if (kind != null && !kind.isBlank()) { w.append(" and e.kind = :k"); p.put("k", kind); }
        JdbcClient.StatementSpec s = jdbc.sql("select e.*, null::text bname from events e" + w + " order by e.featured desc, e.starts_at limit " + Math.min(Math.max(limit, 1), 100));
        p.forEach(s::param);
        return s.query(Events::map).list().stream().map(r -> summary(withTypes(r, UUID.fromString(r.id())))).toList();
    }

    /** Published events in the given order (for the home screen's pinned events). */
    public List<PublicSummary> publicByIds(List<UUID> ids) {
        List<PublicSummary> out = new ArrayList<>();
        for (UUID id : ids) {
            jdbc.sql("select e.*, null::text bname from events e where e.id = :id and e.status = 'published' and e.starts_at > :now").param("id", id).param("now", OffsetDateTime.now(clock))
                    .query(Events::map).optional().ifPresent(r -> out.add(summary(withTypes(r, id))));
        }
        return out;
    }

    public PublicDetail publicDetail(UUID id) {
        Row r = get(id);
        if (!"published".equals(r.status())) throw ApiException.notFound("This event is no longer available.");
        PublicSummary s = summary(r);
        return new PublicDetail(s.id(), s.title(), s.kind(), s.startsAt(), s.venue(), s.area(), s.fromPrice(), s.coverUrl(), s.tag(), s.soldOut(), s.featured(), r.description(), r.gatesOpenAt(), r.organiser(),
                r.ageLimit(), r.ticketTypes().stream().map(t -> new PublicTicketType(t.id(), t.name(), t.description(), t.price(), t.capacity(), t.maxPerOrder())).toList(), r.terms());
    }

    private static PublicSummary summary(Row r) {
        long from = r.ticketTypes().stream().mapToLong(TicketTypeRow::price).min().orElse(0);
        boolean soldOut = !r.ticketTypes().isEmpty() && r.ticketTypes().stream().allMatch(t -> t.capacity() == 0);
        return new PublicSummary(r.id(), r.title(), r.kind(), r.startsAt(), r.venue(), r.area(), from, r.coverUrl(), soldOut ? new Tag("Sold out", "muted") : null, soldOut, r.featured());
    }

    // ---------- writes ----------
    private void check(Input in, boolean creating) {
        OffsetDateTime gates = in.gatesOpenAt() == null ? in.startsAt().minusMinutes(30) : in.gatesOpenAt();
        if (gates.isAfter(in.startsAt())) throw ApiException.badRequest("event_dates", "Doors can’t open after the event starts.");
        if (creating && !in.startsAt().isAfter(OffsetDateTime.now(clock).plusHours(1))) throw ApiException.badRequest("event_dates", "The event must start at least an hour from now.");
        long names = in.ticketTypes().stream().map(t -> t.name().trim().toLowerCase()).distinct().count();
        if (names != in.ticketTypes().size()) throw ApiException.badRequest("ticket_types", "Each ticket type needs its own name.");
    }

    private void insert(UUID id, UUID business, String organiser, Input in, String status, boolean featured) {
        jdbc.sql("insert into events (id, business_id, organiser, title, kind, description, venue, area, starts_at, gates_open_at, cover_url, age_limit, featured, terms, status) "
                        + "values (:id, :b, :o, :t, :k, :d, :v, :a, :s, :g, :c, :age, :f, :terms, :st)")
                .param("id", id).param("b", business, Types.OTHER).param("o", organiser).param("t", in.title().trim()).param("k", in.kind()).param("d", in.description() == null ? "" : in.description().trim())
                .param("v", in.venue().trim()).param("a", in.area().trim()).param("s", in.startsAt()).param("g", in.gatesOpenAt() == null ? in.startsAt().minusMinutes(30) : in.gatesOpenAt())
                .param("c", in.coverUrl() == null || in.coverUrl().isBlank() ? null : in.coverUrl().trim()).param("age", in.ageLimit(), Types.INTEGER).param("f", featured)
                .param("terms", terms(in)).param("st", status).update();
        replaceTypes(id, in);
    }

    private void update(UUID id, String organiser, Input in, String status, boolean featured) {
        jdbc.sql("update events set organiser = :o, title = :t, kind = :k, description = :d, venue = :v, area = :a, starts_at = :s, gates_open_at = :g, cover_url = :c, age_limit = :age, featured = :f, "
                        + "terms = :terms, status = :st, review_note = null, updated_at = now() where id = :id")
                .param("id", id).param("o", organiser).param("t", in.title().trim()).param("k", in.kind()).param("d", in.description() == null ? "" : in.description().trim())
                .param("v", in.venue().trim()).param("a", in.area().trim()).param("s", in.startsAt()).param("g", in.gatesOpenAt() == null ? in.startsAt().minusMinutes(30) : in.gatesOpenAt())
                .param("c", in.coverUrl() == null || in.coverUrl().isBlank() ? null : in.coverUrl().trim()).param("age", in.ageLimit(), Types.INTEGER).param("f", featured)
                .param("terms", terms(in)).param("st", status).update();
        replaceTypes(id, in);
    }

    private void replaceTypes(UUID id, Input in) {
        jdbc.sql("delete from ticket_types where event_id = :id").param("id", id).update();
        int n = 0;
        for (TicketTypeInput t : in.ticketTypes()) {
            jdbc.sql("insert into ticket_types (id, event_id, name, description, price, capacity, max_per_order, sort_order) values (:i, :e, :n, :d, :p, :c, :m, :o)")
                    .param("i", UUID.randomUUID()).param("e", id).param("n", t.name().trim()).param("d", t.description() == null ? "" : t.description().trim()).param("p", t.price())
                    .param("c", t.capacity()).param("m", t.maxPerOrder() == null ? 6 : t.maxPerOrder()).param("o", n++).update();
        }
    }

    private void setStatus(UUID id, String status, String note) {
        jdbc.sql("update events set status = :s, review_note = :n, updated_at = now() where id = :id").param("s", status).param("n", note).param("id", id).update();
    }

    private static String[] terms(Input in) { return (in.terms() == null ? List.<String>of() : in.terms().stream().map(String::trim).toList()).toArray(new String[0]); }
}
