# VIBE Admin dashboard

React + Vite + TypeScript. For VIBE staff. Shares its UI, API client and money handling with the merchant dashboard through [`packages/backoffice-kit`](../../packages/backoffice-kit).

## What it does

- **Categories:** add, edit, reorder, switch off and delete categories and subcategories (3 levels). Icons are a built-in name or an uploaded icon link. New categories appear in the customer app the next time it loads.
- **Businesses:** search, create and edit listings (profile, hours, photos, categories, verified, live), and create merchant logins.
- **Staff accounts:** see everyone who can sign in, switch accounts off or on, reset passwords.
- **Audit log:** who changed what.

Merchant accounts can't sign in here, and admin accounts can't sign in to the merchant dashboard.

## Run it

Start the backend first (see [backend/README.md](../../backend/README.md)), then:

```bash
cd apps/admin
npm install
cp .env.example .env.local   # set VITE_API_URL if the backend isn't on :8080
npm run dev                  # http://localhost:5173
```

Dev login: `admin@vibe.local` (password in the backend README; dev profile only).

## Checks

```bash
npm run typecheck
npm test        # also runs the shared kit's tests (money, form drafts)
npm run build
```

Image links are plain `https://` links for now. File upload arrives with the media service (object storage + CDN).
