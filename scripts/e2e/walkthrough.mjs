#!/usr/bin/env node
/**
 * VIBE end-to-end walkthrough against a running dev backend (dev profile: simulated payment partner, sign-in code 123456).
 * It acts as customers, merchants and VIBE's team through the same API the apps use, checks each step, and writes:
 *   docs/testing/E2E-REPORT.md   what was tested, with every check and the transaction IDs
 *   docs/testing/e2e-results.json the same, for tools
 *   docs/testing/TEST-ACCOUNTS.md every login (development data only)
 * Run:  node scripts/e2e/walkthrough.mjs        (VIBE_API defaults to http://localhost:8090)
 * Start from a fresh dev backend: the seed only runs on an empty database, and some steps (pay runs) change the data.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.VIBE_API ?? 'http://localhost:8090';
const PASSWORD = process.env.VIBE_DEV_PASSWORD ?? 'vibe-dev-only';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/testing');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rupees = (p) => '₹' + (p / 100).toLocaleString('en-IN', { minimumFractionDigits: p % 100 ? 2 : 0, maximumFractionDigits: 2 });

const results = [];
const facts = {}; // things the report quotes (references, amounts)
let section = '';
function check(name, ok, detail = '') {
  results.push({ section, name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${section}] ${name}${detail ? ' — ' + detail : ''}`);
  return !!ok;
}
function note(name, detail) {
  results.push({ section, name, ok: null, detail });
  console.log(`NOTE  [${section}] ${name} — ${detail}`);
}

async function api(method, p, token, body, headers = {}) {
  const res = await fetch(API + p, { method, headers: { 'content-type': 'application/json', ...headers, ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = text;
  try { data = text ? JSON.parse(text) : null; } catch { /* csv or empty */ }
  return { status: res.status, data, text };
}
const ok2 = (r) => r.status >= 200 && r.status < 300;

async function staff(email) {
  const r = await api('POST', '/v1/staff/login', null, { email, password: PASSWORD });
  return ok2(r) ? r.data.token : null;
}
const customerTokens = {};
async function customer(phone) {
  if (customerTokens[phone]) return customerTokens[phone];
  for (let i = 0; i < 4; i++) {
    const c = await api('POST', '/v1/auth/otp', null, { phone });
    if (c.status === 429) { await sleep(31000); continue; }
    const v = await api('POST', '/v1/auth/otp/verify', null, { requestId: c.data.requestId, code: '123456' });
    if (ok2(v)) return (customerTokens[phone] = v.data.accessToken);
  }
  throw new Error('Could not sign in ' + phone);
}
/** Pays a payment request by UPI through the simulated partner and waits for VIBE to confirm it. Returns the transaction ID. */
async function pay(token, prId) {
  const key = 'e2e-' + Math.random().toString(36).slice(2);
  const p = await api('POST', `/v1/payment-requests/${prId}/payments`, token, { method: 'upi' }, { 'Idempotency-Key': key });
  if (!ok2(p)) throw new Error('payment start ' + p.status + ' ' + p.text);
  for (let i = 0; i < 40; i++) {
    const v = await api('GET', `/v1/payments/${p.data.reference}`, token);
    if (v.data?.status === 'verified') return { reference: p.data.reference, key, amount: v.data.amount };
    await sleep(1500);
  }
  throw new Error('payment not confirmed ' + p.data.reference);
}
const tomorrow = () => { const d = new Date(Date.now() + 330 * 60000 + 86400000); return d.toISOString().slice(0, 10); };
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

