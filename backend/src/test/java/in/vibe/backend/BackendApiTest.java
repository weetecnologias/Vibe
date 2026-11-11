package in.vibe.backend;

import com.jayway.jsonpath.JsonPath;
import in.vibe.backend.backoffice.StaffService;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.UUID;

import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** The public catalogue and the admin and merchant APIs, against a real PostgreSQL with the real migrations. */
class BackendApiTest extends ApiTestSupport {
    // ---------- browser access (CORS) ----------
    @Test
    void dashboardsOnTheAllowedOriginCanCallTheApiAndOtherSitesCannot() throws Exception {
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options("/v1/staff/login")
                        .header("Origin", "http://localhost:5174").header("Access-Control-Request-Method", "POST").header("Access-Control-Request-Headers", "content-type,authorization"))
                .andExpect(status().isOk())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.header().string("Access-Control-Allow-Origin", "http://localhost:5174"));
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options("/v1/staff/login")
                        .header("Origin", "https://evil.example").header("Access-Control-Request-Method", "POST"))
                .andExpect(status().isForbidden())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.header().doesNotExist("Access-Control-Allow-Origin"));
    }

    // ---------- sign-in and access ----------
    @Test
    void healthIsPublic() throws Exception {
        mvc.perform(get("/v1/health")).andExpect(status().isOk()).andExpect(jsonPath("$.status", is("ok")));
    }

    @Test
    void wrongPasswordAndUnknownEmailGiveTheSameAnswer() throws Exception {
        String email = "x-" + uniq() + "@test.local";
        staff.createAdmin(email, "X", PASSWORD);
        mvc.perform(post("/v1/staff/login").contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"" + email + "\",\"password\":\"nope-nope-nope\"}"))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code", is("bad_credentials")));
        mvc.perform(post("/v1/staff/login").contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"nobody-" + uniq() + "@test.local\",\"password\":\"nope-nope-nope\"}"))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code", is("bad_credentials")));
    }

    @Test
    void repeatedWrongPasswordsLockTheAccountForAWhile() throws Exception {
        String email = "lock-" + uniq() + "@test.local";
        staff.createAdmin(email, "Lock", PASSWORD);
        for (int i = 0; i < 5; i++) {
            mvc.perform(post("/v1/staff/login").contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"" + email + "\",\"password\":\"wrong-wrong-1\"}")).andExpect(status().isUnauthorized());
        }
        // Even the right password is refused while locked.
        mvc.perform(post("/v1/staff/login").contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"" + email + "\",\"password\":\"" + PASSWORD + "\"}"))
                .andExpect(status().isTooManyRequests()).andExpect(jsonPath("$.code", is("too_many_attempts")));
    }

    @Test
    void staffEndpointsNeedTheRightRole() throws Exception {
        mvc.perform(get("/v1/admin/categories")).andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code", is("unauthorized")));
        mvc.perform(get("/v1/merchant/business")).andExpect(status().isUnauthorized());
        mvc.perform(as("not-a-token", get("/v1/admin/categories"))).andExpect(status().isUnauthorized());

        String biz = business(category(null, "Role test"), "Role test place");
        String merchantToken = merchant(biz);
        mvc.perform(as(merchantToken, get("/v1/admin/categories"))).andExpect(status().isForbidden()).andExpect(jsonPath("$.code", is("forbidden")));
        mvc.perform(as(adminToken(), get("/v1/merchant/business"))).andExpect(status().isForbidden());
        // Anything not listed is closed by default.
        mvc.perform(as(adminToken(), get("/v1/unknown"))).andExpect(status().isForbidden());
    }

    @Test
    void deactivatedAccountsCanNoLongerSignIn() throws Exception {
        String biz = business(category(null, "Deactivate test"), "Deactivate place");
        String email = "d-" + uniq() + "@test.local";
        MvcResult r = mvc.perform(as(adminToken(), post("/v1/admin/businesses/" + biz + "/staff"))
                .content("{\"email\":\"" + email + "\",\"name\":\"M\",\"password\":\"" + PASSWORD + "\"}")).andExpect(status().isCreated()).andReturn();
        String staffId = id(r);
        login(email, PASSWORD);
        mvc.perform(as(adminToken(), post("/v1/admin/staff/" + staffId + "/deactivate"))).andExpect(status().isNoContent());
        mvc.perform(post("/v1/staff/login").contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"" + email + "\",\"password\":\"" + PASSWORD + "\"}")).andExpect(status().isUnauthorized());
    }

    @Test
    void shortPasswordsAreRejected() throws Exception {
        String biz = business(category(null, "Password test"), "Password place");
        mvc.perform(as(adminToken(), post("/v1/admin/businesses/" + biz + "/staff")).content("{\"email\":\"p-" + uniq() + "@test.local\",\"name\":\"M\",\"password\":\"short\"}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code", is("validation")));
    }

    // ---------- categories ----------
    @Test
    void categoriesNestThreeLevelsAndNoMore() throws Exception {
        String l1 = category(null, "Level one");
        String l2 = category(l1, "Level two");
        String l3 = category(l2, "Level three");
        String slug = "four-" + uniq();
        mvc.perform(as(adminToken(), post("/v1/admin/categories")).content("{\"parentId\":\"" + l3 + "\",\"slug\":\"" + slug + "\",\"name\":\"Level four\"}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code", is("too_deep")));

        // Moving a level-1 branch under level 3 would make it too deep as well.
        String branchSlug = "branch-" + uniq();
        String b1 = category(null, "Branch root");
        category(b1, "Branch child");
        mvc.perform(as(adminToken(), put("/v1/admin/categories/" + b1)).content("{\"parentId\":\"" + l3 + "\",\"slug\":\"" + branchSlug + "\",\"name\":\"Branch root\"}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code", is("too_deep")));
    }

    @Test
    void aCategoryCannotMoveInsideItself() throws Exception {
        String a = category(null, "Cycle a");
        String b = category(a, "Cycle b");
        mvc.perform(as(adminToken(), put("/v1/admin/categories/" + a)).content("{\"parentId\":\"" + b + "\",\"slug\":\"cycle-a-" + uniq() + "\",\"name\":\"Cycle a\"}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code", is("cycle")));
    }

    @Test
    void newCategoriesAppearInThePublicTreeAndInactiveOnesDisappear() throws Exception {
        String top = category(null, "Public top");
        String child = category(top, "Public child");
        mvc.perform(get("/v1/categories")).andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id=='" + top + "')].children[0].id", hasItem(child)))
                .andExpect(jsonPath("$[?(@.id=='" + top + "')].children[0].children", hasItem(org.hamcrest.Matchers.empty())));
        String slug = "public-top-off-" + uniq();
        mvc.perform(as(adminToken(), put("/v1/admin/categories/" + top)).content("{\"slug\":\"" + slug + "\",\"name\":\"Public top\",\"active\":false}")).andExpect(status().isOk());
        mvc.perform(get("/v1/categories")).andExpect(jsonPath("$[?(@.id=='" + top + "')]", hasSize(0)));
        // Still there for the admin.
        mvc.perform(as(adminToken(), get("/v1/admin/categories"))).andExpect(jsonPath("$[?(@.id=='" + top + "')].active", hasItem(false)));
    }

    @Test
    void aCategoryInUseCanOnlyBeSwitchedOff() throws Exception {
        String parent = category(null, "Delete parent");
        String leaf = category(parent, "Delete leaf");
        mvc.perform(as(adminToken(), delete("/v1/admin/categories/" + parent))).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("has_children")));
        business(leaf, "Uses the leaf");
        mvc.perform(as(adminToken(), delete("/v1/admin/categories/" + leaf))).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("in_use")));
        String empty = category(null, "Delete me");
        mvc.perform(as(adminToken(), delete("/v1/admin/categories/" + empty))).andExpect(status().isNoContent());
    }

    @Test
    void categoryInputIsValidated() throws Exception {
        mvc.perform(as(adminToken(), post("/v1/admin/categories")).content("{\"slug\":\"Bad Slug!\",\"name\":\"x\"}")).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code", is("validation")));
        mvc.perform(as(adminToken(), post("/v1/admin/categories")).content("{\"slug\":\"ok-" + uniq() + "\",\"name\":\"x\",\"iconUrl\":\"javascript:alert(1)\"}")).andExpect(status().isBadRequest());
        String slug = "dupe-" + uniq();
        mvc.perform(as(adminToken(), post("/v1/admin/categories")).content("{\"slug\":\"" + slug + "\",\"name\":\"One\"}")).andExpect(status().isCreated());
        mvc.perform(as(adminToken(), post("/v1/admin/categories")).content("{\"slug\":\"" + slug + "\",\"name\":\"Two\"}")).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("duplicate")));
        mvc.perform(as(adminToken(), post("/v1/admin/categories")).content("{not json")).andExpect(status().isBadRequest());
    }

    // ---------- businesses ----------
    @Test
    void searchingACategoryFindsBusinessesInItsSubcategories() throws Exception {
        String top = category(null, "Search top");
        String child = category(top, "Search child");
        String name = "Findable " + uniq();
        String biz = business(child, name);
        mvc.perform(get("/v1/businesses").param("categoryId", top)).andExpect(status().isOk()).andExpect(jsonPath("$.items[?(@.id=='" + biz + "')].name", hasItem(name)));
        mvc.perform(get("/v1/businesses").param("categoryId", child)).andExpect(jsonPath("$.items[?(@.id=='" + biz + "')]", hasSize(1)));
        mvc.perform(get("/v1/businesses").param("categoryId", category(null, "Other branch"))).andExpect(jsonPath("$.total", is(0)));
        mvc.perform(get("/v1/businesses").param("q", name.toLowerCase())).andExpect(jsonPath("$.items[0].id", is(biz)));
        // % and _ are searched literally, never as wildcards.
        mvc.perform(get("/v1/businesses").param("q", "%")).andExpect(jsonPath("$.total", is(0)));
    }

    @Test
    void listsArePagedWithANextOffset() throws Exception {
        String cat = category(null, "Paging");
        for (int i = 0; i < 5; i++) business(cat, "Paged " + i + " " + uniq());
        mvc.perform(get("/v1/businesses").param("categoryId", cat).param("limit", "2")).andExpect(jsonPath("$.total", is(5))).andExpect(jsonPath("$.items", hasSize(2))).andExpect(jsonPath("$.nextOffset", is(2)));
        mvc.perform(get("/v1/businesses").param("categoryId", cat).param("limit", "2").param("offset", "4")).andExpect(jsonPath("$.items", hasSize(1))).andExpect(jsonPath("$.nextOffset").doesNotExist());
    }

    @Test
    void theDetailMatchesWhatTheAppExpects() throws Exception {
        String cat = category(null, "Detail");
        String biz = business(cat, "Detail place");
        mvc.perform(get("/v1/businesses/" + biz)).andExpect(status().isOk())
                .andExpect(jsonPath("$.id", is(biz))).andExpect(jsonPath("$.primaryCategoryId", is(cat))).andExpect(jsonPath("$.categoryNames[0].primary", is(true)))
                .andExpect(jsonPath("$.location.lat", is(17.43))).andExpect(jsonPath("$.hours", hasSize(7))).andExpect(jsonPath("$.hours[0].day", is("Monday")))
                .andExpect(jsonPath("$.hours[6].hours", is("Closed"))).andExpect(jsonPath("$.status.label").exists()).andExpect(jsonPath("$.verified", is(true)))
                .andExpect(jsonPath("$.branches", hasSize(0))).andExpect(jsonPath("$.priceLevel", is(2))).andExpect(jsonPath("$.costForTwo", is(120000)));
        mvc.perform(get("/v1/businesses/" + UUID.randomUUID())).andExpect(status().isNotFound()).andExpect(jsonPath("$.code", is("not_found")));
        mvc.perform(get("/v1/businesses/not-an-id")).andExpect(status().isNotFound());
    }

    @Test
    void inactiveBusinessesAreHiddenFromCustomers() throws Exception {
        String cat = category(null, "Hidden");
        String biz = business(cat, "Hidden place");
        String body = """
            {"primaryCategoryId":"%s","categoryIds":["%s"],"verified":true,"active":false,
             "profile":{"name":"Hidden place","area":"Jubilee Hills"}}""".formatted(cat, cat);
        mvc.perform(as(adminToken(), put("/v1/admin/businesses/" + biz)).content(body)).andExpect(status().isOk()).andExpect(jsonPath("$.active", is(false)));
        mvc.perform(get("/v1/businesses/" + biz)).andExpect(status().isNotFound());
        mvc.perform(get("/v1/businesses").param("categoryId", cat)).andExpect(jsonPath("$.total", is(0)));
        mvc.perform(as(adminToken(), get("/v1/admin/businesses/" + biz))).andExpect(status().isOk());
    }

    @Test
    void businessProfilesAreValidated() throws Exception {
        String cat = category(null, "Validate");
        String bad = """
            {"primaryCategoryId":"%s","profile":{"name":"X","area":"Y","logoUrl":"javascript:alert(1)","priceLevel":9,
             "hours":[{"dow":0,"opens":"25:00","closes":"22:00"}]}}""".formatted(cat);
        mvc.perform(as(adminToken(), post("/v1/admin/businesses")).content(bad)).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code", is("validation")));
        String oneSided = """
            {"primaryCategoryId":"%s","profile":{"name":"X","area":"Y","hours":[{"dow":0,"opens":"09:00"}]}}""".formatted(cat);
        mvc.perform(as(adminToken(), post("/v1/admin/businesses")).content(oneSided)).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code", is("hours")));
        String noCat = "{\"primaryCategoryId\":\"" + UUID.randomUUID() + "\",\"profile\":{\"name\":\"X\",\"area\":\"Y\"}}";
        mvc.perform(as(adminToken(), post("/v1/admin/businesses")).content(noCat)).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code", is("category")));
    }

    // ---------- merchants ----------
    @Test
    void aMerchantSeesAndEditsOnlyTheirOwnBusiness() throws Exception {
        String cat = category(null, "Merchant scope");
        String bizA = business(cat, "Scope A");
        String bizB = business(cat, "Scope B");
        String tokenA = merchant(bizA);
        String tokenB = merchant(bizB);

        mvc.perform(as(tokenA, get("/v1/merchant/business"))).andExpect(jsonPath("$.id", is(bizA)));
        mvc.perform(as(tokenB, get("/v1/merchant/business"))).andExpect(jsonPath("$.id", is(bizB)));

        // The business is never read from the request, so a merchant cannot reach another one.
        String itemB = id(mvc.perform(as(tokenB, post("/v1/merchant/menu")).content("{\"name\":\"B dish\",\"price\":10000}")).andExpect(status().isCreated()).andReturn());
        mvc.perform(as(tokenA, put("/v1/merchant/menu/" + itemB)).content("{\"name\":\"Hijacked\",\"price\":1}")).andExpect(status().isNotFound());
        mvc.perform(as(tokenA, delete("/v1/merchant/menu/" + itemB))).andExpect(status().isNotFound());
        mvc.perform(as(tokenB, get("/v1/merchant/menu"))).andExpect(jsonPath("$[0].name", is("B dish")));
        mvc.perform(as(tokenA, get("/v1/merchant/menu"))).andExpect(jsonPath("$", hasSize(0)));
    }

    @Test
    void aMerchantCannotChangeWhatOnlyVibeControls() throws Exception {
        String cat = category(null, "Merchant limits");
        String biz = business(cat, "Limits place");
        String token = merchant(biz);
        String body = """
            {"name":"Limits place renamed","area":"Madhapur","verified":false,"active":false,"primaryCategoryId":"%s","description":"Great food"}""".formatted(UUID.randomUUID());
        mvc.perform(as(token, put("/v1/merchant/business")).content(body)).andExpect(status().isOk())
                .andExpect(jsonPath("$.name", is("Limits place renamed"))).andExpect(jsonPath("$.area", is("Madhapur")))
                .andExpect(jsonPath("$.verified", is(true))).andExpect(jsonPath("$.active", is(true))).andExpect(jsonPath("$.primaryCategoryId", is(cat)));
    }

    @Test
    void menuItemsAppearOnThePublicPageAndAreGroupedBySection() throws Exception {
        String cat = category(null, "Menu");
        String biz = business(cat, "Menu place");
        String token = merchant(biz);
        mvc.perform(as(token, post("/v1/merchant/menu")).content("{\"name\":\"Biryani\",\"note\":\"Dum\",\"price\":48000,\"section\":\"Mains\",\"sortOrder\":1}")).andExpect(status().isCreated());
        mvc.perform(as(token, post("/v1/merchant/menu")).content("{\"name\":\"Hidden item\",\"price\":100,\"active\":false}")).andExpect(status().isCreated());
        mvc.perform(as(token, post("/v1/merchant/menu")).content("{\"name\":\"Free\",\"price\":-1}")).andExpect(status().isBadRequest());
        mvc.perform(get("/v1/businesses/" + biz)).andExpect(jsonPath("$.menu", hasSize(1))).andExpect(jsonPath("$.menu[0].section", is("Mains"))).andExpect(jsonPath("$.menu[0].price", is(48000)));
    }

    // ---------- offers ----------
    @Test
    void offersAreValidatedBeforeTheyCanGoLive() throws Exception {
        String biz = business(category(null, "Offer rules"), "Offer rules place");
        String token = merchant(biz);
        String when = "\"startsAt\":\"2026-01-01T00:00:00Z\",\"endsAt\":\"2030-01-01T00:00:00Z\"";
        mvc.perform(as(token, post("/v1/merchant/offers")).content("{\"title\":\"x\",\"kind\":\"percentage\"," + when + "}")).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code", is("offer_rule")));
        mvc.perform(as(token, post("/v1/merchant/offers")).content("{\"title\":\"x\",\"kind\":\"percentage\",\"rateBps\":9500," + when + "}")).andExpect(status().isBadRequest());
        mvc.perform(as(token, post("/v1/merchant/offers")).content("{\"title\":\"x\",\"kind\":\"flat\"," + when + "}")).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code", is("offer_rule")));
        mvc.perform(as(token, post("/v1/merchant/offers")).content("{\"title\":\"x\",\"kind\":\"flat\",\"flatAmount\":50000,\"minBill\":10000," + when + "}")).andExpect(status().isBadRequest());
        mvc.perform(as(token, post("/v1/merchant/offers")).content("{\"title\":\"x\",\"kind\":\"flat\",\"flatAmount\":100,\"rateBps\":1000," + when + "}")).andExpect(status().isBadRequest());
        mvc.perform(as(token, post("/v1/merchant/offers")).content("{\"title\":\"x\",\"kind\":\"flat\",\"flatAmount\":100,\"startsAt\":\"2030-01-01T00:00:00Z\",\"endsAt\":\"2029-01-01T00:00:00Z\"}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code", is("offer_dates")));
        mvc.perform(as(token, post("/v1/merchant/offers")).content("{\"title\":\"x\",\"kind\":\"bogo\",\"flatAmount\":100," + when + "}")).andExpect(status().isBadRequest());
    }

    @Test
    void liveApprovedOffersShowOnTheBusinessWithAHeadlineAndExpiredOnesDoNot() throws Exception {
        String biz = business(category(null, "Offer live"), "Offer live place");
        String token = merchant(biz);
        String live = id(mvc.perform(as(token, post("/v1/merchant/offers")).content("""
            {"title":"Members save 30%","kind":"percentage","rateBps":3000,"maxDiscount":50000,"minBill":50000,"memberOnly":true,
             "startsAt":"2026-01-01T00:00:00Z","endsAt":"2030-01-01T00:00:00Z"}""")).andExpect(status().isCreated())
                .andExpect(jsonPath("$.rateBps", is(3000))).andExpect(jsonPath("$.reviewStatus", is("pending"))).andReturn());
        String old = id(mvc.perform(as(token, post("/v1/merchant/offers")).content("""
            {"title":"Old deal","kind":"flat","flatAmount":10000,"startsAt":"2020-01-01T00:00:00Z","endsAt":"2021-01-01T00:00:00Z"}""")).andExpect(status().isCreated()).andReturn());
        // Nothing is shown to customers until VIBE approves it.
        mvc.perform(get("/v1/businesses/" + biz)).andExpect(jsonPath("$.offers", hasSize(0))).andExpect(jsonPath("$.hasMemberOffer", is(false)));
        mvc.perform(as(adminToken(), post("/v1/admin/offers/" + live + "/approve"))).andExpect(status().isOk());
        mvc.perform(as(adminToken(), post("/v1/admin/offers/" + old + "/approve"))).andExpect(status().isOk());
        mvc.perform(get("/v1/businesses/" + biz)).andExpect(jsonPath("$.offers", hasSize(1))).andExpect(jsonPath("$.offers[0].headline", is("30%")))
                .andExpect(jsonPath("$.offers[0].memberOnly", is(true))).andExpect(jsonPath("$.offers[0].maxDiscount", is(50000))).andExpect(jsonPath("$.hasMemberOffer", is(true)))
                .andExpect(jsonPath("$.offerBadge", is("30% off")));
        mvc.perform(as(token, get("/v1/merchant/offers"))).andExpect(jsonPath("$", hasSize(2)));
    }

    @Test
    void aMerchantCannotTouchAnotherBusinessesOffer() throws Exception {
        String cat = category(null, "Offer scope");
        String tokenA = merchant(business(cat, "Offer scope A"));
        String tokenB = merchant(business(cat, "Offer scope B"));
        String offer = id(mvc.perform(as(tokenB, post("/v1/merchant/offers")).content("{\"title\":\"B offer\",\"kind\":\"flat\",\"flatAmount\":5000,\"startsAt\":\"2026-01-01T00:00:00Z\",\"endsAt\":\"2030-01-01T00:00:00Z\"}"))
                .andExpect(status().isCreated()).andReturn());
        mvc.perform(as(tokenA, put("/v1/merchant/offers/" + offer)).content("{\"title\":\"x\",\"kind\":\"flat\",\"flatAmount\":1,\"startsAt\":\"2026-01-01T00:00:00Z\",\"endsAt\":\"2030-01-01T00:00:00Z\"}")).andExpect(status().isNotFound());
        mvc.perform(as(tokenA, delete("/v1/merchant/offers/" + offer))).andExpect(status().isNotFound());
        mvc.perform(as(tokenB, delete("/v1/merchant/offers/" + offer))).andExpect(status().isNoContent());
    }

    // ---------- audit ----------
    @Test
    void changesAreWrittenToTheAuditTrail() throws Exception {
        String cat = category(null, "Audit");
        mvc.perform(as(adminToken(), get("/v1/admin/audit")).param("limit", "20")).andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.entity=='category' && @.entityId=='" + cat + "')].action", hasItem("create")))
                .andExpect(jsonPath("$[0].actorRole", not(is("SYSTEM"))));
    }
}
