package in.vibe.backend.tickets;

import in.vibe.backend.audit.AuditService;
import in.vibe.backend.billing.Notifications;
import in.vibe.backend.common.ApiException;
import in.vibe.backend.customer.Customers;
import in.vibe.backend.notify.StaffNotifications;
import in.vibe.backend.security.StaffPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.sql.Types;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * Selling event tickets. A customer holds tickets for a few minutes while they pay; what is held counts against what's left, so two people can never
 * buy the last ticket. Reservations for one event are serialised by locking the event row. When the payment partner confirms the payment,
 * one ticket per person is issued with an admission code and a QR token, the customer is told, and so is the organiser.
 */
@Service
public class Ticketing {
    public static final int HOLD_MINUTES = 10;
    static final int MAX_TICKETS_PER_ORDER = 20;

    public record ReserveItem(@NotBlank String ticketTypeId, @NotNull @Min(0) Integer quantity) {}

    public record ReserveInput(@NotNull @Size(max = 10) List<@Valid ReserveItem> items, @NotNull @Size(max = MAX_TICKETS_PER_ORDER) List<String> attendees) {}

    public record ReservedItem(String ticketTypeId, int quantity, String name, long unitPrice) {}

    /** What the customer app calls a TicketReservation. */
    public record Reservation(String id, String eventId, List<ReservedItem> items, List<String> attendees, long total, OffsetDateTime expiresAt, String paymentRequestId) {}

    /** What the customer app calls a Ticket. */
    public record Ticket(String id, String bookingId, String eventId, String eventTitle, String eventKind, OffsetDateTime startsAt, OffsetDateTime gatesOpenAt, String venue, String area,
                         String typeName, String attendeeName, String admissionCode, String qrToken, String seatLabel, String coverUrl, String status, int index, int of, long paidTotal) {}

    public record TypeSales(String ticketTypeId, String name, long price, int capacity, int sold, int held, int left, long revenue, boolean archived) {}

    public record Booking(String bookingId, String customerName, String vibeId, int tickets, long paid, long saved, OffsetDateTime paidAt, String paymentReference, int checkedIn) {}

    public record Sales(String eventId, String title, OffsetDateTime startsAt, String status, int capacity, int sold, int held, int left, int checkedIn, long revenue, List<TypeSales> types, List<Booking> bookings) {}

    public record CheckInInput(@NotBlank @Size(max = 200) String code) {}

    /** result: admitted, already (checked in before, with the time), wrong_event, or cancelled. */
    public record CheckIn(String result, String message, String attendeeName, String typeName, String bookingId, OffsetDateTime checkedInAt, int index, int of) {}

    /** Held = counts against what's left: still inside its time, or its payment is being processed (so a slow payment can't lose its tickets). */
    static final String HELD = "r.status = 'held' and (r.expires_at > :now or exists (select 1 from payments p where p.payment_request_id = r.payment_request_id and p.status = 'pending'))";

    private static final String ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static final DateTimeFormatter WHEN = DateTimeFormatter.ofPattern("EEE d MMM, h:mm a", Locale.ENGLISH).withZone(ZoneId.of("Asia/Kolkata"));
    private final SecureRandom random = new SecureRandom();
    private final JdbcClient jdbc;
    private final Notifications notifications;
    private final StaffNotifications staffNotifications;
    private final AuditService audit;
    private final Clock clock;

    Ticketing(JdbcClient jdbc, Notifications notifications, StaffNotifications staffNotifications, AuditService audit, Clock clock) {
        this.jdbc = jdbc;
        this.notifications = notifications;
        this.staffNotifications = staffNotifications;
        this.audit = audit;
        this.clock = clock;
    }

    private OffsetDateTime now() { return OffsetDateTime.now(clock); }

