# VIBE Hyderabad

Local discovery, membership, Pay & Redeem offers, bookings, ticketing and social experiences for Hyderabad.

| Path | What it is | Status |
| --- | --- | --- |
| `design/ui-canvas/` | Approved design system and 16 customer screens (design canvas source) | Done |
| `apps/customer/` | Customer app — Expo / React Native / TypeScript (Android, iOS, web) | Running on demo data — see its [README](apps/customer/README.md) |
| `apps/merchant/` | Merchant dashboard — Next.js | Planned |
| `apps/admin/` | Admin dashboard — Next.js | Planned |
| `backend/` | API — Java 21, Spring Boot 3, PostgreSQL, Redis | Planned |

## Branches

- `main` — production
- `develop` — development / integration
- `feature/*`, `bugfix/*` → into `develop`; `hotfix/*` → into `main` (then back into `develop`); `release/*` → into `main`

Details, commit message rules and the PR flow are in [CONTRIBUTING.md](CONTRIBUTING.md).
