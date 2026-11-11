# VIBE Hyderabad

Local discovery, membership, Pay & Redeem offers, bookings, ticketing and social experiences for Hyderabad.

| Path | What it is | Status |
| --- | --- | --- |
| `design/ui-canvas/` | Approved design system and 16 customer screens (design canvas source) | Done |
| `apps/customer/` | Customer app — Expo / React Native / TypeScript (Android, iOS, web) | Running on demo data — see its [README](apps/customer/README.md) |
| `apps/merchant/` | Merchant dashboard — React / Vite / TypeScript | Profile, menu and offers working against the backend — see its [README](apps/merchant/README.md) |
| `apps/admin/` | Admin dashboard — React / Vite / TypeScript | Categories, businesses, staff accounts and audit log — see its [README](apps/admin/README.md) |
| `packages/backoffice-kit/` | Shared UI, API client and money handling for both dashboards | In use |
| `backend/` | API — Java 25, Spring Boot 4, PostgreSQL | Catalogue, staff sign-in, admin and merchant APIs — see its [README](backend/README.md). Customer sign-in, redemptions, payments, ticketing, membership and social come next ([plan](docs/backend-design.md)) |

## Branches

- `main` — production
- `develop` — development / integration
- `feature/*`, `bugfix/*` → into `develop`; `hotfix/*` → into `main` (then back into `develop`); `release/*` → into `main`

Details, commit message rules and the PR flow are in [CONTRIBUTING.md](CONTRIBUTING.md).