    /** [sold, held] per ticket type. */
    public Map<UUID, int[]> counts(UUID eventId) {
        Map<UUID, int[]> out = new HashMap<>();
        jdbc.sql("select i.ticket_type_id, coalesce(sum(i.quantity) filter (where r.status = 'paid'), 0) sold, coalesce(sum(i.quantity) filter (where " + HELD + "), 0) held "
                        + "from ticket_reservation_items i join ticket_reservations r on r.id = i.reservation_id where r.event_id = :e group by i.ticket_type_id")
                .param("e", eventId).param("now", now())
                .query((rs, i) -> out.put((UUID) rs.getObject(1), new int[]{rs.getInt(2), rs.getInt(3)})).list();
        return out;
    }

    // ---------- customer: hold ----------
    private record Type(UUID id, String name, long price, int capacity, int maxPerOrder) {}

    @Transactional
    public Reservation reserve(UUID customer, UUID eventId, ReserveInput in) {
        OffsetDateTime now = now();
        // Locking the event row makes reservations for this event take turns, so what's left is always counted correctly.
        record Ev(String title, String status, OffsetDateTime startsAt, UUID business) {}
        Ev ev = jdbc.sql("select title, status, starts_at, business_id from events where id = :id for update").param("id", eventId)
                .query((rs, i) -> new Ev(rs.getString(1), rs.getString(2), rs.getObject(3, OffsetDateTime.class), (UUID) rs.getObject(4))).optional()
                .orElseThrow(() -> ApiException.notFound("Event not found."));
        if (!"published".equals(ev.status()) || !ev.startsAt().isAfter(now)) throw ApiException.conflict("not_on_sale", "Tickets for this event aren’t on sale any more.");

        List<ReserveItem> wanted = in.items().stream().filter(i -> i.quantity() > 0).toList();
        int qty = wanted.stream().mapToInt(ReserveItem::quantity).sum();
        if (qty == 0) throw ApiException.badRequest("empty", "Choose at least one ticket.");
        if (qty > MAX_TICKETS_PER_ORDER) throw ApiException.badRequest("too_many", "Up to " + MAX_TICKETS_PER_ORDER + " tickets per order.");
        List<String> attendees = in.attendees().stream().map(a -> a == null ? "" : a.trim()).toList();
        if (attendees.size() != qty || attendees.stream().anyMatch(a -> a.length() < 2 || a.length() > 80)) throw ApiException.badRequest("attendees", "Add a name for every ticket.");

        // A new hold replaces this customer's earlier unpaid hold for the same event, so tapping back and choosing again doesn't block tickets.
        jdbc.sql("update payment_requests set status = 'void' where id in (select r.payment_request_id from ticket_reservations r where r.customer_id = :c and r.event_id = :e and r.status = 'held' "
                        + "and not exists (select 1 from payments p where p.payment_request_id = r.payment_request_id and p.status in ('pending', 'verified')))")
                .param("c", customer).param("e", eventId).update();
        jdbc.sql("update ticket_reservations r set status = 'released' where r.customer_id = :c and r.event_id = :e and r.status = 'held' "
                        + "and not exists (select 1 from payments p where p.payment_request_id = r.payment_request_id and p.status in ('pending', 'verified'))")
                .param("c", customer).param("e", eventId).update();

        Map<UUID, Type> types = new LinkedHashMap<>();
        jdbc.sql("select id, name, price, capacity, max_per_order from ticket_types where event_id = :e and not archived order by sort_order, price").param("e", eventId)
                .query((rs, i) -> types.put((UUID) rs.getObject(1), new Type((UUID) rs.getObject(1), rs.getString(2), rs.getLong(3), rs.getInt(4), rs.getInt(5)))).list();
        Map<UUID, int[]> counts = counts(eventId);
        List<ReservedItem> lines = new ArrayList<>();
        long total = 0;
        for (ReserveItem it : wanted) {
            UUID tid;
            try { tid = UUID.fromString(it.ticketTypeId()); } catch (IllegalArgumentException e) { throw ApiException.badRequest("bad_type", "Unknown ticket type."); }
            Type t = types.get(tid);
            if (t == null) throw ApiException.badRequest("bad_type", "Unknown ticket type.");
            if (it.quantity() > t.maxPerOrder()) throw ApiException.badRequest("max_per_order", "Up to " + t.maxPerOrder() + " " + t.name() + " tickets per order.");
            int[] c = counts.getOrDefault(tid, new int[2]);
            int left = Math.max(0, t.capacity() - c[0] - c[1]);
            if (it.quantity() > left) throw ApiException.conflict("sold_out", left == 0 ? t.name() + " is sold out." : "Only " + left + " " + t.name() + " left.");
            lines.add(new ReservedItem(tid.toString(), it.quantity(), t.name(), t.price()));
            total += t.price() * it.quantity();
        }
        if (total == 0) throw ApiException.conflict("free_tickets", "Free tickets can’t be booked in the app yet. Ask the organiser how to get in.");

        UUID resId = UUID.randomUUID(), prId = UUID.randomUUID();
        OffsetDateTime expires = now.plusMinutes(HOLD_MINUTES);
        String booking = "VBT-" + code(4) + "-" + code(4);
        jdbc.sql("insert into payment_requests (id, kind, reservation_id, business_id, customer_id, bill_ref, raised_by, eligible_amount, discount, discount_label, vibe_fee, payable, expires_at) "
                        + "values (:id, 'tickets', :r, :b, :c, :ref, 'VIBE Tickets', :t, 0, '', 0, :t, :x)")
                .param("id", prId).param("r", resId).param("b", ev.business(), Types.OTHER).param("c", customer).param("ref", booking).param("t", total).param("x", expires).update();
        int pos = 0;
        for (ReservedItem l : lines) {
            jdbc.sql("insert into payment_request_lines (payment_request_id, position, label, amount) values (:p, :n, :l, :a)")
                    .param("p", prId).param("n", pos++).param("l", l.name() + " × " + l.quantity()).param("a", l.unitPrice() * l.quantity()).update();
        }
        jdbc.sql("insert into ticket_reservations (id, event_id, customer_id, attendees, total, expires_at, payment_request_id, booking_id) values (:id, :e, :c, :a, :t, :x, :p, :b)")
                .param("id", resId).param("e", eventId).param("c", customer).param("a", attendees.toArray(new String[0])).param("t", total).param("x", expires).param("p", prId).param("b", booking).update();
        for (ReservedItem l : lines) {
            jdbc.sql("insert into ticket_reservation_items (reservation_id, ticket_type_id, quantity, unit_price) values (:r, :t, :q, :p)")
                    .param("r", resId).param("t", UUID.fromString(l.ticketTypeId())).param("q", l.quantity()).param("p", l.unitPrice()).update();
        }
        return new Reservation(resId.toString(), eventId.toString(), lines, attendees, total, expires, prId.toString());
    }

