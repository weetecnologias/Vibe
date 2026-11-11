package in.vibe.backend;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
import java.util.UUID;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Pay & Redeem end to end: the customer redeems, staff raise the bill, the customer pays, the partner confirms. */
class BillFlowTest extends ApiTestSupport {
    static final String WEBHOOK_SECRET = "dev-only-webhook-secret-do-not-use";

    /** A place with a merchant, a live 30% offer (cap ₹500, minimum ₹500) and a customer who has signed in. */
    class Scene {
        final String biz = business(category(null, "Bills " + uniq()), "Bills place " + uniq());
        final String merchant = merchant(biz);
        final String phone = phone();
        final String customer = customerToken(phone);
        final String offer;

        Scene(boolean memberOnly) throws Exception {
            if (memberOnly) makeMember(phone);
            offer = liveOffer(merchant, memberOnly);
            mvc.perform(as(customer, org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch("/v1/me")).content("{\"name\":\"Aarav Reddy\"}")).andExpect(status().isOk());
        }

        String redeem() throws Exception {
            return id(mvc.perform(as(customer, post("/v1/redemptions")).content("{\"offerId\":\"" + offer + "\"}")).andExpect(status().is2xxSuccessful()).andReturn());
        }

        String raise(String redemption, String linesJson) throws Exception {
            mvc.perform(as(merchant, post("/v1/merchant/bills/" + redemption)).content("{\"lines\":" + linesJson + "}")).andExpect(status().isCreated());
            return JsonPath.read(mvc.perform(as(customer, get("/v1/redemptions/" + redemption))).andReturn().getResponse().getContentAsString(), "$.paymentRequest.id");
        }

        String pay(String paymentRequest, String key) throws Exception {
            MvcResult r = mvc.perform(as(customer, post("/v1/payment-requests/" + paymentRequest + "/payments")).header("Idempotency-Key", key).content("{\"method\":\"upi\"}")).andExpect(status().isCreated()).andReturn();
            return JsonPath.read(r.getResponse().getContentAsString(), "$.reference");
        }
    }

    static final String BILL_1000 = "[{\"label\":\"Biryani\",\"amount\":60000},{\"label\":\"Kebab\",\"amount\":40000}]";

    // ---------- the offer a customer sees ----------
    @Test
    void anOfferHasAPublicDetailWithAWorkedExamplePricedByTheServer() throws Exception {
        Scene s = new Scene(false);
        mvc.perform(get("/v1/offers/" + s.offer)).andExpect(status().isOk()).andExpect(jsonPath("$.headline", is("30%"))).andExpect(jsonPath("$.example.bill", is(100000)))
                .andExpect(jsonPath("$.example.discount", is(30000))).andExpect(jsonPath("$.example.payable", is(70000))).andExpect(jsonPath("$.channels[0]", is("In store")));
        mvc.perform(get("/v1/offers/" + UUID.randomUUID())).andExpect(status().isNotFound());
    }

    // ---------- redeeming ----------
    @Test
    void memberOnlyOffersNeedMembershipAndEligibilityIsExplained() throws Exception {
        Scene s = new Scene(false);
        String memberOffer = liveOffer(s.merchant, true);
        mvc.perform(as(s.customer, get("/v1/offers/" + memberOffer + "/eligibility"))).andExpect(jsonPath("$.eligible", is(false))).andExpect(jsonPath("$.reason", is("This offer is for VIBE members.")));
        mvc.perform(as(s.customer, post("/v1/redemptions")).content("{\"offerId\":\"" + memberOffer + "\"}")).andExpect(status().isForbidden()).andExpect(jsonPath("$.code", is("membership_required")));
        mvc.perform(as(s.customer, get("/v1/offers/" + s.offer + "/eligibility"))).andExpect(jsonPath("$.eligible", is(true))).andExpect(jsonPath("$.redemptionsLeftToday", is(1)));
        makeMember(s.phone);
        mvc.perform(as(s.customer, get("/v1/offers/" + memberOffer + "/eligibility"))).andExpect(jsonPath("$.eligible", is(true))).andExpect(jsonPath("$.memberValidUntil").exists());
        mvc.perform(as(s.customer, post("/v1/redemptions")).content("{\"offerId\":\"" + memberOffer + "\"}")).andExpect(status().isCreated());
        mvc.perform(get("/v1/offers/" + s.offer + "/eligibility")).andExpect(status().isUnauthorized());
    }

