package in.vibe.backend;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MvcResult;

import java.util.List;

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

/** Event tickets end to end: hold, pay, tickets with QR codes, the organiser's sales and alerts, the door, coupons, edits and cancelling. */
class TicketingTest extends ApiTestSupport {
    /** A merchant's published event: General ₹500 (40, up to 4 each) and VIP ₹900 (10). */
    class Show {
        final String biz = business(category(null, "Tix " + uniq()), "Tix place " + uniq());
        final String merchant = merchant(biz);
        final String event;
        final String general, vip;

        Show() throws Exception {
            event = id(mvc.perform(as(merchant, post("/v1/merchant/events")).content(ContentToolsTest.eventJson("Gig " + uniq(), 10))).andExpect(status().isCreated()).andReturn());
            mvc.perform(as(adminToken(), post("/v1/admin/events/" + event + "/approve"))).andExpect(status().isOk());
            String detail = mvc.perform(get("/v1/events/" + event)).andReturn().getResponse().getContentAsString();
            general = JsonPath.<List<String>>read(detail, "$.ticketTypes[?(@.name=='General')].id").getFirst();
            vip = JsonPath.<List<String>>read(detail, "$.ticketTypes[?(@.name=='VIP')].id").getFirst();
        }

        String items(String type, int qty) { return "[{\"ticketTypeId\":\"" + type + "\",\"quantity\":" + qty + "}]"; }

        String names(int n) {
            StringBuilder s = new StringBuilder("[");
            for (int i = 0; i < n; i++) s.append(i == 0 ? "" : ",").append("\"Guest ").append(i + 1).append('"');
            return s.append(']').toString();
        }

        MvcResult reserve(String customer, String type, int qty) throws Exception {
            return mvc.perform(as(customer, post("/v1/events/" + event + "/reservations")).content("{\"items\":" + items(type, qty) + ",\"attendees\":" + names(qty) + "}")).andReturn();
        }

        /** Holds, pays and lets the simulated partner confirm. Returns the payment reference. */
        String buy(String customer, String type, int qty) throws Exception {
            MvcResult r = reserve(customer, type, qty);
            assertEquals(201, r.getResponse().getStatus(), r.getResponse().getContentAsString());
            return pay(customer, JsonPath.read(r.getResponse().getContentAsString(), "$.paymentRequestId"));
        }

        String pay(String customer, String pr) throws Exception {
            String ref = JsonPath.read(mvc.perform(as(customer, post("/v1/payment-requests/" + pr + "/payments")).header("Idempotency-Key", "tix-" + uniq() + uniq()).content("{\"method\":\"upi\"}"))
                    .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.reference");
            mvc.perform(as(customer, get("/v1/payments/" + ref))).andExpect(jsonPath("$.status", is("verified")));
            return ref;
        }
    }

