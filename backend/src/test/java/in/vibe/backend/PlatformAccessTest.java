package in.vibe.backend;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MvcResult;

import java.util.List;
import java.util.UUID;

import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.not;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Merchants get the features of the category they onboarded in; VIBE's own team has super admins, admins and staff with chosen areas and categories; refunds and reports. */
class PlatformAccessTest extends ApiTestSupport {
    /** A category that sets its merchant features (null = same as the parent). */
    String featured(String parent, String name, List<String> features) throws Exception {
        String f = features == null ? "null" : "[" + String.join(",", features.stream().map(x -> "\"" + x + "\"").toList()) + "]";
        String body = "{\"parentId\":" + (parent == null ? "null" : "\"" + parent + "\"") + ",\"slug\":\"c-" + uniq() + "\",\"name\":\"" + name + "\",\"icon\":\"food\",\"sortOrder\":1,\"features\":" + f + "}";
        return id(mvc.perform(as(adminToken(), post("/v1/admin/categories")).content(body)).andExpect(status().isCreated()).andReturn());
    }

    String superAdmin() throws Exception {
        String email = "sa-" + uniq() + "@test.local";
        UUID id = staff.createAdmin(email, "Super", PASSWORD);
        jdbc.sql("update staff_users set admin_role = 'super_admin' where id = :id").param("id", id).update();
        return login(email, PASSWORD);
    }

    @Test
    void aCafeGetsCafeFeaturesOnlyAndTheServerRefusesTheRest() throws Exception {
        String food = featured(null, "Food " + uniq(), List.of("bills", "offers", "menu", "reservations", "promotions"));
        String cafes = featured(food, "Cafes " + uniq(), null); // follows Food
        String cafe = business(cafes, "Corner Cafe " + uniq()), m = merchant(cafe);
        mvc.perform(as(m, get("/v1/merchant/settings"))).andExpect(jsonPath("$.features", contains("bills", "offers", "menu", "reservations", "promotions")))
                .andExpect(jsonPath("$.payRedeem", is(true))).andExpect(jsonPath("$.slotBooking", is(false))).andExpect(jsonPath("$.topCategoryName", containsString("Food")))
                .andExpect(jsonPath("$.areas.bookings").doesNotExist()).andExpect(jsonPath("$.areas.events").doesNotExist()).andExpect(jsonPath("$.areas.bills").exists());
        mvc.perform(as(m, get("/v1/merchant/offers"))).andExpect(status().isOk());
        mvc.perform(as(m, get("/v1/merchant/venue/resources"))).andExpect(status().isForbidden()).andExpect(jsonPath("$.code", is("feature_off")));
        mvc.perform(as(m, get("/v1/merchant/events"))).andExpect(status().isForbidden()).andExpect(jsonPath("$.code", is("feature_off")));
        mvc.perform(as(m, get("/v1/merchant/venue/plans"))).andExpect(status().isForbidden());

        // An event organiser: events and promotions, no bills or offers.
        String org = business(featured(null, "Events " + uniq(), List.of("events", "promotions")), "Gig Co " + uniq()), om = merchant(org);
        mvc.perform(as(om, get("/v1/merchant/settings"))).andExpect(jsonPath("$.features", contains("events", "promotions"))).andExpect(jsonPath("$.payRedeem", is(false)));
        mvc.perform(as(om, get("/v1/merchant/events"))).andExpect(status().isOk());
        mvc.perform(as(om, get("/v1/merchant/bills"))).andExpect(status().isForbidden()).andExpect(jsonPath("$.code", is("feature_off")));
        mvc.perform(as(om, get("/v1/merchant/offers"))).andExpect(status().isForbidden());

        // VIBE changes what Food businesses get: it applies at once.
        mvc.perform(as(adminToken(), get("/v1/admin/categories"))).andExpect(jsonPath("$[?(@.id=='" + cafes + "')].effectiveFeatures[0]", hasItem("bills")));
        String foodBody = "{\"slug\":\"f-" + uniq() + "\",\"name\":\"Food\",\"icon\":\"food\",\"features\":[\"bills\",\"offers\",\"menu\",\"reservations\",\"promotions\",\"events\"]}";
        mvc.perform(as(adminToken(), put("/v1/admin/categories/" + food)).content(foodBody)).andExpect(status().isOk());
        mvc.perform(as(m, get("/v1/merchant/events"))).andExpect(status().isOk());
        mvc.perform(as(adminToken(), put("/v1/admin/categories/" + food)).content(foodBody.replace("\"events\"]", "\"nope\"]"))).andExpect(status().isBadRequest());
    }

