package in.vibe.backend;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.Test;

import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.matchesPattern;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;

/** Every business has its own Merchant ID (like a customer's VIBE ID), and each payment carries it: on the merchant's screen, VIBE's lists and downloads, and the receipt. */
class MerchantIdTest extends ApiTestSupport {
    private String merchantId(String business) {
        return jdbc.sql("select merchant_id from businesses where id = :b::uuid").param("b", business).query(String.class).single();
    }

    @Test
    void everyBusinessGetsItsOwnMerchantIdAndEveryPaymentCarriesIt() throws Exception {
        String sports = category(null, "Sports " + uniq());
        String one = business(sports, "Court One " + uniq()), two = business(sports, "Court Two " + uniq());
        String mid = merchantId(one);
        assertTrue(mid.matches("VM-\\d{6,}"), mid);
        assertNotEquals(mid, merchantId(two));

        // The merchant sees their own ID.
        String m = merchant(one);
        mvc.perform(as(m, get("/v1/merchant/settings"))).andExpect(jsonPath("$.merchantId", is(mid)));

        // A payment to them: the customer's receipt, VIBE's transactions (searchable by the ID) and the download all show it.
        String customer = customerToken(phone());
        String ref = paidSlot(one, m, customer);
        mvc.perform(as(customer, get("/v1/payments/" + ref))).andExpect(jsonPath("$.payeeMerchantId", is(mid)));
        String a = adminToken();
        mvc.perform(as(a, get("/v1/admin/transactions").param("q", mid.toLowerCase()))).andExpect(jsonPath("$.items[0].reference", is(ref)))
                .andExpect(jsonPath("$.items[0].payeeMerchantId", is(mid)));
        String csv = mvc.perform(as(a, get("/v1/admin/exports/transactions").param("q", mid))).andReturn().getResponse().getContentAsString();
        assertTrue(csv.contains("Merchant ID") && csv.contains(mid), csv);

        // VIBE finds the business by its Merchant ID.
        mvc.perform(as(a, get("/v1/admin/merchants").param("q", mid))).andExpect(jsonPath("$.rows[0].merchantId", is(mid))).andExpect(jsonPath("$.rows[0].id", is(one)));
        mvc.perform(as(a, get("/v1/admin/merchants").param("q", "Court"))).andExpect(jsonPath("$.rows[*].merchantId", hasItem(matchesPattern("VM-\\d{6,}"))));
        String row = JsonPath.read(mvc.perform(as(a, get("/v1/admin/merchants/" + one))).andReturn().getResponse().getContentAsString(), "$.merchant.merchantId");
        assertTrue(mid.equals(row), row);
    }
}