    @Test
    void aCustomerBuysTicketsGetsOneQrTicketPerPersonAndTheOrganiserSeesTheSale() throws Exception {
        Show s = new Show();
        String customer = customerToken(phone());
        MvcResult held = s.reserve(customer, s.general, 2);
        assertEquals(201, held.getResponse().getStatus());
        String body = held.getResponse().getContentAsString(), pr = JsonPath.read(body, "$.paymentRequestId");
        assertEquals(100000, ((Number) JsonPath.read(body, "$.total")).intValue());
        mvc.perform(get("/v1/events/" + s.event)).andExpect(jsonPath("$.ticketTypes[?(@.name=='General')].remaining", hasItem(38))); // held counts against what's left
        mvc.perform(as(customer, get("/v1/payment-requests/" + pr))).andExpect(jsonPath("$.kind", is("tickets"))).andExpect(jsonPath("$.payable", is(100000))).andExpect(jsonPath("$.payeeName", startsWith("Tix place")))
                .andExpect(jsonPath("$.lines[0].label", is("General × 2")));

        String ref = s.pay(customer, pr);
        mvc.perform(as(customer, get("/v1/payments/" + ref))).andExpect(jsonPath("$.kind", is("tickets"))).andExpect(jsonPath("$.ticketIds", hasSize(2)));
        mvc.perform(as(customer, get("/v1/me/tickets"))).andExpect(jsonPath("$", hasSize(2))).andExpect(jsonPath("$[0].status", is("valid"))).andExpect(jsonPath("$[0].typeName", is("General")))
                .andExpect(jsonPath("$[0].attendeeName", is("Guest 1"))).andExpect(jsonPath("$[0].index", is(1))).andExpect(jsonPath("$[0].of", is(2))).andExpect(jsonPath("$[0].qrToken", startsWith("vibe.t.")))
                .andExpect(jsonPath("$[0].bookingId", startsWith("VBT-"))).andExpect(jsonPath("$[0].paidTotal", is(100000)));
        String ticketId = JsonPath.read(mvc.perform(as(customer, get("/v1/me/tickets"))).andReturn().getResponse().getContentAsString(), "$[0].id");
        mvc.perform(as(customer, get("/v1/tickets/" + ticketId))).andExpect(status().isOk());
        mvc.perform(as(customerToken(phone()), get("/v1/tickets/" + ticketId))).andExpect(status().isNotFound()); // only the buyer sees it
        mvc.perform(as(customer, get("/v1/me/notifications"))).andExpect(jsonPath("$[?(@.kind=='tickets_issued')]", hasSize(1)));

        // The organiser: alerted, sold and left per type, the booking, and the money owed to them.
        mvc.perform(as(s.merchant, get("/v1/staff/notifications"))).andExpect(jsonPath("$.items[?(@.kind=='tickets_sold')].title", hasItem(containsString("2 tickets sold"))))
                .andExpect(jsonPath("$.items[?(@.kind=='tickets_sold')].body", hasItem(containsString("48 left of 50"))));
        mvc.perform(as(s.merchant, get("/v1/merchant/events/" + s.event + "/sales"))).andExpect(status().isOk()).andExpect(jsonPath("$.sold", is(2))).andExpect(jsonPath("$.left", is(48)))
                .andExpect(jsonPath("$.capacity", is(50))).andExpect(jsonPath("$.revenue", is(100000))).andExpect(jsonPath("$.types[?(@.name=='General')].sold", hasItem(2)))
                .andExpect(jsonPath("$.types[?(@.name=='General')].left", hasItem(38))).andExpect(jsonPath("$.bookings", hasSize(1))).andExpect(jsonPath("$.bookings[0].tickets", is(2)));
        mvc.perform(as(s.merchant, get("/v1/merchant/events"))).andExpect(jsonPath("$[?(@.id=='" + s.event + "')].sold", hasItem(2)));
        mvc.perform(as(adminToken(), get("/v1/admin/settlements/due"))).andExpect(jsonPath("$[?(@.businessId=='" + s.biz + "')].gross", hasItem(100000)));
        mvc.perform(as(adminToken(), get("/v1/admin/transactions").param("q", ref))).andExpect(jsonPath("$.items[0].kind", is("tickets")));

        // Another merchant can't see these sales.
        mvc.perform(as(new Show().merchant, get("/v1/merchant/events/" + s.event + "/sales"))).andExpect(status().isNotFound());
    }

