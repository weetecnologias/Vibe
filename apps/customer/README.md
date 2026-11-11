# VIBE Hyderabad — Customer app

React Native + TypeScript app built with Expo SDK 58 and Expo Router. Runs on Android, iOS and web from one codebase.

## Run it

```bash
cd apps/customer
npm install
npm run web:dev        # browser at http://localhost:8081
npx expo start         # then press a (Android) / i (iOS) or scan with Expo Go
```

Checks (run before committing):

```bash
npm run typecheck
npm run lint
npm test
```

## Demo mode vs. real backend

The app talks only to the `VibeApi` interface in `src/api/client.ts`. Two adapters exist:

| Mode | When | What it does |
| --- | --- | --- |
| `demo` | Default in development builds | In-memory stand-in for the backend (`src/api/demo/`). Fictional data, no network, no real money. A **DEMO DATA · NO REAL PAYMENTS** strip is always shown. State resets when the app reloads. |
| `http` | Default in release builds, or `EXPO_PUBLIC_API_MODE=http` | Calls the Spring Boot API at `EXPO_PUBLIC_API_URL` under `/v1`. The paths in `createHttpApi` are the API contract the backend must implement. |

Copy `.env.example` to `.env` to switch modes. Release builds never fall back to demo data silently.

### Demo walkthrough

1. Onboarding → **Get started** → enter any valid Indian mobile (e.g. `98765 43210`), tick the consent box → **Send OTP**.
2. OTP is **123456** in demo mode (no SMS is sent).
3. Pick an area → Home.
4. **Pay & Redeem:** open *Saffron Courtyard → 30% off* → **Redeem offer** → tap **Demo: merchant sends ₹1,000 bill** (stands in for the merchant dashboard) → **Pay ₹700.00** → the receipt shows *Pending* and then *Verified*.
5. **Tickets:** Events → *Sunset Rooftop Jazz* → add VIP tickets → attendee names → **Reserve and pay** → pay → **View tickets** (QR + admission code).
6. **One-on-one (18+):** Social → **One-on-one** → set *I am*, *I'd like to meet* (women / men / anyone) and age range. You only see invites that work both ways. **Ask to join** an invite, then tap **Demo: … accepts**. Or **Post a one-on-one** (activity, a VIBE-recommended place, time, *who can join*) and tap **Demo: someone asks** to receive a request you can accept or decline.
7. **Match chat:** once a plan is accepted, tap **Open chat**. It's for meeting details only: quick replies for dress colour, table or seat number, where you are and status, plus a short typed note (80 characters). The whole chat allows **30 messages** between both people. Typing a phone number (including spaced, spelled-out, Indic digits or split across messages), email, link or social handle means the message isn't sent, the chat closes, you're blocked from each other and it's flagged for moderators. Try it with `98765 43210`.

8. **Social filters:** at the top of Social, **Near me** (within 3 km of your area) combines with **Any time / Within an hour / Today / This week** (the next 7 days, India time). They apply to activities, social events and open one-on-one invites; your own plans always stay visible. Demo data always has something starting within the hour and later today.

One-on-one meetups can only be at VIBE-listed businesses that suit the activity (cafés for coffee, restaurants for meals, sports venues for games). The backend rejects any other place.

### Icons, logos, menus and long lists

- **App icon, splash and favicon:** generated from the Sora ExtraBold wordmark (pink VIBE on near-black) in `assets/images/`. To replace them with the official logo, swap `icon.png` (1024×1024), the three `android-icon-*.png` layers, `splash-icon.png` and `favicon.png`, then rebuild the app. They can't be changed from a dashboard.
- **Category icons:** a category carries either `icon` (one of the built-in icon names) or `iconUrl` (an uploaded SVG/PNG). Unknown or broken icons fall back to a default, so a new category never shows blank.
- **Business logos:** `logoUrl` on a business (and `businessLogoUrl` on an offer). Without one, or if it fails to load, the business initials are shown.
- **Menus:** menu items can carry a `section`. The Menu tab groups them by section and adds a search box for menus over 8 items; the Overview tab shows the first 4.
- **Long lists:** Discover and category listings load 12 at a time with **Show more**. The API contract is `GET /businesses?limit=&offset=` returning `{ items, total, nextOffset }`.

### Movie booking (demo)

Home → **Movies** → a film → pick a day → see which cinemas play it with showtimes → pick seats → pay → ticket with seat and QR. Cinemas can also be opened directly (Movies → Cinemas, or a cinema page → **Book tickets**).

- Seats are held for 8 minutes while you pay; two people can never hold the same seat; a hold with a payment in progress is never released early; seats sell only when the payment is verified.
- Up to 6 seats per booking; booking closes 10 minutes before the show.
- Films, shows and seat maps are fictional demo data (`src/api/demo/cinema.ts`). Real showtimes and seat inventory must come from the cinemas: see `docs/movie-booking-integration.md` for the options, the API contract and the business items to settle.

