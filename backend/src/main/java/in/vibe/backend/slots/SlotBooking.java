package in.vibe.backend.slots;

import in.vibe.backend.audit.AuditService;
import in.vibe.backend.billing.Notifications;
import in.vibe.backend.common.ApiException;
import in.vibe.backend.customer.Customers;
import in.vibe.backend.notify.StaffNotifications;
import in.vibe.backend.security.StaffPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * Booking sports and fitness by the slot, the way Playo works. A venue lists resources per sport: courts, turfs and nets (one booking per slot)
 * or shared sessions such as a swimming slot or a yoga class (several people up to a capacity). A customer picks a sport, a date, a start time and
 * a duration, then a resource; it is held for a few minutes while they pay through VIBE, and confirmed with an entry code when the payment
 * partner confirms. Reservations for a resource take turns on a database lock, so a slot can't be sold twice. The money is settled to the venue.
 */
@Service
public class SlotBooking {
    public static final int HOLD_MINUTES = 10, DAYS_AHEAD = 14;
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final String HHMM = "^([01]\\d|2[0-3]):[0-5]\\d$";
    private static final DateTimeFormatter WHEN = DateTimeFormatter.ofPattern("EEE d MMM, h:mm a", Locale.ENGLISH).withZone(IST);
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("h:mm a", Locale.ENGLISH).withZone(IST);
    private static final String ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    // ---------- the venue's resources (merchant) ----------
    public record ResourceInput(@NotBlank @Size(min = 2, max = 40) String sport, @NotBlank @Size(max = 60) String name, @Pattern(regexp = "court|spots") String kind,
                                @Min(1) @Max(500) Integer capacity, Integer slotMinutes, @NotNull @Min(0) Long price, @Min(0) Long peakPrice,
                                @Pattern(regexp = HHMM) String peakFrom, @Pattern(regexp = HHMM) String peakTo, Boolean weekendPeak, Boolean active, @Min(0) Integer sortOrder) {}

    public record Resource(String id, String sport, String name, String kind, int capacity, int slotMinutes, long price, Long peakPrice, String peakFrom, String peakTo,
                           boolean weekendPeak, boolean active, int sortOrder) {}

    // ---------- what the customer app reads ----------
    public record Sport(String sport, String kind, int resources, long fromPrice, int slotMinutes) {}

    public record Option(String resourceId, String name, boolean available, int spotsLeft, long price) {}

    /** label is the time range for the chosen duration ("6–8 AM"); startLabel is just the start ("6:00 AM"). fromPrice is for the whole duration. */
    public record SlotTime(OffsetDateTime startsAt, OffsetDateTime endsAt, String label, String startLabel, boolean available, long fromPrice, List<Option> options) {}

    public record Slots(String date, String sport, int minutes, int slotMinutes, List<Integer> durations, String kind, List<SlotTime> slots, String closedReason) {}

    public record BookItem(@NotBlank String resourceId, @NotNull OffsetDateTime startsAt, @NotNull @Min(30) @Max(240) Integer minutes, @Min(1) @Max(20) Integer spots) {}

    public record BookInput(@NotBlank String businessId, @NotEmpty @Size(max = 8) List<@Valid BookItem> items) {}

    public record ItemView(String resourceId, String resourceName, String sport, OffsetDateTime startsAt, OffsetDateTime endsAt, int spots, long price) {}

    public record Booking(String id, String businessId, String businessName, String area, String address, String status, String bookingRef, String entryCode, long total,
                          OffsetDateTime expiresAt, String paymentRequestId, List<ItemView> items, OffsetDateTime paidAt, OffsetDateTime checkedInAt) {}

    // ---------- the merchant's day ----------
    public record DayBooking(String bookingId, String bookingRef, String customerName, String vibeId, String resourceId, OffsetDateTime startsAt, OffsetDateTime endsAt, int spots,
                             String status, boolean checkedIn, long price) {}

    public record Block(String id, String resourceId, OffsetDateTime startsAt, OffsetDateTime endsAt, String reason) {}

    public record Day(String date, List<Resource> resources, List<DayBooking> bookings, List<Block> blocks, int bookedToday, long salesToday) {}

    public record BlockInput(@NotBlank String resourceId, @NotNull OffsetDateTime startsAt, @NotNull OffsetDateTime endsAt, @Size(max = 120) String reason) {}

    public record CheckIn(String result, String message, String bookingRef, String customerName, List<ItemView> items) {}