    @Test
    void heldTicketsCountUntilTheHoldEndsAndTheLastTicketCantBeSoldTwice() throws Exception {
        Show s = new Show();
        String a = customerToken(phone()), b = customerToken(phone());
        // VIP has 10: A holds 4, then 4 more replaces A's first hold rather than adding to it.
        assertEquals(201, s.reserve(a, s.vip, 4).getResponse().getStatus());
        assertEquals(201, s.reserve(a, s.vip, 4).getResponse().getStatus());
        mvc.perform(get("/v1/events/" + s.event)).andExpect(jsonPath("$.ticketTypes[?(@.name=='VIP')].remaining", hasItem(6)));
        s.buy(b, s.vip, 4);
        MvcResult tooMany = s.reserve(customerToken(phone()), s.vip, 4);
        assertEquals(409, tooMany.getResponse().getStatus());
        assertEquals("Only 2 VIP left.", JsonPath.read(tooMany.getResponse().getContentAsString(), "$.message"));

        // A's hold runs out: those tickets are free again, and A's late payment is refused.
        String aPr = JsonPath.read(mvc.perform(as(a, post("/v1/events/" + s.event + "/reservations")).content("{\"items\":" + s.items(s.vip, 2) + ",\"attendees\":" + s.names(2) + "}")).andReturn()
                .getResponse().getContentAsString(), "$.paymentRequestId");
        jdbc.sql("update ticket_reservations set expires_at = now() - interval '1 minute' where payment_request_id = :p").param("p", java.util.UUID.fromString(aPr)).update();
        jdbc.sql("update payment_requests set expires_at = now() - interval '1 minute' where id = :p").param("p", java.util.UUID.fromString(aPr)).update();
        mvc.perform(get("/v1/events/" + s.event)).andExpect(jsonPath("$.ticketTypes[?(@.name=='VIP')].remaining", hasItem(6)));
        mvc.perform(as(a, post("/v1/payment-requests/" + aPr + "/payments")).header("Idempotency-Key", "late-" + uniq() + uniq()).content("{\"method\":\"upi\"}")).andExpect(status().isGone())
                .andExpect(jsonPath("$.message", containsString("released")));

        // Sold out shows in the list.
        s.buy(customerToken(phone()), s.vip, 4);
        s.buy(customerToken(phone()), s.vip, 2);
        mvc.perform(get("/v1/events/" + s.event)).andExpect(jsonPath("$.ticketTypes[?(@.name=='VIP')].remaining", hasItem(0)));
        assertEquals(409, s.reserve(customerToken(phone()), s.vip, 1).getResponse().getStatus());
    }

    @Test
    void ordersAreCheckedOnTheServer() throws Exception {
        Show s = new Show();
        String c = customerToken(phone());
        mvc.perform(as(c, post("/v1/events/" + s.event + "/reservations")).content("{\"items\":" + s.items(s.general, 2) + ",\"attendees\":[\"Only one\"]}")).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code", is("attendees")));
        mvc.perform(as(c, post("/v1/events/" + s.event + "/reservations")).content("{\"items\":" + s.items(s.general, 5) + ",\"attendees\":" + s.names(5) + "}")).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code", is("max_per_order")));
        mvc.perform(as(c, post("/v1/events/" + s.event + "/reservations")).content("{\"items\":" + s.items(java.util.UUID.randomUUID().toString(), 1) + ",\"attendees\":" + s.names(1) + "}")).andExpect(status().isBadRequest());
        mvc.perform(as(c, post("/v1/events/" + s.event + "/reservations")).content("{\"items\":" + s.items(s.general, 0) + ",\"attendees\":[]}")).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code", is("empty")));
        mvc.perform(post("/v1/events/" + s.event + "/reservations").contentType("application/json").content("{\"items\":[],\"attendees\":[]}")).andExpect(status().isUnauthorized());
    }

