# VIBE Hyderabad — backend design

Status: **proposal for review.** Nothing here is built yet. The customer app already runs against a demo backend (`apps/customer/src/api/demo/`) that behaves the way this design says the real one must. The app talks only to the `VibeApi` interface, so the real backend replaces the demo without changes to the screens.

## 1. Principles (already true in the demo, must stay true)

1. **The server decides.** Prices, discounts, offer eligibility, seat availability, who can see whom: all computed and enforced on the server. The app only displays results.
2. **Money is integer paise.** No floats, ever. One currency (INR) for now.
3. **A payment is real only when the provider says so.** The app never marks anything paid. A signed provider webhook (or a server-side status fetch) moves a payment to `verified`; only then do tickets, reservations or memberships take effect.
4. **Every state-changing payment call is idempotent** (`Idempotency-Key`). Double taps and retries never create two payments or sell a seat twice.
5. **Holds expire.** Seats and tickets are held for a few minutes while someone pays; unpaid holds go back on sale. A hold with a payment in progress is never released early.
6. **Safety rules live on the server.** Two-way gender-preference matching, the contact-sharing guard, the 30-message chat limit, block and report: enforced in the API, never only hidden in the UI.
7. **Demo data is separate.** Seed data is a profile (`dev`, `staging`) and can never load in production.

## 2. Stack

| Concern | Choice | Why |
| --- | --- | --- |
| Language / runtime | Java (LTS, 21 or 25) | Already chosen for the project; Java 25 and Maven 3.9 are installed on the dev machine |
| Framework | Spring Boot (latest stable, version pinned at scaffolding) | Mature web, security, validation, scheduling |
| Architecture | **Modular monolith**, one deployable | A small team and one database; modules have clear boundaries so a module can be split out later if it ever needs to |
| Database | PostgreSQL | Transactions, row locks, partial unique indexes, `tstzrange` for holds, PostGIS later for distance |
| Migrations | Flyway | Versioned SQL, reviewed in PRs |
| Cache / rate limits | Redis (add when needed) | OTP and login throttling, hot catalogue reads |
| Files | S3-compatible object storage + CDN | Business photos, logos, category icons |
| Jobs | Spring scheduler first; a queue (SQS or similar) when volume needs it | Hold expiry, settlement runs, notifications |
| API contract | **OpenAPI 3 as the source of truth**, generated from the paths the app already calls | Keeps app and server in step |
| Build / CI | Maven, GitHub Actions, Testcontainers (real PostgreSQL in tests) | Same CI as the customer app |

## 3. Modules

```
identity      OTP sign-in, sessions, profile, account deletion
catalogue     categories (3 levels), businesses, menus, photos, logos, areas
offers        Pay & Redeem offers, rules, eligibility, redemptions, checkout offers/coupons
payments      payment requests, payments, provider adapter, webhooks, ledger, refunds
ticketing     events (ticket types, holds, tickets) and cinema (films, shows, seat maps, seat holds)
membership    plans, subscriptions, savings
social        activities, groups, one-on-one invites, matching, chat, venue reservations
moderation    reports, blocks, contact-guard flags, review queue
notifications push, SMS, email (provider adapters)
backoffice    merchant and admin APIs (separate security realm, see §9)
```

Each module owns its tables. Modules talk through Java interfaces, not each other's tables. `payments` publishes a `PaymentVerified` event; `ticketing`, `membership`, `offers` and `social` react to it exactly once (the demo's `settle()` is the model).

## 4. Data model (first cut)

All ids are UUIDs (or ULIDs). All timestamps are `timestamptz` in UTC; display in IST. Money columns are `bigint` paise.

**identity:** `users` (phone unique, name, area, status), `otp_requests` (hashed code, attempts left, expiry), `sessions` (refresh-token hash, device, last seen, revoked), `consents` (type, version, at), `deletion_requests`.

