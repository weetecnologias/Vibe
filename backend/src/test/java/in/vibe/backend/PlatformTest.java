package in.vibe.backend;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MvcResult;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.greaterThanOrEqualTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.matchesPattern;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Staff alerts, category rules, membership purchase, admin oversight, merchant applications and the first-sign-in password change. */
class PlatformTest extends ApiTestSupport {
    static final String BILL = "[{\"label\":\"Dinner\",\"amount\":100000}]";

    class Scene {
        final String biz = business(category(null, "Platform " + uniq()), "Platform place " + uniq());
        final String merchant = merchant(biz);
        final String phone = phone();
        final String customer = customerToken(phone);
        final String offer;

        Scene() throws Exception {
            offer = liveOffer(merchant, false);
            mvc.perform(as(customer, org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch("/v1/me")).content("{\"name\":\"Meera Iyer\"}")).andExpect(status().isOk());
            // Approving the offer told the merchant; start each test with a clean inbox.
            mvc.perform(as(merchant, post("/v1/staff/notifications/read"))).andExpect(status().isNoContent());
        }

        String redeem() throws Exception { return id(mvc.perform(as(customer, post("/v1/redemptions")).content("{\"offerId\":\"" + offer + "\"}")).andExpect(status().is2xxSuccessful()).andReturn()); }

        /** Redeem, raise a ₹1,000 bill, pay. Returns the payment reference. */
        String paidBill() throws Exception {
            String red = redeem();
            mvc.perform(as(merchant, post("/v1/merchant/bills/" + red)).content("{\"lines\":" + BILL + "}")).andExpect(status().isCreated());
            String pr = JsonPath.read(mvc.perform(as(customer, get("/v1/redemptions/" + red))).andReturn().getResponse().getContentAsString(), "$.paymentRequest.id");
            String ref = JsonPath.read(mvc.perform(as(customer, post("/v1/payment-requests/" + pr + "/payments")).header("Idempotency-Key", "k-" + uniq()).content("{\"method\":\"upi\"}")).andReturn().getResponse().getContentAsString(), "$.reference");
            mvc.perform(as(customer, get("/v1/payments/" + ref))).andExpect(jsonPath("$.status", is("verified")));
            return ref;
        }
    }

    // ---------- alerts for staff ----------
    @Test
    void theMerchantIsAlertedWhenACustomerRedeemsAndWhenTheyPay() throws Exception {
        Scene s = new Scene();
        mvc.perform(as(s.merchant, get("/v1/staff/notifications"))).andExpect(jsonPath("$.unread", is(0)));
        String red = s.redeem();
        mvc.perform(as(s.merchant, get("/v1/staff/notifications"))).andExpect(jsonPath("$.unread", is(1))).andExpect(jsonPath("$.items[0].kind", is("redeem_started")))
                .andExpect(jsonPath("$.items[0].title", containsString("Meera I."))).andExpect(jsonPath("$.items[0].link", is("/bills"))).andExpect(jsonPath("$.items[0].read", is(false)));
        // Another business hears nothing about this customer.
        String other = merchant(business(category(null, "Other " + uniq()), "Other place " + uniq()));
        mvc.perform(as(other, get("/v1/staff/notifications"))).andExpect(jsonPath("$.unread", is(0)));

        String firstId = JsonPath.read(mvc.perform(as(s.merchant, get("/v1/staff/notifications"))).andReturn().getResponse().getContentAsString(), "$.items[0].id");
        mvc.perform(as(s.merchant, post("/v1/staff/notifications/" + firstId + "/read"))).andExpect(status().isNoContent());
        mvc.perform(as(s.merchant, get("/v1/staff/notifications"))).andExpect(jsonPath("$.unread", is(0))).andExpect(jsonPath("$.items[0].read", is(true)));
        mvc.perform(as(other, post("/v1/staff/notifications/" + firstId + "/read"))).andExpect(status().isNoContent()); // someone else's: does nothing

        mvc.perform(as(s.merchant, post("/v1/merchant/bills/" + red)).content("{\"lines\":" + BILL + "}")).andExpect(status().isCreated());
        String pr = JsonPath.read(mvc.perform(as(s.customer, get("/v1/redemptions/" + red))).andReturn().getResponse().getContentAsString(), "$.paymentRequest.id");
        String ref = JsonPath.read(mvc.perform(as(s.customer, post("/v1/payment-requests/" + pr + "/payments")).header("Idempotency-Key", "k-" + uniq()).content("{\"method\":\"upi\"}")).andReturn().getResponse().getContentAsString(), "$.reference");
        mvc.perform(as(s.customer, get("/v1/payments/" + ref))).andExpect(jsonPath("$.status", is("verified")));
        mvc.perform(as(s.merchant, get("/v1/staff/notifications"))).andExpect(jsonPath("$.unread", is(1))).andExpect(jsonPath("$.items[0].kind", is("payment_received"))).andExpect(jsonPath("$.items[0].title", is("Payment received: ₹700")));
        mvc.perform(as(s.merchant, post("/v1/staff/notifications/read"))).andExpect(status().isNoContent());
        mvc.perform(as(s.merchant, get("/v1/staff/notifications"))).andExpect(jsonPath("$.unread", is(0)));
    }

