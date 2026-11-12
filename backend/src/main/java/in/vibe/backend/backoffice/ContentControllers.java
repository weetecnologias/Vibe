package in.vibe.backend.backoffice;

import in.vibe.backend.audit.AuditService;
import in.vibe.backend.catalogue.Businesses;
import in.vibe.backend.catalogue.OfferReview;
import in.vibe.backend.common.ApiException;
import in.vibe.backend.coupons.Coupons;
import in.vibe.backend.events.Events;
import in.vibe.backend.home.HomeContent;
import in.vibe.backend.media.MediaService;
import in.vibe.backend.membership.Plans;
import in.vibe.backend.security.StaffPrincipal;
import in.vibe.backend.venue.ReservationSettings;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.time.Duration;
import java.util.List;
import java.util.UUID;

/** Home content, plans, coupons, offer review, events, reservation settings, team and image upload. Thin on purpose: the rules live in the services. */
public class ContentControllers {

    static UUID uuid(String raw) { return Controllers.uuid(raw); }

    public record Note(String note) {}

    public record Picks(@NotNull List<String> ids) {}

    // ---------- public: what the customer app reads ----------
    @RestController
    public static class PublicContentApi {
        private final HomeContent home;
        private final Plans plans;
        private final Events events;
        private final Businesses businesses;

        PublicContentApi(HomeContent home, Plans plans, Events events, Businesses businesses) {
            this.home = home;
            this.plans = plans;
            this.events = events;
            this.businesses = businesses;
        }

        @GetMapping("/v1/home")
        HomeContent.Feed home() { return home.feed(); }

        @GetMapping("/v1/membership/plans")
        List<Plans.PublicPlan> plans() { return plans.publicList(); }

        @GetMapping("/v1/events")
        List<Events.PublicSummary> events(@RequestParam(required = false) String kind, @RequestParam(defaultValue = "50") int limit) { return events.publicList(kind, limit); }

        @GetMapping("/v1/events/{id}")
        Events.PublicDetail event(@PathVariable String id) { return events.publicDetail(uuid(id)); }

        @GetMapping("/v1/offers")
        List<Businesses.OfferView> offers(@RequestParam(required = false) String view, @RequestParam(defaultValue = "50") int limit) { return businesses.offers(view, home.pinned("offers"), limit); }
    }

    // ---------- images ----------
    @RestController
    public static class MediaApi {
        private final MediaService media;

        MediaApi(MediaService media) { this.media = media; }

        @PostMapping(path = "/v1/media", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
        ResponseEntity<MediaService.Stored> upload(@AuthenticationPrincipal Jwt jwt, @RequestParam("file") MultipartFile file) {
            return ResponseEntity.status(HttpStatus.CREATED).body(media.save(StaffPrincipal.from(jwt), file));
        }

        /** Served with the type we detected, never sniffed by the browser. */
        @GetMapping("/media/{filename}")
        ResponseEntity<byte[]> file(@PathVariable String filename) {
            MediaService.Loaded f = media.load(filename);
            return ResponseEntity.ok().contentType(MediaType.parseMediaType(f.contentType())).header("X-Content-Type-Options", "nosniff")
                    .cacheControl(CacheControl.maxAge(Duration.ofDays(1)).cachePublic()).body(f.bytes());
        }
    }

    // ---------- admin ----------
    @RestController
    @RequestMapping("/v1/admin")
    public static class AdminContentApi {
        private final HomeContent home;
        private final Plans plans;
        private final Coupons coupons;
        private final OfferReview offerReview;
        private final Events events;

        private final in.vibe.backend.security.AdminAccess adminAccess;

        AdminContentApi(HomeContent home, Plans plans, Coupons coupons, OfferReview offerReview, Events events, in.vibe.backend.security.AdminAccess adminAccess) {
            this.adminAccess = adminAccess;
            this.home = home;
            this.plans = plans;
            this.coupons = coupons;
            this.offerReview = offerReview;
            this.events = events;
        }

        // banners and pinned sections
        @GetMapping("/home/banners")
        List<HomeContent.BannerRow> banners() { return home.banners(); }

