package in.vibe.backend.movies;

import in.vibe.backend.audit.AuditService;
import in.vibe.backend.common.ApiException;
import in.vibe.backend.security.StaffPrincipal;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Types;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/** VIBE's film catalogue (admin), and each cinema's screens and shows (merchant). */
@Service
public class MovieSetup {
    private static final Pattern ROW_LABEL = Pattern.compile("^[A-Z]{1,2}$");
    private static final Pattern CLASS_ID = Pattern.compile("^[a-z0-9-]{1,30}$");

    private final JdbcClient jdbc;
    private final Movies movies;
    private final AuditService audit;

    MovieSetup(JdbcClient jdbc, Movies movies, AuditService audit) {
        this.jdbc = jdbc;
        this.movies = movies;
        this.audit = audit;
    }

    // ---------- films (VIBE admin) ----------
    public record FilmInput(@NotBlank String title, @NotBlank String certificate, @NotNull Integer durationMin, List<String> genres, @NotNull List<String> languages, List<String> formats,
                            Double rating, Integer votes, String posterUrl, @NotNull LocalDate releaseDate, String synopsis, String director, List<String> cast, Boolean archived) {}

    public record FilmRow(Movies.MovieDetail film, boolean archived, int upcomingShows) {}

    public List<FilmRow> adminFilms() {
        return jdbc.sql("select " + Movies.MOVIE_COLS + ", (select count(*) from movie_shows s where s.movie_id = movies.id and s.status = 'scheduled' and s.starts_at > now()) upcoming "
                        + "from movies order by archived, release_date desc, title")
                .query((rs, i) -> new FilmRow(movies.detail(rs), rs.getBoolean("archived"), rs.getInt("upcoming"))).list();
    }

    private static List<String> clean(List<String> in) {
        if (in == null) return List.of();
        return in.stream().map(s -> s == null ? "" : s.trim()).filter(s -> !s.isEmpty()).distinct().toList();
    }

    private void validate(FilmInput in) {
        if (in.title().trim().length() > 120) throw ApiException.badRequest("title", "Keep the title under 120 characters.");
        if (!List.of("U", "UA", "A").contains(in.certificate())) throw ApiException.badRequest("certificate", "Choose U, UA or A.");
        if (in.durationMin() < 30 || in.durationMin() > 300) throw ApiException.badRequest("duration", "Running time must be 30 to 300 minutes.");
        if (clean(in.languages()).isEmpty()) throw ApiException.badRequest("languages", "Add at least one language.");
        List<String> formats = clean(in.formats()).isEmpty() ? List.of("2D") : clean(in.formats());
        if (!formats.stream().allMatch(Movies::validFormat)) throw ApiException.badRequest("formats", "Formats are 2D, 3D, IMAX or Dolby Atmos.");
        if (in.rating() != null && (in.rating() < 0 || in.rating() > 10)) throw ApiException.badRequest("rating", "Rating is out of 10.");
    }

    @Transactional
    public FilmRow saveFilm(StaffPrincipal who, UUID id, FilmInput in) {
        validate(in);
        boolean create = id == null;
        UUID filmId = create ? UUID.randomUUID() : id;
        List<String> formats = clean(in.formats()).isEmpty() ? List.of("2D") : clean(in.formats());
        String sql = create
                ? "insert into movies (id, title, certificate, duration_min, genres, languages, formats, rating, votes, poster_url, release_date, synopsis, director, cast_names, archived) "
                + "values (:id, :t, :c, :d, :g, :l, :f, :r, :v, :p, :rd, :s, :dir, :cast, :a)"
                : "update movies set title = :t, certificate = :c, duration_min = :d, genres = :g, languages = :l, formats = :f, rating = :r, votes = :v, poster_url = :p, release_date = :rd, "
                + "synopsis = :s, director = :dir, cast_names = :cast, archived = :a, updated_at = now() where id = :id";
        int n = jdbc.sql(sql).param("id", filmId).param("t", in.title().trim()).param("c", in.certificate()).param("d", in.durationMin())
                .param("g", clean(in.genres()).toArray(new String[0])).param("l", clean(in.languages()).toArray(new String[0])).param("f", formats.toArray(new String[0]))
                .param("r", in.rating(), Types.NUMERIC).param("v", in.votes() == null ? 0 : Math.max(0, in.votes())).param("p", in.posterUrl() == null || in.posterUrl().isBlank() ? null : in.posterUrl().trim(), Types.VARCHAR)
                .param("rd", in.releaseDate()).param("s", in.synopsis() == null ? "" : in.synopsis().trim()).param("dir", in.director() == null ? "" : in.director().trim())
                .param("cast", clean(in.cast()).toArray(new String[0])).param("a", Boolean.TRUE.equals(in.archived())).update();
        if (n == 0) throw ApiException.notFound("Film not found.");
        audit.record(who, create ? "film_created" : "film_updated", "movie", filmId, in.title().trim());
        return adminFilms().stream().filter(f -> f.film().id().equals(filmId.toString())).findFirst().orElseThrow();
    }

