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
6. **One-on-one (18+):** Social → **One-on-one** → set *I am*, *I'd like to meet* (women / men / anyone) and age range. You only see invites that work both ways. **Ask to join** an invite, then tap **Demo: … accepts**. Or **Post a one-on-one** (activity, public venue, time, *who can join*) and tap **Demo: someone asks** to receive a request you can accept or decline.

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
