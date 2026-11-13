package in.vibe.backend;

import com.jayway.jsonpath.JsonPath;
import in.vibe.backend.backoffice.StaffService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Shared setup for the API tests: one Spring context and one real PostgreSQL, plus helpers to create staff, categories and businesses. */
@SpringBootTest(properties = {"vibe.media.dir=target/test-media", "vibe.payments.simulate-after-ms=0"})
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
@ActiveProfiles("dev")
abstract class ApiTestSupport {
    static final String PASSWORD = "a-long-test-password";

    @Autowired MockMvc mvc;
    @Autowired StaffService staff;
    @Autowired JdbcClient jdbc;

    String adminToken;

    static String uniq() { return UUID.randomUUID().toString().substring(0, 8); }

    String adminToken() throws Exception {
        if (adminToken == null) {
            String email = "admin-" + uniq() + "@test.local";
            staff.createAdmin(email, "Test Admin", PASSWORD);
            adminToken = login(email, PASSWORD);
        }
        return adminToken;
    }

    String login(String email, String password) throws Exception {
        MvcResult r = mvc.perform(post("/v1/staff/login").contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + email + "\",\"password\":\"" + password + "\"}")).andExpect(status().isOk()).andReturn();
        return JsonPath.read(r.getResponse().getContentAsString(), "$.token");
    }

    MockHttpServletRequestBuilder as(String token, MockHttpServletRequestBuilder b) {
        return b.header("Authorization", "Bearer " + token).contentType(MediaType.APPLICATION_JSON);
    }

    String id(MvcResult r) throws Exception { return JsonPath.read(r.getResponse().getContentAsString(), "$.id"); }

    String category(String parent, String name) throws Exception {
        String slug = name.toLowerCase().replace(' ', '-') + "-" + uniq();
        String body = "{\"parentId\":" + (parent == null ? "null" : "\"" + parent + "\"") + ",\"slug\":\"" + slug + "\",\"name\":\"" + name + "\",\"icon\":\"food\",\"sortOrder\":1}";
        return id(mvc.perform(as(adminToken(), post("/v1/admin/categories")).content(body)).andExpect(status().isCreated()).andReturn());
    }

    String business(String categoryId, String name) throws Exception {
        String body = """
            {"primaryCategoryId":"%s","categoryIds":["%s"],"verified":true,"active":true,
             "profile":{"name":"%s","area":"Jubilee Hills","address":"Road 1","lat":17.43,"lng":78.41,"priceLevel":2,"costForTwo":120000,
               "hours":[{"dow":0,"opens":"09:00","closes":"22:00"},{"dow":1,"opens":"09:00","closes":"22:00"}]}}
            """.formatted(categoryId, categoryId, name);
        return id(mvc.perform(as(adminToken(), post("/v1/admin/businesses")).content(body)).andExpect(status().isCreated()).andReturn());
    }

    /** A merchant account for a business, signed in. */
    String merchant(String businessId) throws Exception {
        String email = "m-" + uniq() + "@test.local";
        mvc.perform(as(adminToken(), post("/v1/admin/businesses/" + businessId + "/staff"))
                .content("{\"email\":\"" + email + "\",\"name\":\"Manager\",\"password\":\"" + PASSWORD + "\"}")).andExpect(status().isCreated());
        // A new business's owner accepts VIBE's merchant agreement on first sign-in.
        String token = signInSettled(email, PASSWORD);
        mvc.perform(as(token, post("/v1/merchant/agreement/accept"))).andExpect(status().isOk());
        return token;
    }

    /** A login made by someone else must choose its own password first. This signs in, does that, and returns the working token. */
    String signInSettled(String email, String password) throws Exception {
        String first = login(email, password);
        MvcResult r = mvc.perform(as(first, post("/v1/staff/password")).content("{\"current\":\"" + password + "\",\"next\":\"" + password + "-chosen\"}")).andExpect(status().isOk()).andReturn();
        return JsonPath.read(r.getResponse().getContentAsString(), "$.token");
    }


    // ---------- customers ----------
    /** A valid Indian mobile number nobody else in this test run is using. */
    static String phone() { return "9" + String.format("%09d", (long) (Math.random() * 1_000_000_000L)); }

    /** Signs a customer in through the real OTP endpoints (the dev profile accepts 123456). Returns the access token. */
    String customerToken(String phone) throws Exception {
        MvcResult c = mvc.perform(post("/v1/auth/otp").contentType(MediaType.APPLICATION_JSON).content("{\"phone\":\"" + phone + "\"}")).andExpect(status().isOk()).andReturn();
        String requestId = JsonPath.read(c.getResponse().getContentAsString(), "$.requestId");
        MvcResult v = mvc.perform(post("/v1/auth/otp/verify").contentType(MediaType.APPLICATION_JSON).content("{\"requestId\":\"" + requestId + "\",\"code\":\"123456\"}")).andExpect(status().isOk()).andReturn();
        return JsonPath.read(v.getResponse().getContentAsString(), "$.accessToken");
    }

    /** The owner sends valid legal and bank details and VIBE verifies them, so the business can be paid out. */
    void verifyKyc(String business, String merchantToken) throws Exception {
        mvc.perform(as(merchantToken, org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put("/v1/merchant/kyc")).content("""
            {"legalName":"Test Traders Pvt Ltd","pan":"ABCPE1234F","bankAccountName":"Test Traders","bankAccountNo":"123456789012","bankIfsc":"HDFC0001234","bankName":"Test Bank"}"""))
                .andExpect(status().isOk());
        mvc.perform(as(adminToken(), post("/v1/admin/kyc/" + business + "/approve"))).andExpect(status().isOk());
    }

    /** A confirmed court booking: ₹600 plus VIBE's ₹20 booking fee, so the customer pays ₹620. Returns the payment reference. */
    String paidSlot(String business, String merchantToken, String customer) throws Exception {
        String court = id(mvc.perform(as(merchantToken, post("/v1/merchant/venue/resources")).content("{\"sport\":\"Tennis\",\"name\":\"Court " + uniq() + "\",\"kind\":\"court\",\"price\":60000}")).andExpect(status().isCreated()).andReturn());
        MvcResult b = mvc.perform(as(customer, post("/v1/slot-bookings")).content("{\"businessId\":\"" + business + "\",\"items\":[{\"resourceId\":\"" + court + "\",\"startsAt\":\"" + SlotBookingTest.at(11) + "\",\"minutes\":60}]}")).andReturn();
        if (b.getResponse().getStatus() != 201) throw new AssertionError(b.getResponse().getContentAsString());
        String pr = JsonPath.read(b.getResponse().getContentAsString(), "$.paymentRequestId");
        String ref = JsonPath.read(mvc.perform(as(customer, post("/v1/payment-requests/" + pr + "/payments")).header("Idempotency-Key", "p-" + uniq() + uniq()).content("{\"method\":\"upi\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.reference");
        mvc.perform(as(customer, org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/v1/payments/" + ref))).andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.status").value("verified"));
        return ref;
    }

    void makeMember(String phone) {
        jdbc.sql("insert into memberships (customer_id, status, valid_until) select id, 'active', now() + interval '30 days' from customers where phone = :p on conflict (customer_id) do update set valid_until = now() + interval '30 days'").param("p", phone).update();
    }

    /** A live offer at a business: 30% off up to ₹500 on bills of ₹500 or more. Created by the merchant and approved by VIBE. */
    String liveOffer(String merchantToken, boolean memberOnly) throws Exception {
        String id = id(mvc.perform(as(merchantToken, post("/v1/merchant/offers")).content("""
            {"title":"30%% off","kind":"percentage","rateBps":3000,"maxDiscount":50000,"minBill":50000,"memberOnly":%s,"startsAt":"2026-01-01T00:00:00Z","endsAt":"2031-01-01T00:00:00Z"}""".formatted(memberOnly)))
                .andExpect(status().isCreated()).andReturn());
        mvc.perform(as(adminToken(), post("/v1/admin/offers/" + id + "/approve"))).andExpect(status().isOk());
        return id;
    }
}
