package in.vibe.backend.movies;

import in.vibe.backend.audit.AuditService;
import in.vibe.backend.billing.Notifications;
import in.vibe.backend.common.ApiException;
import in.vibe.backend.notify.StaffNotifications;
import in.vibe.backend.security.StaffPrincipal;
import in.vibe.backend.tickets.Ticketing;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

import java.security.SecureRandom;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Movies: the films VIBE lists, the shows cinemas schedule on their screens, seat maps, seat holds and the tickets issued once paid.
 * Holds for one show take turns by locking the show row, so two people can never pay for the same seat.
 */
@Service
public class Movies {
    public static final int HOLD_MINUTES = Ticketing.HOLD_MINUTES;
    static final int MAX_SEATS = 10;
    /** Time between shows on one screen for cleaning and ads. */
    static final int TURNAROUND_MIN = 20;
    static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final double HOME_LAT = 17.4326, HOME_LNG = 78.4071;
    private static final DateTimeFormatter WHEN = DateTimeFormatter.ofPattern("EEE d MMM, h:mm a", Locale.ENGLISH).withZone(IST);
    private static final String ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static final Set<String> FORMATS = Set.of("2D", "3D", "IMAX", "Dolby Atmos");
    /** Held = counts against the seats: still inside its time, or its payment is being processed. */
    static final String HELD = "b.status = 'held' and (b.expires_at > :now or exists (select 1 from payments p where p.payment_request_id = b.payment_request_id and p.status = 'pending'))";

    // ---------- shapes the customer app reads ----------
    public record MovieSummary(String id, String title, String certificate, int durationMin, List<String> genres, List<String> languages, List<String> formats, Double rating, int votes,
                               String posterUrl, LocalDate releaseDate, String status) {}

    public record MovieDetail(String id, String title, String certificate, int durationMin, List<String> genres, List<String> languages, List<String> formats, Double rating, int votes,
                              String posterUrl, LocalDate releaseDate, String status, String synopsis, String director, List<String> cast) {}

    public record ShowSummary(String id, OffsetDateTime startsAt, String language, String format, String screenName, long priceFrom, String availability) {}

    public record ShowDetail(String id, OffsetDateTime startsAt, String language, String format, String screenName, long priceFrom, String availability,
                             String movieId, String movieTitle, String certificate, String cinemaId, String cinemaName, String area) {}

    public record Cinema(String id, String name, String area, double distanceKm) {}

    public record CinemaShows(Cinema cinema, List<ShowSummary> shows) {}

    public record MovieShows(MovieSummary movie, List<ShowSummary> shows) {}

    public record SeatClass(String id, String name, long price) {}

    public record SeatCell(String id, int number, String status) {}

    public record SeatRow(String label, String classId, List<SeatCell> seats) {}

    public record SeatMap(ShowDetail show, List<SeatClass> classes, List<SeatRow> rows, int maxSeats, int holdMinutes) {}

    public record HoldInput(@NotNull @Size(min = 1, max = MAX_SEATS) List<String> seatIds, String meetId) {}

    public record HeldSeat(String id, String label, String classId, String className, long price) {}

    public record SeatHold(String holdId, String showId, List<HeldSeat> seats, long total, OffsetDateTime expiresAt, String paymentRequestId) {}

    /** A screen's layout: rows of seat numbers, null where there's an aisle. */
    public record LayoutRow(String label, String classId, List<Integer> seats) {}

    private final JdbcClient jdbc;
    private final JsonMapper json;
    private final Notifications notifications;
    private final StaffNotifications staffNotifications;
    private final AuditService audit;
    private final Clock clock;
    private final SecureRandom random = new SecureRandom();

    Movies(JdbcClient jdbc, JsonMapper json, Notifications notifications, StaffNotifications staffNotifications, AuditService audit, Clock clock) {
        this.jdbc = jdbc;
        this.json = json;
        this.notifications = notifications;
        this.staffNotifications = staffNotifications;
        this.audit = audit;
        this.clock = clock;
    }

