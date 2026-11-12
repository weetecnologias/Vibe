package in.vibe.backend;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MvcResult;

import java.time.LocalDate;
import java.time.ZoneId;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.startsWith;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Monthly memberships at gyms, yoga and meditation studios and trainers: plans, buying one from a chosen start date, the pass, the front desk and offers at checkout. */
class VenuePassesTest extends ApiTestSupport {
    static final LocalDate TODAY = LocalDate.now(ZoneId.of("Asia/Kolkata"));

    class Gym {
        final String biz = business(category(null, "Gyms " + uniq()), "Pulse " + uniq());
        final String merchant = merchant(biz);
        final String monthly, quarter;

        Gym() throws Exception {
            monthly = plan("{\"name\":\"Monthly unlimited\",\"months\":1,\"price\":299900,\"benefits\":[\"All equipment\",\"Locker\"]}");
            quarter = plan("{\"name\":\"3 months\",\"months\":3,\"price\":799900,\"sortOrder\":1}");
        }

        String plan(String json) throws Exception {
            return id(mvc.perform(as(merchant, post("/v1/merchant/venue/plans")).content(json)).andExpect(status().isCreated()).andReturn());
        }

        MvcResult buy(String customer, String plan, LocalDate start) throws Exception {
            return mvc.perform(as(customer, post("/v1/venue-passes")).content("{\"planId\":\"" + plan + "\",\"startsOn\":\"" + start + "\"}")).andReturn();
        }

        String pay(String customer, String pr) throws Exception {
            return JsonPath.read(mvc.perform(as(customer, post("/v1/payment-requests/" + pr + "/payments")).header("Idempotency-Key", "pass-" + uniq() + uniq()).content("{\"method\":\"upi\"}"))
                    .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.reference");
        }

        /** Buys, pays and lets the simulated partner confirm. Returns the pass id. */
        String buyAndPay(String customer, String plan, LocalDate start) throws Exception {
            MvcResult r = buy(customer, plan, start);
            assertEquals(201, r.getResponse().getStatus(), r.getResponse().getContentAsString());
            String ref = pay(customer, JsonPath.read(r.getResponse().getContentAsString(), "$.paymentRequestId"));
            mvc.perform(as(customer, get("/v1/payments/" + ref))).andExpect(jsonPath("$.status", is("verified"))).andExpect(jsonPath("$.kind", is("pass")));
            return JsonPath.read(r.getResponse().getContentAsString(), "$.id");
        }
    }