        @PostMapping("/home/banners")
        ResponseEntity<HomeContent.BannerRow> createBanner(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody HomeContent.BannerInput in) {
            return ResponseEntity.status(HttpStatus.CREATED).body(home.createBanner(StaffPrincipal.from(jwt), in));
        }

        @PutMapping("/home/banners/{id}")
        HomeContent.BannerRow updateBanner(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @Valid @RequestBody HomeContent.BannerInput in) {
            return home.updateBanner(StaffPrincipal.from(jwt), uuid(id), in);
        }

        @DeleteMapping("/home/banners/{id}")
        ResponseEntity<Void> deleteBanner(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) {
            home.deleteBanner(StaffPrincipal.from(jwt), uuid(id));
            return ResponseEntity.noContent().build();
        }

        @GetMapping("/home/picks/{section}")
        List<HomeContent.Pick> picks(@PathVariable String section) { return home.picks(section); }

        @PutMapping("/home/picks/{section}")
        List<HomeContent.Pick> setPicks(@AuthenticationPrincipal Jwt jwt, @PathVariable String section, @Valid @RequestBody Picks in) { return home.setPicks(StaffPrincipal.from(jwt), section, in.ids()); }

        // membership plans
        @GetMapping("/plans")
        List<Plans.Row> plans() { return plans.adminList(); }

        @PostMapping("/plans")
        ResponseEntity<Plans.Row> createPlan(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody Plans.Input in) { return ResponseEntity.status(HttpStatus.CREATED).body(plans.create(StaffPrincipal.from(jwt), in)); }

        @PutMapping("/plans/{id}")
        Plans.Row updatePlan(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @Valid @RequestBody Plans.Input in) { return plans.update(StaffPrincipal.from(jwt), uuid(id), in); }

        @DeleteMapping("/plans/{id}")
        ResponseEntity<Void> deletePlan(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) {
            plans.delete(StaffPrincipal.from(jwt), uuid(id));
            return ResponseEntity.noContent().build();
        }

        // checkout coupons
        @GetMapping("/coupons")
        List<Coupons.Row> coupons() { return coupons.list(); }

        @PostMapping("/coupons")
        ResponseEntity<Coupons.Row> createCoupon(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody Coupons.Input in) { return ResponseEntity.status(HttpStatus.CREATED).body(coupons.create(StaffPrincipal.from(jwt), in)); }

        @PutMapping("/coupons/{id}")
        Coupons.Row updateCoupon(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @Valid @RequestBody Coupons.Input in) { return coupons.update(StaffPrincipal.from(jwt), uuid(id), in); }

        @DeleteMapping("/coupons/{id}")
        ResponseEntity<Void> deleteCoupon(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) {
            coupons.delete(StaffPrincipal.from(jwt), uuid(id));
            return ResponseEntity.noContent().build();
        }

        // offer review
        @GetMapping("/offers")
        List<OfferReview.Row> offers(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) String status) { return offerReview.list(status, adminAccess.businessScope(StaffPrincipal.from(jwt), "b.id")); }

        @PostMapping("/offers/{id}/approve")
        OfferReview.Row approveOffer(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) {
            adminAccess.requireBusiness(StaffPrincipal.from(jwt), offerReview.businessOf(uuid(id)));
            return offerReview.decide(StaffPrincipal.from(jwt), uuid(id), true, null);
        }

        @PostMapping("/offers/{id}/reject")
        OfferReview.Row rejectOffer(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @RequestBody Note in) {
            adminAccess.requireBusiness(StaffPrincipal.from(jwt), offerReview.businessOf(uuid(id)));
            return offerReview.decide(StaffPrincipal.from(jwt), uuid(id), false, in.note());
        }

        // events
        @GetMapping("/events")
        List<Events.ListRow> events(@RequestParam(required = false) String status) { return events.list(status, null); }

        @GetMapping("/events/{id}")
        Events.Row event(@PathVariable String id) { return events.get(uuid(id)); }

        @PostMapping("/events")
        ResponseEntity<Events.Row> createEvent(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody Events.Input in) { return ResponseEntity.status(HttpStatus.CREATED).body(events.adminCreate(StaffPrincipal.from(jwt), in)); }

