package in.vibe.backend;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MvcResult;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.startsWith;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Booking courts and classes by the slot, like Playo: the venue's courts, the slot grid, holds, paying, confirmation, the venue's day and the front desk. */
class SlotBookingTest extends ApiTestSupport {
    static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    /** Test venues open Monday and Tuesday, 9 AM to 10 PM. */
    static final LocalDate MONDAY = LocalDate.now(IST).plusDays(1).with(TemporalAdjusters.nextOrSame(DayOfWeek.MONDAY));

    static String at(int hour) { return MONDAY.atTime(hour, 0).atZone(IST).toOffsetDateTime().toString(); }

    class Venue {
        final String biz = business(category(null, "Sports " + uniq()), "Smash " + uniq());
        final String merchant = merchant(biz);
        final String court1, court2, swim;

        Venue() throws Exception {
            court1 = resource("{\"sport\":\"Badminton\",\"name\":\"Court 1\",\"kind\":\"court\",\"price\":35000,\"peakPrice\":50000,\"peakFrom\":\"18:00\",\"peakTo\":\"22:00\"}");
            court2 = resource("{\"sport\":\"Badminton\",\"name\":\"Court 2\",\"kind\":\"court\",\"price\":35000}");
            swim = resource("{\"sport\":\"Swimming\",\"name\":\"Pool session\",\"kind\":\"spots\",\"capacity\":3,\"price\":20000}");
        }

        String resource(String json) throws Exception {
            return id(mvc.perform(as(merchant, post("/v1/merchant/venue/resources")).content(json)).andExpect(status().isCreated()).andReturn());
        }

        MvcResult book(String customer, String items) throws Exception {
            return mvc.perform(as(customer, post("/v1/slot-bookings")).content("{\"businessId\":\"" + biz + "\",\"items\":" + items + "}")).andReturn();
        }

        String item(String resource, int hour, int minutes, int spots) {
            return "{\"resourceId\":\"" + resource + "\",\"startsAt\":\"" + at(hour) + "\",\"minutes\":" + minutes + ",\"spots\":" + spots + "}";
        }

        /** Holds, pays and lets the simulated partner confirm. Returns the booking id. */
        String bookAndPay(String customer, String items) throws Exception {
            MvcResult r = book(customer, items);
            assertEquals(201, r.getResponse().getStatus(), r.getResponse().getContentAsString());
            String pr = JsonPath.read(r.getResponse().getContentAsString(), "$.paymentRequestId");
            String ref = JsonPath.read(mvc.perform(as(customer, post("/v1/payment-requests/" + pr + "/payments")).header("Idempotency-Key", "slot-" + uniq() + uniq()).content("{\"method\":\"upi\"}"))
                    .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.reference");
            mvc.perform(as(customer, get("/v1/payments/" + ref))).andExpect(jsonPath("$.status", is("verified"))).andExpect(jsonPath("$.kind", is("slots")));
            return JsonPath.read(r.getResponse().getContentAsString(), "$.id");
        }
    }

