package in.vibe.backend;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.ResultActions;

import java.time.OffsetDateTime;
import java.util.UUID;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Social one-on-ones that book a table first: pay to post, the table is booked when someone joins (paying their half when split), refunds
 * only before the 3-hour cut-off, expiry when nobody joins, chat safety, hosts verified by VIBE, and VIBE's monitor.
 */
class SocialMeetupsTest extends ApiTestSupport {
    private record Venue(String id, String merchant) {}

    private Venue cafe() throws Exception {
        String food = jdbc.sql("select id::text from categories where slug = 'food'").query(String.class).single();
        String biz = business(category(food, "Meet cafes " + uniq()), "Meet café " + uniq()), m = merchant(biz);
        verifyKyc(biz, m);
        mvc.perform(as(m, put("/v1/merchant/reservation-settings")).content("{\"enabled\":true,\"tableFee\":40000,\"policy\":\"Deposit comes off the bill.\",\"meetupsPerHour\":3}")).andExpect(status().isOk());
        return new Venue(biz, m);
    }

    private String person(String gender, String prefers) throws Exception {
        String c = customerToken(phone());
        mvc.perform(as(c, put("/v1/social/profile")).content("{\"gender\":\"" + gender + "\",\"meetPreference\":\"" + prefers + "\",\"ageConfirmed18\":true,\"ageBand\":\"25-34\",\"acceptGuidelines\":true}"))
                .andExpect(status().isOk());
        return c;
    }

    private String inSixHours() { return OffsetDateTime.now().plusHours(6).withNano(0).toString(); }

    private String postPlan(String c, Venue v, String payMode, String openTo) throws Exception {
        var res = mvc.perform(as(c, post("/v1/social/one-on-ones")).content("{\"kind\":\"coffee\",\"activity\":\"Coffee and conversation\",\"venueBusinessId\":\"" + v.id() + "\",\"startsAt\":\"" + inSixHours()
                + "\",\"openTo\":\"" + openTo + "\",\"payMode\":\"" + payMode + "\"}")).andReturn().getResponse();
        if (res.getStatus() != 201) throw new AssertionError(res.getStatus() + " " + res.getContentAsString());
        return res.getContentAsString();
    }