    // ---------- after the payment partner confirms ----------
    /** Called once, inside the transaction that marks the payment verified. Issues one ticket per person and tells the customer and the organiser. */
    public void issue(UUID paymentRequestId, UUID paymentId) {
        record R(UUID id, UUID event, UUID customer, String status, List<String> attendees, String booking) {}
        R r = jdbc.sql("select id, event_id, customer_id, status, attendees, booking_id from ticket_reservations where payment_request_id = :p for update").param("p", paymentRequestId)
                .query((rs, i) -> new R((UUID) rs.getObject(1), (UUID) rs.getObject(2), (UUID) rs.getObject(3), rs.getString(4), List.of((String[]) rs.getArray(5).getArray()), rs.getString(6))).single();
        if ("paid".equals(r.status())) return;
        jdbc.sql("update ticket_reservations set status = 'paid', paid_at = now() where id = :id").param("id", r.id()).update();
        record Item(UUID type, String name, int qty) {}
        List<Item> items = jdbc.sql("select i.ticket_type_id, t.name, i.quantity from ticket_reservation_items i join ticket_types t on t.id = i.ticket_type_id where i.reservation_id = :r order by t.sort_order, t.price")
                .param("r", r.id()).query((rs, i) -> new Item((UUID) rs.getObject(1), rs.getString(2), rs.getInt(3))).list();
        int of = items.stream().mapToInt(Item::qty).sum(), n = 0;
        for (Item it : items) {
            for (int k = 0; k < it.qty(); k++) {
                String attendee = n < r.attendees().size() ? r.attendees().get(n) : "Guest";
                n++;
                insertTicket(r.id(), r.event(), it.type(), r.customer(), attendee, n, of);
            }
        }
        record Ev(String title, OffsetDateTime startsAt, UUID business) {}
        Ev ev = jdbc.sql("select title, starts_at, business_id from events where id = :id").param("id", r.event())
                .query((rs, i) -> new Ev(rs.getString(1), rs.getObject(2, OffsetDateTime.class), (UUID) rs.getObject(3))).single();
        notifications.notify(r.customer(), "tickets_issued", of == 1 ? "Your ticket is ready" : "Your " + of + " tickets are ready",
                ev.title() + ", " + WHEN.format(ev.startsAt()) + ". Show the QR code at the entrance. Booking " + r.booking() + ".", "tickets", r.id().toString());

        Map<UUID, int[]> counts = counts(r.event());
        int capacity = jdbc.sql("select coalesce(sum(capacity), 0) from ticket_types where event_id = :e and not archived").param("e", r.event()).query(Integer.class).single();
        int taken = counts.values().stream().mapToInt(c -> c[0] + c[1]).sum();
        String what = items.stream().map(i -> i.name() + " × " + i.qty()).reduce((a, b) -> a + ", " + b).orElse("");
        String title = of + (of == 1 ? " ticket sold: " : " tickets sold: ") + ev.title();
        String body = what + ". " + Math.max(0, capacity - taken) + " left of " + capacity + ".";
        if (ev.business() != null) staffNotifications.toBusiness(ev.business(), "tickets_sold", title, body, "/events/" + r.event() + "/sales");
        else staffNotifications.toAdmins("tickets_sold", title, body, "/events/" + r.event() + "/sales");
    }