    /** Held = counts against availability: inside its time, or its payment is being processed. */
    static final String LIVE = "(b.status = 'paid' or (b.status = 'held' and (b.expires_at > :now or exists (select 1 from payments p where p.payment_request_id = b.payment_request_id and p.status = 'pending'))))";

    private final SecureRandom random = new SecureRandom();
    private final JdbcClient jdbc;
    private final Notifications notifications;
    private final StaffNotifications staffNotifications;
    private final AuditService audit;
    private final Clock clock;
    private final long bookingFee;
    private final VenuePasses passes;

    SlotBooking(JdbcClient jdbc, Notifications notifications, StaffNotifications staffNotifications, AuditService audit, Clock clock,
                @org.springframework.beans.factory.annotation.Value("${vibe.billing.booking-fee:0}") long bookingFee, VenuePasses passes) {
        this.bookingFee = bookingFee;
        this.passes = passes;
        this.jdbc = jdbc;
        this.notifications = notifications;
        this.staffNotifications = staffNotifications;
        this.audit = audit;
        this.clock = clock;
    }

    private OffsetDateTime now() { return OffsetDateTime.now(clock); }

    // =====================================================================
    // Resources
    // =====================================================================
    private static Resource resource(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        Object peak = rs.getObject("peak_price");
        java.sql.Time pf = rs.getTime("peak_from"), pt = rs.getTime("peak_to");
        return new Resource(rs.getString("id"), rs.getString("sport"), rs.getString("name"), rs.getString("kind"), rs.getInt("capacity"), rs.getInt("slot_minutes"), rs.getLong("price"),
                peak == null ? null : ((Number) peak).longValue(), pf == null ? null : pf.toLocalTime().toString(), pt == null ? null : pt.toLocalTime().toString(),
                rs.getBoolean("weekend_peak"), rs.getBoolean("active"), rs.getInt("sort_order"));
    }

    public List<Resource> resources(UUID business, boolean activeOnly) {
        return jdbc.sql("select * from venue_resources where business_id = :b" + (activeOnly ? " and active" : "") + " order by sport, sort_order, name").param("b", business).query(SlotBooking::resource).list();
    }

    private void check(ResourceInput in) {
        int minutes = in.slotMinutes() == null ? 60 : in.slotMinutes();
        if (!List.of(30, 45, 60, 90, 120).contains(minutes)) throw ApiException.badRequest("slot_minutes", "A slot is 30, 45, 60, 90 or 120 minutes.");
        if ((in.peakFrom() == null) != (in.peakTo() == null)) throw ApiException.badRequest("peak", "Give both the start and end of peak hours, or neither.");
        if ((in.peakFrom() != null || Boolean.TRUE.equals(in.weekendPeak())) && in.peakPrice() == null) throw ApiException.badRequest("peak", "Set the peak price.");
        if ("court".equals(kind(in)) && in.capacity() != null && in.capacity() != 1) throw ApiException.badRequest("capacity", "A court is booked by one group at a time. Use “spots” for classes and sessions.");
    }

    private static String kind(ResourceInput in) { return in.kind() == null ? "court" : in.kind(); }

    @Transactional
    public Resource addResource(StaffPrincipal who, ResourceInput in) {
        check(in);
        UUID id = UUID.randomUUID();
        write("insert into venue_resources (id, business_id, sport, name, kind, capacity, slot_minutes, price, peak_price, peak_from, peak_to, weekend_peak, active, sort_order) "
                + "values (:id, :b, :sport, :name, :kind, :cap, :min, :price, :pp, cast(:pf as time), cast(:pt as time), :wp, :active, :sort)", id, who.requireBusiness(), in);
        audit.record(who, "create", "venue_resource", id, in.sport() + " · " + in.name());
        return one(who.requireBusiness(), id);
    }

    @Transactional
    public Resource updateResource(StaffPrincipal who, UUID id, ResourceInput in) {
        check(in);
        one(who.requireBusiness(), id);
        write("update venue_resources set sport = :sport, name = :name, kind = :kind, capacity = :cap, slot_minutes = :min, price = :price, peak_price = :pp, peak_from = cast(:pf as time), "
                + "peak_to = cast(:pt as time), weekend_peak = :wp, active = :active, sort_order = :sort where id = :id and business_id = :b", id, who.requireBusiness(), in);
        audit.record(who, "update", "venue_resource", id, in.sport() + " · " + in.name());
        return one(who.requireBusiness(), id);
    }

