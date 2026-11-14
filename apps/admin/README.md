# VIBE Admin dashboard

React + Vite + TypeScript. For VIBE staff. Shares its UI, API client and money handling with the merchant dashboard through [`packages/backoffice-kit`](../../packages/backoffice-kit).

## How it is organised

- **Looking at:** the picker at the top of the menu chooses **All of VIBE** or one category (Food & Dining, Movies, Sports...). Every page, total and Excel download then covers only that category: its businesses, sales, settlements, balances and approvals. A category's own team (category managers) only get their categories in the picker. Opening a category card on the Overview drills into it (Food & Dining → Restaurants). Remembered on this computer.
- **Menu groups:** Daily (Overview, To do, Reports), Partners (Merchants, Applications), Money (Sales and payments, Settlements, Merchant balances, Refunds, Disputes), Content (offer, promotion, event and review moderation), and, in All of VIBE only, Customers and Setup (categories, home content, plans, coupons, rates and tax, merchant agreement versions, reconciliation, the accounting ledger, the VIBE team, logins, audit log). On a narrow window the menu folds behind a **Menu** button.
- **Overview:** in All of VIBE, one card per category with sales (by kind: bills, movie and event tickets, bookings, memberships), money collected, what VIBE still owes the businesses, and what is waiting (KYC to check, applications, reviews, disputes, refunds due, payouts held). Inside a category the cards are its subcategories. Today, 7 days, 30 days or this month; downloads to Excel.
- **VIBE Membership** (in the menu under Daily, whatever category you are looking at): registered customers, members now (renewing, or cancelled with time left), registered but never a member, membership ended; membership fees collected in the period and all time, by plan, marked as VIBE’s own income (never paid to a business); joined, renewed and given free; and the people behind each number (members, not members, ended, everyone) with Excel downloads.
- **VIBE Social** (under Customers, when looking at all of VIBE; not for category managers): **Overview** (members, verified hosts, upcoming booked plans, open reports, chats closed for sharing contacts, deposits collected and refunded, venues taking plans, plans by status), **One-on-ones** (every plan with who created it and who joined, their VIBE IDs, the deposit and both payment references with their status; search by VIBE ID, VBM- booking or VB- payment; filter by status; download for Excel; open one to see requests, reports and the chat when it was reported or closed for safety, which is audited), **Reports** (dismiss or take action, optionally suspending the member), **Hosts** (check legal name, date of birth, ID type and last 4, and membership; approve, reject or revoke with a note) and **Members** (suspend or lift).
- **Films** (under Content): VIBE's film list that cinemas schedule from: title, certificate, running time, languages, formats, genres, release date (before it, coming soon), rating, poster, synopsis, director and cast. Archive a film to hide it.
- **To do:** one list of everything waiting for a decision, oldest first: new business applications, KYC and bank checks, offers, promotions and events to review, disputes, refunds to send and account deletions. Each opens where you act on it.
- **Merchants, by category:** the page opens on one row per category (Movies, Food & Dining, Sports, Events...) with how many businesses it has, how many have their KYC and bank details verified, sent to check, sent back or not sent, and the money: received through VIBE, paid out, waiting for the bank transfer, still owed. Open a category for its merchants (subcategories as quick filters; filter by KYC status, owed money, agreement), each with KYC and bank, agreement, received, paid out, owed, last sale and last payout. **Each business has one page:** overview, **payments received** (every payment, VIBE’s cut, their share, and whether it is not settled yet, waiting for the bank transfer or paid out with the bank reference), settlements, KYC and bank (verify or send back there), agreement. Every level downloads to Excel; the merchant download carries category, contact, legal and tax ids, bank (account number masked) and money.
- **Merchant balances:** a plain statement per business: sales, VIBE fees, commission and GST, refunds charged, adjustments, earned, paid out, owed now, with the category's totals. Downloads to Excel. (The double-entry **Accounting ledger** is under Setup, for finance and audit.)
- **Money checks (Model A):** customers pay through the gateway, the gateway pays VIBE’s escrow account less its charges, VIBE pays each business from that account. Upload the gateway’s settlement report and the escrow account’s bank statement (CSV); VIBE runs three checks: 1. every customer payment is in a gateway payout, once and for the right amount (duplicates and unknown payments are flagged); 2. every gateway payout arrived in the escrow account (by UTR, or amount and date); 3. every payout marked paid to a business left the account (by its bank reference). Shows money at the gateway, the escrow balance by VIBE’s books against the bank’s, and everything to look at; bank lines that are neither (bank charges, VIBE moving its income out) are explained with a note. Re-uploading a file or an overlapping statement counts nothing twice. In development, sample gateway and bank files are made from VIBE’s own data. The older payments-file check is a tab on the same page.
- **Settlements, in three steps:** 1. review what each business is owed and **create the pay run** for payments up to last Sunday (the weekly cycle) or every payment so far (one settlement per business that can be paid; businesses without verified KYC and bank details, or whose refunds exceed their sales, are held back with the reason); 2. **download the bank file** (account holder, account number, IFSC, amount; each download is audited) and transfer the money; 3. open each settlement and enter the bank reference (UTR). Each business is told at each step.

