# VIBE Merchant dashboard

React + Vite + TypeScript. For the businesses listed on VIBE. Shares its UI, API client and money handling with the admin dashboard through [`packages/backoffice-kit`](../../packages/backoffice-kit).

## What it does

A merchant sees and edits **only their own business** (the server takes the business from the sign-in token, never from the request).

- **Bookings & members** (sports and fitness venues; opens first for them): the day's schedule by court and hour, front-desk check-in with the customer's entry code or membership pass code, blocking a slot, and **Courts and prices**: courts or sessions per sport, price per slot, evening and weekend peak prices, capacity for classes. **Memberships**: monthly, 3-, 6- or 12-month plans (gyms, yoga and meditation studios, trainers) with price and benefits, switched on or off; the members list with valid dates, visits and who is active now. An alert with every booking and membership.
- **Bills and codes:** customers redeeming with a **code** appear with it; staff type the code (or tap **Yes, redeemed** on the row), optionally type the bill to see the discount to give, and confirm. Customers asking for the **bill** are billed as before. **Profile** has a switch for whether customers can pay through VIBE at all.
- **Reviews:** every rating from a real visit, the average and the spread; an alert with each new one.
- **Events and tickets:** each event shows tickets sold and left. **Sales and door** shows sold, left, being bought and checked in per ticket type, every booking, and a box to check people in by the code on their ticket (a ticket gets in once). An alert arrives with every sale.
- **Team roles:** the owner adds people as **cashier / waiter** (Bills only), **manager** (everything except the team) or **custom** (chosen areas), and can change it any time. Each person sees only the pages and alerts for their role, and the server refuses the rest.
- **Join VIBE:** a business that has no login yet applies at `/apply` and follows its application there. When VIBE approves, it receives a login and chooses its own password on first sign-in.
- **Your results:** sales through VIBE, customers, average bill, discount given, how each offer is doing, and money on its way.
- **Settlements:** what isn't settled yet, settlements drawn up, and transfers to your bank with the bank reference; each settlement downloads to Excel.
- **Alerts:** a bell, toast and sound when a customer taps Redeem, cancels, or pays, and when VIBE decides on an offer or event.
- **Bills** (the screen for the table, hidden for kinds of business that sell tickets instead): customers who tapped **Redeem** in the app appear here by first name and VIBE ID. Click **Raise bill**, pick what they ordered from your menu or price list (or type amounts), check the amount VIBE shows the customer will pay, and send it. The customer's app shows it within a few seconds and they pay there. You see it turn to **Paid**, with today's totals. A wrong bill can be withdrawn until the customer starts paying. Bills of ₹50,000 or more ask you to confirm the amount. The list refreshes by itself.
- **My business:** name, area, address, location, about, price level, hours (India time), photos, terms, online booking. Categories, verification and visibility are managed by the VIBE team.
- **Menu:** add, edit, hide and delete items, grouped by section. Prices are typed in rupees and stored in paise.
- **What shows depends on the business's category.** A business joins VIBE in one category (Food & Dining → Cafés, Fitness → Sports…) and its dashboard shows only that category's features (set by VIBE on the category): for example a café gets Bills, Offers, Menu, Reservations and Promotions; a gym gets Bookings, Memberships, Bills, Offers and Promotions; an event organiser gets Events and Promotions. The server refuses the rest. The owner can give team members only those areas. Two kinds of business means two applications and two logins. When applying, the business picks its category, then its subcategory, and sees what it will get.
- **Offers:** **Stop** and **Resume** in one click (no new review); an offer customers have used is kept for receipts and can only be stopped, not deleted. Create Pay & Redeem offers (percentage with an optional cap, or a flat amount; optional minimum bill; members only; start and end in India time). **VIBE reviews each offer before customers see it**, and changing an offer sends it back for review. Offers show as Waiting for VIBE, Not approved (with VIBE's note), Live, Scheduled, Ended or Switched off.
- **Promotions:** tell customers near you what's new. A headline, message, optional photo and where a tap goes (your page or one of your offers), with start and end dates; up to 3 at a time. They show in the customer app under Discover → Promotions once VIBE approves them, with taps counted. Stop and resume without a new review; changing the content sends it back.
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
