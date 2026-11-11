package in.vibe.backend.dev;

import in.vibe.backend.backoffice.StaffService;
import in.vibe.backend.catalogue.BusinessStore;
import in.vibe.backend.catalogue.Categories;
import in.vibe.backend.catalogue.MenuAndOffers;
import in.vibe.backend.security.StaffPrincipal;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * DEVELOPMENT ONLY. Fictional sample data and sign-in accounts so the dashboards have something to show.
 * Runs only with the `dev` profile and only when the database has no accounts yet. Never active in production.
 */
@Component
@Profile("dev")
class DevSeed implements ApplicationRunner {
    private static final Logger log = LoggerFactory.getLogger(DevSeed.class);

    private final JdbcClient jdbc;
    private final StaffService staff;
    private final Categories categories;
    private final BusinessStore businesses;
    private final MenuAndOffers menuAndOffers;
    private final String password;

    DevSeed(JdbcClient jdbc, StaffService staff, Categories categories, BusinessStore businesses, MenuAndOffers menuAndOffers,
            @Value("${vibe.dev.seed-password}") String password) {
        this.jdbc = jdbc;
        this.staff = staff;
        this.categories = categories;
        this.businesses = businesses;
        this.menuAndOffers = menuAndOffers;
        this.password = password;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (jdbc.sql("select count(*) from staff_users").query(Integer.class).single() > 0) return;
        UUID adminId = staff.createAdmin("admin@vibe.local", "VIBE Admin", password);
        StaffPrincipal admin = new StaffPrincipal(adminId, "ADMIN", null);

        String food = categories.create(admin, cat(null, "food", "Food & Dining", "food", 1)).id();
        String restaurants = categories.create(admin, cat(food, "food.restaurants", "Restaurants", "food", 1)).id();
        categories.create(admin, cat(restaurants, "food.restaurants.north-indian", "North Indian", "food", 1));
        String cafes = categories.create(admin, cat(food, "food.cafes", "Cafés & Coffee", "food", 2)).id();
        String movies = categories.create(admin, cat(null, "movies", "Movies", "film", 2)).id();
        String cinemas = categories.create(admin, cat(movies, "movies.cinemas", "Cinemas", "film", 1)).id();

        var saffron = businesses.create(admin, new BusinessStore.AdminInput(restaurants, List.of(restaurants), profile("Saffron Courtyard", "Jubilee Hills", 17.4326, 78.4071, 3, "11:30", "23:00"), true, false, true));
        var brew = businesses.create(admin, new BusinessStore.AdminInput(cafes, List.of(cafes), profile("Brew & Bloom Café", "Banjara Hills", 17.4156, 78.4347, 2, "08:00", "22:30"), true, true, true));
        businesses.create(admin, new BusinessStore.AdminInput(cinemas, List.of(cinemas), profile("Galleria Cinemas", "Hitech City", 17.4435, 78.3772, 2, "09:00", "01:00"), true, false, true));

        UUID saffronId = UUID.fromString(saffron.id());
        StaffPrincipal merchant = new StaffPrincipal(UUID.fromString(staff.createMerchant(admin, saffronId, new StaffService.NewMerchant("merchant@vibe.local", "Saffron Courtyard manager", password)).id()), "MERCHANT", saffronId);
        menuAndOffers.addMenu(merchant, new MenuAndOffers.MenuInput("Hyderabadi dum biryani", "Slow-cooked, served with raita", 48000L, "Mains", null, 1, true));
        menuAndOffers.addMenu(merchant, new MenuAndOffers.MenuInput("Charcoal seekh kebab", "Four pieces", 39000L, "Starters", null, 2, true));
        menuAndOffers.addOffer(merchant, new MenuAndOffers.OfferInput("Members save 30%", "percentage", 3000, null, 50000L, 50000L, true, "Every day", OffsetDateTime.now().minusDays(1), OffsetDateTime.now().plusMonths(6), true));
        log.warn("DEV SEED loaded: admin@vibe.local and merchant@vibe.local with the dev seed password. Development only.");
        log.info("Seeded businesses: {} and {}", saffron.name(), brew.name());
    }

    private static Categories.Input cat(String parent, String slug, String name, String icon, int sort) {
        return new Categories.Input(parent, slug, name, icon, null, null, sort, true);
    }

    private static BusinessStore.Profile profile(String name, String area, double lat, double lng, int price, String opens, String closes) {
        List<BusinessStore.Hour> hours = java.util.stream.IntStream.range(0, 7).mapToObj(d -> new BusinessStore.Hour(d, opens, closes)).toList();
        return new BusinessStore.Profile(name, area, area + ", Hyderabad", lat, lng, "Sample listing for development.", null, null, price, 120000L,
                List.of("Prices include applicable taxes unless stated."), false, List.of(), hours);
    }
}