    private String pay(String c, String pr) throws Exception {
        String ref = JsonPath.read(mvc.perform(as(c, post("/v1/payment-requests/" + pr + "/payments")).header("Idempotency-Key", "m-" + uniq() + uniq()).content("{\"method\":\"upi\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.reference");
        mvc.perform(as(c, get("/v1/payments/" + ref))).andExpect(jsonPath("$.status", is("verified")));
        return ref;
    }

    private String memberId(String c) throws Exception { return JsonPath.read(mvc.perform(as(c, get("/v1/social/profile"))).andReturn().getResponse().getContentAsString(), "$.memberId"); }

    private ResultActions mine(String c, String id) throws Exception { return mvc.perform(as(c, get("/v1/social/one-on-ones/" + id))); }

    private String refundStatus(String ref) { return jdbc.sql("select refund_status from payments where reference = :r").param("r", ref).query(String.class).optional().orElse(null); }

    @Test
    void aPlanGoesLiveOnlyOnceTheTableDepositIsPaidAndTheTableIsBookedWhenSomeoneJoins() throws Exception {
        Venue v = cafe();
        // Guidelines first.
        String fresh = customerToken(phone());
        mvc.perform(as(fresh, get("/v1/social/one-on-ones"))).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("no_profile")));
        mvc.perform(as(fresh, put("/v1/social/profile")).content("{\"gender\":\"woman\",\"meetPreference\":\"men\",\"ageConfirmed18\":true}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code", is("guidelines")));
        mvc.perform(as(fresh, get("/v1/social/guidelines"))).andExpect(jsonPath("$.community", hasSize(6)));

        String asha = person("woman", "men"), ravi = person("man", "women"), meera = person("woman", "anyone");
        mvc.perform(as(asha, get("/v1/social/venues").param("kind", "coffee"))).andExpect(jsonPath("$[*].businessId", hasItem(v.id())));
        // Too soon to leave time before the cut-off.
        mvc.perform(as(asha, post("/v1/social/one-on-ones")).content("{\"kind\":\"coffee\",\"activity\":\"Coffee\",\"venueBusinessId\":\"" + v.id() + "\",\"startsAt\":\""
                + OffsetDateTime.now().plusHours(2).withNano(0) + "\",\"openTo\":\"men\"}")).andExpect(status().isBadRequest());

        // Posted, but a draft only Asha sees until the ₹400 deposit is paid.
        String created = postPlan(asha, v, "full", "men");
        String id = JsonPath.read(created, "$.id"), pr = JsonPath.read(created, "$.myPayment.paymentRequestId");
        assertEquals("draft", JsonPath.read(created, "$.status"));
        assertEquals(40000, ((Number) JsonPath.read(created, "$.myPayment.amount")).intValue());
        mvc.perform(as(ravi, get("/v1/social/one-on-ones"))).andExpect(jsonPath("$[?(@.id=='" + id + "')]", empty()));
        String hostRef = pay(asha, pr);
        mine(asha, id).andExpect(jsonPath("$.status", is("open"))).andExpect(jsonPath("$.reservation.reference", is(jdbc.sql("select reservation_ref from meetups where id = :id::uuid").param("id", id).query(String.class).single())));

        // Only people Asha is open to, and who are open to her, see it.
        mvc.perform(as(ravi, get("/v1/social/one-on-ones"))).andExpect(jsonPath("$[?(@.id=='" + id + "')].myStatus", hasItem("none")));
        mvc.perform(as(meera, get("/v1/social/one-on-ones"))).andExpect(jsonPath("$[?(@.id=='" + id + "')]", empty()));
        mvc.perform(as(meera, post("/v1/social/one-on-ones/" + id + "/requests"))).andExpect(status().isForbidden());

        // Ravi asks; Asha accepts: paid in full, so the table is booked at once and the café is told.
        mvc.perform(as(ravi, post("/v1/social/one-on-ones/" + id + "/requests"))).andExpect(status().isOk()).andExpect(jsonPath("$.myStatus", is("requested")));
        String raviMember = memberId(ravi);
        mvc.perform(as(asha, post("/v1/social/one-on-ones/" + id + "/requests/" + raviMember + "/respond")).content("{\"accept\":true}"))
                .andExpect(jsonPath("$.status", is("matched"))).andExpect(jsonPath("$.matchedWith.id", is(raviMember)));
        String ref = jdbc.sql("select reservation_ref from meetups where id = :id::uuid").param("id", id).query(String.class).single();
        mvc.perform(as(v.merchant(), get("/v1/merchant/reservations").param("day", OffsetDateTime.now().plusHours(6).atZoneSameInstant(java.time.ZoneId.of("Asia/Kolkata")).toLocalDate().toString())))
                .andExpect(jsonPath("$[?(@.reference=='" + ref + "')].status", hasItem("confirmed"))).andExpect(jsonPath("$[?(@.reference=='" + ref + "')].depositPaid", hasItem(40000)));
        mvc.perform(as(v.merchant(), post("/v1/merchant/reservations/" + ref + "/no-show"))).andExpect(status().isConflict()); // the table is held until 30 minutes after the start

        // Chat: meeting details only. A phone number is stopped, the chat closes, both are blocked and VIBE gets a report.
        mvc.perform(as(ravi, post("/v1/social/one-on-ones/" + id + "/chat/messages")).content("{\"template\":\"dress\",\"value\":\"a blue shirt\"}")).andExpect(jsonPath("$.delivered", is(true)));
        mvc.perform(as(asha, post("/v1/social/one-on-ones/" + id + "/chat/messages")).content("{\"text\":\"call me on 98765 43210\"}"))
                .andExpect(jsonPath("$.delivered", is(false))).andExpect(jsonPath("$.rejection", is("contact_shared"))).andExpect(jsonPath("$.chat.status", is("closed")));
        assertEquals(2, jdbc.sql("select count(*) from social_blocks where blocker_id in (select customer_id from social_profiles where member_id = :m::uuid) or blocked_id in (select customer_id from social_profiles where member_id = :m::uuid)")
                .param("m", raviMember).query(Integer.class).single());

        // Ravi cancels more than 3 hours ahead: Asha's deposit is refunded.
        mvc.perform(as(ravi, post("/v1/social/one-on-ones/" + id + "/cancel"))).andExpect(status().isNoContent());
        assertEquals("due", refundStatus(hostRef));

        // VIBE's monitor: who, VIBE IDs, transaction IDs; the chat is shown because it was closed for a contact detail.
        String a = adminToken();
        String ashaVibe = jdbc.sql("select c.vibe_id from customers c join social_profiles p on p.customer_id = c.id where p.member_id = :m::uuid").param("m", memberId(asha)).query(String.class).single();
        mvc.perform(as(a, get("/v1/admin/social/meetups").param("q", ashaVibe))).andExpect(jsonPath("$.rows[0].reference", is(ref))).andExpect(jsonPath("$.rows[0].hostPayment", is(hostRef)))
                .andExpect(jsonPath("$.rows[0].host.vibeId", is(ashaVibe))).andExpect(jsonPath("$.rows[0].status", is("cancelled")));
        mvc.perform(as(a, get("/v1/admin/social/meetups/" + id))).andExpect(jsonPath("$.chat", hasSize(3))).andExpect(jsonPath("$.reports[0].reason", is("contact_shared")));
        mvc.perform(as(a, get("/v1/admin/social/overview"))).andExpect(jsonPath("$.contactShared", is(org.hamcrest.Matchers.greaterThanOrEqualTo(1))));
    }