    private void write(String sql, UUID id, UUID business, ResourceInput in) {
        String kind = kind(in);
        jdbc.sql(sql).param("id", id).param("b", business).param("sport", in.sport().trim()).param("name", in.name().trim()).param("kind", kind)
                .param("cap", "court".equals(kind) ? 1 : in.capacity() == null ? 10 : in.capacity()).param("min", in.slotMinutes() == null ? 60 : in.slotMinutes()).param("price", in.price())
                .param("pp", in.peakPrice(), java.sql.Types.BIGINT).param("pf", in.peakFrom(), java.sql.Types.VARCHAR).param("pt", in.peakTo(), java.sql.Types.VARCHAR)
                .param("wp", Boolean.TRUE.equals(in.weekendPeak())).param("active", in.active() == null || in.active()).param("sort", in.sortOrder() == null ? 0 : in.sortOrder()).update();
    }

    /** A resource with bookings is kept (customers' bookings point at it) and switched off instead. */
    @Transactional
    public void deleteResource(StaffPrincipal who, UUID id) {
        one(who.requireBusiness(), id);
        int used = jdbc.sql("select count(*) from slot_booking_items where resource_id = :id").param("id", id).query(Integer.class).single();
        if (used > 0) throw ApiException.conflict("in_use", "This has bookings, so it’s kept for customers’ records. Switch it off instead to stop new bookings.");
        jdbc.sql("delete from venue_resources where id = :id").param("id", id).update();
        audit.record(who, "delete", "venue_resource", id, "");
    }

    private Resource one(UUID business, UUID id) {
        return jdbc.sql("select * from venue_resources where id = :id and business_id = :b").param("id", id).param("b", business).query(SlotBooking::resource).optional()
                .orElseThrow(() -> ApiException.notFound("Not found."));
    }

    // =====================================================================
    // What customers see
    // =====================================================================
    /** The sports a venue offers, for its page: each with how many courts or sessions and the lowest price per slot. */
    public List<Sport> sports(UUID business) {
        Map<String, List<Resource>> by = new LinkedHashMap<>();
        for (Resource r : resources(business, true)) by.computeIfAbsent(r.sport(), k -> new ArrayList<>()).add(r);
        List<Sport> out = new ArrayList<>();
        by.forEach((sport, rs) -> out.add(new Sport(sport, rs.getFirst().kind(), rs.size(), rs.stream().mapToLong(Resource::price).min().orElse(0),
                rs.stream().mapToInt(Resource::slotMinutes).min().orElse(60))));
        return out;
    }

    /** The lowest price per slot at each venue that takes bookings, for lists ("from ₹350"). */
    public Map<UUID, Long> fromPrices(List<UUID> businesses) {
        Map<UUID, Long> out = new java.util.HashMap<>();
        if (businesses.isEmpty()) return out;
        jdbc.sql("select business_id, min(price) from venue_resources where active and business_id in (:ids) group by business_id").param("ids", businesses)
                .query((rs, i) -> out.put((UUID) rs.getObject(1), rs.getLong(2))).list();
        return out;
    }

    /** Opening and closing for a date, India time. Closing at or before opening means after midnight. Null when closed. */
    private ZonedDateTime[] openHours(UUID business, LocalDate date) {
        int dow = date.getDayOfWeek().getValue() - 1;
        return jdbc.sql("select opens, closes from business_hours where business_id = :b and dow = :d").param("b", business).param("d", dow)
                .query((rs, i) -> {
                    java.sql.Time o = rs.getTime(1), c = rs.getTime(2);
                    if (o == null || c == null) return null;
                    ZonedDateTime open = date.atTime(o.toLocalTime()).atZone(IST), close = date.atTime(c.toLocalTime()).atZone(IST);
                    if (!close.isAfter(open)) close = close.plusDays(1);
                    return new ZonedDateTime[]{open, close};
                }).optional().orElse(null);
    }

    static long priceAt(Resource r, ZonedDateTime start) {
        if (r.peakPrice() == null) return r.price();
        boolean weekend = start.getDayOfWeek() == DayOfWeek.SATURDAY || start.getDayOfWeek() == DayOfWeek.SUNDAY;
        if (r.weekendPeak() && weekend) return r.peakPrice();
        if (r.peakFrom() != null) {
            LocalTime t = start.toLocalTime(), from = LocalTime.parse(r.peakFrom()), to = LocalTime.parse(r.peakTo());
            boolean inPeak = from.isBefore(to) ? !t.isBefore(from) && t.isBefore(to) : !t.isBefore(from) || t.isBefore(to);
            if (inPeak) return r.peakPrice();
        }
        return r.price();
    }