    private void insertTicket(UUID reservation, UUID event, UUID type, UUID customer, String attendee, int index, int of) {
        for (int attempt = 0; ; attempt++) {
            try {
                jdbc.sql("insert into tickets (id, reservation_id, event_id, ticket_type_id, customer_id, attendee_name, admission_code, qr_token, position, of_count) values (:id, :r, :e, :t, :c, :a, :code, :qr, :p, :o)")
                        .param("id", UUID.randomUUID()).param("r", reservation).param("e", event).param("t", type).param("c", customer).param("a", attendee)
                        .param("code", code(3) + "-" + code(3)).param("qr", "vibe.t." + code(32)).param("p", index).param("o", of).update();
                return;
            } catch (DuplicateKeyException e) {
                if (attempt >= 4) throw e; // an admission code clash is rare; try a new one
            }
        }
    }

    // ---------- customer: my tickets ----------
    private static final String TICKET_SELECT = "select t.*, r.booking_id, e.title, e.kind, e.starts_at, e.gates_open_at, e.venue, e.area, e.cover_url, tt.name type_name, pay.amount paid_total "
            + "from tickets t join ticket_reservations r on r.id = t.reservation_id join events e on e.id = t.event_id join ticket_types tt on tt.id = t.ticket_type_id "
            + "left join payments pay on pay.payment_request_id = r.payment_request_id and pay.status = 'verified' ";

    private static Ticket ticket(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        return new Ticket(rs.getString("id"), rs.getString("booking_id"), rs.getString("event_id"), rs.getString("title"), rs.getString("kind"), rs.getObject("starts_at", OffsetDateTime.class),
                rs.getObject("gates_open_at", OffsetDateTime.class), rs.getString("venue"), rs.getString("area"), rs.getString("type_name"), rs.getString("attendee_name"), rs.getString("admission_code"),
                rs.getString("qr_token"), null, rs.getString("cover_url"), rs.getString("status"), rs.getInt("position"), rs.getInt("of_count"), rs.getLong("paid_total"));
    }