    // ---------- screens (the cinema) ----------
    public record ScreenInput(@NotBlank String name, @NotNull List<Movies.SeatClass> classes, @NotNull List<Movies.LayoutRow> rows, Boolean active) {}

    public record Screen(String id, String name, List<Movies.SeatClass> classes, List<Movies.LayoutRow> rows, int seatCount, boolean active) {}

    public List<Screen> screens(UUID business) {
        return jdbc.sql("select id, name, classes::text, rows::text, seat_count, active from cinema_screens where business_id = :b order by active desc, name").param("b", business)
                .query((rs, i) -> new Screen(rs.getString(1), rs.getString(2), movies.classes(rs.getString(3)), movies.rows(rs.getString(4)), rs.getInt(5), rs.getBoolean(6))).list();
    }

    private int validate(ScreenInput in) {
        String name = in.name().trim();
        if (name.isEmpty() || name.length() > 40) throw ApiException.badRequest("name", "Name the screen in up to 40 characters, like Screen 1 or Audi 2.");
        if (in.classes().isEmpty() || in.classes().size() > 6) throw ApiException.badRequest("classes", "Add 1 to 6 seat classes, like Recliner or Classic.");
        Set<String> ids = new HashSet<>();
        for (Movies.SeatClass c : in.classes()) {
            if (c.id() == null || !CLASS_ID.matcher(c.id()).matches() || !ids.add(c.id())) throw ApiException.badRequest("classes", "Each seat class needs its own short id.");
            if (c.name() == null || c.name().isBlank()) throw ApiException.badRequest("classes", "Name every seat class.");
            if (c.price() < 100) throw ApiException.badRequest("classes", "Every seat class needs a price of at least ₹1.");
        }
        if (in.rows().isEmpty() || in.rows().size() > 40) throw ApiException.badRequest("rows", "Add 1 to 40 rows.");
        Set<String> labels = new HashSet<>();
        int seats = 0;
        for (Movies.LayoutRow r : in.rows()) {
            if (r.label() == null || !ROW_LABEL.matcher(r.label()).matches() || !labels.add(r.label())) throw ApiException.badRequest("rows", "Each row needs its own letter, like A or B.");
            if (!ids.contains(r.classId())) throw ApiException.badRequest("rows", "Row " + r.label() + " has an unknown seat class.");
            if (r.seats() == null || r.seats().isEmpty() || r.seats().size() > 60) throw ApiException.badRequest("rows", "Row " + r.label() + " needs 1 to 60 places.");
            Set<Integer> nums = new HashSet<>();
            for (Integer n : r.seats()) {
                if (n == null) continue;
                if (n < 1 || n > 99 || !nums.add(n)) throw ApiException.badRequest("rows", "Row " + r.label() + " has a repeated or invalid seat number.");
                seats++;
            }
        }
        if (seats == 0 || seats > 1000) throw ApiException.badRequest("rows", "A screen has 1 to 1,000 seats.");
        return seats;
    }

