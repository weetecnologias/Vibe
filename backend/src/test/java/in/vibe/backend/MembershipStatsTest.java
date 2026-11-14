package in.vibe.backend;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** VIBE Membership in the admin: registered, members now, never joined, and the fees VIBE collected (its own income). */
class MembershipStatsTest extends ApiTestSupport {
    private long num(String json, String path) { return ((Number) JsonPath.read(json, path)).longValue(); }

    private String vibeId(String phone) { return jdbc.sql("select vibe_id from customers where phone = :p").param("p", phone).query(String.class).single(); }

    @Test
    void adminsSeeWhoTookMembershipWhoDidntAndTheFeesVibeCollected() throws Exception {
        String a = adminToken();
        String before = mvc.perform(as(a, get("/v1/admin/membership/summary"))).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();

        // One customer pays ₹199 for membership; another registers and never takes it.
        String memberPhone = phone(), plainPhone = phone();
        customerToken(memberPhone);
        customerToken(plainPhone);
        UUID plan = jdbc.sql("select id from membership_plans order by sort_order limit 1").query(UUID.class).single();
        jdbc.sql("insert into memberships (customer_id, status, valid_until, plan_id) select id, 'active', now() + interval '30 days', :pl from customers where phone = :p").param("pl", plan).param("p", memberPhone).update();
        jdbc.sql("insert into membership_payments (id, customer_id, plan_id, amount, period_start, period_end, source) select :id, id, :pl, 19900, now(), now() + interval '30 days', 'paid' from customers where phone = :p")
                .param("id", UUID.randomUUID()).param("pl", plan).param("p", memberPhone).update();

        String after = mvc.perform(as(a, get("/v1/admin/membership/summary"))).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertEquals(num(before, "$.registered") + 2, num(after, "$.registered"));
        assertEquals(num(before, "$.membersNow") + 1, num(after, "$.membersNow"));
        assertEquals(num(before, "$.neverJoined") + 1, num(after, "$.neverJoined"));
        assertEquals(num(before, "$.joined") + 1, num(after, "$.joined"));
        assertEquals(num(before, "$.feesInPeriod") + 19900, num(after, "$.feesInPeriod"));
        assertEquals(num(before, "$.feesAllTime") + 19900, num(after, "$.feesAllTime"));

        // The lists behind the numbers: members now, and registered but never a member.
        String member = vibeId(memberPhone), plain = vibeId(plainPhone);
        mvc.perform(as(a, get("/v1/admin/customers").param("membership", "member").param("q", member))).andExpect(jsonPath("$.items[*].vibeId", hasItem(member)));
        mvc.perform(as(a, get("/v1/admin/customers").param("membership", "never").param("q", plain))).andExpect(jsonPath("$.items[*].vibeId", hasItem(plain)));
        mvc.perform(as(a, get("/v1/admin/customers").param("membership", "never").param("q", member))).andExpect(jsonPath("$.items[*].vibeId", not(hasItem(member))));
        String csv = mvc.perform(as(a, get("/v1/admin/membership/summary.csv"))).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        org.junit.jupiter.api.Assertions.assertTrue(csv.contains("VIBE income"), csv);
    }
}