    @Test
    void theMerchantIsToldWhenTheCustomerWalksAway() throws Exception {
        Scene s = new Scene();
        String red = s.redeem();
        mvc.perform(as(s.customer, post("/v1/redemptions/" + red + "/cancel"))).andExpect(status().isNoContent());
        mvc.perform(as(s.merchant, get("/v1/staff/notifications"))).andExpect(jsonPath("$.items[?(@.kind=='redeem_cancelled')]", hasSize(1)));
    }

    @Test
    void adminsAreToldWhatNeedsReviewAndMerchantsAreToldTheOutcome() throws Exception {
        String biz = business(category(null, "Review alerts " + uniq()), "Alerts place " + uniq());
        String token = merchant(biz);
        String offer = id(mvc.perform(as(token, post("/v1/merchant/offers")).content("{\"title\":\"Alert me\",\"kind\":\"flat\",\"flatAmount\":5000,\"startsAt\":\"2026-01-01T00:00:00Z\",\"endsAt\":\"2031-01-01T00:00:00Z\"}")).andExpect(status().isCreated()).andReturn());
        mvc.perform(as(adminToken(), get("/v1/staff/notifications")).param("limit", "100")).andExpect(jsonPath("$.items[?(@.kind=='offer_review' && @.body=~/.*Alert me.*/)]", hasSize(1)));
        mvc.perform(as(adminToken(), post("/v1/admin/offers/" + offer + "/reject")).content("{\"note\":\"Too generous\"}")).andExpect(status().isOk());
        mvc.perform(as(token, get("/v1/staff/notifications"))).andExpect(jsonPath("$.items[0].kind", is("offer_decision"))).andExpect(jsonPath("$.items[0].title", is("Offer not approved"))).andExpect(jsonPath("$.items[0].body", containsString("Too generous")));

        String event = id(mvc.perform(as(token, post("/v1/merchant/events")).content(ContentToolsTest.eventJson("Alert event " + uniq(), 9))).andExpect(status().isCreated()).andReturn());
        mvc.perform(as(adminToken(), get("/v1/staff/notifications")).param("limit", "100")).andExpect(jsonPath("$.items[?(@.kind=='event_review')]", not(hasSize(0))));
        mvc.perform(as(adminToken(), post("/v1/admin/events/" + event + "/approve"))).andExpect(status().isOk());
        mvc.perform(as(token, get("/v1/staff/notifications"))).andExpect(jsonPath("$.items[0].kind", is("event_decision"))).andExpect(jsonPath("$.items[0].title", is("Event published")));
    }

    @Test
    void alertsNeedASignedInStaffMember() throws Exception {
        mvc.perform(get("/v1/staff/notifications")).andExpect(status().isUnauthorized());
        mvc.perform(as(customerToken(phone()), get("/v1/staff/notifications"))).andExpect(status().isForbidden());
    }