    OffsetDateTime now() { return OffsetDateTime.now(clock); }

    LocalDate today() { return now().atZoneSameInstant(IST).toLocalDate(); }

    static UUID uuid(String s) {
        try { return UUID.fromString(s); } catch (IllegalArgumentException | NullPointerException e) { throw ApiException.notFound("Not found."); }
    }

    List<SeatClass> classes(String raw) { return json.readValue(raw, new TypeReference<List<SeatClass>>() {}); }

    List<LayoutRow> rows(String raw) { return json.readValue(raw, new TypeReference<List<LayoutRow>>() {}); }

    String toJson(Object o) { return json.writeValueAsString(o); }

    // ---------- films ----------
    static final String MOVIE_COLS = "id, title, certificate, duration_min, genres, languages, formats, rating, votes, poster_url, release_date, synopsis, director, cast_names, archived";

    private static List<String> arr(ResultSet rs, String col) throws SQLException { return List.of((String[]) rs.getArray(col).getArray()); }

    private String status(LocalDate release) { return release.isAfter(today()) ? "coming_soon" : "now_showing"; }

    MovieSummary summary(ResultSet rs) throws SQLException {
        LocalDate release = rs.getObject("release_date", LocalDate.class);
        return new MovieSummary(rs.getString("id"), rs.getString("title"), rs.getString("certificate"), rs.getInt("duration_min"), arr(rs, "genres"), arr(rs, "languages"), arr(rs, "formats"),
                rs.getObject("rating") == null ? null : rs.getDouble("rating"), rs.getInt("votes"), rs.getString("poster_url"), release, status(release));
    }

    MovieDetail detail(ResultSet rs) throws SQLException {
        MovieSummary s = summary(rs);
        return new MovieDetail(s.id(), s.title(), s.certificate(), s.durationMin(), s.genres(), s.languages(), s.formats(), s.rating(), s.votes(), s.posterUrl(), s.releaseDate(), s.status(),
                rs.getString("synopsis"), rs.getString("director"), arr(rs, "cast_names"));
    }

    public List<MovieSummary> films(String status, String language) {
        return jdbc.sql("select " + MOVIE_COLS + " from movies where not archived" + (language == null || language.isBlank() ? "" : " and :lang = any(languages)") + " order by release_date desc, title")
                .param("lang", language == null ? "" : language)
                .query((rs, i) -> summary(rs)).list().stream().filter(m -> status == null || status.isBlank() || status.equals(m.status())).toList();
    }

    public MovieDetail film(UUID id) {
        return jdbc.sql("select " + MOVIE_COLS + " from movies where id = :id and not archived").param("id", id).query((rs, i) -> detail(rs)).optional()
                .orElseThrow(() -> ApiException.notFound("Film not found."));
    }

    // ---------- showtimes ----------
    private record ShowRow(UUID id, UUID movie, UUID business, String bname, String area, Double lat, Double lng, OffsetDateTime startsAt, String language, String format, String screen,
                           String classes, int seatCount, int taken) {}

    private static final String SHOW_SELECT = "select s.id, s.movie_id, s.business_id, b.name bname, b.area, b.lat, b.lng, s.starts_at, s.language, s.format, sc.name screen, s.classes, sc.seat_count, "
            + "(select count(*) from movie_tickets t where t.show_id = s.id and t.status <> 'cancelled') "
            + "+ coalesce((select sum(cardinality(b2.seats)) from movie_bookings b2 where b2.show_id = s.id and b2.status = 'held' and (b2.expires_at > :now "
            + "or exists (select 1 from payments p where p.payment_request_id = b2.payment_request_id and p.status = 'pending'))), 0) taken "
            + "from movie_shows s join cinema_screens sc on sc.id = s.screen_id join businesses b on b.id = s.business_id ";

