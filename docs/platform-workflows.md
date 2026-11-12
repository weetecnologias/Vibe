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
| Events: browse, book, my tickets, ticket | 5 | ✅ holds, payment, QR tickets, coupons (free tickets not yet) | ✅ review, publish, sales, cancel with buyers told | ✅ sold and left, bookings, alerts, door check-in |
| Movies: films, cinemas, shows, seats, hold | 6 | ⛔ | ⛔ | ⛔ no showtimes or seat layouts |
| Checkout coupons | 3 | ✅ applied to ticket orders (movies when they exist) | ✅ manage | n/a |
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

## 2a. How each category works (agreed 12 Nov 2026)

| Category | Works like | Customer | Merchant | Admin |
| --- | --- | --- | --- | --- |
| Food & Dining | Swiggy Dineout, Zomato dining | Picks a ready-made offer, then either **orders through VIBE** from the menu (planned) or **asks for the bill** at the table; pays in the app | Raises the bill from the menu (built) or confirms the customer's VIBE order (planned); alerted on every redeem and payment | Every payment by its unique transaction ID; settles with the merchant |
| Shopping, Fitness & Wellness, Beauty & Personal Care, Kids & Family | Same as dining | Redeems the offer in the store; the merchant pushes the bill; pays in the app | Bills from their price list or services | Same |
| Movies | BookMyShow | Picks a show and seats, which are held for a few minutes, pays, gets a QR ticket | Cinema sets screens, seat layouts and showtimes; sees seats sold and left | Settles ticket money |
| Events & Experiences | BookMyShow | Picks ticket types, pays, gets a QR ticket | Sees sold and left per ticket type, gets alerts, checks people in | Reviews or auto-approves; settles |
| VIBE Social | Careful, safety first | One-on-one requests ("I'm interested in…") with filters; plans show **Open** or **Filled**; groups highlighted; hosting only for approved hosts | Approved merchants host | Approves hosts, moderates reports |
| Offers & Benefits | — | Two pages: **Member benefits** and **Promotions** (big sales such as 50–80% off, highlighted, nearby first) | Marks an offer as a promotion (planned) | Approves promotions |

**Settlements (built 12 Nov 2026).** Every confirmed payment at a business is owed to it, less VIBE's fee (when the customer paid one) and VIBE's commission (set per merchant by the admin, with a reason, audited). The admin sees what each merchant is owed, draws up a settlement (each payment can be in one settlement only, ever), transfers the money and records the bank reference (UTR). The merchant is told when a settlement is drawn up and when it is paid, and sees every payment in it. Transactions, members, customers, settlements and each settlement's payments download as spreadsheets that open in Excel.

**Fitness & Wellness: slot booking like Playo (built 12 Nov 2026).** Venues list the sports they offer; each sport has courts or sessions with a price per slot (peak evenings and weekends). The customer picks a sport, a date (14 days ahead), a duration and a start time (morning, afternoon, evening), then a court (or how many people for a class), adds slots to a booking, pays through VIBE within 10 minutes, and gets an entry code with a QR. The venue gets an alert, sees the booking on its day schedule, checks the customer in at the front desk, and is settled the money. Choosing 2 or 3 hours shows each start as its full range (6–8 AM, 7–9 AM) with the price for the whole time, and the booking total adds up as slots are added.

**Monthly memberships (built 12 Nov 2026).** Gyms, yoga and meditation studios, personal trainers (and martial arts classes) sell monthly, 3-, 6- or 12-month plans. On the place's page the customer taps **Join monthly**, chooses a plan, chooses the month to start (today, or the 1st of the next two months), and pays; **Trial / 1 day** still books a single session by the hour. At checkout, for courts, classes, memberships and tickets: VIBE member offer (5% off), other coupons and a code box, then subtotal, discount, taxes & charges and the VIBE fee. The customer gets a pass with a QR code and its valid dates (also under My bookings); the place gets an alert, sees the member in **Bookings & members → Memberships**, and checks them in with the pass code at the front desk. Still to come, from Playo: open games people can join and split the cost (ties into VIBE Social), coaching batches, renewals and freezes, and amenities on the venue page.

**Movies in three parts (built 13 Nov 2026).** The Movies screen opens on **Movies** (now showing, coming soon, cinemas), with two more tabs: **Private theatres** (a screen of your own for birthdays, dates and groups, booked by the hour like a court: choose the date, 1 to 3 hours and a screen, then pay) and **Open-air theatres** (weekend screenings sold as tickets, and the places that run them).

