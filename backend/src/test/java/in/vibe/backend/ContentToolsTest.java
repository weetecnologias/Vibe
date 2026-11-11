package in.vibe.backend;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MvcResult;

import java.time.OffsetDateTime;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Offer review, plans, coupons, home content, events, reservation settings, merchant team and image upload. */
class ContentToolsTest extends ApiTestSupport {
    static String in(int days) { return OffsetDateTime.now().plusDays(days).withNano(0).toString(); }

    String offer(String token, String title) throws Exception {
        return id(mvc.perform(as(token, post("/v1/merchant/offers")).content("""
            {"title":"%s","kind":"flat","flatAmount":10000,"minBill":50000,"startsAt":"2026-01-01T00:00:00Z","endsAt":"2031-01-01T00:00:00Z"}""".formatted(title)))
                .andExpect(status().isCreated()).andReturn());
    }

    String event(String token, String title, int daysAhead) throws Exception {
        return id(mvc.perform(as(token, post("/v1/merchant/events")).content(eventJson(title, daysAhead))).andExpect(status().isCreated()).andReturn());
    }

    static String eventJson(String title, int daysAhead) {
        return """
            {"title":"%s","kind":"Workshops","description":"Hands-on","venue":"Test venue","area":"Jubilee Hills","startsAt":"%s",
             "ticketTypes":[{"name":"General","description":"","price":50000,"capacity":40,"maxPerOrder":4},{"name":"VIP","price":90000,"capacity":10}]}""".formatted(title, in(daysAhead));
    }

    // ---------- offer review ----------
    @Test
    void aMerchantOfferGoesLiveOnlyAfterApprovalAndAnEditSendsItBack() throws Exception {
        String biz = business(category(null, "Review"), "Review place " + uniq());
        String token = merchant(biz);
        String id = offer(token, "Review me");

        mvc.perform(as(adminToken(), get("/v1/admin/offers")).param("status", "pending")).andExpect(jsonPath("$[?(@.id=='" + id + "')].businessName", hasItem(org.hamcrest.Matchers.startsWith("Review place"))));
        mvc.perform(get("/v1/businesses/" + biz)).andExpect(jsonPath("$.offers", hasSize(0)));

        mvc.perform(as(adminToken(), post("/v1/admin/offers/" + id + "/approve"))).andExpect(status().isOk()).andExpect(jsonPath("$.reviewStatus", is("approved")));
        mvc.perform(get("/v1/businesses/" + biz)).andExpect(jsonPath("$.offers", hasSize(1)));

        // Switching it off keeps the approval. Changing what it is sends it back for review and takes it off the public page.
        String body = """
            {"title":"%s","kind":"flat","flatAmount":10000,"minBill":50000,"startsAt":"2026-01-01T00:00:00Z","endsAt":"2031-01-01T00:00:00Z","active":%s}""";
        mvc.perform(as(token, put("/v1/merchant/offers/" + id)).content(body.formatted("Review me", "false"))).andExpect(jsonPath("$.reviewStatus", is("approved")));
        mvc.perform(as(token, put("/v1/merchant/offers/" + id)).content(body.formatted("Review me", "true"))).andExpect(jsonPath("$.reviewStatus", is("approved")));
        mvc.perform(as(token, put("/v1/merchant/offers/" + id)).content(body.formatted("Review me, bigger", "true"))).andExpect(jsonPath("$.reviewStatus", is("pending")));
        mvc.perform(get("/v1/businesses/" + biz)).andExpect(jsonPath("$.offers", hasSize(0)));
    }