### Reserve the venue for a one-on-one (demo)

When a host posts a one-on-one, a **Reserve your spot** sheet appears straight away (and **Reserve …** stays on their plan until it's done). The host pays to lock the venue, so the plan is more likely to happen.

- **Coffee and meals:** a table for two. **Sports:** a court slot. **Movie date** (new activity, at VIBE cinemas): two seats together, picked in the normal seat map.
- The plan then shows a **Reserved** badge to everyone. The booking reference and seat or table details go only to the two people involved, and appear in the chat as a card and a note from VIBE (these notes never use up the 30 messages). Ticket QR codes and admission codes are never shared in chat.
- A reservation counts only after the payment is verified. Only the host can reserve, up to 30 minutes before the start. Movie seats must be at the plan's cinema, on the plan's day; the plan moves to the show's start time.
- Cancelling a reserved plan asks first and repeats the venue's cancellation policy.
- API: `POST /social/one-on-ones/{id}/reservation` → `{ paymentRequestId }` (table and slot); movie plans use `POST /shows/{id}/holds` with `meetId`.
- Fees and the policy text in `src/api/demo/meetReservations.ts` are **demo data and a business decision still to be made**: who sets the fee (venue or VIBE), whether it is adjusted against the bill, and when it is refunded. No refund is issued yet: it needs the payment partner.

### Offers at checkout (demo)

On the payment screen for movie and event tickets, **Offers & coupons** lists VIBE-member offers (MEMBER badge) and public offers, or lets you type a code. Try `MEMBERFLIX`, `WELCOME50` or `GROUP100`.

- One offer per order. Applying another replaces it; **Remove** restores the original price. Offers never stack.
- The backend decides eligibility (membership, first booking, minimum bill, use limits) and reprices the bill. The app only shows what it returns, and offers that don't apply say why.
- The offer is locked once payment starts. Savings appear on the receipt, and member offers add to your membership savings only after the payment is verified.
- API: `GET /payment-requests/{id}/offers`, `POST /payment-requests/{id}/offer {code}`, `DELETE /payment-requests/{id}/offer`. Offer rules in `src/api/demo/checkoutOffers.ts` are demo data; real ones come from the admin and merchant dashboards.
- Not applied to Pay & Redeem bills (those already carry the merchant's offer) or membership payments.

### Demo catalogue and photos

- Every subcategory in Food, Shopping, Fitness, Beauty and Kids has at least one fictional business; Events and Social have something in every section. `catalog-test.ts` fails if a subcategory is ever left empty.
- Placeholder photos load from Wikimedia Commons under free licences (credits in `src/api/demo/IMAGE_CREDITS.md`). Members in one-on-one are shown by initial only, never with photos of real people. Replace all of this with merchant photography before launch.

## What is real and what is not

Implemented and tested (27 unit tests):
- Money is integer paise everywhere; Indian number formatting.
- Discounts are priced by the backend (demo: `src/api/demo/pricing.ts`). The app never computes a discount itself.
- Payment success appears only when the backend reports `verified`. Every payment attempt carries an idempotency key, and status is polled from the server.
- Ticket inventory is held for 10 minutes, unpaid holds are released, and overselling is rejected. One named ticket per attendee, with unique admission codes and real QR codes.
- One redemption per offer per day; member-only offers require an active membership.
- OTP lockout after 3 wrong attempts; tokens are stored in Keychain/Keystore (`expo-secure-store`).
- Social: join/request, host approval, report and block, age-restricted events.

**Not connected yet (each needs an external provider, a paid API or legal approval):**

| Feature | Needs |
| --- | --- |
| Online payments | RBI-regulated payment aggregator with marketplace/split settlement. `PayPanel` shows a clear error if the backend returns a `provider` checkout. |
| SMS OTP | SMS/OTP provider (DLT-registered templates in India) |
| Push notifications | Firebase Cloud Messaging + Apple Push Notification service |
| Maps | Google Maps or Mappls API key (Discover shows a placeholder) |
| Age/ID verification | KYC provider (speed-dating events can't be booked until then) |
| Business photos | Object storage + CDN; merchants upload via the merchant dashboard |
| Bookings, saved places, receipts history, privacy controls | Later phases. The Profile entries say "coming in the next release". |

## Project layout

```
src/
  app/            Expo Router screens (every file is a route)
    (tabs)/       Home, Discover, Social, Membership, Profile
  api/            Domain types, VibeApi interface, HTTP adapter, demo adapter
  components/     UI kit (ui/), cards, pay panel, report sheet, ticket QR
  lib/            money, dates, validation, storage, data hooks
  state/          Session (OTP sign-in, guest mode, area)
  theme/tokens.ts Brand tokens, mirrored from design/ui-canvas
```
