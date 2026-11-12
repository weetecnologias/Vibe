package in.vibe.backend.events;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Films and showtimes arrive with the movies module (cinema setup, seat maps, holds). Until then the list is honestly empty, so the app shows
 * "nothing showing yet" and its list of cinemas, instead of an error. Seat booking is not available.
 */
@RestController
class MoviesApi {
    @GetMapping("/v1/movies")
    List<Object> films(@RequestParam(required = false) String status, @RequestParam(required = false) String language) { return List.of(); }
}