    @Test
    void redeemingAgainWhileOneIsOpenReturnsTheSameOneAndNeitherPhoneNumberNorSurnameReachesTheStaff() throws Exception {
        Scene s = new Scene(false);
        String first = s.redeem();
        assertEquals(first, s.redeem());
        MvcResult board = mvc.perform(as(s.merchant, get("/v1/merchant/bills"))).andExpect(status().isOk()).andExpect(jsonPath("$.rows", hasSize(1))).andExpect(jsonPath("$.rows[0].id", is(first)))
                .andExpect(jsonPath("$.rows[0].customerName", is("Aarav R."))).andExpect(jsonPath("$.rows[0].status", is("awaiting_bill"))).andExpect(jsonPath("$.rows[0].bill", nullValue())).andReturn();
        String body = board.getResponse().getContentAsString();
        org.junit.jupiter.api.Assertions.assertFalse(body.contains(s.phone), "the phone number must never reach the merchant");
        org.junit.jupiter.api.Assertions.assertFalse(body.contains("Reddy"), "only a first name and an initial reach the merchant");
    }

    static void assertEquals(String a, String b) { org.junit.jupiter.api.Assertions.assertEquals(a, b); }

    @Test
    void staffSeeOnlyTheirOwnCustomersAndCanSearchByVibeIdOrFirstName() throws Exception {
        Scene s = new Scene(false);
        Scene other = new Scene(false);
        String red = s.redeem();
        other.redeem();
        String vibeId = JsonPath.read(mvc.perform(as(s.customer, get("/v1/me"))).andReturn().getResponse().getContentAsString(), "$.vibeId");
        mvc.perform(as(s.merchant, get("/v1/merchant/bills")).param("q", vibeId.substring(0, 4))).andExpect(jsonPath("$.rows", hasSize(1))).andExpect(jsonPath("$.rows[0].id", is(red)));
        mvc.perform(as(s.merchant, get("/v1/merchant/bills")).param("q", "aar")).andExpect(jsonPath("$.rows", hasSize(1)));
        mvc.perform(as(s.merchant, get("/v1/merchant/bills")).param("q", "zzz")).andExpect(jsonPath("$.rows", hasSize(0)));
        mvc.perform(as(s.merchant, get("/v1/merchant/bills")).param("q", "%")).andExpect(jsonPath("$.rows", hasSize(0))); // searched literally
        // Another business's staff can neither see nor bill this customer.
        mvc.perform(as(other.merchant, get("/v1/merchant/bills"))).andExpect(jsonPath("$.rows[?(@.id=='" + red + "')]", hasSize(0)));
        mvc.perform(as(other.merchant, post("/v1/merchant/bills/" + red)).content("{\"lines\":" + BILL_1000 + "}")).andExpect(status().isNotFound());
        mvc.perform(as(other.merchant, post("/v1/merchant/bills/" + red + "/preview")).content("{\"lines\":" + BILL_1000 + "}")).andExpect(status().isNotFound());
        // Nor can another customer see this redemption.
        mvc.perform(as(other.customer, get("/v1/redemptions/" + red))).andExpect(status().isNotFound());
    }