    /** The price of a booking: each slot inside it at its own (peak or normal) price. */
    static long priceFor(Resource r, ZonedDateTime start, int minutes, int spots) {
        long total = 0;
        for (int m = 0; m < minutes; m += r.slotMinutes()) total += priceAt(r, start.plusMinutes(m));
        return total * spots;
    }

    /** How many spots are taken on a resource between two times (a court counts as fully taken). Blocks take everything. */
    private int taken(Resource r, OffsetDateTime from, OffsetDateTime to) {
        int blocked = jdbc.sql("select count(*) from resource_blocks where resource_id = :r and starts_at < :t and ends_at > :f").param("r", UUID.fromString(r.id())).param("f", from).param("t", to)
                .query(Integer.class).single();
        if (blocked > 0) return r.capacity();
        // For shared sessions, count people per overlapping booking (bookings don't overlap partially within one slot length).
        return jdbc.sql("select coalesce(sum(i.spots), 0) from slot_booking_items i join slot_bookings b on b.id = i.booking_id where i.resource_id = :r and i.starts_at < :t and i.ends_at > :f and " + LIVE)
                .param("r", UUID.fromString(r.id())).param("f", from).param("t", to).param("now", now()).query(Integer.class).single();
    }

    /** The slot grid for one sport on one date: every start time while the venue is open, and each resource's availability and price. */
    public Slots slots(UUID business, String sport, LocalDate date, Integer minutesWanted) {
        List<Resource> rs = resources(business, true).stream().filter(r -> r.sport().equalsIgnoreCase(sport)).toList();
        if (rs.isEmpty()) throw ApiException.notFound("This venue doesn’t take bookings for " + sport + ".");
        int step = rs.stream().mapToInt(Resource::slotMinutes).min().orElse(60);
        List<Integer> durations = List.of(step, step * 2, step * 3).stream().filter(d -> d <= 240).toList();
        int minutes = minutesWanted == null || !durations.contains(minutesWanted) ? step : minutesWanted;
        String kind = rs.getFirst().kind();
        LocalDate today = now().atZoneSameInstant(IST).toLocalDate();
        if (date.isBefore(today) || date.isAfter(today.plusDays(DAYS_AHEAD))) return new Slots(date.toString(), sport, minutes, step, durations, kind, List.of(), "Bookings open " + DAYS_AHEAD + " days ahead.");
        ZonedDateTime[] open = openHours(business, date);
        if (open == null) return new Slots(date.toString(), sport, minutes, step, durations, kind, List.of(), "Closed on this day.");
        List<SlotTime> slots = new ArrayList<>();
        for (ZonedDateTime s = open[0]; !s.plusMinutes(minutes).isAfter(open[1]); s = s.plusMinutes(step)) {
            OffsetDateTime from = s.toOffsetDateTime(), to = s.plusMinutes(minutes).toOffsetDateTime();
            boolean past = !from.isAfter(now());
            List<Option> options = new ArrayList<>();
            for (Resource r : rs) {
                boolean fits = minutes % r.slotMinutes() == 0;
                int left = past || !fits ? 0 : r.capacity() - taken(r, from, to);
                options.add(new Option(r.id(), r.name(), left > 0, Math.max(0, left), fits ? priceFor(r, s, minutes, 1) : 0));
            }
            boolean any = options.stream().anyMatch(Option::available);
            long fromPrice = options.stream().filter(Option::available).mapToLong(Option::price).min().orElse(options.stream().mapToLong(Option::price).min().orElse(0));
            slots.add(new SlotTime(from, to, range(from, to), TIME.format(from), any, fromPrice, options));
        }
        return new Slots(date.toString(), sport, minutes, step, durations, kind, slots, null);
    }

    /** "6–7 AM", "11 AM–1 PM", "6:30–8 PM". */
    static String range(OffsetDateTime from, OffsetDateTime to) {
        ZonedDateTime f = from.atZoneSameInstant(IST), t = to.atZoneSameInstant(IST);
        String a = short12(f), b = short12(t);
        // "6–8 AM" when both ends share AM or PM; "11 AM–1 PM" and "11 PM–12 AM" when they don't.
        boolean sameHalf = a.substring(a.length() - 2).equals(b.substring(b.length() - 2));
        return sameHalf ? a.substring(0, a.length() - 3) + "–" + b : a + "–" + b;
    }

    private static String short12(ZonedDateTime z) {
        int h = z.getHour() % 12 == 0 ? 12 : z.getHour() % 12;
        return h + (z.getMinute() == 0 ? "" : ":" + String.format("%02d", z.getMinute())) + (z.getHour() < 12 ? " AM" : " PM");
    }

