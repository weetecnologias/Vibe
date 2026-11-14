package in.vibe.backend;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.List;

import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Movies end to end: VIBE lists a film, a cinema sets up a screen and schedules a show, a customer picks seats, pays, gets QR tickets, and the cinema checks them in. */
class MoviesTest extends ApiTestSupport {
    private static final String SCREEN = "{\"name\":\"Audi 1\",\"classes\":[{\"id\":\"prime\",\"name\":\"Prime\",\"price\":30000},{\"id\":\"classic\",\"name\":\"Classic\",\"price\":20000}],"
            + "\"rows\":[{\"label\":\"A\",\"classId\":\"classic\",\"seats\":[1,2,null,3,4]},{\"label\":\"B\",\"classId\":\"prime\",\"seats\":[1,2,null,3,4]}]}";

    private String film(String admin, String title) throws Exception {
        return JsonPath.read(mvc.perform(as(admin, post("/v1/admin/movies")).content("{\"title\":\"" + title + "\",\"certificate\":\"UA\",\"durationMin\":120,\"genres\":[\"Drama\"],\"languages\":[\"Telugu\",\"Hindi\"],"
                + "\"formats\":[\"2D\"],\"releaseDate\":\"" + LocalDate.now().minusDays(3) + "\",\"synopsis\":\"A test film.\",\"director\":\"Someone\",\"cast\":[\"Lead\"]}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.film.id");
    }

    @Test
    void aCustomerPicksSeatsPaysAndTheCinemaChecksTheTicketsIn() throws Exception {
        String admin = adminToken();
        String title = "Test Film " + uniq();
        String movie = film(admin, title);
        mvc.perform(get("/v1/movies")).andExpect(jsonPath("$[?(@.id=='" + movie + "')].status", hasItem("now_showing")));
        mvc.perform(get("/v1/movies/" + movie)).andExpect(jsonPath("$.title", is(title))).andExpect(jsonPath("$.cast[0]", is("Lead")));

        // A cinema: a screen with two classes, then a show tomorrow evening.
        String movies = jdbc.sql("select id::text from categories where slug = 'movies'").query(String.class).single();
        String cinema = business(category(movies, "Test cinemas " + uniq()), "Test Cinema " + uniq()), m = merchant(cinema);
        String screen = id(mvc.perform(as(m, post("/v1/merchant/cinema/screens")).content(SCREEN)).andExpect(status().isCreated()).andExpect(jsonPath("$.seatCount", is(8))).andReturn());
        OffsetDateTime at = LocalDate.now(ZoneId.of("Asia/Kolkata")).plusDays(1).atTime(19, 0).atZone(ZoneId.of("Asia/Kolkata")).toOffsetDateTime();
        String show = id(mvc.perform(as(m, post("/v1/merchant/cinema/shows")).content("{\"movieId\":\"" + movie + "\",\"screenId\":\"" + screen + "\",\"startsAt\":\"" + at + "\",\"language\":\"Telugu\"}"))
                .andExpect(status().isCreated()).andReturn());
        // The screen is busy until the film and turnaround end.
        mvc.perform(as(m, post("/v1/merchant/cinema/shows")).content("{\"movieId\":\"" + movie + "\",\"screenId\":\"" + screen + "\",\"startsAt\":\"" + at.plusMinutes(90) + "\",\"language\":\"Hindi\"}"))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("screen_busy")));
        mvc.perform(as(m, post("/v1/merchant/cinema/shows")).content("{\"movieId\":\"" + movie + "\",\"screenId\":\"" + screen + "\",\"startsAt\":\"" + at.plusHours(4) + "\",\"language\":\"Tamil\"}"))
                .andExpect(status().isBadRequest());

        // What the app shows: the cinema under the film, the film under the cinema, and the seat map.
        String day = at.atZoneSameInstant(ZoneId.of("Asia/Kolkata")).toLocalDate().toString();
        mvc.perform(get("/v1/movies/" + movie + "/showtimes").param("date", day)).andExpect(jsonPath("$[0].cinema.id", is(cinema))).andExpect(jsonPath("$[0].shows[0].priceFrom", is(20000)));
        mvc.perform(get("/v1/cinemas/" + cinema + "/showtimes").param("date", day)).andExpect(jsonPath("$[0].movie.id", is(movie))).andExpect(jsonPath("$[0].shows[0].id", is(show)));
        mvc.perform(get("/v1/shows/" + show + "/seats")).andExpect(jsonPath("$.rows", hasSize(2))).andExpect(jsonPath("$.rows[0].seats[2]").doesNotExist())
                .andExpect(jsonPath("$.rows[1].seats[0].id", is("B1"))).andExpect(jsonPath("$.show.cinemaId", is(cinema))).andExpect(jsonPath("$.maxSeats", is(10)));

        // Holding needs sign-in; two Prime seats are ₹600 and held while paying.
        mvc.perform(post("/v1/shows/" + show + "/holds").contentType("application/json").content("{\"seatIds\":[\"B1\"]}")).andExpect(status().isUnauthorized());
        String c = customerToken(phone()), other = customerToken(phone());
        String hold = mvc.perform(as(c, post("/v1/shows/" + show + "/holds")).content("{\"seatIds\":[\"B1\",\"B2\"]}")).andExpect(status().isCreated())
                .andExpect(jsonPath("$.total", is(60000))).andExpect(jsonPath("$.seats[0].className", is("Prime"))).andReturn().getResponse().getContentAsString();
        mvc.perform(as(other, post("/v1/shows/" + show + "/holds")).content("{\"seatIds\":[\"B2\"]}")).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("seat_taken")));
        mvc.perform(as(other, post("/v1/shows/" + show + "/holds")).content("{\"seatIds\":[\"Z9\"]}")).andExpect(status().isBadRequest());
        mvc.perform(get("/v1/shows/" + show + "/seats")).andExpect(jsonPath("$.rows[1].seats[0].status", is("unavailable")));

        // Paid: one QR ticket per seat, shown with the customer's other tickets.
        String pr = JsonPath.read(hold, "$.paymentRequestId");
        String ref = JsonPath.read(mvc.perform(as(c, post("/v1/payment-requests/" + pr + "/payments")).header("Idempotency-Key", "mv-" + uniq() + uniq()).content("{\"method\":\"upi\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.reference");
        String paid = mvc.perform(as(c, get("/v1/payments/" + ref))).andExpect(jsonPath("$.status", is("verified"))).andExpect(jsonPath("$.kind", is("movie")))
                .andExpect(jsonPath("$.ticketIds", hasSize(2))).andReturn().getResponse().getContentAsString();
        String ticket = ((List<String>) JsonPath.read(paid, "$.ticketIds")).getFirst();
        mvc.perform(as(c, get("/v1/tickets/" + ticket))).andExpect(jsonPath("$.eventTitle", is(title))).andExpect(jsonPath("$.seatLabel", is("B1"))).andExpect(jsonPath("$.eventKind", is("Movies")));
        mvc.perform(as(c, get("/v1/me/tickets"))).andExpect(jsonPath("$[?(@.id=='" + ticket + "')].seatLabel", hasItem("B1")));
        mvc.perform(as(other, get("/v1/tickets/" + ticket))).andExpect(status().isNotFound());

        // The cinema: sold seats show on its list, the show can't be cancelled by the cinema, and the door lets each ticket in once (from an hour before).
        mvc.perform(as(m, get("/v1/merchant/cinema/shows").param("from", day))).andExpect(jsonPath("$[0].sold", is(2))).andExpect(jsonPath("$[0].revenue", is(60000)));
        mvc.perform(as(m, post("/v1/merchant/cinema/shows/" + show + "/cancel"))).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("seats_sold")));
        String code = jdbc.sql("select admission_code from movie_tickets where id = :id::uuid").param("id", ticket).query(String.class).single();
        mvc.perform(as(m, post("/v1/merchant/cinema/check-in")).content("{\"code\":\"" + code + "\"}")).andExpect(jsonPath("$.result", is("too_early")));
        jdbc.sql("update movie_shows set starts_at = now() + interval '30 minutes' where id = :id::uuid").param("id", show).update();
        mvc.perform(as(m, post("/v1/merchant/cinema/check-in")).content("{\"code\":\"" + code.replace("-", "").toLowerCase() + "\"}")).andExpect(jsonPath("$.result", is("admitted")));
        mvc.perform(as(m, post("/v1/merchant/cinema/check-in")).content("{\"code\":\"" + code + "\"}")).andExpect(jsonPath("$.result", is("already")));

        // The layout of a screen with sold seats can't change; its prices and name can.
        mvc.perform(as(m, put("/v1/merchant/cinema/screens/" + screen)).content(SCREEN.replace("[1,2,null,3,4]}]", "[1,2,3,4,5]}]"))).andExpect(status().isConflict());
        mvc.perform(as(m, put("/v1/merchant/cinema/screens/" + screen)).content(SCREEN.replace("Audi 1", "Audi One"))).andExpect(status().isOk()).andExpect(jsonPath("$.name", is("Audi One")));

        // An unsold show can be cancelled; it then disappears from the app.
        String later = id(mvc.perform(as(m, post("/v1/merchant/cinema/shows")).content("{\"movieId\":\"" + movie + "\",\"screenId\":\"" + screen + "\",\"startsAt\":\"" + at.plusHours(5) + "\",\"language\":\"Hindi\"}"))
                .andExpect(status().isCreated()).andReturn());
        mvc.perform(as(m, post("/v1/merchant/cinema/shows/" + later + "/cancel"))).andExpect(status().isNoContent());
        mvc.perform(get("/v1/cinemas/" + cinema + "/showtimes").param("date", day)).andExpect(jsonPath("$[0].shows[?(@.id=='" + later + "')]", hasSize(0)));

        // Archived films vanish from the app.
        mvc.perform(as(admin, put("/v1/admin/movies/" + movie)).content("{\"title\":\"" + title + "\",\"certificate\":\"UA\",\"durationMin\":120,\"languages\":[\"Telugu\"],\"releaseDate\":\"" + LocalDate.now() + "\",\"archived\":true}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.archived", is(true)));
        mvc.perform(get("/v1/movies/" + movie)).andExpect(status().isNotFound());
        assertEquals(1, jdbc.sql("select count(*) from audit_log where action = 'check_in' and entity = 'movie_ticket' and entity_id = :id").param("id", ticket).query(Integer.class).single());
    }
}
