package in.vibe.backend;

import com.jayway.jsonpath.JsonPath;
import in.vibe.backend.backoffice.StaffService;
import org.springframework.beans.factory.annotation.Autowired;
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
@SpringBootTest(properties = "vibe.media.dir=target/test-media")
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
@ActiveProfiles("dev")
abstract class ApiTestSupport {
    static final String PASSWORD = "a-long-test-password";

    @Autowired MockMvc mvc;
    @Autowired StaffService staff;

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
        return login(email, PASSWORD);
    }

}
