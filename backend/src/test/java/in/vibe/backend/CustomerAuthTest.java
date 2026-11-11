package in.vibe.backend;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;

import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.matchesPattern;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Customer sign-in with a phone number and a one-time code. */
class CustomerAuthTest extends ApiTestSupport {
    String otp(String phone) throws Exception {
        MvcResult r = mvc.perform(post("/v1/auth/otp").contentType(MediaType.APPLICATION_JSON).content("{\"phone\":\"" + phone + "\"}")).andExpect(status().isOk()).andReturn();
        return JsonPath.read(r.getResponse().getContentAsString(), "$.requestId");
    }

    String verifyBody(String requestId, String code) { return "{\"requestId\":\"" + requestId + "\",\"code\":\"" + code + "\"}"; }

    @Test
    void anOtpChallengeHidesMostOfTheNumber() throws Exception {
        String p = phone();
        mvc.perform(post("/v1/auth/otp").contentType(MediaType.APPLICATION_JSON).content("{\"phone\":\"+91 " + p.substring(0, 5) + " " + p.substring(5) + "\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.maskedPhone", matchesPattern("\\+91 \\d{5} •••\\d{2}"))).andExpect(jsonPath("$.attemptsLeft", is(3))).andExpect(jsonPath("$.expiresInSec", is(300)));
    }

    @Test
    void badNumbersAreRefused() throws Exception {
        for (String bad : new String[]{"12345", "5876543210", "98765abcde", "", "+1 202 555 0100"}) {
            mvc.perform(post("/v1/auth/otp").contentType(MediaType.APPLICATION_JSON).content("{\"phone\":\"" + bad + "\"}")).andExpect(status().isBadRequest());
        }
    }