    // ---------- raising the bill ----------
    @Test
    void thePreviewAndTheBillAreBothPricedByTheServerFromTheOffersRule() throws Exception {
        Scene s = new Scene(false);
        String red = s.redeem();
        mvc.perform(as(s.merchant, post("/v1/merchant/bills/" + red + "/preview")).content("{\"lines\":" + BILL_1000 + "}")).andExpect(status().isOk())
                .andExpect(jsonPath("$.eligibleAmount", is(100000))).andExpect(jsonPath("$.discount", is(30000))).andExpect(jsonPath("$.customerPays", is(70000))).andExpect(jsonPath("$.reason", nullValue()));
        // A preview sends nothing.
        mvc.perform(as(s.customer, get("/v1/redemptions/" + red))).andExpect(jsonPath("$.status", is("awaiting_bill"))).andExpect(jsonPath("$.paymentRequest", nullValue()));

        mvc.perform(as(s.merchant, post("/v1/merchant/bills/" + red)).content("{\"lines\":" + BILL_1000 + ",\"billRef\":\"Table 12\"}")).andExpect(status().isCreated())
                .andExpect(jsonPath("$.status", is("bill_ready"))).andExpect(jsonPath("$.bill.discount", is(30000))).andExpect(jsonPath("$.bill.payable", is(70000))).andExpect(jsonPath("$.bill.billRef", is("Table 12")))
                .andExpect(jsonPath("$.bill.paymentStatus", is("not_started")));

        // The customer's screen now shows the bill, exactly as priced.
        mvc.perform(as(s.customer, get("/v1/redemptions/" + red))).andExpect(jsonPath("$.status", is("bill_ready"))).andExpect(jsonPath("$.paymentRequest.payable", is(70000)))
                .andExpect(jsonPath("$.paymentRequest.eligibleAmount", is(100000))).andExpect(jsonPath("$.paymentRequest.discount", is(30000))).andExpect(jsonPath("$.paymentRequest.lines", hasSize(2)))
                .andExpect(jsonPath("$.paymentRequest.raisedBy", is("Manager"))).andExpect(jsonPath("$.paymentRequest.currency", is("INR"))).andExpect(jsonPath("$.paymentRequest.taxes", nullValue()));
    }

    @Test
    void theCustomerIsToldTheBillIsReady() throws Exception {
        Scene s = new Scene(false);
        String red = s.redeem();
        mvc.perform(as(s.customer, get("/v1/me/notifications"))).andExpect(jsonPath("$", hasSize(0)));
        s.raise(red, BILL_1000);
        mvc.perform(as(s.customer, get("/v1/me/notifications"))).andExpect(jsonPath("$", hasSize(1))).andExpect(jsonPath("$[0].kind", is("bill_ready"))).andExpect(jsonPath("$[0].title", containsString("Bills place")))
                .andExpect(jsonPath("$[0].body", is("Pay ₹700 and save ₹300"))).andExpect(jsonPath("$[0].target.type", is("redemption"))).andExpect(jsonPath("$[0].target.id", is(red))).andExpect(jsonPath("$[0].read", is(false)));
        mvc.perform(as(s.customer, get("/v1/me/notifications")).param("unread", "true")).andExpect(jsonPath("$", hasSize(1)));
        mvc.perform(as(s.customer, post("/v1/me/notifications/read"))).andExpect(status().isNoContent());
        mvc.perform(as(s.customer, get("/v1/me/notifications")).param("unread", "true")).andExpect(jsonPath("$", hasSize(0)));
        // Registering a phone for push is accepted (push itself isn't connected yet).
        mvc.perform(as(s.customer, put("/v1/me/devices")).content("{\"token\":\"fcm-token-" + uniq() + "\",\"platform\":\"android\"}")).andExpect(status().isNoContent());
        mvc.perform(as(s.customer, put("/v1/me/devices")).content("{\"token\":\"x\",\"platform\":\"windows\"}")).andExpect(status().isBadRequest());
    }

    @Test
    void aBillBelowTheMinimumGetsNoDiscountAndSaysWhy() throws Exception {
        Scene s = new Scene(false);
        String red = s.redeem();
        mvc.perform(as(s.merchant, post("/v1/merchant/bills/" + red)).content("{\"lines\":[{\"label\":\"Tea\",\"amount\":20000}]}")).andExpect(status().isCreated()).andExpect(jsonPath("$.bill.discount", is(0))).andExpect(jsonPath("$.bill.payable", is(20000)));
        mvc.perform(as(s.customer, get("/v1/redemptions/" + red))).andExpect(jsonPath("$.paymentRequest.discountLabel", containsString("below the minimum")));
    }