    @Test
    void aCustomerPicksASlotPaysAndGetsAnEntryCodeAndTheVenueIsTold() throws Exception {
        Venue v = new Venue();
        mvc.perform(get("/v1/businesses/" + v.biz + "/sports")).andExpect(jsonPath("$", hasSize(2))).andExpect(jsonPath("$[?(@.sport=='Badminton')].resources", hasItem(2)))
                .andExpect(jsonPath("$[?(@.sport=='Badminton')].fromPrice", hasItem(35000)));
        mvc.perform(get("/v1/businesses/" + v.biz)).andExpect(jsonPath("$.slotFromPrice", is(20000)));

        // The grid: every hour 9 AM to 10 PM, both courts free, evening at the peak price on Court 1.
        mvc.perform(get("/v1/businesses/" + v.biz + "/slots").param("sport", "Badminton").param("date", MONDAY.toString())).andExpect(status().isOk())
                .andExpect(jsonPath("$.slots", hasSize(13))).andExpect(jsonPath("$.durations", hasSize(3))).andExpect(jsonPath("$.kind", is("court")))
                .andExpect(jsonPath("$.slots[0].label", is("9–10 AM"))).andExpect(jsonPath("$.slots[0].startLabel", is("9:00 AM"))).andExpect(jsonPath("$.slots[0].options[?(@.name=='Court 1')].price", hasItem(35000)))
                .andExpect(jsonPath("$.slots[10].label", is("7–8 PM"))).andExpect(jsonPath("$.slots[10].options[?(@.name=='Court 1')].price", hasItem(50000)));
        // Choosing 2 hours: each start shows its whole range, 11 AM–1 PM, at the price for both hours.
        mvc.perform(get("/v1/businesses/" + v.biz + "/slots").param("sport", "Badminton").param("date", MONDAY.toString()).param("minutes", "120"))
                .andExpect(jsonPath("$.slots[0].label", is("9–11 AM"))).andExpect(jsonPath("$.slots[2].label", is("11 AM–1 PM"))).andExpect(jsonPath("$.slots[0].fromPrice", is(70000)));
        mvc.perform(get("/v1/businesses/" + v.biz + "/slots").param("sport", "Badminton").param("date", MONDAY.plusDays(2).toString())).andExpect(jsonPath("$.closedReason", is("Closed on this day.")));

        // 5–7 PM on Court 1 is one normal and one peak hour.
        String customer = customerToken(phone());
        MvcResult held = v.book(customer, "[" + v.item(v.court1, 17, 120, 1) + "]");
        assertEquals(201, held.getResponse().getStatus(), held.getResponse().getContentAsString());
        mvc.perform(as(customer, get("/v1/slot-bookings/" + JsonPath.read(held.getResponse().getContentAsString(), "$.id")))).andExpect(jsonPath("$.total", is(85000))).andExpect(jsonPath("$.status", is("held")))
                .andExpect(jsonPath("$.entryCode").doesNotExist());
        String pr = JsonPath.read(held.getResponse().getContentAsString(), "$.paymentRequestId");
        mvc.perform(as(customer, get("/v1/payment-requests/" + pr))).andExpect(jsonPath("$.kind", is("slots"))).andExpect(jsonPath("$.lines[0].label", containsString("Badminton · Court 1")))
                .andExpect(jsonPath("$.lines[0].label", containsString("5–7 PM"))).andExpect(jsonPath("$.vibeFee", is(2000))).andExpect(jsonPath("$.payable", is(87000)));
        // While held, Court 1 isn't offered at 5 PM to anyone else.
        mvc.perform(get("/v1/businesses/" + v.biz + "/slots").param("sport", "Badminton").param("date", MONDAY.toString()))
                .andExpect(jsonPath("$.slots[8].options[?(@.name=='Court 1')].available", hasItem(false))).andExpect(jsonPath("$.slots[8].options[?(@.name=='Court 2')].available", hasItem(true)));

        String ref = JsonPath.read(mvc.perform(as(customer, post("/v1/payment-requests/" + pr + "/payments")).header("Idempotency-Key", "slot-" + uniq() + uniq()).content("{\"method\":\"upi\"}"))
                .andReturn().getResponse().getContentAsString(), "$.reference");
        String bookingId = JsonPath.read(held.getResponse().getContentAsString(), "$.id");
        mvc.perform(as(customer, get("/v1/payments/" + ref))).andExpect(jsonPath("$.status", is("verified"))).andExpect(jsonPath("$.slotBookingId", is(bookingId)));
        mvc.perform(as(customer, get("/v1/slot-bookings/" + bookingId))).andExpect(jsonPath("$.status", is("paid"))).andExpect(jsonPath("$.entryCode").exists()).andExpect(jsonPath("$.bookingRef", startsWith("VBS-")));
        mvc.perform(as(customer, get("/v1/me/slot-bookings"))).andExpect(jsonPath("$", hasSize(1)));
        mvc.perform(as(customer, get("/v1/me/notifications"))).andExpect(jsonPath("$[?(@.kind=='slot_booked')]", hasSize(1)));

        // The venue: alerted, sees it on its day, and is owed the money.
        mvc.perform(as(v.merchant, get("/v1/staff/notifications"))).andExpect(jsonPath("$.items[?(@.kind=='slot_booked')].title", hasItem(containsString("Badminton booked: Court 1"))));
        mvc.perform(as(v.merchant, get("/v1/merchant/venue/day").param("date", MONDAY.toString()))).andExpect(jsonPath("$.bookings", hasSize(1))).andExpect(jsonPath("$.bookings[0].resourceId", is(v.court1)))
                .andExpect(jsonPath("$.resources", hasSize(3)));
        mvc.perform(as(adminToken(), get("/v1/admin/settlements/due"))).andExpect(jsonPath("$[?(@.businessId=='" + v.biz + "')].gross", hasItem(87000)))
                .andExpect(jsonPath("$[?(@.businessId=='" + v.biz + "')].vibeFees", hasItem(2000))); // the ₹20 booking fee is VIBE's, not the venue's

        // Front desk: the entry code checks in once.
        String code = JsonPath.read(mvc.perform(as(customer, get("/v1/slot-bookings/" + bookingId))).andReturn().getResponse().getContentAsString(), "$.entryCode");
        mvc.perform(as(v.merchant, post("/v1/merchant/venue/check-in")).content("{\"code\":\"" + code.toLowerCase().replace("-", "") + "\"}")).andExpect(jsonPath("$.result", is("admitted")));
        mvc.perform(as(v.merchant, post("/v1/merchant/venue/check-in")).content("{\"code\":\"" + code + "\"}")).andExpect(jsonPath("$.result", is("already")));
        mvc.perform(as(new Venue().merchant, post("/v1/merchant/venue/check-in")).content("{\"code\":\"" + code + "\"}")).andExpect(status().isNotFound());
    }

