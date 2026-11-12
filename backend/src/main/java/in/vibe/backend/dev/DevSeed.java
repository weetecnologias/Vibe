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
    private final tools.jackson.databind.json.JsonMapper json;

    DevSeed(JdbcClient jdbc, StaffService staff, Categories categories, BusinessStore businesses, MenuAndOffers menuAndOffers, OfferReview offerReview, Coupons coupons, Events events,
            HomeContent home, Plans plans, @Value("${vibe.dev.seed-password}") String password, tools.jackson.databind.json.JsonMapper json) {
        this.json = json;
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

        // Every category, a fictional place in each with its menu and photos: the same catalogue the customer app shows in demo mode.
        DemoCatalogue demo = new DemoCatalogue(json, jdbc, categories, businesses, events);
        demo.categories(admin);
        demo.businesses(admin);
        demo.slots(); // courts, turfs, nets and classes for sports and fitness places
        demo.plans(); // monthly memberships at gyms, yoga and meditation studios, and trainers

        UUID saffronId = demo.byName.get("Saffron Courtyard");
        StaffPrincipal merchant = new StaffPrincipal(UUID.fromString(staff.createMerchant(admin, saffronId, new StaffService.NewMerchant("merchant@vibe.local", "Saffron Courtyard manager", password)).id()), "MERCHANT", saffronId);
        var offer = menuAndOffers.addOffer(merchant, new MenuAndOffers.OfferInput("Members save 30%", "percentage", 3000, null, 50000L, 50000L, true, "Every day", OffsetDateTime.now().minusDays(1), OffsetDateTime.now().plusMonths(6), true));
        // A merchant's offer needs VIBE's approval. The seeded one is approved so it shows; the second stays pending to show the review queue.
        offerReview.decide(admin, UUID.fromString(offer.id()), true, null);
        menuAndOffers.addOffer(merchant, new MenuAndOffers.OfferInput("Free dessert on dinner bills", "flat", null, 10000L, null, 50000L, false, "Every day", OffsetDateTime.now().minusDays(1), OffsetDateTime.now().plusMonths(3), true));
        demo.offers(java.util.Set.of("b-saffron")); // the other places' offers, approved

        plans.create(admin, new Plans.Input("Monthly", "month", 29900L, "Billed every month. Cancel anytime.", null, List.of("Member-only offers at partner places", "Member prices on movie and event tickets"), 1, true));
        plans.create(admin, new Plans.Input("Yearly", "year", 299900L, "Billed once a year.", "Save 17%", List.of("Everything in Monthly", "Two months free"), 2, true));
        // A fictional customer who is a member, so the customer app can sign in with 98765 43210 and the code 123456 (development only).
        // The server is already taking requests while this runs, so someone may have signed in with this number a moment ago: keep that row.
        UUID customer = jdbc.sql("insert into customers (id, phone, name, vibe_id, area) values (:id, '9876543210', 'Aarav Reddy', '482173', 'Jubilee Hills') "
                        + "on conflict (phone) do update set name = excluded.name, area = excluded.area returning id").param("id", UUID.randomUUID()).query(UUID.class).single();
        jdbc.sql("insert into memberships (customer_id, status, valid_until, plan_id, member_no) values (:c, 'active', now() + interval '30 days', (select id from membership_plans where interval = 'month' order by sort_order limit 1), 'VB 482173 7730')").param("c", customer).update();
        home.createBanner(admin, new HomeContent.BannerInput("MEMBERS", "Save 30% at Saffron Courtyard", "Every day for VIBE members", "See offer", null, "offer", offer.id(), 1, true, null, null));
        home.setPicks(admin, "offers", List.of(offer.id()));

        OffsetDateTime friday = OffsetDateTime.now().plusDays(4).withHour(20).withMinute(0).withSecond(0).withNano(0);
        events.adminCreate(admin, new Events.Input("Sunset Rooftop Jazz", "Live Events", "An evening of live jazz on the rooftop.", "Skyline Terrace", "Banjara Hills", friday, friday.minusMinutes(45), null, 18, List.of("Entry with a valid ticket only."), "VIBE Hosts", true,
                List.of(new Events.TicketTypeInput("General", "Standing", 79900L, 120, 6, null), new Events.TicketTypeInput("VIP", "Reserved seating", 149900L, 30, 4, null))));
        var masterclass = events.merchantCreate(merchant, new Events.Input("Biryani Masterclass", "Workshops", "Learn dum biryani from our head chef.", "Saffron Courtyard", "Jubilee Hills", friday.plusDays(2), null, null, null, List.of(), null, null,
                List.of(new Events.TicketTypeInput("Seat", "Includes lunch", 99900L, 20, 4, null))));
        events.review(admin, UUID.fromString(masterclass.id()), true, null);
        demo.events(admin, java.util.Set.of("Sunset Rooftop Jazz", "Biryani Masterclass"));

        OffsetDateTime from = OffsetDateTime.now().minusDays(1), to = OffsetDateTime.now().plusMonths(6);
        coupons.create(admin, new Coupons.Input("MEMBERFLIX", "Members: 15% off movie tickets", "Up to ₹150 off bookings of ₹300 or more", true, List.of("movie"), "percentage", 1500, null, 15000L, 30000L, false, 4, List.of("For active VIBE members."), from, to, true));
        coupons.create(admin, new Coupons.Input("WELCOME50", "₹50 off your first booking", "Movies, events, courts and memberships, on bookings of ₹250 or more", false, List.of("movie", "tickets", "slots", "pass"), "flat", null, 5000L, null, 25000L, true, 1, List.of(), from, to, true));
        // The VIBE member offer at checkout on court and class bookings, memberships and tickets.
        coupons.create(admin, new Coupons.Input("MEMBER5", "VIBE members: 5% off", "On court and class bookings, gym and studio memberships, and event tickets. Up to ₹300 off.", true, List.of("slots", "pass", "tickets"), "percentage", 500, null, 30000L, null, false, null, List.of("For active VIBE members."), from, to, true));
        // A sports venue login, to try court bookings from the merchant side.
        staff.createMerchant(admin, demo.byName.get("Smash Arena"), new StaffService.NewMerchant("sports@vibe.local", "Smash Arena manager", password));
        staff.createMerchant(admin, demo.byName.get("Pulse Studio"), new StaffService.NewMerchant("gym@vibe.local", "Pulse Studio manager", password)); // monthly memberships and gym sessions
        staff.addTeamMember(merchant, new StaffService.TeamInput("cashier@vibe.local", "Saffron cashier", password, "cashier", List.of()));
        jdbc.sql("update staff_users set must_change_password = false").update();
        log.warn("DEV SEED loaded: admin@vibe.local and merchant@vibe.local with the dev seed password. Development only.");
        log.info("Seeded {} places across {} categories (merchant login: Saffron Courtyard)", demo.businessIds.size(), demo.categoryIds.size());
    }
}
