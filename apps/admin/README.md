# VIBE Admin dashboard

React + Vite + TypeScript. For VIBE staff. Shares its UI, API client and money handling with the merchant dashboard through [`packages/backoffice-kit`](../../packages/backoffice-kit).

## What it does

- **Categories:** add, edit, reorder, switch off and delete categories and subcategories (3 levels). Icons are a built-in name or an uploaded icon link. New categories appear in the customer app the next time it loads.
- **Businesses:** search, create and edit listings (profile, hours, photos, categories, verified, live), and create merchant logins.
- **Offer review:** approve or reject merchant offers (rejecting needs a note the merchant sees). Only approved offers reach customers.
- **Events:** review merchant events and publish or reject them, create your own (they publish straight away), edit, cancel. Ticket types and prices are set on the event.
- **Home content:** the sliding banners (image, headline, what they open, dates) and the pinned popular offers, trending places and featured events, in the order you choose. With nothing pinned the app picks automatically.
- **Membership plans:** name, price, billing period, benefits, and whether it is on sale.
- **Checkout coupons:** codes for movie and event tickets: percentage or flat, cap, minimum bill, members only, first booking only, uses per customer, dates.
- **Staff accounts:** see everyone who can sign in (merchant owners and staff), switch accounts off or on, reset passwords.
- **Image upload** on categories, banners, listings and events: PNG, JPEG or WebP up to 5 MB.
- **Audit log:** who changed what.

Merchant accounts can't sign in here, and admin accounts can't sign in to the merchant dashboard.

## Run it

Start the backend first (see [backend/README.md](../../backend/README.md)), then:

```bash
cd apps/admin
npm install
cp .env.example .env.local   # set VITE_API_URL if the backend isn't on :8090
npm run dev                  # http://localhost:5180
```

Dev login: `admin@vibe.local` (password in the backend README; dev profile only).

## Checks

```bash
npm run typecheck
npm test        # also runs the shared kit's tests (money, form drafts)
npm run build
```

Image links are plain `https://` links for now. File upload arrives with the media service (object storage + CDN).