    @Test
    void rejectingAnOfferNeedsAReasonAndTheMerchantSeesIt() throws Exception {
        String biz = business(category(null, "Reject"), "Reject place " + uniq());
        String token = merchant(biz);
        String id = offer(token, "Too generous");
        mvc.perform(as(adminToken(), post("/v1/admin/offers/" + id + "/reject")).content("{\"note\":\"  \"}")).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code", is("note_required")));
        mvc.perform(as(adminToken(), post("/v1/admin/offers/" + id + "/reject")).content("{\"note\":\"Lower the discount to 20%\"}")).andExpect(status().isOk()).andExpect(jsonPath("$.reviewStatus", is("rejected")));
        mvc.perform(as(token, get("/v1/merchant/offers"))).andExpect(jsonPath("$[0].reviewStatus", is("rejected"))).andExpect(jsonPath("$[0].reviewNote", is("Lower the discount to 20%")));
        mvc.perform(get("/v1/businesses/" + biz)).andExpect(jsonPath("$.offers", hasSize(0)));
        // Merchants can't approve their own offers.
        mvc.perform(as(token, post("/v1/admin/offers/" + id + "/approve"))).andExpect(status().isForbidden());
    }

    // ---------- membership plans ----------
    @Test
    void plansAreManagedByAdminsAndOnlyActiveOnesAreShown() throws Exception {
        String name = "Plan " + uniq();
        String id = id(mvc.perform(as(adminToken(), post("/v1/admin/plans")).content("{\"name\":\"" + name + "\",\"interval\":\"month\",\"price\":29900,\"benefits\":[\"A\",\"B\"],\"sortOrder\":99}"))
                .andExpect(status().isCreated()).andReturn());
        mvc.perform(get("/v1/membership/plans")).andExpect(jsonPath("$[?(@.id=='" + id + "')].price", hasItem(29900))).andExpect(jsonPath("$[?(@.id=='" + id + "')].benefits[0]", hasItem("A")));
        mvc.perform(as(adminToken(), put("/v1/admin/plans/" + id)).content("{\"name\":\"" + name + "\",\"interval\":\"month\",\"price\":29900,\"active\":false}")).andExpect(status().isOk());
        mvc.perform(get("/v1/membership/plans")).andExpect(jsonPath("$[?(@.id=='" + id + "')]", hasSize(0)));
        mvc.perform(as(adminToken(), get("/v1/admin/plans"))).andExpect(jsonPath("$[?(@.id=='" + id + "')].active", hasItem(false)));
        mvc.perform(as(adminToken(), post("/v1/admin/plans")).content("{\"name\":\"x\",\"interval\":\"week\",\"price\":100}")).andExpect(status().isBadRequest());
        mvc.perform(as(adminToken(), post("/v1/admin/plans")).content("{\"name\":\"x\",\"interval\":\"month\",\"price\":-1}")).andExpect(status().isBadRequest());
        mvc.perform(as(adminToken(), delete("/v1/admin/plans/" + id))).andExpect(status().isNoContent());
        mvc.perform(as(merchant(business(category(null, "Plans"), "Plans place " + uniq())), post("/v1/admin/plans")).content("{}")).andExpect(status().isForbidden());
    }