    // ---------- category rules ----------
    @Test
    void aCategoryDecidesWhetherBillsApplyAndWhatTheItemListIsCalled() throws Exception {
        String parent = id(mvc.perform(as(adminToken(), post("/v1/admin/categories")).content("{\"slug\":\"salons-" + uniq() + "\",\"name\":\"Salons\",\"menuLabel\":\"Services\"}")).andExpect(status().isCreated())
                .andExpect(jsonPath("$.payRedeem", is(true))).andExpect(jsonPath("$.menuLabel", is("Services"))).andReturn());
        String child = id(mvc.perform(as(adminToken(), post("/v1/admin/categories")).content("{\"parentId\":\"" + parent + "\",\"slug\":\"hair-" + uniq() + "\",\"name\":\"Hair\"}")).andExpect(status().isCreated()).andReturn());
        String token = merchant(business(child, "Hair place " + uniq()));
        mvc.perform(as(token, get("/v1/merchant/settings"))).andExpect(jsonPath("$.payRedeem", is(true))).andExpect(jsonPath("$.menuLabel", is("Services"))); // inherited

        String cinemas = id(mvc.perform(as(adminToken(), post("/v1/admin/categories")).content("{\"slug\":\"cinemas-" + uniq() + "\",\"name\":\"Cinemas\",\"payRedeem\":false}")).andExpect(status().isCreated()).andReturn());
        String cinema = merchant(business(cinemas, "Cinema place " + uniq()));
        mvc.perform(as(cinema, get("/v1/merchant/settings"))).andExpect(jsonPath("$.payRedeem", is(false))).andExpect(jsonPath("$.menuLabel", is("Menu")));
        mvc.perform(as(cinema, post("/v1/merchant/offers")).content("{\"title\":\"Nope\",\"kind\":\"flat\",\"flatAmount\":5000,\"startsAt\":\"2026-01-01T00:00:00Z\",\"endsAt\":\"2031-01-01T00:00:00Z\"}"))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("not_applicable")));
    }

    @Test
    void anOfferAtABusinessWhereBillsStopAreNoLongerRedeemable() throws Exception {
        Scene s = new Scene();
        mvc.perform(as(s.customer, get("/v1/offers/" + s.offer + "/eligibility"))).andExpect(jsonPath("$.eligible", is(true)));
        String catId = jdbc.sql("select primary_category_id::text from businesses where id = cast(:b as uuid)").param("b", s.biz).query(String.class).single();
        jdbc.sql("update categories set pay_redeem = false where id = cast(:c as uuid)").param("c", catId).update();
        mvc.perform(as(s.customer, get("/v1/offers/" + s.offer + "/eligibility"))).andExpect(jsonPath("$.eligible", is(false))).andExpect(jsonPath("$.reason", containsString("Bills aren’t used")));
        mvc.perform(as(s.customer, post("/v1/redemptions")).content("{\"offerId\":\"" + s.offer + "\"}")).andExpect(status().isConflict());
    }

    // ---------- membership ----------
    String pay(String customer, String paymentRequest) throws Exception {
        String ref = JsonPath.read(mvc.perform(as(customer, post("/v1/payment-requests/" + paymentRequest + "/payments")).header("Idempotency-Key", "k-" + uniq()).content("{\"method\":\"upi\"}")).andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString(), "$.reference");
        mvc.perform(as(customer, get("/v1/payments/" + ref))).andExpect(jsonPath("$.status", is("verified")));
        return ref;
    }

    String plan(String name, String interval, long price) throws Exception {
        return id(mvc.perform(as(adminToken(), post("/v1/admin/plans")).content("{\"name\":\"" + name + " " + uniq() + "\",\"interval\":\"" + interval + "\",\"price\":" + price + "}")).andExpect(status().isCreated()).andReturn());
    }

    @Test
    void buyingAPlanStartsTheMembershipOnlyWhenTheBillIsPaidAndTimeStacks() throws Exception {
        String monthly = plan("Monthly", "month", 29900);
        String phone = phone();
        String customer = customerToken(phone);
        mvc.perform(as(customer, get("/v1/membership"))).andExpect(jsonPath("$.status", is("none"))).andExpect(jsonPath("$.plan", nullValue()));

        MvcResult sub = mvc.perform(as(customer, post("/v1/membership/subscriptions")).content("{\"planId\":\"" + monthly + "\"}")).andExpect(status().isCreated()).andExpect(jsonPath("$.amount", is(29900))).andReturn();
        String pr = JsonPath.read(sub.getResponse().getContentAsString(), "$.paymentRequestId");
        // Asking again while the bill is open gives the same bill.
        mvc.perform(as(customer, post("/v1/membership/subscriptions")).content("{\"planId\":\"" + monthly + "\"}")).andExpect(jsonPath("$.paymentRequestId", is(pr)));
        mvc.perform(as(customer, get("/v1/payment-requests/" + pr))).andExpect(jsonPath("$.kind", is("membership"))).andExpect(jsonPath("$.payeeName", is("VIBE Membership"))).andExpect(jsonPath("$.payable", is(29900)))
                .andExpect(jsonPath("$.lines[0].label", containsString("membership")));
        mvc.perform(as(customer, get("/v1/membership"))).andExpect(jsonPath("$.status", is("none"))); // not paid yet: not a member

        pay(customer, pr);
        mvc.perform(as(customer, get("/v1/membership"))).andExpect(jsonPath("$.status", is("active"))).andExpect(jsonPath("$.plan.id", is(monthly))).andExpect(jsonPath("$.memberNo", matchesPattern("VB \\d{6} \\d{4}")))
                .andExpect(jsonPath("$.validUntil").exists()).andExpect(jsonPath("$.autoRenew", is(false))).andExpect(jsonPath("$.payments", hasSize(1))).andExpect(jsonPath("$.payments[0].amount", is(29900)));
        mvc.perform(as(customer, get("/v1/me"))).andExpect(jsonPath("$.isMember", is(true)));
        mvc.perform(as(customer, get("/v1/me/notifications"))).andExpect(jsonPath("$[?(@.kind=='membership_started')]", hasSize(1)));
        String first = JsonPath.read(mvc.perform(as(customer, get("/v1/membership"))).andReturn().getResponse().getContentAsString(), "$.validUntil");

        // Buying again adds a period after the current one.
        String pr2 = JsonPath.read(mvc.perform(as(customer, post("/v1/membership/subscriptions")).content("{\"planId\":\"" + monthly + "\"}")).andReturn().getResponse().getContentAsString(), "$.paymentRequestId");
        pay(customer, pr2);
        String second = JsonPath.read(mvc.perform(as(customer, get("/v1/membership"))).andReturn().getResponse().getContentAsString(), "$.validUntil");
        org.junit.jupiter.api.Assertions.assertTrue(java.time.OffsetDateTime.parse(second).isAfter(java.time.OffsetDateTime.parse(first).plusDays(29)), "the second month starts when the first ends");
        mvc.perform(as(customer, get("/v1/membership"))).andExpect(jsonPath("$.payments", hasSize(2)));

        // Switching plan is a new purchase.
        mvc.perform(as(customer, post("/v1/membership/plan-change")).content("{\"planId\":\"" + monthly + "\"}")).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("use_subscribe")));
    }

    @Test
    void cancellingKeepsTheBenefitsUntilTheEndOfThePaidPeriod() throws Exception {
        String customer = customerToken(phone());
        mvc.perform(as(customer, post("/v1/membership/cancel"))).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("not_active")));
        String pr = JsonPath.read(mvc.perform(as(customer, post("/v1/membership/subscriptions")).content("{\"planId\":\"" + plan("Cancelable", "month", 19900) + "\"}")).andReturn().getResponse().getContentAsString(), "$.paymentRequestId");
        pay(customer, pr);
        mvc.perform(as(customer, post("/v1/membership/cancel"))).andExpect(status().isOk()).andExpect(jsonPath("$.status", is("cancelled"))).andExpect(jsonPath("$.validUntil").exists()).andExpect(jsonPath("$.renewsAt", nullValue()));
        mvc.perform(as(customer, get("/v1/me"))).andExpect(jsonPath("$.isMember", is(true))); // still a member until the date
        mvc.perform(as(customer, post("/v1/membership/cancel"))).andExpect(status().isConflict());
    }

    @Test
    void onlyOnSaleAndPaidPlansCanBeBoughtAndOnlyByTheirOwner() throws Exception {
        String customer = customerToken(phone());
        String off = plan("Hidden", "month", 10000);
        mvc.perform(as(adminToken(), put("/v1/admin/plans/" + off)).content("{\"name\":\"Hidden\",\"interval\":\"month\",\"price\":10000,\"active\":false}")).andExpect(status().isOk());
        mvc.perform(as(customer, post("/v1/membership/subscriptions")).content("{\"planId\":\"" + off + "\"}")).andExpect(status().isNotFound());
        String free = id(mvc.perform(as(adminToken(), post("/v1/admin/plans")).content("{\"name\":\"Free " + uniq() + "\",\"interval\":\"month\",\"price\":0}")).andReturn());
        mvc.perform(as(customer, post("/v1/membership/subscriptions")).content("{\"planId\":\"" + free + "\"}")).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code", is("free_plan")));
        mvc.perform(as(customer, post("/v1/membership/subscriptions")).content("{\"planId\":\"not-an-id\"}")).andExpect(status().isNotFound());

        String pr = JsonPath.read(mvc.perform(as(customer, post("/v1/membership/subscriptions")).content("{\"planId\":\"" + plan("Mine", "month", 15000) + "\"}")).andReturn().getResponse().getContentAsString(), "$.paymentRequestId");
        String stranger = customerToken(phone());
        mvc.perform(as(stranger, get("/v1/payment-requests/" + pr))).andExpect(status().isNotFound());
        mvc.perform(as(stranger, post("/v1/payment-requests/" + pr + "/payments")).header("Idempotency-Key", "k-" + uniq()).content("{\"method\":\"upi\"}")).andExpect(status().isNotFound());
        mvc.perform(post("/v1/membership/subscriptions").contentType(org.springframework.http.MediaType.APPLICATION_JSON).content("{\"planId\":\"" + off + "\"}")).andExpect(status().isUnauthorized());
    }

    @Test
    void aMemberSavingsAppearOnTheirMembershipPage() throws Exception {
        Scene s = new Scene();
        makeMember(s.phone);
        s.paidBill();
        mvc.perform(as(s.customer, get("/v1/membership"))).andExpect(jsonPath("$.savings.total", is(30000))).andExpect(jsonPath("$.savings.redemptions", is(1))).andExpect(jsonPath("$.savings.places", is(1)))
                .andExpect(jsonPath("$.recentSavings", hasSize(1))).andExpect(jsonPath("$.recentSavings[0].saved", is(30000))).andExpect(jsonPath("$.savings.byCategory", hasSize(1)));
    }

    // ---------- admin: members and granting time ----------
    @Test
    void adminSeesEveryMemberWithTheirPlanAndPaymentsAndCanGrantTimeWithAReason() throws Exception {
        String plan = plan("Gold", "month", 29900);
        String phone = phone();
        String customer = customerToken(phone);
        pay(customer, JsonPath.read(mvc.perform(as(customer, post("/v1/membership/subscriptions")).content("{\"planId\":\"" + plan + "\"}")).andReturn().getResponse().getContentAsString(), "$.paymentRequestId"));
        String vibeId = JsonPath.read(mvc.perform(as(customer, get("/v1/me"))).andReturn().getResponse().getContentAsString(), "$.vibeId");
        String customerId = JsonPath.read(mvc.perform(as(customer, get("/v1/me"))).andReturn().getResponse().getContentAsString(), "$.id");

        mvc.perform(as(adminToken(), get("/v1/admin/members")).param("q", vibeId)).andExpect(jsonPath("$.items", hasSize(1))).andExpect(jsonPath("$.items[0].plan", containsString("Gold"))).andExpect(jsonPath("$.items[0].status", is("active")))
                .andExpect(jsonPath("$.items[0].totalPaid", is(29900))).andExpect(jsonPath("$.items[0].memberNo", matchesPattern("VB \\d{6} \\d{4}")));
        mvc.perform(as(adminToken(), get("/v1/admin/members")).param("status", "active")).andExpect(jsonPath("$.total", greaterThanOrEqualTo(1)));

        // Granting time needs a real reason, and it is recorded.
        String grant = "{\"planId\":\"" + plan + "\",\"days\":10,\"reason\":\"%s\"}";
        mvc.perform(as(adminToken(), post("/v1/admin/customers/" + customerId + "/membership")).content(grant.formatted("ok"))).andExpect(status().isBadRequest());
        mvc.perform(as(adminToken(), post("/v1/admin/customers/" + customerId + "/membership")).content(grant.formatted("Goodwill after a failed booking"))).andExpect(status().isOk()).andExpect(jsonPath("$.status", is("active")));
        mvc.perform(as(adminToken(), get("/v1/admin/audit")).param("limit", "30")).andExpect(jsonPath("$[?(@.action=='grant_membership' && @.entityId=='" + customerId + "')].detail", hasItem("10 days: Goodwill after a failed booking")));
        mvc.perform(as(adminToken(), post("/v1/admin/customers/" + java.util.UUID.randomUUID() + "/membership")).content(grant.formatted("Goodwill after a failed booking"))).andExpect(status().isNotFound());

        // A grant for a customer who has never paid creates the membership and is marked as granted, not paid.
        String fresh = customerToken(phone());
        String freshId = JsonPath.read(mvc.perform(as(fresh, get("/v1/me"))).andReturn().getResponse().getContentAsString(), "$.id");
        mvc.perform(as(adminToken(), post("/v1/admin/customers/" + freshId + "/membership")).content(grant.formatted("Press trial for a reviewer"))).andExpect(status().isOk());
        org.junit.jupiter.api.Assertions.assertEquals("granted", jdbc.sql("select source from membership_payments where customer_id = cast(:c as uuid)").param("c", freshId).query(String.class).single());
        mvc.perform(as(fresh, get("/v1/membership"))).andExpect(jsonPath("$.payments", hasSize(0))); // a grant isn't a payment
    }

    // ---------- admin: overview, customers, transactions ----------
    @Test
    void theOverviewCountsWhatHappenedAndEveryAdminPageIsAdminOnly() throws Exception {
        Scene s = new Scene();
        s.paidBill();
        mvc.perform(as(adminToken(), get("/v1/admin/overview"))).andExpect(status().isOk()).andExpect(jsonPath("$.customers", greaterThanOrEqualTo(1))).andExpect(jsonPath("$.paidToday", greaterThanOrEqualTo(1)))
                .andExpect(jsonPath("$.collectedToday", greaterThanOrEqualTo(70000))).andExpect(jsonPath("$.last14Days", hasSize(14))).andExpect(jsonPath("$.last14Days[13].amount", greaterThanOrEqualTo(70000))).andExpect(jsonPath("$.liveBusinesses", greaterThanOrEqualTo(1)));
        for (String path : new String[]{"/v1/admin/overview", "/v1/admin/customers", "/v1/admin/transactions", "/v1/admin/members", "/v1/admin/deletion-requests", "/v1/admin/applications"}) {
            mvc.perform(as(s.merchant, get(path))).andExpect(status().isForbidden());
            mvc.perform(as(s.customer, get(path))).andExpect(status().isForbidden());
            mvc.perform(get(path)).andExpect(status().isUnauthorized());
        }
    }

    @Test
    void adminFindsACustomerSeesTheirHistoryAndCanRevealThePhoneOnlyWithAnAuditTrail() throws Exception {
        Scene s = new Scene();
        String ref = s.paidBill();
        String me = mvc.perform(as(s.customer, get("/v1/me"))).andReturn().getResponse().getContentAsString();
        String id = JsonPath.read(me, "$.id"), vibeId = JsonPath.read(me, "$.vibeId");

        MvcResult list = mvc.perform(as(adminToken(), get("/v1/admin/customers")).param("q", vibeId)).andExpect(jsonPath("$.items", hasSize(1))).andExpect(jsonPath("$.items[0].name", is("Meera Iyer")))
                .andExpect(jsonPath("$.items[0].phoneMasked", matchesPattern("\\+91 \\d{5} •••\\d{2}"))).andExpect(jsonPath("$.items[0].paidRedemptions", is(1))).andExpect(jsonPath("$.items[0].totalPaid", is(70000))).andReturn();
        org.junit.jupiter.api.Assertions.assertFalse(list.getResponse().getContentAsString().contains(s.phone), "the list never shows the full number");
        mvc.perform(as(adminToken(), get("/v1/admin/customers")).param("q", "meera")).andExpect(jsonPath("$.items[?(@.id=='" + id + "')]", hasSize(1)));
        mvc.perform(as(adminToken(), get("/v1/admin/customers")).param("q", s.phone.substring(0, 6))).andExpect(jsonPath("$.items[?(@.id=='" + id + "')]", hasSize(1)));
        mvc.perform(as(adminToken(), get("/v1/admin/customers")).param("q", "%")).andExpect(jsonPath("$.items", hasSize(0)));

        MvcResult detail = mvc.perform(as(adminToken(), get("/v1/admin/customers/" + id))).andExpect(jsonPath("$.redemptions", hasSize(1))).andExpect(jsonPath("$.redemptions[0].status", is("paid"))).andExpect(jsonPath("$.redemptions[0].payable", is(70000)))
                .andExpect(jsonPath("$.payments[0].reference", is(ref))).andExpect(jsonPath("$.membership.status", is("none"))).andReturn();
        org.junit.jupiter.api.Assertions.assertFalse(detail.getResponse().getContentAsString().contains(s.phone));
        mvc.perform(as(adminToken(), post("/v1/admin/customers/" + id + "/reveal-phone"))).andExpect(jsonPath("$.phone", is("+91 " + s.phone)));
        mvc.perform(as(adminToken(), get("/v1/admin/audit")).param("limit", "20")).andExpect(jsonPath("$[?(@.action=='reveal_phone' && @.entityId=='" + id + "')]", hasSize(1)));
        mvc.perform(as(adminToken(), get("/v1/admin/customers/" + java.util.UUID.randomUUID()))).andExpect(status().isNotFound());
    }

    @Test
    void transactionsCanBeFilteredAndOpenedToSeeTheBill() throws Exception {
        Scene s = new Scene();
        String ref = s.paidBill();
        mvc.perform(as(adminToken(), get("/v1/admin/transactions")).param("q", ref.substring(0, 7))).andExpect(jsonPath("$.items", hasSize(1))).andExpect(jsonPath("$.items[0].reference", is(ref))).andExpect(jsonPath("$.items[0].status", is("verified")))
                .andExpect(jsonPath("$.items[0].customerName", is("Meera I."))).andExpect(jsonPath("$.items[0].payee", containsString("Platform place"))).andExpect(jsonPath("$.items[0].amount", is(70000)))
                .andExpect(jsonPath("$.totals.verifiedAmount", is(70000))).andExpect(jsonPath("$.totals.savings", is(30000)));
        mvc.perform(as(adminToken(), get("/v1/admin/transactions")).param("status", "verified").param("kind", "redemption").param("q", "Platform place")).andExpect(jsonPath("$.total", greaterThanOrEqualTo(1)));
        mvc.perform(as(adminToken(), get("/v1/admin/transactions")).param("status", "failed").param("q", ref)).andExpect(jsonPath("$.items", hasSize(0)));
        mvc.perform(as(adminToken(), get("/v1/admin/transactions/" + ref))).andExpect(jsonPath("$.row.reference", is(ref))).andExpect(jsonPath("$.lines[0].label", is("Dinner"))).andExpect(jsonPath("$.eligibleAmount", is(100000)))
                .andExpect(jsonPath("$.discount", is(30000))).andExpect(jsonPath("$.providerPaymentId").exists()).andExpect(jsonPath("$.raisedBy", is("Manager")));
        mvc.perform(as(adminToken(), get("/v1/admin/transactions/VB-NOPE-NOPE"))).andExpect(status().isNotFound());
    }

    @Test
    void deletionRequestsAreListedAndMarkedDoneOnce() throws Exception {
        String customer = customerToken(phone());
        mvc.perform(as(customer, post("/v1/me/deletion-request"))).andExpect(status().isNoContent());
        String name = "VIBE member";
        String reqId = JsonPath.read(mvc.perform(as(adminToken(), get("/v1/admin/deletion-requests")).param("status", "pending")).andExpect(jsonPath("$[0].name", is(name))).andReturn().getResponse().getContentAsString(), "$[0].id");
        mvc.perform(as(adminToken(), post("/v1/admin/deletion-requests/" + reqId + "/complete"))).andExpect(status().isNoContent());
        mvc.perform(as(adminToken(), post("/v1/admin/deletion-requests/" + reqId + "/complete"))).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("not_pending")));
        mvc.perform(as(adminToken(), get("/v1/admin/deletion-requests")).param("status", "done")).andExpect(jsonPath("$[?(@.id=='" + reqId + "')]", hasSize(1)));
    }

    // ---------- merchant applications ----------
    String application(String email) {
        return "{\"businessName\":\"New Cafe " + uniq() + "\",\"area\":\"Madhapur\",\"address\":\"Plot 4\",\"contactName\":\"Rohan Das\",\"email\":\"" + email + "\",\"phone\":\"+91 98765 43210\",\"about\":\"A small cafe\",\"documents\":[\"https://example.com/fssai.pdf\"]}";
    }

    @Test
    void aBusinessAppliesChecksItsStatusAndAdminsAreTold() throws Exception {
        String email = "apply-" + uniq() + "@test.local";
        MvcResult r = mvc.perform(post("/v1/business-applications").contentType(org.springframework.http.MediaType.APPLICATION_JSON).content(application(email))).andExpect(status().isCreated()).andExpect(jsonPath("$.statusToken").exists()).andReturn();
        String id = JsonPath.read(r.getResponse().getContentAsString(), "$.id"), token = JsonPath.read(r.getResponse().getContentAsString(), "$.statusToken");
        mvc.perform(get("/v1/business-applications/" + id).param("token", token)).andExpect(status().isOk()).andExpect(jsonPath("$.status", is("pending")));
        mvc.perform(get("/v1/business-applications/" + id).param("token", "wrong")).andExpect(status().isNotFound());
        mvc.perform(get("/v1/business-applications/" + id)).andExpect(status().isBadRequest());
        mvc.perform(as(adminToken(), get("/v1/staff/notifications")).param("limit", "100")).andExpect(jsonPath("$.items[?(@.kind=='application' && @.body=~/.*New Cafe.*/)]", not(hasSize(0))));
        mvc.perform(as(adminToken(), get("/v1/admin/applications")).param("status", "pending")).andExpect(jsonPath("$[?(@.id=='" + id + "')].email", hasItem(email)));
        mvc.perform(as(adminToken(), get("/v1/admin/applications/" + id))).andExpect(jsonPath("$.documents[0]", is("https://example.com/fssai.pdf"))).andExpect(jsonPath("$.row.phone", is("9876543210")));
    }

    @Test
    void applicationsAreValidatedAndRateLimitedPerEmail() throws Exception {
        String email = "limit-" + uniq() + "@test.local";
        mvc.perform(post("/v1/business-applications").contentType(org.springframework.http.MediaType.APPLICATION_JSON).content(application(email).replace("+91 98765 43210", "12345"))).andExpect(status().isBadRequest());
        mvc.perform(post("/v1/business-applications").contentType(org.springframework.http.MediaType.APPLICATION_JSON).content(application("not-an-email"))).andExpect(status().isBadRequest());
        mvc.perform(post("/v1/business-applications").contentType(org.springframework.http.MediaType.APPLICATION_JSON).content(application(email).replace("https://example.com/fssai.pdf", "javascript:alert(1)"))).andExpect(status().isBadRequest());
        mvc.perform(post("/v1/business-applications").contentType(org.springframework.http.MediaType.APPLICATION_JSON).content(application(email).replace("\"area\":\"Madhapur\",", "\"area\":\"Madhapur\",\"categoryId\":\"" + java.util.UUID.randomUUID() + "\","))).andExpect(status().isBadRequest());
        for (int i = 0; i < 3; i++) mvc.perform(post("/v1/business-applications").contentType(org.springframework.http.MediaType.APPLICATION_JSON).content(application(email))).andExpect(status().isCreated());
        mvc.perform(post("/v1/business-applications").contentType(org.springframework.http.MediaType.APPLICATION_JSON).content(application(email))).andExpect(status().isTooManyRequests()).andExpect(jsonPath("$.code", is("too_many_applications")));
    }

    @Test
    void changesAreRequestedTheApplicantResubmitsAndAdminApproves() throws Exception {
        String cat = category(null, "Applicants " + uniq());
        String email = "flow-" + uniq() + "@test.local";
        MvcResult r = mvc.perform(post("/v1/business-applications").contentType(org.springframework.http.MediaType.APPLICATION_JSON).content(application(email))).andReturn();
        String id = JsonPath.read(r.getResponse().getContentAsString(), "$.id"), token = JsonPath.read(r.getResponse().getContentAsString(), "$.statusToken");

        mvc.perform(as(adminToken(), post("/v1/admin/applications/" + id + "/request-changes")).content("{\"note\":\" \"}")).andExpect(status().isBadRequest());
        mvc.perform(as(adminToken(), post("/v1/admin/applications/" + id + "/request-changes")).content("{\"note\":\"Please add your FSSAI number\"}")).andExpect(status().isOk()).andExpect(jsonPath("$.row.status", is("changes_requested")));
        mvc.perform(get("/v1/business-applications/" + id).param("token", token)).andExpect(jsonPath("$.status", is("changes_requested"))).andExpect(jsonPath("$.reviewNote", is("Please add your FSSAI number")));
        // Only an application waiting for changes can be edited, and only with its token.
        mvc.perform(put("/v1/business-applications/" + id).param("token", "wrong").contentType(org.springframework.http.MediaType.APPLICATION_JSON).content(application(email))).andExpect(status().isNotFound());
        mvc.perform(put("/v1/business-applications/" + id).param("token", token).contentType(org.springframework.http.MediaType.APPLICATION_JSON).content(application(email).replace("A small cafe", "A small cafe, FSSAI 12345")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status", is("pending")));
        mvc.perform(put("/v1/business-applications/" + id).param("token", token).contentType(org.springframework.http.MediaType.APPLICATION_JSON).content(application(email))).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("not_editable")));

        // Approval needs a category, creates the listing switched off, and an owner login with a one-time password.
        mvc.perform(as(adminToken(), post("/v1/admin/applications/" + id + "/approve")).content("{}")).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code", is("category")));
        MvcResult ok = mvc.perform(as(adminToken(), post("/v1/admin/applications/" + id + "/approve")).content("{\"categoryId\":\"" + cat + "\"}")).andExpect(status().isOk()).andExpect(jsonPath("$.loginEmail", is(email)))
                .andExpect(jsonPath("$.temporaryPassword", matchesPattern("[A-Za-z0-9]{14}"))).andReturn();
        String bizId = JsonPath.read(ok.getResponse().getContentAsString(), "$.businessId"), temp = JsonPath.read(ok.getResponse().getContentAsString(), "$.temporaryPassword");
        mvc.perform(as(adminToken(), get("/v1/admin/businesses/" + bizId))).andExpect(jsonPath("$.active", is(false))).andExpect(jsonPath("$.verified", is(false))).andExpect(jsonPath("$.primaryCategoryId", is(cat))).andExpect(jsonPath("$.description", containsString("FSSAI 12345")));
        mvc.perform(get("/v1/businesses/" + bizId)).andExpect(status().isNotFound()); // not public until VIBE switches it on
        mvc.perform(get("/v1/business-applications/" + id).param("token", token)).andExpect(jsonPath("$.status", is("approved")));
        mvc.perform(as(adminToken(), post("/v1/admin/applications/" + id + "/approve")).content("{\"categoryId\":\"" + cat + "\"}")).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("decided")));
        mvc.perform(as(adminToken(), post("/v1/admin/applications/" + id + "/reject")).content("{\"note\":\"x\"}")).andExpect(status().isConflict());

        // The new owner's first sign-in: only a password change is allowed until it's done.
        String t1 = login(email, temp);
        mvc.perform(as(t1, get("/v1/staff/me"))).andExpect(jsonPath("$.mustChangePassword", is(true))).andExpect(jsonPath("$.owner", is(true)));
        mvc.perform(as(t1, get("/v1/merchant/business"))).andExpect(status().isForbidden()).andExpect(jsonPath("$.code", is("password_change_required")));
        mvc.perform(as(t1, post("/v1/staff/password")).content("{\"current\":\"wrong-wrong-wrong\",\"next\":\"my-own-new-password\"}")).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code", is("wrong_password")));
        mvc.perform(as(t1, post("/v1/staff/password")).content("{\"current\":\"" + temp + "\",\"next\":\"" + temp + "\"}")).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code", is("same_password")));
        mvc.perform(as(t1, post("/v1/staff/password")).content("{\"current\":\"" + temp + "\",\"next\":\"short\"}")).andExpect(status().isBadRequest());
        String t2 = JsonPath.read(mvc.perform(as(t1, post("/v1/staff/password")).content("{\"current\":\"" + temp + "\",\"next\":\"my-own-new-password\"}")).andExpect(status().isOk()).andExpect(jsonPath("$.staff.mustChangePassword", is(false))).andReturn().getResponse().getContentAsString(), "$.token");
        mvc.perform(as(t2, get("/v1/merchant/business"))).andExpect(status().isOk()).andExpect(jsonPath("$.id", is(bizId)));
        mvc.perform(post("/v1/staff/login").contentType(org.springframework.http.MediaType.APPLICATION_JSON).content("{\"email\":\"" + email + "\",\"password\":\"" + temp + "\"}")).andExpect(status().isUnauthorized()); // the one-time password is spent
        login(email, "my-own-new-password");
    }

    @Test
    void aRejectionNeedsAReasonAndCannotBeUndoneAndAnExistingEmailBlocksApproval() throws Exception {
        MvcResult r = mvc.perform(post("/v1/business-applications").contentType(org.springframework.http.MediaType.APPLICATION_JSON).content(application("rej-" + uniq() + "@test.local"))).andReturn();
        String id = JsonPath.read(r.getResponse().getContentAsString(), "$.id"), token = JsonPath.read(r.getResponse().getContentAsString(), "$.statusToken");
        mvc.perform(as(adminToken(), post("/v1/admin/applications/" + id + "/reject")).content("{}")).andExpect(status().isBadRequest());
        mvc.perform(as(adminToken(), post("/v1/admin/applications/" + id + "/reject")).content("{\"note\":\"We don’t list this kind of business yet\"}")).andExpect(status().isOk()).andExpect(jsonPath("$.row.status", is("rejected")));
        mvc.perform(get("/v1/business-applications/" + id).param("token", token)).andExpect(jsonPath("$.reviewNote", is("We don’t list this kind of business yet")));
        mvc.perform(as(adminToken(), post("/v1/admin/applications/" + id + "/approve")).content("{\"categoryId\":\"" + category(null, "Late " + uniq()) + "\"}")).andExpect(status().isConflict());

        String taken = "taken-" + uniq() + "@test.local";
        staff.createAdmin(taken, "Existing", PASSWORD);
        String id2 = JsonPath.read(mvc.perform(post("/v1/business-applications").contentType(org.springframework.http.MediaType.APPLICATION_JSON).content(application(taken))).andReturn().getResponse().getContentAsString(), "$.id");
        mvc.perform(as(adminToken(), post("/v1/admin/applications/" + id2 + "/approve")).content("{\"categoryId\":\"" + category(null, "Dup " + uniq()) + "\"}")).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("duplicate")));
        org.junit.jupiter.api.Assertions.assertEquals(0, jdbc.sql("select count(*) from businesses where name = (select business_name from merchant_applications where id = cast(:i as uuid))").param("i", id2).query(Integer.class).single(), "a failed approval leaves no half-made listing");
    }

    // ---------- first sign-in password change for logins made by someone else ----------
    @Test
    void aLoginAnAdminCreatedMustChooseItsOwnPasswordFirst() throws Exception {
        String biz = business(category(null, "Gate " + uniq()), "Gate place " + uniq());
        String email = "gate-" + uniq() + "@test.local";
        mvc.perform(as(adminToken(), post("/v1/admin/businesses/" + biz + "/staff")).content("{\"email\":\"" + email + "\",\"name\":\"New\",\"password\":\"" + PASSWORD + "\"}")).andExpect(status().isCreated()).andExpect(jsonPath("$.mustChangePassword", is(true)));
        String t = login(email, PASSWORD);
        mvc.perform(as(t, get("/v1/merchant/menu"))).andExpect(status().isForbidden()).andExpect(jsonPath("$.code", is("password_change_required")));
        mvc.perform(as(t, post("/v1/staff/notifications/read"))).andExpect(status().isForbidden());
        mvc.perform(as(t, get("/v1/staff/me"))).andExpect(status().isOk());
        // Admins resetting a password also force a change.
        String id = JsonPath.read(mvc.perform(as(t, get("/v1/staff/me"))).andReturn().getResponse().getContentAsString(), "$.id");
        String settled = JsonPath.read(mvc.perform(as(t, post("/v1/staff/password")).content("{\"current\":\"" + PASSWORD + "\",\"next\":\"settled-password-1\"}")).andReturn().getResponse().getContentAsString(), "$.token");
        mvc.perform(as(settled, get("/v1/merchant/menu"))).andExpect(status().isOk());
        mvc.perform(as(adminToken(), put("/v1/admin/staff/" + id + "/password")).content("{\"password\":\"reset-by-admin-1\"}")).andExpect(status().isNoContent());
        mvc.perform(as(login(email, "reset-by-admin-1"), get("/v1/merchant/menu"))).andExpect(status().isForbidden());
    }
}