    private ShowRow showRow(ResultSet rs) throws SQLException {
        return new ShowRow((UUID) rs.getObject("id"), (UUID) rs.getObject("movie_id"), (UUID) rs.getObject("business_id"), rs.getString("bname"), rs.getString("area"),
                rs.getObject("lat", Double.class), rs.getObject("lng", Double.class), rs.getObject("starts_at", OffsetDateTime.class), rs.getString("language"), rs.getString("format"),
                rs.getString("screen"), rs.getString("classes"), rs.getInt("seat_count"), rs.getInt("taken"));
    }

    private static String availability(int seatCount, int taken) {
        int free = Math.max(0, seatCount - taken);
        if (free == 0) return "sold_out";
        double left = (double) free / seatCount;
        return left < 0.15 ? "almost_full" : left < 0.4 ? "filling_fast" : "available";
    }

    private ShowSummary summary(ShowRow s) {
        long from = classes(s.classes()).stream().mapToLong(SeatClass::price).min().orElse(0);
        return new ShowSummary(s.id().toString(), s.startsAt(), s.language(), s.format(), s.screen(), from, availability(s.seatCount(), s.taken()));
    }

    private List<ShowRow> upcomingShows(String where, LocalDate day, Map<String, Object> params) {
        LocalDate d = day == null ? today() : day;
        OffsetDateTime from = d.atStartOfDay(IST).toOffsetDateTime(), to = d.plusDays(1).atStartOfDay(IST).toOffsetDateTime();
        OffsetDateTime now = now();
        var spec = jdbc.sql(SHOW_SELECT + "where s.status = 'scheduled' and sc.active and b.active and s.starts_at >= :from and s.starts_at < :to and s.starts_at > :now and " + where + " order by s.starts_at")
                .param("from", from).param("to", to).param("now", now);
        for (var e : params.entrySet()) spec = spec.param(e.getKey(), e.getValue());
        return spec.query((rs, i) -> showRow(rs)).list();
    }

