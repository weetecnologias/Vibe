# VIBE Hyderabad — backend

Spring Boot (Java 25, Maven) modular monolith on PostgreSQL. See [docs/backend-design.md](../docs/backend-design.md) for the full plan.

## What exists today (the catalogue, content tools, Pay & Redeem, membership, alerts, onboarding and admin oversight)

| Area | Endpoints | Who |
| --- | --- | --- |
| Health | `GET /v1/health` | anyone |
| Catalogue (what the customer app reads) | `GET /v1/categories`, `GET /v1/businesses` (`q`, `categoryId`, `sort`, `limit`, `offset`), `GET /v1/businesses/{id}` | anyone |
| Home, plans, events, offers (what the customer app reads) | `GET /v1/home`, `GET /v1/membership/plans`, `GET /v1/events`, `GET /v1/events/{id}`, `GET /v1/offers?view=` | anyone |
| Images | `POST /v1/media` (PNG, JPEG or WebP, up to 5 MB), served at `GET /media/{file}` | upload: admin, merchant. Serving: anyone |
| Customer sign-in | `POST /v1/auth/otp`, `POST /v1/auth/otp/verify`, `POST /v1/auth/refresh`, `POST /v1/auth/logout`, `GET/PATCH /v1/me`, `POST /v1/me/deletion-request` | phone + one-time code |
| Notifications | `GET /v1/me/notifications`, `POST /v1/me/notifications/read`, `PUT /v1/me/devices` | customer |
| **Pay & Redeem (customer)** | `GET /v1/offers/{id}` (public), `GET /v1/offers/{id}/eligibility`, `POST /v1/redemptions`, `GET /v1/redemptions/{id}`, `POST /v1/redemptions/{id}/cancel`, `GET /v1/payment-requests/{id}`, `POST /v1/payment-requests/{id}/payments` (needs `Idempotency-Key`), `GET /v1/payments/{reference}` | customer |
| **Pay & Redeem (merchant)** | `GET /v1/merchant/bills` (`view=open\|today`, `q`), `POST /v1/merchant/bills/{id}/preview`, `POST /v1/merchant/bills/{id}` (raise the bill), `POST /v1/merchant/bills/{id}/withdraw` | `MERCHANT`, own business only |
| **Slot booking (sports and fitness)** | Public: `GET /v1/businesses/{id}/sports`, `GET /v1/businesses/{id}/slots?sport=&date=&minutes=`. Customer: `POST /v1/slot-bookings`, `GET /v1/slot-bookings/{id}`, `POST /v1/slot-bookings/{id}/release`, `GET /v1/me/slot-bookings`. Merchant: `/v1/merchant/venue/resources` (CRUD), `GET /v1/merchant/venue/day`, `POST`/`DELETE /v1/merchant/venue/blocks`, `POST /v1/merchant/venue/check-in` (entry codes and membership pass codes) | public / customer / merchant (Bookings area) |
| **Venue memberships (gyms, yoga, trainers)** | Public: `GET /v1/businesses/{id}/plans`. Customer: `POST /v1/venue-passes` (`planId`, `startsOn`), `GET /v1/venue-passes/{id}`, `GET /v1/me/venue-passes`. Merchant: `/v1/merchant/venue/plans` (CRUD), `GET /v1/merchant/venue/members` | public / customer / merchant (Bookings area) |
| **Discover: offers near you and promotions** | Public: `GET /v1/offers/nearby?category=&q=&sort=nearest|saving|ending&openNow=&maxDistanceKm=&memberOnly=&offset=&limit=`, `GET /v1/promotions?category=`, `POST /v1/promotions/{id}/tap`. Merchant: `/v1/merchant/promotions` (CRUD). Admin: `GET /v1/admin/promotions?status=`, `POST /v1/admin/promotions/{id}/approve`, `POST /v1/admin/promotions/{id}/reject` | public / merchant (Offers area) / admin |
| **Redeem codes and ratings** | `POST /v1/redemptions` takes `mode` (`code` or `bill`); `POST /v1/redemptions/{id}/review`; merchant: `POST /v1/merchant/bills/codes/check`, `POST /v1/merchant/bills/{id}/redeem`, `GET /v1/merchant/reviews`, `GET`/`PUT /v1/merchant/business/payment-setting`; admin: `GET /v1/admin/reviews`, `POST /v1/admin/reviews/{id}/hide` / `unhide` | customer / merchant / admin |
| **Event tickets (customer)** | `POST /v1/events/{id}/reservations` (hold tickets, returns the bill), `GET /v1/me/tickets`, `GET /v1/tickets/{id}`; coupons on the order: `GET /v1/payment-requests/{id}/offers`, `POST`/`DELETE /v1/payment-requests/{id}/offer` | customer |
| **Ticket sales and the door** | `GET /v1/merchant/events/{id}/sales`, `POST /v1/merchant/events/{id}/check-in` (and the same under `/v1/admin` for VIBE's own events) | organiser |
| **Membership (customer)** | `GET /v1/membership`, `POST /v1/membership/subscriptions` (returns a bill, paid through the normal payment flow), `POST /v1/membership/plan-change`, `POST /v1/membership/cancel` | customer |
| **Business applications (public)** | `POST /v1/business-applications`, `GET`/`PUT /v1/business-applications/{id}?token=` (check status, resubmit when changes are requested) | anyone with the private token |
| **Staff alerts** | `GET /v1/staff/notifications`, `POST /v1/staff/notifications/read`, `POST /v1/staff/password`, `GET /v1/merchant/settings` (does this kind of business use bills, and what is its item list called) | admin, merchant |
| **Settlements and downloads (admin)** | `GET /v1/admin/settlements/due`, `GET`/`POST /v1/admin/settlements`, `GET /v1/admin/settlements/{id}`, `POST /v1/admin/settlements/{id}/paid` (needs the bank reference), `GET`/`PUT /v1/admin/businesses/{id}/terms` (commission and auto-approval, with a reason); spreadsheets at `GET /v1/admin/exports/{transactions,members,customers,settlements,settlements-due}` and `/v1/admin/exports/settlements/{id}` | `ADMIN` |
| **Team roles (merchant owner)** | `GET /v1/merchant/team`, `POST /v1/merchant/team` (with `staffRole` and, for custom, `permissions`), `PUT /v1/merchant/team/{id}/access`; `GET /v1/merchant/settings` also says what the signed-in person may do | owner |
| **Settlements and results (merchant)** | `GET /v1/merchant/settlements`, `GET /v1/merchant/settlements/{id}` (+ `/export`), `GET /v1/merchant/results?days=` | `MERCHANT`, own business only |
| Payment partner webhook | `POST /v1/webhooks/{provider}` (signed with `X-Vibe-Signature`) | the payment partner |
| Staff sign-in | `POST /v1/staff/login`, `GET /v1/staff/me` | admin, merchant |
| **Admin oversight** | `GET /v1/admin/overview`, `/customers` (+ detail, reveal phone with an audit entry, grant membership), `/transactions` (+ detail), `/members`, `/deletion-requests`, `/applications` (approve, ask for changes, reject) | `ADMIN` |
| Admin | categories, businesses, merchant logins, audit log; **offer review** (approve or reject with a note); **events** (create, edit, publish, reject, cancel); **home banners and pinned sections**; **membership plans**; **checkout coupons** | `ADMIN` |
| Merchant | own business profile, menu, offers, **events with ticket types**, **reservation fees and policy**, **team logins** (owner only) | `MERCHANT`, own business only |

Responses match the customer app's `CategoryNode`, `BusinessSummary`, `BusinessDetail` and `OfferSummary` types.

**Not built yet** (later phases in `docs/platform-workflows.md`): ticket sales and holds, movies and seat maps, the hosting programme and the rest of social, reservations with split payment, home collections, settlements and refunds, automatic membership renewal (needs the payment partner's recurring payments), and the real SMS, push and payment providers (see below). Checkout coupons and reservation fees are stored and managed, but nothing applies them until payments and social exist. Image upload stores files on local disk in development; production needs object storage behind a CDN. Ratings, reviews and branches are empty or zero until their modules exist. The customer app can't switch to `http` mode yet because it needs those endpoints too.

## Rules the server enforces

- Staff passwords are hashed (BCrypt). A wrong email and a wrong password look the same, and 5 wrong tries lock the account for 15 minutes.
- Tokens are signed, expire after 8 hours, and carry the role and (for merchants) the business. **A merchant's business always comes from the token, never from the request**, so a merchant cannot read or change another business.
- Everything not listed above is closed by default.
- Categories go 3 levels deep, never inside themselves, and one that is in use can only be switched off, not deleted.
- Offers must be complete (a percentage needs a rate, a flat offer an amount), end after they start, and a flat discount can't exceed the minimum bill. Money is integer paise.
- **Offers and events are reviewed.** A merchant's offer or event is hidden from customers until VIBE approves it, and an edit that changes what it is sends it back for review. Events VIBE creates publish straight away. Rejecting needs a note the merchant can read.
- **Home content:** only live items (approved, switched on, published) can be pinned, up to 12 per section; with nothing pinned the app falls back to automatic picks.
- **Team:** the first login for a business is its owner and can do everything. Only the owner can add staff, choose their role, reset their passwords or switch them off. Roles: **cashier / waiter** (bills only, and reading the menu to bill from it), **manager** (everything except the team), or **custom** (the areas the owner ticks). The server enforces this on every `/v1/merchant` request, reading the role from the database, so a change applies at once; someone switched off is signed out on their next click. Each person only sees the alerts for what they do.
- **Images:** only real PNG, JPEG or WebP files (checked by their first bytes, not the file name), up to 5 MB, 100 uploads per person per day. Files get a random name and are served with the detected type and `nosniff`. SVG is refused because it can carry scripts.
- **Customer sign-in:** the code is 6 digits, stored only as a keyed hash, expires in 5 minutes and allows 3 tries (the try is counted even when the error is thrown); 5 codes per number per hour, 30 seconds between codes. Refresh tokens work once, and a replayed one signs the customer out everywhere. **Without an SMS provider only the `dev` profile can sign anyone in** (code 123456); other profiles refuse with `sms_not_configured` instead of pretending a text was sent.
- **Staff never see a customer's phone or surname:** only a first name, an initial and a 6-digit VIBE ID.
- **Bills:** a merchant can only bill a customer who tapped Redeem at *their* place, once per request, and an expired request can't be billed. The discount is worked out by the server from the offer's rule (never typed), rounded down to the paisa, with the cap and minimum applied. Bills of ₹50,000 or more need the amount confirmed. A wrong bill can be withdrawn until the customer starts paying; after that it can't.
- **Redeeming:** member-only offers need an active membership; one paid redemption per offer per day (India time); tapping Redeem again while one is open returns the same one.
- **Payments:** every payment needs an `Idempotency-Key` (the same key returns the same payment; reusing it for another bill is refused). The database allows only one live payment per bill and only one open redemption per customer per offer, so a double tap or a race can't charge twice. A bill past its time can't be paid.
- **A payment counts only when the payment partner says so.** The webhook is checked against its signature first, every accepted event is kept (a repeated event is ignored), the amount must match, and the effects (redemption paid, savings recorded, customer notified) happen exactly once. A failed payment leaves the bill open for another try.
- **Staff are told, not left to look:** a customer tapping Redeem or cancelling, a bill being paid, and offers or events being sent for review or decided all create an alert for the right people (the business team, or admins). Dashboards poll every few seconds, and show a bell, a toast, a sound and the count in the tab title.
- **What a business sees follows its category:** each category says whether Pay & Redeem bills apply (a cinema, for example, sells tickets instead) and what its item list is called (Menu, Price list, Services). The rule is inherited down the tree and enforced by the server, not just hidden in the dashboard.
- **Membership:** bought through the same payment flow as a bill. It starts only when the partner confirms. Time stacks if bought again before it ends; cancelling keeps the benefits to the end date. Switching plan while active is refused (`use_subscribe`). An admin can grant membership, but must give a reason, and it is audited.
- **Onboarding:** a new business applies with no login. VIBE approves it, asks for changes, or rejects it with a reason. Approving creates the listing (switched off) and the owner's login with a one-time temporary password; until the owner chooses their own password, every call except changing it is refused.
- **Admins see a customer's phone only on request**, and each reveal is written to the audit log.
- **Settlements:** a confirmed payment at a business is owed to it, less VIBE's fee and commission (rounded down per payment). A payment can be in one settlement only (database constraint); two admins settling the same business at once are serialised. Marking a settlement paid needs the bank reference and happens once. The merchant is told at both steps.
- **Auto-approval:** a trusted business's offers and events go live without review, are marked as such, and admins are told. Admin decisions clear the mark.
- **Spreadsheet downloads** are UTF-8 CSV that opens in Excel. Cells that start like a formula are neutralised, and phone numbers stay masked.
- **Slot booking (like Playo):** a venue lists bookable resources per sport: **courts** (one group per slot: badminton, tennis, football turfs, cricket nets) or **sessions** (several people per slot up to a capacity: swimming, yoga, gym). Slots follow the venue's opening hours, open 14 days ahead, and can have evening and weekend peak prices. A booking is held for 10 minutes while the customer pays through VIBE (held slots count against availability; reservations take turns on a lock per resource, so a court can't be sold twice), confirmed with an entry code when the partner confirms, and settled to the venue. The venue sees its day by court and hour, blocks slots (refused where customers have paid), and checks people in once. A resource with bookings can be switched off, not deleted. Each start time in the grid carries its whole range for the chosen duration (`label` "6–8 AM", "11 AM–1 PM"; `startLabel` "6:00 AM") and the price for all of it.
- **Venue memberships:** gyms, yoga and meditation studios and trainers sell plans of 1, 3, 6 or 12 months. The customer picks a plan and a start date (today to 60 days ahead); the pass is held 10 minutes while they pay, then runs from the start date to the day before the same date N months later, with a pass code the front desk checks in on any valid day (`not_started`/`expired` otherwise). A plan someone bought is kept (switch it off instead). Trials and single days stay slot bookings.
- **Discover:** *Offers near you* lists live offers at places in a category and everything under it (a top-level category or a subcategory, by id or slug), optionally matching a search (place, offer or area), within a distance, members-only, or at places open right now, sorted nearest, biggest saving or ending soonest. *Promotions* are a business promoting itself: a headline, a short message, an optional photo and where a tap goes (its page or one of its offers), up to 3 at a time and 90 days each. VIBE reviews each one (trusted businesses go live at once, auto-approved); changing the words, photo, offer or dates sends it back for review. Customers see live ones nearest first; taps are counted for the business.
- **Booking fee and offers at checkout:** court and class bookings and memberships carry VIBE's booking fee (`vibe.billing.booking-fee`, paise; 0 by default, ₹20 in the dev profile) on top of the price, shown as the VIBE fee and kept out of the venue's payout. Checkout coupons apply to them too (`kinds` `slots` and `pass`): the dev data has MEMBER5, 5% off for VIBE members up to ₹300, and WELCOME50. VIBE funds the discount, so the venue is settled the full price.
- **Two ways to redeem:** with a **code**, the customer gets a 6-digit code valid for 5 minutes (unique among live codes at that place), pays the place directly, and staff confirm it (optionally typing the bill to see the discount to give); no money goes through VIBE and nothing is settled. With a **bill**, as before, staff send the bill and the customer pays in VIBE. A place can turn off payment through VIBE, leaving codes only. Switching between the two replaces the open request. A confirmed code counts as using the offer that day.
- **Ratings:** only a confirmed code or a paid bill can be rated, once. A place's rating is the average of visible ratings; VIBE can hide one with a reason (audited). The merchant is alerted to each new rating.
- **Tickets:** tickets are held for 10 minutes while the customer pays, and held tickets count against what's left, so the last ticket can't be sold twice (reservations for an event take turns on a database lock). A hold whose payment is still in flight keeps its tickets; an expired hold can't be paid. A new hold by the same customer replaces their earlier unpaid one. Once the partner confirms, one ticket per person is issued with an admission code and a QR token; a ticket gets someone in once. The organiser is alerted with each sale (sold and left). Editing an event changes its ticket types in place: a type can't go below what's sold, and a type with sales can't be removed. Once tickets are sold only VIBE can cancel the event; cancelling cancels every ticket and tells each buyer (refunds are handled by the VIBE team until the payment partner is connected). Free tickets can't be booked in the app yet.
- **Checkout coupons:** one per ticket order, priced by the server, never making an order free (at least ₹1 is paid). The discount is VIBE's cost: the organiser is settled the full price.
- Every admin and merchant change is written to the audit log.

## Run it

You need Java 25, Maven and Docker.

```bash
cd backend
mvn spring-boot:test-run -Dspring-boot.run.profiles=dev
```

This starts a throwaway PostgreSQL in Docker, applies the migrations, loads **fictional dev data** (only with the `dev` profile) and serves on http://localhost:8090 (set `PORT` to change it). Data disappears when you stop it. Wait for the log line `DEV SEED loaded` (a few seconds after the server starts) before signing in.

Dev sign-in accounts: `admin@vibe.local` and `merchant@vibe.local` (merchant of *Saffron Courtyard*), password `vibe-dev-only` (override with `VIBE_DEV_PASSWORD`). These exist only with the `dev` profile.

To use your own PostgreSQL instead, create a database and run with `VIBE_DB_URL`, `VIBE_DB_USER`, `VIBE_DB_PASSWORD`, `VIBE_JWT_SECRET` set.

## Tests

```bash
mvn verify
```

Tests start a real PostgreSQL in Docker (Testcontainers) and apply the real migrations, so they run the same SQL as production. Docker Desktop must be running. They cover sign-in and lockout, role and business isolation, category depth, search and paging, offer rules and review, events and ticket types, home banners and pinning, plans, coupons, reservation settings, the merchant team, image upload safety, CORS and the audit trail.

## Configuration

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | HTTP port | `8090` |
| `VIBE_DB_URL`, `VIBE_DB_USER`, `VIBE_DB_PASSWORD` | PostgreSQL | local `vibe` database |
| `VIBE_JWT_SECRET` | Signs staff tokens, at least 32 bytes. **Required outside the `dev` profile**, from a secrets manager | none (the app won't start without it) |
| `VIBE_CORS_ORIGINS` | Exact origins allowed to call the API from a browser, comma separated | `http://localhost:5180,http://localhost:5181` |
| `VIBE_MEDIA_DIR` | Where uploaded images are stored in development | `./data/media` |
| `VIBE_PUBLIC_URL` | Public address used in image links | `http://localhost:<PORT>` |
| `VIBE_WEBHOOK_SECRET` | Signs payment-partner webhooks. Webhooks are refused until it is set (the dev profile sets a development-only one) | none |
| `VIBE_DEV_PASSWORD` | Password for the dev seed accounts | `vibe-dev-only` |

Production must never run the `dev` profile.

## What is simulated in development, and what is not connected

| Piece | Development (`dev` profile only) | Needed for real use |
| --- | --- | --- |
| SMS sign-in codes | Always 123456, nothing sent | An SMS provider with DLT-registered templates |
| Payments | A simulated partner confirms a payment about 2 seconds after it starts, through the same code a real webhook uses. No money moves | An RBI-authorised payment partner with split settlement, and its webhook secret |
| Push notifications | Saved to the customer's inbox only; the app also checks every few seconds | Firebase and Apple push accounts |
| Membership | Bought with the simulated partner; the dev customer is also seeded as a member | Recurring payments from the real partner for automatic renewal |
| Email to new merchants | The temporary password is shown to the admin once, to pass on by hand | An email provider |

Dev customer: sign in to the customer app with `98765 43210` and the code `123456`.

Dev data: the `dev` profile loads the customer app's demo catalogue (`src/main/resources/dev/demo-catalogue.json`, exported from `apps/customer/src/api/demo/catalog.ts`): every category, about 70 fictional places with menus and photos, their offers (approved, running for 90 days) and events. The database is rebuilt on every restart, so sign-ins, redemptions ("used today") and anything added in the dashboards start fresh each time. Films and showtimes are not built yet, so the app's Movies tab lists cinemas but no films.