async function main() {
  const health = await api('GET', '/actuator/health');
  if (!ok2(health)) throw new Error('Backend not running at ' + API);

  // ------------------------------------------------------------------ accounts
  section = '1. Accounts and roles';
  const admin = await staff('admin@vibe.local');
  check('Super admin signs in', admin);
  const logins = (await api('GET', '/v1/admin/staff', admin)).data;
  const merchants = (await api('GET', '/v1/admin/merchants?limit=500', admin)).data.rows;
  const byBiz = Object.fromEntries(merchants.map((m) => [m.id, m]));
  const owners = logins.filter((l) => l.role === 'MERCHANT' && l.active);
  let signedIn = 0;
  for (const l of owners) if (await staff(l.email)) signedIn++;
  check('Every merchant login signs in', signedIn === owners.length, `${signedIn} of ${owners.length} logins`);
  const withLogin = new Set(owners.filter((o) => o.owner).map((o) => o.businessId));
  check('Every business has an owner login', merchants.every((m) => withLogin.has(m.id)), `${withLogin.size} businesses, ${merchants.length} listed`);
  const cats = (await api('GET', '/v1/admin/merchants/categories', admin)).data;
  facts.categories = cats.rows.map((c) => ({ name: c.name, merchants: c.merchants, verified: c.kycVerified }));
  check('Merchants are grouped by category', cats.rows.length >= 7, cats.rows.map((c) => `${c.name} ${c.merchants}`).join(', '));
  const team = (await api('GET', '/v1/admin/team', admin)).data;
  const tokens = {};
  for (const t of team) tokens[t.email] = await staff(t.email);
  check('Every VIBE team login signs in', team.every((t) => tokens[t.email]), team.map((t) => `${t.email} (${t.role})`).join(', '));
  const fin = tokens['finance@vibe.local'], sup = tokens['support@vibe.local'], food = tokens['food-manager@vibe.local'], ceo = tokens['ceo@vibe.local'];
  check('CEO (admin) sees everything, including the VIBE team page', (await api('GET', '/v1/admin/team', ceo)).status === 200);
  check('Finance opens money checks', (await api('GET', '/v1/admin/escrow/overview', fin)).status === 200);
  check('Finance can’t manage the VIBE team', (await api('GET', '/v1/admin/team', fin)).status === 403);
  check('Support opens disputes', (await api('GET', '/v1/admin/disputes', sup)).status === 200);
  check('Support can’t change categories', (await api('GET', '/v1/admin/categories', sup)).status === 403);
  const foodMerchants = (await api('GET', '/v1/admin/merchants?limit=500', food)).data.rows;
  check('Food & Dining manager sees only Food & Dining businesses', foodMerchants.length > 0 && foodMerchants.every((m) => m.topCategory === 'Food & Dining'), `${foodMerchants.length} businesses`);
  check('Category managers don’t get the money checks', (await api('GET', '/v1/admin/escrow/overview', food)).status === 403);
  const saffronLogin = await staff('merchant@vibe.local');
  check('A merchant can’t open the admin API', (await api('GET', '/v1/admin/merchants', saffronLogin)).status === 403);
  check('An admin can’t use the merchant API', (await api('GET', '/v1/merchant/bills', admin)).status === 403);

  // ------------------------------------------------------------------ commission
  section = '2. Commission set by VIBE';
  const rc = await api('POST', '/v1/admin/rate-cards', admin, { scope: 'platform', targetId: null, commissionBps: 1000, effectiveFrom: null, reason: 'End-to-end test: 10% platform commission' });
  check('Admin sets a 10% platform commission (rate card)', ok2(rc), rc.status === 201 || rc.status === 200 ? '' : rc.text);
  const gstSet = await api('PUT', '/v1/admin/rate-cards/tax', admin, { commissionGstBps: 1800 });
  check('Admin sets GST on commission to 18%', ok2(gstSet), gstSet.text.slice(0, 80));
  const tax = (await api('GET', '/v1/admin/rate-cards/tax', admin)).data;
  facts.gstBps = tax?.commissionGstBps;
  note('GST on commission', `${(tax?.commissionGstBps ?? 0) / 100}%`);

  // ------------------------------------------------------------------ customers and membership
  section = '3. Customers and VIBE Membership';
  const people = { priya: '9000000101', rahul: '9000000102', sneha: '9000000103', arjun: '9000000104', fatima: '9000000105', kiran: '9000000106', ananya: '9000000107' };
  const c = {};
  for (const [k, phone] of Object.entries(people)) c[k] = await customer(phone);
  const me = {};
  for (const k of Object.keys(people)) me[k] = (await api('GET', '/v1/me', c[k])).data;
  check('Members show as members', me.priya.isMember && me.rahul.isMember && me.sneha.isMember);
  check('Non-members show as not members', !me.arjun.isMember && !me.fatima.isMember && !me.kiran.isMember);
  check('A lapsed membership shows as not a member', !me.ananya.isMember);
  const before = (await api('GET', '/v1/admin/membership/summary', admin)).data;
  const saffron = merchants.find((m) => m.name === 'Saffron Courtyard');
  const saffronDetail = (await api('GET', `/v1/businesses/${saffron.id}`, c.priya)).data;
  const memberOffer = (saffronDetail.offers ?? []).find((o) => o.memberOnly);
  const eMember = (await api('GET', `/v1/offers/${memberOffer.id}/eligibility`, c.priya)).data;
  const eNon = (await api('GET', `/v1/offers/${memberOffer.id}/eligibility`, c.arjun)).data;
  check('Member can use the member-only offer', eMember.eligible === true, memberOffer.title);
  check('Non-member is told it’s for members', eNon.eligible === false, eNon.reason ?? '');
  const plans = (await api('GET', '/v1/membership/plans', c.arjun)).data;
  const sub = await api('POST', '/v1/membership/subscriptions', c.arjun, { planId: plans[0].id });
  const mPay = await pay(c.arjun, sub.data.paymentRequestId ?? sub.data.id);
  facts.membershipPayment = mPay.reference;
  check('Non-member buys VIBE Membership (₹299/month) and pays', (await api('GET', '/v1/me', c.arjun)).data.isMember === true, mPay.reference);
  const after = (await api('GET', '/v1/admin/membership/summary', admin)).data;
  check('Admin sees the new member and the fee as VIBE’s income', after.membersNow === before.membersNow + 1 && after.feesInPeriod === before.feesInPeriod + plans[0].price,
    `members ${before.membersNow} → ${after.membersNow}, fees ${rupees(before.feesInPeriod)} → ${rupees(after.feesInPeriod)}`);
  facts.membership = after;
  const notMembers = (await api('GET', '/v1/admin/customers?membership=never&limit=50', admin)).data;
  check('Admin lists customers who registered but never took membership', notMembers.items.some((x) => x.vibeId === me.fatima.vibeId), `${notMembers.total} customers`);

  // ------------------------------------------------------------------ orders
  section = '4. Orders, payments and the merchant side';
  const orders = [];
  // 4a. Dine-in: the customer asks for the bill with the member offer, the merchant sends it, the customer pays.
  const red = await api('POST', '/v1/redemptions', c.priya, { offerId: memberOffer.id });
  const board1 = (await api('GET', '/v1/merchant/bills?view=open', saffronLogin)).data;
  check('Dine-in: the merchant sees the customer waiting for the bill', board1.rows.some((r) => r.id === red.data.id), `${me.priya.name} · VIBE ID ${me.priya.vibeId}`);
  const sent = await api('POST', `/v1/merchant/bills/${red.data.id}`, saffronLogin, { lines: [{ label: 'Dinner for two', amount: 150000 }] });
  check('Dine-in: the merchant sends a ₹1,500 bill', sent.status === 201, sent.status === 201 ? '' : sent.text);
  const notif = (await api('GET', '/v1/me/notifications?unread=true', c.priya)).data;
  check('Dine-in: the customer is notified the bill is ready', notif.some((n) => n.kind === 'bill_ready'), notif[0]?.title ?? '');
  const redNow = (await api('GET', `/v1/redemptions/${red.data.id}`, c.priya)).data;
  check('Dine-in: the member offer (30%) is on the bill', redNow.paymentRequest.discount === 45000, `discount ${rupees(redNow.paymentRequest.discount)}, pays ${rupees(redNow.paymentRequest.payable)}`);
  const p1 = await pay(c.priya, redNow.paymentRequest.id);
  orders.push({ what: 'Dine-in bill (member offer)', where: 'Saffron Courtyard', who: me.priya.name, ref: p1.reference, amount: p1.amount });
  const board2 = (await api('GET', '/v1/merchant/bills?view=today', saffronLogin)).data;
  check('Dine-in: the merchant sees it paid', board2.rows.some((r) => r.id === red.data.id && r.status === 'paid'));
  // Duplicate payment protection
  const again = await api('POST', `/v1/payment-requests/${redNow.paymentRequest.id}/payments`, c.priya, { method: 'upi' }, { 'Idempotency-Key': 'another-' + Math.random() });
  check('A second payment for the same bill is refused', again.status === 409, again.data?.code ?? '');
  const same = await api('POST', `/v1/payment-requests/${redNow.paymentRequest.id}/payments`, c.priya, { method: 'upi' }, { 'Idempotency-Key': p1.key });
  check('The same Pay tap repeated returns the same payment, not a new one', ok2(same) && same.data.reference === p1.reference, same.data?.reference ?? same.text);
  // One transaction ID everywhere
  const adminTx = (await api('GET', `/v1/admin/transactions?q=${p1.reference}`, admin)).data;
  const merchantPays = (await api('GET', `/v1/admin/merchants/${saffron.id}/payments`, admin)).data;
  check('The same transaction ID is in the customer’s, the merchant’s and the admin’s records', adminTx.items?.[0]?.reference === p1.reference && merchantPays.rows.some((r) => r.reference === p1.reference), p1.reference);

  // 4b. The merchant raises a bill from a VIBE ID; the customer applies a VIBE coupon.
  const start = await api('POST', '/v1/merchant/bills/start', saffronLogin, { vibeId: me.fatima.vibeId, offerId: null });
  await api('POST', `/v1/merchant/bills/${start.data.id}`, saffronLogin, { lines: [{ label: 'Lunch', amount: 120000 }], offerId: 'none' });
  const fr = (await api('GET', `/v1/redemptions/${start.data.id}`, c.fatima)).data;
  const coupon = await api('POST', `/v1/payment-requests/${fr.paymentRequest.id}/offer`, c.fatima, { code: 'SAVE100' });
  check('Merchant raises a bill from the customer’s VIBE ID; customer applies coupon SAVE100', ok2(coupon) && coupon.data.discount === 10000, `pays ${rupees(coupon.data?.payable ?? 0)}`);
  const p2 = await pay(c.fatima, fr.paymentRequest.id);
  orders.push({ what: 'Bill raised by the merchant + VIBE coupon', where: 'Saffron Courtyard', who: me.fatima.name, ref: p2.reference, amount: p2.amount });
  facts.disputedPayment = p2.reference;

  // 4c. Pay at the counter with a code (no money through VIBE).
  const dragon = merchants.find((m) => m.name === 'Dragon Lane');
  const dragonOffer = ((await api('GET', `/v1/businesses/${dragon.id}`, c.kiran)).data.offers ?? []).find((o) => !o.memberOnly);
  if (dragonOffer) {
    const codeRed = await api('POST', '/v1/redemptions', c.kiran, { offerId: dragonOffer.id, mode: 'code' });
    const dragonLogin = await staff('dragon.lane@vibe.local');
    const chk = await api('POST', '/v1/merchant/bills/codes/check', dragonLogin, { code: codeRed.data.code, billAmount: 80000 });
    const rid = chk.data?.redemptionId ?? chk.data?.id ?? codeRed.data.id;
    const done = await api('POST', `/v1/merchant/bills/${rid}/redeem`, dragonLogin, { billAmount: 80000 });
    check('Pay at the counter: the customer shows a code, the merchant confirms it', ok2(chk) && ok2(done), `code ${codeRed.data.code} at Dragon Lane`);
  } else note('Pay at the counter', 'Dragon Lane has no public offer in the seed');

  // 4d. Sports: book two court slots.
  const smash = merchants.find((m) => m.name === 'Smash Arena');
  const sports = (await api('GET', `/v1/businesses/${smash.id}/sports`, c.rahul)).data;
  const sport = sports[0]?.sport ?? sports[0]?.name ?? sports[0]?.id;
  const grid = (await api('GET', `/v1/businesses/${smash.id}/slots?sport=${encodeURIComponent(sport)}&date=${tomorrow()}`, c.rahul)).data;
  const free = grid.slots.filter((s) => s.available && s.options.some((o) => o.available)).slice(0, 2);
  const book = await api('POST', '/v1/slot-bookings', c.rahul, { businessId: smash.id, items: free.map((s) => ({ resourceId: s.options.find((o) => o.available).resourceId, startsAt: s.startsAt, minutes: grid.minutes })) });
  check('Sports: the customer books two court slots', book.status === 201, `${sport} · ${free.map((s) => s.label).join(', ')} · ${rupees(book.data?.total ?? 0)}`);
  const p3 = await pay(c.rahul, book.data.paymentRequestId);
  orders.push({ what: 'Court booking (2 slots)', where: 'Smash Arena', who: me.rahul.name, ref: p3.reference, amount: p3.amount });
  const sportsLogin = await staff('sports@vibe.local');
  const day = (await api('GET', `/v1/merchant/venue/day?date=${tomorrow()}`, sportsLogin)).data;
  check('Sports: the venue sees the booking on its day sheet', JSON.stringify(day).includes(book.data.bookingRef), book.data.bookingRef);
  facts.slotPayment = p3.reference;

  // 4e. Gym membership at a venue.
  const pulse = merchants.find((m) => m.name === 'Pulse Studio');
  const vplans = (await api('GET', `/v1/businesses/${pulse.id}/plans`, c.sneha)).data;
  const pass = await api('POST', '/v1/venue-passes', c.sneha, { planId: vplans[0].id, startsOn: today() });
  check('Gym: the customer buys a monthly membership', pass.status === 201, `${vplans[0].name} · ${rupees(vplans[0].price)}`);
  const p4 = await pay(c.sneha, pass.data.paymentRequestId);
  orders.push({ what: 'Gym membership', where: 'Pulse Studio', who: me.sneha.name, ref: p4.reference, amount: p4.amount });
  const gymLogin = await staff('gym@vibe.local');
  const members = (await api('GET', '/v1/merchant/venue/members', gymLogin)).data;
  check('Gym: the studio sees the new member', JSON.stringify(members).includes(me.sneha.vibeId) || JSON.stringify(members).includes(me.sneha.name.split(' ')[0]), me.sneha.name);

  // 4f. Event tickets.
  const evs = (await api('GET', '/v1/events', c.arjun)).data;
  const evList = Array.isArray(evs) ? evs : evs.items ?? [];
  const masterclass = evList.find((e) => /Biryani/.test(e.title));
  const ev = (await api('GET', `/v1/events/${masterclass.id}`, c.arjun)).data;
  const tt = ev.ticketTypes[0];
  const rsv = await api('POST', `/v1/events/${masterclass.id}/reservations`, c.arjun, { items: [{ ticketTypeId: tt.id, quantity: 2 }], attendees: ['Arjun Rao', 'Guest'] });
  check('Events: the customer reserves 2 seats', rsv.status === 201, `${ev.title} · ${rupees(rsv.data?.total ?? 0)}`);
  const p5 = await pay(c.arjun, rsv.data.paymentRequestId);
  orders.push({ what: 'Event tickets (2)', where: `${ev.title} (Saffron Courtyard)`, who: me.arjun.name, ref: p5.reference, amount: p5.amount });
  const sales = (await api('GET', `/v1/merchant/events/${masterclass.id}/sales`, saffronLogin)).data;
  check('Events: the organiser sees the tickets sold', JSON.stringify(sales).includes('Arjun'), JSON.stringify(sales).slice(0, 120));

  // 4g. A café whose KYC isn't verified yet sells something: its payout must wait.
  const brewLogin = await staff('brew.and.bloom.cafe@vibe.local');
  const bs = await api('POST', '/v1/merchant/bills/start', brewLogin, { vibeId: me.kiran.vibeId, offerId: null });
  await api('POST', `/v1/merchant/bills/${bs.data.id}`, brewLogin, { lines: [{ label: 'Coffee and cake', amount: 64000 }], offerId: 'none' });
  const kr = (await api('GET', `/v1/redemptions/${bs.data.id}`, c.kiran)).data;
  const p6 = await pay(c.kiran, kr.paymentRequest.id);
  orders.push({ what: 'Café bill (KYC not verified yet)', where: 'Brew & Bloom Café', who: me.kiran.name, ref: p6.reference, amount: p6.amount });
  check('Café with KYC waiting can still take a payment', !!p6.reference, p6.reference);

  // 4h. Movies: a film, the cinemas showing it tomorrow, seats, payment, QR tickets and the door.
  const movieList = (await api('GET', '/v1/movies?status=now_showing', c.priya)).data;
  check('Movies: films are listed', movieList.length >= 3, movieList.map((m) => m.title).join(', '));
  const film = movieList.find((m) => m.title === 'Charminar Heist') ?? movieList[0];
  const cinemas = (await api('GET', `/v1/movies/${film.id}/showtimes?date=${tomorrow()}`, c.priya)).data;
  check('Movies: the cinemas showing it tomorrow, with times', cinemas.length > 0 && cinemas[0].shows.length > 0, cinemas.map((x) => `${x.cinema.name} ${x.shows.length} shows`).join(', '));
  const showId = cinemas[0].shows[0].id;
  const seatMap = (await api('GET', `/v1/shows/${showId}/seats`, c.priya)).data;
  const freeSeats = seatMap.rows.filter((r) => r.classId === 'prime').flatMap((r) => r.seats).filter((x) => x && x.status === 'available').slice(0, 2).map((x) => x.id);
  const mh = await api('POST', `/v1/shows/${showId}/holds`, c.priya, { seatIds: freeSeats });
  check('Movies: two Prime seats held while paying', mh.status === 201, `${film.title} · ${freeSeats.join(', ')} · ${rupees(mh.data?.total ?? 0)}`);
  const taken = await api('POST', `/v1/shows/${showId}/holds`, c.rahul, { seatIds: [freeSeats[0]] });
  check('Movies: someone else can’t take a held seat', taken.status === 409, taken.data?.code ?? '');
  const p7 = await pay(c.priya, mh.data.paymentRequestId);
  orders.push({ what: 'Movie seats (2)', where: `${film.title} (${cinemas[0].cinema.name})`, who: me.priya.name, ref: p7.reference, amount: p7.amount });
  const mp = (await api('GET', `/v1/payments/${p7.reference}`, c.priya)).data;
  const mt = (await api('GET', `/v1/tickets/${mp.ticketIds[0]}`, c.priya)).data;
  check('Movies: one QR ticket per seat', mp.ticketIds.length === 2 && !!mt.qrToken, `seat ${mt.seatLabel} · ${mt.venue} · code ${mt.admissionCode}`);
  const cinemaLogin = await staff(cinemas[0].cinema.name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '') + '@vibe.local');
  const cshows = (await api('GET', `/v1/merchant/cinema/shows?from=${tomorrow()}&days=1`, cinemaLogin)).data;
  check('Movies: the cinema sees the seats sold', cshows?.some?.((x) => x.id === showId && x.sold >= 2), (cshows ?? []).filter((x) => x.sold).map((x) => `${x.movieTitle} ${x.sold} sold`).join(', '));
  const door = (await api('POST', '/v1/merchant/cinema/check-in', cinemaLogin, { code: mt.admissionCode })).data;
  check('Movies: the door won’t let a ticket in a day early', door?.result === 'too_early', door?.message ?? '');

  // 4i. Social: a one-on-one at a café books a table first.
  const tmrw7 = new Date(`${tomorrow()}T19:00:00+05:30`).toISOString();
  const venuesForCoffee = (await api('GET', '/v1/social/venues?kind=food', c.priya)).data;
  const saffronVenue = venuesForCoffee.find((v) => v.name === 'Saffron Courtyard');
  check('Social: venues that take reservations, with their deposit', !!saffronVenue, venuesForCoffee.map((v) => `${v.name} ${rupees(v.deposit)}`).join(', '));
  const plan = await api('POST', '/v1/social/one-on-ones', c.priya, { kind: 'food', activity: 'Dinner for two', venueBusinessId: saffronVenue.businessId, startsAt: tmrw7, openTo: 'men', payMode: 'full' });
  check('Social: a new plan is a draft until the deposit is paid', plan.status === 201 && plan.data.status === 'draft', `${plan.data?.status} · pay ${rupees(plan.data?.myPayment?.amount ?? 0)}`);
  const hidden = (await api('GET', '/v1/social/one-on-ones', c.rahul)).data;
  check('Social: nobody else sees a draft', !hidden.some((x) => x.id === plan.data.id));
  const p8 = await pay(c.priya, plan.data.myPayment.paymentRequestId);
  orders.push({ what: 'Social table deposit', where: 'Saffron Courtyard', who: me.priya.name, ref: p8.reference, amount: p8.amount });
  const seen = (await api('GET', '/v1/social/one-on-ones', c.rahul)).data.find((x) => x.id === plan.data.id);
  check('Social: paid, the plan is live for people it suits', seen?.status === 'open', seen ? `${seen.activity} · ${seen.costNote}` : 'not visible');
  await api('POST', `/v1/social/one-on-ones/${plan.data.id}/requests`, c.rahul);
  const rahulMember = (await api('GET', '/v1/social/profile', c.rahul)).data.memberId;
  const acc = (await api('POST', `/v1/social/one-on-ones/${plan.data.id}/requests/${rahulMember}/respond`, c.priya, { accept: true })).data;
  check('Social: accepted, the table is booked', acc.status === 'matched' && acc.reservation?.title?.includes('booked'), `${acc.reservation?.title} · ref ${acc.reservation?.reference} · free cancellation until ${new Date(acc.cancelBy).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' })}`);
  const resv = (await api('GET', `/v1/merchant/reservations?day=${tomorrow()}`, saffronLogin)).data;
  check('Social: the restaurant sees the booking for two', resv.some((r) => r.reference === acc.reservation.reference && r.status === 'confirmed'), resv.map((r) => `${r.reference} ${r.guests} ${r.status}`).join(', '));
  const mon = (await api('GET', `/v1/admin/social/meetups?q=${me.priya.vibeId}`, admin)).data;
  check('Social: VIBE’s monitor shows who booked, VIBE IDs and the transaction ID', mon.rows.some((r) => r.hostPayment === p8.reference && r.partner?.vibeId === me.rahul.vibeId), `${mon.rows[0]?.reference} · ${mon.rows[0]?.host.name} (${mon.rows[0]?.host.vibeId}) with ${mon.rows[0]?.partner?.name} · ${mon.rows[0]?.hostPayment}`);
  const hosts = (await api('GET', '/v1/admin/social/hosts?status=pending', admin)).data;
  check('Social: host applications wait for a VIBE check', hosts.some((h) => h.person.vibeId === me.rahul.vibeId), hosts.map((h) => `${h.person.name} ${h.idType} ····${h.idLast4}`).join(', '));
  check('Social: category managers can’t open Social', (await api('GET', '/v1/admin/social/overview', food)).status === 403);
  facts.orders = orders;

  // ------------------------------------------------------------------ support
  section = '5. Support: disputes and refunds';
  const d1 = await api('POST', `/v1/payments/${p2.reference}/dispute`, c.fatima, { reason: 'wrong_amount', details: 'I was charged for a dessert we did not order.' });
  check('Customer raises a dispute on a payment', d1.status === 201 || d1.status === 200, d1.data?.reference ?? d1.text);
  const d2 = await api('POST', `/v1/payments/${p3.reference}/dispute`, c.rahul, { reason: 'poor_service', details: 'The court lights were dim.' });
  const supList = (await api('GET', '/v1/admin/disputes', sup)).data;
  const supRows = Array.isArray(supList) ? supList : supList.items ?? supList.rows ?? [];
  check('Support sees both disputes', supRows.some((r) => r.reference === d1.data.reference) && supRows.some((r) => r.reference === d2.data.reference), `${d1.data.reference}, ${d2.data.reference}`);
  const foodList = (await api('GET', '/v1/admin/disputes', food)).data;
  const foodRows = Array.isArray(foodList) ? foodList : foodList.items ?? foodList.rows ?? [];
  check('The Food & Dining manager sees only the restaurant’s dispute', foodRows.some((r) => r.reference === d1.data.reference) && !foodRows.some((r) => r.reference === d2.data.reference));
  const saffronBefore = (await api('GET', '/v1/admin/balances', admin)).data.rows.find((r) => r.id === saffron.id);
  const res1 = await api('POST', `/v1/admin/disputes/${d1.data.reference}/resolve`, sup, { outcome: 'refund', amount: 25000, bearer: 'merchant', note: 'Dessert not ordered; the restaurant agreed.' });
  check('Support resolves it with a ₹250 refund, borne by the restaurant', ok2(res1), res1.data?.status ?? res1.text);
  const res2 = await api('POST', `/v1/admin/disputes/${d2.data.reference}/resolve`, sup, { outcome: 'reject', note: 'Lights checked and working; booking was used in full.' });
  check('Support declines the other with a reason', ok2(res2), res2.data?.status ?? res2.text);
  const done = await api('POST', `/v1/admin/refunds/${p2.reference}/done`, sup, { partnerReference: 'RFND' + Date.now() });
  check('Support marks the refund as sent with the partner’s reference', ok2(done), done.text.slice(0, 80));
  const fn = (await api('GET', '/v1/me/notifications', c.fatima)).data;
  check('The customer is told', fn.some((n) => /refund/i.test(n.title + n.body)), fn.find((n) => /refund/i.test(n.title + n.body))?.title ?? '');
  const saffronAfter = (await api('GET', '/v1/admin/balances', admin)).data.rows.find((r) => r.id === saffron.id);
  check('The refund comes off what VIBE owes the restaurant', saffronAfter.owed === saffronBefore.owed - 25000, `${rupees(saffronBefore.owed)} → ${rupees(saffronAfter.owed)}`);
  facts.disputes = [d1.data.reference, d2.data.reference];

  // ------------------------------------------------------------------ settlements
  section = '6. Settlements: VIBE pays the merchants';
  const due = (await api('GET', '/v1/admin/settlements/due', fin)).data;
  facts.due = due.map((d) => ({ name: d.businessName, payments: d.count, gross: d.gross, fees: d.vibeFees, commission: d.commission, gst: d.gst, refunds: d.refundDeductions, payout: d.payout, kyc: d.kycStatus }));
  check('Finance sees what each merchant is owed', due.length >= 4, due.map((d) => `${d.businessName} ${rupees(d.payout)}`).join(', '));
  const run = (await api('POST', '/v1/admin/settlements/run', fin, {})).data;
  check('Pay run: one settlement per merchant that can be paid', run.created.length >= 3, run.created.map((s) => `${s.businessName} ${rupees(s.payout)}`).join(', '));
  check('Pay run: the café without verified KYC is held back with the reason', run.held.some((h) => h.businessName === 'Brew & Bloom Café' && /KYC/.test(h.reason)), run.held.map((h) => `${h.businessName}: ${h.reason}`).join('; '));
  facts.payRun = run;
  const bank = await api('GET', '/v1/admin/settlements/bank-file.csv', fin);
  check('Finance downloads the bank file (account, IFSC, amount)', bank.status === 200 && bank.text.includes('IFSC'), `${bank.text.trim().split('\n').length - 3} rows`);
  const utrs = [];
  for (const s of run.created) {
    const utr = 'NEFT' + Math.floor(Math.random() * 1e10);
    const r = await api('POST', `/v1/admin/settlements/${s.id}/paid`, fin, { payoutRef: utr });
    if (ok2(r)) utrs.push({ name: s.businessName, ref: s.reference, utr, amount: s.payout });
  }
  check('Finance marks each one paid with the bank reference (UTR)', utrs.length === run.created.length, utrs.map((u) => `${u.ref} ${u.utr}`).join(', '));
  facts.payouts = utrs;
  const ms = (await api('GET', '/v1/merchant/settlements', saffronLogin)).data;
  check('The merchant sees the settlement as paid, with the bank reference', JSON.stringify(ms).includes(utrs.find((u) => u.name === 'Saffron Courtyard')?.utr ?? '-'));
  const brewPays = (await api('GET', `/v1/admin/merchants/${merchants.find((m) => m.name === 'Brew & Bloom Café').id}/payments`, admin)).data;
  check('The held café’s payment shows as not settled yet', brewPays.notSettled === 1, rupees(brewPays.notSettledAmount));

  // ------------------------------------------------------------------ money checks
  section = '7. Money checks (gateway → escrow → merchants)';
  const gw = await api('GET', '/v1/admin/dev/sample-gateway-report.csv', admin);
  const gi = (await api('POST', '/v1/admin/escrow/gateway-report', fin, { fileName: 'gateway-report.csv', csv: gw.text })).data;
  check('Gateway report: every payment matched to VIBE’s records', gi.problems === 0 && gi.matched >= orders.length, `${gi.matched} lines matched, ${rupees(gi.net)} paid to escrow`);
  const st = await api('GET', '/v1/admin/dev/sample-bank-statement.csv', admin);
  const bi = (await api('POST', '/v1/admin/escrow/bank-statement', fin, { fileName: 'escrow-statement.csv', csv: st.text })).data;
  check('Escrow statement: gateway money in and every payout out matched', bi.unmatched === 0 && bi.matched === 1 + utrs.length, `${bi.matched} lines matched`);
  const ov = (await api('GET', '/v1/admin/escrow/overview', fin)).data;
  check('All three money checks agree', ov.payoutsAwaitingBank === 0 && ov.merchantPayoutsNotInBank === 0 && ov.gatewayLineProblems === 0, `escrow by books ${rupees(ov.escrowBooks)}, bank ${rupees(ov.escrowBank ?? 0)}`);
  facts.escrow = ov;
  const tb = (await api('GET', '/v1/admin/ledger/trial-balance', admin)).data;
  check('The accounts balance (trial balance)', tb.balanced === true, `debits ${rupees(tb.debit)} = credits ${rupees(tb.credit)}`);

  // ------------------------------------------------------------------ overviews
  section = '8. What the admin sees';
  const wo = (await api('GET', '/v1/admin/workspaces/overview', admin)).data;
  facts.overview = wo.cards.map((x) => ({ name: x.name, sales: x.sales, collected: x.collected, toSettle: x.toSettle, waiting: x.waiting }));
  check('Overview: a card per category with today’s sales', wo.cards.find((x) => x.name === 'Food & Dining')?.sales >= 3, wo.cards.filter((x) => x.sales).map((x) => `${x.name} ${x.sales} sales ${rupees(x.collected)}`).join(', '));
  const todo = (await api('GET', '/v1/admin/todo', admin)).data;
  check('To do: the café’s KYC waiting for review is listed', todo.items.some((i) => i.type === 'kyc' && /Brew/.test(i.title)), `${todo.items.length} items`);
  const xl = await api('GET', '/v1/admin/merchants.csv', admin);
  check('Excel: the merchant download has every business', xl.status === 200 && xl.text.trim().split('\n').length - 1 === merchants.length, `${xl.text.trim().split('\n').length - 1} rows`);

  // ------------------------------------------------------------------ write out
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'e2e-results.json'), JSON.stringify({ ranAt: new Date().toISOString(), api: API, results, facts }, null, 2));
  writeReport();
  writeAccounts(logins, team, byBiz, me);
  const failed = results.filter((r) => r.ok === false);
  console.log(`\n${results.filter((r) => r.ok).length} passed, ${failed.length} failed, ${results.filter((r) => r.ok === null).length} notes`);
  process.exitCode = failed.length ? 1 : 0;
}