    public List<Ticket> myTickets(UUID customer) {
        return jdbc.sql(TICKET_SELECT + "where t.customer_id = :c order by e.starts_at, r.booking_id, t.position").param("c", customer).query(Ticketing::ticket).list();
    }

    public Ticket myTicket(UUID customer, UUID id) {
        return jdbc.sql(TICKET_SELECT + "where t.id = :id and t.customer_id = :c").param("id", id).param("c", customer).query(Ticketing::ticket).optional()
                .orElseThrow(() -> ApiException.notFound("Ticket not found."));
    }

    public List<String> ticketIds(UUID paymentRequestId) {
        return jdbc.sql("select t.id from tickets t join ticket_reservations r on r.id = t.reservation_id where r.payment_request_id = :p order by t.position").param("p", paymentRequestId)
                .query(String.class).list();
    }

    // ---------- organiser: sales and the door ----------
    /** `business` limits it to a merchant's own events; null for VIBE staff. */
    public Sales sales(UUID eventId, UUID business) {
        record Ev(String title, OffsetDateTime startsAt, String status, UUID business) {}
        Ev ev = jdbc.sql("select title, starts_at, status, business_id from events where id = :id").param("id", eventId)
                .query((rs, i) -> new Ev(rs.getString(1), rs.getObject(2, OffsetDateTime.class), rs.getString(3), (UUID) rs.getObject(4))).optional()
                .filter(e -> business == null || business.equals(e.business())).orElseThrow(() -> ApiException.notFound("Event not found."));
        Map<UUID, int[]> counts = counts(eventId);
        Map<UUID, Long> revenue = new HashMap<>();
        jdbc.sql("select i.ticket_type_id, sum(i.quantity * i.unit_price) from ticket_reservation_items i join ticket_reservations r on r.id = i.reservation_id where r.event_id = :e and r.status = 'paid' group by 1")
                .param("e", eventId).query((rs, i) -> revenue.put((UUID) rs.getObject(1), rs.getLong(2))).list();
        List<TypeSales> types = jdbc.sql("select id, name, price, capacity, archived from ticket_types where event_id = :e order by archived, sort_order, price").param("e", eventId)
                .query((rs, i) -> {
                    UUID id = (UUID) rs.getObject("id");
                    int[] c = counts.getOrDefault(id, new int[2]);
                    int cap = rs.getInt("capacity");
                    return new TypeSales(id.toString(), rs.getString("name"), rs.getLong("price"), cap, c[0], c[1], rs.getBoolean("archived") ? 0 : Math.max(0, cap - c[0] - c[1]), revenue.getOrDefault(id, 0L), rs.getBoolean("archived"));
                }).list();
        List<Booking> bookings = jdbc.sql("select r.booking_id, c.name, c.vibe_id, (select count(*) from tickets t where t.reservation_id = r.id) n, coalesce(pay.amount, 0) paid, coalesce(pay.savings, 0) saved, r.paid_at, pay.reference, "
                        + "(select count(*) from tickets t where t.reservation_id = r.id and t.status = 'checked_in') checked from ticket_reservations r join customers c on c.id = r.customer_id "
                        + "left join payments pay on pay.payment_request_id = r.payment_request_id and pay.status = 'verified' where r.event_id = :e and r.status = 'paid' order by r.paid_at desc limit 500")
                .param("e", eventId).query((rs, i) -> new Booking(rs.getString("booking_id"), Customers.displayName(rs.getString("name")), rs.getString("vibe_id"), rs.getInt("n"), rs.getLong("paid"),
                        rs.getLong("saved"), rs.getObject("paid_at", OffsetDateTime.class), rs.getString("reference"), rs.getInt("checked"))).list();
        int checkedIn = jdbc.sql("select count(*) from tickets where event_id = :e and status = 'checked_in'").param("e", eventId).query(Integer.class).single();
        List<TypeSales> live = types.stream().filter(t -> !t.archived()).toList();
        return new Sales(eventId.toString(), ev.title(), ev.startsAt(), ev.status(), live.stream().mapToInt(TypeSales::capacity).sum(), types.stream().mapToInt(TypeSales::sold).sum(),
                types.stream().mapToInt(TypeSales::held).sum(), live.stream().mapToInt(TypeSales::left).sum(), checkedIn, types.stream().mapToLong(TypeSales::revenue).sum(), types, bookings);
    }