    // =====================================================================
    // Booking
    // =====================================================================
    @Transactional
    public Booking reserve(UUID customer, BookInput in) {
        UUID business = parse(in.businessId());
        if (jdbc.sql("select count(*) from businesses where id = :b and active").param("b", business).query(Integer.class).single() == 0) throw ApiException.notFound("This venue is no longer available.");
        // Take turns on the resources being booked, in a fixed order so two bookings can't deadlock.
        List<UUID> ids = in.items().stream().map(i -> parse(i.resourceId())).distinct().sorted().toList();
        Map<UUID, Resource> rs = new LinkedHashMap<>();
        for (UUID id : ids) {
            Resource r = jdbc.sql("select * from venue_resources where id = :id and business_id = :b and active for update").param("id", id).param("b", business).query(SlotBooking::resource).optional()
                    .orElseThrow(() -> ApiException.badRequest("bad_resource", "That court or session isn’t available here."));
            rs.put(id, r);
        }
        // A new hold replaces this customer's earlier unpaid hold at the same venue.
        releaseOwnHolds(customer, business);

        record Line(Resource r, OffsetDateTime from, OffsetDateTime to, int spots, long price) {}
        List<Line> lines = new ArrayList<>();
        LocalDate today = now().atZoneSameInstant(IST).toLocalDate();
        for (BookItem it : in.items()) {
            Resource r = rs.get(parse(it.resourceId()));
            int spots = "court".equals(r.kind()) ? 1 : it.spots() == null ? 1 : it.spots();
            if (it.minutes() % r.slotMinutes() != 0) throw ApiException.badRequest("duration", r.name() + " is booked in " + r.slotMinutes() + "-minute slots.");
            ZonedDateTime start = it.startsAt().atZoneSameInstant(IST);
            OffsetDateTime from = start.toOffsetDateTime(), to = start.plusMinutes(it.minutes()).toOffsetDateTime();
            if (!from.isAfter(now())) throw ApiException.conflict("past", "That time has passed. Choose a later slot.");
            if (start.toLocalDate().isAfter(today.plusDays(DAYS_AHEAD))) throw ApiException.badRequest("too_far", "Bookings open " + DAYS_AHEAD + " days ahead.");
            ZonedDateTime[] open = openHours(business, start.toLocalDate());
            ZonedDateTime[] openPrev = openHours(business, start.toLocalDate().minusDays(1)); // a slot after midnight belongs to the previous evening
            boolean inside = (open != null && !start.isBefore(open[0]) && !start.plusMinutes(it.minutes()).isAfter(open[1]))
                    || (openPrev != null && !start.isBefore(openPrev[0]) && !start.plusMinutes(it.minutes()).isAfter(openPrev[1]));
            if (!inside) throw ApiException.badRequest("closed", "The venue isn’t open for that whole time.");
            int sameRequest = lines.stream().filter(l -> l.r().id().equals(r.id()) && l.from().isBefore(to) && l.to().isAfter(from)).mapToInt(Line::spots).sum();
            int left = r.capacity() - taken(r, from, to) - sameRequest;
            if (spots > left) {
                throw ApiException.conflict("slot_taken", "court".equals(r.kind()) ? r.name() + " is already booked at " + TIME.format(from) + ". Choose another court or time."
                        : left <= 0 ? r.name() + " is full at " + TIME.format(from) + "." : "Only " + left + " spots left in " + r.name() + " at " + TIME.format(from) + ".");
            }
            lines.add(new Line(r, from, to, spots, priceFor(r, start, it.minutes(), spots)));
        }
        long total = lines.stream().mapToLong(Line::price).sum();
        if (total == 0) throw ApiException.conflict("free", "Free slots can’t be booked in the app yet. Ask the venue.");

        UUID id = UUID.randomUUID(), pr = UUID.randomUUID();
        OffsetDateTime expires = now().plusMinutes(HOLD_MINUTES);
        String ref = "VBS-" + code(4) + "-" + code(4);
        jdbc.sql("insert into payment_requests (id, kind, business_id, customer_id, bill_ref, raised_by, eligible_amount, discount, discount_label, vibe_fee, payable, expires_at) "
                        + "values (:id, 'slots', :b, :c, :ref, 'VIBE Bookings', :t, 0, '', :fee, :t + :fee, :x)")
                .param("id", pr).param("b", business).param("c", customer).param("ref", ref).param("t", total).param("fee", bookingFee).param("x", expires).update();
        int pos = 0;
        for (Line l : lines) {
            String label = l.r().sport() + " · " + l.r().name() + " · " + DateTimeFormatter.ofPattern("EEE d MMM", Locale.ENGLISH).withZone(IST).format(l.from()) + ", " + range(l.from(), l.to()) + (l.spots() > 1 ? " × " + l.spots() : "");
            jdbc.sql("insert into payment_request_lines (payment_request_id, position, label, amount) values (:p, :n, :l, :a)").param("p", pr).param("n", pos++).param("l", label).param("a", l.price()).update();
        }
        jdbc.sql("insert into slot_bookings (id, business_id, customer_id, booking_ref, total, expires_at, payment_request_id) values (:id, :b, :c, :ref, :t, :x, :p)")
                .param("id", id).param("b", business).param("c", customer).param("ref", ref).param("t", total).param("x", expires).param("p", pr).update();
        for (Line l : lines) {
            jdbc.sql("insert into slot_booking_items (booking_id, resource_id, starts_at, ends_at, spots, price) values (:b, :r, :s, :e, :n, :p)")
                    .param("b", id).param("r", UUID.fromString(l.r().id())).param("s", l.from()).param("e", l.to()).param("n", l.spots()).param("p", l.price()).update();
        }
        return booking(customer, id);
    }

