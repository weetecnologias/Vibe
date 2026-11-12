package in.vibe.backend;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.Test;

import java.time.OffsetDateTime;
import java.util.List;

import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.not;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Discover: offers near you, filtered by category, search, distance, open now and members-only; and promotions, reviewed by VIBE before customers see them. */
class DiscoverTest extends ApiTestSupport {
    /** A place open all day every day, at a chosen point. */
    String place(String categoryId, String name, double lat, double lng, boolean hours) throws Exception {
        StringBuilder week = new StringBuilder();
        for (int d = 0; d < 7 && hours; d++) week.append(d == 0 ? "" : ",").append("{\"dow\":").append(d).append(",\"opens\":\"00:00\",\"closes\":\"23:59\"}");
        String body = """
            {"primaryCategoryId":"%s","categoryIds":["%s"],"verified":true,"active":true,
             "profile":{"name":"%s","area":"Jubilee Hills","address":"Road 1","lat":%s,"lng":%s,"priceLevel":2,"costForTwo":120000,"hours":[%s]}}
            """.formatted(categoryId, categoryId, name, lat, lng, week);
        return id(mvc.perform(as(adminToken(), post("/v1/admin/businesses")).content(body)).andExpect(status().isCreated()).andReturn());
    }

    List<String> names(String json) { return JsonPath.read(json, "$.items[*].businessName"); }

    @Test
    void offersNearYouFilterByCategorySearchDistanceOpenNowAndMembers() throws Exception {
        String food = category(null, "Food " + uniq()), cafes = category(food, "Cafes " + uniq()), sports = category(null, "Sports " + uniq());
        String near = place(cafes, "Near Café " + uniq(), 17.4330, 78.4075, true), far = place(cafes, "Far Café " + uniq(), 17.30, 78.60, true);
        String shut = place(cafes, "No Hours Café " + uniq(), 17.4340, 78.4080, false), court = place(sports, "Court Club " + uniq(), 17.4335, 78.4070, true);
        liveOffer(merchant(near), true);
        liveOffer(merchant(far), false);
        liveOffer(merchant(shut), false);
        liveOffer(merchant(court), false);
        String nearName = JsonPath.read(mvc.perform(get("/v1/businesses/" + near)).andReturn().getResponse().getContentAsString(), "$.name");

        // The parent category finds the cafés under it, nearest first, with distance and open status; not the sports place.
        String all = mvc.perform(get("/v1/offers/nearby").param("category", food)).andExpect(status().isOk()).andExpect(jsonPath("$.total", is(3)))
                .andExpect(jsonPath("$.items[0].businessName", is(nearName))).andExpect(jsonPath("$.items[0].distanceKm", is(0.1)))
                .andExpect(jsonPath("$.items[0].status.open", is(true))).andExpect(jsonPath("$.items[0].headline", is("30%"))).andReturn().getResponse().getContentAsString();
        assertEquals(3, names(all).size());
        mvc.perform(get("/v1/offers/nearby").param("category", sports)).andExpect(jsonPath("$.total", is(1)));

        // Within 3 km leaves out the far one; open now leaves out the place with no hours; members-only keeps the member offer.
        mvc.perform(get("/v1/offers/nearby").param("category", cafes).param("maxDistanceKm", "3")).andExpect(jsonPath("$.total", is(2)));
        mvc.perform(get("/v1/offers/nearby").param("category", cafes).param("openNow", "true")).andExpect(jsonPath("$.total", is(2)))
                .andExpect(jsonPath("$.items[*].businessName", not(hasItem(JsonPath.<String>read(mvc.perform(get("/v1/businesses/" + shut)).andReturn().getResponse().getContentAsString(), "$.name")))));
        mvc.perform(get("/v1/offers/nearby").param("category", cafes).param("memberOnly", "true")).andExpect(jsonPath("$.total", is(1))).andExpect(jsonPath("$.items[0].memberOnly", is(true)));
        mvc.perform(get("/v1/offers/nearby").param("category", cafes).param("q", "far caf")).andExpect(jsonPath("$.total", is(1)));

        // Paging.
        mvc.perform(get("/v1/offers/nearby").param("category", cafes).param("limit", "2")).andExpect(jsonPath("$.items", hasSize(2))).andExpect(jsonPath("$.nextOffset", is(2)));
        mvc.perform(get("/v1/offers/nearby").param("category", cafes).param("limit", "2").param("offset", "2")).andExpect(jsonPath("$.items", hasSize(1))).andExpect(jsonPath("$.nextOffset").doesNotExist());
    }

    String promo(String title, String offerId) {
        return """
            {"title":"%s","message":"Come by this weekend.","offerId":%s,"startsAt":"%s","endsAt":"%s"}""".formatted(title, offerId == null ? "null" : "\"" + offerId + "\"",
                OffsetDateTime.now().minusHours(1), OffsetDateTime.now().plusDays(10));
    }

