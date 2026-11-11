# VIBE Hyderabad — backend

Spring Boot (Java 25, Maven) modular monolith on PostgreSQL. See [docs/backend-design.md](../docs/backend-design.md) for the full plan.

## What exists today (phase B0 + the catalogue part of B1)

| Area | Endpoints | Who |
| --- | --- | --- |
| Health | `GET /v1/health` | anyone |
| Catalogue (what the customer app reads) | `GET /v1/categories`, `GET /v1/businesses` (`q`, `categoryId`, `sort`, `limit`, `offset`), `GET /v1/businesses/{id}` | anyone |
| Staff sign-in | `POST /v1/staff/login`, `GET /v1/staff/me` | admin, merchant |
| Admin | categories (list, create, update, delete), businesses (list, get, create, update), merchant logins (create, switch on/off, reset password), audit log | `ADMIN` |
| Merchant | own business profile (get, update), menu (list, add, update, delete), offers (list, add, update, delete) | `MERCHANT`, own business only |

Responses match the customer app's `CategoryNode`, `BusinessSummary`, `BusinessDetail` and `OfferSummary` types.

**Not built yet** (later phases in the design doc): customer sign-in (phone + OTP), Pay & Redeem and redemptions, payments, ticketing and movies, membership, social, notifications, image upload. Ratings, reviews and branches are empty or zero until their modules exist. The customer app can't switch to `http` mode yet because it needs those endpoints too.

## Rules the server enforces

- Staff passwords are hashed (BCrypt). A wrong email and a wrong password look the same, and 5 wrong tries lock the account for 15 minutes.
- Tokens are signed, expire after 8 hours, and carry the role and (for merchants) the business. **A merchant's business always comes from the token, never from the request**, so a merchant cannot read or change another business.
- Everything not listed above is closed by default.
- Categories go 3 levels deep, never inside themselves, and one that is in use can only be switched off, not deleted.
- Offers must be complete (a percentage needs a rate, a flat offer an amount), end after they start, and a flat discount can't exceed the minimum bill. Money is integer paise.
- Every admin and merchant change is written to the audit log.

## Run it

You need Java 25, Maven and Docker.

```bash
cd backend
mvn spring-boot:test-run -Dspring-boot.run.profiles=dev
```

This starts a throwaway PostgreSQL in Docker, applies the migrations, loads **fictional dev data** (only with the `dev` profile) and serves on http://localhost:8080 (set `PORT` to change it). Data disappears when you stop it.

Dev sign-in accounts: `admin@vibe.local` and `merchant@vibe.local` (merchant of *Saffron Courtyard*), password `vibe-dev-only` (override with `VIBE_DEV_PASSWORD`). These exist only with the `dev` profile.

To use your own PostgreSQL instead, create a database and run with `VIBE_DB_URL`, `VIBE_DB_USER`, `VIBE_DB_PASSWORD`, `VIBE_JWT_SECRET` set.

## Tests

```bash
mvn verify
```

Tests start a real PostgreSQL in Docker (Testcontainers) and apply the real migrations, so they run the same SQL as production. Docker Desktop must be running. They cover sign-in and lockout, role and business isolation, category depth, search and paging, offer rules, CORS and the audit trail.

## Configuration

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | HTTP port | `8080` |
| `VIBE_DB_URL`, `VIBE_DB_USER`, `VIBE_DB_PASSWORD` | PostgreSQL | local `vibe` database |
| `VIBE_JWT_SECRET` | Signs staff tokens, at least 32 bytes. **Required outside the `dev` profile**, from a secrets manager | none (the app won't start without it) |
| `VIBE_CORS_ORIGINS` | Exact origins allowed to call the API from a browser, comma separated | `http://localhost:5173,http://localhost:5174` |
| `VIBE_DEV_PASSWORD` | Password for the dev seed accounts | `vibe-dev-only` |

Production must never run the `dev` profile.
