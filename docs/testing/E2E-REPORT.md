# VIBE end-to-end test report

Run 14/11/2026, 3:59:25 pm IST against the dev backend (http://localhost:8090), simulated payment partner.

**79 checks passed, 0 failed.**


## 1. Accounts and roles

| Result | Check | Detail |
|---|---|---|
| Pass | Super admin signs in |  |
| Pass | Every merchant login signs in | 78 of 78 logins |
| Pass | Every business has an owner login | 77 businesses, 77 listed |
| Pass | Merchants are grouped by category | Food & Dining 14, Shopping 22, Fitness & Wellness 11, Beauty & Personal Care 5, Kids & Family 15, Events & Experiences 0, Movies 10, VIBE Social 0, Offers & Benefits 0 |
| Pass | Every VIBE team login signs in | admin@vibe.local (super_admin), ceo@vibe.local (admin), beauty-manager@vibe.local (staff), events-manager@vibe.local (staff), fitness-manager@vibe.local (staff), food-manager@vibe.local (staff), kids-manager@vibe.local (staff), movies-manager@vibe.local (staff), shopping-manager@vibe.local (staff), finance@vibe.local (staff), support@vibe.local (staff) |
| Pass | CEO (admin) sees everything, including the VIBE team page |  |
| Pass | Finance opens money checks |  |
| Pass | Finance can’t manage the VIBE team |  |
| Pass | Support opens disputes |  |
| Pass | Support can’t change categories |  |
| Pass | Food & Dining manager sees only Food & Dining businesses | 14 businesses |
| Pass | Category managers don’t get the money checks |  |
| Pass | A merchant can’t open the admin API |  |
| Pass | An admin can’t use the merchant API |  |

## 2. Commission set by VIBE

| Result | Check | Detail |
|---|---|---|
| Pass | Admin sets a 10% platform commission (rate card) |  |
| Pass | Admin sets GST on commission to 18% | {"commissionGstBps":1800} |
| Note | GST on commission | 18% |

## 3. Customers and VIBE Membership

| Result | Check | Detail |
|---|---|---|
| Pass | Members show as members |  |
| Pass | Non-members show as not members |  |
| Pass | A lapsed membership shows as not a member |  |
| Pass | Member can use the member-only offer | Members save 30% |
| Pass | Non-member is told it’s for members | This offer is for VIBE members. |
| Pass | Non-member buys VIBE Membership (₹299/month) and pays | VB-96BU-98S4 |
| Pass | Admin sees the new member and the fee as VIBE’s income | members 4 → 5, fees ₹3,597 → ₹3,896 |
| Pass | Admin lists customers who registered but never took membership | 2 customers |

## 4. Orders, payments and the merchant side

| Result | Check | Detail |
|---|---|---|
| Pass | Dine-in: the merchant sees the customer waiting for the bill | Priya Sharma · VIBE ID 600101 |
| Pass | Dine-in: the merchant sends a ₹1,500 bill |  |
| Pass | Dine-in: the customer is notified the bill is ready | Your bill from Saffron Courtyard is ready |
| Pass | Dine-in: the member offer (30%) is on the bill | discount ₹450, pays ₹1,050 |
| Pass | Dine-in: the merchant sees it paid |  |
| Pass | A second payment for the same bill is refused | already_paid |
| Pass | The same Pay tap repeated returns the same payment, not a new one | VB-RE6Z-2ZZT |
| Pass | The same transaction ID is in the customer’s, the merchant’s and the admin’s records | VB-RE6Z-2ZZT |
| Pass | Merchant raises a bill from the customer’s VIBE ID; customer applies coupon SAVE100 | pays ₹1,100 |
| Pass | Pay at the counter: the customer shows a code, the merchant confirms it | code 191697 at Dragon Lane |
| Pass | Sports: the customer books two court slots | Badminton · 6–7 AM, 7–8 AM · ₹1,000 |
| Pass | Sports: the venue sees the booking on its day sheet | VBS-XVR5-55K8 |
| Pass | Gym: the customer buys a monthly membership | Monthly unlimited · ₹2,999 |
| Pass | Gym: the studio sees the new member | Sneha Iyer |
| Pass | Events: the customer reserves 2 seats | Biryani Masterclass · ₹1,998 |
| Pass | Events: the organiser sees the tickets sold | {"eventId":"4cc6ebc4-ec53-46ab-b0b7-095ad9d76464","title":"Biryani Masterclass","startsAt":"2026-11-20T14:30:00Z","statu |
| Pass | Café with KYC waiting can still take a payment | VB-2FNM-8HW5 |
| Pass | Movies: films are listed | The Monsoon Letters, Little Comet, Charminar Heist |
| Pass | Movies: the cinemas showing it tomorrow, with times | Galleria Cinemas 3 shows, Luxe Screens 1 shows |
| Pass | Movies: two Prime seats held while paying | Charminar Heist · D1, D2 · ₹560 |
| Pass | Movies: someone else can’t take a held seat | seat_taken |
| Pass | Movies: one QR ticket per seat | seat D1 · Galleria Cinemas · Audi 2 · code DNM-9ZA |
| Pass | Movies: the cinema sees the seats sold | Charminar Heist 2 sold |
| Pass | Movies: the door won’t let a ticket in a day early | This show starts at Sun 15 Nov, 10:00 AM. Entry opens an hour before. |
| Pass | Social: venues that take reservations, with their deposit | Irani Chai Corner ₹300, Saffron Courtyard ₹500, Matcha Lab ₹400 |
| Pass | Social: a new plan is a draft until the deposit is paid | draft · pay ₹500 |
| Pass | Social: nobody else sees a draft |  |
| Pass | Social: paid, the plan is live for people it suits | Dinner for two · ₹500 table deposit, paid by the host · comes off the bill |
| Pass | Social: accepted, the table is booked | Table for 2 · booked · ref VBM-F3GW-WW6F · free cancellation until 4:00 pm |
| Pass | Social: the restaurant sees the booking for two | VBM-F3GW-WW6F Priya and Rahul confirmed |
| Pass | Social: VIBE’s monitor shows who booked, VIBE IDs and the transaction ID | VBM-F3GW-WW6F · Priya S. (600101) with Rahul V. · VB-8Q26-S8HE |
| Pass | Social: host applications wait for a VIBE check | Rahul V. aadhaar ····4821 |
| Pass | Social: category managers can’t open Social |  |

## 5. Support: disputes and refunds

| Result | Check | Detail |
|---|---|---|
| Pass | Customer raises a dispute on a payment | DSP-JAJNQV |
| Pass | Support sees both disputes | DSP-JAJNQV, DSP-BV6LRF |
| Pass | The Food & Dining manager sees only the restaurant’s dispute |  |
| Pass | Support resolves it with a ₹250 refund, borne by the restaurant | refund |
| Pass | Support declines the other with a reason | rejected |
| Pass | Support marks the refund as sent with the partner’s reference | {"reference":"VB-JUKL-R3SQ","kind":"redemption","payee":"Saffron Courtyard","cus |
| Pass | The customer is told | Refund sent |
| Pass | The refund comes off what VIBE owes the restaurant | ₹4,187.74 → ₹3,937.74 |

## 6. Settlements: VIBE pays the merchants

| Result | Check | Detail |
|---|---|---|
| Pass | Finance sees what each merchant is owed | Saffron Courtyard ₹3,937.74, Smash Arena ₹882, Pulse Studio ₹2,645.12, Brew & Bloom Café ₹564.48, Galleria Cinemas ₹493.92 |
| Pass | Pay run: one settlement per merchant that can be paid | Saffron Courtyard ₹3,937.74, Smash Arena ₹882, Pulse Studio ₹2,645.12, Galleria Cinemas ₹493.92 |
| Pass | Pay run: the café without verified KYC is held back with the reason | Brew & Bloom Café: KYC and bank details are submitted. Verify them first. |
| Pass | Finance downloads the bank file (account, IFSC, amount) | 4 rows |
| Pass | Finance marks each one paid with the bank reference (UTR) | ST-261114-QH34 NEFT9890340708, ST-261114-QFQF NEFT2962209991, ST-261114-976H NEFT7617105786, ST-261114-M7Q2 NEFT2735076915 |
| Pass | The merchant sees the settlement as paid, with the bank reference |  |
| Pass | The held café’s payment shows as not settled yet | ₹564.48 |

## 7. Money checks (gateway → escrow → merchants)

| Result | Check | Detail |
|---|---|---|
| Pass | Gateway report: every payment matched to VIBE’s records | 9 lines matched, ₹9,945.61 paid to escrow |
| Pass | Escrow statement: gateway money in and every payout out matched | 5 lines matched |
| Pass | All three money checks agree | escrow by books ₹1,986.83, bank ₹1,986.83 |
| Pass | The accounts balance (trial balance) | debits ₹28,930.78 = credits ₹28,930.78 |

## 8. What the admin sees

| Result | Check | Detail |
|---|---|---|
| Pass | Overview: a card per category with today’s sales | Food & Dining 5 sales ₹5,388, Fitness & Wellness 2 sales ₹4,039, Movies 1 sales ₹560 |
| Pass | To do: the café’s KYC waiting for review is listed | 2 items |
| Pass | Excel: the merchant download has every business | 77 rows |

## Orders placed

| What | Where | Customer | Transaction ID | Paid |
|---|---|---|---|---|
| Dine-in bill (member offer) | Saffron Courtyard | Priya Sharma | VB-RE6Z-2ZZT | ₹1,050 |
| Bill raised by the merchant + VIBE coupon | Saffron Courtyard | Fatima Khan | VB-JUKL-R3SQ | ₹1,100 |
| Court booking (2 slots) | Smash Arena | Rahul Verma | VB-PE3Z-JLE6 | ₹1,020 |
| Gym membership | Pulse Studio | Sneha Iyer | VB-LE2T-VD6P | ₹3,019 |
| Event tickets (2) | Biryani Masterclass (Saffron Courtyard) | Arjun Rao | VB-X8CK-YSEP | ₹1,998 |
| Café bill (KYC not verified yet) | Brew & Bloom Café | Kiran Kumar | VB-2FNM-8HW5 | ₹640 |
| Movie seats (2) | Charminar Heist (Galleria Cinemas) | Priya Sharma | VB-3XUB-Z2XU | ₹560 |
| Social table deposit | Saffron Courtyard | Priya Sharma | VB-8Q26-S8HE | ₹500 |

## Payouts

| Merchant | Settlement | Bank reference | Paid |
|---|---|---|---|
| Saffron Courtyard | ST-261114-QH34 | NEFT9890340708 | ₹3,937.74 |
| Smash Arena | ST-261114-QFQF | NEFT2962209991 | ₹882 |
| Pulse Studio | ST-261114-976H | NEFT7617105786 | ₹2,645.12 |
| Galleria Cinemas | ST-261114-M7Q2 | NEFT2735076915 | ₹493.92 |