    @Transactional
    public Screen saveScreen(StaffPrincipal who, UUID business, UUID id, ScreenInput in) {
        int seats = validate(in);
        boolean create = id == null;
        UUID sid = create ? UUID.randomUUID() : id;
        if (!create) {
            boolean exists = jdbc.sql("select count(*) from cinema_screens where id = :id and business_id = :b").param("id", sid).param("b", business).query(Integer.class).single() > 0;
            if (!exists) throw ApiException.notFound("Screen not found.");
            int sold = jdbc.sql("select count(*) from movie_tickets t join movie_shows s on s.id = t.show_id where s.screen_id = :id and s.starts_at > now() and t.status <> 'cancelled'")
                    .param("id", sid).query(Integer.class).single();
            boolean layoutChanged = !movies.rows(jdbc.sql("select rows::text from cinema_screens where id = :id").param("id", sid).query(String.class).single()).equals(in.rows());
            if (sold > 0 && layoutChanged) throw ApiException.conflict("seats_sold", "Seats are sold for upcoming shows on this screen, so its layout can’t change. Prices and the name can.");
        }
        try {
            String sql = create
                    ? "insert into cinema_screens (id, business_id, name, classes, rows, seat_count, active) values (:id, :b, :n, cast(:c as jsonb), cast(:r as jsonb), :sc, :a)"
                    : "update cinema_screens set name = :n, classes = cast(:c as jsonb), rows = cast(:r as jsonb), seat_count = :sc, active = :a where id = :id and business_id = :b";
            jdbc.sql(sql).param("id", sid).param("b", business).param("n", in.name().trim()).param("c", movies.toJson(in.classes())).param("r", movies.toJson(in.rows()))
                    .param("sc", seats).param("a", in.active() == null || in.active()).update();
        } catch (DuplicateKeyException e) {
            throw ApiException.conflict("name_taken", "You already have a screen with that name.");
        }
        audit.record(who, create ? "screen_created" : "screen_updated", "cinema_screen", sid, in.name().trim() + " · " + seats + " seats");
        return screens(business).stream().filter(s -> s.id().equals(sid.toString())).findFirst().orElseThrow();
    }

    // ---------- shows (the cinema) ----------
    public record ShowInput(@NotBlank String movieId, @NotBlank String screenId, @NotNull OffsetDateTime startsAt, @NotBlank String language, String format) {}

    public record ShowAdminRow(String id, String movieId, String movieTitle, String screenId, String screenName, OffsetDateTime startsAt, OffsetDateTime endsAt, String language, String format,
                               String status, int capacity, int sold, int checkedIn, long revenue) {}