    @Test
    void aCourtCantBeBookedTwiceAndASessionFillsUpToItsCapacity() throws Exception {
        Venue v = new Venue();
        String a = customerToken(phone()), b = customerToken(phone());
        v.bookAndPay(a, "[" + v.item(v.court2, 10, 60, 1) + "]");
        MvcResult clash = v.book(b, "[" + v.item(v.court2, 10, 60, 1) + "]");
        assertEquals(409, clash.getResponse().getStatus());
        assertEquals("slot_taken", JsonPath.read(clash.getResponse().getContentAsString(), "$.code"));
        // An overlapping longer booking is refused too; the other court is fine.
        assertEquals(409, v.book(b, "[" + v.item(v.court2, 9, 120, 1) + "]").getResponse().getStatus());
        assertEquals(201, v.book(b, "[" + v.item(v.court1, 10, 60, 1) + "]").getResponse().getStatus());

        // Swimming: 3 spots per hour.
        v.bookAndPay(a, "[" + v.item(v.swim, 11, 60, 2) + "]");
        MvcResult full = v.book(customerToken(phone()), "[" + v.item(v.swim, 11, 60, 2) + "]");
        assertEquals(409, full.getResponse().getStatus());
        assertEquals("Only 1 spots left in Pool session at 11:00 AM.", JsonPath.read(full.getResponse().getContentAsString(), "$.message"));
        mvc.perform(get("/v1/businesses/" + v.biz + "/slots").param("sport", "Swimming").param("date", MONDAY.toString())).andExpect(jsonPath("$.slots[2].options[0].spotsLeft", is(1)));
    }

