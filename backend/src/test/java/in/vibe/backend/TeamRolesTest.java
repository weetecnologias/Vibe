package in.vibe.backend;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.Test;

import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** The owner decides what each person on the team may do, and the server holds them to it. Also: stopping and deleting offers. */
class TeamRolesTest extends ApiTestSupport {
    static final String MENU_ITEM = "{\"name\":\"Tea\",\"note\":\"\",\"price\":5000,\"section\":\"Drinks\",\"sortOrder\":0,\"active\":true}";

    class Team {
        final String biz = business(category(null, "Roles " + uniq()), "Roles place " + uniq());
        final String owner = merchant(biz);

        Team() throws Exception {}

        /** Adds a member with a role and returns [id, signed-in token]. */
        String[] add(String role, String permissionsJson) throws Exception {
            String email = role + "-" + uniq() + "@test.local";
            String id = id(mvc.perform(as(owner, post("/v1/merchant/team")).content("{\"email\":\"" + email + "\",\"name\":\"" + role + "\",\"password\":\"" + PASSWORD + "\",\"staffRole\":\"" + role + "\""
                    + (permissionsJson == null ? "" : ",\"permissions\":" + permissionsJson) + "}")).andExpect(status().isCreated()).andReturn());
            return new String[]{id, signInSettled(email, PASSWORD)};
        }
    }

    @Test
    void aCashierCanOnlyDoBillsAndTheServerRefusesTheRest() throws Exception {
        Team t = new Team();
        String[] cashier = t.add("cashier", null);
        String c = cashier[1];

        mvc.perform(as(c, get("/v1/merchant/settings"))).andExpect(jsonPath("$.owner", is(false))).andExpect(jsonPath("$.staffRole", is("cashier"))).andExpect(jsonPath("$.permissions", contains("bills")));
        mvc.perform(as(c, get("/v1/merchant/bills"))).andExpect(status().isOk());
        mvc.perform(as(c, get("/v1/merchant/menu"))).andExpect(status().isOk()); // to pick items when raising a bill
        mvc.perform(as(c, post("/v1/merchant/menu")).content(MENU_ITEM)).andExpect(status().isForbidden()).andExpect(jsonPath("$.code", is("no_permission")));
        for (String path : new String[]{"/v1/merchant/offers", "/v1/merchant/events", "/v1/merchant/business", "/v1/merchant/settlements", "/v1/merchant/results", "/v1/merchant/reservation-settings", "/v1/merchant/team"}) {
            mvc.perform(as(c, get(path))).andExpect(status().isForbidden());
        }

        // The owner can do everything.
        mvc.perform(as(t.owner, get("/v1/merchant/settings"))).andExpect(jsonPath("$.owner", is(true))).andExpect(jsonPath("$.permissions", hasItem("money")));
        mvc.perform(as(t.owner, get("/v1/merchant/settlements"))).andExpect(status().isOk());
        mvc.perform(as(t.owner, post("/v1/merchant/menu")).content(MENU_ITEM)).andExpect(status().isCreated());
    }

    @Test
    void aManagerRunsThePlaceButOnlyTheOwnerManagesTheTeam() throws Exception {
        Team t = new Team();
        String m = t.add("manager", null)[1];
        mvc.perform(as(m, get("/v1/merchant/offers"))).andExpect(status().isOk());
        mvc.perform(as(m, get("/v1/merchant/settlements"))).andExpect(status().isOk());
        mvc.perform(as(m, post("/v1/merchant/menu")).content(MENU_ITEM)).andExpect(status().isCreated());
        mvc.perform(as(m, get("/v1/merchant/team"))).andExpect(status().isForbidden());
        mvc.perform(as(m, post("/v1/merchant/team")).content("{\"email\":\"x-" + uniq() + "@test.local\",\"name\":\"X\",\"password\":\"" + PASSWORD + "\",\"staffRole\":\"manager\"}")).andExpect(status().isForbidden());
    }