**catalogue:** `categories` (parent id, level 1 to 3, slug, `icon` or `icon_url`, sort order, active), `businesses` (name, primary category, area, lat/lng, logo url, status), `business_categories`, `business_photos`, `menu_items` (section, price), `opening_hours`.

**offers:** `offers` (business, rule JSON: percentage or flat, cap, minimum bill, member only, daily limit, validity), `redemptions` (user, offer, status, bill), `checkout_offers` (code, rule, member only, kinds, first-booking only, max uses), `offer_uses` (user, offer, payment).

**payments:** `payment_requests` (payee, kind, context id, `base`, `discount`, `vibe_fee`, `payable`, applied offer, expires at), `payments` (reference, provider id, method, status, amount, savings, verified at, unique `idempotency_key`), `provider_events` (raw webhook, signature ok, processed at: the audit trail), `ledger_entries` (double-entry: customer, VIBE fee, merchant payable, provider fee), `refunds`, `settlements` (merchant, period, gross, fees, net, status).

**ticketing:** `events`, `ticket_types` (remaining), `reservations` (held, paid, released, expires at), `tickets` (one per attendee, admission code, QR token, status); `movies`, `cinemas`, `screens`, `shows`, `show_seats` (**unique on `(show_id, seat_label)` while held or sold**), `seat_holds`.

**membership:** `plans`, `subscriptions` (status, valid until, auto-renew), `membership_payments`, `savings_events`.

**social:** `social_profiles` (gender, preference, age band, 18+ declared), `activities`, `activity_members`, `groups`, `one_on_ones` (host, kind, venue business, starts at, open to, status), `one_on_one_requests`, `matches`, `chat_messages` (kind: quick, text, system), `meet_reservations` (invite, kind, payment, reference, detail).

**moderation:** `reports`, `blocks`, `moderation_flags` (contact shared, reason, invite, user), `audit_log`.

## 5. Payments

- **Provider adapter.** One interface (`createOrder`, `verifySignature`, `fetchStatus`, `refund`) with one implementation per aggregator. The aggregator must support **marketplace / split settlement** and be RBI-authorised (candidates to evaluate: Razorpay Route, Cashfree Easy Split, PayU). VIBE never touches card details.
- **Flow.** `POST /payment-requests/{id}/payments` creates a `payments` row (`pending`) and a provider order, returns checkout details. The app opens the provider SDK. The provider calls `POST /webhooks/{provider}`; we verify the signature, store the raw event, and move the payment to `verified` or `failed` in one transaction. The app polls `GET /payments/{reference}` until it sees a final status.
- **Exactly-once side effects.** Webhooks arrive more than once. `provider_events` has a unique provider event id; the `PaymentVerified` handlers are idempotent.
- **Amount is locked** once a payment is pending (offers can no longer change; the demo already returns 409 `locked`).
- **Reconciliation job** compares our `payments` with the provider's settlement report every day and raises mismatches.
- **Refunds** go through the provider API and write ledger entries. Which refunds happen automatically, and when, is a business decision (see §12).

## 6. Concurrency and expiry

- **Seats:** `show_seats` has a partial unique index so two people can never hold or buy the same seat. Hold = insert with `expires_at`; a job (and every read) treats expired holds as free. Starting a payment sets `locked`, so the hold cannot expire mid-payment.
- **Event tickets:** `SELECT … FOR UPDATE` on the ticket-type row when reserving, so stock never goes negative.
- **Offer limits** (daily redemption, max uses, first booking): checked and recorded in the same transaction as the payment's verification, so two parallel payments cannot both use the last slot.
- **Idempotency:** a table of `(key, request hash, response)`. Same key and same body returns the stored response; same key and a different body is an error.

## 7. Identity and sessions