    @Test
    void atTheDoorATicketLetsOnePersonInOnce() throws Exception {
        Show s = new Show();
        String c = customerToken(phone());
        s.buy(c, s.general, 2);
        String tickets = mvc.perform(as(c, get("/v1/me/tickets"))).andReturn().getResponse().getContentAsString();
        String code = JsonPath.read(tickets, "$[0].admissionCode"), qr = JsonPath.read(tickets, "$[1].qrToken");

        mvc.perform(as(s.merchant, post("/v1/merchant/events/" + s.event + "/check-in")).content("{\"code\":\"" + code.toLowerCase().replace("-", "") + "\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.result", is("admitted"))).andExpect(jsonPath("$.attendeeName", is("Guest 1"))).andExpect(jsonPath("$.typeName", is("General")));
        mvc.perform(as(s.merchant, post("/v1/merchant/events/" + s.event + "/check-in")).content("{\"code\":\"" + code + "\"}")).andExpect(jsonPath("$.result", is("already")));
        mvc.perform(as(s.merchant, post("/v1/merchant/events/" + s.event + "/check-in")).content("{\"code\":\"" + qr + "\"}")).andExpect(jsonPath("$.result", is("admitted")));
        mvc.perform(as(s.merchant, post("/v1/merchant/events/" + s.event + "/check-in")).content("{\"code\":\"ZZZ-ZZZ\"}")).andExpect(status().isNotFound()).andExpect(jsonPath("$.code", is("no_ticket")));
        mvc.perform(as(c, get("/v1/me/tickets"))).andExpect(jsonPath("$[0].status", is("checked_in")));
        mvc.perform(as(s.merchant, get("/v1/merchant/events/" + s.event + "/sales"))).andExpect(jsonPath("$.checkedIn", is(2)));

        // A ticket for another event is caught, and another merchant can't use this door.
        Show other = new Show();
        mvc.perform(as(other.merchant, post("/v1/merchant/events/" + other.event + "/check-in")).content("{\"code\":\"" + code + "\"}")).andExpect(jsonPath("$.result", is("wrong_event")));
        mvc.perform(as(other.merchant, post("/v1/merchant/events/" + s.event + "/check-in")).content("{\"code\":\"" + code + "\"}")).andExpect(status().isNotFound());
    }

    @Test
    void aVibeCouponLowersWhatTheCustomerPaysButTheOrganiserIsSettledTheFullPrice() throws Exception {
        Show s = new Show();
        String code = "TIX" + uniq().toUpperCase().replaceAll("[^A-Z0-9]", "7").substring(0, 6);
        mvc.perform(as(adminToken(), post("/v1/admin/coupons")).content("""
            {"code":"%s","title":"20%% off tickets","kinds":["tickets"],"kind":"percentage","rateBps":2000,"maxDiscount":30000,"startsAt":"2026-01-01T00:00:00Z","endsAt":"2031-01-01T00:00:00Z"}""".formatted(code)))
                .andExpect(status().isCreated());
        String c = customerToken(phone());
        String pr = JsonPath.read(s.reserve(c, s.general, 2).getResponse().getContentAsString(), "$.paymentRequestId");
        mvc.perform(as(c, get("/v1/payment-requests/" + pr + "/offers"))).andExpect(jsonPath("$.applied").doesNotExist())
                .andExpect(jsonPath("$.available[?(@.code=='" + code + "')].saving", hasItem(20000))).andExpect(jsonPath("$.available[?(@.code=='" + code + "')].eligible", hasItem(true)));
        mvc.perform(as(c, post("/v1/payment-requests/" + pr + "/offer")).content("{\"code\":\"NOPE123\"}")).andExpect(status().isConflict());
        mvc.perform(as(c, post("/v1/payment-requests/" + pr + "/offer")).content("{\"code\":\"" + code.toLowerCase() + "\"}")).andExpect(status().isOk())
                .andExpect(jsonPath("$.discount", is(20000))).andExpect(jsonPath("$.payable", is(80000))).andExpect(jsonPath("$.appliedOffer.code", is(code)));
        mvc.perform(as(c, delete("/v1/payment-requests/" + pr + "/offer"))).andExpect(jsonPath("$.payable", is(100000))).andExpect(jsonPath("$.appliedOffer").doesNotExist());
        mvc.perform(as(c, post("/v1/payment-requests/" + pr + "/offer")).content("{\"code\":\"" + code + "\"}")).andExpect(jsonPath("$.payable", is(80000)));

        String ref = s.pay(c, pr);
        mvc.perform(as(c, get("/v1/payments/" + ref))).andExpect(jsonPath("$.amount", is(80000))).andExpect(jsonPath("$.savings", is(20000))).andExpect(jsonPath("$.offerTitle", is("20% off tickets")));
        mvc.perform(as(c, delete("/v1/payment-requests/" + pr + "/offer"))).andExpect(status().isConflict()); // too late once paid
        // The customer paid ₹800; the organiser is owed the full ₹1,000.
        mvc.perform(as(adminToken(), get("/v1/admin/settlements/due"))).andExpect(jsonPath("$[?(@.businessId=='" + s.biz + "')].gross", hasItem(100000)));

        // Bills don't take checkout coupons.
        mvc.perform(as(c, get("/v1/payment-requests/" + pr + "/offers"))).andExpect(status().isOk());
    }

