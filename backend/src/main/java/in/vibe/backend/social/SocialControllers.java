package in.vibe.backend.social;

import in.vibe.backend.common.ApiException;
import in.vibe.backend.customer.CustomerPrincipal;
import in.vibe.backend.security.AdminAccess;
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
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Social: the customer app (profile, guidelines, hosting, one-on-ones, chat, reports), the venue's meetup reservations, and VIBE's monitor. */
public class SocialControllers {
    private static UUID me(Jwt jwt) { return CustomerPrincipal.from(jwt).id(); }

    @RestController
    static class CustomerSocialApi {
        private final SocialMembers members;
        private final Meetups meetups;

        CustomerSocialApi(SocialMembers members, Meetups meetups) {
            this.members = members;
            this.meetups = meetups;
        }

        @GetMapping("/v1/social/guidelines")
        SocialMembers.Guidelines guidelines() { return members.guidelines(); }

        @GetMapping("/v1/social/profile")
        ResponseEntity<SocialMembers.Profile> profile(@AuthenticationPrincipal Jwt jwt) {
            return members.profile(me(jwt)).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.notFound().build());
        }

        @PutMapping("/v1/social/profile")
        SocialMembers.Profile saveProfile(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody SocialMembers.ProfileInput in) { return members.saveProfile(me(jwt), in); }

