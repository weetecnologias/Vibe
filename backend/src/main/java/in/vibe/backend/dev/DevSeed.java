package in.vibe.backend.dev;

import in.vibe.backend.backoffice.StaffService;
import in.vibe.backend.catalogue.BusinessStore;
import in.vibe.backend.catalogue.Categories;
import in.vibe.backend.catalogue.MenuAndOffers;
import in.vibe.backend.catalogue.OfferReview;
import in.vibe.backend.coupons.Coupons;
import in.vibe.backend.events.Events;
import in.vibe.backend.home.HomeContent;
import in.vibe.backend.membership.Plans;
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
    private final OfferReview offerReview;
    private final Coupons coupons;
    private final Events events;
    private final HomeContent home;
    private final Plans plans;
    private final String password;

    DevSeed(JdbcClient jdbc, StaffService staff, Categories categories, BusinessStore businesses, MenuAndOffers menuAndOffers, OfferReview offerReview, Coupons coupons, Events events,
            HomeContent home, Plans plans, @Value("${vibe.dev.seed-password}") String password) {
        this.jdbc = jdbc;
        this.staff = staff;
        this.categories = categories;
        this.businesses = businesses;
        this.menuAndOffers = menuAndOffers;
        this.offerReview = offerReview;
        this.coupons = coupons;
        this.events = events;
        this.home = home;
        this.plans = plans;
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
        seedMoreCategories(admin, food, movies);

        var saffron = businesses.create(admin, new BusinessStore.AdminInput(restaurants, List.of(restaurants), profile("Saffron Courtyard", "Jubilee Hills", 17.4326, 78.4071, 3, "11:30", "23:00"), true, false, true));
        var brew = businesses.create(admin, new BusinessStore.AdminInput(cafes, List.of(cafes), profile("Brew & Bloom Café", "Banjara Hills", 17.4156, 78.4347, 2, "08:00", "22:30"), true, true, true));
        businesses.create(admin, new BusinessStore.AdminInput(cinemas, List.of(cinemas), profile("Galleria Cinemas", "Hitech City", 17.4435, 78.3772, 2, "09:00", "01:00"), true, false, true));

        UUID saffronId = UUID.fromString(saffron.id());
        StaffPrincipal merchant = new StaffPrincipal(UUID.fromString(staff.createMerchant(admin, saffronId, new StaffService.NewMerchant("merchant@vibe.local", "Saffron Courtyard manager", password)).id()), "MERCHANT", saffronId);
        menuAndOffers.addMenu(merchant, new MenuAndOffers.MenuInput("Hyderabadi dum biryani", "Slow-cooked, served with raita", 48000L, "Mains", null, 1, true));
        menuAndOffers.addMenu(merchant, new MenuAndOffers.MenuInput("Charcoal seekh kebab", "Four pieces", 39000L, "Starters", null, 2, true));
        var offer = menuAndOffers.addOffer(merchant, new MenuAndOffers.OfferInput("Members save 30%", "percentage", 3000, null, 50000L, 50000L, true, "Every day", OffsetDateTime.now().minusDays(1), OffsetDateTime.now().plusMonths(6), true));
        // A merchant's offer needs VIBE's approval. The seeded one is approved so it shows; the second stays pending to show the review queue.
        offerReview.decide(admin, UUID.fromString(offer.id()), true, null);
        menuAndOffers.addOffer(merchant, new MenuAndOffers.OfferInput("Free dessert on dinner bills", "flat", null, 10000L, null, 50000L, false, "Every day", OffsetDateTime.now().minusDays(1), OffsetDateTime.now().plusMonths(3), true));

        plans.create(admin, new Plans.Input("Monthly", "month", 29900L, "Billed every month. Cancel anytime.", null, List.of("Member-only offers at partner places", "Member prices on movie and event tickets"), 1, true));
        plans.create(admin, new Plans.Input("Yearly", "year", 299900L, "Billed once a year.", "Save 17%", List.of("Everything in Monthly", "Two months free"), 2, true));
        // A fictional customer who is a member, so the customer app can sign in with 98765 43210 and the code 123456 (development only).
        UUID customer = UUID.randomUUID();
        jdbc.sql("insert into customers (id, phone, name, vibe_id, area) values (:id, '9876543210', 'Aarav Reddy', '482173', 'Jubilee Hills')").param("id", customer).update();
        jdbc.sql("insert into memberships (customer_id, status, valid_until, plan_id, member_no) values (:c, 'active', now() + interval '30 days', (select id from membership_plans where interval = 'month' order by sort_order limit 1), 'VB 482173 7730')").param("c", customer).update();
        home.createBanner(admin, new HomeContent.BannerInput("MEMBERS", "Save 30% at Saffron Courtyard", "Every day for VIBE members", "See offer", null, "offer", offer.id(), 1, true, null, null));
        home.setPicks(admin, "offers", List.of(offer.id()));

        OffsetDateTime friday = OffsetDateTime.now().plusDays(4).withHour(20).withMinute(0).withSecond(0).withNano(0);
        events.adminCreate(admin, new Events.Input("Sunset Rooftop Jazz", "Live Events", "An evening of live jazz on the rooftop.", "Skyline Terrace", "Banjara Hills", friday, friday.minusMinutes(45), null, 18, List.of("Entry with a valid ticket only."), "VIBE Hosts", true,
                List.of(new Events.TicketTypeInput("General", "Standing", 79900L, 120, 6), new Events.TicketTypeInput("VIP", "Reserved seating", 149900L, 30, 4))));
        events.merchantCreate(merchant, new Events.Input("Biryani Masterclass", "Workshops", "Learn dum biryani from our head chef.", "Saffron Courtyard", "Jubilee Hills", friday.plusDays(2), null, null, null, List.of(), null, null,
                List.of(new Events.TicketTypeInput("Seat", "Includes lunch", 99900L, 20, 4))));

        OffsetDateTime from = OffsetDateTime.now().minusDays(1), to = OffsetDateTime.now().plusMonths(6);
        coupons.create(admin, new Coupons.Input("MEMBERFLIX", "Members: 15% off movie tickets", "Up to ₹150 off bookings of ₹300 or more", true, List.of("movie"), "percentage", 1500, null, 15000L, 30000L, false, 4, List.of("For active VIBE members."), from, to, true));
        coupons.create(admin, new Coupons.Input("WELCOME50", "₹50 off your first booking", "Movies and events, on bookings of ₹250 or more", false, List.of("movie", "tickets"), "flat", null, 5000L, null, 25000L, true, 1, List.of(), from, to, true));
        jdbc.sql("update staff_users set must_change_password = false").update();
        log.warn("DEV SEED loaded: admin@vibe.local and merchant@vibe.local with the dev seed password. Development only.");
        log.info("Seeded businesses: {} and {}", saffron.name(), brew.name());
    }

    /** The rest of the category tree the customer app shows, so the live app is not missing sections. Cinemas, events, social and offers don't use bills. */
    private void seedMoreCategories(StaffPrincipal admin, String food, String movies) {
        String foodId = food;
        for (String[] c : new String[][] {{"food.bakeries", "Bakeries & Desserts"}, {"food.cloud-kitchens", "Cloud Kitchens"}, {"food.food-courts", "Food Courts"}, {"food.fine-dining", "Fine Dining"}, {"food.buffets", "Buffets"}}) {
            categories.create(admin, cat(foodId, c[0], c[1], "food", 3));
        }
        group(admin, "shopping", "Shopping", "shopping", 3, new String[][] {{"fashion", "Fashion"}, {"footwear", "Footwear"}, {"accessories", "Accessories"}, {"lifestyle", "Lifestyle"}, {"electronics", "Electronics"}, {"boutiques", "Local Boutiques"}, {"multi-brand", "Multi-brand Stores"}});
        group(admin, "fitness", "Fitness & Wellness", "fitness", 4, new String[][] {{"gyms", "Gyms"}, {"yoga", "Yoga & Meditation"}, {"sports", "Sports"}, {"wellness", "Wellness"}, {"training", "Personal Training"}});
        group(admin, "beauty", "Beauty & Personal Care", "beauty", 5, new String[][] {{"salons", "Salons"}, {"skin-hair", "Skin & Hair"}, {"spa", "Spa & Massage"}, {"grooming", "Grooming"}, {"bridal", "Bridal Services"}});
        group(admin, "kids", "Kids & Family", "kids", 6, new String[][] {{"indoor-play", "Indoor Play"}, {"learning", "Learning"}, {"sports", "Kids Sports"}, {"celebrations", "Celebrations"}, {"family", "Family Experiences"}, {"childcare", "Childcare"}});
        group(admin, "events", "Events & Experiences", "ticket", 7, new String[][] {{"workshops", "Workshops"}, {"meetups", "Meetups"}, {"tours", "Tours"}, {"live", "Live Events"}, {"experiences", "Experiences"}});
        group(admin, "social", "VIBE Social", "social", 9, new String[][] {{"meet", "Meet People"}, {"groups", "Groups"}, {"activities", "Activities"}, {"communities", "Communities"}, {"events", "Social Events"}});
        group(admin, "offers", "Offers & Benefits", "offer", 10, new String[][] {{"all", "All Offers"}, {"nearby", "Nearby Offers"}, {"trending", "Trending Offers"}, {"new", "Newly Added"}, {"ending", "Ending Soon"}, {"member", "Member Exclusive"}});
        for (String[] c : new String[][] {{"movies.private-theatres", "Private Theatres"}, {"movies.open-air-screenings", "Open-air Screenings"}, {"movies.clubs-festivals", "Movie Clubs & Festivals"}}) {
            categories.create(admin, cat(movies, c[0], c[1], "film", 2));
        }
    }

    private void group(StaffPrincipal admin, String slug, String name, String icon, int sort, String[][] children) {
        String id = categories.create(admin, cat(null, slug, name, icon, sort)).id();
        int i = 1;
        for (String[] c : children) categories.create(admin, cat(id, slug + "." + c[0], c[1], icon, i++));
    }

    private static Categories.Input cat(String parent, String slug, String name, String icon, int sort) {
        String top = slug.contains(".") ? slug.substring(0, slug.indexOf('.')) : slug;
        boolean bills = !java.util.Set.of("movies", "events", "social", "offers").contains(top);
        String label = switch (top) { case "food" -> "Menu"; case "shopping" -> "Price list"; case "fitness", "beauty", "kids" -> "Services"; default -> null; };
        return new Categories.Input(parent, slug, name, icon, null, null, sort, true, bills, slug.equals(top) ? label : null);
    }

    private static BusinessStore.Profile profile(String name, String area, double lat, double lng, int price, String opens, String closes) {
        List<BusinessStore.Hour> hours = java.util.stream.IntStream.range(0, 7).mapToObj(d -> new BusinessStore.Hour(d, opens, closes)).toList();
        return new BusinessStore.Profile(name, area, area + ", Hyderabad", lat, lng, "Sample listing for development.", null, null, price, 120000L,
                List.of("Prices include applicable taxes unless stated."), false, List.of(), hours);
    }
}
