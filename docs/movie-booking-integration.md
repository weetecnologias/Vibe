# Movie booking: how it works and what to integrate

Status: the customer app has the full flow running on **demo data** (fictional films, six cinemas' worth of
shows, seat maps, seat holds, payment, tickets). Nothing here is connected to a real cinema yet.

## The customer flow

```
Home → Movies → film → day + language → cinema + showtime → seats → pay → ticket (QR + seat)
         │         │                          │                │
 Now showing   Which cinemas play it   Plenty / filling fast   Seats held 8 min,
 Coming soon   (nearest first)         / almost full / sold    unpaid holds released
 Cinemas tab
```

A cinema can also be opened directly (Cinemas tab, or a cinema's business page → **Book tickets**) to see
everything it runs that day.

## What the backend must provide

The app only talks to these endpoints (defined in `apps/customer/src/api/client.ts`):

| Request | Purpose |
| --- | --- |
| `GET /movies?status=&language=` | Films now showing and coming soon |
| `GET /movies/{id}` | Synopsis, cast, certificate, formats, languages |
| `GET /movies/{id}/showtimes?date=YYYY-MM-DD` | Cinemas playing the film that day, nearest first, with shows |
| `GET /cinemas/{businessId}/showtimes?date=` | Films a cinema runs that day |
| `GET /shows/{id}/seats` | Seat map: rows, classes and prices, aisle gaps, available / unavailable |
| `POST /shows/{id}/holds` `{seatIds}` | Hold seats (max 6) for a few minutes; returns a payment request |
| then the existing payment endpoints | `POST /payment-requests/{id}/payments`, `GET /payments/{ref}` |

Rules the backend enforces (the demo backend already does, with tests):

- A seat can be held or sold to **one** customer. Concurrent requests must be serialised per show (database row
  lock or a single-writer queue per show).
- Holds expire after `holdMinutes` and the seats go back on sale. A hold with a payment in progress is **never**
  released early, so a late payment confirmation can't oversell.
- Seats become sold only when the payment provider's **signed webhook** confirms payment, exactly once
  (idempotent). One ticket is issued per seat, each with a unique admission code and QR token.
- Online booking closes shortly before showtime (10 minutes in the demo; set per cinema).
- Prices, fees and taxes are returned by the server. The app never computes them.

## Where showtimes and seat inventory come from

This is the real integration question. There are three ways, and a mix is likely:

1. **Cinema uses the VIBE merchant dashboard** (best for single-screen and independent cinemas). Staff publish
   shows, set the seat layout once per screen and prices per class. VIBE is the source of truth for the seats it
   sells. Needs no third-party API.
2. **Direct integration with a cinema or chain's own ticketing system.** Larger cinemas run on cinema-management
   software that holds the real seat inventory. These vendors and chains generally expose partner APIs only under a
   commercial agreement. Seat holds and bookings must go through **their** system so one seat is never sold twice.
3. **An aggregator / reseller** that already has agreements with many cinemas and offers one API. This shortens
   integration but adds their fee and their terms.

In the backend this is one interface, `CinemaProvider`, with an adapter per source:

```
CinemaProvider
  listShows(cinemaId, date)        → shows with prices and availability
  getSeatMap(showId)               → layout and seat status
  holdSeats(showId, seats, ttl)    → hold id + expiry, or "seat taken"
  confirm(holdId, paymentRef)      → booking id / ticket references
  release(holdId)
```

The demo backend (`apps/customer/src/api/demo/cinema.ts`) is the first adapter. Real adapters replace it without
any change to the app.

**Important:** if the same cinema also sells through other apps, VIBE's view of the seats must come from the
cinema's system in real time, or the cinema must give VIBE an exclusive quota of seats. Otherwise the same seat
can be sold twice.

## Film information (posters, cast, certificates)

- Showtimes come from cinemas; **film details** can come from a film-data provider or be entered by VIBE admins.
  A commercial film-data API can supply posters, cast, trailers and release dates, but its licence terms for a
  commercial app must be checked before use. Until then the app shows a branded placeholder poster.
- Show the **CBFC certificate** (U, UA, A). For A-rated films, the cinema enforces age at the door; consider an
  age notice at checkout.

## Business and legal items to settle (not technical)

- Written agreements with each cinema or chain, or with an aggregator: commission or convenience fee,
  settlement timing, and who handles refunds.
- **Cancellation and refunds:** many cinemas treat tickets as non-refundable after purchase; the app must state
  the policy clearly before payment. Cancelled or failed shows need an automatic refund path.
- **Payments:** the same payment provider with split settlement used for the rest of VIBE; entertainment tax and
  GST handling and the invoice that the cinema issues are separate from VIBE's receipt. Get this reviewed by an
  accountant.
- **Fees:** any VIBE convenience fee must be shown before payment.
- **Terms and brand:** use of cinema names, logos and film posters needs permission.

## Not decided or verified yet

- Which cinemas or chains to approach first, and what their current partner terms and API availability are. I
  have not verified any of this; each has to be asked directly.
- Which payment provider and which film-data provider.
- Real seat-map import: each cinema's screens differ (recliners, couples' seats, wheelchair spaces). The seat map
  format supports aisle gaps and classes; special seat types still need design.