    public List<ShowAdminRow> shows(UUID business, LocalDate from, int days) {
        LocalDate d = from == null ? movies.today() : from;
        OffsetDateTime f = d.atStartOfDay(Movies.IST).toOffsetDateTime(), t = d.plusDays(Math.max(1, Math.min(days, 31))).atStartOfDay(Movies.IST).toOffsetDateTime();
        return jdbc.sql("select s.id, s.movie_id, m.title, s.screen_id, sc.name, s.starts_at, m.duration_min, s.language, s.format, s.status, sc.seat_count, "
                        + "(select count(*) from movie_tickets x where x.show_id = s.id and x.status <> 'cancelled') sold, "
                        + "(select count(*) from movie_tickets x where x.show_id = s.id and x.status = 'checked_in') checked, "
                        + "(select coalesce(sum(x.price), 0) from movie_tickets x where x.show_id = s.id and x.status <> 'cancelled') revenue "
                        + "from movie_shows s join movies m on m.id = s.movie_id join cinema_screens sc on sc.id = s.screen_id "
                        + "where s.business_id = :b and s.starts_at >= :f and s.starts_at < :t order by s.starts_at, sc.name")
                .param("b", business).param("f", f).param("t", t)
                .query((rs, i) -> {
                    OffsetDateTime starts = rs.getObject("starts_at", OffsetDateTime.class);
                    return new ShowAdminRow(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5), starts, starts.plusMinutes(rs.getInt("duration_min")),
                            rs.getString("language"), rs.getString("format"), rs.getString("status"), rs.getInt("seat_count"), rs.getInt("sold"), rs.getInt("checked"), rs.getLong("revenue"));
                }).list();
    }

    @Transactional
    public ShowAdminRow addShow(StaffPrincipal who, UUID business, ShowInput in) {
        UUID movieId = Movies.uuid(in.movieId()), screenId = Movies.uuid(in.screenId());
        record F(int duration, List<String> languages, List<String> formats, boolean archived, String title) {}
        F film = jdbc.sql("select duration_min, languages, formats, archived, title from movies where id = :id").param("id", movieId)
                .query((rs, i) -> new F(rs.getInt(1), List.of((String[]) rs.getArray(2).getArray()), List.of((String[]) rs.getArray(3).getArray()), rs.getBoolean(4), rs.getString(5))).optional()
                .filter(x -> !x.archived()).orElseThrow(() -> ApiException.badRequest("movie", "Choose a film from VIBE’s list."));
        record S(String classes, boolean active, String name) {}
        S screen = jdbc.sql("select classes::text, active, name from cinema_screens where id = :id and business_id = :b for update").param("id", screenId).param("b", business)
                .query((rs, i) -> new S(rs.getString(1), rs.getBoolean(2), rs.getString(3))).optional()
                .filter(S::active).orElseThrow(() -> ApiException.badRequest("screen", "Choose one of your active screens."));
        if (!film.languages().contains(in.language())) throw ApiException.badRequest("language", film.title() + " is listed in " + String.join(", ", film.languages()) + ".");
        String format = in.format() == null || in.format().isBlank() ? film.formats().getFirst() : in.format();
        if (!film.formats().contains(format)) throw ApiException.badRequest("format", film.title() + " is listed in " + String.join(", ", film.formats()) + ".");
        if (!in.startsAt().isAfter(movies.now().plusMinutes(30))) throw ApiException.badRequest("starts_at", "Schedule shows at least 30 minutes ahead.");
        if (in.startsAt().isAfter(movies.now().plusDays(60))) throw ApiException.badRequest("starts_at", "Schedule shows up to 60 days ahead.");
        OffsetDateTime start = in.startsAt(), end = start.plusMinutes(film.duration() + Movies.TURNAROUND_MIN);
        List<String> clash = new ArrayList<>(jdbc.sql("select m.title || ' at ' || to_char(s.starts_at at time zone 'Asia/Kolkata', 'HH12:MI AM') from movie_shows s join movies m on m.id = s.movie_id "
                        + "where s.screen_id = :sc and s.status = 'scheduled' and s.starts_at < :end and s.starts_at + make_interval(mins => m.duration_min + :turn) > :start")
                .param("sc", screenId).param("end", end).param("start", start).param("turn", Movies.TURNAROUND_MIN).query(String.class).list());
        if (!clash.isEmpty()) throw ApiException.conflict("screen_busy", screen.name() + " is busy then: " + String.join(", ", clash) + ". Leave " + Movies.TURNAROUND_MIN + " minutes between shows.");
        UUID id = UUID.randomUUID();
        jdbc.sql("insert into movie_shows (id, movie_id, screen_id, business_id, starts_at, language, format, classes) values (:id, :m, :sc, :b, :st, :l, :f, cast(:c as jsonb))")
                .param("id", id).param("m", movieId).param("sc", screenId).param("b", business).param("st", start).param("l", in.language()).param("f", format).param("c", screen.classes()).update();
        audit.record(who, "show_scheduled", "movie_show", id, film.title() + " · " + screen.name());
        return shows(business, start.atZoneSameInstant(Movies.IST).toLocalDate(), 1).stream().filter(s -> s.id().equals(id.toString())).findFirst().orElseThrow();
    }

    /** A show with no seats sold can be cancelled by the cinema. Once seats are sold, VIBE support cancels it so every buyer is refunded. */
    @Transactional
    public void cancelShow(StaffPrincipal who, UUID business, UUID id) {
        int sold = jdbc.sql("select count(*) from movie_tickets t join movie_shows s on s.id = t.show_id where s.id = :id and s.business_id = :b and t.status <> 'cancelled'")
                .param("id", id).param("b", business).query(Integer.class).single();
        if (sold > 0) throw ApiException.conflict("seats_sold", sold + " seat" + (sold == 1 ? " is" : "s are") + " sold for this show. Ask VIBE support to cancel it, so every buyer is refunded.");
        int n = jdbc.sql("update movie_shows set status = 'cancelled' where id = :id and business_id = :b and status = 'scheduled'").param("id", id).param("b", business).update();
        if (n == 0) throw ApiException.notFound("Show not found.");
        jdbc.sql("update payment_requests set status = 'void' where id in (select payment_request_id from movie_bookings where show_id = :id and status = 'held') "
                + "and not exists (select 1 from payments p where p.payment_request_id = payment_requests.id and p.status in ('pending', 'verified'))").param("id", id).update();
        jdbc.sql("update movie_bookings set status = 'released' where show_id = :id and status = 'held'").param("id", id).update();
        audit.record(who, "show_cancelled", "movie_show", id, "");
    }
}
