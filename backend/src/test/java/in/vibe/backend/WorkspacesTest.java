package in.vibe.backend;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.List;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.greaterThan;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.not;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** The admin dashboard by category: each category has its own overview, to-do list, merchants, balances and pay run, and a category's team sees only theirs. */
class WorkspacesTest extends ApiTestSupport {
    private static final String BILL_1000 = "[{\"label\":\"Dinner\",\"amount\":100000}]";

    private record Place(String biz, String merchant, String offer) {}

    private Place place(String category, String name) throws Exception {
        String biz = business(category, name);
        String merchant = merchant(biz);
        return new Place(biz, merchant, liveOffer(merchant, false));
    }

    /** A new customer redeems the offer, the merchant bills ₹1,000, the customer pays ₹700. */
    private void paidBill(Place p) throws Exception {
        String customer = customerToken(phone());
        String red = id(mvc.perform(as(customer, post("/v1/redemptions")).content("{\"offerId\":\"" + p.offer() + "\"}")).andExpect(status().is2xxSuccessful()).andReturn());
        mvc.perform(as(p.merchant(), post("/v1/merchant/bills/" + red)).content("{\"lines\":" + BILL_1000 + "}")).andExpect(status().isCreated());
        String pr = JsonPath.read(mvc.perform(as(customer, get("/v1/redemptions/" + red))).andReturn().getResponse().getContentAsString(), "$.paymentRequest.id");
        String ref = JsonPath.read(mvc.perform(as(customer, post("/v1/payment-requests/" + pr + "/payments")).header("Idempotency-Key", "pay-" + uniq()).content("{\"method\":\"upi\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.reference");
        mvc.perform(as(customer, get("/v1/payments/" + ref))).andExpect(jsonPath("$.status", is("verified")));
    }

    private MockHttpServletRequestBuilder in(String workspace, MockHttpServletRequestBuilder b) { return b.header("X-Vibe-Workspace", workspace); }

    @Test
    void eachCategoryHasItsOwnOverviewMerchantsBalancesAndPayRun() throws Exception {
        String dineName = "Dine " + uniq(), cafesName = "Cafes " + uniq();
        String dine = category(null, dineName), cafes = category(dine, cafesName), sport = category(null, "Sport " + uniq());
        Place cafe = place(cafes, "Cafe " + uniq()), court = place(sport, "Court " + uniq());
        verifyKyc(cafe.biz(), cafe.merchant());
        paidBill(cafe);
        paidBill(cafe);
        paidBill(court);
        String a = adminToken();

        // The switcher offers all of VIBE and each top-level category.
        mvc.perform(as(a, get("/v1/admin/workspaces"))).andExpect(jsonPath("$.all", is(true))).andExpect(jsonPath("$.categories[*].id", hasItem(dine))).andExpect(jsonPath("$.categories[*].id", hasItem(sport)))
                .andExpect(jsonPath("$.categories[*].id", not(hasItem(cafes))));

        // All of VIBE: one card per top-level category, with today's sales by kind and what VIBE still owes its businesses.
        mvc.perform(as(a, get("/v1/admin/workspaces/overview")))
                .andExpect(jsonPath("$.cards[?(@.id=='" + dine + "')].sales", hasItem(2))).andExpect(jsonPath("$.cards[?(@.id=='" + dine + "')].collected", hasItem(140000)))
                .andExpect(jsonPath("$.cards[?(@.id=='" + dine + "')].salesByKind.redemption", hasItem(2))).andExpect(jsonPath("$.cards[?(@.id=='" + sport + "')].sales", hasItem(1)))
                .andExpect(jsonPath("$.cards[?(@.id=='" + sport + "')].payoutsHeld", hasItem(1)));

        // Inside Food and dining the cards are its subcategories, and Sport's business isn't counted.
        mvc.perform(as(a, in(dine, get("/v1/admin/workspaces/overview")))).andExpect(jsonPath("$.workspaceName", is(dineName))).andExpect(jsonPath("$.cards[0].id", is(cafes)))
                .andExpect(jsonPath("$.cards[0].sales", is(2))).andExpect(jsonPath("$.total.sales", is(2))).andExpect(jsonPath("$.total.outlets", is(1)));
        String csv = mvc.perform(as(a, in(dine, get("/v1/admin/workspaces/overview.csv")))).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertTrue(csv.contains(cafesName) && csv.contains("1400.00"), csv);

        // Merchants in the category, with KYC and bank status and what they're owed; and one profile with everything about the business.
        mvc.perform(as(a, in(dine, get("/v1/admin/merchants")))).andExpect(jsonPath("$.total", is(1))).andExpect(jsonPath("$.rows[0].id", is(cafe.biz())))
                .andExpect(jsonPath("$.rows[0].kycStatus", is("verified"))).andExpect(jsonPath("$.rows[0].owed", greaterThan(0)));
        mvc.perform(as(a, in(dine, get("/v1/admin/merchants")).param("kyc", "submitted"))).andExpect(jsonPath("$.total", is(0)));

        // Merchants open on categories: each with its businesses, how many have verified KYC and bank details, and the money.
        mvc.perform(as(a, get("/v1/admin/merchants/categories")))
                .andExpect(jsonPath("$.rows[?(@.id=='" + dine + "')].merchants", hasItem(1))).andExpect(jsonPath("$.rows[?(@.id=='" + dine + "')].kycVerified", hasItem(1)))
                .andExpect(jsonPath("$.rows[?(@.id=='" + dine + "')].received", hasItem(140000))).andExpect(jsonPath("$.rows[?(@.id=='" + sport + "')].kycNotSent", hasItem(1)));
        mvc.perform(as(a, get("/v1/admin/merchants/categories").param("parent", dine))).andExpect(jsonPath("$.parentName", is(dineName))).andExpect(jsonPath("$.rows[0].id", is(cafes)))
                .andExpect(jsonPath("$.total.merchants", is(1)));
        // Open a category: its merchants only, with the category they sit under.
        mvc.perform(as(a, get("/v1/admin/merchants").param("category", dine))).andExpect(jsonPath("$.total", is(1))).andExpect(jsonPath("$.rows[0].topCategory", is(dineName)))
                .andExpect(jsonPath("$.rows[0].category", is(cafesName))).andExpect(jsonPath("$.rows[0].received", is(140000)));
        String all = mvc.perform(as(a, get("/v1/admin/merchants.csv").param("category", dine))).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertTrue(all.contains("XXXX9012") && all.contains("ABCPE1234F") && !all.contains("123456789012"), all);
        // Payments a merchant received, and whether each one has been settled.
        mvc.perform(as(a, get("/v1/admin/merchants/" + cafe.biz() + "/payments"))).andExpect(jsonPath("$.total", is(2))).andExpect(jsonPath("$.notSettled", is(2)))
                .andExpect(jsonPath("$.rows[0].amount", is(70000))).andExpect(jsonPath("$.rows[0].settlementStatus").doesNotExist());
        mvc.perform(as(a, get("/v1/admin/merchants/" + cafe.biz()))).andExpect(jsonPath("$.categoryPath", is(dineName + " › " + cafesName))).andExpect(jsonPath("$.kyc.status", is("verified")))
                .andExpect(jsonPath("$.kyc.bankAccountNo", is("123456789012"))).andExpect(jsonPath("$.money.unsettled.count", is(2))).andExpect(jsonPath("$.liveOffers", is(1)));

        // Balances: earned minus paid out is what's owed; the category's total matches its merchants.
        MvcResult bal = mvc.perform(as(a, in(sport, get("/v1/admin/balances")))).andExpect(jsonPath("$.rows", hasSize(1))).andExpect(jsonPath("$.rows[0].id", is(court.biz())))
                .andExpect(jsonPath("$.rows[0].gross", is(70000))).andExpect(jsonPath("$.rows[0].paidOut", is(0))).andReturn();
        Number owed = JsonPath.read(bal.getResponse().getContentAsString(), "$.rows[0].owed"), earned = JsonPath.read(bal.getResponse().getContentAsString(), "$.rows[0].earned"),
                total = JsonPath.read(bal.getResponse().getContentAsString(), "$.total.owed");
        assertEquals(earned.longValue(), owed.longValue());
        assertEquals(owed.longValue(), total.longValue());

        // The court sends its KYC: it's on Sport's to-do list, not Food and dining's.
        mvc.perform(as(court.merchant(), put("/v1/merchant/kyc")).content("""
            {"legalName":"Court Co Pvt Ltd","pan":"ABCPE1234F","bankAccountName":"Court Co","bankAccountNo":"555566667777","bankIfsc":"HDFC0001234","bankName":"Test Bank"}""")).andExpect(status().isOk());
        mvc.perform(as(a, in(sport, get("/v1/admin/todo")))).andExpect(jsonPath("$.items[?(@.type=='kyc')].id", hasItem(court.biz())))
                .andExpect(jsonPath("$.items[?(@.type=='kyc')].link", hasItem("/merchants/" + court.biz() + "?tab=kyc")));
        mvc.perform(as(a, in(dine, get("/v1/admin/todo")))).andExpect(jsonPath("$.items[?(@.id=='" + court.biz() + "')]", empty()));

        // Pay run in Food and dining: the café is settled in one go and appears in the bank file with its account.
        mvc.perform(as(a, in(dine, post("/v1/admin/settlements/run")).content("{}"))).andExpect(status().isOk()).andExpect(jsonPath("$.created", hasSize(1)))
                .andExpect(jsonPath("$.created[0].businessId", is(cafe.biz()))).andExpect(jsonPath("$.held", empty()));
        String bank = mvc.perform(as(a, in(dine, get("/v1/admin/settlements/bank-file.csv")))).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertTrue(bank.contains("123456789012") && !bank.contains("555566667777"), bank);
        mvc.perform(as(a, in(dine, get("/v1/admin/settlements")).param("status", "pending"))).andExpect(jsonPath("$[*].businessId", hasItem(cafe.biz())))
                .andExpect(jsonPath("$[*].businessId", not(hasItem(court.biz()))));
        // In Sport the court is held back until its KYC is verified, with the reason.
        mvc.perform(as(a, get("/v1/admin/merchants/" + cafe.biz() + "/payments"))).andExpect(jsonPath("$.notSettled", is(0))).andExpect(jsonPath("$.rows[0].settlementStatus", is("pending")));
        mvc.perform(as(a, get("/v1/admin/merchants/" + cafe.biz() + "/payments").param("settled", "no"))).andExpect(jsonPath("$.total", is(0)));
        String paymentsCsv = mvc.perform(as(a, get("/v1/admin/merchants/" + cafe.biz() + "/payments.csv"))).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertTrue(paymentsCsv.contains("Waiting for bank transfer"), paymentsCsv);
        mvc.perform(as(a, in(sport, post("/v1/admin/settlements/run")).content("{}"))).andExpect(jsonPath("$.created", empty())).andExpect(jsonPath("$.held[0].businessId", is(court.biz())))
                .andExpect(jsonPath("$.held[0].reason", containsString("KYC")));
        mvc.perform(as(a, in(dine, get("/v1/admin/balances")))).andExpect(jsonPath("$.rows[0].awaitingPayout", greaterThan(0)));

        // A nonsense category is refused rather than ignored.
        mvc.perform(as(a, in("not-a-category", get("/v1/admin/merchants")))).andExpect(status().isBadRequest());
    }

    @Test
    void aCategoryTeamSeesOnlyItsOwnCategoryWhicheverOneTheyPick() throws Exception {
        String dine = category(null, "Dine " + uniq()), sport = category(null, "Sport " + uniq());
        Place cafe = place(dine, "Cafe " + uniq()), court = place(sport, "Court " + uniq());
        String email = "sport-" + uniq() + "@test.local";
        mvc.perform(as(adminToken(), post("/v1/admin/team")).content("{\"email\":\"" + email + "\",\"name\":\"Sport Lead\",\"password\":\"" + PASSWORD + "\",\"role\":\"staff\",\"areas\":[\"partners\",\"money\",\"reports\"],\"categoryIds\":[\"" + sport + "\"]}"))
                .andExpect(status().isCreated());
        String lead = signInSettled(email, PASSWORD);

        mvc.perform(as(lead, get("/v1/admin/workspaces"))).andExpect(jsonPath("$.all", is(false))).andExpect(jsonPath("$.categories[*].id", is(List.of(sport))));
        mvc.perform(as(lead, get("/v1/admin/merchants"))).andExpect(jsonPath("$.rows[*].id", hasItem(court.biz()))).andExpect(jsonPath("$.rows[*].id", not(hasItem(cafe.biz()))));
        // Asking for another category's workspace shows nothing of it: their own limit still applies.
        mvc.perform(as(lead, in(dine, get("/v1/admin/merchants")))).andExpect(jsonPath("$.total", is(0)));
        mvc.perform(as(lead, get("/v1/admin/merchants/" + cafe.biz()))).andExpect(status().isForbidden());
        mvc.perform(as(lead, post("/v1/admin/settlements")).content("{\"businessId\":\"" + cafe.biz() + "\"}")).andExpect(status().isForbidden());
    }
}