    private void releaseOwnHolds(UUID customer, UUID business) {
        String unpaid = "b.customer_id = :c and b.business_id = :bz and b.status = 'held' and not exists (select 1 from payments p where p.payment_request_id = b.payment_request_id and p.status in ('pending', 'verified'))";
        jdbc.sql("update payment_requests set status = 'void' where id in (select b.payment_request_id from slot_bookings b where " + unpaid + ")").param("c", customer).param("bz", business).update();
        jdbc.sql("update slot_bookings b set status = 'released' where " + unpaid).param("c", customer).param("bz", business).update();
    }

    /** The customer lets an unpaid hold go. */
    @Transactional
    public void release(UUID customer, UUID id) {
        jdbc.sql("update payment_requests set status = 'void' where id = (select payment_request_id from slot_bookings where id = :id and customer_id = :c and status = 'held') "
                + "and not exists (select 1 from payments p where p.payment_request_id = payment_requests.id and p.status in ('pending', 'verified'))").param("id", id).param("c", customer).update();
        jdbc.sql("update slot_bookings b set status = 'released' where id = :id and customer_id = :c and status = 'held' and exists (select 1 from payment_requests pr where pr.id = b.payment_request_id and pr.status = 'void')")
                .param("id", id).param("c", customer).update();
    }

    /** Called once, inside the transaction that marks the payment verified. */
    public void confirm(UUID paymentRequestId) {
        record B(UUID id, UUID business, UUID customer, String status, String ref) {}
        B b = jdbc.sql("select id, business_id, customer_id, status, booking_ref from slot_bookings where payment_request_id = :p for update").param("p", paymentRequestId)
                .query((rs, i) -> new B((UUID) rs.getObject(1), (UUID) rs.getObject(2), (UUID) rs.getObject(3), rs.getString(4), rs.getString(5))).single();
        if ("paid".equals(b.status())) return;
        for (int attempt = 0; ; attempt++) {
            try {
                jdbc.sql("update slot_bookings set status = 'paid', paid_at = now(), entry_code = :code where id = :id").param("code", code(3) + "-" + code(3)).param("id", b.id()).update();
                break;
            } catch (DuplicateKeyException e) {
                if (attempt >= 4) throw e;
            }
        }
        List<ItemView> items = items(b.id());
        ItemView first = items.getFirst();
        String bname = jdbc.sql("select name from businesses where id = :id").param("id", b.business()).query(String.class).single();
        String when = WHEN.format(first.startsAt()) + "–" + TIME.format(first.endsAt());
        notifications.notify(b.customer(), "slot_booked", "Booked: " + first.sport() + " at " + bname,
                first.resourceName() + ", " + when + (items.size() > 1 ? " and " + (items.size() - 1) + " more" : "") + ". Show your entry code at the venue. Booking " + b.ref() + ".", "slot_booking", b.id().toString());
        String who = jdbc.sql("select name from customers where id = :id").param("id", b.customer()).query((rs, i) -> Customers.displayName(rs.getString(1))).single();
        staffNotifications.toBusiness(b.business(), "slot_booked", first.sport() + " booked: " + first.resourceName() + ", " + when,
                who + (items.size() > 1 ? " booked " + items.size() + " slots" : " booked it") + " and paid through VIBE. Booking " + b.ref() + ".", "/bookings");
    }

