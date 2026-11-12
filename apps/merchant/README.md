# VIBE Merchant dashboard

React + Vite + TypeScript. For the businesses listed on VIBE. Shares its UI, API client and money handling with the admin dashboard through [`packages/backoffice-kit`](../../packages/backoffice-kit).

## What it does

A merchant sees and edits **only their own business** (the server takes the business from the sign-in token, never from the request).

- **Join VIBE:** a business that has no login yet applies at `/apply` and follows its application there. When VIBE approves, it receives a login and chooses its own password on first sign-in.
- **Your results:** sales through VIBE, customers, average bill, discount given, how each offer is doing, and money on its way.
- **Settlements:** what isn't settled yet, settlements drawn up, and transfers to your bank with the bank reference; each settlement downloads to Excel.
- **Alerts:** a bell, toast and sound when a customer taps Redeem, cancels, or pays, and when VIBE decides on an offer or event.
- **Bills** (the screen for the table, hidden for kinds of business that sell tickets instead): customers who tapped **Redeem** in the app appear here by first name and VIBE ID. Click **Raise bill**, pick what they ordered from your menu or price list (or type amounts), check the amount VIBE shows the customer will pay, and send it. The customer's app shows it within a few seconds and they pay there. You see it turn to **Paid**, with today's totals. A wrong bill can be withdrawn until the customer starts paying. Bills of ₹50,000 or more ask you to confirm the amount. The list refreshes by itself.
- **My business:** name, area, address, location, about, price level, hours (India time), photos, terms, online booking. Categories, verification and visibility are managed by the VIBE team.
- **Menu:** add, edit, hide and delete items, grouped by section. Prices are typed in rupees and stored in paise.
- **Offers:** create Pay & Redeem offers (percentage with an optional cap, or a flat amount; optional minimum bill; members only; start and end in India time). **VIBE reviews each offer before customers see it**, and changing an offer sends it back for review. Offers show as Waiting for VIBE, Not approved (with VIBE's note), Live, Scheduled, Ended or Switched off.
- **Events:** create events with ticket types, prices and capacity. They wait for VIBE's review, and an edit sends a published event back for review. Cancel an event from the list.
- **Reservations:** set the table or slot fee and your cancellation policy for people who reserve a place for a one-on-one meetup. Off by default.
- **Team:** the owner adds staff logins for this business, resets their passwords or switches them off. Staff can do everything else but can't manage the team.
- **Image upload** for the logo, cover, photos, menu pictures and event covers.

**Not built yet:** settlements and payout statements, refunds, ticket sales and door check-in, cinema showtimes and reviews. Push notifications to the customer need the notification service (until then the app checks every few seconds). QR scanning to find a customer is a later addition; for now search by VIBE ID or first name.

## Run it

Start the backend first (see [backend/README.md](../../backend/README.md)), then:

```bash
cd apps/merchant
npm install
cp .env.example .env.local   # set VITE_API_URL if the backend isn't on :8090
npm run dev                  # http://localhost:5181
```

Dev login: `merchant@vibe.local` (password in the backend README; dev profile only).

## Checks

```bash
npm run typecheck
npm test
npm run build
```