function writeReport() {
  const passed = results.filter((r) => r.ok).length, failed = results.filter((r) => r.ok === false).length;
  let md = `# VIBE end-to-end test report\n\nRun ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST against the dev backend (${API}), simulated payment partner.\n\n**${passed} checks passed, ${failed} failed.**\n\n`;
  let cur = '';
  for (const r of results) {
    if (r.section !== cur) { cur = r.section; md += `\n## ${cur}\n\n| Result | Check | Detail |\n|---|---|---|\n`; }
    md += `| ${r.ok === null ? 'Note' : r.ok ? 'Pass' : '**FAIL**'} | ${r.name} | ${String(r.detail).replace(/\|/g, '/')} |\n`;
  }
  md += `\n## Orders placed\n\n| What | Where | Customer | Transaction ID | Paid |\n|---|---|---|---|---|\n`;
  for (const o of facts.orders ?? []) md += `| ${o.what} | ${o.where} | ${o.who} | ${o.ref} | ${rupees(o.amount)} |\n`;
  md += `\n## Payouts\n\n| Merchant | Settlement | Bank reference | Paid |\n|---|---|---|---|\n`;
  for (const p of facts.payouts ?? []) md += `| ${p.name} | ${p.ref} | ${p.utr} | ${rupees(p.amount)} |\n`;
  fs.writeFileSync(path.join(OUT, 'E2E-REPORT.md'), md);
}

