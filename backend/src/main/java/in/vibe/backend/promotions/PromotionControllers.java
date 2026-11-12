package in.vibe.backend.promotions;

import in.vibe.backend.catalogue.Businesses;
import in.vibe.backend.catalogue.Categories;
import in.vibe.backend.common.ApiException;
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
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/** Discover: offers near you (public) and promotions (public feed, merchant CRUD, VIBE review). */
public class PromotionControllers {
    static UUID id(String raw) {
        try { return UUID.fromString(raw); } catch (IllegalArgumentException e) { throw ApiException.notFound("Not found."); }
    }

    public record Note(String note) {}

    @RestController
    public static class DiscoverApi {
        private final Businesses businesses;
        private final Categories categories;
        private final Promotions promotions;

        DiscoverApi(Businesses businesses, Categories categories, Promotions promotions) {
            this.businesses = businesses;
            this.categories = categories;
            this.promotions = promotions;
        }

        private UUID category(String raw) { return raw == null || raw.isBlank() ? null : categories.resolve(raw); }

        /** category: an id or slug ("food.cafes", "fitness.sports"); sort: nearest, saving or ending. */
        @GetMapping("/v1/offers/nearby")
        Businesses.Page<Businesses.NearbyOffer> nearby(@RequestParam(required = false) String category, @RequestParam(required = false) String q, @RequestParam(defaultValue = "nearest") String sort,
                                                       @RequestParam(defaultValue = "false") boolean openNow, @RequestParam(required = false) Double maxDistanceKm,
                                                       @RequestParam(defaultValue = "false") boolean memberOnly, @RequestParam(defaultValue = "20") int limit, @RequestParam(defaultValue = "0") int offset) {
            return businesses.nearbyOffers(q, category(category), sort, openNow, maxDistanceKm, memberOnly, limit, offset);
        }

        @GetMapping("/v1/promotions")
        List<Promotions.Card> promotions(@RequestParam(required = false) String category, @RequestParam(defaultValue = "30") int limit) { return promotions.feed(category(category), limit); }

        @PostMapping("/v1/promotions/{id}/tap")
        ResponseEntity<Void> tap(@PathVariable String id) {
            promotions.tap(id(id));
            return ResponseEntity.noContent().build();
        }
    }

    @RestController
    public static class MerchantPromotionsApi {
        private final Promotions promotions;

        MerchantPromotionsApi(Promotions promotions) { this.promotions = promotions; }

        @GetMapping("/v1/merchant/promotions")
        List<Promotions.Row> mine(@AuthenticationPrincipal Jwt jwt) { return promotions.mine(StaffPrincipal.from(jwt).requireBusiness()); }

        @PostMapping("/v1/merchant/promotions")
        ResponseEntity<Promotions.Row> add(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody Promotions.Input in) {
            return ResponseEntity.status(HttpStatus.CREATED).body(promotions.add(StaffPrincipal.from(jwt), in));
        }

        @PutMapping("/v1/merchant/promotions/{id}")
        Promotions.Row update(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @Valid @RequestBody Promotions.Input in) { return promotions.update(StaffPrincipal.from(jwt), id(id), in); }

        @DeleteMapping("/v1/merchant/promotions/{id}")
        ResponseEntity<Void> delete(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) {
            promotions.delete(StaffPrincipal.from(jwt), id(id));
            return ResponseEntity.noContent().build();
        }
    }

    @RestController
    public static class AdminPromotionsApi {
        private final Promotions promotions;

        AdminPromotionsApi(Promotions promotions) { this.promotions = promotions; }

        @GetMapping("/v1/admin/promotions")
        List<Promotions.Row> list(@RequestParam(required = false) String status) { return promotions.list(status); }

        @PostMapping("/v1/admin/promotions/{id}/approve")
        Promotions.Row approve(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) { return promotions.decide(StaffPrincipal.from(jwt), id(id), true, null); }

        @PostMapping("/v1/admin/promotions/{id}/reject")
        Promotions.Row reject(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @RequestBody Note in) { return promotions.decide(StaffPrincipal.from(jwt), id(id), false, in.note()); }
    }
}