    private List<ItemView> items(UUID booking) {
        return jdbc.sql("select i.resource_id, r.name, r.sport, i.starts_at, i.ends_at, i.spots, i.price from slot_booking_items i join venue_resources r on r.id = i.resource_id where i.booking_id = :b order by i.starts_at, r.name")
                .param("b", booking).query((rs, i) -> new ItemView(rs.getString(1), rs.getString(2), rs.getString(3), rs.getObject(4, OffsetDateTime.class), rs.getObject(5, OffsetDateTime.class),
                        rs.getInt(6), rs.getLong(7))).list();
    }

    private static final String BOOKING = "select s.*, z.name bname, z.area, z.address from slot_bookings s join businesses z on z.id = s.business_id ";

    private Booking map(java.sql.ResultSet rs) throws java.sql.SQLException {
        UUID id = (UUID) rs.getObject("id");
        String status = rs.getString("status");
        OffsetDateTime expires = rs.getObject("expires_at", OffsetDateTime.class);
        if ("held".equals(status) && expires.isBefore(now()) && jdbc.sql("select count(*) from payments where payment_request_id = :p and status = 'pending'")
                .param("p", rs.getObject("payment_request_id")).query(Integer.class).single() == 0) status = "released";
        return new Booking(id.toString(), rs.getString("business_id"), rs.getString("bname"), rs.getString("area"), rs.getString("address"), status, rs.getString("booking_ref"),
                "paid".equals(status) ? rs.getString("entry_code") : null, rs.getLong("total"), expires, rs.getString("payment_request_id"), items(id),
                rs.getObject("paid_at", OffsetDateTime.class), rs.getObject("checked_in_at", OffsetDateTime.class));
    }

    public Booking booking(UUID customer, UUID id) {
        return jdbc.sql(BOOKING + "where s.id = :id and s.customer_id = :c").param("id", id).param("c", customer).query((rs, i) -> map(rs)).optional()
                .orElseThrow(() -> ApiException.notFound("Booking not found."));
    }

    /** The customer's confirmed bookings, soonest first. */
    public List<Booking> mine(UUID customer) {
        return jdbc.sql(BOOKING + "where s.customer_id = :c and s.status = 'paid' order by (select min(starts_at) from slot_booking_items i where i.booking_id = s.id) desc limit 100")
                .param("c", customer).query((rs, i) -> map(rs)).list();
    }

    public String bookingIdFor(UUID paymentRequestId) {
        return jdbc.sql("select id from slot_bookings where payment_request_id = :p").param("p", paymentRequestId).query(String.class).optional().orElse(null);
    }

    // =====================================================================
    // The venue's day (merchant)
    // =====================================================================
    public Day day(UUID business, LocalDate date) {
        OffsetDateTime from = date.atStartOfDay(IST).toOffsetDateTime(), to = date.plusDays(1).atStartOfDay(IST).plusHours(6).toOffsetDateTime();
        List<DayBooking> bookings = jdbc.sql("select b.id, b.booking_ref, c.name, c.vibe_id, i.resource_id, i.starts_at, i.ends_at, i.spots, b.status, b.checked_in_at, i.price "
                        + "from slot_booking_items i join slot_bookings b on b.id = i.booking_id join customers c on c.id = b.customer_id "
                        + "where b.business_id = :b and i.starts_at >= :f and i.starts_at < :t and " + LIVE + " order by i.starts_at")
                .param("b", business).param("f", from).param("t", to).param("now", now())
                .query((rs, i) -> new DayBooking(rs.getString(1), rs.getString(2), Customers.displayName(rs.getString(3)), rs.getString(4), rs.getString(5), rs.getObject(6, OffsetDateTime.class),
                        rs.getObject(7, OffsetDateTime.class), rs.getInt(8), rs.getString(9), rs.getObject(10) != null, rs.getLong(11))).list();
        List<Block> blocks = jdbc.sql("select k.id, k.resource_id, k.starts_at, k.ends_at, k.reason from resource_blocks k join venue_resources r on r.id = k.resource_id "
                        + "where r.business_id = :b and k.starts_at < :t and k.ends_at > :f order by k.starts_at").param("b", business).param("f", from).param("t", to)
                .query((rs, i) -> new Block(rs.getString(1), rs.getString(2), rs.getObject(3, OffsetDateTime.class), rs.getObject(4, OffsetDateTime.class), rs.getString(5))).list();
        long[] today = jdbc.sql("select count(*), coalesce(sum(total), 0) from slot_bookings where business_id = :b and status = 'paid' and paid_at >= :f").param("b", business)
                .param("f", now().atZoneSameInstant(IST).toLocalDate().atStartOfDay(IST).toOffsetDateTime()).query((rs, i) -> new long[]{rs.getLong(1), rs.getLong(2)}).single();
        return new Day(date.toString(), resources(business, false), bookings, blocks, (int) today[0], today[1]);
    }

