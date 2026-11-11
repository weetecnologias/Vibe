# VIBE Hyderabad — backend

Spring Boot (Java 25, Maven) modular monolith on PostgreSQL. See [docs/backend-design.md](../docs/backend-design.md) for the full plan.

## What exists today (phase B0, the catalogue part of B1, and the content tools)

| Area | Endpoints | Who |
| --- | --- | --- |
| Health | `GET /v1/health` | anyone |
| Catalogue (what the customer app reads) | `GET /v1/categories`, `GET /v1/businesses` (`q`, `categoryId`, `sort`, `limit`, `offset`), `GET /v1/businesses/{id}` | anyone |
| Home, plans, events, offers (what the customer app reads) | `GET /v1/home`, `GET /v1/membership/plans`, `GET /v1/events`, `GET /v1/events/{id}`, `GET /v1/offers?view=` | anyone |
| Images | `POST /v1/media` (PNG, JPEG or WebP, up to 5 MB), served at `GET /media/{file}` | upload: admin, merchant. Serving: anyone |
| Staff sign-in | `POST /v1/staff/login`, `GET /v1/staff/me` | admin, merchant |
| Admin | categories, businesses, merchant logins, audit log; **offer review** (approve or reject with a note); **events** (create, edit, publish, reject, cancel); **home banners and pinned sections**; **membership plans**; **checkout coupons** | `ADMIN` |
| Merchant | own business profile, menu, offers, **events with ticket types**, **reservation fees and policy**, **team logins** (owner only) | `MERCHANT`, own business only |

Responses match the customer app's `CategoryNode`, `BusinessSummary`, `BusinessDetail` and `OfferSummary` types.

**Not built yet** (later phases in the design doc): customer sign-in (phone + OTP), Pay & Redeem and redemptions, payments, ticket sales and holds, movies, membership subscriptions, social, notifications. Checkout coupons and reservation fees are stored and managed, but nothing applies them until payments and social exist. Image upload stores files on local disk in development; production needs object storage behind a CDN. Ratings, reviews and branches are empty or zero until their modules exist. The customer app can't switch to `http` mode yet because it needs those endpoints too.

## Rules the server enforces

- Staff passwords are hashed (BCrypt). A wrong email and a wrong password look the same, and 5 wrong tries lock the account for 15 minutes.
- Tokens are signed, expire after 8 hours, and carry the role and (for merchants) the business. **A merchant's business always comes from the token, never from the request**, so a merchant cannot read or change another business.
- Everything not listed above is closed by default.
- Categories go 3 levels deep, never inside themselves, and one that is in use can only be switched off, not deleted.
- Offers must be complete (a percentage needs a rate, a flat offer an amount), end after they start, and a flat discount can't exceed the minimum bill. Money is integer paise.
- **Offers and events are reviewed.** A merchant's offer or event is hidden from customers until VIBE approves it, and an edit that changes what it is sends it back for review. Events VIBE creates publish straight away. Rejecting needs a note the merchant can read.
- **Home content:** only live items (approved, switched on, published) can be pinned, up to 12 per section; with nothing pinned the app falls back to automatic picks.
- **Team:** the first login for a business is its owner. Only the owner can add staff, reset their passwords or switch them off, and only for their own business. The owner's own account can't be switched off by staff.
- **Images:** only real PNG, JPEG or WebP files (checked by their first bytes, not the file name), up to 5 MB, 100 uploads per person per day. Files get a random name and are served with the detected type and `nosniff`. SVG is refused because it can carry scripts.
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
| `VIBE_DEV_PASSWORD` | Password for the dev seed accounts | `vibe-dev-only` |

Production must never run the `dev` profile.