function writeAccounts(logins, team, byBiz, me) {
  let md = `# VIBE test accounts (development only)\n\nEvery password: \`${PASSWORD}\`. Customers sign in with their phone number and the code \`123456\`. These exist only in the local dev database (created by the dev seed) and must never be used on a live system.\n\n`;
  md += `## Admin dashboard (http://localhost:5180)\n\n| Login | Role | Can open |\n|---|---|---|\n`;
  for (const t of team) md += `| ${t.email} | ${t.role === 'super_admin' ? 'Super admin' : t.role === 'admin' ? 'Admin (CEO)' : 'Staff'} | ${t.role !== 'staff' ? 'Everything' : t.areas.join(', ') + (t.categories?.length ? ' · only ' + t.categories.map((c) => c.name).join(', ') : '')} |\n`;
  md += `\n## Merchant dashboard (http://localhost:5181)\n\n| Login | Business | Category | KYC |\n|---|---|---|---|\n`;
  const rows = logins.filter((l) => l.role === 'MERCHANT').map((l) => ({ l, b: byBiz[l.businessId] })).sort((a, b) => ((a.b?.topCategory ?? '') + (a.b?.category ?? '') + (a.b?.name ?? '')).localeCompare((b.b?.topCategory ?? '') + (b.b?.category ?? '') + (b.b?.name ?? '')));
  for (const { l, b } of rows) md += `| ${l.email}${l.owner ? '' : ' (staff)'} | ${b?.name ?? ''} | ${b ? (b.topCategory === b.category ? b.category : b.topCategory + ' › ' + b.category) : ''} | ${b?.kycStatus === 'verified' ? 'Verified' : b?.kycStatus === 'submitted' ? 'Waiting for VIBE' : 'Not sent'} |\n`;
  md += `\n## Customer app (http://localhost:8083, live mode)\n\n| Phone | Name | VIBE ID | Membership |\n|---|---|---|---|\n| 9876543210 | Aarav Reddy | 482173 | Member (monthly) |\n`;
  const labels = { priya: 'Member (monthly)', rahul: 'Member (yearly)', sneha: 'Member (monthly)', arjun: 'Not a member at the start; buys monthly in the test', fatima: 'Not a member', kiran: 'Not a member', ananya: 'Membership ended (lapsed)' };
  const phones = { priya: '9000000101', rahul: '9000000102', sneha: '9000000103', arjun: '9000000104', fatima: '9000000105', kiran: '9000000106', ananya: '9000000107' };
  for (const k of Object.keys(labels)) md += `| ${phones[k]} | ${me[k]?.name ?? ''} | ${me[k]?.vibeId ?? ''} | ${labels[k]} |\n`;
  fs.writeFileSync(path.join(OUT, 'TEST-ACCOUNTS.md'), md);
}

main().catch((e) => { console.error('STOPPED:', e.message); fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'e2e-results.json'), JSON.stringify({ error: e.message, results, facts }, null, 2)); process.exitCode = 2; });