    @Transactional
    public Block block(StaffPrincipal who, BlockInput in) {
        UUID business = who.requireBusiness();
        Resource r = one(business, parse(in.resourceId()));
        if (!in.endsAt().isAfter(in.startsAt())) throw ApiException.badRequest("times", "The block must end after it starts.");
        if (taken(r, in.startsAt(), in.endsAt()) > 0 && jdbc.sql("select count(*) from slot_booking_items i join slot_bookings b on b.id = i.booking_id where i.resource_id = :r and i.starts_at < :t and i.ends_at > :f and b.status = 'paid'")
                .param("r", UUID.fromString(r.id())).param("f", in.startsAt()).param("t", in.endsAt()).query(Integer.class).single() > 0) {
            throw ApiException.conflict("has_bookings", "Customers have booked " + r.name() + " in that time. Contact them, or block a different time.");
        }
        UUID id = UUID.randomUUID();
        jdbc.sql("insert into resource_blocks (id, resource_id, starts_at, ends_at, reason, created_by) values (:id, :r, :s, :e, :reason, :by)")
                .param("id", id).param("r", UUID.fromString(r.id())).param("s", in.startsAt()).param("e", in.endsAt()).param("reason", in.reason() == null ? "" : in.reason().trim()).param("by", who.id()).update();
        audit.record(who, "block", "venue_resource", r.id(), WHEN.format(in.startsAt()) + "–" + TIME.format(in.endsAt()));
        return new Block(id.toString(), r.id(), in.startsAt(), in.endsAt(), in.reason() == null ? "" : in.reason().trim());
    }

    @Transactional
    public void unblock(StaffPrincipal who, UUID id) {
        int n = jdbc.sql("delete from resource_blocks k using venue_resources r where k.id = :id and r.id = k.resource_id and r.business_id = :b").param("id", id).param("b", who.requireBusiness()).update();
        if (n == 0) throw ApiException.notFound("Not found.");
        audit.record(who, "unblock", "resource_block", id, "");
    }

    /** At the front desk: the entry code on the customer's booking. A booking checks in once. */
    @Transactional
    public CheckIn checkIn(StaffPrincipal who, String raw) {
        UUID business = who.requireBusiness();
        String code = raw.toUpperCase(Locale.ROOT).replaceAll("[^A-Z0-9]", "");
        if (code.length() == 6) code = code.substring(0, 3) + "-" + code.substring(3);
        if (jdbc.sql("select count(*) from slot_bookings where business_id = :b and entry_code = :c and status = 'paid'").param("b", business).param("c", code).query(Integer.class).single() == 0) {
            CheckIn member = passes.checkIn(who, code); // the same desk takes members' pass codes
            if (member != null) return member;
        }
        record B(UUID id, String ref, String cname, OffsetDateTime checked) {}
        B b = jdbc.sql("select s.id, s.booking_ref, c.name, s.checked_in_at from slot_bookings s join customers c on c.id = s.customer_id where s.business_id = :bz and s.entry_code = :code and s.status = 'paid' for update of s")
                .param("bz", business).param("code", code).query((rs, i) -> new B((UUID) rs.getObject(1), rs.getString(2), rs.getString(3), rs.getObject(4, OffsetDateTime.class))).optional()
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "no_booking", "No booking or membership with that code at your venue."));
        List<ItemView> items = items(b.id());
        if (b.checked() != null) return new CheckIn("already", "Already checked in at " + WHEN.format(b.checked()) + ".", b.ref(), Customers.displayName(b.cname()), items);
        jdbc.sql("update slot_bookings set checked_in_at = now() where id = :id").param("id", b.id()).update();
        audit.record(who, "check_in", "slot_booking", b.id(), b.ref());
        return new CheckIn("admitted", "Checked in. Enjoy the game.", b.ref(), Customers.displayName(b.cname()), items);
    }

    // ---------- helpers ----------
    static UUID parse(String s) {
        try { return UUID.fromString(s); } catch (IllegalArgumentException e) { throw ApiException.notFound("Not found."); }
    }

    private String code(int n) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) sb.append(ALPHABET.charAt(random.nextInt(ALPHABET.length())));
        return sb.toString();
    }
}
