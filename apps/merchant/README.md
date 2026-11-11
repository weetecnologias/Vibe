# VIBE Merchant dashboard

React + Vite + TypeScript. For the businesses listed on VIBE. Shares its UI, API client and money handling with the admin dashboard through [`packages/backoffice-kit`](../../packages/backoffice-kit).

## What it does

A merchant sees and edits **only their own business** (the server takes the business from the sign-in token, never from the request).

- **My business:** name, area, address, location, about, price level, hours (India time), photos, terms, online booking. Categories, verification and visibility are managed by the VIBE team.
- **Menu:** add, edit, hide and delete items, grouped by section. Prices are typed in rupees and stored in paise.
- **Offers:** create Pay & Redeem offers (percentage with an optional cap, or a flat amount; optional minimum bill; members only; start and end in India time). Offers show as Live, Scheduled, Ended or Switched off.

**Not built yet:** entering a customer's bill and seeing redemptions and settlements. They need the customer sign-in, redemption and payment modules (backend phases B2 and later).

## Run it

Start the backend first (see [backend/README.md](../../backend/README.md)), then:

```bash
cd apps/merchant
npm install
cp .env.example .env.local   # set VITE_API_URL if the backend isn't on :8080
npm run dev                  # http://localhost:5174
```

Dev login: `merchant@vibe.local` (password in the backend README; dev profile only).

## Checks

```bash
npm run typecheck
npm test
npm run build
```
