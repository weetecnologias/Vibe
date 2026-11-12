package in.vibe.backend;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MvcResult;

import java.nio.charset.StandardCharsets;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.startsWith;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Paying merchants: what is owed, settlements, the merchant being told, spreadsheet downloads, merchant results, and auto-approval for trusted businesses. */
class SettlementTest extends ApiTestSupport {
    static final String BILL_1000 = "[{\"label\":\"Biryani\",\"amount\":60000},{\"label\":\"Kebab\",\"amount\":40000}]";

    /** A business with a merchant and a live 30% offer (cap ₹500, minimum ₹500). */
    class Place {
        final String biz = business(category(null, "Settle " + uniq()), "Settle place " + uniq());
        final String merchant = merchant(biz);
        final String offer = liveOffer(merchant, false);

        Place() throws Exception {}

        /** A new customer redeems, the merchant bills ₹1,000, the customer pays ₹700 and the (simulated) partner confirms. Returns the transaction ID. */
        String paidBill() throws Exception {
            String customer = customerToken(phone());
            String red = id(mvc.perform(as(customer, post("/v1/redemptions")).content("{\"offerId\":\"" + offer + "\"}")).andExpect(status().is2xxSuccessful()).andReturn());
            mvc.perform(as(merchant, post("/v1/merchant/bills/" + red)).content("{\"lines\":" + BILL_1000 + "}")).andExpect(status().isCreated());
            String pr = JsonPath.read(mvc.perform(as(customer, get("/v1/redemptions/" + red))).andReturn().getResponse().getContentAsString(), "$.paymentRequest.id");
            MvcResult r = mvc.perform(as(customer, post("/v1/payment-requests/" + pr + "/payments")).header("Idempotency-Key", "pay-" + uniq()).content("{\"method\":\"upi\"}")).andExpect(status().isCreated()).andReturn();
            String ref = JsonPath.read(r.getResponse().getContentAsString(), "$.reference");
            mvc.perform(as(customer, get("/v1/payments/" + ref))).andExpect(jsonPath("$.status", is("verified")));
            return ref;
        }

        void terms(int commissionBps, boolean autoApprove) throws Exception {
            mvc.perform(as(adminToken(), put("/v1/admin/businesses/" + biz + "/terms")).content("{\"commissionBps\":" + commissionBps + ",\"autoApprove\":" + autoApprove + ",\"reason\":\"Agreed in the contract\"}"))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.commissionBps", is(commissionBps))).andExpect(jsonPath("$.autoApprove", is(autoApprove)));
        }
    }

