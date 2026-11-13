package in.vibe.backend;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** A business raises a bill for a customer from their VIBE ID, without the customer asking first, and it shows up in the customer's app. */
class RaiseBillTest extends ApiTestSupport {
    String vibeId(String phone) {
        return jdbc.sql("select vibe_id from customers where phone = :p").param("p", phone).query(String.class).single();
    }

    @Test
    void aBusinessRaisesABillFromAVibeIdAndItReachesTheCustomer() throws Exception {
        String biz = business(category(null, "Raise " + uniq()), "Raise place " + uniq()), m = merchant(biz);
        String offer = liveOffer(m, false);   // 30% off, up to ₹500, bills of ₹500 or more
        String memberOffer = liveOffer(m, true);
        String phone = phone(), c = customerToken(phone), vid = vibeId(phone);

        // Finding the customer: first name, member or not, and what they can use here.
        mvc.perform(as(m, get("/v1/merchant/bills/customer").param("vibeId", vid))).andExpect(status().isOk()).andExpect(jsonPath("$.vibeId", is(vid))).andExpect(jsonPath("$.member", is(false)))
                .andExpect(jsonPath("$.offers[?(@.id=='" + offer + "')].usable", hasItem(true))).andExpect(jsonPath("$.offers[?(@.id=='" + memberOffer + "')].usable", hasItem(false)))
                .andExpect(jsonPath("$.offers[?(@.id=='" + memberOffer + "')].reason", hasItem("This offer is for VIBE members.")));
        mvc.perform(as(m, get("/v1/merchant/bills/customer").param("vibeId", "12"))).andExpect(status().isBadRequest());
        mvc.perform(as(m, get("/v1/merchant/bills/customer").param("vibeId", "000000"))).andExpect(status().isNotFound());

        // Start a bill with an offer; starting again gives the same one; an offer they can't use is refused.
        String id = JsonPath.read(mvc.perform(as(m, post("/v1/merchant/bills/start")).content("{\"vibeId\":\"" + vid + "\",\"offerId\":\"" + offer + "\"}")).andExpect(status().isCreated())
                .andExpect(jsonPath("$.status", is("awaiting_bill"))).andExpect(jsonPath("$.vibeId", is(vid))).andReturn().getResponse().getContentAsString(), "$.id");
        mvc.perform(as(m, post("/v1/merchant/bills/start")).content("{\"vibeId\":\"" + vid + "\",\"offerId\":\"" + offer + "\"}")).andExpect(jsonPath("$.id", is(id)));
        mvc.perform(as(m, post("/v1/merchant/bills/start")).content("{\"vibeId\":\"" + vid + "\",\"offerId\":\"" + memberOffer + "\"}")).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("not_eligible")));
        mvc.perform(as(m, get("/v1/merchant/bills"))).andExpect(jsonPath("$.rows[*].id", hasItem(id)));

        // Items are added and sent exactly like a bill the customer asked for: VIBE works out the discount.
        String lines = "{\"lines\":[{\"label\":\"Biryani\",\"amount\":60000},{\"label\":\"Kebab\",\"amount\":40000}]}";
        mvc.perform(as(m, post("/v1/merchant/bills/" + id + "/preview")).content(lines)).andExpect(jsonPath("$.discount", is(30000)));
        mvc.perform(as(c, get("/v1/me/bills"))).andExpect(jsonPath("$", empty())); // nothing yet: not sent
        mvc.perform(as(m, post("/v1/merchant/bills/" + id)).content(lines)).andExpect(status().isCreated()).andExpect(jsonPath("$.status", is("bill_ready")));

        // It's in the customer's app straight away, and they can pay it.
        mvc.perform(as(c, get("/v1/me/bills"))).andExpect(jsonPath("$", hasSize(1))).andExpect(jsonPath("$[0].id", is(id))).andExpect(jsonPath("$[0].paymentRequest.eligibleAmount", is(100000)))
                .andExpect(jsonPath("$[0].paymentRequest.discount", is(30000))).andExpect(jsonPath("$[0].businessName", containsString("Raise place")));
        mvc.perform(as(c, get("/v1/me/notifications"))).andExpect(jsonPath("$[?(@.kind=='bill_ready')]", hasSize(1)));
        String pr = JsonPath.read(mvc.perform(as(c, get("/v1/redemptions/" + id))).andReturn().getResponse().getContentAsString(), "$.paymentRequest.id");
        String ref = JsonPath.read(mvc.perform(as(c, post("/v1/payment-requests/" + pr + "/payments")).header("Idempotency-Key", "rb-" + uniq() + uniq()).content("{\"method\":\"upi\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.reference");
        mvc.perform(as(c, get("/v1/payments/" + ref))).andExpect(jsonPath("$.status", is("verified")));
        mvc.perform(as(c, get("/v1/me/bills"))).andExpect(jsonPath("$", empty()));
        mvc.perform(as(m, get("/v1/merchant/bills").param("view", "today"))).andExpect(jsonPath("$.rows[*].id", hasItem(id)));
    }

    @Test
    void aBillWithoutAnOfferHasNoDiscountAndAnotherBusinessesOfferIsRefused() throws Exception {
        String biz = business(category(null, "Plain " + uniq()), "Plain place " + uniq()), m = merchant(biz);
        String other = merchant(business(category(null, "Other " + uniq()), "Other place " + uniq()));
        String foreign = liveOffer(other, false);
        String phone = phone(), c = customerToken(phone), vid = vibeId(phone);

        mvc.perform(as(m, post("/v1/merchant/bills/start")).content("{\"vibeId\":\"" + vid + "\",\"offerId\":\"" + foreign + "\"}")).andExpect(status().isNotFound());
        String id = JsonPath.read(mvc.perform(as(m, post("/v1/merchant/bills/start")).content("{\"vibeId\":\"" + vid + "\"}")).andExpect(status().isCreated())
                .andExpect(jsonPath("$.offerTitle", is("Bill without an offer"))).andReturn().getResponse().getContentAsString(), "$.id");
        mvc.perform(as(m, post("/v1/merchant/bills/start")).content("{\"vibeId\":\"" + vid + "\"}")).andExpect(jsonPath("$.id", is(id)));
        mvc.perform(as(m, post("/v1/merchant/bills/" + id)).content("{\"lines\":[{\"label\":\"Coffee\",\"amount\":25000}]}")).andExpect(status().isCreated());
        mvc.perform(as(c, get("/v1/me/bills"))).andExpect(jsonPath("$[0].paymentRequest.discount", is(0))).andExpect(jsonPath("$[0].paymentRequest.eligibleAmount", is(25000)));
        // They already have an unpaid bill here: it must be withdrawn before another starts.
        mvc.perform(as(m, post("/v1/merchant/bills/start")).content("{\"vibeId\":\"" + vid + "\"}")).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("has_bill")));
        mvc.perform(as(m, post("/v1/merchant/bills/" + id + "/withdraw"))).andExpect(status().isOk());
        mvc.perform(as(c, get("/v1/me/bills"))).andExpect(jsonPath("$", empty()));
        // A customer can't raise bills, and a cashier of this business can.
        mvc.perform(as(c, post("/v1/merchant/bills/start")).content("{\"vibeId\":\"" + vid + "\"}")).andExpect(status().isForbidden());
        String email = "cs-" + uniq() + "@test.local";
        mvc.perform(as(m, post("/v1/merchant/team")).content("{\"email\":\"" + email + "\",\"name\":\"C\",\"password\":\"" + PASSWORD + "\",\"staffRole\":\"cashier\"}")).andExpect(status().isCreated());
        mvc.perform(as(signInSettled(email, PASSWORD), post("/v1/merchant/bills/start")).content("{\"vibeId\":\"" + vid + "\"}")).andExpect(status().isCreated());
    }

    @Test
    void theStaffOrTheCustomerCanApplyAnOfferOrACouponOnABill() throws Exception {
        String biz = business(category(null, "Offers " + uniq()), "Offers place " + uniq()), m = merchant(biz);
        String offer = liveOffer(m, false);       // 30% off up to ₹500 on bills of ₹500 or more
        String code = "BILL" + uniq().toUpperCase().replaceAll("[^A-Z0-9]", "7").substring(0, 6);
        mvc.perform(as(adminToken(), post("/v1/admin/coupons")).content("""
            {"code":"%s","title":"₹100 off bills","kinds":["bill"],"kind":"flat","flatAmount":10000,"minBill":50000,"startsAt":"2026-01-01T00:00:00Z","endsAt":"2031-01-01T00:00:00Z"}""".formatted(code))).andExpect(status().isCreated());
        String phone = phone(), c = customerToken(phone), vid = vibeId(phone);
        String lines = "{\"lines\":[{\"label\":\"Dinner\",\"amount\":100000}]%s}";

        // The staff start with the offer, then choose to send the bill without it: the customer is shown a full-price bill.
        String id = JsonPath.read(mvc.perform(as(m, post("/v1/merchant/bills/start")).content("{\"vibeId\":\"" + vid + "\",\"offerId\":\"" + offer + "\"}")).andReturn().getResponse().getContentAsString(), "$.id");
        mvc.perform(as(m, get("/v1/merchant/bills/" + id + "/offers"))).andExpect(jsonPath("$.currentOfferId", is(offer))).andExpect(jsonPath("$.offers[0].usable", is(true)));
        mvc.perform(as(m, post("/v1/merchant/bills/" + id + "/preview")).content(lines.formatted(""))).andExpect(jsonPath("$.discount", is(30000)));
        mvc.perform(as(m, post("/v1/merchant/bills/" + id + "/preview")).content(lines.formatted(",\"offerId\":\"none\""))).andExpect(jsonPath("$.discount", is(0)));
        mvc.perform(as(m, post("/v1/merchant/bills/" + id + "/preview")).content(lines.formatted(",\"offerId\":\"" + UUID.randomUUID() + "\""))).andExpect(status().isNotFound());
        mvc.perform(as(m, post("/v1/merchant/bills/" + id)).content(lines.formatted(",\"offerId\":\"none\""))).andExpect(status().isCreated());
        String pr = JsonPath.read(mvc.perform(as(c, get("/v1/me/bills"))).andExpect(jsonPath("$[0].paymentRequest.discount", is(0))).andReturn().getResponse().getContentAsString(), "$[0].paymentRequest.id");

        // The customer sees the business's offer and the coupon on the bill, with what each saves, and applies one. One at a time.
        mvc.perform(as(c, get("/v1/payment-requests/" + pr + "/offers"))).andExpect(jsonPath("$.applied").doesNotExist())
                .andExpect(jsonPath("$.available[?(@.id=='" + offer + "')].saving", hasItem(30000))).andExpect(jsonPath("$.available[?(@.code=='" + code + "')].saving", hasItem(10000)));
        mvc.perform(as(c, post("/v1/payment-requests/" + pr + "/offer")).content("{\"code\":\"" + offer + "\"}")).andExpect(status().isOk()).andExpect(jsonPath("$.discount", is(30000)));
        mvc.perform(as(c, get("/v1/payment-requests/" + pr + "/offers"))).andExpect(jsonPath("$.applied.id", is(offer)));
        assertEquals(0L, jdbc.sql("select vibe_funded from payment_requests where id = :id::uuid").param("id", pr).query(Long.class).single()); // the business's own offer: the business bears it
        mvc.perform(as(c, post("/v1/payment-requests/" + pr + "/offer")).content("{\"code\":\"" + code.toLowerCase() + "\"}")).andExpect(status().isOk()).andExpect(jsonPath("$.discount", is(10000))).andExpect(jsonPath("$.appliedOffer.code", is(code)));
        assertEquals(10000L, jdbc.sql("select vibe_funded from payment_requests where id = :id::uuid").param("id", pr).query(Long.class).single()); // a VIBE coupon: VIBE pays for it
        mvc.perform(as(c, delete("/v1/payment-requests/" + pr + "/offer"))).andExpect(jsonPath("$.discount", is(0)));
        // A member-only offer isn't usable by a non-member; a bill under the minimum shows why.
        String member = liveOffer(m, true);
        mvc.perform(as(c, post("/v1/payment-requests/" + pr + "/offer")).content("{\"code\":\"" + member + "\"}")).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("not_eligible")));
        mvc.perform(as(c, get("/v1/payment-requests/" + pr + "/offers"))).andExpect(jsonPath("$.available[?(@.id=='" + member + "')].eligible", hasItem(false)));
    }

    @Test
    void lookingUpVibeIdsIsLimitedSoTheyCantBeGuessed() throws Exception {
        String m = merchant(business(category(null, "Limit " + uniq()), "Limit place " + uniq()));
        int refused = 0;
        for (int i = 0; i < 45; i++) {
            if (mvc.perform(as(m, get("/v1/merchant/bills/customer").param("vibeId", String.format("9%05d", i)))).andReturn().getResponse().getStatus() == 429) refused++;
        }
        assertEquals(5, refused);
    }
}