    @Test
    void splitPlansBookTheTableWhenTheGuestPaysTheirHalfAndRefundsFollowTheCutOff() throws Exception {
        Venue v = cafe();
        String nisha = person("woman", "anyone"), arjun = person("man", "anyone"), kiran = person("man", "anyone");
        String created = postPlan(nisha, v, "split", "anyone");
        String id = JsonPath.read(created, "$.id");
        assertEquals(20000, ((Number) JsonPath.read(created, "$.myPayment.amount")).intValue()); // her half of ₹400
        String hostRef = pay(nisha, JsonPath.read(created, "$.myPayment.paymentRequestId"));
        mine(nisha, id).andExpect(jsonPath("$.reservation.amount", is(20000))); // only her half is paid so far

        // Accepted, Arjun must pay his half; until he does, the table isn't booked.
        mvc.perform(as(arjun, post("/v1/social/one-on-ones/" + id + "/requests"))).andExpect(status().isOk());
        mvc.perform(as(nisha, post("/v1/social/one-on-ones/" + id + "/requests/" + memberId(arjun) + "/respond")).content("{\"accept\":true}")).andExpect(jsonPath("$.status", is("awaiting_payment")));
        String half = JsonPath.read(mine(arjun, id).andExpect(jsonPath("$.myStatus", is("pay"))).andExpect(jsonPath("$.myPayment.amount", is(20000))).andReturn().getResponse().getContentAsString(), "$.myPayment.paymentRequestId");
        // Doesn't pay in time: the plan opens again.
        jdbc.sql("update meetups set partner_pay_by = now() - interval '1 minute' where id = :id::uuid").param("id", id).update();
        mine(nisha, id).andExpect(jsonPath("$.status", is("awaiting_payment")));
        mvc.perform(as(nisha, get("/v1/social/one-on-ones"))).andExpect(jsonPath("$[?(@.id=='" + id + "')].status", hasItem("open")));
        assertEquals("void", jdbc.sql("select status from payment_requests where id = :p::uuid").param("p", half).query(String.class).single());

        // Kiran joins and pays his half: booked.
        mvc.perform(as(kiran, post("/v1/social/one-on-ones/" + id + "/requests"))).andExpect(status().isOk());
        mvc.perform(as(nisha, post("/v1/social/one-on-ones/" + id + "/requests/" + memberId(kiran) + "/respond")).content("{\"accept\":true}")).andExpect(status().isOk());
        String kiranPr = JsonPath.read(mine(kiran, id).andReturn().getResponse().getContentAsString(), "$.myPayment.paymentRequestId");
        String guestRef = pay(kiran, kiranPr);
        mine(nisha, id).andExpect(jsonPath("$.status", is("matched"))).andExpect(jsonPath("$.reservation.amount", is(40000)));

        // After the cut-off, cancelling refunds nothing: the café keeps the deposit.
        jdbc.sql("update meetups set starts_at = now() + interval '2 hours' where id = :id::uuid").param("id", id).update();
        mvc.perform(as(nisha, post("/v1/social/one-on-ones/" + id + "/cancel"))).andExpect(status().isNoContent());
        assertNull(refundStatus(hostRef));
        assertNull(refundStatus(guestRef));
    }