    @Test
    void aCustomerChoosesAMonthlyPlanAndAStartDatePaysAndGetsAPassTheFrontDeskChecksIn() throws Exception {
        Gym g = new Gym();
        mvc.perform(get("/v1/businesses/" + g.biz + "/plans")).andExpect(status().isOk()).andExpect(jsonPath("$", hasSize(2)))
                .andExpect(jsonPath("$[0].name", is("Monthly unlimited"))).andExpect(jsonPath("$[0].benefits", hasSize(2)))
                .andExpect(jsonPath("$[1].months", is(3))).andExpect(jsonPath("$[1].perMonth", is(266633)));

        String c = customerToken(phone());
        MvcResult held = g.buy(c, g.monthly, TODAY);
        assertEquals(201, held.getResponse().getStatus(), held.getResponse().getContentAsString());
        String body = held.getResponse().getContentAsString();
        assertEquals("held", JsonPath.read(body, "$.status"));
        assertEquals(TODAY.plusMonths(1).minusDays(1).toString(), JsonPath.read(body, "$.endsOn"));
        String pr = JsonPath.read(body, "$.paymentRequestId"), passId = JsonPath.read(body, "$.id");
        // The bill: the plan, VIBE's ₹20 booking fee on top.
        mvc.perform(as(c, get("/v1/payment-requests/" + pr))).andExpect(jsonPath("$.kind", is("pass"))).andExpect(jsonPath("$.lines[0].label", containsString("Monthly unlimited")))
                .andExpect(jsonPath("$.eligibleAmount", is(299900))).andExpect(jsonPath("$.vibeFee", is(2000))).andExpect(jsonPath("$.payable", is(301900)));

        String ref = g.pay(c, pr);
        mvc.perform(as(c, get("/v1/payments/" + ref))).andExpect(jsonPath("$.status", is("verified"))).andExpect(jsonPath("$.passId", is(passId)));
        mvc.perform(as(c, get("/v1/venue-passes/" + passId))).andExpect(jsonPath("$.status", is("paid"))).andExpect(jsonPath("$.activeNow", is(true)))
                .andExpect(jsonPath("$.passRef", startsWith("VBP-"))).andExpect(jsonPath("$.passCode").exists());
        mvc.perform(as(c, get("/v1/me/venue-passes"))).andExpect(jsonPath("$", hasSize(1)));
        mvc.perform(as(c, get("/v1/me/notifications"))).andExpect(jsonPath("$[?(@.kind=='pass_bought')]", hasSize(1)));

        // The gym: alerted, sees the member, and is owed the plan price (the booking fee is VIBE's).
        mvc.perform(as(g.merchant, get("/v1/staff/notifications"))).andExpect(jsonPath("$.items[?(@.kind=='pass_bought')]", hasSize(1)));
        mvc.perform(as(g.merchant, get("/v1/merchant/venue/members"))).andExpect(jsonPath("$", hasSize(1))).andExpect(jsonPath("$[0].planName", is("Monthly unlimited")));
        mvc.perform(as(adminToken(), get("/v1/admin/settlements/due"))).andExpect(jsonPath("$[?(@.businessId=='" + g.biz + "')].gross", hasItem(301900)))
                .andExpect(jsonPath("$[?(@.businessId=='" + g.biz + "')].vibeFees", hasItem(2000)));

        // Front desk: the pass code lets them in on any day it is valid; another venue doesn't know it.
        String code = JsonPath.read(mvc.perform(as(c, get("/v1/venue-passes/" + passId))).andReturn().getResponse().getContentAsString(), "$.passCode");
        mvc.perform(as(g.merchant, post("/v1/merchant/venue/check-in")).content("{\"code\":\"" + code + "\"}")).andExpect(jsonPath("$.result", is("admitted")))
                .andExpect(jsonPath("$.message", containsString("Monthly unlimited")));
        mvc.perform(as(g.merchant, get("/v1/merchant/venue/members"))).andExpect(jsonPath("$[0].checkIns", is(1)));
        mvc.perform(as(new Gym().merchant, post("/v1/merchant/venue/check-in")).content("{\"code\":\"" + code + "\"}")).andExpect(status().isNotFound());

        // A plan that's been sold is kept; switching it off stops selling it.
        mvc.perform(as(g.merchant, delete("/v1/merchant/venue/plans/" + g.monthly))).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("in_use")));
        mvc.perform(as(g.merchant, put("/v1/merchant/venue/plans/" + g.monthly)).content("{\"name\":\"Monthly unlimited\",\"months\":1,\"price\":299900,\"active\":false}")).andExpect(status().isOk());
        mvc.perform(get("/v1/businesses/" + g.biz + "/plans")).andExpect(jsonPath("$", hasSize(1)));
        assertEquals(404, g.buy(c, g.monthly, TODAY).getResponse().getStatus());
        mvc.perform(as(g.merchant, delete("/v1/merchant/venue/plans/" + g.quarter))).andExpect(status().isNoContent());
    }

    @Test
    void aPassStartingNextMonthIsntValidYetAndStartDatesAndPlansAreChecked() throws Exception {
        Gym g = new Gym();
        String c = customerToken(phone());
        LocalDate next = TODAY.withDayOfMonth(1).plusMonths(1);
        String passId = g.buyAndPay(c, g.quarter, next);
        mvc.perform(as(c, get("/v1/venue-passes/" + passId))).andExpect(jsonPath("$.activeNow", is(false))).andExpect(jsonPath("$.endsOn", is(next.plusMonths(3).minusDays(1).toString())));
        String code = JsonPath.read(mvc.perform(as(c, get("/v1/venue-passes/" + passId))).andReturn().getResponse().getContentAsString(), "$.passCode");
        mvc.perform(as(g.merchant, post("/v1/merchant/venue/check-in")).content("{\"code\":\"" + code + "\"}")).andExpect(jsonPath("$.result", is("not_started")));

        assertEquals(400, g.buy(c, g.monthly, TODAY.minusDays(1)).getResponse().getStatus());
        assertEquals(400, g.buy(c, g.monthly, TODAY.plusDays(61)).getResponse().getStatus());
        mvc.perform(as(g.merchant, post("/v1/merchant/venue/plans")).content("{\"name\":\"Two months\",\"months\":2,\"price\":100000}")).andExpect(status().isBadRequest());
        // A customer can't see someone else's pass; a cashier doesn't manage plans.
        mvc.perform(as(customerToken(phone()), get("/v1/venue-passes/" + passId))).andExpect(status().isNotFound());
        String email = "c-" + uniq() + "@test.local";
        mvc.perform(as(g.merchant, post("/v1/merchant/team")).content("{\"email\":\"" + email + "\",\"name\":\"C\",\"password\":\"" + PASSWORD + "\",\"staffRole\":\"cashier\"}")).andExpect(status().isCreated());
        mvc.perform(as(signInSettled(email, PASSWORD), get("/v1/merchant/venue/plans"))).andExpect(status().isForbidden());
    }

    @Test
    void vibeMembersGetTheirOfferAtCheckoutOnMembershipsAndCourtBookings() throws Exception {
        String code = "MBR" + uniq().toUpperCase().replaceAll("[^A-Z0-9]", "7").substring(0, 6);
        mvc.perform(as(adminToken(), post("/v1/admin/coupons")).content("""
            {"code":"%s","title":"Members 5%% off","kinds":["slots","pass"],"memberOnly":true,"kind":"percentage","rateBps":500,"maxDiscount":30000,"startsAt":"2026-01-01T00:00:00Z","endsAt":"2031-01-01T00:00:00Z"}""".formatted(code)))
                .andExpect(status().isCreated());
        Gym g = new Gym();
        String phone = phone(), c = customerToken(phone);
        String pr = JsonPath.read(g.buy(c, g.monthly, TODAY).getResponse().getContentAsString(), "$.paymentRequestId");
        // Not a member yet: shown, but not usable.
        mvc.perform(as(c, get("/v1/payment-requests/" + pr + "/offers"))).andExpect(jsonPath("$.available[?(@.code=='" + code + "')].eligible", hasItem(false)))
                .andExpect(jsonPath("$.available[?(@.code=='" + code + "')].reason", hasItem("For VIBE members.")));
        mvc.perform(as(c, post("/v1/payment-requests/" + pr + "/offer")).content("{\"code\":\"" + code + "\"}")).andExpect(status().isConflict());

        makeMember(phone);
        mvc.perform(as(c, get("/v1/payment-requests/" + pr + "/offers"))).andExpect(jsonPath("$.available[?(@.code=='" + code + "')].saving", hasItem(14995)));
        mvc.perform(as(c, post("/v1/payment-requests/" + pr + "/offer")).content("{\"code\":\"" + code + "\"}")).andExpect(status().isOk())
                .andExpect(jsonPath("$.discount", is(14995))).andExpect(jsonPath("$.payable", is(299900 - 14995 + 2000)));
        String ref = g.pay(c, pr);
        mvc.perform(as(c, get("/v1/payments/" + ref))).andExpect(jsonPath("$.amount", is(286905))).andExpect(jsonPath("$.savings", is(14995)));
        // VIBE pays the discount: the gym is still owed the full price.
        mvc.perform(as(adminToken(), get("/v1/admin/settlements/due"))).andExpect(jsonPath("$[?(@.businessId=='" + g.biz + "')].gross", hasItem(301900)));

        // The same offer on a court booking, capped at ₹300.
        String venue = business(category(null, "Sports " + uniq()), "Arena " + uniq());
        String vm = merchant(venue);
        String court = id(mvc.perform(as(vm, post("/v1/merchant/venue/resources")).content("{\"sport\":\"Tennis\",\"name\":\"Court A\",\"kind\":\"court\",\"price\":80000}")).andExpect(status().isCreated()).andReturn());
        String slot = "{\"resourceId\":\"" + court + "\",\"startsAt\":\"" + SlotBookingTest.at(10) + "\",\"minutes\":60,\"spots\":1}";
        MvcResult b = mvc.perform(as(c, post("/v1/slot-bookings")).content("{\"businessId\":\"" + venue + "\",\"items\":[" + slot + "]}")).andReturn();
        assertEquals(201, b.getResponse().getStatus(), b.getResponse().getContentAsString());
        String spr = JsonPath.read(b.getResponse().getContentAsString(), "$.paymentRequestId");
        mvc.perform(as(c, post("/v1/payment-requests/" + spr + "/offer")).content("{\"code\":\"" + code + "\"}")).andExpect(jsonPath("$.discount", is(4000))).andExpect(jsonPath("$.payable", is(78000)));
    }
}
