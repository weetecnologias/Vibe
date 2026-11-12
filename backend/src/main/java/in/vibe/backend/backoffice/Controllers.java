package in.vibe.backend.backoffice;

import in.vibe.backend.audit.AuditService;
import in.vibe.backend.catalogue.BusinessStore;
import in.vibe.backend.catalogue.Businesses;
import in.vibe.backend.catalogue.Categories;
import in.vibe.backend.catalogue.MenuAndOffers;
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
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Public reads, staff sign-in, and the admin and merchant APIs. Thin on purpose: the rules live in the services. */
public class Controllers {

    static UUID uuid(String raw) {
        try { return UUID.fromString(raw); } catch (IllegalArgumentException e) { throw ApiException.notFound("Not found."); }
    }

    // ---------- public: what the customer app reads ----------
    @RestController
    @RequestMapping("/v1")
    public static class PublicApi {
        private final Categories categories;
        private final Businesses businesses;

        PublicApi(Categories categories, Businesses businesses) {
            this.categories = categories;
            this.businesses = businesses;
        }

        @GetMapping("/health")
        Map<String, String> health() { return Map.of("status", "ok"); }

        @GetMapping("/categories")
        List<Categories.Node> categories() { return categories.tree(); }

        @GetMapping("/businesses")
        Businesses.Page<Businesses.Summary> businesses(@RequestParam(required = false) String q, @RequestParam(required = false) String categoryId,
                                                       @RequestParam(required = false) String sort, @RequestParam(defaultValue = "12") int limit,
                                                       @RequestParam(defaultValue = "0") int offset) {
            return businesses.search(q, categoryId == null || categoryId.isBlank() ? null : categories.resolve(categoryId), sort, limit, offset);
        }

        @GetMapping("/businesses/{id}")
        Businesses.Detail business(@PathVariable String id) { return businesses.detail(uuid(id)); }
    }

    // ---------- staff sign-in ----------
    @RestController
    @RequestMapping("/v1/staff")
    public static class StaffApi {
        private final StaffService staff;

        StaffApi(StaffService staff) { this.staff = staff; }

        @PostMapping("/login")
        StaffService.Session login(@Valid @RequestBody StaffService.Login in) { return staff.login(in.email(), in.password()); }

        @GetMapping("/me")
        StaffService.Staff me(@AuthenticationPrincipal Jwt jwt) { return staff.me(StaffPrincipal.from(jwt)); }

        /** Choosing a new password returns a fresh session. Required first thing for a login that someone else created. */
        @PostMapping("/password")
        StaffService.Session password(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody StaffService.PasswordChange in) { return staff.changePassword(StaffPrincipal.from(jwt), in.current(), in.next()); }
    }

    // ---------- admin ----------
    @RestController
    @RequestMapping("/v1/admin")
    public static class AdminApi {
        private final Categories categories;
        private final BusinessStore businesses;
        private final StaffService staff;
        private final AuditService audit;

        AdminApi(Categories categories, BusinessStore businesses, StaffService staff, AuditService audit) {
            this.categories = categories;
            this.businesses = businesses;
            this.staff = staff;
            this.audit = audit;
        }

        @GetMapping("/categories")
        List<Categories.Row> categories() { return categories.adminList(); }

        @PostMapping("/categories")
        ResponseEntity<Categories.Row> createCategory(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody Categories.Input in) {
            return ResponseEntity.status(HttpStatus.CREATED).body(categories.create(StaffPrincipal.from(jwt), in));
        }

        @PutMapping("/categories/{id}")
        Categories.Row updateCategory(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @Valid @RequestBody Categories.Input in) {
            return categories.update(StaffPrincipal.from(jwt), uuid(id), in);
        }

        @DeleteMapping("/categories/{id}")
        ResponseEntity<Void> deleteCategory(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) {
            categories.delete(StaffPrincipal.from(jwt), uuid(id));
            return ResponseEntity.noContent().build();
        }

        @GetMapping("/businesses")
        BusinessStore.ListPage businesses(@RequestParam(required = false) String q, @RequestParam(defaultValue = "25") int limit, @RequestParam(defaultValue = "0") int offset) {
            return businesses.list(q, limit, offset);
        }

        @GetMapping("/businesses/{id}")
        BusinessStore.Editable business(@PathVariable String id) { return businesses.get(uuid(id)); }

        @PostMapping("/businesses")
        ResponseEntity<BusinessStore.Editable> createBusiness(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody BusinessStore.AdminInput in) {
            return ResponseEntity.status(HttpStatus.CREATED).body(businesses.create(StaffPrincipal.from(jwt), in));
        }

        @PutMapping("/businesses/{id}")
        BusinessStore.Editable updateBusiness(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @Valid @RequestBody BusinessStore.AdminInput in) {
            return businesses.adminUpdate(StaffPrincipal.from(jwt), uuid(id), in);
        }