    @Test
    void bookingsAreCheckedOnTheServer() throws Exception {
        Venue v = new Venue();
        String c = customerToken(phone());
        assertEquals(400, v.book(c, "[" + v.item(v.court1, 21, 120, 1) + "]").getResponse().getStatus()); // runs past closing
        assertEquals(400, v.book(c, "[" + v.item(v.court1, 10, 90, 1) + "]").getResponse().getStatus()); // not whole slots
        String past = "{\"resourceId\":\"" + v.court1 + "\",\"startsAt\":\"" + java.time.OffsetDateTime.now().minusHours(2) + "\",\"minutes\":60}";
        assertEquals(409, v.book(c, "[" + past + "]").getResponse().getStatus());
        // Another venue's court can't be booked here, and two holds at once at the same venue: the newer replaces the older.
        Venue other = new Venue();
        assertEquals(400, v.book(c, "[" + v.item(other.court1, 10, 60, 1) + "]").getResponse().getStatus());
        String first = JsonPath.read(v.book(c, "[" + v.item(v.court1, 12, 60, 1) + "]").getResponse().getContentAsString(), "$.id");
        v.book(c, "[" + v.item(v.court1, 13, 60, 1) + "]");
        mvc.perform(as(c, get("/v1/slot-bookings/" + first))).andExpect(jsonPath("$.status", is("released")));
        mvc.perform(get("/v1/businesses/" + v.biz + "/slots").param("sport", "Badminton").param("date", MONDAY.toString())).andExpect(jsonPath("$.slots[3].options[?(@.name=='Court 1')].available", hasItem(true)));
    }

    @Test
    void theVenueBlocksTimesManagesCourtsAndOnlyItsBookingsTeamSeesThem() throws Exception {
        Venue v = new Venue();
        String block = id(mvc.perform(as(v.merchant, post("/v1/merchant/venue/blocks")).content("{\"resourceId\":\"" + v.court2 + "\",\"startsAt\":\"" + at(14) + "\",\"endsAt\":\"" + at(16) + "\",\"reason\":\"Floor polishing\"}"))
                .andExpect(status().isCreated()).andReturn());
        mvc.perform(get("/v1/businesses/" + v.biz + "/slots").param("sport", "Badminton").param("date", MONDAY.toString())).andExpect(jsonPath("$.slots[5].options[?(@.name=='Court 2')].available", hasItem(false)));
        assertEquals(409, v.book(customerToken(phone()), "[" + v.item(v.court2, 14, 60, 1) + "]").getResponse().getStatus());
        mvc.perform(as(v.merchant, delete("/v1/merchant/venue/blocks/" + block))).andExpect(status().isNoContent());

        // A court with bookings is kept, not deleted; a new one can be removed.
        v.bookAndPay(customerToken(phone()), "[" + v.item(v.court1, 9, 60, 1) + "]");
        mvc.perform(as(v.merchant, delete("/v1/merchant/venue/resources/" + v.court1))).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("in_use")));
        String spare = v.resource("{\"sport\":\"Badminton\",\"name\":\"Court 3\",\"price\":30000}");
        mvc.perform(as(v.merchant, delete("/v1/merchant/venue/resources/" + spare))).andExpect(status().isNoContent());
        mvc.perform(as(v.merchant, post("/v1/merchant/venue/resources")).content("{\"sport\":\"Tennis\",\"name\":\"X\",\"kind\":\"court\",\"capacity\":4,\"price\":1}")).andExpect(status().isBadRequest());
        mvc.perform(as(v.merchant, post("/v1/merchant/venue/resources")).content("{\"sport\":\"Tennis\",\"name\":\"X\",\"price\":1,\"peakFrom\":\"18:00\"}")).andExpect(status().isBadRequest());

        // A cashier doesn't run court bookings; a manager does.
        String email = "c-" + uniq() + "@test.local";
        mvc.perform(as(v.merchant, post("/v1/merchant/team")).content("{\"email\":\"" + email + "\",\"name\":\"C\",\"password\":\"" + PASSWORD + "\",\"staffRole\":\"cashier\"}")).andExpect(status().isCreated());
        mvc.perform(as(signInSettled(email, PASSWORD), get("/v1/merchant/venue/day"))).andExpect(status().isForbidden());
        String m = "m-" + uniq() + "@test.local";
        mvc.perform(as(v.merchant, post("/v1/merchant/team")).content("{\"email\":\"" + m + "\",\"name\":\"M\",\"password\":\"" + PASSWORD + "\",\"staffRole\":\"manager\"}")).andExpect(status().isCreated());
        mvc.perform(as(signInSettled(m, PASSWORD), get("/v1/merchant/venue/day"))).andExpect(status().isOk());
    }
}
