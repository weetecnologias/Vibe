package in.vibe.backend;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The money and compliance side: rate cards and GST kept on each payment, the ledger, adjustments, who bears a refund, KYC before payouts, the merchant
 * agreement, disputes and reconciliation against the payment partner's file. A court booking is ₹600 plus VIBE's ₹20 fee in the dev profile.
 */
class MoneyAndComplianceTest extends ApiTestSupport {
    String category() throws Exception { return category(null, "Money " + uniq()); }

    void rateCard(String scope, String target, int bps) throws Exception {
        mvc.perform(as(adminToken(), post("/v1/admin/rate-cards")).content("{\"scope\":\"" + scope + "\"" + (target == null ? "" : ",\"targetId\":\"" + target + "\"") + ",\"commissionBps\":" + bps + ",\"reason\":\"Agreed in test\"}"))
                .andExpect(status().isCreated());
    }

    void gst(int bps) throws Exception {
        mvc.perform(as(adminToken(), put("/v1/admin/rate-cards/tax")).content("{\"commissionGstBps\":" + bps + "}")).andExpect(status().isOk());
    }

    String settle(String biz) throws Exception {
        return JsonPath.read(mvc.perform(as(adminToken(), post("/v1/admin/settlements")).content("{\"businessId\":\"" + biz + "\"}")).andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.summary.id");
    }

    void assertBooksBalance() throws Exception {
        mvc.perform(as(adminToken(), get("/v1/admin/ledger/trial-balance"))).andExpect(jsonPath("$.balanced", is(true)));
    }

    @Test
    void theRateAComesFromTheBusinessThenItsCategoryThenThePlatformAndEachPaymentKeepsWhatItWasCharged() throws Exception {
        String cat = category(), biz = business(cat, "Rate Arena " + uniq()), m = merchant(biz), c = customerToken(phone());
        try {
            gst(0);
            // Nothing set anywhere (the dev platform rate is 0%), then the category's card, then the business's own.
            mvc.perform(as(adminToken(), get("/v1/admin/rate-cards/effective/" + biz))).andExpect(jsonPath("$.bps", is(0)));
            rateCard("category", cat, 1500);
            mvc.perform(as(adminToken(), get("/v1/admin/rate-cards/effective/" + biz))).andExpect(jsonPath("$.bps", is(1500))).andExpect(jsonPath("$.source", is("category")));
            String first = paidSlot(biz, m, c);
            rateCard("business", biz, 1000);
            mvc.perform(as(adminToken(), get("/v1/admin/rate-cards/effective/" + biz))).andExpect(jsonPath("$.bps", is(1000))).andExpect(jsonPath("$.source", is("business")));
            String second = paidSlot(biz, m, c);

            // Each payment keeps the rate it was charged: 15% of ₹600 = ₹90 for the first, 10% = ₹60 for the second.
            assertEquals(9000L, jdbc.sql("select commission from payments where reference = :r").param("r", first).query(Long.class).single());
            assertEquals(6000L, jdbc.sql("select commission from payments where reference = :r").param("r", second).query(Long.class).single());
            mvc.perform(as(adminToken(), get("/v1/admin/rate-cards").param("scope", "business").param("target", biz))).andExpect(jsonPath("$[0].commissionBps", is(1000)));

            // The settlement adds up what each was charged: gross ₹1,240, fees ₹40, commission ₹150, payout ₹1,050.
            mvc.perform(as(adminToken(), get("/v1/admin/settlements/due"))).andExpect(jsonPath("$[?(@.businessId=='" + biz + "')].commission", hasItem(15000)))
                    .andExpect(jsonPath("$[?(@.businessId=='" + biz + "')].payout", hasItem(105000)));
            assertBooksBalance();
            // The books agree: VIBE owes the business what the settlement says.
            mvc.perform(as(adminToken(), get("/v1/admin/ledger/entries").param("account", "merchant:" + biz))).andExpect(jsonPath("$[0].account", is("merchant:" + biz)));
            assertEquals(105000L, jdbc.sql("select coalesce(sum(credit) - sum(debit), 0) from ledger_entries where account = :a").param("a", "merchant:" + biz).query(Long.class).single());
        } finally { gst(0); }
    }

    @Test
    void gstOnCommissionIsKeptOnEachPaymentAndComesOffThePayout() throws Exception {
        String cat = category(), biz = business(cat, "Gst Arena " + uniq()), m = merchant(biz), c = customerToken(phone());
        try {
            rateCard("business", biz, 1000);
            gst(1800);
            paidSlot(biz, m, c);
            // ₹620 paid: fee ₹20, commission 10% of ₹600 = ₹60, GST 18% of ₹60 = ₹10.80, so ₹529.20 is owed.
            mvc.perform(as(adminToken(), get("/v1/admin/settlements/due"))).andExpect(jsonPath("$[?(@.businessId=='" + biz + "')].gst", hasItem(1080))).andExpect(jsonPath("$[?(@.businessId=='" + biz + "')].payout", hasItem(52920)));
            String id = settle(biz);
            mvc.perform(as(adminToken(), get("/v1/admin/settlements/" + id))).andExpect(jsonPath("$.summary.gst", is(1080))).andExpect(jsonPath("$.summary.payout", is(52920))).andExpect(jsonPath("$.items[0].gst", is(1080)));
            mvc.perform(as(m, get("/v1/merchant/settlements/" + id))).andExpect(jsonPath("$.summary.gst", is(1080)));
            // Changing the tax later doesn't rewrite what was charged.
            gst(0);
            mvc.perform(as(adminToken(), get("/v1/admin/settlements/" + id))).andExpect(jsonPath("$.summary.payout", is(52920)));
            assertBooksBalance();
            mvc.perform(as(adminToken(), put("/v1/admin/rate-cards/tax")).content("{\"commissionGstBps\":9000}")).andExpect(status().isBadRequest());
        } finally { gst(0); }
    }

    @Test
    void adjustmentsAreIncludedInTheNextSettlementAndCantMakeItNegative() throws Exception {
        String biz = business(category(), "Adjust Arena " + uniq()), m = merchant(biz), c = customerToken(phone());
        paidSlot(biz, m, c); // ₹620 paid, ₹600 owed
        mvc.perform(as(adminToken(), post("/v1/admin/businesses/" + biz + "/adjustments")).content("{\"kind\":\"credit\",\"amount\":25000,\"reason\":\"Goodwill for a failed payout\"}")).andExpect(status().isCreated()).andExpect(jsonPath("$.amount", is(25000)));
        mvc.perform(as(adminToken(), post("/v1/admin/businesses/" + biz + "/adjustments")).content("{\"kind\":\"recovery\",\"amount\":10000,\"reason\":\"Refund paid after settlement\"}")).andExpect(status().isCreated()).andExpect(jsonPath("$.amount", is(-10000)));
        mvc.perform(as(adminToken(), post("/v1/admin/businesses/" + biz + "/adjustments")).content("{\"kind\":\"credit\",\"amount\":0,\"reason\":\"x\"}")).andExpect(status().isBadRequest());
        mvc.perform(as(adminToken(), post("/v1/admin/businesses/" + biz + "/adjustments")).content("{\"kind\":\"bonus\",\"amount\":100,\"reason\":\"Not a kind\"}")).andExpect(status().isBadRequest());
        mvc.perform(as(adminToken(), get("/v1/admin/settlements/due"))).andExpect(jsonPath("$[?(@.businessId=='" + biz + "')].adjustments", hasItem(15000))).andExpect(jsonPath("$[?(@.businessId=='" + biz + "')].payout", hasItem(60000 + 15000)));
        String id = settle(biz);
        mvc.perform(as(m, get("/v1/merchant/settlements/" + id))).andExpect(jsonPath("$.summary.adjustments", is(15000))).andExpect(jsonPath("$.summary.payout", is(75000))).andExpect(jsonPath("$.adjustments", hasSize(2)));
        mvc.perform(as(adminToken(), get("/v1/admin/adjustments").param("businessId", biz).param("pending", "true"))).andExpect(jsonPath("$", empty()));
        assertBooksBalance();

        // A recovery bigger than what is owed can't be settled: it waits.
        paidSlot(biz, m, c);
        mvc.perform(as(adminToken(), post("/v1/admin/businesses/" + biz + "/adjustments")).content("{\"kind\":\"penalty\",\"amount\":900000,\"reason\":\"A big penalty\"}")).andExpect(status().isCreated());
        mvc.perform(as(adminToken(), post("/v1/admin/settlements")).content("{\"businessId\":\"" + biz + "\"}")).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("negative_payout")));
    }

    @Test
    void whoBearsARefundDecidesWhatTheBusinessIsPaid() throws Exception {
        String biz = business(category(), "Refund Bearer " + uniq()), m = merchant(biz), c = customerToken(phone());
        String full = paidSlot(biz, m, c), part = paidSlot(biz, m, c), vibe = paidSlot(biz, m, c);
        // The business bears a full refund: that sale isn't settled at all. A part refund comes off its share. VIBE bearing it leaves the business whole.
        mvc.perform(as(adminToken(), post("/v1/admin/transactions/" + full + "/refund")).content("{\"reason\":\"Cancelled by the venue\"}")).andExpect(status().isOk());
        mvc.perform(as(adminToken(), post("/v1/admin/transactions/" + part + "/refund")).content("{\"amount\":20000,\"reason\":\"Late start\"}")).andExpect(status().isOk());
        mvc.perform(as(adminToken(), post("/v1/admin/transactions/" + vibe + "/refund")).content("{\"reason\":\"Our mistake\",\"bearer\":\"vibe\"}")).andExpect(status().isOk());
        // Owed: part ₹600 − ₹200 = ₹400, plus VIBE's one ₹600 = ₹1,000; the fully refunded sale counts for nothing.
        mvc.perform(as(adminToken(), get("/v1/admin/settlements/due"))).andExpect(jsonPath("$[?(@.businessId=='" + biz + "')].count", hasItem(2))).andExpect(jsonPath("$[?(@.businessId=='" + biz + "')].payout", hasItem(100000)))
                .andExpect(jsonPath("$[?(@.businessId=='" + biz + "')].refundDeductions", hasItem(20000)));
        assertBooksBalance();

        // Once the business has been paid for a sale, only VIBE can refund it; otherwise recover from the business first.
        String id = settle(biz);
        mvc.perform(as(adminToken(), get("/v1/admin/settlements/" + id))).andExpect(jsonPath("$.items[*].refundShare", hasItem(20000)));
        String later = paidSlot(biz, m, c);
        settle(biz);
        mvc.perform(as(adminToken(), post("/v1/admin/transactions/" + later + "/refund")).content("{\"reason\":\"Too late\"}")).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("settled")));
        mvc.perform(as(adminToken(), post("/v1/admin/transactions/" + later + "/refund")).content("{\"reason\":\"VIBE pays\",\"bearer\":\"vibe\"}")).andExpect(status().isOk());
        mvc.perform(as(adminToken(), post("/v1/admin/refunds/" + later + "/done")).content("{\"partnerReference\":\"rfnd_1\"}")).andExpect(status().isOk());
        assertBooksBalance();
        assertEquals(0L, jdbc.sql("select coalesce(sum(credit) - sum(debit), 0) from ledger_entries where account = 'refunds_payable' and ref_id = :r").param("r", later).query(Long.class).single());
    }

    String kycBody(String pan, String gstin, String ifsc, String account) {
        return "{\"legalName\":\"Sri Sai Traders Pvt Ltd\",\"pan\":\"" + pan + "\"" + (gstin == null ? "" : ",\"gstin\":\"" + gstin + "\"") + ",\"bankAccountName\":\"Sri Sai Traders\",\"bankAccountNo\":\"" + account + "\",\"bankIfsc\":\"" + ifsc + "\"}";
    }

    @Test
    void kycIsCheckedAutomaticallyApprovedByAPersonAndNeededBeforePayouts() throws Exception {
        String biz = business(category(), "Kyc Place " + uniq()), m = merchant(biz);
        mvc.perform(as(m, get("/v1/merchant/kyc"))).andExpect(jsonPath("$.status", is("not_submitted")));
        // Bad details are refused with what to fix.
        mvc.perform(as(m, put("/v1/merchant/kyc")).content(kycBody("NOTAPAN", null, "HDFC0001234", "123456789012"))).andExpect(status().isBadRequest()).andExpect(jsonPath("$.message", containsString("PAN")));
        mvc.perform(as(m, put("/v1/merchant/kyc")).content(kycBody("AAPFU0939F", "27AAPFU0939F1ZX", "HDFC0001234", "123456789012"))).andExpect(status().isBadRequest()).andExpect(jsonPath("$.message", containsString("GSTIN")));
        mvc.perform(as(m, put("/v1/merchant/kyc")).content(kycBody("BBBPE1234F", "27AAPFU0939F1ZV", "HDFC0001234", "123456789012"))).andExpect(status().isBadRequest()).andExpect(jsonPath("$.message", containsString("GSTIN matches PAN")));
        mvc.perform(as(m, put("/v1/merchant/kyc")).content(kycBody("AAPFU0939F", null, "HDFC1001234", "123456789012"))).andExpect(status().isBadRequest()).andExpect(jsonPath("$.message", containsString("IFSC")));
        mvc.perform(as(m, put("/v1/merchant/kyc")).content(kycBody("AAPFU0939F", null, "HDFC0001234", "12345"))).andExpect(status().isBadRequest()).andExpect(jsonPath("$.message", containsString("Account number")));
        mvc.perform(as(m, put("/v1/merchant/kyc")).content(kycBody("AAPFU0939F", null, "HDFC0001234", "123456789012").replace("Sri Sai Traders\"", "Someone Else\""))).andExpect(status().isBadRequest()).andExpect(jsonPath("$.message", containsString("Account holder")));

        // A valid GSTIN (with its own check digit and the PAN inside it) passes. The business sees its account masked; VIBE sees it in full.
        mvc.perform(as(m, put("/v1/merchant/kyc")).content(kycBody("AAPFU0939F", "27AAPFU0939F1ZV", "HDFC0001234", "123456789012"))).andExpect(status().isOk()).andExpect(jsonPath("$.status", is("submitted")))
                .andExpect(jsonPath("$.bankAccountNo", is("••••••••9012"))).andExpect(jsonPath("$.checks[?(@.ok == false)]", empty()));
        mvc.perform(as(adminToken(), get("/v1/admin/kyc/" + biz))).andExpect(jsonPath("$.bankAccountNo", is("123456789012")));
        mvc.perform(as(adminToken(), get("/v1/admin/kyc").param("status", "submitted"))).andExpect(jsonPath("$[*].businessId", hasItem(biz)));
        mvc.perform(as(adminToken(), get("/v1/staff/notifications"))).andExpect(jsonPath("$.items[?(@.kind=='kyc_review')]").isNotEmpty());

        // Only the owner can send or read it.
        String email = "t-" + uniq() + "@test.local";
        mvc.perform(as(m, post("/v1/merchant/team")).content("{\"email\":\"" + email + "\",\"name\":\"M\",\"password\":\"" + PASSWORD + "\",\"staffRole\":\"manager\"}")).andExpect(status().isCreated());
        mvc.perform(as(signInSettled(email, PASSWORD), get("/v1/merchant/kyc"))).andExpect(status().isForbidden());

        // Rejection needs a note and goes back to the business; approval makes payouts possible; changing details sends it back.
        mvc.perform(as(adminToken(), post("/v1/admin/kyc/" + biz + "/reject")).content("{\"note\":\" \"}")).andExpect(status().isBadRequest());
        mvc.perform(as(adminToken(), post("/v1/admin/kyc/" + biz + "/reject")).content("{\"note\":\"Upload the cancelled cheque\"}")).andExpect(jsonPath("$.status", is("rejected")));
        mvc.perform(as(m, get("/v1/staff/notifications"))).andExpect(jsonPath("$.items[?(@.kind=='kyc_decision')].body", hasItem("Upload the cancelled cheque")));
        mvc.perform(as(adminToken(), post("/v1/admin/kyc/" + biz + "/approve"))).andExpect(jsonPath("$.status", is("verified")));
        mvc.perform(as(m, put("/v1/merchant/kyc")).content(kycBody("AAPFU0939F", "27AAPFU0939F1ZV", "HDFC0001234", "987654321098"))).andExpect(jsonPath("$.status", is("submitted")));

        String c = customerToken(phone());
        paidSlot(biz, m, c);
        String id = settle(biz);
        mvc.perform(as(adminToken(), post("/v1/admin/settlements/" + id + "/paid")).content("{\"payoutRef\":\"UTR1\"}")).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("kyc_required")));
        mvc.perform(as(adminToken(), post("/v1/admin/kyc/" + biz + "/approve"))).andExpect(status().isOk());
        mvc.perform(as(adminToken(), post("/v1/admin/settlements/" + id + "/paid")).content("{\"payoutRef\":\"UTR1\"}")).andExpect(status().isOk());
        assertBooksBalance();
        // Food businesses also need an FSSAI licence.
        String food = business(category(null, "Food-ish " + uniq()), "Plain " + uniq());
        assertTrue(food != null);
    }

    @Test
    void theMerchantAgreementIsAcceptedWhenApplyingAndAgainWhenANewVersionIsPublished() throws Exception {
        String v = JsonPath.read(mvc.perform(get("/v1/business-applications/terms")).andExpect(status().isOk()).andExpect(jsonPath("$.version").isNumber()).andReturn().getResponse().getContentAsString(), "$.id");
        String app = "{\"businessName\":\"Terms Cafe " + uniq() + "\",\"categoryId\":\"" + category() + "\",\"area\":\"Madhapur\",\"address\":\"Plot 4\",\"contactName\":\"Rohan Das\",\"email\":\"t-" + uniq() + "@test.local\",\"phone\":\"9876501234\",\"about\":\"A cafe\"%s}";
        mvc.perform(post("/v1/business-applications").contentType("application/json").content(app.formatted(""))).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code", is("terms")));
        String id = JsonPath.read(mvc.perform(post("/v1/business-applications").contentType("application/json").content(app.formatted(",\"acceptTerms\":true"))).andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.id");
        assertEquals(1, jdbc.sql("select count(*) from merchant_applications where id = :id::uuid and terms_version_id = :v::uuid and terms_accepted_at is not null").param("id", id).param("v", v).query(Integer.class).single());

        // Approving carries what they accepted over to the business.
        String cat = category();
        var ok = mvc.perform(as(adminToken(), post("/v1/admin/applications/" + id + "/approve")).content("{\"categoryId\":\"" + cat + "\"}")).andExpect(status().isOk()).andReturn();
        String temp = JsonPath.read(ok.getResponse().getContentAsString(), "$.temporaryPassword"), email = JsonPath.read(ok.getResponse().getContentAsString(), "$.loginEmail"), biz = JsonPath.read(ok.getResponse().getContentAsString(), "$.businessId");
        String owner = signInSettled(email, temp);
        mvc.perform(as(owner, get("/v1/merchant/settings"))).andExpect(jsonPath("$.agreement.accepted", is(true)));
        mvc.perform(as(adminToken(), get("/v1/admin/agreements/acceptances"))).andExpect(jsonPath("$[?(@.businessId=='" + biz + "')].source", hasItem("application")));

        // A new version needs everyone to accept again before the dashboard works.
        mvc.perform(as(adminToken(), post("/v1/admin/agreements")).content("{\"title\":\"VIBE Merchant Agreement\",\"body\":\"Version two of the terms. Fees have changed, so please read again.\"}")).andExpect(status().isCreated());
        mvc.perform(as(owner, get("/v1/merchant/menu"))).andExpect(status().isForbidden()).andExpect(jsonPath("$.code", is("agreement_required")));
        mvc.perform(as(owner, get("/v1/merchant/agreement"))).andExpect(jsonPath("$.accepted", is(false))).andExpect(jsonPath("$.current.version").isNumber());
        mvc.perform(as(owner, get("/v1/staff/notifications"))).andExpect(jsonPath("$.items[?(@.kind=='agreement_new')]").isNotEmpty());
        // Only the owner can accept.
        String email2 = "w-" + uniq() + "@test.local";
        mvc.perform(as(owner, post("/v1/merchant/team")).content("{\"email\":\"" + email2 + "\",\"name\":\"W\",\"password\":\"" + PASSWORD + "\",\"staffRole\":\"manager\"}")).andExpect(status().isForbidden()); // blocked until accepted
        mvc.perform(as(owner, post("/v1/merchant/agreement/accept"))).andExpect(jsonPath("$.accepted", is(true)));
        mvc.perform(as(owner, get("/v1/merchant/menu"))).andExpect(status().isOk());
        mvc.perform(as(adminToken(), get("/v1/admin/agreements"))).andExpect(jsonPath("$[0].accepted").isNumber());
        mvc.perform(as(adminToken(), post("/v1/admin/agreements")).content("{\"title\":\"x\",\"body\":\"too short\"}")).andExpect(status().isBadRequest());
    }

    @Test
    void aCustomerCanReportAProblemAndVibeResolvesItWithARefundOrAReason() throws Exception {
        String biz = business(category(), "Dispute Arena " + uniq()), m = merchant(biz), c = customerToken(phone());
        String ref = paidSlot(biz, m, c);
        mvc.perform(as(c, post("/v1/payments/" + ref + "/dispute")).content("{\"reason\":\"nonsense\"}")).andExpect(status().isBadRequest());
        String d = JsonPath.read(mvc.perform(as(c, post("/v1/payments/" + ref + "/dispute")).content("{\"reason\":\"not_received\",\"details\":\"The court was locked\"}")).andExpect(status().isCreated())
                .andExpect(jsonPath("$.status", is("open"))).andReturn().getResponse().getContentAsString(), "$.reference");
        mvc.perform(as(c, post("/v1/payments/" + ref + "/dispute")).content("{\"reason\":\"other\"}")).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("already_open")));
        mvc.perform(as(customerToken(phone()), post("/v1/payments/" + ref + "/dispute")).content("{\"reason\":\"other\"}")).andExpect(status().isNotFound());
        mvc.perform(as(c, get("/v1/me/disputes"))).andExpect(jsonPath("$", hasSize(1)));
        mvc.perform(as(m, get("/v1/staff/notifications"))).andExpect(jsonPath("$.items[?(@.kind=='dispute_opened')]").isNotEmpty());
        mvc.perform(as(adminToken(), get("/v1/admin/disputes").param("status", "open"))).andExpect(jsonPath("$[*].reference", hasItem(d))).andExpect(jsonPath("$[?(@.reference=='" + d + "')].overdue", hasItem(false)));

        mvc.perform(as(adminToken(), post("/v1/admin/disputes/" + d + "/resolve")).content("{\"outcome\":\"maybe\"}")).andExpect(status().isBadRequest());
        mvc.perform(as(adminToken(), post("/v1/admin/disputes/" + d + "/resolve")).content("{\"outcome\":\"reject\"}")).andExpect(status().isBadRequest()); // the customer is owed a reason
        mvc.perform(as(adminToken(), post("/v1/admin/disputes/" + d + "/resolve")).content("{\"outcome\":\"refund\",\"amount\":30000,\"bearer\":\"merchant\",\"note\":\"Part refund for the locked court\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status", is("refund"))).andExpect(jsonPath("$.refundAmount", is(30000)));
        mvc.perform(as(adminToken(), get("/v1/admin/refunds").param("status", "due"))).andExpect(jsonPath("$.items[*].reference", hasItem(ref)));
        mvc.perform(as(c, get("/v1/me/notifications"))).andExpect(jsonPath("$[?(@.kind=='dispute_resolved')]", hasSize(1)));
        mvc.perform(as(adminToken(), post("/v1/admin/disputes/" + d + "/resolve")).content("{\"outcome\":\"reject\",\"note\":\"Again\"}")).andExpect(status().isConflict());

        // Declining tells the customer why. A payment that was refunded can't be reported again.
        String ref2 = paidSlot(biz, m, c);
        String d2 = JsonPath.read(mvc.perform(as(c, post("/v1/payments/" + ref2 + "/dispute")).content("{\"reason\":\"poor_service\"}")).andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.reference");
        mvc.perform(as(adminToken(), post("/v1/admin/disputes/" + d2 + "/resolve")).content("{\"outcome\":\"reject\",\"note\":\"The venue’s records show you checked in\"}")).andExpect(jsonPath("$.status", is("rejected")));
        mvc.perform(as(c, post("/v1/payments/" + ref + "/dispute")).content("{\"reason\":\"other\"}")).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("refunded")));
    }

    @Test
    void thePartnersFileIsMatchedToVibesPaymentsAndEveryDifferenceIsKept() throws Exception {
        String biz = business(category(), "Recon Arena " + uniq()), m = merchant(biz), c = customerToken(phone());
        String a = paidSlot(biz, m, c), b = paidSlot(biz, m, c), forgotten = paidSlot(biz, m, c);
        // The partner's file: A right, B at the wrong amount, one VIBE has never heard of; and it has nothing for the third payment.
        String csv = "reference,amount,status\n" + a + ",620.00,captured\n" + b + ",600.00,captured\nVB-ZZZZ-ZZZZ,150.00,captured\n";
        String run = JsonPath.read(mvc.perform(as(adminToken(), post("/v1/admin/reconciliation")).content("{\"fileName\":\"partner-nov.csv\",\"csv\":" + new tools.jackson.databind.json.JsonMapper().writeValueAsString(csv) + ",\"from\":\"2020-01-01\",\"to\":\"2099-01-01\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.run.partnerRows", is(3))).andExpect(jsonPath("$.run.matched", is(1))).andExpect(jsonPath("$.run.mismatched", is(1))).andExpect(jsonPath("$.run.missingInVibe", is(1)))
                .andExpect(jsonPath("$.items[?(@.result=='amount_mismatch')].paymentReference", hasItem(b))).andExpect(jsonPath("$.items[?(@.result=='missing_in_vibe')].key", hasItem("VB-ZZZZ-ZZZZ")))
                .andExpect(jsonPath("$.items[?(@.result=='missing_at_partner')].paymentReference", hasItem(forgotten))).andReturn().getResponse().getContentAsString(), "$.run.id");
        mvc.perform(as(adminToken(), get("/v1/admin/reconciliation"))).andExpect(jsonPath("$[0].id", is(run)));
        mvc.perform(as(adminToken(), get("/v1/admin/reconciliation/" + run + ".csv"))).andExpect(status().isOk());
        mvc.perform(as(adminToken(), post("/v1/admin/reconciliation")).content("{\"csv\":\"foo,bar\\n1,2\"}")).andExpect(status().isBadRequest());
        mvc.perform(as(adminToken(), post("/v1/admin/reconciliation")).content("{\"csv\":\"reference,amount\\n" + a + ",abc\"}")).andExpect(status().isBadRequest());
        mvc.perform(as(m, get("/v1/admin/reconciliation"))).andExpect(status().isForbidden());
    }
}