        @PostMapping("/businesses/{id}/staff")
        ResponseEntity<StaffService.Staff> createMerchant(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @Valid @RequestBody StaffService.NewMerchant in) {
            return ResponseEntity.status(HttpStatus.CREATED).body(staff.createMerchant(StaffPrincipal.from(jwt), uuid(id), in));
        }

        @GetMapping("/staff")
        List<StaffService.Staff> staff() { return staff.list(); }

        @PostMapping("/staff/{id}/deactivate")
        ResponseEntity<Void> deactivate(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) {
            staff.setActive(StaffPrincipal.from(jwt), uuid(id), false);
            return ResponseEntity.noContent().build();
        }

        @PostMapping("/staff/{id}/activate")
        ResponseEntity<Void> activate(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) {
            staff.setActive(StaffPrincipal.from(jwt), uuid(id), true);
            return ResponseEntity.noContent().build();
        }

        @PutMapping("/staff/{id}/password")
        ResponseEntity<Void> resetPassword(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @Valid @RequestBody StaffService.PasswordReset in) {
            staff.resetPassword(StaffPrincipal.from(jwt), uuid(id), in.password());
            return ResponseEntity.noContent().build();
        }

        @GetMapping("/audit")
        List<AuditService.Entry> audit(@RequestParam(defaultValue = "50") int limit) { return audit.latest(limit); }
    }

    // ---------- merchant: always their own business ----------
    @RestController
    @RequestMapping("/v1/merchant")
    public static class MerchantApi {
        private final BusinessStore businesses;
        private final MenuAndOffers menuAndOffers;

        MerchantApi(BusinessStore businesses, MenuAndOffers menuAndOffers) {
            this.businesses = businesses;
            this.menuAndOffers = menuAndOffers;
        }

        @GetMapping("/business")
        BusinessStore.Editable business(@AuthenticationPrincipal Jwt jwt) { return businesses.get(StaffPrincipal.from(jwt).requireBusiness()); }

        @PutMapping("/business")
        BusinessStore.Editable updateBusiness(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody BusinessStore.Profile in) {
            return businesses.merchantUpdate(StaffPrincipal.from(jwt), in);
        }

        @GetMapping("/menu")
        List<MenuAndOffers.MenuRow> menu(@AuthenticationPrincipal Jwt jwt) { return menuAndOffers.menu(StaffPrincipal.from(jwt).requireBusiness()); }

        @PostMapping("/menu")
        ResponseEntity<MenuAndOffers.MenuRow> addMenu(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody MenuAndOffers.MenuInput in) {
            return ResponseEntity.status(HttpStatus.CREATED).body(menuAndOffers.addMenu(StaffPrincipal.from(jwt), in));
        }

        @PutMapping("/menu/{id}")
        MenuAndOffers.MenuRow updateMenu(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @Valid @RequestBody MenuAndOffers.MenuInput in) {
            return menuAndOffers.updateMenu(StaffPrincipal.from(jwt), uuid(id), in);
        }

        @DeleteMapping("/menu/{id}")
        ResponseEntity<Void> deleteMenu(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) {
            menuAndOffers.deleteMenu(StaffPrincipal.from(jwt), uuid(id));
            return ResponseEntity.noContent().build();
        }

        @GetMapping("/offers")
        List<MenuAndOffers.OfferRow> offers(@AuthenticationPrincipal Jwt jwt) { return menuAndOffers.offers(StaffPrincipal.from(jwt).requireBusiness()); }

        @PostMapping("/offers")
        ResponseEntity<MenuAndOffers.OfferRow> addOffer(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody MenuAndOffers.OfferInput in) {
            return ResponseEntity.status(HttpStatus.CREATED).body(menuAndOffers.addOffer(StaffPrincipal.from(jwt), in));
        }

        @PutMapping("/offers/{id}")
        MenuAndOffers.OfferRow updateOffer(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @Valid @RequestBody MenuAndOffers.OfferInput in) {
            return menuAndOffers.updateOffer(StaffPrincipal.from(jwt), uuid(id), in);
        }

        public record Active(boolean active) {}

        @PostMapping("/offers/{id}/active")
        MenuAndOffers.OfferRow setActive(@AuthenticationPrincipal Jwt jwt, @PathVariable String id, @RequestBody Active in) { return menuAndOffers.setOfferActive(StaffPrincipal.from(jwt), uuid(id), in.active()); }

        @DeleteMapping("/offers/{id}")
        ResponseEntity<Void> deleteOffer(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) {
            menuAndOffers.deleteOffer(StaffPrincipal.from(jwt), uuid(id));
            return ResponseEntity.noContent().build();
        }
    }
}