    @Test
    void paidBillsAreOwedToTheMerchantAndASettlementCoversThemOnceAndTellsTheMerchant() throws Exception {
        Place p = new Place();
        p.terms(1000, false); // 10% commission
        String ref1 = p.paidBill(), ref2 = p.paidBill();

        // Owed: 2 × ₹700 collected, 10% commission = ₹140, ₹1,260 to pay.
        mvc.perform(as(adminToken(), get("/v1/admin/settlements/due"))).andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.businessId=='" + p.biz + "')].count", hasItem(2))).andExpect(jsonPath("$[?(@.businessId=='" + p.biz + "')].gross", hasItem(140000)))
                .andExpect(jsonPath("$[?(@.businessId=='" + p.biz + "')].commission", hasItem(14000))).andExpect(jsonPath("$[?(@.businessId=='" + p.biz + "')].payout", hasItem(126000)))
                .andExpect(jsonPath("$[?(@.businessId=='" + p.biz + "')].customerSavings", hasItem(60000)));
        mvc.perform(as(p.merchant, get("/v1/merchant/settlements"))).andExpect(jsonPath("$.unsettled.count", is(2))).andExpect(jsonPath("$.unsettled.payout", is(126000))).andExpect(jsonPath("$.commissionBps", is(1000)));

        MvcResult created = mvc.perform(as(adminToken(), post("/v1/admin/settlements")).content("{\"businessId\":\"" + p.biz + "\"}")).andExpect(status().isCreated())
                .andExpect(jsonPath("$.summary.reference", startsWith("ST-"))).andExpect(jsonPath("$.summary.status", is("pending"))).andExpect(jsonPath("$.summary.paymentCount", is(2)))
                .andExpect(jsonPath("$.summary.gross", is(140000))).andExpect(jsonPath("$.summary.commission", is(14000))).andExpect(jsonPath("$.summary.payout", is(126000)))
                .andExpect(jsonPath("$.items", hasSize(2))).andExpect(jsonPath("$.items[*].paymentReference", hasItem(ref1))).andExpect(jsonPath("$.items[*].paymentReference", hasItem(ref2)))
                .andExpect(jsonPath("$.items[0].payout", is(63000))).andReturn();
        String id = JsonPath.read(created.getResponse().getContentAsString(), "$.summary.id");
        String reference = JsonPath.read(created.getResponse().getContentAsString(), "$.summary.reference");

        // Nothing is settled twice.
        mvc.perform(as(adminToken(), post("/v1/admin/settlements")).content("{\"businessId\":\"" + p.biz + "\"}")).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("nothing_to_settle")));
        mvc.perform(as(adminToken(), get("/v1/admin/settlements/due"))).andExpect(jsonPath("$[?(@.businessId=='" + p.biz + "')]", hasSize(0)));

        // The merchant is told, and sees it waiting to be paid.
        mvc.perform(as(p.merchant, get("/v1/staff/notifications"))).andExpect(jsonPath("$.items[?(@.kind=='settlement_created')].title", hasItem(containsString(reference))));
        mvc.perform(as(p.merchant, get("/v1/merchant/settlements"))).andExpect(jsonPath("$.unsettled.count", is(0))).andExpect(jsonPath("$.awaitingPayout", is(126000)))
                .andExpect(jsonPath("$.settlements[0].reference", is(reference)));
        mvc.perform(as(p.merchant, get("/v1/merchant/settlements/" + id))).andExpect(status().isOk()).andExpect(jsonPath("$.items", hasSize(2)));

        // Marking it paid needs the bank reference, happens once, and tells the merchant.
        mvc.perform(as(adminToken(), post("/v1/admin/settlements/" + id + "/paid")).content("{\"payoutRef\":\"\"}")).andExpect(status().isBadRequest());
        mvc.perform(as(adminToken(), post("/v1/admin/settlements/" + id + "/paid")).content("{\"payoutRef\":\"UTR123456789\"}")).andExpect(status().isOk())
                .andExpect(jsonPath("$.summary.status", is("paid"))).andExpect(jsonPath("$.summary.payoutRef", is("UTR123456789"))).andExpect(jsonPath("$.summary.paidAt").exists());
        mvc.perform(as(adminToken(), post("/v1/admin/settlements/" + id + "/paid")).content("{\"payoutRef\":\"UTR999\"}")).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("already_paid")));
        mvc.perform(as(p.merchant, get("/v1/staff/notifications"))).andExpect(jsonPath("$.items[?(@.kind=='settlement_paid')].body", hasItem(containsString("UTR123456789"))));
        mvc.perform(as(p.merchant, get("/v1/merchant/settlements"))).andExpect(jsonPath("$.awaitingPayout", is(0))).andExpect(jsonPath("$.paidOut", is(126000)));
        assertEquals(2, jdbc.sql("select count(*) from audit_log where entity = 'settlement' and entity_id = :id").param("id", id).query(Integer.class).single());

        // Another merchant can't see it, and merchants can't use the admin side.
        Place other = new Place();
        mvc.perform(as(other.merchant, get("/v1/merchant/settlements/" + id))).andExpect(status().isNotFound());
        mvc.perform(as(other.merchant, get("/v1/merchant/settlements/" + id + "/export"))).andExpect(status().isNotFound());
        mvc.perform(as(p.merchant, get("/v1/admin/settlements/due"))).andExpect(status().isForbidden());
        mvc.perform(as(p.merchant, get("/v1/admin/exports/transactions"))).andExpect(status().isForbidden());
    }

    @Test
    void settlementsAndListsDownloadAsSpreadsheetsThatMatchTheScreens() throws Exception {
        Place p = new Place();
        String ref = p.paidBill();
        String id = JsonPath.read(mvc.perform(as(adminToken(), post("/v1/admin/settlements")).content("{\"businessId\":\"" + p.biz + "\"}")).andExpect(status().isCreated()).andReturn()
                .getResponse().getContentAsString(), "$.summary.id");

        MvcResult file = mvc.perform(as(adminToken(), get("/v1/admin/exports/settlements/" + id))).andExpect(status().isOk())
                .andExpect(header().string("Content-Disposition", containsString("attachment"))).andExpect(content().contentTypeCompatibleWith("text/csv")).andReturn();
        String csv = file.getResponse().getContentAsString(StandardCharsets.UTF_8);
        assertTrue(csv.startsWith("﻿Transaction ID,"), "opens in Excel with ₹ and names intact");
        assertTrue(csv.contains(ref + ","), "every payment is listed by its transaction ID");
        assertTrue(csv.contains("700.00"), "amounts are rupees Excel can add up");

        mvc.perform(as(p.merchant, get("/v1/merchant/settlements/" + id + "/export"))).andExpect(status().isOk()).andExpect(content().string(containsString(ref)));
        mvc.perform(as(adminToken(), get("/v1/admin/exports/transactions").param("q", ref))).andExpect(status().isOk()).andExpect(content().string(containsString(ref)));
        mvc.perform(as(adminToken(), get("/v1/admin/exports/settlements"))).andExpect(status().isOk()).andExpect(content().string(containsString("Settlement ID,Merchant")));
        mvc.perform(as(adminToken(), get("/v1/admin/exports/settlements-due"))).andExpect(status().isOk());
        mvc.perform(as(adminToken(), get("/v1/admin/exports/members"))).andExpect(status().isOk()).andExpect(content().string(containsString("Member no,Name")));
        mvc.perform(as(adminToken(), get("/v1/admin/exports/customers"))).andExpect(status().isOk()).andExpect(content().string(containsString("VIBE ID,Name,Phone")));
    }

    @Test
    void theMerchantSeesWhatVibeBroughtThem() throws Exception {
        Place p = new Place();
        p.paidBill();
        p.paidBill();
        mvc.perform(as(p.merchant, get("/v1/merchant/results").param("days", "30"))).andExpect(status().isOk())
                .andExpect(jsonPath("$.paidBills", is(2))).andExpect(jsonPath("$.customers", is(2))).andExpect(jsonPath("$.sales", is(140000))).andExpect(jsonPath("$.discountGiven", is(60000)))
                .andExpect(jsonPath("$.averageBill", is(70000))).andExpect(jsonPath("$.redemptionsStarted", is(2))).andExpect(jsonPath("$.offersLive", is(1)))
                .andExpect(jsonPath("$.offers[0].paid", is(2))).andExpect(jsonPath("$.offers[0].live", is(true))).andExpect(jsonPath("$.lastDays", hasSize(14)))
                .andExpect(jsonPath("$.unsettled.count", is(2)));
    }

    @Test
    void trustedBusinessesGoLiveWithoutWaitingAndAdminsAreTold() throws Exception {
        Place p = new Place();
        mvc.perform(as(adminToken(), put("/v1/admin/businesses/" + p.biz + "/terms")).content("{\"commissionBps\":0,\"autoApprove\":true}")).andExpect(status().isBadRequest()); // a reason is required
        p.terms(0, true);
        mvc.perform(as(p.merchant, get("/v1/staff/notifications"))).andExpect(jsonPath("$.items[?(@.kind=='auto_approve')]", hasSize(1)));

        String offer = id(mvc.perform(as(p.merchant, post("/v1/merchant/offers")).content("""
            {"title":"Trusted 20%","kind":"percentage","rateBps":2000,"startsAt":"2026-01-01T00:00:00Z","endsAt":"2031-01-01T00:00:00Z"}""")).andExpect(status().isCreated())
                .andExpect(jsonPath("$.reviewStatus", is("approved"))).andReturn());
        mvc.perform(get("/v1/offers/" + offer)).andExpect(status().isOk());
        mvc.perform(as(adminToken(), get("/v1/admin/offers"))).andExpect(jsonPath("$[?(@.id=='" + offer + "')].autoApproved", hasItem(true)));
        assertEquals(1, jdbc.sql("select count(*) from audit_log where action = 'auto_approve' and entity_id = :id").param("id", offer).query(Integer.class).single());

        String event = id(mvc.perform(as(p.merchant, post("/v1/merchant/events")).content(ContentToolsTest.eventJson("Trusted night " + uniq(), 10))).andExpect(status().isCreated())
                .andExpect(jsonPath("$.status", is("published"))).andReturn());
        mvc.perform(get("/v1/events/" + event)).andExpect(status().isOk());
        mvc.perform(as(adminToken(), get("/v1/admin/events"))).andExpect(jsonPath("$[?(@.id=='" + event + "')].autoApproved", hasItem(true)));

        // Trust taken away: new offers wait for review again.
        p.terms(0, false);
        mvc.perform(as(p.merchant, post("/v1/merchant/offers")).content("""
            {"title":"Reviewed 10%","kind":"percentage","rateBps":1000,"startsAt":"2026-01-01T00:00:00Z","endsAt":"2031-01-01T00:00:00Z"}""")).andExpect(status().isCreated())
                .andExpect(jsonPath("$.reviewStatus", is("pending")));
    }
}