    @Test
    void aPlanNobodyJoinsBeforeTheCutOffExpiresAndIsRefunded() throws Exception {
        Venue v = cafe();
        String sam = person("man", "anyone");
        String created = postPlan(sam, v, "full", "anyone");
        String id = JsonPath.read(created, "$.id"), ref = pay(sam, JsonPath.read(created, "$.myPayment.paymentRequestId"));
        jdbc.sql("update meetups set starts_at = now() + interval '2 hours 30 minutes' where id = :id::uuid").param("id", id).update();
        mine(sam, id).andExpect(jsonPath("$.status", is("open")));
        mvc.perform(as(sam, get("/v1/social/one-on-ones"))).andExpect(status().isOk());
        mine(sam, id).andExpect(jsonPath("$.status", is("expired"))).andExpect(jsonPath("$.cancelledReason", containsString("Nobody joined")));
        assertEquals("due", refundStatus(ref));
    }

    @Test
    void hostsAreVibeMembersVerifiedByVibeAndReportsCanSuspendSomeone() throws Exception {
        String priya = person("woman", "anyone"), troll = person("man", "anyone");
        String body = "{\"legalName\":\"Priya S\",\"idType\":\"pan\",\"idLast4\":\"234f\",\"dateOfBirth\":\"1996-04-12\",\"about\":\"Book club\",\"acceptHostGuidelines\":true}";
        mvc.perform(as(priya, post("/v1/social/host")).content(body)).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("membership_required")));
        String phoneOfPriya = jdbc.sql("select c.phone from customers c join social_profiles p on p.customer_id = c.id where p.member_id = :m::uuid").param("m", memberId(priya)).query(String.class).single();
        makeMember(phoneOfPriya);
        mvc.perform(as(priya, post("/v1/social/host")).content(body)).andExpect(status().isOk()).andExpect(jsonPath("$.status", is("pending"))).andExpect(jsonPath("$.idLast4", is("234F")));
        String a = adminToken();
        String cid = jdbc.sql("select customer_id::text from social_profiles where member_id = :m::uuid").param("m", memberId(priya)).query(String.class).single();
        mvc.perform(as(a, get("/v1/admin/social/hosts").param("status", "pending"))).andExpect(jsonPath("$[*].customerId", hasItem(cid)));
        mvc.perform(as(a, post("/v1/admin/social/hosts/" + cid + "/decide")).content("{\"decision\":\"approve\"}")).andExpect(status().isNoContent());
        mvc.perform(as(priya, get("/v1/social/host"))).andExpect(jsonPath("$.status", is("approved")));

        // A report, then VIBE suspends the person: they can't use Social any more.
        String report = JsonPath.read(mvc.perform(as(priya, post("/v1/reports")).content("{\"targetType\":\"user\",\"targetId\":\"" + memberId(troll) + "\",\"reason\":\"harassment\",\"note\":\"Rude messages\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.reportId");
        String trollCid = jdbc.sql("select customer_id::text from social_profiles where member_id = :m::uuid").param("m", memberId(troll)).query(String.class).single();
        mvc.perform(as(a, post("/v1/admin/social/reports/" + report + "/resolve")).content("{\"action\":\"action\",\"note\":\"Harassment confirmed\",\"suspendCustomerId\":\"" + trollCid + "\"}"))
                .andExpect(jsonPath("$.status", is("actioned")));
        mvc.perform(as(troll, get("/v1/social/one-on-ones"))).andExpect(status().isForbidden());

        // Category managers don't get the Social monitor.
        String email = "cm-" + uniq() + "@test.local";
        mvc.perform(as(a, post("/v1/admin/team")).content("{\"email\":\"" + email + "\",\"name\":\"CM\",\"password\":\"" + PASSWORD + "\",\"role\":\"staff\",\"areas\":[\"customers\"],\"categoryIds\":[\""
                + jdbc.sql("select id::text from categories where slug = 'food'").query(String.class).single() + "\"]}")).andExpect(status().isCreated());
        mvc.perform(as(signInSettled(email, PASSWORD), get("/v1/admin/social/overview"))).andExpect(status().isForbidden());
    }
}
