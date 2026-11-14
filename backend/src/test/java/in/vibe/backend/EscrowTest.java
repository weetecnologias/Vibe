package in.vibe.backend;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.is;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Model A: customers pay through the gateway, the gateway pays VIBE's escrow account less its charges, VIBE pays each business from it. Three
 * checks: each payment is in a gateway payout once, each gateway payout arrived in the escrow account, each payout to a business left it.
 */
class EscrowTest extends ApiTestSupport {
    private static final String BILL_1000 = "[{\"label\":\"Dinner\",\"amount\":100000}]";

    private String paidBill(String offer, String merchant) throws Exception {
        String customer = customerToken(phone());
        String red = id(mvc.perform(as(customer, post("/v1/redemptions")).content("{\"offerId\":\"" + offer + "\"}")).andExpect(status().is2xxSuccessful()).andReturn());
        mvc.perform(as(merchant, post("/v1/merchant/bills/" + red)).content("{\"lines\":" + BILL_1000 + "}")).andExpect(status().isCreated());
        String pr = JsonPath.read(mvc.perform(as(customer, get("/v1/redemptions/" + red))).andReturn().getResponse().getContentAsString(), "$.paymentRequest.id");
        String ref = JsonPath.read(mvc.perform(as(customer, post("/v1/payment-requests/" + pr + "/payments")).header("Idempotency-Key", "pay-" + uniq()).content("{\"method\":\"upi\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.reference");
        mvc.perform(as(customer, get("/v1/payments/" + ref))).andExpect(jsonPath("$.status", is("verified")));
        return ref;
    }

    private org.springframework.test.web.servlet.ResultActions send(String a, String path, String csv) throws Exception {
        String body = "{\"fileName\":\"test.csv\",\"csv\":\"" + csv.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n") + "\"}";
        return mvc.perform(as(a, post(path)).content(body));
    }

    private long account(String name) { return jdbc.sql("select coalesce(sum(debit) - sum(credit), 0) from ledger_entries where account = :a").param("a", name).query(Long.class).single(); }

    @Test
    void gatewayPayoutsAndTheEscrowStatementAreMatchedToEveryPaymentAndPayout() throws Exception {
        String biz = business(category(null, "Escrow " + uniq()), "Escrow cafe " + uniq()), m = merchant(biz), offer = liveOffer(m, false);
        verifyKyc(biz, m);
        String ref1 = paidBill(offer, m), ref2 = paidBill(offer, m); // ₹700 each after the 30% offer
        String a = adminToken();
        long escrowBefore = account("escrow_bank"), chargesBefore = account("gateway_charges");

        // 1. The gateway's report: both payments in one payout, ₹14 charge and ₹2.52 GST on each. VIBE matches them and books the charges.
        String setl = "setl_" + uniq(), utr = "UTR" + uniq().toUpperCase();
        String report = "settlement_id,utr,settled_on,type,reference,amount,fee,tax\n"
                + setl + "," + utr + ",2026-11-13,payment," + ref1 + ",700.00,14.00,2.52\n"
                + setl + "," + utr + ",2026-11-13,payment," + ref2 + ",700.00,14.00,2.52\n";
        send(a, "/v1/admin/escrow/gateway-report", report).andExpect(status().isOk()).andExpect(jsonPath("$.payouts", is(1))).andExpect(jsonPath("$.matched", is(2)))
                .andExpect(jsonPath("$.problems", is(0))).andExpect(jsonPath("$.net", is(136696)));
        assertNotNull(jdbc.sql("select gateway_settlement_id from payments where reference = :r").param("r", ref1).query(UUID.class).single());
        assertEquals(escrowBefore + 136696, account("escrow_bank"));
        assertEquals(chargesBefore + 2800, account("gateway_charges"));
        mvc.perform(as(a, get("/v1/admin/ledger/trial-balance"))).andExpect(jsonPath("$.balanced", is(true)));
        // The same file again changes nothing.
        send(a, "/v1/admin/escrow/gateway-report", report).andExpect(jsonPath("$.payouts", is(0))).andExpect(jsonPath("$.alreadyImported", is(1)));
        // A gateway that pays out a payment twice is caught.
        String twice = "settlement_id,utr,settled_on,type,reference,amount,fee,tax\nsetl_" + uniq() + ",UTR" + uniq() + ",2026-11-14,payment," + ref1 + ",700.00,14.00,2.52\n";
        send(a, "/v1/admin/escrow/gateway-report", twice).andExpect(jsonPath("$.problems", is(1)));
        mvc.perform(as(a, get("/v1/admin/escrow/overview"))).andExpect(jsonPath("$.exceptions[?(@.kind=='gateway_line_duplicate')].reference", hasItem(ref1)));

        // VIBE pays the café from the escrow account and records the bank reference.
        String sid = JsonPath.read(mvc.perform(as(a, post("/v1/admin/settlements")).content("{\"businessId\":\"" + biz + "\"}")).andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.summary.id");
        String neft = "NEFT" + uniq().toUpperCase();
        String paid = mvc.perform(as(a, post("/v1/admin/settlements/" + sid + "/paid")).content("{\"payoutRef\":\"" + neft + "\"}")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        long payout = ((Number) JsonPath.read(paid, "$.summary.payout")).longValue();
        String payoutRupees = String.format("%d.%02d", payout / 100, payout % 100);

        // 2 and 3. The escrow statement: the gateway's money in (by UTR), the café's payout out (by its bank reference), and a bank charge VIBE can't match.
        String charge = "CHG" + uniq();
        String statement = "Date,Narration,Reference,Debit,Credit,Balance\n"
                + "14/11/2026,NEFT CR GATEWAY SETTLEMENT " + setl + "," + utr + ",,\"1,366.96\",\"1,366.96\"\n"
                + "15/11/2026,NEFT DR ESCROW CAFE," + neft + "," + payoutRupees + ",,0.00\n"
                + "15/11/2026,ACCOUNT CHARGES," + charge + ",50.00,,0.00\n";
        send(a, "/v1/admin/escrow/bank-statement", statement).andExpect(status().isOk()).andExpect(jsonPath("$.newLines", is(3))).andExpect(jsonPath("$.matched", is(2)))
                .andExpect(jsonPath("$.unmatched", is(1)));
        assertEquals("matched", jdbc.sql("select status from gateway_settlements where provider_settlement_id = :p").param("p", setl).query(String.class).single());
        assertNotNull(jdbc.sql("select bank_line_id from settlements where id = :id::uuid").param("id", sid).query(UUID.class).single());
        // An overlapping statement doesn't count the same lines twice.
        send(a, "/v1/admin/escrow/bank-statement", statement).andExpect(jsonPath("$.newLines", is(0))).andExpect(jsonPath("$.alreadySeen", is(3)));

        // The bank charge stays on the list until someone says what it is.
        String line = jdbc.sql("select id from bank_lines where reference = :r").param("r", charge).query(String.class).single();
        mvc.perform(as(a, get("/v1/admin/escrow/bank-lines").param("problems", "true"))).andExpect(jsonPath("$[*].id", hasItem(line)));
        mvc.perform(as(a, post("/v1/admin/escrow/bank-lines/" + line + "/explain")).content("{\"note\":\"Monthly account charges\"}")).andExpect(status().isOk()).andExpect(jsonPath("$.result", is("explained")));
        mvc.perform(as(a, post("/v1/admin/escrow/bank-lines/" + line + "/explain")).content("{\"note\":\"Again\"}")).andExpect(status().isConflict());

        // A bad file says what's wrong; category managers don't get the money checks.
        send(a, "/v1/admin/escrow/gateway-report", "utr,amount\nX,1.00\n").andExpect(status().isBadRequest());
        String email = "cm-" + uniq() + "@test.local";
        mvc.perform(as(a, post("/v1/admin/team")).content("{\"email\":\"" + email + "\",\"name\":\"CM\",\"password\":\"" + PASSWORD + "\",\"role\":\"staff\",\"areas\":[\"money\"],\"categoryIds\":[\""
                + jdbc.sql("select primary_category_id from businesses where id = :b::uuid").param("b", biz).query(String.class).single() + "\"]}")).andExpect(status().isCreated());
        mvc.perform(as(signInSettled(email, PASSWORD), get("/v1/admin/escrow/overview"))).andExpect(status().isForbidden());
    }
}