    @Test
    void theOwnerCanGiveACustomSetOfAreasAndChangeItAtOnce() throws Exception {
        Team t = new Team();
        String[] p = t.add("custom", "[\"bills\",\"offers\"]");
        mvc.perform(as(p[1], get("/v1/merchant/offers"))).andExpect(status().isOk());
        mvc.perform(as(p[1], get("/v1/merchant/settlements"))).andExpect(status().isForbidden());

        // Changed by the owner: applies on the next request, no new sign-in.
        mvc.perform(as(t.owner, put("/v1/merchant/team/" + p[0] + "/access")).content("{\"staffRole\":\"custom\",\"permissions\":[\"money\"]}")).andExpect(status().isOk())
                .andExpect(jsonPath("$.permissions", contains("money")));
        mvc.perform(as(p[1], get("/v1/merchant/settlements"))).andExpect(status().isOk());
        mvc.perform(as(p[1], get("/v1/merchant/offers"))).andExpect(status().isForbidden());

        // A role is required, a custom role needs areas, and unknown areas are refused.
        mvc.perform(as(t.owner, put("/v1/merchant/team/" + p[0] + "/access")).content("{\"staffRole\":\"custom\",\"permissions\":[]}")).andExpect(status().isBadRequest());
        mvc.perform(as(t.owner, put("/v1/merchant/team/" + p[0] + "/access")).content("{\"staffRole\":\"custom\",\"permissions\":[\"everything\"]}")).andExpect(status().isBadRequest());
        mvc.perform(as(t.owner, put("/v1/merchant/team/" + p[0] + "/access")).content("{\"staffRole\":\"boss\"}")).andExpect(status().isBadRequest());

        // The owner's own access can't be limited, and the list shows each person's role.
        String ownerId = JsonPath.read(mvc.perform(as(t.owner, get("/v1/merchant/team"))).andReturn().getResponse().getContentAsString(), "$[0].id");
        mvc.perform(as(t.owner, put("/v1/merchant/team/" + ownerId + "/access")).content("{\"staffRole\":\"cashier\"}")).andExpect(status().isConflict());
        mvc.perform(as(t.owner, get("/v1/merchant/team"))).andExpect(jsonPath("$[0].owner", is(true))).andExpect(jsonPath("$[0].staffRole", nullValue()))
                .andExpect(jsonPath("$[?(@.id=='" + p[0] + "')].staffRole", hasItem("custom")));
    }

    @Test
    void someoneTheOwnerSwitchesOffIsSignedOutOnTheirNextClick() throws Exception {
        Team t = new Team();
        String[] c = t.add("cashier", null);
        mvc.perform(as(c[1], get("/v1/merchant/bills"))).andExpect(status().isOk());
        mvc.perform(as(t.owner, post("/v1/merchant/team/" + c[0] + "/deactivate"))).andExpect(status().isNoContent());
        mvc.perform(as(c[1], get("/v1/merchant/bills"))).andExpect(status().isUnauthorized()); // their token hasn't expired, but they are out
        mvc.perform(as(c[1], get("/v1/merchant/settings"))).andExpect(status().isUnauthorized());
    }

    @Test
    void eachPersonSeesOnlyTheAlertsForWhatTheyDo() throws Exception {
        Team t = new Team();
        String c = t.add("cashier", null)[1];
        String offer = liveOffer(t.owner, false); // the approval sends an offer_decision alert
        String customer = customerToken(phone());
        mvc.perform(as(customer, post("/v1/redemptions")).content("{\"offerId\":\"" + offer + "\"}")).andExpect(status().is2xxSuccessful()); // redeem_started

        mvc.perform(as(c, get("/v1/staff/notifications"))).andExpect(jsonPath("$.items[?(@.kind=='redeem_started')]", hasSize(1))).andExpect(jsonPath("$.items[?(@.kind=='offer_decision')]", hasSize(0)));
        mvc.perform(as(t.owner, get("/v1/staff/notifications"))).andExpect(jsonPath("$.items[?(@.kind=='redeem_started')]", hasSize(1))).andExpect(jsonPath("$.items[?(@.kind=='offer_decision')]", hasSize(1)));

        // A cashier clearing their alerts doesn't clear the owner's offer alert.
        mvc.perform(as(c, post("/v1/staff/notifications/read"))).andExpect(status().is2xxSuccessful());
        mvc.perform(as(t.owner, get("/v1/staff/notifications"))).andExpect(jsonPath("$.items[?(@.kind=='offer_decision')].read", hasItem(false)));
    }

    @Test
    void anOfferCanBeStoppedAndResumedAtOnceAndAUsedOneIsKeptNotDeleted() throws Exception {
        Team t = new Team();
        String offer = liveOffer(t.owner, false);
        mvc.perform(as(t.owner, post("/v1/merchant/offers/" + offer + "/active")).content("{\"active\":false}")).andExpect(status().isOk())
                .andExpect(jsonPath("$.active", is(false))).andExpect(jsonPath("$.reviewStatus", is("approved"))); // no new review
        mvc.perform(get("/v1/offers")).andExpect(jsonPath("$[?(@.id=='" + offer + "')]", hasSize(0)));
        mvc.perform(as(t.owner, post("/v1/merchant/offers/" + offer + "/active")).content("{\"active\":true}")).andExpect(jsonPath("$.active", is(true)));
        mvc.perform(get("/v1/offers")).andExpect(jsonPath("$[?(@.id=='" + offer + "')]", hasSize(1)));

        String customer = customerToken(phone());
        mvc.perform(as(customer, post("/v1/redemptions")).content("{\"offerId\":\"" + offer + "\"}")).andExpect(status().is2xxSuccessful());
        mvc.perform(as(t.owner, delete("/v1/merchant/offers/" + offer))).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("in_use")));
        mvc.perform(as(t.owner, get("/v1/merchant/offers"))).andExpect(jsonPath("$[?(@.id=='" + offer + "')]", not(hasSize(0))));
    }
}
