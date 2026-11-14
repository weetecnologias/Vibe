package in.vibe.backend.movies;

import in.vibe.backend.customer.CustomerPrincipal;
import in.vibe.backend.security.StaffPrincipal;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;

/** Movies: what the app browses (public), seat holds (customers), the cinema's screens, shows and door, and VIBE's film catalogue. */
public class MovieControllers {

    @RestController
    static class PublicMoviesApi {
        private final Movies movies;

        PublicMoviesApi(Movies movies) { this.movies = movies; }

        @GetMapping("/v1/movies")
        List<Movies.MovieSummary> films(@RequestParam(required = false) String status, @RequestParam(required = false) String language) { return movies.films(status, language); }

        @GetMapping("/v1/movies/{id}")
        Movies.MovieDetail film(@PathVariable String id) { return movies.film(Movies.uuid(id)); }

        @GetMapping("/v1/movies/{id}/showtimes")
        List<Movies.CinemaShows> filmShowtimes(@PathVariable String id, @RequestParam(required = false) LocalDate date) { return movies.filmShowtimes(Movies.uuid(id), date); }

        @GetMapping("/v1/cinemas/{id}/showtimes")
        List<Movies.MovieShows> cinemaShowtimes(@PathVariable String id, @RequestParam(required = false) LocalDate date) { return movies.cinemaShowtimes(Movies.uuid(id), date); }

        @GetMapping("/v1/shows/{id}/seats")
        Movies.SeatMap seats(@PathVariable String id) { return movies.seatMap(Movies.uuid(id)); }

        @PostMapping("/v1/shows/{id}/holds")
        ResponseEntity<Movies.SeatHold> hold(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @Valid @RequestBody Movies.HoldInput in) {
            return ResponseEntity.status(HttpStatus.CREATED).body(movies.hold(CustomerPrincipal.from(jwt).id(), Movies.uuid(id), in));
        }
    }

    /** The cinema's side. Needs the events feature, which cinemas have. */
    @RestController
    static class CinemaApi {
        private final Movies movies;
        private final MovieSetup setup;

        CinemaApi(Movies movies, MovieSetup setup) {
            this.movies = movies;
            this.setup = setup;
        }

        @GetMapping("/v1/merchant/cinema/films")
        List<Movies.MovieSummary> films() { return movies.films(null, null); }

        @GetMapping("/v1/merchant/cinema/screens")
        List<MovieSetup.Screen> screens(@AuthenticationPrincipal Jwt jwt) { return setup.screens(StaffPrincipal.from(jwt).requireBusiness()); }

        @PostMapping("/v1/merchant/cinema/screens")
        ResponseEntity<MovieSetup.Screen> addScreen(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody MovieSetup.ScreenInput in) {
            StaffPrincipal who = StaffPrincipal.from(jwt);
            return ResponseEntity.status(HttpStatus.CREATED).body(setup.saveScreen(who, who.requireBusiness(), null, in));
        }

        @PutMapping("/v1/merchant/cinema/screens/{id}")
        MovieSetup.Screen saveScreen(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @Valid @RequestBody MovieSetup.ScreenInput in) {
            StaffPrincipal who = StaffPrincipal.from(jwt);
            return setup.saveScreen(who, who.requireBusiness(), Movies.uuid(id), in);
        }

        @GetMapping("/v1/merchant/cinema/shows")
        List<MovieSetup.ShowAdminRow> shows(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) LocalDate from, @RequestParam(defaultValue = "7") int days) {
            return setup.shows(StaffPrincipal.from(jwt).requireBusiness(), from, days);
        }

        @PostMapping("/v1/merchant/cinema/shows")
        ResponseEntity<MovieSetup.ShowAdminRow> addShow(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody MovieSetup.ShowInput in) {
            StaffPrincipal who = StaffPrincipal.from(jwt);
            return ResponseEntity.status(HttpStatus.CREATED).body(setup.addShow(who, who.requireBusiness(), in));
        }

        @PostMapping("/v1/merchant/cinema/shows/{id}/cancel")
        ResponseEntity<Void> cancelShow(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) {
            StaffPrincipal who = StaffPrincipal.from(jwt);
            setup.cancelShow(who, who.requireBusiness(), Movies.uuid(id));
            return ResponseEntity.noContent().build();
        }

        @PostMapping("/v1/merchant/cinema/check-in")
        Movies.CheckIn checkIn(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody Movies.CheckInInput in) {
            StaffPrincipal who = StaffPrincipal.from(jwt);
            return movies.checkIn(who, who.requireBusiness(), in.code());
        }
    }

    @RestController
    static class AdminFilmsApi {
        private final MovieSetup setup;

        AdminFilmsApi(MovieSetup setup) { this.setup = setup; }

        @GetMapping("/v1/admin/movies")
        List<MovieSetup.FilmRow> films() { return setup.adminFilms(); }

        @PostMapping("/v1/admin/movies")
        ResponseEntity<MovieSetup.FilmRow> add(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody MovieSetup.FilmInput in) {
            return ResponseEntity.status(HttpStatus.CREATED).body(setup.saveFilm(StaffPrincipal.from(jwt), null, in));
        }

        @PutMapping("/v1/admin/movies/{id}")
        MovieSetup.FilmRow save(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @Valid @RequestBody MovieSetup.FilmInput in) {
            return setup.saveFilm(StaffPrincipal.from(jwt), Movies.uuid(id), in);
        }
    }
}