**Discover in two parts (built 13 Nov 2026).** **Offers near you**: every live offer around the customer, by category (All, Food & Dining → Cafés, Fitness & Wellness → Sports, and so on), with search and filters for nearest / biggest saving / ending soon, open now, within 3 km and member offers. **Promotions**: businesses promoting themselves (written in the merchant dashboard, approved in the admin dashboard), nearest first, filtered by the same categories; a tap opens the place or its offer.

**Merchants see only their category's features (built 13 Nov 2026).** A business applies in one category and subcategory and sees what it will get before sending. Its dashboard (and the server) offer only that category's features; VIBE sets them per category in Categories, and new subcategories follow their parent. Owners give team members only those areas.

**VIBE team roles, reports and refunds (built 13 Nov 2026).** Super admin, admin (CEO level) and staff with chosen areas and, optionally, categories (category managers). Reports by category and for members, with Excel downloads. Refunds are tracked from raised (by staff, or automatically when an event is cancelled) to refunded with the partner's reference, and kept out of settlements.

**Two ways to redeem (built 12 Nov 2026).** The customer taps Redeem and chooses: **show a code** (6 digits, valid 5 minutes, with the place's address and directions; pay the place directly; staff confirm the code, optionally typing the bill to see the discount) or **get the bill in VIBE** (staff send it; pay in the app; settled to the merchant). Places that don't take VIBE payments offer only the code. Either way the customer is then asked to rate the visit; ratings come only from real visits, show on the place's page, and VIBE can hide abusive ones.

**Merchant team roles (built 12 Nov 2026).** The owner can do everything and chooses each person's role: cashier / waiter (bills only), manager (everything except the team) or custom areas. Enforced by the server, applied at once, and each person sees only their alerts.

**How a bill starts.** The customer starts it by tapping Redeem on an offer at the place; staff see them under Bills, raise the bill from the menu, and the customer pays in the app. A bill started by staff for a customer who hasn't tapped Redeem (by VIBE ID) needs a "bills for you" screen in the customer app first: planned.

**Auto-approval (built 12 Nov 2026).** The admin can mark a merchant as trusted: its new and changed offers and events go live straight away, marked "Auto-approved", and admins are still told. Trust can be taken away; the merchant is told either way.

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
| Settlement drawn up, settlement paid (with bank reference) | merchant | dashboard alert |
| Offer or event auto-approved | admin | dashboard alert |
| Auto-approval switched on or off | merchant | dashboard alert |

**P1 status (checked 11 Nov 2026):** the backend suite passes (101 tests), both dashboards typecheck and build, and the flow was walked through in a browser against the dev backend: apply, admin alert, approve, forced password change; a customer buying a yearly membership, redeeming, the merchant raising a bill from the menu (₹1,350, 30% off, ₹945 paid), and the admin overview and transactions showing ₹3,944 collected and ₹405 saved. Staff alerts are polled every few seconds; real push needs Firebase and Apple accounts. Not yet checked in a browser: customer-app screens for membership purchase (the API is tested), and the admin grant-membership dialog.

## 4. Build order

Each phase ends with tests green and a browser walk-through of the whole flow across all three sides.

| Phase | What | Why this order |
| --- | --- | --- |
| **P1** (done) | Staff notifications; billing from the menu with merchant alerts; per-category billing rules; admin overview, customers and transactions; membership purchase and the admin members list; merchant onboarding with approval | Finishes the money flow you described and gives admin eyes on everything that already exists |
| **P1.5** (done) | Settlements with commission, merchant settlement reports and alerts, Excel downloads, auto-approval for trusted merchants, merchant results page, grouped dashboard menus | The money has to reconcile before tickets add more of it |
| **P2** (done) | Events ticketing: booking, holds, tickets with QR, merchant sales, check-in, coupons at checkout | Needs P1's notifications and payments |
| **P3** | Movies: cinema setup (screens, seat layouts, showtimes), seat maps, holds, tickets | Builds on P2 |
| **P4** | Social: hosting programme, activities, groups, join and approvals, moderation | Needs P1 admin queues |
| **P5** | One-on-one, chat with the safety rules, meet reservations, split payment | Needs P2, P3 and P4 |
| **P6** | Promotions page and Member benefits, ordering through VIBE for dining, home collections and preview, reviews and ratings, refunds | Polish |

## 5. Needed from you (these block go-live, not the building)

Payment partner and its settlement model; SMS provider; Firebase and Apple push accounts; KYC provider and the documents VIBE must collect from merchants; cinema showtime source; the hosting rules customers consent to; legal review of terms, privacy and DPDP consent text; the official logo.