        @GetMapping("/v1/social/host")
        ResponseEntity<SocialMembers.HostApplication> host(@AuthenticationPrincipal Jwt jwt) {
            return members.host(me(jwt)).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.notFound().build());
        }

        @PostMapping("/v1/social/host")
        SocialMembers.HostApplication applyToHost(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody SocialMembers.HostInput in) { return members.applyToHost(me(jwt), in); }

        /** Hosted activities and communities come next; until then the feed is honestly empty. */
        @GetMapping("/v1/social/feed")
        Map<String, List<Object>> feed() { return Map.of("activities", List.of(), "groups", List.of()); }

        @GetMapping("/v1/social/venues")
        List<Meetups.Venue> venues(@AuthenticationPrincipal Jwt jwt, @RequestParam String kind) { return meetups.venues(me(jwt), kind); }

        @GetMapping("/v1/social/one-on-ones")
        List<Meetups.Invite> list(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) String when, @RequestParam(defaultValue = "false") boolean nearMe) {
            return meetups.list(me(jwt), when, nearMe);
        }

        @PostMapping("/v1/social/one-on-ones")
        ResponseEntity<Meetups.Invite> create(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody Meetups.Input in) {
            return ResponseEntity.status(HttpStatus.CREATED).body(meetups.create(me(jwt), in));
        }

        @GetMapping("/v1/social/one-on-ones/{id}")
        Meetups.Invite one(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) { return meetups.invite(me(jwt), Meetups.uuid(id)); }

        @PostMapping("/v1/social/one-on-ones/{id}/reservation")
        Map<String, String> reservation(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) { return Map.of("paymentRequestId", meetups.reservationPayment(me(jwt), Meetups.uuid(id))); }

        @PostMapping("/v1/social/one-on-ones/{id}/requests")
        Meetups.Invite request(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) { return meetups.request(me(jwt), Meetups.uuid(id)); }

        record Respond(boolean accept) {}

        @PostMapping("/v1/social/one-on-ones/{id}/requests/{memberId}/respond")
        Meetups.Invite respond(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @PathVariable String memberId, @RequestBody Respond in) {
            return meetups.respond(me(jwt), Meetups.uuid(id), memberId, in.accept());
        }

        @PostMapping("/v1/social/one-on-ones/{id}/cancel")
        ResponseEntity<Void> cancel(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) {
            meetups.cancel(me(jwt), Meetups.uuid(id));
            return ResponseEntity.noContent().build();
        }

        @GetMapping("/v1/social/one-on-ones/{id}/chat")
        Meetups.Chat chat(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) { return meetups.chat(me(jwt), Meetups.uuid(id)); }

        @PostMapping("/v1/social/one-on-ones/{id}/chat/messages")
        Meetups.SendResult send(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @Valid @RequestBody Meetups.SendInput in) { return meetups.send(me(jwt), Meetups.uuid(id), in); }

        @PostMapping("/v1/reports")
        ResponseEntity<Map<String, String>> report(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody SocialMembers.ReportInput in) {
            return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("reportId", members.report(me(jwt), in)));
        }

        record Block(String userId) {}

        @PostMapping("/v1/blocks")
        ResponseEntity<Void> block(@AuthenticationPrincipal Jwt jwt, @RequestBody Block in) {
            if (in.userId() == null || in.userId().isBlank()) throw ApiException.badRequest("user", "Choose who to block.");
            members.block(me(jwt), in.userId());
            return ResponseEntity.noContent().build();
        }
    }

    /** The venue's side: meetup reservations for a day, and marking guests arrived or a no-show. Needs the reservations feature. */
    @RestController
    static class MerchantReservationsApi {
        private final Meetups meetups;

        MerchantReservationsApi(Meetups meetups) { this.meetups = meetups; }

        @GetMapping("/v1/merchant/reservations")
        List<Meetups.VenueReservation> day(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) LocalDate day) {
            return meetups.forVenue(StaffPrincipal.from(jwt).requireBusiness(), day == null ? LocalDate.now(ZoneId.of("Asia/Kolkata")) : day);
        }

        @PostMapping("/v1/merchant/reservations/{reference}/arrived")
        Meetups.VenueReservation arrived(@AuthenticationPrincipal Jwt jwt, @PathVariable String reference) { return meetups.mark(StaffPrincipal.from(jwt).requireBusiness(), reference, "arrived"); }

        @PostMapping("/v1/merchant/reservations/{reference}/no-show")
        Meetups.VenueReservation noShow(@AuthenticationPrincipal Jwt jwt, @PathVariable String reference) { return meetups.mark(StaffPrincipal.from(jwt).requireBusiness(), reference, "no_show"); }
    }

    /** VIBE's monitor. Social is VIBE-wide, so category managers don't get it. */
    @RestController
    static class AdminSocialApi {
        private final SocialAdmin admin;
        private final SocialMembers members;
        private final AdminAccess access;

        AdminSocialApi(SocialAdmin admin, SocialMembers members, AdminAccess access) {
            this.admin = admin;
            this.members = members;
            this.access = access;
        }

        private StaffPrincipal who(Jwt jwt) {
            StaffPrincipal w = StaffPrincipal.from(jwt);
            if (access.access(w).scoped()) throw ApiException.forbidden("Social covers all of VIBE, so it isn’t limited to categories. Ask an admin for access.");
            return w;
        }

        @GetMapping("/v1/admin/social/overview")
        SocialAdmin.Overview overview(@AuthenticationPrincipal Jwt jwt) { who(jwt); return admin.overview(); }

        @GetMapping("/v1/admin/social/meetups")
        SocialAdmin.MeetupPage meetups(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) String status, @RequestParam(required = false) String q,
                                       @RequestParam(defaultValue = "50") int limit, @RequestParam(defaultValue = "0") int offset) {
            who(jwt);
            return admin.meetups(status, q, limit, offset);
        }

        @GetMapping("/v1/admin/social/meetups.csv")
        ResponseEntity<byte[]> meetupsCsv(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) String status, @RequestParam(required = false) String q) { who(jwt); return admin.meetupsCsv(status, q); }

        @GetMapping("/v1/admin/social/meetups/{id}")
        SocialAdmin.MeetupDetail meetup(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) { return admin.meetup(who(jwt), Meetups.uuid(id)); }

        @GetMapping("/v1/admin/social/reports")
        List<SocialAdmin.ReportRow> reports(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) String status) { who(jwt); return admin.reports(status); }

        record Resolve(String action, String note, String suspendCustomerId) {}

        @PostMapping("/v1/admin/social/reports/{id}/resolve")
        SocialAdmin.ReportRow resolve(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @RequestBody Resolve in) {
            return admin.resolveReport(who(jwt), Meetups.uuid(id), in.action(), in.note(), in.suspendCustomerId());
        }

        @GetMapping("/v1/admin/social/hosts")
        List<SocialAdmin.HostRow> hosts(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) String status) { who(jwt); return admin.hosts(status); }

        record Decide(String decision, String note) {}

        @PostMapping("/v1/admin/social/hosts/{customerId}/decide")
        ResponseEntity<Void> decide(@AuthenticationPrincipal Jwt jwt, @PathVariable String customerId, @RequestBody Decide in) {
            members.decideHost(who(jwt), Meetups.uuid(customerId), in.decision(), in.note());
            return ResponseEntity.noContent().build();
        }

        @GetMapping("/v1/admin/social/members")
        List<SocialAdmin.MemberRow> members(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) String q, @RequestParam(required = false) String status) {
            who(jwt);
            return admin.members(q, status);
        }

        record Suspend(boolean suspend, String reason) {}

        @PostMapping("/v1/admin/social/members/{customerId}/suspension")
        ResponseEntity<Void> suspend(@AuthenticationPrincipal Jwt jwt, @PathVariable String customerId, @RequestBody Suspend in) {
            members.setSuspended(who(jwt), Meetups.uuid(customerId), in.suspend(), in.reason());
            return ResponseEntity.noContent().build();
        }
    }
}