    @Test
    void anApplicantPicksACategoryAMerchantCanBeIn() throws Exception {
        String shop = featured(null, "Shops " + uniq(), List.of("bills", "offers", "menu"));
        String social = featured(null, "Social " + uniq(), List.of());
        String tree = mvc.perform(get("/v1/business-applications/categories")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertTrue(JsonPath.<List<String>>read(tree, "$[*].id").contains(shop));
        assertTrue(!JsonPath.<List<String>>read(tree, "$[*].id").contains(social));
        assertEquals(List.of("bills", "offers", "menu"), JsonPath.<List<List<String>>>read(tree, "$[?(@.id=='" + shop + "')].features").get(0));

        String app = "{\"businessName\":\"Shop " + uniq() + "\",\"categoryId\":%s,\"area\":\"Madhapur\",\"address\":\"Road 2\",\"contactName\":\"Ravi\",\"email\":\"a-" + uniq() + "@test.local\",\"phone\":\"9876501234\",\"about\":\"A shop\",\"documents\":[],\"acceptTerms\":true}";
        mvc.perform(post("/v1/business-applications").contentType("application/json").content(app.formatted("null"))).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code", is("category")));
        mvc.perform(post("/v1/business-applications").contentType("application/json").content(app.formatted("\"" + social + "\""))).andExpect(status().isBadRequest());
        mvc.perform(post("/v1/business-applications").contentType("application/json").content(app.formatted("\"" + shop + "\""))).andExpect(status().isCreated());
    }

    @Test
    void vibeStaffSeeOnlyTheirAreasAndCategoriesAndOnlySuperAdminsManageAdmins() throws Exception {
        String sa = superAdmin();
        mvc.perform(as(sa, get("/v1/admin/access"))).andExpect(jsonPath("$.role", is("super_admin"))).andExpect(jsonPath("$.areas", hasSize(7)));

        String mine = featured(null, "Mine " + uniq(), List.of("bills", "offers", "menu")), other = featured(null, "Other " + uniq(), List.of("bills", "offers", "menu"));
        String inside = business(featured(mine, "Sub " + uniq(), null), "Inside " + uniq()), outside = business(other, "Outside " + uniq());

        // A category manager: partners and reviews, for one category (and everything under it).
        String email = "cm-" + uniq() + "@test.local";
        mvc.perform(as(sa, post("/v1/admin/team")).content("{\"email\":\"" + email + "\",\"name\":\"Cat Manager\",\"password\":\"" + PASSWORD + "\",\"role\":\"staff\",\"areas\":[\"partners\",\"content\"],\"categoryIds\":[\"" + mine + "\"]}"))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.role", is("staff"))).andExpect(jsonPath("$.categories[0].id", is(mine)));
        String cm = signInSettled(email, PASSWORD);
        mvc.perform(as(cm, get("/v1/admin/access"))).andExpect(jsonPath("$.areas", contains("partners", "content")));
        String list = mvc.perform(as(cm, get("/v1/admin/businesses").param("limit", "100"))).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertTrue(JsonPath.<List<String>>read(list, "$.items[*].id").contains(inside));
        assertTrue(!JsonPath.<List<String>>read(list, "$.items[*].id").contains(outside));
        mvc.perform(as(cm, get("/v1/admin/businesses/" + outside))).andExpect(status().isForbidden());
        mvc.perform(as(cm, get("/v1/admin/businesses/" + inside))).andExpect(status().isOk());
        mvc.perform(as(cm, get("/v1/admin/transactions"))).andExpect(status().isForbidden()).andExpect(jsonPath("$.code", is("no_permission")));
        mvc.perform(as(cm, get("/v1/admin/team"))).andExpect(status().isForbidden());
        // Offers from outside their categories aren't theirs to decide.
        String offer = liveOfferPending(merchant(outside));
        mvc.perform(as(cm, post("/v1/admin/offers/" + offer + "/approve"))).andExpect(status().isForbidden());
        mvc.perform(as(cm, get("/v1/admin/offers").param("status", "pending"))).andExpect(jsonPath("$[*].id", not(hasItem(offer))));

        // An admin (CEO level) sees everything and manages staff, but not other admins.
        String adminEmail = "ad-" + uniq() + "@test.local";
        String adminId = id(mvc.perform(as(sa, post("/v1/admin/team")).content("{\"email\":\"" + adminEmail + "\",\"name\":\"CEO\",\"password\":\"" + PASSWORD + "\",\"role\":\"admin\"}")).andExpect(status().isCreated()).andReturn());
        String admin = signInSettled(adminEmail, PASSWORD);
        mvc.perform(as(admin, get("/v1/admin/transactions"))).andExpect(status().isOk());
        mvc.perform(as(admin, post("/v1/admin/team")).content("{\"email\":\"x-" + uniq() + "@test.local\",\"name\":\"X\",\"password\":\"" + PASSWORD + "\",\"role\":\"admin\"}")).andExpect(status().isForbidden());
        mvc.perform(as(admin, post("/v1/admin/team")).content("{\"email\":\"s-" + uniq() + "@test.local\",\"name\":\"S\",\"password\":\"" + PASSWORD + "\",\"role\":\"staff\",\"areas\":[]}")).andExpect(status().isBadRequest());
        String saId = JsonPath.read(mvc.perform(as(sa, get("/v1/admin/access"))).andReturn().getResponse().getContentAsString(), "$.id");
        mvc.perform(as(admin, post("/v1/admin/staff/" + saId + "/deactivate"))).andExpect(status().isForbidden());
        mvc.perform(as(sa, put("/v1/admin/team/" + saId + "/access")).content("{\"role\":\"admin\"}")).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("self")));
        // Switching someone off signs them out on their next request.
        mvc.perform(as(sa, post("/v1/admin/staff/" + adminId + "/deactivate"))).andExpect(status().isNoContent());
        mvc.perform(as(admin, get("/v1/admin/transactions"))).andExpect(status().isUnauthorized());
    }

    /** An offer waiting for VIBE's review. */
    String liveOfferPending(String merchant) throws Exception {
        return id(mvc.perform(as(merchant, post("/v1/merchant/offers")).content("""
            {"title":"10%% off","kind":"percentage","rateBps":1000,"maxDiscount":50000,"minBill":50000,"memberOnly":false,"startsAt":"2026-01-01T00:00:00Z","endsAt":"2031-01-01T00:00:00Z"}""".formatted()))
                .andExpect(status().isCreated()).andReturn());
    }

    /** A paid court booking. Returns the payment reference. */
    String paidBooking(String biz, String customer) throws Exception {
        String court = id(mvc.perform(as(merchant(biz), post("/v1/merchant/venue/resources")).content("{\"sport\":\"Tennis\",\"name\":\"Court\",\"kind\":\"court\",\"price\":60000}")).andExpect(status().isCreated()).andReturn());
        MvcResult b = mvc.perform(as(customer, post("/v1/slot-bookings")).content("{\"businessId\":\"" + biz + "\",\"items\":[{\"resourceId\":\"" + court + "\",\"startsAt\":\"" + SlotBookingTest.at(11) + "\",\"minutes\":60}]}")).andReturn();
        assertEquals(201, b.getResponse().getStatus(), b.getResponse().getContentAsString());
        String pr = JsonPath.read(b.getResponse().getContentAsString(), "$.paymentRequestId");
        String ref = JsonPath.read(mvc.perform(as(customer, post("/v1/payment-requests/" + pr + "/payments")).header("Idempotency-Key", "r-" + uniq() + uniq()).content("{\"method\":\"upi\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.reference");
        mvc.perform(as(customer, get("/v1/payments/" + ref))).andExpect(jsonPath("$.status", is("verified")));
        return ref;
    }

    @Test
    void aRefundIsTrackedFromDueToRefundedAndKeptOutOfTheSettlement() throws Exception {
        String biz = business(featured(null, "Courts " + uniq(), List.of("bookings", "promotions")), "Refund Arena " + uniq());
        String c = customerToken(phone());
        String ref = paidBooking(biz, c);
        mvc.perform(as(adminToken(), get("/v1/admin/settlements/due"))).andExpect(jsonPath("$[?(@.businessId=='" + biz + "')]", hasSize(1)));

        mvc.perform(as(adminToken(), post("/v1/admin/transactions/" + ref + "/refund")).content("{\"amount\":999999,\"reason\":\"Court closed for rain\"}")).andExpect(status().isBadRequest());
        mvc.perform(as(adminToken(), post("/v1/admin/transactions/" + ref + "/refund")).content("{\"reason\":\"Court closed for rain\"}")).andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("due"))).andExpect(jsonPath("$.refundAmount", is(62000)));
        mvc.perform(as(adminToken(), post("/v1/admin/transactions/" + ref + "/refund")).content("{\"reason\":\"Again\"}")).andExpect(status().isConflict());
        // Out of the next settlement; on the refunds list and in transactions.
        mvc.perform(as(adminToken(), get("/v1/admin/settlements/due"))).andExpect(jsonPath("$[?(@.businessId=='" + biz + "')]", empty()));
        mvc.perform(as(adminToken(), get("/v1/admin/refunds").param("status", "due"))).andExpect(jsonPath("$.items[*].reference", hasItem(ref)));
        mvc.perform(as(adminToken(), get("/v1/admin/transactions").param("status", "refund_due"))).andExpect(jsonPath("$.items[*].reference", hasItem(ref)))
                .andExpect(jsonPath("$.items[?(@.reference=='" + ref + "')].refundStatus", hasItem("due")));

        mvc.perform(as(adminToken(), post("/v1/admin/refunds/" + ref + "/done")).content("{\"partnerReference\":\"rfnd_123\"}")).andExpect(jsonPath("$.status", is("refunded")))
                .andExpect(jsonPath("$.partnerReference", is("rfnd_123")));
        mvc.perform(as(adminToken(), post("/v1/admin/refunds/" + ref + "/done")).content("{\"partnerReference\":\"rfnd_123\"}")).andExpect(status().isConflict());
        mvc.perform(as(c, get("/v1/me/notifications"))).andExpect(jsonPath("$[?(@.kind=='refund_done')]", hasSize(1)));
        mvc.perform(as(adminToken(), get("/v1/admin/audit"))).andExpect(status().isOk());
    }

    @Test
    void reportsCountPartnersPaymentsAndRefundsByCategoryAndDownload() throws Exception {
        String top = featured(null, "Report " + uniq(), List.of("bookings", "promotions")), sub = featured(top, "Report Sub " + uniq(), null);
        String biz = business(sub, "Report Arena " + uniq());
        paidBooking(biz, customerToken(phone()));
        String r = mvc.perform(as(adminToken(), get("/v1/admin/reports/categories"))).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertEquals(List.of(1), JsonPath.read(r, "$.rows[?(@.id=='" + top + "')].partners"));
        assertEquals(List.of(1), JsonPath.read(r, "$.rows[?(@.id=='" + sub + "')].payments"));
        assertEquals(List.of(62000), JsonPath.read(r, "$.rows[?(@.id=='" + top + "')].collected"));
        assertEquals(List.of(2000), JsonPath.read(r, "$.rows[?(@.id=='" + top + "')].vibeFees"));
        mvc.perform(as(adminToken(), get("/v1/admin/reports/categories").param("from", "2001-01-01").param("to", "2001-01-02")))
                .andExpect(jsonPath("$.rows[?(@.id=='" + top + "')].payments", contains(0)));
        mvc.perform(as(adminToken(), get("/v1/admin/reports/categories").param("from", "nope"))).andExpect(status().isBadRequest());
        String csv = mvc.perform(as(adminToken(), get("/v1/admin/reports/categories.csv"))).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertTrue(csv.contains("Report Sub"), csv.substring(0, Math.min(300, csv.length())));
        mvc.perform(as(adminToken(), get("/v1/admin/reports/members"))).andExpect(jsonPath("$.customers").isNumber()).andExpect(jsonPath("$.plans").isArray());
        mvc.perform(as(adminToken(), get("/v1/admin/reports/members.csv"))).andExpect(status().isOk());
        mvc.perform(as(adminToken(), get("/v1/admin/overview"))).andExpect(jsonPath("$.refundsDue").isNumber()).andExpect(jsonPath("$.unsettledGross").isNumber());
    }
}
