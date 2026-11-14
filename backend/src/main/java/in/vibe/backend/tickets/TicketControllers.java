package in.vibe.backend.tickets;

import in.vibe.backend.billing.Payments;
import in.vibe.backend.common.ApiException;
import in.vibe.backend.customer.CustomerPrincipal;
import in.vibe.backend.security.StaffPrincipal;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/** Ticket sales: the customer app, the organiser's dashboard (merchant or VIBE), and the door. Thin on purpose: the rules live in the services. */
public class TicketControllers {
    static UUID uuid(String s) {
        try { return UUID.fromString(s); } catch (IllegalArgumentException e) { throw ApiException.notFound("Not found."); }
    }

    @RestController
    public static class CustomerTicketsApi {
        private final Ticketing ticketing;
        private final CheckoutOffers offers;
        private final in.vibe.backend.movies.Movies movies;

        CustomerTicketsApi(Ticketing ticketing, CheckoutOffers offers, in.vibe.backend.movies.Movies movies) {
            this.movies = movies;
            this.ticketing = ticketing;
            this.offers = offers;
        }

        @PostMapping("/v1/events/{id}/reservations")
        ResponseEntity<Ticketing.Reservation> reserve(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @Valid @RequestBody Ticketing.ReserveInput in) {
            return ResponseEntity.status(HttpStatus.CREATED).body(ticketing.reserve(CustomerPrincipal.from(jwt).id(), uuid(id), in));
        }

        @GetMapping("/v1/me/tickets")
        List<Ticketing.Ticket> mine(@AuthenticationPrincipal Jwt jwt) {
            UUID me = CustomerPrincipal.from(jwt).id();
            List<Ticketing.Ticket> all = new java.util.ArrayList<>(ticketing.myTickets(me));
            all.addAll(movies.myTickets(me)); // movie seats show alongside event tickets
            all.sort(java.util.Comparator.comparing(Ticketing.Ticket::startsAt));
            return all;
        }

        @GetMapping("/v1/tickets/{id}")
        Ticketing.Ticket one(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) {
            UUID me = CustomerPrincipal.from(jwt).id();
            return movies.myTicket(me, uuid(id)).orElseGet(() -> ticketing.myTicket(me, uuid(id)));
        }

        @GetMapping("/v1/payment-requests/{id}/offers")
        CheckoutOffers.Offers checkoutOffers(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) { return offers.offers(CustomerPrincipal.from(jwt).id(), uuid(id)); }

        @PostMapping("/v1/payment-requests/{id}/offer")
        Payments.CheckoutRequest apply(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @Valid @RequestBody CheckoutOffers.ApplyInput in) {
            return offers.apply(CustomerPrincipal.from(jwt).id(), uuid(id), in.code());
        }

        @DeleteMapping("/v1/payment-requests/{id}/offer")
        Payments.CheckoutRequest remove(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) { return offers.remove(CustomerPrincipal.from(jwt).id(), uuid(id)); }
    }

    @RestController
    public static class OrganiserTicketsApi {
        private final Ticketing ticketing;

        OrganiserTicketsApi(Ticketing ticketing) { this.ticketing = ticketing; }

        @GetMapping("/v1/merchant/events/{id}/sales")
        Ticketing.Sales merchantSales(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) { return ticketing.sales(uuid(id), StaffPrincipal.from(jwt).requireBusiness()); }

        @PostMapping("/v1/merchant/events/{id}/check-in")
        Ticketing.CheckIn merchantCheckIn(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @Valid @RequestBody Ticketing.CheckInInput in) {
            StaffPrincipal who = StaffPrincipal.from(jwt);
            return ticketing.checkIn(who, uuid(id), who.requireBusiness(), in.code());
        }

        @GetMapping("/v1/admin/events/{id}/sales")
        Ticketing.Sales adminSales(@PathVariable String id) { return ticketing.sales(uuid(id), null); }

        @PostMapping("/v1/admin/events/{id}/check-in")
        Ticketing.CheckIn adminCheckIn(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @Valid @RequestBody Ticketing.CheckInInput in) {
            return ticketing.checkIn(StaffPrincipal.from(jwt), uuid(id), null, in.code());
        }
    }
}
