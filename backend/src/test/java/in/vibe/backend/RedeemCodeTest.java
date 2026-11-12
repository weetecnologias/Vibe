package in.vibe.backend;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.matchesPattern;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** The two ways to redeem: a code shown at the counter (staff confirm, the customer pays the place) or a bill paid in the app. Then a rating. */
class RedeemCodeTest extends ApiTestSupport {
    static final String BILL_1000 = "[{\"label\":\"Dinner\",\"amount\":100000}]";

    /** A place with a merchant and a live 30% offer (cap ₹500, minimum ₹500). */
    class Place {
        final String biz = business(category(null, "Codes " + uniq()), "Codes place " + uniq());
        final String merchant = merchant(biz);
        final String offer = liveOffer(merchant, false);

        Place() throws Exception {}

        String redeem(String customer, String mode) throws Exception {
            return mvc.perform(as(customer, post("/v1/redemptions")).content("{\"offerId\":\"" + offer + "\",\"mode\":\"" + mode + "\"}")).andExpect(status().is2xxSuccessful()).andReturn().getResponse().getContentAsString();
        }
    }

    @Test
    void aCodeIsShownAtTheCounterStaffConfirmItAndNoMoneyGoesThroughVibe() throws Exception {
        Place p = new Place();
        String customer = customerToken(phone());
        String body = p.redeem(customer, "code");
        String id = JsonPath.read(body, "$.id"), code = JsonPath.read(body, "$.code");
        mvc.perform(as(customer, get("/v1/redemptions/" + id))).andExpect(jsonPath("$.status", is("code_issued"))).andExpect(jsonPath("$.mode", is("code")))
                .andExpect(jsonPath("$.code", matchesPattern("\\d{6}"))).andExpect(jsonPath("$.place.name", containsString("Codes place"))).andExpect(jsonPath("$.place.address", is("Road 1")))
                .andExpect(jsonPath("$.place.lat").exists()).andExpect(jsonPath("$.canReview", is(false)));

        // Staff are told, see the code on Bills, and look it up (with the bill, to know the discount to give).
        mvc.perform(as(p.merchant, get("/v1/staff/notifications"))).andExpect(jsonPath("$.items[?(@.kind=='redeem_started')].title", hasItem(containsString(code.substring(0, 3) + " " + code.substring(3)))));
        mvc.perform(as(p.merchant, get("/v1/merchant/bills"))).andExpect(jsonPath("$.rows[0].mode", is("code"))).andExpect(jsonPath("$.rows[0].code", is(code))).andExpect(jsonPath("$.rows[0].status", is("code_issued")));
        mvc.perform(as(p.merchant, post("/v1/merchant/bills/codes/check")).content("{\"code\":\"" + code.substring(0, 3) + " " + code.substring(3) + "\",\"billAmount\":100000}")).andExpect(status().isOk())
                .andExpect(jsonPath("$.id", is(id))).andExpect(jsonPath("$.discount", is(30000))).andExpect(jsonPath("$.customerPays", is(70000)));
        mvc.perform(as(p.merchant, post("/v1/merchant/bills/" + id))).andExpect(status().is4xxClientError()); // a code isn't billed

        // "Yes, redeemed".
        mvc.perform(as(p.merchant, post("/v1/merchant/bills/" + id + "/redeem")).content("{\"billAmount\":100000}")).andExpect(status().isOk()).andExpect(jsonPath("$.discount", is(30000)));
        mvc.perform(as(p.merchant, post("/v1/merchant/bills/" + id + "/redeem")).content("{}")).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("already_redeemed")));
        mvc.perform(as(customer, get("/v1/redemptions/" + id))).andExpect(jsonPath("$.status", is("redeemed"))).andExpect(jsonPath("$.code", nullValue())).andExpect(jsonPath("$.canReview", is(true)));
        mvc.perform(as(customer, get("/v1/me/notifications"))).andExpect(jsonPath("$[?(@.kind=='code_redeemed')].body", hasItem(containsString("You saved ₹300"))));
        mvc.perform(as(customer, get("/v1/offers/" + p.offer + "/eligibility"))).andExpect(jsonPath("$.eligible", is(false))); // used today
        mvc.perform(as(p.merchant, get("/v1/merchant/bills").param("view", "today"))).andExpect(jsonPath("$.rows[0].status", is("redeemed"))).andExpect(jsonPath("$.summary.redeemedToday", is(1)))
                .andExpect(jsonPath("$.summary.paidToday", is(0)));
        mvc.perform(as(adminToken(), get("/v1/admin/settlements/due"))).andExpect(jsonPath("$[?(@.businessId=='" + p.biz + "')]", hasSize(0))); // nothing to settle
        mvc.perform(as(p.merchant, get("/v1/merchant/results"))).andExpect(jsonPath("$.codesRedeemed", is(1))).andExpect(jsonPath("$.codeDiscountGiven", is(30000)));
    }

    @Test
    void aCodeLastsFiveMinutesAndOnlyWorksAtItsPlace() throws Exception {
        Place p = new Place();
        String customer = customerToken(phone());
        String body = p.redeem(customer, "code");
        String id = JsonPath.read(body, "$.id"), code = JsonPath.read(body, "$.code");
        mvc.perform(as(new Place().merchant, post("/v1/merchant/bills/codes/check")).content("{\"code\":\"" + code + "\"}")).andExpect(status().isNotFound()).andExpect(jsonPath("$.code", is("no_code")));
        mvc.perform(as(new Place().merchant, post("/v1/merchant/bills/" + id + "/redeem")).content("{}")).andExpect(status().isNotFound());

        // Opening it again shows the same code; it runs out after 5 minutes.
        mvc.perform(as(customer, post("/v1/redemptions")).content("{\"offerId\":\"" + p.offer + "\",\"mode\":\"code\"}")).andExpect(jsonPath("$.code", is(code)));
        jdbc.sql("update redemptions set expires_at = now() - interval '1 second' where id = :id").param("id", UUID.fromString(id)).update();
        mvc.perform(as(customer, get("/v1/redemptions/" + id))).andExpect(jsonPath("$.status", is("expired"))).andExpect(jsonPath("$.code", nullValue()));
        mvc.perform(as(p.merchant, post("/v1/merchant/bills/codes/check")).content("{\"code\":\"" + code + "\"}")).andExpect(status().isNotFound());
        mvc.perform(as(p.merchant, post("/v1/merchant/bills/" + id + "/redeem")).content("{}")).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("expired")));
        mvc.perform(as(p.merchant, get("/v1/merchant/bills"))).andExpect(jsonPath("$.rows", hasSize(0)));
        String fresh = JsonPath.read(p.redeem(customer, "code"), "$.code");
        org.junit.jupiter.api.Assertions.assertNotNull(fresh);
    }

    @Test
    void switchingBetweenABillAndACodeReplacesTheOpenRequest() throws Exception {
        Place p = new Place();
        String customer = customerToken(phone());
        String bill = JsonPath.read(p.redeem(customer, "bill"), "$.id");
        String code = JsonPath.read(p.redeem(customer, "code"), "$.id");
        mvc.perform(as(customer, get("/v1/redemptions/" + bill))).andExpect(jsonPath("$.status", is("cancelled")));
        mvc.perform(as(p.merchant, get("/v1/merchant/bills"))).andExpect(jsonPath("$.rows", hasSize(1))).andExpect(jsonPath("$.rows[0].id", is(code)));
        mvc.perform(as(customer, post("/v1/redemptions")).content("{\"offerId\":\"" + p.offer + "\",\"mode\":\"cheque\"}")).andExpect(status().isBadRequest());
    }

    @Test
    void aPlaceThatDoesntTakeVibePaymentsOffersOnlyACode() throws Exception {
        Place p = new Place();
        mvc.perform(get("/v1/offers/" + p.offer)).andExpect(jsonPath("$.redeemModes", hasSize(2)));
        mvc.perform(as(p.merchant, put("/v1/merchant/business/payment-setting")).content("{\"acceptsVibePayments\":false}")).andExpect(status().isOk());
        mvc.perform(as(p.merchant, get("/v1/merchant/settings"))).andExpect(jsonPath("$.acceptsVibePayments", is(false)));
        mvc.perform(get("/v1/offers/" + p.offer)).andExpect(jsonPath("$.redeemModes", hasSize(1))).andExpect(jsonPath("$.redeemModes[0]", is("code")));
        String customer = customerToken(phone());
        mvc.perform(as(customer, post("/v1/redemptions")).content("{\"offerId\":\"" + p.offer + "\",\"mode\":\"bill\"}")).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("pay_at_counter")));
        p.redeem(customer, "code");

        // A cashier can't change it.
        String email = "c-" + uniq() + "@test.local";
        mvc.perform(as(p.merchant, post("/v1/merchant/team")).content("{\"email\":\"" + email + "\",\"name\":\"C\",\"password\":\"" + PASSWORD + "\",\"staffRole\":\"cashier\"}")).andExpect(status().isCreated());
        mvc.perform(as(signInSettled(email, PASSWORD), put("/v1/merchant/business/payment-setting")).content("{\"acceptsVibePayments\":true}")).andExpect(status().isForbidden());
    }

    @Test
    void customersRateRealVisitsOnceAndThePlacesRatingFollows() throws Exception {
        Place p = new Place();
        String customer = customerToken(phone());
        String id = JsonPath.read(p.redeem(customer, "code"), "$.id");
        mvc.perform(as(customer, post("/v1/redemptions/" + id + "/review")).content("{\"rating\":5}")).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("not_visited")));
        mvc.perform(as(p.merchant, post("/v1/merchant/bills/" + id + "/redeem")).content("{}")).andExpect(status().isOk());
        mvc.perform(as(customer, post("/v1/redemptions/" + id + "/review")).content("{\"rating\":6}")).andExpect(status().isBadRequest());
        mvc.perform(as(customer, post("/v1/redemptions/" + id + "/review")).content("{\"rating\":4,\"comment\":\"Lovely biryani\"}")).andExpect(status().isNoContent());
        mvc.perform(as(customer, post("/v1/redemptions/" + id + "/review")).content("{\"rating\":1}")).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("already_reviewed")));
        mvc.perform(as(customer, get("/v1/redemptions/" + id))).andExpect(jsonPath("$.review.rating", is(4))).andExpect(jsonPath("$.canReview", is(false)));

        // A bill paid in the app can be rated too, from the receipt.
        String other = customerToken(phone());
        String red = JsonPath.read(p.redeem(other, "bill"), "$.id");
        mvc.perform(as(p.merchant, post("/v1/merchant/bills/" + red)).content("{\"lines\":" + BILL_1000 + "}")).andExpect(status().isCreated());
        String pr = JsonPath.read(mvc.perform(as(other, get("/v1/redemptions/" + red))).andReturn().getResponse().getContentAsString(), "$.paymentRequest.id");
        String ref = JsonPath.read(mvc.perform(as(other, post("/v1/payment-requests/" + pr + "/payments")).header("Idempotency-Key", "rate-" + uniq() + uniq()).content("{\"method\":\"upi\"}")).andReturn().getResponse().getContentAsString(), "$.reference");
        mvc.perform(as(other, get("/v1/payments/" + ref))).andExpect(jsonPath("$.status", is("verified"))).andExpect(jsonPath("$.redemptionId", is(red)));
        mvc.perform(as(other, post("/v1/redemptions/" + red + "/review")).content("{\"rating\":2,\"comment\":\"Slow service\"}")).andExpect(status().isNoContent());

        // The place's page and lists show the average of real visits; the merchant sees every review and is alerted.
        mvc.perform(get("/v1/businesses/" + p.biz)).andExpect(jsonPath("$.rating", is(3.0))).andExpect(jsonPath("$.reviewCount", is(2))).andExpect(jsonPath("$.reviews", hasSize(2)))
                .andExpect(jsonPath("$.reviews[0].verifiedVisit", is(true)));
        mvc.perform(as(p.merchant, get("/v1/merchant/reviews"))).andExpect(jsonPath("$.stats.count", is(2))).andExpect(jsonPath("$.stats.byStars[3]", is(1))).andExpect(jsonPath("$.items", hasSize(2)));
        mvc.perform(as(p.merchant, get("/v1/staff/notifications"))).andExpect(jsonPath("$.items[?(@.kind=='review_received')]", hasSize(2)));

        // VIBE hides one that breaks the rules: it drops out of the rating.
        String low = JsonPath.<java.util.List<String>>read(mvc.perform(as(adminToken(), get("/v1/admin/reviews").param("filter", "low"))).andReturn().getResponse().getContentAsString(), "$[?(@.businessId=='" + p.biz + "')].id").getFirst();
        mvc.perform(as(adminToken(), post("/v1/admin/reviews/" + low + "/hide")).content("{}")).andExpect(status().isBadRequest()); // a reason is required
        mvc.perform(as(adminToken(), post("/v1/admin/reviews/" + low + "/hide")).content("{\"reason\":\"Abusive language\"}")).andExpect(status().isOk());
        mvc.perform(get("/v1/businesses/" + p.biz)).andExpect(jsonPath("$.rating", is(4.0))).andExpect(jsonPath("$.reviewCount", is(1)));
    }
}