## What it does

- **VIBE-wide numbers** (All of VIBE): customers, active and lapsed members, membership sales and what members saved.
- **Customers:** search everyone, see their membership, payments and redemptions, reveal a phone number (audited), grant membership with a reason.
- **Transactions:** every payment, who paid, where, how much, and whether the payment partner confirmed it. Downloads to Excel with the same filters.
- **Reviews:** every rating; hide one that breaks the rules (with a reason), and it drops out of the place's rating.
- **Event sales:** tickets sold per event, and a Sales page with bookings and door check-in for VIBE's own events. Cancelling an event with sales cancels every ticket and tells the buyers.
- **Settlements:** what each merchant is owed, drawing up a settlement, recording the bank transfer (UTR); each settlement and every list downloads to Excel. Merchants are told at each step.
- **Members:** who holds a plan, from which date, and how they got it (bought or granted).
- **Applications:** businesses that applied to join. Approve (creates the listing, switched off, and the owner's login), ask for changes, or reject with a reason.
- **Deletion requests:** customers who asked for their account to be deleted.
- **Alerts:** a bell with a count, a toast and a sound when something needs you.
- **Categories:** add, edit, reorder, switch off and delete categories and subcategories (3 levels), and set whether bills apply to them and what their item list is called. Icons are a built-in name or an uploaded icon link. New categories appear in the customer app the next time it loads.
- **Rates and tax:** commission for the platform, a category or one business, with history; GST on commission. Each payment keeps the rate it was charged. **Ledger:** the books and trial balance. **Settlements:** now with GST, refund deductions, adjustments (credit or deduction with a reason) and KYC status. **Reconciliation:** upload the payment partner's file and see every difference.
- **KYC and bank**: review each business's legal and bank details (automatic checks shown), verify or send back. **Merchant agreement:** publish versions, see who accepted which and when. **Disputes:** customer problems with a payment, resolved with a refund (who bears it) or a reason.
- **Businesses:** search, create and edit listings (profile, hours, photos, categories, verified, live), set **commercial terms** (commission, auto-approve offers and events), and create merchant logins.
- **Offer review:** approve or reject merchant offers (rejecting needs a note the merchant sees). Only approved offers reach customers.
- **Promotion review:** approve or reject the promotions businesses want shown in Discover (rejecting needs a note). Trusted businesses' promotions go live at once and show as auto-approved; rejecting one takes it off the app.
- **Roles:** super admin (everything, including every admin account), admin (CEO level: everything, and staff accounts) and staff (only the areas ticked, optionally only some categories: a category manager). The menu shows only what the person can open, and the server refuses the rest. Managed on **VIBE team**; **All logins** lists every login including merchants.
- **Reports:** by category (partners, applications, payments, failed payments, refunds, VIBE fees; every level, any date range) and members (joined, members now, lapsed, never joined, by plan). Both download for Excel.
- **Refunds:** raise a refund on a confirmed payment from Transactions (full or part, with a reason); cancelled events add theirs automatically. Mark it refunded with the payment partner's reference once sent; the customer is told. Transactions can be filtered by refund due / refunded.
- **Categories:** each category sets what its merchants get (bills, offers, menu, reservations, bookings, memberships, events, promotions), or follows its parent.
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