    @Test
    void theRightCodeSignsInAndTheCustomerIsNewOnlyTheFirstTime() throws Exception {
        String p = phone();
        MvcResult first = mvc.perform(post("/v1/auth/otp/verify").contentType(MediaType.APPLICATION_JSON).content(verifyBody(otp(p), "123456")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.isNewUser", is(true))).andExpect(jsonPath("$.user.vibeId", matchesPattern("\\d{6}"))).andExpect(jsonPath("$.user.isMember", is(false)))
                .andExpect(jsonPath("$.user.phoneMasked", not(p))).andExpect(jsonPath("$.refreshToken").exists()).andReturn();
        String vibeId = JsonPath.read(first.getResponse().getContentAsString(), "$.user.vibeId");
        // The same number in another format is the same customer. (A new code can be asked for after the resend wait, so move that wait aside.)
        jdbc.sql("update otp_requests set created_at = created_at - interval '1 minute' where phone = :p").param("p", p).update();
        mvc.perform(post("/v1/auth/otp/verify").contentType(MediaType.APPLICATION_JSON).content(verifyBody(otpFormatted(p), "123456")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.isNewUser", is(false))).andExpect(jsonPath("$.user.vibeId", is(vibeId)));
    }

    String otpFormatted(String p) throws Exception {
        MvcResult r = mvc.perform(post("/v1/auth/otp").contentType(MediaType.APPLICATION_JSON).content("{\"phone\":\"0" + p + "\"}")).andExpect(status().isOk()).andReturn();
        return JsonPath.read(r.getResponse().getContentAsString(), "$.requestId");
    }

    @Test
    void threeWrongCodesLockTheRequestEvenForTheRightCode() throws Exception {
        String id = otp(phone());
        mvc.perform(post("/v1/auth/otp/verify").contentType(MediaType.APPLICATION_JSON).content(verifyBody(id, "000000"))).andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code", is("wrong_code")))
                .andExpect(jsonPath("$.message", is("That code isn’t right. 2 tries left.")));
        mvc.perform(post("/v1/auth/otp/verify").contentType(MediaType.APPLICATION_JSON).content(verifyBody(id, "111111"))).andExpect(status().isUnauthorized());
        mvc.perform(post("/v1/auth/otp/verify").contentType(MediaType.APPLICATION_JSON).content(verifyBody(id, "222222"))).andExpect(status().isUnauthorized());
        mvc.perform(post("/v1/auth/otp/verify").contentType(MediaType.APPLICATION_JSON).content(verifyBody(id, "123456"))).andExpect(status().isTooManyRequests()).andExpect(jsonPath("$.code", is("otp_locked")));
    }

    @Test
    void aCodeWorksOnlyOnceAndExpires() throws Exception {
        String p = phone();
        String id = otp(p);
        mvc.perform(post("/v1/auth/otp/verify").contentType(MediaType.APPLICATION_JSON).content(verifyBody(id, "123456"))).andExpect(status().isOk());
        mvc.perform(post("/v1/auth/otp/verify").contentType(MediaType.APPLICATION_JSON).content(verifyBody(id, "123456"))).andExpect(status().isGone()).andExpect(jsonPath("$.code", is("otp_expired")));

        jdbc.sql("update otp_requests set created_at = created_at - interval '1 minute' where phone = :p").param("p", p).update();
        String old = otp(p);
        jdbc.sql("update otp_requests set expires_at = now() - interval '1 second' where id = cast(:id as uuid)").param("id", old).update();
        mvc.perform(post("/v1/auth/otp/verify").contentType(MediaType.APPLICATION_JSON).content(verifyBody(old, "123456"))).andExpect(status().isGone());
        mvc.perform(post("/v1/auth/otp/verify").contentType(MediaType.APPLICATION_JSON).content(verifyBody("not-an-id", "123456"))).andExpect(status().isUnauthorized());
    }

    @Test
    void askingForCodesTooFastOrTooOftenIsLimited() throws Exception {
        String p = phone();
        otp(p);
        mvc.perform(post("/v1/auth/otp").contentType(MediaType.APPLICATION_JSON).content("{\"phone\":\"" + p + "\"}")).andExpect(status().isTooManyRequests()).andExpect(jsonPath("$.code", is("resend_too_soon")));
        for (int i = 0; i < 4; i++) {
            jdbc.sql("update otp_requests set created_at = created_at - interval '1 minute' where phone = :p").param("p", p).update();
            otp(p);
        }
        jdbc.sql("update otp_requests set created_at = created_at - interval '1 minute' where phone = :p").param("p", p).update();
        mvc.perform(post("/v1/auth/otp").contentType(MediaType.APPLICATION_JSON).content("{\"phone\":\"" + p + "\"}")).andExpect(status().isTooManyRequests()).andExpect(jsonPath("$.code", is("too_many_requests")));
    }

    @Test
    void aCustomerReadsAndEditsOnlyTheirOwnProfile() throws Exception {
        String token = customerToken(phone());
        mvc.perform(as(token, get("/v1/me"))).andExpect(status().isOk()).andExpect(jsonPath("$.name", is("VIBE member")));
        mvc.perform(as(token, patch("/v1/me")).content("{\"name\":\"Aarav Reddy\",\"area\":\"Jubilee Hills\"}")).andExpect(status().isOk()).andExpect(jsonPath("$.name", is("Aarav Reddy"))).andExpect(jsonPath("$.area", is("Jubilee Hills")));
        mvc.perform(as(token, patch("/v1/me")).content("{\"name\":\"A\"}")).andExpect(status().isBadRequest());
        mvc.perform(get("/v1/me")).andExpect(status().isUnauthorized());
        mvc.perform(as(token, post("/v1/me/deletion-request"))).andExpect(status().isNoContent());
        mvc.perform(as(token, post("/v1/me/deletion-request"))).andExpect(status().isNoContent()); // asking twice is fine
    }

    @Test
    void customersAndStaffCannotUseEachOthersEndpoints() throws Exception {
        String customer = customerToken(phone());
        mvc.perform(as(customer, get("/v1/admin/categories"))).andExpect(status().isForbidden());
        mvc.perform(as(customer, get("/v1/merchant/bills"))).andExpect(status().isForbidden());
        mvc.perform(as(adminToken(), get("/v1/me"))).andExpect(status().isForbidden());
        String merchant = merchant(business(category(null, "Isolation"), "Isolation place " + uniq()));
        mvc.perform(as(merchant, get("/v1/me"))).andExpect(status().isForbidden());
        mvc.perform(as(merchant, post("/v1/redemptions")).content("{\"offerId\":\"" + java.util.UUID.randomUUID() + "\"}")).andExpect(status().isForbidden());
    }

    @Test
    void refreshTokensWorkOnceAndAReplayEndsEverySession() throws Exception {
        String p = phone();
        String requestId = otp(p);
        MvcResult v = mvc.perform(post("/v1/auth/otp/verify").contentType(MediaType.APPLICATION_JSON).content(verifyBody(requestId, "123456"))).andExpect(status().isOk()).andReturn();
        String refresh1 = JsonPath.read(v.getResponse().getContentAsString(), "$.refreshToken");

        MvcResult r2 = mvc.perform(post("/v1/auth/refresh").contentType(MediaType.APPLICATION_JSON).content("{\"refreshToken\":\"" + refresh1 + "\"}")).andExpect(status().isOk()).andReturn();
        String refresh2 = JsonPath.read(r2.getResponse().getContentAsString(), "$.refreshToken");
        // The first one is spent. Using it again looks like theft, so the newer one stops working too.
        mvc.perform(post("/v1/auth/refresh").contentType(MediaType.APPLICATION_JSON).content("{\"refreshToken\":\"" + refresh1 + "\"}")).andExpect(status().isUnauthorized());
        mvc.perform(post("/v1/auth/refresh").contentType(MediaType.APPLICATION_JSON).content("{\"refreshToken\":\"" + refresh2 + "\"}")).andExpect(status().isUnauthorized());
        mvc.perform(post("/v1/auth/refresh").contentType(MediaType.APPLICATION_JSON).content("{\"refreshToken\":\"made-up\"}")).andExpect(status().isUnauthorized());
    }

    @Test
    void signingOutEndsTheRefreshTokens() throws Exception {
        String p = phone();
        MvcResult v = mvc.perform(post("/v1/auth/otp/verify").contentType(MediaType.APPLICATION_JSON).content(verifyBody(otp(p), "123456"))).andReturn();
        String access = JsonPath.read(v.getResponse().getContentAsString(), "$.accessToken");
        String refresh = JsonPath.read(v.getResponse().getContentAsString(), "$.refreshToken");
        mvc.perform(as(access, post("/v1/auth/logout"))).andExpect(status().isNoContent());
        mvc.perform(post("/v1/auth/refresh").contentType(MediaType.APPLICATION_JSON).content("{\"refreshToken\":\"" + refresh + "\"}")).andExpect(status().isUnauthorized());
    }
}