        @PutMapping("/events/{id}")
        Events.Row updateEvent(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @Valid @RequestBody Events.Input in) { return events.adminUpdate(StaffPrincipal.from(jwt), uuid(id), in); }

        @PostMapping("/events/{id}/approve")
        Events.Row approveEvent(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) { return events.review(StaffPrincipal.from(jwt), uuid(id), true, null); }

        @PostMapping("/events/{id}/reject")
        Events.Row rejectEvent(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @RequestBody Note in) { return events.review(StaffPrincipal.from(jwt), uuid(id), false, in.note()); }

        @PostMapping("/events/{id}/cancel")
        Events.Row cancelEvent(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) { return events.adminCancel(StaffPrincipal.from(jwt), uuid(id)); }
    }

    // ---------- merchant: always their own business ----------
    @RestController
    @RequestMapping("/v1/merchant")
    public static class MerchantContentApi {
        private final Events events;
        private final ReservationSettings reservations;
        private final StaffService staff;

        MerchantContentApi(Events events, ReservationSettings reservations, StaffService staff) {
            this.events = events;
            this.reservations = reservations;
            this.staff = staff;
        }

        @GetMapping("/events")
        List<Events.ListRow> events(@AuthenticationPrincipal Jwt jwt) { return events.list(null, StaffPrincipal.from(jwt).requireBusiness()); }

        @GetMapping("/events/{id}")
        Events.Row event(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) { return events.merchantGet(StaffPrincipal.from(jwt), uuid(id)); }

        @PostMapping("/events")
        ResponseEntity<Events.Row> createEvent(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody Events.Input in) { return ResponseEntity.status(HttpStatus.CREATED).body(events.merchantCreate(StaffPrincipal.from(jwt), in)); }

        @PutMapping("/events/{id}")
        Events.Row updateEvent(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @Valid @RequestBody Events.Input in) { return events.merchantUpdate(StaffPrincipal.from(jwt), uuid(id), in); }

        @PostMapping("/events/{id}/cancel")
        Events.Row cancelEvent(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) { return events.merchantCancel(StaffPrincipal.from(jwt), uuid(id)); }

        @GetMapping("/reservation-settings")
        ReservationSettings.Settings settings(@AuthenticationPrincipal Jwt jwt) { return reservations.get(StaffPrincipal.from(jwt).requireBusiness()); }

        @PutMapping("/reservation-settings")
        ReservationSettings.Settings saveSettings(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody ReservationSettings.Input in) { return reservations.save(StaffPrincipal.from(jwt), in); }

        @GetMapping("/team")
        List<StaffService.TeamMember> team(@AuthenticationPrincipal Jwt jwt) { return staff.team(StaffPrincipal.from(jwt)); }

        @PostMapping("/team")
        ResponseEntity<StaffService.TeamMember> addMember(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody StaffService.TeamInput in) { return ResponseEntity.status(HttpStatus.CREATED).body(staff.addTeamMember(StaffPrincipal.from(jwt), in)); }

        @PutMapping("/team/{id}/access")
        StaffService.TeamMember access(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @Valid @RequestBody StaffService.AccessInput in) { return staff.updateAccess(StaffPrincipal.from(jwt), uuid(id), in); }

        @PostMapping("/team/{id}/deactivate")
        ResponseEntity<Void> deactivate(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) {
            staff.setTeamActive(StaffPrincipal.from(jwt), uuid(id), false);
            return ResponseEntity.noContent().build();
        }

        @PostMapping("/team/{id}/activate")
        ResponseEntity<Void> activate(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) {
            staff.setTeamActive(StaffPrincipal.from(jwt), uuid(id), true);
            return ResponseEntity.noContent().build();
        }

        @PutMapping("/team/{id}/password")
        ResponseEntity<Void> resetPassword(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @Valid @RequestBody StaffService.PasswordReset in) {
            staff.resetTeamPassword(StaffPrincipal.from(jwt), uuid(id), in.password());
            return ResponseEntity.noContent().build();
        }
    }
}