    @Test
    void editsCantTakeAwaySoldTicketsAndOnlyVibeCancelsAnEventWithSales() throws Exception {
        Show s = new Show();
        String c = customerToken(phone());
        s.buy(c, s.vip, 3);
        String base = """
            {"title":"Gig edited","kind":"Workshops","description":"Hands-on","venue":"Test venue","area":"Jubilee Hills","startsAt":"%s","ticketTypes":%s}""";
        String when = ContentToolsTest.in(10);
        // VIP can't go below the 3 sold, and can't be removed.
        mvc.perform(as(s.merchant, put("/v1/merchant/events/" + s.event)).content(base.formatted(when, "[{\"id\":\"" + s.general + "\",\"name\":\"General\",\"price\":50000,\"capacity\":40},{\"id\":\"" + s.vip + "\",\"name\":\"VIP\",\"price\":90000,\"capacity\":2}]")))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("capacity_below_sold")));
        mvc.perform(as(s.merchant, put("/v1/merchant/events/" + s.event)).content(base.formatted(when, "[{\"id\":\"" + s.general + "\",\"name\":\"General\",\"price\":50000,\"capacity\":40}]")))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("type_has_sales")));
        // Renaming and resizing keeps the same type, so the sold tickets stay valid.
        mvc.perform(as(s.merchant, put("/v1/merchant/events/" + s.event)).content(base.formatted(when, "[{\"id\":\"" + s.general + "\",\"name\":\"General\",\"price\":50000,\"capacity\":40},{\"id\":\"" + s.vip + "\",\"name\":\"VIP lounge\",\"price\":95000,\"capacity\":12}]")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.ticketTypes[?(@.name=='VIP lounge')].sold", hasItem(3)));
        mvc.perform(as(c, get("/v1/me/tickets"))).andExpect(jsonPath("$[0].typeName", is("VIP lounge"))).andExpect(jsonPath("$[0].status", is("valid")));

        mvc.perform(as(s.merchant, post("/v1/merchant/events/" + s.event + "/cancel"))).andExpect(status().isConflict()).andExpect(jsonPath("$.code", is("has_sales")));
        mvc.perform(as(adminToken(), post("/v1/admin/events/" + s.event + "/cancel"))).andExpect(status().isOk());
        mvc.perform(as(c, get("/v1/me/tickets"))).andExpect(jsonPath("$[0].status", is("cancelled")));
        mvc.perform(as(c, get("/v1/me/notifications"))).andExpect(jsonPath("$[?(@.kind=='event_cancelled')]", hasSize(1)));
        // Every paid order for the cancelled event is on the refunds list, so nobody is missed.
        mvc.perform(as(adminToken(), get("/v1/admin/refunds").param("status", "due"))).andExpect(jsonPath("$.items[?(@.reason =~ /Event cancelled.*/)]").isNotEmpty());
    }

    @Test
    void aCashierCantSeeEventSales() throws Exception {
        Show s = new Show();
        String email = "door-" + uniq() + "@test.local";
        mvc.perform(as(s.merchant, post("/v1/merchant/team")).content("{\"email\":\"" + email + "\",\"name\":\"Door\",\"password\":\"" + PASSWORD + "\",\"staffRole\":\"cashier\"}")).andExpect(status().isCreated());
        String cashier = signInSettled(email, PASSWORD);
        mvc.perform(as(cashier, get("/v1/merchant/events/" + s.event + "/sales"))).andExpect(status().isForbidden());
    }
}
