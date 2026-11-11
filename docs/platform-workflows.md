# VIBE Hyderabad — how customer, merchant and admin fit together

This is the working plan that keeps the three sides from drifting apart. **Every business process is one record with three views**: the customer sees their part in the app, the merchant sees theirs on the merchant dashboard, and VIBE sees all of it on the admin dashboard. Every step that needs someone to act tells that person (a notification), and every change by staff is written to the audit log.

Status key: ✅ built and tested · 🟡 partly built · ⛔ not built yet.

## 1. What the customer app does, and where each part stands

| Customer app area | API methods | Backend | Admin sees / controls | Merchant sees / controls |
| --- | --- | --- | --- | --- |
| Sign-in, profile, account deletion | 5 | ✅ (SMS is simulated in dev) | ✅ customers list and detail (phone reveal is audited), deletion requests | n/a |
| Categories and icons | 1 | ✅ | ✅ add, edit, icon upload | n/a |
| Home: banners, trending, popular offers, events | 1 | ✅ | 🟡 banners and pinning exist; the home preview and the "collections" (for example *Hyderabad after dark*) are missing | n/a |
| Discover and business pages | 4 | ✅ (ratings and reviews are empty) | ✅ listings | ✅ profile, menu, hours, photos, upload |
| Offers (list, detail, eligibility) | 3 | ✅ | ✅ review and approve | ✅ create (reviewed) |
| **Pay & Redeem** (redeem, bill, pay, receipt) | 7 | ✅ | ✅ transactions list and detail, overview totals | ✅ alert on redeem, bills from the menu, per-category rules |
| Events: browse, book, my tickets, ticket | 5 | 🟡 browse only; **no booking, holds, tickets** | ✅ review and publish | 🟡 create; **no sales view** |
| Movies: films, cinemas, shows, seats, hold | 6 | ⛔ | ⛔ | ⛔ no showtimes or seat layouts |
| Checkout coupons | 3 | 🟡 stored; **not applied** | ✅ manage | n/a |
| Membership: plans, subscribe, change, cancel | 5 | ✅ purchase, stacking, cancel (no auto-renew yet: needs the partner's recurring payments) | ✅ plans, members list, grant with reason | n/a |
| Social: activities, groups, hosting | 5 | ⛔ | ⛔ no hosts, no approvals, no moderation | ⛔ no hosting |
| One-on-one: invites, chat, safety | 9 | ⛔ | ⛔ no moderation queue | n/a |
| Meet reservation (table, slot, movie seats) and split payment | 2 | ⛔ | ⛔ | 🟡 fees and policy only |
| Notifications screen | – | 🟡 inbox exists; the app doesn't read it | ⛔ | ⛔ |
| Merchant onboarding ("Join VIBE for Business") | – | ✅ public application, status by private link, approve, changes, reject, one-time password, forced password change | ✅ apply and track | ✅ |

## 2. The workflows, end to end

**W1 Merchant onboarding.** A business applies (details, category, area, contact, documents) → VIBE is told → admin reviews, asks for changes or approves → approval creates the listing and the owner's login → the owner is told how to sign in, fills in photos, menu and hours → the listing goes live when VIBE switches it on. Rejections carry a reason.

**W2 Pay & Redeem (food, shopping, beauty, services).** Customer taps Redeem on an approved offer → **the merchant's dashboard alerts staff straight away** (sound, banner, badge) → staff open the customer, **build the bill from the menu or price list** (or type items) → the server prices it from the offer's rule → the customer is told and sees the bill → pays → the merchant sees Paid and today's totals → VIBE sees the transaction. Which categories use bills is set by admin on the category (a restaurant bill is different from a salon service).

**W3 Events and movies.** Merchant creates an event with ticket types, or a cinema sets screens, seat layouts and showtimes → VIBE reviews → published → customer picks tickets or seats, which are held for a few minutes → pays → one ticket per person with a QR code → **the merchant sees sold, held and left per ticket type and is told on each booking** → at the door staff scan the QR to check people in → VIBE sees sales and refunds.

**W4 Membership.** Admin defines plans → customer subscribes and pays → membership starts → member offers and coupons unlock → **admin sees each member, plan, payment, renewal and cancellation** → renewals and cancellations are recorded; the customer can cancel any time.

**W5 Social and hosting.** Hosting is a privilege. Merchants can host from their dashboard. Customers can **apply to host, giving consent to the host rules**; admin approves (or removes) hosts → approved hosts create activities and groups → customers join (with host approval where the activity needs it) → reports and blocks go to a moderation queue → admin can suspend a host or hide an activity.

**W6 Meet reservations and split payment.** When two people plan a meet, the host can reserve at a venue: a table or slot (paid to the venue, using the venue's fee and policy) or movie seats (sent into the cinema booking flow). The booking is shared in the chat. Either person can ask to **split the cost**; the other accepts and pays their share through the same payment system.

**W7 Content.** Admin controls what the customer app shows first (banners with image upload, pinned offers, places and events, collections) and every icon (category icons). Merchants control their own photos, logo and menu.

**W8 Admin oversight.** One place to see customers (profile, membership, redemptions, payments), every transaction and its status, merchant applications, pending offers and events, host applications, reports, deletion requests and the audit log, with a daily overview.

## 3. Who is told what

| Event | Told | How |
| --- | --- | --- |
| Customer taps Redeem | merchant staff | dashboard alert and sound, badge, optional desktop notification |
| Bill sent, withdrawn, paid | customer | app inbox now; push when Firebase and Apple push are connected |
| Payment received | customer; merchant sees it on Bills | inbox, live list |
| Ticket booked | customer (ticket); merchant (sold count and alert) | inbox, dashboard alert |
| Merchant applies | admin | dashboard alert |
| Offer, event, host or listing awaiting review | admin | dashboard alert and queue count |
| Application, offer or event decided | merchant | dashboard alert with VIBE's note |
| Report filed, contact sharing caught in chat | admin (moderators) | dashboard alert |

**P1 status (checked 11 Nov 2026):** the backend suite passes (101 tests), both dashboards typecheck and build, and the flow was walked through in a browser against the dev backend: apply, admin alert, approve, forced password change; a customer buying a yearly membership, redeeming, the merchant raising a bill from the menu (₹1,350, 30% off, ₹945 paid), and the admin overview and transactions showing ₹3,944 collected and ₹405 saved. Staff alerts are polled every few seconds; real push needs Firebase and Apple accounts. Not yet checked in a browser: customer-app screens for membership purchase (the API is tested), and the admin grant-membership dialog.

## 4. Build order

Each phase ends with tests green and a browser walk-through of the whole flow across all three sides.

| Phase | What | Why this order |
| --- | --- | --- |
| **P1** (done) | Staff notifications; billing from the menu with merchant alerts; per-category billing rules; admin overview, customers and transactions; membership purchase and the admin members list; merchant onboarding with approval | Finishes the money flow you described and gives admin eyes on everything that already exists |
| **P2** | Events ticketing: booking, holds, tickets with QR, merchant sales, check-in, coupons at checkout | Needs P1's notifications and payments |
| **P3** | Movies: cinema setup (screens, seat layouts, showtimes), seat maps, holds, tickets | Builds on P2 |
| **P4** | Social: hosting programme, activities, groups, join and approvals, moderation | Needs P1 admin queues |
| **P5** | One-on-one, chat with the safety rules, meet reservations, split payment | Needs P2, P3 and P4 |
| **P6** | Home collections and preview, reviews and ratings, settlements and payouts, refunds | Polish and money out |

## 5. Needed from you (these block go-live, not the building)

Payment partner and its settlement model; SMS provider; Firebase and Apple push accounts; KYC provider and the documents VIBE must collect from merchants; cinema showtime source; the hosting rules customers consent to; legal review of terms, privacy and DPDP consent text; the official logo.