    @Test
    void aPromotionShowsInDiscoverOnlyOnceVibeApprovesIt() throws Exception {
        String cat = category(null, "Promo " + uniq());
        String biz = place(cat, "Promo Place " + uniq(), 17.4330, 78.4075, true), m = merchant(biz);
        String offer = liveOffer(m, false);
        String id = id(mvc.perform(as(m, post("/v1/merchant/promotions")).content(promo("Winter menu is here", offer))).andExpect(status().isCreated())
                .andExpect(jsonPath("$.reviewStatus", is("pending"))).andExpect(jsonPath("$.liveNow", is(false))).andReturn());
        mvc.perform(get("/v1/promotions").param("category", cat)).andExpect(jsonPath("$", empty()));
        mvc.perform(as(adminToken(), get("/v1/staff/notifications"))).andExpect(jsonPath("$.items[?(@.kind=='promotion_review')]", not(empty())));

        // VIBE approves: customers see it, with the linked offer and the place's details; the business is told.
        mvc.perform(as(adminToken(), get("/v1/admin/promotions").param("status", "pending"))).andExpect(jsonPath("$[*].id", hasItem(id)));
        mvc.perform(as(adminToken(), post("/v1/admin/promotions/" + id + "/approve"))).andExpect(jsonPath("$.reviewStatus", is("approved"))).andExpect(jsonPath("$.liveNow", is(true)));
        mvc.perform(get("/v1/promotions").param("category", cat)).andExpect(jsonPath("$", hasSize(1))).andExpect(jsonPath("$[0].title", is("Winter menu is here")))
                .andExpect(jsonPath("$[0].offerId", is(offer))).andExpect(jsonPath("$[0].offerHeadline", is("30% off"))).andExpect(jsonPath("$[0].status.open", is(true)))
                .andExpect(jsonPath("$[0].businessId", is(biz)));
        mvc.perform(as(m, get("/v1/staff/notifications"))).andExpect(jsonPath("$.items[?(@.kind=='promotion_decision')].title", hasItem("Promotion approved")));
        mvc.perform(post("/v1/promotions/" + id + "/tap")).andExpect(status().isNoContent());
        mvc.perform(as(m, get("/v1/merchant/promotions"))).andExpect(jsonPath("$[0].taps", is(1)));

        // Changing the words sends it back for review; switching it off and on doesn't.
        mvc.perform(as(m, put("/v1/merchant/promotions/" + id)).content(promo("Winter menu: now with soups", offer))).andExpect(jsonPath("$.reviewStatus", is("pending")));
        mvc.perform(get("/v1/promotions").param("category", cat)).andExpect(jsonPath("$", empty()));
        mvc.perform(as(adminToken(), post("/v1/admin/promotions/" + id + "/reject")).content("{\"note\":\" \"}")).andExpect(status().isBadRequest());
        mvc.perform(as(adminToken(), post("/v1/admin/promotions/" + id + "/reject")).content("{\"note\":\"Use a photo of your own place.\"}")).andExpect(jsonPath("$.reviewStatus", is("rejected")))
                .andExpect(jsonPath("$.reviewNote", is("Use a photo of your own place.")));
    }

    @Test
    void promotionsAreLimitedCheckedAndOnlyForTheOffersTeam() throws Exception {
        String biz = place(category(null, "Limit " + uniq()), "Limit Place " + uniq(), 17.4330, 78.4075, true), m = merchant(biz);
        for (int i = 0; i < 3; i++) mvc.perform(as(m, post("/v1/merchant/promotions")).content(promo("Promotion " + i, null))).andExpect(status().isCreated());
        mvc.perform(as(m, post("/v1/merchant/promotions")).content(promo("One too many", null))).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("too_many")));

        String other = merchant(place(category(null, "Other " + uniq()), "Other Place " + uniq(), 17.4330, 78.4075, true));
        String foreign = liveOffer(m, false);
        mvc.perform(as(other, post("/v1/merchant/promotions")).content(promo("Not my offer", foreign))).andExpect(status().isBadRequest());
        mvc.perform(as(other, post("/v1/merchant/promotions")).content("""
            {"title":"Too long","startsAt":"%s","endsAt":"%s"}""".formatted(OffsetDateTime.now(), OffsetDateTime.now().plusDays(120)))).andExpect(status().isBadRequest());
        mvc.perform(as(other, post("/v1/merchant/promotions")).content("""
            {"title":"Bad photo","imageUrl":"javascript:alert(1)","startsAt":"%s","endsAt":"%s"}""".formatted(OffsetDateTime.now(), OffsetDateTime.now().plusDays(5)))).andExpect(status().isBadRequest());
        String mine = JsonPath.read(mvc.perform(as(m, get("/v1/merchant/promotions"))).andReturn().getResponse().getContentAsString(), "$[0].id");
        mvc.perform(as(other, delete("/v1/merchant/promotions/" + mine))).andExpect(status().isNotFound());

        // A cashier doesn't run promotions.
        String email = "c-" + uniq() + "@test.local";
        mvc.perform(as(m, post("/v1/merchant/team")).content("{\"email\":\"" + email + "\",\"name\":\"C\",\"password\":\"" + PASSWORD + "\",\"staffRole\":\"cashier\"}")).andExpect(status().isCreated());
        mvc.perform(as(signInSettled(email, PASSWORD), get("/v1/merchant/promotions"))).andExpect(status().isForbidden());
    }

    @Test
    void aTrustedBusinessPromotionGoesLiveAtOnce() throws Exception {
        String cat = category(null, "Trusted " + uniq());
        String biz = place(cat, "Trusted Place " + uniq(), 17.4330, 78.4075, true), m = merchant(biz);
        jdbc.sql("update businesses set auto_approve = true where id = :b").param("b", java.util.UUID.fromString(biz)).update();
        mvc.perform(as(m, post("/v1/merchant/promotions")).content(promo("Live straight away", null))).andExpect(jsonPath("$.reviewStatus", is("approved"))).andExpect(jsonPath("$.autoApproved", is(true)));
        mvc.perform(get("/v1/promotions").param("category", cat)).andExpect(jsonPath("$[*].title", contains("Live straight away")));
        mvc.perform(get("/v1/promotions").param("category", category(null, "Empty " + uniq()))).andExpect(jsonPath("$", empty()));
    }
}