    private static double km(Double lat, Double lng) {
        if (lat == null || lng == null) return 0;
        double dLat = Math.toRadians(lat - HOME_LAT), dLng = Math.toRadians(lng - HOME_LNG);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(Math.toRadians(HOME_LAT)) * Math.cos(Math.toRadians(lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return Math.round(6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10.0;
    }

    /** The cinemas playing a film on a day, nearest first. */
    public List<CinemaShows> filmShowtimes(UUID movie, LocalDate day) {
        film(movie);
        Map<UUID, List<ShowRow>> byCinema = new LinkedHashMap<>();
        for (ShowRow s : upcomingShows("s.movie_id = :m", day, Map.of("m", movie))) byCinema.computeIfAbsent(s.business(), k -> new ArrayList<>()).add(s);
        return byCinema.values().stream().map(list -> {
            ShowRow f = list.getFirst();
            return new CinemaShows(new Cinema(f.business().toString(), f.bname(), f.area(), km(f.lat(), f.lng())), list.stream().map(this::summary).toList());
        }).sorted(Comparator.comparingDouble(c -> c.cinema().distanceKm())).toList();
    }

    /** The films one cinema runs on a day. */
    public List<MovieShows> cinemaShowtimes(UUID business, LocalDate day) {
        Map<UUID, List<ShowRow>> byFilm = new LinkedHashMap<>();
        for (ShowRow s : upcomingShows("s.business_id = :b", day, Map.of("b", business))) byFilm.computeIfAbsent(s.movie(), k -> new ArrayList<>()).add(s);
        List<MovieShows> out = new ArrayList<>();
        for (var e : byFilm.entrySet()) {
            MovieSummary m = jdbc.sql("select " + MOVIE_COLS + " from movies where id = :id").param("id", e.getKey()).query((rs, i) -> summary(rs)).single();
            out.add(new MovieShows(m, e.getValue().stream().map(this::summary).toList()));
        }
        return out;
    }

    // ---------- seats ----------
    private ShowRow show(UUID id, boolean lock) {
        if (lock) jdbc.sql("select id from movie_shows where id = :id for update").param("id", id).query(UUID.class).optional().orElseThrow(() -> ApiException.notFound("Show not found."));
        return jdbc.sql(SHOW_SELECT + "where s.id = :id").param("id", id).param("now", now()).query((rs, i) -> showRow(rs)).optional().orElseThrow(() -> ApiException.notFound("Show not found."));
    }

    private Set<String> takenSeats(UUID show) {
        Set<String> taken = new HashSet<>(jdbc.sql("select seat_id from movie_tickets where show_id = :s and status <> 'cancelled'").param("s", show).query(String.class).list());
        jdbc.sql("select b.seats from movie_bookings b where b.show_id = :s and " + HELD).param("s", show).param("now", now())
                .query((rs, i) -> taken.addAll(List.of((String[]) rs.getArray(1).getArray()))).list();
        return taken;
    }

    private ShowDetail detail(ShowRow s) {
        ShowSummary sum = summary(s);
        record M(String title, String cert) {}
        M m = jdbc.sql("select title, certificate from movies where id = :id").param("id", s.movie()).query((rs, i) -> new M(rs.getString(1), rs.getString(2))).single();
        return new ShowDetail(sum.id(), sum.startsAt(), sum.language(), sum.format(), sum.screenName(), sum.priceFrom(), sum.availability(), s.movie().toString(), m.title(), m.cert(),
                s.business().toString(), s.bname(), s.area());
    }

    private List<LayoutRow> layout(UUID show) {
        return rows(jdbc.sql("select sc.rows::text from movie_shows s join cinema_screens sc on sc.id = s.screen_id where s.id = :id").param("id", show).query(String.class).single());
    }

    public SeatMap seatMap(UUID showId) {
        ShowRow s = show(showId, false);
        Set<String> taken = takenSeats(showId);
        boolean onSale = s.startsAt().isAfter(now()) && "scheduled".equals(jdbc.sql("select status from movie_shows where id = :id").param("id", showId).query(String.class).single());
        List<SeatRow> rows = layout(showId).stream().map(r -> {
            List<SeatCell> cells = new ArrayList<>();
            for (Integer n : r.seats()) cells.add(n == null ? null : new SeatCell(r.label() + n, n, onSale && !taken.contains(r.label() + n) ? "available" : "unavailable"));
            return new SeatRow(r.label(), r.classId(), cells);
        }).toList();
        return new SeatMap(detail(s), classes(s.classes()), rows, MAX_SEATS, HOLD_MINUTES);
    }

    @Transactional
    public SeatHold hold(UUID customer, UUID showId, HoldInput in) {
        if (in.meetId() != null && !in.meetId().isBlank()) throw ApiException.conflict("movie_plans_soon", "Movie plans for two open soon. Book seats on your own for now.");
        ShowRow s = show(showId, true);
        String status = jdbc.sql("select status from movie_shows where id = :id").param("id", showId).query(String.class).single();
        if (!"scheduled".equals(status) || !s.startsAt().isAfter(now())) throw ApiException.conflict("not_on_sale", "This show isn’t taking bookings any more.");
        List<String> wanted = in.seatIds().stream().map(x -> x == null ? "" : x.trim().toUpperCase(Locale.ROOT)).distinct().toList();
        if (wanted.isEmpty() || wanted.size() > MAX_SEATS) throw ApiException.badRequest("seats", "Choose 1 to " + MAX_SEATS + " seats.");

        // A new hold replaces this customer's earlier unpaid hold for the same show.
        jdbc.sql("update payment_requests set status = 'void' where id in (select b.payment_request_id from movie_bookings b where b.customer_id = :c and b.show_id = :s and b.status = 'held' "
                        + "and not exists (select 1 from payments p where p.payment_request_id = b.payment_request_id and p.status in ('pending', 'verified')))")
                .param("c", customer).param("s", showId).update();
        jdbc.sql("update movie_bookings b set status = 'released' where b.customer_id = :c and b.show_id = :s and b.status = 'held' "
                        + "and not exists (select 1 from payments p where p.payment_request_id = b.payment_request_id and p.status in ('pending', 'verified'))")
                .param("c", customer).param("s", showId).update();

        Map<String, SeatClass> classes = new LinkedHashMap<>();
        for (SeatClass c : classes(s.classes())) classes.put(c.id(), c);
        Map<String, String> seatClass = new LinkedHashMap<>();
        for (LayoutRow r : layout(showId)) for (Integer n : r.seats()) if (n != null) seatClass.put(r.label() + n, r.classId());
        Set<String> taken = takenSeats(showId);
        List<HeldSeat> seats = new ArrayList<>();
        long total = 0;
        for (String id : wanted) {
            String cid = seatClass.get(id);
            if (cid == null || !classes.containsKey(cid)) throw ApiException.badRequest("seats", "Seat " + id + " isn’t on this screen.");
            if (taken.contains(id)) throw ApiException.conflict("seat_taken", "Seat " + id + " was just taken. Choose another seat.");
            SeatClass c = classes.get(cid);
            seats.add(new HeldSeat(id, id, cid, c.name(), c.price()));
            total += c.price();
        }
        if (total <= 0) throw ApiException.conflict("free_seats", "These seats have no price set. Ask the cinema.");

        UUID bookingId = UUID.randomUUID(), prId = UUID.randomUUID();
        OffsetDateTime expires = now().plusMinutes(HOLD_MINUTES);
        String ref = "VBF-" + code(4) + "-" + code(4);
        jdbc.sql("insert into payment_requests (id, kind, reservation_id, business_id, customer_id, bill_ref, raised_by, eligible_amount, discount, discount_label, vibe_fee, payable, expires_at) "
                        + "values (:id, 'movie', :r, :b, :c, :ref, 'VIBE Movies', :t, 0, '', 0, :t, :x)")
                .param("id", prId).param("r", bookingId).param("b", s.business()).param("c", customer).param("ref", ref).param("t", total).param("x", expires).update();
        Map<String, long[]> lines = new LinkedHashMap<>(); // class name -> [count, amount]
        for (HeldSeat h : seats) { long[] l = lines.computeIfAbsent(h.className(), k -> new long[2]); l[0]++; l[1] += h.price(); }
        int pos = 0;
        for (var e : lines.entrySet()) {
            jdbc.sql("insert into payment_request_lines (payment_request_id, position, label, amount) values (:p, :n, :l, :a)")
                    .param("p", prId).param("n", pos++).param("l", e.getKey() + " × " + e.getValue()[0]).param("a", e.getValue()[1]).update();
        }
        jdbc.sql("insert into movie_bookings (id, show_id, customer_id, seats, total, expires_at, payment_request_id, booking_id) values (:id, :s, :c, :seats, :t, :x, :p, :ref)")
                .param("id", bookingId).param("s", showId).param("c", customer).param("seats", wanted.toArray(new String[0])).param("t", total).param("x", expires).param("p", prId).param("ref", ref).update();
        return new SeatHold(bookingId.toString(), showId.toString(), seats, total, expires, prId.toString());
    }

    // ---------- after the payment partner confirms ----------
    /** Called once, inside the transaction that marks the payment verified: one ticket per seat, and the customer and the cinema are told. */
    public void issue(UUID paymentRequestId) {
        record B(UUID id, UUID show, UUID customer, String status, List<String> seats, String ref) {}
        B b = jdbc.sql("select id, show_id, customer_id, status, seats, booking_id from movie_bookings where payment_request_id = :p for update").param("p", paymentRequestId)
                .query((rs, i) -> new B((UUID) rs.getObject(1), (UUID) rs.getObject(2), (UUID) rs.getObject(3), rs.getString(4), List.of((String[]) rs.getArray(5).getArray()), rs.getString(6))).single();
        if ("paid".equals(b.status())) return;
        jdbc.sql("update movie_bookings set status = 'paid', paid_at = now() where id = :id").param("id", b.id()).update();
        ShowRow s = show(b.show(), false);
        Map<String, SeatClass> classes = new LinkedHashMap<>();
        for (SeatClass c : classes(s.classes())) classes.put(c.id(), c);
        Map<String, String> seatClass = new LinkedHashMap<>();
        for (LayoutRow r : layout(b.show())) for (Integer n : r.seats()) if (n != null) seatClass.put(r.label() + n, r.classId());
        int n = 0;
        for (String seat : b.seats()) {
            SeatClass c = classes.getOrDefault(seatClass.get(seat), new SeatClass("", "Seat", 0));
            insertTicket(b.id(), b.show(), b.customer(), seat, c, ++n, b.seats().size());
        }
        String title = jdbc.sql("select title from movies where id = :id").param("id", s.movie()).query(String.class).single();
        String seatList = String.join(", ", b.seats());
        notifications.notify(b.customer(), "tickets_issued", b.seats().size() == 1 ? "Your seat is booked" : "Your " + b.seats().size() + " seats are booked",
                title + ", " + WHEN.format(s.startsAt()) + " at " + s.bname() + " (" + s.screen() + "), seats " + seatList + ". Show the QR code at the entrance. Booking " + b.ref() + ".", "tickets", b.id().toString());
        staffNotifications.toBusiness(s.business(), "movie_seats_sold", b.seats().size() + (b.seats().size() == 1 ? " seat sold: " : " seats sold: ") + title,
                WHEN.format(s.startsAt()) + " · " + s.screen() + " · " + seatList + ".", "/cinema");
    }

    private void insertTicket(UUID booking, UUID show, UUID customer, String seat, SeatClass c, int index, int of) {
        for (int attempt = 0; ; attempt++) {
            try {
                jdbc.sql("insert into movie_tickets (id, booking_id, show_id, customer_id, seat_id, class_name, price, admission_code, qr_token, position, of_count) "
                                + "values (:id, :b, :s, :c, :seat, :cn, :p, :code, :qr, :pos, :of)")
                        .param("id", UUID.randomUUID()).param("b", booking).param("s", show).param("c", customer).param("seat", seat).param("cn", c.name()).param("p", c.price())
                        .param("code", code(3) + "-" + code(3)).param("qr", "vibe.m." + code(32)).param("pos", index).param("of", of).update();
                return;
            } catch (DuplicateKeyException e) {
                if (attempt >= 4) throw e;
            }
        }
    }

    // ---------- customer: tickets (shown alongside event tickets) ----------
    private static final String TICKET_SELECT = "select t.*, b.booking_id ref, m.title, s.starts_at, cb.name cinema, sc.name screen, cb.area, m.poster_url, c.name cname, pay.amount paid_total "
            + "from movie_tickets t join movie_bookings b on b.id = t.booking_id join movie_shows s on s.id = t.show_id join movies m on m.id = s.movie_id "
            + "join cinema_screens sc on sc.id = s.screen_id join businesses cb on cb.id = s.business_id join customers c on c.id = t.customer_id "
            + "left join payments pay on pay.payment_request_id = b.payment_request_id and pay.status = 'verified' ";

    private static Ticketing.Ticket ticket(ResultSet rs, int i) throws SQLException {
        OffsetDateTime starts = rs.getObject("starts_at", OffsetDateTime.class);
        String first = rs.getString("cname") == null ? "Guest" : rs.getString("cname").trim().split("\\s+")[0];
        return new Ticketing.Ticket(rs.getString("id"), rs.getString("ref"), rs.getString("show_id"), rs.getString("title"), "Movies", starts, starts.minusMinutes(20),
                rs.getString("cinema") + " · " + rs.getString("screen"), rs.getString("area"), rs.getString("class_name"), first, rs.getString("admission_code"), rs.getString("qr_token"),
                rs.getString("seat_id"), rs.getString("poster_url"), rs.getString("status"), rs.getInt("position"), rs.getInt("of_count"), rs.getLong("paid_total"));
    }

    public List<Ticketing.Ticket> myTickets(UUID customer) {
        return jdbc.sql(TICKET_SELECT + "where t.customer_id = :c order by s.starts_at, b.booking_id, t.position").param("c", customer).query(Movies::ticket).list();
    }

    public Optional<Ticketing.Ticket> myTicket(UUID customer, UUID id) {
        return jdbc.sql(TICKET_SELECT + "where t.id = :id and t.customer_id = :c").param("id", id).param("c", customer).query(Movies::ticket).optional();
    }

    public List<String> ticketIds(UUID paymentRequestId) {
        return jdbc.sql("select t.id from movie_tickets t join movie_bookings b on b.id = t.booking_id where b.payment_request_id = :p order by t.position").param("p", paymentRequestId)
                .query(String.class).list();
    }

    // ---------- the cinema's door ----------
    public record CheckInInput(@NotBlank @Size(max = 200) String code) {}

    /** result: admitted, already, wrong_cinema, too_early, cancelled. */
    public record CheckIn(String result, String message, String movieTitle, OffsetDateTime startsAt, String screen, String seat, String bookingId, OffsetDateTime checkedInAt) {}

    @Transactional
    public CheckIn checkIn(StaffPrincipal who, UUID business, String raw) {
        String code = raw.trim();
        String admission = code.toUpperCase(Locale.ROOT).replaceAll("[^A-Z0-9]", "");
        if (admission.length() == 6) admission = admission.substring(0, 3) + "-" + admission.substring(3);
        record T(UUID id, UUID business, String status, String title, OffsetDateTime starts, String screen, String seat, String ref, OffsetDateTime at) {}
        T t = jdbc.sql("select t.id, s.business_id, t.status, m.title, s.starts_at, sc.name, t.seat_id, b.booking_id, t.checked_in_at from movie_tickets t join movie_shows s on s.id = t.show_id "
                        + "join movies m on m.id = s.movie_id join cinema_screens sc on sc.id = s.screen_id join movie_bookings b on b.id = t.booking_id "
                        + "where t.qr_token = :q or t.admission_code = :a for update of t")
                .param("q", code).param("a", admission)
                .query((rs, i) -> new T((UUID) rs.getObject(1), (UUID) rs.getObject(2), rs.getString(3), rs.getString(4), rs.getObject(5, OffsetDateTime.class), rs.getString(6), rs.getString(7),
                        rs.getString(8), rs.getObject(9, OffsetDateTime.class)))
                .optional().orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "no_ticket", "No movie ticket has that code. Check it in the customer’s VIBE app."));
        if (!t.business().equals(business)) return new CheckIn("wrong_cinema", "This ticket is for another cinema.", t.title(), t.starts(), t.screen(), t.seat(), t.ref(), null);
        if ("cancelled".equals(t.status())) return new CheckIn("cancelled", "This ticket was cancelled. Don’t let them in on it.", t.title(), t.starts(), t.screen(), t.seat(), t.ref(), null);
        if ("checked_in".equals(t.status())) return new CheckIn("already", "Already used at " + WHEN.format(t.at()) + ".", t.title(), t.starts(), t.screen(), t.seat(), t.ref(), t.at());
        if (now().isBefore(t.starts().minusHours(1))) return new CheckIn("too_early", "This show starts at " + WHEN.format(t.starts()) + ". Entry opens an hour before.", t.title(), t.starts(), t.screen(), t.seat(), t.ref(), null);
        jdbc.sql("update movie_tickets set status = 'checked_in', checked_in_at = now(), checked_in_by = :by where id = :id").param("by", who.id()).param("id", t.id()).update();
        audit.record(who, "check_in", "movie_ticket", t.id(), t.ref() + " " + t.seat());
        return new CheckIn("admitted", "Let them in. Seat " + t.seat() + ", " + t.screen() + ".", t.title(), t.starts(), t.screen(), t.seat(), t.ref(), now());
    }

    String code(int n) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) sb.append(ALPHABET.charAt(random.nextInt(ALPHABET.length())));
        return sb.toString();
    }

    static boolean validFormat(String f) { return FORMATS.contains(f); }
}