    @Test
    void billsAreValidatedAndLargeOnesNeedConfirming() throws Exception {
        Scene s = new Scene(false);
        String red = s.redeem();
        String url = "/v1/merchant/bills/" + red;
        mvc.perform(as(s.merchant, post(url)).content("{\"lines\":[]}")).andExpect(status().isBadRequest());
        mvc.perform(as(s.merchant, post(url)).content("{\"lines\":[{\"label\":\"x\",\"amount\":0}]}")).andExpect(status().isBadRequest());
        mvc.perform(as(s.merchant, post(url)).content("{\"lines\":[{\"label\":\"x\",\"amount\":-5}]}")).andExpect(status().isBadRequest());
        mvc.perform(as(s.merchant, post(url)).content("{\"lines\":[{\"label\":\"\",\"amount\":5000}]}")).andExpect(status().isBadRequest());
        mvc.perform(as(s.merchant, post(url)).content("{\"lines\":[{\"label\":\"x\",\"amount\":100000000},{\"label\":\"y\",\"amount\":100000000}]}")).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code", is("bill_too_large")));
        // ₹60,000 is large: the amount has to be confirmed.
        String large = "[{\"label\":\"Banquet\",\"amount\":6000000}]";
        mvc.perform(as(s.merchant, post(url + "/preview")).content("{\"lines\":" + large + "}")).andExpect(jsonPath("$.needsConfirmation", is(true)));
        mvc.perform(as(s.merchant, post(url)).content("{\"lines\":" + large + "}")).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("confirm_large")));
        mvc.perform(as(s.merchant, get("/v1/merchant/bills"))).andExpect(jsonPath("$.rows[0].status", is("awaiting_bill"))); // nothing was sent
        mvc.perform(as(s.merchant, post(url)).content("{\"lines\":" + large + ",\"confirmLarge\":true}")).andExpect(status().isCreated()).andExpect(jsonPath("$.bill.discount", is(50000))); // capped at ₹500
    }

    @Test
    void aBillCanBeSentOnlyOnceAndAnExpiredRequestCannotBeBilled() throws Exception {
        Scene s = new Scene(false);
        String red = s.redeem();
        s.raise(red, BILL_1000);
        mvc.perform(as(s.merchant, post("/v1/merchant/bills/" + red)).content("{\"lines\":" + BILL_1000 + "}")).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("already_billed")));

        Scene late = new Scene(false);
        String old = late.redeem();
        jdbc.sql("update redemptions set expires_at = now() - interval '1 minute' where id = cast(:id as uuid)").param("id", old).update();
        mvc.perform(as(late.customer, get("/v1/redemptions/" + old))).andExpect(jsonPath("$.status", is("expired")));
        mvc.perform(as(late.merchant, post("/v1/merchant/bills/" + old)).content("{\"lines\":" + BILL_1000 + "}")).andExpect(status().isGone()).andExpect(jsonPath("$.code", is("expired")));
        mvc.perform(as(late.merchant, get("/v1/merchant/bills"))).andExpect(jsonPath("$.rows", hasSize(0))); // expired ones leave the list
        // The customer can start again.
        String again = late.redeem();
        org.junit.jupiter.api.Assertions.assertNotEquals(old, again);
    }

    @Test
    void aWrongBillCanBeWithdrawnBeforePaymentStartsAndCorrected() throws Exception {
        Scene s = new Scene(false);
        String red = s.redeem();
        String pr = s.raise(red, "[{\"label\":\"Typo\",\"amount\":10000000}]".replace("10000000", "70000"));
        mvc.perform(as(s.merchant, post("/v1/merchant/bills/" + red + "/withdraw"))).andExpect(status().isOk()).andExpect(jsonPath("$.status", is("awaiting_bill"))).andExpect(jsonPath("$.bill", nullValue()));
        mvc.perform(as(s.customer, get("/v1/redemptions/" + red))).andExpect(jsonPath("$.status", is("awaiting_bill"))).andExpect(jsonPath("$.paymentRequest", nullValue()));
        mvc.perform(as(s.customer, get("/v1/payment-requests/" + pr))).andExpect(status().isNotFound()); // the withdrawn bill can't be paid
        mvc.perform(as(s.customer, get("/v1/me/notifications"))).andExpect(jsonPath("$[?(@.kind=='bill_withdrawn')]", hasSize(1)));
        s.raise(red, BILL_1000); // the corrected bill
        mvc.perform(as(s.merchant, post("/v1/merchant/bills/" + red + "/withdraw"))).andExpect(status().isOk());
        mvc.perform(as(s.merchant, post("/v1/merchant/bills/" + red + "/withdraw"))).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("no_bill")));
    }

    // ---------- paying ----------
    @Test
    void payingIsIdempotentAndOneBillIsPaidOnce() throws Exception {
        Scene s = new Scene(false);
        String red = s.redeem();
        String pr = s.raise(red, BILL_1000);
        mvc.perform(as(s.customer, post("/v1/payment-requests/" + pr + "/payments")).content("{\"method\":\"upi\"}")).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code", is("idempotency_key")));
        mvc.perform(as(s.customer, post("/v1/payment-requests/" + pr + "/payments")).header("Idempotency-Key", "k1-" + uniq()).content("{\"method\":\"bitcoin\"}")).andExpect(status().isBadRequest());

        String key = "pay-" + uniq();
        String ref = s.pay(pr, key);
        org.junit.jupiter.api.Assertions.assertEquals(ref, s.pay(pr, key)); // a double tap is the same payment
        // A different key for the same bill is refused while that payment is live.
        mvc.perform(as(s.customer, post("/v1/payment-requests/" + pr + "/payments")).header("Idempotency-Key", "other-" + uniq()).content("{\"method\":\"card\"}")).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("already_paid")));
        // The key can't be reused for another bill.
        Scene s2 = new Scene(false);
        String pr2 = s2.raise(s2.redeem(), BILL_1000);
        mvc.perform(as(s2.customer, post("/v1/payment-requests/" + pr2 + "/payments")).header("Idempotency-Key", key).content("{\"method\":\"upi\"}")).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("key_reuse")));
        // Nobody else can read or pay this bill.
        mvc.perform(as(s2.customer, get("/v1/payment-requests/" + pr))).andExpect(status().isNotFound());
        mvc.perform(as(s2.customer, post("/v1/payment-requests/" + pr + "/payments")).header("Idempotency-Key", "x-" + uniq()).content("{\"method\":\"upi\"}")).andExpect(status().isNotFound());
        mvc.perform(as(s2.customer, get("/v1/payments/" + ref))).andExpect(status().isNotFound());
    }

    @Test
    void theCheckoutShowsTheBillAndWhoItIsPaidTo() throws Exception {
        Scene s = new Scene(false);
        String pr = s.raise(s.redeem(), BILL_1000);
        mvc.perform(as(s.customer, get("/v1/payment-requests/" + pr))).andExpect(status().isOk()).andExpect(jsonPath("$.kind", is("redemption"))).andExpect(jsonPath("$.payeeName", containsString("Bills place")))
                .andExpect(jsonPath("$.payable", is(70000))).andExpect(jsonPath("$.lines[0].label", is("Biryani")));
    }

    @Test
    void aPaymentIsVerifiedByThePartnerAndEverythingFollowsOnce() throws Exception {
        Scene s = new Scene(false);
        String red = s.redeem();
        String pr = s.raise(red, BILL_1000);
        String ref = s.pay(pr, "pay-" + uniq());
        // The simulated partner confirms it (development only), through the same path a real webhook takes.
        mvc.perform(as(s.customer, get("/v1/payments/" + ref))).andExpect(jsonPath("$.status", is("verified"))).andExpect(jsonPath("$.amount", is(70000))).andExpect(jsonPath("$.savings", is(30000)))
                .andExpect(jsonPath("$.providerPaymentId").exists()).andExpect(jsonPath("$.verifiedAt").exists()).andExpect(jsonPath("$.kind", is("redemption"))).andExpect(jsonPath("$.offerTitle", is("30% off")))
                .andExpect(jsonPath("$.ticketIds", hasSize(0)));
        mvc.perform(as(s.customer, get("/v1/payments/" + ref))).andExpect(jsonPath("$.status", is("verified"))); // reading again changes nothing

        mvc.perform(as(s.customer, get("/v1/redemptions/" + red))).andExpect(jsonPath("$.status", is("paid")));
        mvc.perform(as(s.customer, get("/v1/me/notifications"))).andExpect(jsonPath("$[?(@.kind=='payment_verified')]", hasSize(1))).andExpect(jsonPath("$[?(@.kind=='payment_verified')].body", hasItem(containsString("₹700 paid to Bills place")))).andExpect(jsonPath("$[?(@.kind=='payment_verified')].body", hasItem(containsString("You saved ₹300."))));
        org.junit.jupiter.api.Assertions.assertEquals(1, jdbc.sql("select count(*) from savings_events where saved = 30000 and payment_id = (select id from payments where reference = :r)").param("r", ref).query(Integer.class).single());

        // The merchant sees it paid, and today's totals.
        mvc.perform(as(s.merchant, get("/v1/merchant/bills")).param("view", "today")).andExpect(jsonPath("$.rows", hasSize(1))).andExpect(jsonPath("$.rows[0].status", is("paid"))).andExpect(jsonPath("$.rows[0].bill.paymentStatus", is("paid")))
                .andExpect(jsonPath("$.summary.paidToday", is(1))).andExpect(jsonPath("$.summary.paidTodayAmount", is(70000))).andExpect(jsonPath("$.summary.savedTodayAmount", is(30000)));
        mvc.perform(as(s.merchant, get("/v1/merchant/bills"))).andExpect(jsonPath("$.rows", hasSize(0))); // no longer open

        // Once paid: no second payment, no second redemption today, and the bill can't be withdrawn.
        mvc.perform(as(s.customer, post("/v1/payment-requests/" + pr + "/payments")).header("Idempotency-Key", "again-" + uniq()).content("{\"method\":\"upi\"}")).andExpect(status().isConflict());
        mvc.perform(as(s.customer, get("/v1/offers/" + s.offer + "/eligibility"))).andExpect(jsonPath("$.eligible", is(false))).andExpect(jsonPath("$.reason", is("You’ve already used this offer today."))).andExpect(jsonPath("$.redemptionsLeftToday", is(0)));
        mvc.perform(as(s.customer, post("/v1/redemptions")).content("{\"offerId\":\"" + s.offer + "\"}")).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("limit_reached")));
        mvc.perform(as(s.merchant, post("/v1/merchant/bills/" + red + "/withdraw"))).andExpect(status().isConflict());
    }

    @Test
    void aBillCannotBeWithdrawnOnceTheCustomerHasStartedPaying() throws Exception {
        Scene s = new Scene(false);
        String red = s.redeem();
        String pr = s.raise(red, BILL_1000);
        s.pay(pr, "pay-" + uniq());
        mvc.perform(as(s.merchant, post("/v1/merchant/bills/" + red + "/withdraw"))).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("payment_started")));
        mvc.perform(as(s.customer, post("/v1/redemptions/" + red + "/cancel"))).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("payment_started")));
    }

    @Test
    void aBillPastItsTimeCannotBePaid() throws Exception {
        Scene s = new Scene(false);
        String red = s.redeem();
        String pr = s.raise(red, BILL_1000);
        jdbc.sql("update payment_requests set expires_at = now() - interval '1 minute' where id = cast(:id as uuid)").param("id", pr).update();
        mvc.perform(as(s.customer, post("/v1/payment-requests/" + pr + "/payments")).header("Idempotency-Key", "late-" + uniq()).content("{\"method\":\"upi\"}")).andExpect(status().isGone()).andExpect(jsonPath("$.code", is("expired")));
        mvc.perform(as(s.customer, get("/v1/redemptions/" + red))).andExpect(jsonPath("$.status", is("expired")));
    }

    @Test
    void aCustomerCanWalkAwayBeforePaying() throws Exception {
        Scene s = new Scene(false);
        String red = s.redeem();
        String pr = s.raise(red, BILL_1000);
        mvc.perform(as(s.customer, post("/v1/redemptions/" + red + "/cancel"))).andExpect(status().isNoContent());
        mvc.perform(as(s.customer, get("/v1/redemptions/" + red))).andExpect(jsonPath("$.status", is("cancelled")));
        mvc.perform(as(s.customer, get("/v1/payment-requests/" + pr))).andExpect(status().isNotFound());
        mvc.perform(as(s.merchant, get("/v1/merchant/bills"))).andExpect(jsonPath("$.rows", hasSize(0)));
        mvc.perform(as(s.merchant, post("/v1/merchant/bills/" + red)).content("{\"lines\":" + BILL_1000 + "}")).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("cancelled")));
        // And can start again later: a cancelled request doesn't count as today's redemption.
        mvc.perform(as(s.customer, post("/v1/redemptions")).content("{\"offerId\":\"" + s.offer + "\"}")).andExpect(status().isCreated());
    }

    // ---------- the payment partner's webhook ----------
    static String sign(String body) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(WEBHOOK_SECRET.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return "sha256=" + HexFormat.of().formatHex(mac.doFinal(body.getBytes(StandardCharsets.UTF_8)));
    }

    String orderOf(String reference) {
        return jdbc.sql("select provider_order_id from payments where reference = :r").param("r", reference).query(String.class).single();
    }

    @Test
    void aWebhookWithoutAValidSignatureChangesNothing() throws Exception {
        Scene s = new Scene(false);
        String ref = s.pay(s.raise(s.redeem(), BILL_1000), "pay-" + uniq());
        String body = "{\"eventId\":\"e-" + uniq() + "\",\"providerOrderId\":\"" + orderOf(ref) + "\",\"status\":\"paid\"}";
        mvc.perform(post("/v1/webhooks/simulated").contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isUnauthorized());
        mvc.perform(post("/v1/webhooks/simulated").contentType(MediaType.APPLICATION_JSON).header("X-Vibe-Signature", "sha256=" + "0".repeat(64)).content(body)).andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code", is("bad_signature")));
        // A valid signature for a different body is also refused.
        mvc.perform(post("/v1/webhooks/simulated").contentType(MediaType.APPLICATION_JSON).header("X-Vibe-Signature", sign(body.replace("paid", "failed"))).content(body)).andExpect(status().isUnauthorized());
        org.junit.jupiter.api.Assertions.assertEquals("pending", jdbc.sql("select status from payments where reference = :r").param("r", ref).query(String.class).single());
    }

    @Test
    void aSignedWebhookAppliesAPaymentExactlyOnceEvenWhenItIsRepeated() throws Exception {
        Scene s = new Scene(false);
        String red = s.redeem();
        String ref = s.pay(s.raise(red, BILL_1000), "pay-" + uniq());
        String body = "{\"eventId\":\"evt-" + uniq() + "\",\"providerOrderId\":\"" + orderOf(ref) + "\",\"providerPaymentId\":\"pay_real_1\",\"status\":\"paid\",\"amount\":70000}";
        mvc.perform(post("/v1/webhooks/simulated").contentType(MediaType.APPLICATION_JSON).header("X-Vibe-Signature", sign(body)).content(body)).andExpect(status().isOk()).andExpect(jsonPath("$.result", is("applied")));
        // The partner sends the same event again, and then a different event for the same payment.
        mvc.perform(post("/v1/webhooks/simulated").contentType(MediaType.APPLICATION_JSON).header("X-Vibe-Signature", sign(body)).content(body)).andExpect(status().isOk()).andExpect(jsonPath("$.result", is("duplicate")));
        String second = body.replaceFirst("evt-[a-z0-9]+", "evt-" + uniq());
        mvc.perform(post("/v1/webhooks/simulated").contentType(MediaType.APPLICATION_JSON).header("X-Vibe-Signature", sign(second)).content(second)).andExpect(status().isOk()).andExpect(jsonPath("$.result", is("already_applied")));

        mvc.perform(as(s.customer, get("/v1/payments/" + ref))).andExpect(jsonPath("$.status", is("verified"))).andExpect(jsonPath("$.providerPaymentId", is("pay_real_1")));
        org.junit.jupiter.api.Assertions.assertEquals(1, jdbc.sql("select count(*) from savings_events where payment_id = (select id from payments where reference = :r)").param("r", ref).query(Integer.class).single());
        mvc.perform(as(s.customer, get("/v1/me/notifications"))).andExpect(jsonPath("$[?(@.kind=='payment_verified')]", hasSize(1)));
        org.junit.jupiter.api.Assertions.assertEquals(2, jdbc.sql("select count(*) from provider_events where event_id like 'evt-%' and payload like :p").param("p", "%" + orderOf(ref) + "%").query(Integer.class).single());
    }

    @Test
    void aWebhookWithTheWrongAmountOrAnUnknownOrderIsRefused() throws Exception {
        Scene s = new Scene(false);
        String ref = s.pay(s.raise(s.redeem(), BILL_1000), "pay-" + uniq());
        String wrong = "{\"eventId\":\"e-" + uniq() + "\",\"providerOrderId\":\"" + orderOf(ref) + "\",\"status\":\"paid\",\"amount\":1}";
        mvc.perform(post("/v1/webhooks/simulated").contentType(MediaType.APPLICATION_JSON).header("X-Vibe-Signature", sign(wrong)).content(wrong)).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("amount_mismatch")));
        org.junit.jupiter.api.Assertions.assertEquals("pending", jdbc.sql("select status from payments where reference = :r").param("r", ref).query(String.class).single());
        String unknown = "{\"eventId\":\"e-" + uniq() + "\",\"providerOrderId\":\"nope\",\"status\":\"paid\"}";
        mvc.perform(post("/v1/webhooks/simulated").contentType(MediaType.APPLICATION_JSON).header("X-Vibe-Signature", sign(unknown)).content(unknown)).andExpect(status().isNotFound());
        String incomplete = "{\"status\":\"paid\"}";
        mvc.perform(post("/v1/webhooks/simulated").contentType(MediaType.APPLICATION_JSON).header("X-Vibe-Signature", sign(incomplete)).content(incomplete)).andExpect(status().isBadRequest());
        String notJson = "not json";
        mvc.perform(post("/v1/webhooks/simulated").contentType(MediaType.APPLICATION_JSON).header("X-Vibe-Signature", sign(notJson)).content(notJson)).andExpect(status().isBadRequest());
    }

    @Test
    void aFailedPaymentLeavesTheBillOpenSoTheCustomerCanTryAgain() throws Exception {
        Scene s = new Scene(false);
        String red = s.redeem();
        String pr = s.raise(red, BILL_1000);
        String ref = s.pay(pr, "pay-" + uniq());
        String body = "{\"eventId\":\"e-" + uniq() + "\",\"providerOrderId\":\"" + orderOf(ref) + "\",\"status\":\"failed\",\"reason\":\"Insufficient funds\"}";
        mvc.perform(post("/v1/webhooks/simulated").contentType(MediaType.APPLICATION_JSON).header("X-Vibe-Signature", sign(body)).content(body)).andExpect(status().isOk()).andExpect(jsonPath("$.result", is("failed")));
        mvc.perform(as(s.customer, get("/v1/payments/" + ref))).andExpect(jsonPath("$.status", is("failed"))).andExpect(jsonPath("$.failureReason", is("Insufficient funds")));
        mvc.perform(as(s.customer, get("/v1/redemptions/" + red))).andExpect(jsonPath("$.status", is("bill_ready")));
        String retry = s.pay(pr, "retry-" + uniq());
        org.junit.jupiter.api.Assertions.assertNotEquals(ref, retry);
        mvc.perform(as(s.customer, get("/v1/payments/" + retry))).andExpect(jsonPath("$.status", is("verified")));
        mvc.perform(as(s.customer, get("/v1/redemptions/" + red))).andExpect(jsonPath("$.status", is("paid")));
    }

    @Test
    void membersSavingsAreRecordedOnlyWhenThereWasADiscount() throws Exception {
        Scene s = new Scene(true);
        String red = s.redeem();
        String pr = s.raise(red, "[{\"label\":\"Tea\",\"amount\":20000}]"); // below the minimum: no discount
        String ref = s.pay(pr, "pay-" + uniq());
        mvc.perform(as(s.customer, get("/v1/payments/" + ref))).andExpect(jsonPath("$.status", is("verified"))).andExpect(jsonPath("$.savings", is(0))).andExpect(jsonPath("$.offerTitle", nullValue()));
        org.junit.jupiter.api.Assertions.assertEquals(0, jdbc.sql("select count(*) from savings_events where payment_id = (select id from payments where reference = :r)").param("r", ref).query(Integer.class).single());
    }
}