- Phone number + OTP through an SMS provider with DLT-registered templates (India). OTP codes are stored hashed; 3 wrong attempts lock the request; resend and per-phone and per-IP limits.
- Short-lived access token (JWT) + rotating refresh token stored hashed, per device; logout and "sign out everywhere" revoke sessions.
- Roles: `customer`, `merchant_staff`, `merchant_owner`, `admin`, `moderator`. Merchant and admin use separate login realms (see §9).
- Account deletion: soft-delete immediately, hard-delete personal data after the legal retention period; payment records are kept as the law requires.

## 8. Social safety

- **Matching** is enforced server-side in both directions (`canMeet`); invites that do not work both ways are never returned.
- **Contact guard** runs on every free-text chat message (phone numbers in digits, words, Indic digits, split across messages; emails; links; handles). A hit means: message not stored, chat closed, both blocked, flag created for review.
- **Chat** exists only after acceptance, 30 messages in total, quick replies built from allowed templates, closes after the meetup. System notes (match, reservation) do not count.
- **Venues** are VIBE businesses of a suitable category; free-typed addresses are rejected.
- **Venue reservations:** the host pays; the reservation is created only on `PaymentVerified`. Everyone sees "Reserved"; reference and seat or table details go only to the two people involved. Ticket QR codes and admission codes are never exposed through chat.
- **Moderation queue** for reports and flags with an audit trail of every action.
- **18+:** self-declared today; a KYC provider (to be chosen) gates speed-dating events and can later gate one-on-one.

## 9. Merchant and admin dashboards

Separate web apps (React) against `/v1/merchant/**` and `/v1/admin/**`, with their own roles and audit logging.

- **Merchant:** profile, photos and logo, menu, offers and their rules, **enter a customer's bill** (this is what `simulateMerchantBill` stands in for), redemptions, settlements and payouts, staff accounts, table and slot fees and policy for reservations, cinema showtimes (until a feed exists).
- **Admin:** categories and menus (unlimited depth through data, not releases), icons and logos, home banners and popular offers, checkout coupons, membership plans, social moderation queue, reports, KYC status, refunds, platform reports.

## 10. API conventions

- Base path `/v1`; JSON; errors are `{ "code": "...", "message": "..." }` with the HTTP statuses the app already handles: 400 validation, 401 not signed in, 403 not allowed, 404 not found, 409 conflict (`seat_taken`, `locked`, `not_eligible`, `limit_reached`…), 410 expired.
- Lists use `limit`/`offset` and return `{ items, total, nextOffset }`.
- The endpoints the app calls today are the starting contract (generated into OpenAPI from `createHttpApi`):

| Area | Endpoints |
| --- | --- |
| Auth, profile | `POST /auth/otp`, `POST /auth/otp/verify`, `POST /auth/logout`, `GET/PATCH /me`, `POST /me/deletion-request` |
| Catalogue | `GET /categories`, `GET /home`, `GET /businesses`, `GET /businesses/{id}` |
| Offers | `GET /offers`, `GET /offers/{id}`, `GET /offers/{id}/eligibility`, `POST /redemptions`, `GET /redemptions/{id}`, `POST /redemptions/{id}/cancel` |
| Checkout, payments | `GET /payment-requests/{id}`, `GET/POST/DELETE /payment-requests/{id}/offer(s)`, `POST /payment-requests/{id}/payments`, `GET /payments/{reference}` |
| Movies | `GET /movies`, `GET /movies/{id}`, `GET /movies/{id}/showtimes`, `GET /cinemas/{id}/showtimes`, `GET /shows/{id}/seats`, `POST /shows/{id}/holds` |
| Events, tickets | `GET /events`, `GET /events/{id}`, `POST /events/{id}/reservations`, `GET /me/tickets`, `GET /tickets/{id}` |
| Membership | `GET /membership`, `GET /membership/plans`, `POST /membership/subscriptions`, `POST /membership/plan-change`, `POST /membership/cancel` |
| Social | `GET /social/feed`, `POST /social/activities/{id}/join|leave`, `POST /social/groups/{id}/join`, `PUT /social/profile`, `/social/one-on-ones` (list, create, requests, respond, cancel, reservation, chat, chat messages) |
| Safety | `POST /reports`, `POST /blocks` |
| Provider | `POST /webhooks/{provider}` (not called by the app) |