    // ---------- checkout coupons ----------
    @Test
    void couponsAreValidatedAndCodesAreUnique() throws Exception {
        String code = "SAVE" + uniq().substring(0, 4).toUpperCase().replaceAll("[^A-Z0-9]", "X");
        String ok = """
            {"code":"%s","title":"Save","kinds":["movie"],"kind":"flat","flatAmount":5000,"minBill":25000,"startsAt":"2026-01-01T00:00:00Z","endsAt":"2031-01-01T00:00:00Z"}""";
        MvcResult r = mvc.perform(as(adminToken(), post("/v1/admin/coupons")).content(ok.formatted(code.toLowerCase()))).andExpect(status().isCreated()).andExpect(jsonPath("$.code", is(code))).andReturn();
        mvc.perform(as(adminToken(), post("/v1/admin/coupons")).content(ok.formatted(code))).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("duplicate")));
        mvc.perform(as(adminToken(), post("/v1/admin/coupons")).content(ok.formatted("a b"))).andExpect(status().isBadRequest());
        mvc.perform(as(adminToken(), post("/v1/admin/coupons")).content(ok.formatted("X" + code).replace("\"movie\"", "\"membership\""))).andExpect(status().isBadRequest());
        mvc.perform(as(adminToken(), post("/v1/admin/coupons")).content(ok.formatted("Y" + code).replace("\"flatAmount\":5000", "\"flatAmount\":50000"))).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code", is("offer_rule")));
        mvc.perform(as(adminToken(), get("/v1/admin/coupons"))).andExpect(jsonPath("$[?(@.code=='" + code + "')]", hasSize(1)));
        // Not public: applying a coupon is part of checkout, which needs a signed-in customer.
        mvc.perform(get("/v1/coupons")).andExpect(status().isUnauthorized());
        mvc.perform(as(adminToken(), delete("/v1/admin/coupons/" + JsonPath.read(r.getResponse().getContentAsString(), "$.id")))).andExpect(status().isNoContent());
    }

    // ---------- home content ----------
    @Test
    void bannersMustPointSomewhereRealAndOnlyLiveOnesReachTheHomeFeed() throws Exception {
        String cat = category(null, "Banner cat");
        String live = id(mvc.perform(as(adminToken(), post("/v1/admin/home/banners")).content("{\"title\":\"Live banner\",\"targetType\":\"category\",\"targetId\":\"" + cat + "\",\"sortOrder\":1}"))
                .andExpect(status().isCreated()).andReturn());
        String later = id(mvc.perform(as(adminToken(), post("/v1/admin/home/banners")).content("{\"title\":\"Later banner\",\"targetType\":\"events\",\"startsAt\":\"" + in(5) + "\"}"))
                .andExpect(status().isCreated()).andReturn());
        mvc.perform(get("/v1/home")).andExpect(status().isOk()).andExpect(jsonPath("$.banners[?(@.id=='" + live + "')].target.type", hasItem("category")))
                .andExpect(jsonPath("$.banners[?(@.id=='" + later + "')]", hasSize(0)));
        mvc.perform(as(adminToken(), get("/v1/admin/home/banners"))).andExpect(jsonPath("$[?(@.id=='" + later + "')].liveNow", hasItem(false)));

        mvc.perform(as(adminToken(), post("/v1/admin/home/banners")).content("{\"title\":\"Bad\",\"targetType\":\"category\",\"targetId\":\"" + java.util.UUID.randomUUID() + "\"}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code", is("banner_target")));
        mvc.perform(as(adminToken(), post("/v1/admin/home/banners")).content("{\"title\":\"Bad\",\"targetType\":\"offer\"}")).andExpect(status().isBadRequest());
        mvc.perform(as(adminToken(), post("/v1/admin/home/banners")).content("{\"title\":\"Bad\",\"targetType\":\"events\",\"startsAt\":\"" + in(5) + "\",\"endsAt\":\"" + in(2) + "\"}")).andExpect(status().isBadRequest());
        mvc.perform(as(adminToken(), delete("/v1/admin/home/banners/" + later))).andExpect(status().isNoContent());
    }

    @Test
    void onlyLiveOffersCanBePinnedAndThePinOrderIsKept() throws Exception {
        String biz = business(category(null, "Pins"), "Pins place " + uniq());
        String token = merchant(biz);
        String a = offer(token, "Pin A"), b = offer(token, "Pin B");
        // Not approved yet: can't be pinned.
        mvc.perform(as(adminToken(), put("/v1/admin/home/picks/offers")).content("{\"ids\":[\"" + a + "\"]}")).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code", is("picks")));
        mvc.perform(as(adminToken(), post("/v1/admin/offers/" + a + "/approve"))).andExpect(status().isOk());
        mvc.perform(as(adminToken(), post("/v1/admin/offers/" + b + "/approve"))).andExpect(status().isOk());
        mvc.perform(as(adminToken(), put("/v1/admin/home/picks/offers")).content("{\"ids\":[\"" + b + "\",\"" + a + "\"]}")).andExpect(status().isOk()).andExpect(jsonPath("$[0].id", is(b))).andExpect(jsonPath("$[1].id", is(a)));
        mvc.perform(get("/v1/home")).andExpect(jsonPath("$.offers[0].id", is(b))).andExpect(jsonPath("$.offers[1].id", is(a)));
        mvc.perform(get("/v1/offers").param("view", "trending")).andExpect(jsonPath("$[0].id", is(b)));
        // Rules: no duplicates, no unknown sections, at most 12.
        mvc.perform(as(adminToken(), put("/v1/admin/home/picks/offers")).content("{\"ids\":[\"" + a + "\",\"" + a + "\"]}")).andExpect(status().isBadRequest());
        mvc.perform(as(adminToken(), put("/v1/admin/home/picks/nope")).content("{\"ids\":[]}")).andExpect(status().isNotFound());
        String many = IntStream.range(0, 13).mapToObj(i -> "\"" + java.util.UUID.randomUUID() + "\"").collect(Collectors.joining(","));
        mvc.perform(as(adminToken(), put("/v1/admin/home/picks/trending")).content("{\"ids\":[" + many + "]}")).andExpect(status().isBadRequest());
        // Clearing the pins falls back to automatic picks.
        mvc.perform(as(adminToken(), put("/v1/admin/home/picks/offers")).content("{\"ids\":[]}")).andExpect(status().isOk()).andExpect(jsonPath("$", hasSize(0)));
        mvc.perform(get("/v1/home")).andExpect(status().isOk());
    }

    // ---------- events ----------
    @Test
    void aMerchantEventIsPublishedOnlyAfterVibeApprovesIt() throws Exception {
        String biz = business(category(null, "Events"), "Events place " + uniq());
        String token = merchant(biz);
        String title = "Masterclass " + uniq();
        String id = event(token, title, 10);

        mvc.perform(as(token, get("/v1/merchant/events/" + id))).andExpect(jsonPath("$.status", is("pending"))).andExpect(jsonPath("$.ticketTypes", hasSize(2))).andExpect(jsonPath("$.organiser", containsString("Events place")));
        mvc.perform(get("/v1/events")).andExpect(jsonPath("$[?(@.id=='" + id + "')]", hasSize(0)));
        mvc.perform(get("/v1/events/" + id)).andExpect(status().isNotFound());

        mvc.perform(as(adminToken(), post("/v1/admin/events/" + id + "/reject")).content("{}")).andExpect(status().isBadRequest());
        mvc.perform(as(adminToken(), post("/v1/admin/events/" + id + "/approve"))).andExpect(status().isOk()).andExpect(jsonPath("$.status", is("published")));
        mvc.perform(get("/v1/events")).andExpect(jsonPath("$[?(@.id=='" + id + "')].fromPrice", hasItem(50000)));
        mvc.perform(get("/v1/events/" + id)).andExpect(status().isOk()).andExpect(jsonPath("$.title", is(title))).andExpect(jsonPath("$.ticketTypes[0].name", is("General")))
                .andExpect(jsonPath("$.ticketTypes[0].remaining", is(40))).andExpect(jsonPath("$.ticketTypes[0].maxPerOrder", is(4))).andExpect(jsonPath("$.gatesOpenAt").exists());

        // Editing a published event sends it back for review and takes it off the public list.
        mvc.perform(as(token, put("/v1/merchant/events/" + id)).content(eventJson(title + " (new date)", 12))).andExpect(status().isOk()).andExpect(jsonPath("$.status", is("pending")));
        mvc.perform(get("/v1/events/" + id)).andExpect(status().isNotFound());

        mvc.perform(as(adminToken(), post("/v1/admin/events/" + id + "/reject")).content("{\"note\":\"Add a venue address\"}")).andExpect(jsonPath("$.status", is("rejected"))).andExpect(jsonPath("$.reviewNote", is("Add a venue address")));
        mvc.perform(as(token, post("/v1/merchant/events/" + id + "/cancel"))).andExpect(jsonPath("$.status", is("cancelled")));
        mvc.perform(as(token, put("/v1/merchant/events/" + id)).content(eventJson(title, 12))).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("cancelled")));
    }

    @Test
    void aMerchantSeesOnlyTheirOwnEventsAndAdminEventsPublishAtOnce() throws Exception {
        String cat = category(null, "Event scope");
        String tokenA = merchant(business(cat, "Event A " + uniq()));
        String tokenB = merchant(business(cat, "Event B " + uniq()));
        String id = event(tokenA, "A only " + uniq(), 8);
        mvc.perform(as(tokenB, get("/v1/merchant/events/" + id))).andExpect(status().isNotFound());
        mvc.perform(as(tokenB, put("/v1/merchant/events/" + id)).content(eventJson("Hijack", 9))).andExpect(status().isNotFound());
        mvc.perform(as(tokenB, post("/v1/merchant/events/" + id + "/cancel"))).andExpect(status().isNotFound());
        mvc.perform(as(tokenB, get("/v1/merchant/events"))).andExpect(jsonPath("$[?(@.id=='" + id + "')]", hasSize(0)));
        mvc.perform(as(tokenA, get("/v1/merchant/events"))).andExpect(jsonPath("$[?(@.id=='" + id + "')]", hasSize(1)));

        String adminId = id(mvc.perform(as(adminToken(), post("/v1/admin/events")).content(eventJson("VIBE night " + uniq(), 9).replace("\"venue\"", "\"organiser\":\"VIBE Hosts\",\"featured\":true,\"venue\""))).andExpect(status().isCreated())
                .andExpect(jsonPath("$.status", is("published"))).andReturn());
        mvc.perform(get("/v1/events/" + adminId)).andExpect(status().isOk()).andExpect(jsonPath("$.organiser", is("VIBE Hosts"))).andExpect(jsonPath("$.featured", is(true)));
    }

    @Test
    void eventDetailsAreValidated() throws Exception {
        String token = merchant(business(category(null, "Event rules"), "Event rules " + uniq()));
        mvc.perform(as(token, post("/v1/merchant/events")).content(eventJson("Past", -2))).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code", is("event_dates")));
        mvc.perform(as(token, post("/v1/merchant/events")).content(eventJson("Soon", 0).replace(in(0), OffsetDateTime.now().plusMinutes(20).withNano(0).toString()))).andExpect(status().isBadRequest());
        mvc.perform(as(token, post("/v1/merchant/events")).content(eventJson("x", 5).replace("\"venue\"", "\"gatesOpenAt\":\"" + in(9) + "\",\"venue\""))).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code", is("event_dates")));
        mvc.perform(as(token, post("/v1/merchant/events")).content(eventJson("x", 5).replace("\"VIP\"", "\"general\""))).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code", is("ticket_types")));
        mvc.perform(as(token, post("/v1/merchant/events")).content(eventJson("x", 5).replace("Workshops", "Parties"))).andExpect(status().isBadRequest());
        mvc.perform(as(token, post("/v1/merchant/events")).content(eventJson("x", 5).replace("50000", "-5"))).andExpect(status().isBadRequest());
        mvc.perform(as(token, post("/v1/merchant/events")).content(eventJson("x", 5).replaceAll("\"ticketTypes\":\\[.*\\]", "\"ticketTypes\":[]"))).andExpect(status().isBadRequest());
    }

    // ---------- reservation settings ----------
    @Test
    void reservationsNeedAFeeAndAPolicyBeforeTheyCanBeTurnedOn() throws Exception {
        String token = merchant(business(category(null, "Reserve"), "Reserve place " + uniq()));
        mvc.perform(as(token, get("/v1/merchant/reservation-settings"))).andExpect(jsonPath("$.enabled", is(false)));
        mvc.perform(as(token, put("/v1/merchant/reservation-settings")).content("{\"enabled\":true,\"policy\":\"Refunded up to 2 hours before.\"}")).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code", is("fees")));
        mvc.perform(as(token, put("/v1/merchant/reservation-settings")).content("{\"enabled\":true,\"tableFee\":20000}")).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code", is("policy")));
        mvc.perform(as(token, put("/v1/merchant/reservation-settings")).content("{\"enabled\":true,\"tableFee\":-5,\"policy\":\"Refunded up to 2 hours before.\"}")).andExpect(status().isBadRequest());
        mvc.perform(as(token, put("/v1/merchant/reservation-settings")).content("{\"enabled\":true,\"tableFee\":20000,\"slotFee\":30000,\"policy\":\"Refunded up to 2 hours before.\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.enabled", is(true))).andExpect(jsonPath("$.tableFee", is(20000)));
        mvc.perform(as(token, put("/v1/merchant/reservation-settings")).content("{\"enabled\":false}")).andExpect(jsonPath("$.enabled", is(false)));
    }

    // ---------- merchant team ----------
    @Test
    void onlyTheOwnerManagesTheTeamAndOnlyForTheirOwnBusiness() throws Exception {
        String cat = category(null, "Team");
        String bizA = business(cat, "Team A " + uniq());
        String ownerA = merchant(bizA);
        String ownerB = merchant(business(cat, "Team B " + uniq()));
        String email = "staff-" + uniq() + "@test.local";

        mvc.perform(as(ownerA, get("/v1/merchant/team"))).andExpect(jsonPath("$", hasSize(1))).andExpect(jsonPath("$[0].owner", is(true)));
        String staffId = id(mvc.perform(as(ownerA, post("/v1/merchant/team")).content("{\"email\":\"" + email + "\",\"name\":\"Waiter\",\"password\":\"" + PASSWORD + "\"}")).andExpect(status().isCreated())
                .andExpect(jsonPath("$.owner", is(false))).andExpect(jsonPath("$.businessId", is(bizA))).andReturn());
        mvc.perform(as(ownerA, post("/v1/merchant/team")).content("{\"email\":\"" + email + "\",\"name\":\"Dup\",\"password\":\"" + PASSWORD + "\"}")).andExpect(status().isConflict());
        mvc.perform(as(ownerA, post("/v1/merchant/team")).content("{\"email\":\"s2-" + uniq() + "@test.local\",\"name\":\"Short\",\"password\":\"short\"}")).andExpect(status().isBadRequest());

        // Staff can sign in and work on the business, but can't add people.
        String staffToken = signInSettled(email, PASSWORD);
        mvc.perform(as(staffToken, get("/v1/merchant/business"))).andExpect(jsonPath("$.id", is(bizA)));
        mvc.perform(as(staffToken, post("/v1/merchant/team")).content("{\"email\":\"s3-" + uniq() + "@test.local\",\"name\":\"X\",\"password\":\"" + PASSWORD + "\"}")).andExpect(status().isForbidden());
        mvc.perform(as(staffToken, post("/v1/merchant/team/" + staffId + "/deactivate"))).andExpect(status().isForbidden());

        // Another business's owner can't see or touch this team.
        mvc.perform(as(ownerB, get("/v1/merchant/team"))).andExpect(jsonPath("$[?(@.id=='" + staffId + "')]", hasSize(0)));
        mvc.perform(as(ownerB, post("/v1/merchant/team/" + staffId + "/deactivate"))).andExpect(status().isNotFound());
        mvc.perform(as(ownerB, put("/v1/merchant/team/" + staffId + "/password")).content("{\"password\":\"another-long-pass\"}")).andExpect(status().isNotFound());

        // The owner can reset the password and switch the person off, but not themselves.
        mvc.perform(as(ownerA, put("/v1/merchant/team/" + staffId + "/password")).content("{\"password\":\"a-new-long-password\"}")).andExpect(status().isNoContent());
        login(email, "a-new-long-password");
        mvc.perform(as(ownerA, post("/v1/merchant/team/" + staffId + "/deactivate"))).andExpect(status().isNoContent());
        mvc.perform(post("/v1/staff/login").contentType(org.springframework.http.MediaType.APPLICATION_JSON).content("{\"email\":\"" + email + "\",\"password\":\"a-new-long-password\"}")).andExpect(status().isUnauthorized());
        String ownerId = JsonPath.read(mvc.perform(as(ownerA, get("/v1/merchant/team"))).andReturn().getResponse().getContentAsString(), "$[0].id");
        mvc.perform(as(ownerA, post("/v1/merchant/team/" + ownerId + "/deactivate"))).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("owner")));
    }

    // ---------- image upload ----------
    static final byte[] PNG = {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0, 'I', 'E', 'N', 'D'};

    @Test
    void realImagesUploadAndAreServedWithTheDetectedType() throws Exception {
        String token = merchant(business(category(null, "Media"), "Media place " + uniq()));
        MvcResult r = mvc.perform(multipart("/v1/media").file(new MockMultipartFile("file", "logo.png", "image/png", PNG)).header("Authorization", "Bearer " + token))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.url", containsString("/media/"))).andExpect(jsonPath("$.url", org.hamcrest.Matchers.endsWith(".png"))).andReturn();
        String url = JsonPath.read(r.getResponse().getContentAsString(), "$.url");
        String path = url.substring(url.indexOf("/media/"));
        mvc.perform(get(path)).andExpect(status().isOk()).andExpect(content().contentType("image/png")).andExpect(header().string("X-Content-Type-Options", "nosniff")).andExpect(content().bytes(PNG));
        // The saved link is accepted wherever the dashboards take an image link.
        mvc.perform(as(adminToken(), post("/v1/admin/categories")).content("{\"slug\":\"icon-" + uniq() + "\",\"name\":\"With uploaded icon\",\"iconUrl\":\"" + url + "\"}")).andExpect(status().isCreated());
    }

    @Test
    void onlyRealImagesAreAcceptedWhateverTheyAreCalled() throws Exception {
        String token = merchant(business(category(null, "Media rules"), "Media rules " + uniq()));
        // A script or page renamed to .png, and an SVG (which can carry scripts), are refused.
        mvc.perform(multipart("/v1/media").file(new MockMultipartFile("file", "evil.png", "image/png", "<script>alert(1)</script>".getBytes())).header("Authorization", "Bearer " + token))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code", is("not_an_image")));
        mvc.perform(multipart("/v1/media").file(new MockMultipartFile("file", "icon.svg", "image/svg+xml", "<svg xmlns=\"http://www.w3.org/2000/svg\"/>".getBytes())).header("Authorization", "Bearer " + token))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code", is("not_an_image")));
        mvc.perform(multipart("/v1/media").file(new MockMultipartFile("file", "empty.png", "image/png", new byte[0])).header("Authorization", "Bearer " + token)).andExpect(status().isBadRequest());
        mvc.perform(multipart("/v1/media").header("Authorization", "Bearer " + token)).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code", is("no_file")));
        byte[] big = new byte[5 * 1024 * 1024 + 1];
        System.arraycopy(PNG, 0, big, 0, PNG.length);
        mvc.perform(multipart("/v1/media").file(new MockMultipartFile("file", "big.png", "image/png", big)).header("Authorization", "Bearer " + token)).andExpect(status().isContentTooLarge());
    }

    @Test
    void uploadsNeedSignInAndStoredFilesCannotBeGuessedOrWalkedTo() throws Exception {
        mvc.perform(multipart("/v1/media").file(new MockMultipartFile("file", "a.png", "image/png", PNG))).andExpect(status().isUnauthorized());
        mvc.perform(get("/media/not-a-real-file.png")).andExpect(status().isNotFound());
        mvc.perform(get("/media/00000000-0000-0000-0000-000000000000.png")).andExpect(status().isNotFound());
        mvc.perform(get("/media/..%2F..%2Fapplication.yml")).andExpect(status().is4xxClientError());
        mvc.perform(get("/media/" + "a".repeat(36) + ".svg")).andExpect(status().isNotFound());
        mvc.perform(get("/media/x").header("Authorization", "Bearer " + adminToken())).andExpect(status().isNotFound());
    }

    @Test
    void theHomeFeedAlwaysHasEverySection() throws Exception {
        mvc.perform(get("/v1/home")).andExpect(status().isOk()).andExpect(jsonPath("$.banners").isArray()).andExpect(jsonPath("$.trending").isArray()).andExpect(jsonPath("$.offers").isArray())
                .andExpect(jsonPath("$.events").isArray()).andExpect(jsonPath("$.nearby").isArray()).andExpect(jsonPath("$.experiences").isArray()).andExpect(jsonPath("$.activities").isArray())
                .andExpect(jsonPath("$.recentlyAdded").isArray()).andExpect(jsonPath("$.membershipPromo.interval", not(is(""))));
    }
}