    /** At the door: the admission code (ABC-123, any case, with or without the dash) or the QR token. A ticket is let in once. */
    @Transactional
    public CheckIn checkIn(StaffPrincipal who, UUID eventId, UUID business, String raw) {
        sales(eventId, business); // the event must be theirs
        String code = raw.trim();
        String admission = code.toUpperCase(Locale.ROOT).replaceAll("[^A-Z0-9]", "");
        if (admission.length() == 6) admission = admission.substring(0, 3) + "-" + admission.substring(3);
        record T(UUID id, UUID event, String status, String attendee, String type, String booking, OffsetDateTime at, int index, int of) {}
        T t = jdbc.sql("select t.id, t.event_id, t.status, t.attendee_name, tt.name, r.booking_id, t.checked_in_at, t.position, t.of_count from tickets t join ticket_types tt on tt.id = t.ticket_type_id "
                        + "join ticket_reservations r on r.id = t.reservation_id where t.qr_token = :q or t.admission_code = :a for update of t")
                .param("q", code).param("a", admission)
                .query((rs, i) -> new T((UUID) rs.getObject(1), (UUID) rs.getObject(2), rs.getString(3), rs.getString(4), rs.getString(5), rs.getString(6), rs.getObject(7, OffsetDateTime.class), rs.getInt(8), rs.getInt(9)))
                .optional().orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "no_ticket", "No ticket has that code. Check it with the customer’s VIBE app."));
        if (!t.event().equals(eventId)) return new CheckIn("wrong_event", "This ticket is for a different event.", t.attendee(), t.type(), t.booking(), null, t.index(), t.of());
        if ("cancelled".equals(t.status())) return new CheckIn("cancelled", "This ticket was cancelled. Don’t let them in on it.", t.attendee(), t.type(), t.booking(), null, t.index(), t.of());
        if ("checked_in".equals(t.status())) return new CheckIn("already", "Already used to get in at " + WHEN.format(t.at()) + ".", t.attendee(), t.type(), t.booking(), t.at(), t.index(), t.of());
        jdbc.sql("update tickets set status = 'checked_in', checked_in_at = now(), checked_in_by = :by where id = :id").param("by", who.id()).param("id", t.id()).update();
        audit.record(who, "check_in", "ticket", t.id(), t.booking() + " " + t.attendee());
        return new CheckIn("admitted", "Let them in.", t.attendee(), t.type(), t.booking(), now(), t.index(), t.of());
    }

    /** VIBE cancels an event: every ticket is cancelled and each buyer is told. Refunds go back through the payment partner (handled by the VIBE team for now). */
    public int cancelTickets(UUID eventId, String title) {
        List<UUID> buyers = jdbc.sql("select distinct customer_id from tickets where event_id = :e and status = 'valid'").param("e", eventId).query((rs, i) -> (UUID) rs.getObject(1)).list();
        int n = jdbc.sql("update tickets set status = 'cancelled' where event_id = :e and status = 'valid'").param("e", eventId).update();
        for (UUID c : buyers) notifications.notify(c, "event_cancelled", "Event cancelled", title + " has been cancelled. Your tickets are no longer valid, and VIBE will refund what you paid.", "tickets", eventId.toString());
        return n;
    }

    public int soldCount(UUID eventId) {
        return jdbc.sql("select count(*) from tickets where event_id = :e and status <> 'cancelled'").param("e", eventId).query(Integer.class).single();
    }

    private String code(int n) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) sb.append(ALPHABET.charAt(random.nextInt(ALPHABET.length())));
        return sb.toString();
    }
}
