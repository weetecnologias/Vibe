package in.vibe.backend.slots;

import in.vibe.backend.customer.CustomerPrincipal;
import in.vibe.backend.security.StaffPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;

import static in.vibe.backend.slots.SlotBooking.parse;

/** Slot booking: the venue page and slot grid (public), booking (customer), and the venue's courts, day and front desk (merchant). */
public class SlotControllers {
    static LocalDate date(String raw) {
        if (raw == null || raw.isBlank()) return LocalDate.now(ZoneId.of("Asia/Kolkata"));
        try { return LocalDate.parse(raw); } catch (Exception e) { throw in.vibe.backend.common.ApiException.badRequest("date", "Use a date like 2026-11-13."); }
    }

    public record Code(@NotBlank String code) {}

    @RestController
    public static class PublicSlotsApi {
        private final SlotBooking slots;

        PublicSlotsApi(SlotBooking slots) { this.slots = slots; }

        @GetMapping("/v1/businesses/{id}/sports")
        List<SlotBooking.Sport> sports(@PathVariable String id) { return slots.sports(parse(id)); }

        @GetMapping("/v1/businesses/{id}/slots")
        SlotBooking.Slots grid(@PathVariable String id, @RequestParam String sport, @RequestParam(required = false) String date, @RequestParam(required = false) Integer minutes) {
            return slots.slots(parse(id), sport, date(date), minutes);
        }
    }

    @RestController
    public static class CustomerSlotsApi {
        private final SlotBooking slots;

        CustomerSlotsApi(SlotBooking slots) { this.slots = slots; }

        @PostMapping("/v1/slot-bookings")
        ResponseEntity<SlotBooking.Booking> book(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody SlotBooking.BookInput in) {
            return ResponseEntity.status(HttpStatus.CREATED).body(slots.reserve(CustomerPrincipal.from(jwt).id(), in));
        }

        @GetMapping("/v1/slot-bookings/{id}")
        SlotBooking.Booking one(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) { return slots.booking(CustomerPrincipal.from(jwt).id(), parse(id)); }

        @PostMapping("/v1/slot-bookings/{id}/release")
        ResponseEntity<Void> release(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) {
            slots.release(CustomerPrincipal.from(jwt).id(), parse(id));
            return ResponseEntity.noContent().build();
        }

        @GetMapping("/v1/me/slot-bookings")
        List<SlotBooking.Booking> mine(@AuthenticationPrincipal Jwt jwt) { return slots.mine(CustomerPrincipal.from(jwt).id()); }
    }

    @RestController
    public static class MerchantVenueApi {
        private final SlotBooking slots;

        MerchantVenueApi(SlotBooking slots) { this.slots = slots; }

        @GetMapping("/v1/merchant/venue/resources")
        List<SlotBooking.Resource> resources(@AuthenticationPrincipal Jwt jwt) { return slots.resources(StaffPrincipal.from(jwt).requireBusiness(), false); }

        @PostMapping("/v1/merchant/venue/resources")
        ResponseEntity<SlotBooking.Resource> add(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody SlotBooking.ResourceInput in) {
            return ResponseEntity.status(HttpStatus.CREATED).body(slots.addResource(StaffPrincipal.from(jwt), in));
        }

        @PutMapping("/v1/merchant/venue/resources/{id}")
        SlotBooking.Resource update(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @Valid @RequestBody SlotBooking.ResourceInput in) {
            return slots.updateResource(StaffPrincipal.from(jwt), parse(id), in);
        }

        @DeleteMapping("/v1/merchant/venue/resources/{id}")
        ResponseEntity<Void> delete(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) {
            slots.deleteResource(StaffPrincipal.from(jwt), parse(id));
            return ResponseEntity.noContent().build();
        }

        @GetMapping("/v1/merchant/venue/day")
        SlotBooking.Day day(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) String date) { return slots.day(StaffPrincipal.from(jwt).requireBusiness(), date(date)); }

        @PostMapping("/v1/merchant/venue/blocks")
        ResponseEntity<SlotBooking.Block> block(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody SlotBooking.BlockInput in) {
            return ResponseEntity.status(HttpStatus.CREATED).body(slots.block(StaffPrincipal.from(jwt), in));
        }

        @DeleteMapping("/v1/merchant/venue/blocks/{id}")
        ResponseEntity<Void> unblock(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) {
            slots.unblock(StaffPrincipal.from(jwt), parse(id));
            return ResponseEntity.noContent().build();
        }

        @PostMapping("/v1/merchant/venue/check-in")
        SlotBooking.CheckIn checkIn(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody Code in) { return slots.checkIn(StaffPrincipal.from(jwt), in.code()); }
    }

    @RestController
    public static class PassesApi {
        private final VenuePasses passes;

        PassesApi(VenuePasses passes) { this.passes = passes; }

        /** The monthly plans a gym, studio or trainer sells. */
        @GetMapping("/v1/businesses/{id}/plans")
        List<VenuePasses.Plan> plans(@PathVariable String id) { return passes.plans(parse(id), true); }

        @PostMapping("/v1/venue-passes")
        ResponseEntity<VenuePasses.Pass> buy(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody VenuePasses.BuyInput in) {
            return ResponseEntity.status(HttpStatus.CREATED).body(passes.buy(CustomerPrincipal.from(jwt).id(), in));
        }

        @GetMapping("/v1/venue-passes/{id}")
        VenuePasses.Pass one(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) { return passes.pass(CustomerPrincipal.from(jwt).id(), parse(id)); }

        @GetMapping("/v1/me/venue-passes")
        List<VenuePasses.Pass> mine(@AuthenticationPrincipal Jwt jwt) { return passes.mine(CustomerPrincipal.from(jwt).id()); }

        @GetMapping("/v1/merchant/venue/plans")
        List<VenuePasses.Plan> myPlans(@AuthenticationPrincipal Jwt jwt) { return passes.plans(StaffPrincipal.from(jwt).requireBusiness(), false); }

        @PostMapping("/v1/merchant/venue/plans")
        ResponseEntity<VenuePasses.Plan> addPlan(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody VenuePasses.PlanInput in) {
            return ResponseEntity.status(HttpStatus.CREATED).body(passes.addPlan(StaffPrincipal.from(jwt), in));
        }

        @PutMapping("/v1/merchant/venue/plans/{id}")
        VenuePasses.Plan updatePlan(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @Valid @RequestBody VenuePasses.PlanInput in) {
            return passes.updatePlan(StaffPrincipal.from(jwt), parse(id), in);
        }

        @DeleteMapping("/v1/merchant/venue/plans/{id}")
        ResponseEntity<Void> deletePlan(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) {
            passes.deletePlan(StaffPrincipal.from(jwt), parse(id));
            return ResponseEntity.noContent().build();
        }

        @GetMapping("/v1/merchant/venue/members")
        List<VenuePasses.Member> members(@AuthenticationPrincipal Jwt jwt) { return passes.members(StaffPrincipal.from(jwt).requireBusiness()); }
    }
}
