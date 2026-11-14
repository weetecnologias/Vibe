# VIBE end-to-end test report

Run 14/11/2026, 9:52:23 am IST against the dev backend (http://localhost:8090), simulated payment partner.

**63 checks passed, 0 failed.**


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
| Pass | Non-member buys VIBE Membership (₹299/month) and pays | VB-4RXV-H7HT |
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
| Pass | The same Pay tap repeated returns the same payment, not a new one | VB-JU64-CBD6 |
| Pass | The same transaction ID is in the customer’s, the merchant’s and the admin’s records | VB-JU64-CBD6 |
| Pass | Merchant raises a bill from the customer’s VIBE ID; customer applies coupon SAVE100 | pays ₹1,100 |
| Pass | Pay at the counter: the customer shows a code, the merchant confirms it | code 104311 at Dragon Lane |
| Pass | Sports: the customer books two court slots | Badminton · 6–7 AM, 7–8 AM · ₹1,000 |
| Pass | Sports: the venue sees the booking on its day sheet | VBS-562X-ZHXK |
| Pass | Gym: the customer buys a monthly membership | Monthly unlimited · ₹2,999 |
| Pass | Gym: the studio sees the new member | Sneha Iyer |
| Pass | Events: the customer reserves 2 seats | Biryani Masterclass · ₹1,998 |
| Pass | Events: the organiser sees the tickets sold | {"eventId":"eae7c509-1ff0-4bcd-91ce-490276999b79","title":"Biryani Masterclass","startsAt":"2026-11-20T14:30:00Z","statu |
| Pass | Café with KYC waiting can still take a payment | VB-E9XZ-CRCM |
| Note | Movies: films, showtimes and seat booking | NOT BUILT in the backend yet: no films or shows to book. Cinemas are listed and can take bills and offers. |

## 5. Support: disputes and refunds

| Result | Check | Detail |
|---|---|---|
| Pass | Customer raises a dispute on a payment | DSP-JSMSK4 |
| Pass | Support sees both disputes | DSP-JSMSK4, DSP-E943FT |
| Pass | The Food & Dining manager sees only the restaurant’s dispute |  |
| Pass | Support resolves it with a ₹250 refund, borne by the restaurant | refund |
| Pass | Support declines the other with a reason | rejected |
| Pass | Support marks the refund as sent with the partner’s reference | {"reference":"VB-QNFQ-VG72","kind":"redemption","payee":"Saffron Courtyard","cus |
| Pass | The customer is told | Refund sent |
| Pass | The refund comes off what VIBE owes the restaurant | ₹3,746.74 → ₹3,496.74 |

## 6. Settlements: VIBE pays the merchants

| Result | Check | Detail |
|---|---|---|
| Pass | Finance sees what each merchant is owed | Saffron Courtyard ₹3,496.74, Smash Arena ₹882, Pulse Studio ₹2,645.12, Brew & Bloom Café ₹564.48 |
| Pass | Pay run: one settlement per merchant that can be paid | Saffron Courtyard ₹3,496.74, Smash Arena ₹882, Pulse Studio ₹2,645.12 |
| Pass | Pay run: the café without verified KYC is held back with the reason | Brew & Bloom Café: KYC and bank details are submitted. Verify them first. |
| Pass | Finance downloads the bank file (account, IFSC, amount) | 3 rows |
| Pass | Finance marks each one paid with the bank reference (UTR) | ST-261114-9J5E NEFT5652530431, ST-261114-4CW6 NEFT2009641698, ST-261114-CCD3 NEFT4470305227 |
| Pass | The merchant sees the settlement as paid, with the bank reference |  |
| Pass | The held café’s payment shows as not settled yet | ₹564.48 |

## 7. Money checks (gateway → escrow → merchants)

| Result | Check | Detail |
|---|---|---|
| Pass | Gateway report: every payment matched to VIBE’s records | 7 lines matched, ₹8,910.63 paid to escrow |
| Pass | Escrow statement: gateway money in and every payout out matched | 4 lines matched |
| Pass | All three money checks agree | escrow by books ₹1,886.77, bank ₹1,886.77 |
| Pass | The accounts balance (trial balance) | debits ₹25,875.86 = credits ₹25,875.86 |

## 8. What the admin sees

| Result | Check | Detail |
|---|---|---|
| Pass | Overview: a card per category with today’s sales | Food & Dining 4 sales ₹4,888, Fitness & Wellness 2 sales ₹4,039 |
| Pass | To do: the café’s KYC waiting for review is listed | 2 items |
| Pass | Excel: the merchant download has every business | 77 rows |

## Orders placed

| What | Where | Customer | Transaction ID | Paid |
|---|---|---|---|---|
| Dine-in bill (member offer) | Saffron Courtyard | Priya Sharma | VB-JU64-CBD6 | ₹1,050 |
| Bill raised by the merchant + VIBE coupon | Saffron Courtyard | Fatima Khan | VB-QNFQ-VG72 | ₹1,100 |
| Court booking (2 slots) | Smash Arena | Rahul Verma | VB-7TM5-G29W | ₹1,020 |
| Gym membership | Pulse Studio | Sneha Iyer | VB-F83J-4X9V | ₹3,019 |
| Event tickets (2) | Biryani Masterclass (Saffron Courtyard) | Arjun Rao | VB-5QM8-ARUJ | ₹1,998 |
| Café bill (KYC not verified yet) | Brew & Bloom Café | Kiran Kumar | VB-E9XZ-CRCM | ₹640 |

## Payouts

| Merchant | Settlement | Bank reference | Paid |
|---|---|---|---|
| Saffron Courtyard | ST-261114-9J5E | NEFT5652530431 | ₹3,496.74 |
| Smash Arena | ST-261114-4CW6 | NEFT2009641698 | ₹882 |
| Pulse Studio | ST-261114-CCD3 | NEFT4470305227 | ₹2,645.12 |