## 11. Security, privacy and compliance

- **India's Digital Personal Data Protection Act, 2023:** purpose-limited consent (recorded in `consents`), data minimisation, access and deletion requests, breach process. Confirm the details and any later rules with counsel before launch.
- **Payments:** no card data on our servers; aggregator-hosted checkout; webhook signature checks; ledger and reconciliation for audit.
- **Data at rest and in transit:** TLS everywhere, encrypted database and backups, field-level encryption for any ID or KYC data.
- **Secrets** in a secrets manager, never in the repo; separate keys per environment.
- **Abuse:** rate limits on OTP, login, chat and holds; request size limits; structured audit log for admin actions.
- **Members' privacy:** other members see first name, age range and initials only; never phone, surname, exact age or photos.

## 12. Environments and operations

| Branch | Environment | Notes |
| --- | --- | --- |
| `feature/*`, `bugfix/*` | PR checks only | Build, unit and integration tests (Testcontainers) |
| `develop` | Development / staging | Seed data profile allowed; provider **test** keys |
| `main` | Production | No seed data; live keys from the secrets manager |

Containerised (Docker is installed locally), logs and metrics with alerts (payments failing, webhook lag, hold-expiry job, error rate), daily database backups with a tested restore.

## 13. Delivery plan

Each phase ends with tests green in CI, and the customer app switched to `http` mode for the finished areas.

| Phase | Scope | Done when |
| --- | --- | --- |
| **B0 Skeleton** | Maven project, module layout, Flyway, Testcontainers, OpenAPI, CI, health check, error format | `mvn verify` green in CI; app can reach `/v1/health` |
| **B1 Identity + catalogue** | OTP sign-in (provider stubbed), sessions, categories, businesses, home, search with paging | The app browses real data with demo mode off |
| **B2 Offers + payments** | Pay & Redeem, merchant-entered bills, checkout offers, payment adapter with the provider's **test** mode, webhooks, ledger | A redemption is paid and verified end to end in test mode |
| **B3 Ticketing** | Events and cinema: holds, tickets, QR, expiry jobs | No double-sold seat under parallel load tests |
| **B4 Membership** | Plans, subscriptions, member-only offers, savings | Member discounts and savings match the demo |
| **B5 Social** | Profiles, matching, one-on-ones, chat with contact guard, reservations, moderation queue | The demo's safety tests pass against the real API |
| **B6 Dashboards** | Merchant and admin apps | Merchants can enter bills and manage offers without a developer |

**Contract tests (important):** the demo's tests describe the rules. Turn the key ones into a suite that runs against both the demo adapter and the real backend. If both pass, the app cannot tell the difference.

## 14. Needed from the business

1. **Payment aggregator** and merchant onboarding model (marketplace / split settlement, payout schedule, who bears provider fees).
2. **SMS / OTP provider** with DLT registration, and **push** accounts (Firebase, Apple).
3. **Venue reservation policy:** who sets the table or slot fee (venue or VIBE), whether it is adjusted against the bill, and refund rules.
4. **Cinema data:** showtimes and seat inventory from each cinema or an aggregator (see `docs/movie-booking-integration.md`).
5. **KYC provider** for age and ID checks.
6. **Maps provider** (Google Maps or Mappls).
7. **Legal review:** terms, privacy policy, DPDP consent wording, community guidelines.
8. **Hosting choice** and budget (cloud region in India recommended).
9. **Official logo** and brand assets.

## 15. What the demo skips

The demo keeps state in memory, has no real users, no real time (a clock is injected), no network, no provider, no refunds and no moderation staff. All of that is new work in the real backend; the rules, the API contract and the tests are what carries over.
