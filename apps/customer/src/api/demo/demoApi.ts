/**
 * DEMO adapter — an in-memory stand-in for the VIBE backend so the app can be
 * developed before the Spring Boot API exists. It behaves like the server will:
 * OTP challenges, server-side offer pricing, payment verification that arrives
 * asynchronously (like a signed webhook), ticket inventory holds that prevent
 * overselling, and one-time side effects on verification.
 *
 * It is NOT a payment integration and must never be enabled in production.
 */
import { ApiError, type VibeApi } from '../client';
import type {
  BusinessDetail, BusinessSummary, EventDetail, EventSummary, ID, MemberCard, Membership, OfferSummary, OneOnOneInvite, Payment,
  PaymentMethod, PaymentRequest, Redemption, SocialActivity, SocialProfile, Ticket, TicketReservation, User,
} from '../types';
import * as C from './catalog';
import * as D from './data';
import { img } from './images';
import { AGE_BANDS, canMeet } from './matching';
import { quote } from './pricing';
import * as S from './social';

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

export type DemoOptions = {
  /** Artificial network latency in ms. */
  latency?: number;
  /** How long the "payment provider" takes to confirm. */
  verifyAfterMs?: number;
  now?: () => number;
  /** Lets `me()` restore the demo user after an app reload. */
  tokens?: { getAccessToken(): Promise<string | null> };
};

export function createDemoApi(opts: DemoOptions = {}): VibeApi {
  const latency = opts.latency ?? 350;
  const verifyAfterMs = opts.verifyAfterMs ?? 1800;
  const now = opts.now ?? (() => Date.now());
  const wait = <T>(v: T): Promise<T> => new Promise((res) => setTimeout(() => res(clone(v)), latency));
  const fail = (status: number, code: string, message: string): never => {
    throw new ApiError(message, status, code);
  };
  let seq = 1000;
  const id = (p: string) => `${p}-${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const code = (len: number) => {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: len }, () => A[Math.floor(Math.random() * A.length)]).join('');
  };

  // ---------------- state ----------------
  const businesses = clone(C.businesses);
  const offers = clone(C.offers);
  const events = clone(C.events);
  const activities = clone(S.socialActivities);
  const groups = clone(S.socialGroups);
  const oneOnOnes = clone(S.oneOnOnes);
  let socialProfile: SocialProfile | null = null;
  let user: User | null = null;
  const otp = new Map<string, { phone: string; attemptsLeft: number; expiresAt: number }>();
  const redemptions = new Map<string, Redemption>();
  const paymentRequests = new Map<string, { req: PaymentRequest; kind: Payment['kind']; payee: string; context: string }>();
  const payments = new Map<string, Payment & { createdAt: number; paymentRequestId: string; applied: boolean }>();
  const idempotency = new Map<string, string>();
  const reservations = new Map<string, TicketReservation & { status: 'held' | 'paid' | 'released' }>();
  const tickets: Ticket[] = [];
  const redemptionsToday = new Map<string, number>();

  const sinceISO = new Date(now() - 150 * 86_400_000).toISOString();
  const membership: Membership = {
    status: 'active',
    plan: D.membershipPlans[0],
    memberNo: D.demoUser.memberNo,
    validUntil: new Date(now() + 30 * 86_400_000).toISOString(),
    renewsAt: new Date(now() + 30 * 86_400_000).toISOString(),
    autoRenew: true,
    savings: {
      total: 486000, thisMonth: 124000, redemptions: 14, places: 9, since: sinceISO,
      byCategory: [
        { name: 'Food & Dining', amount: 298000 }, { name: 'Fitness & Wellness', amount: 100000 },
        { name: 'Beauty & Personal Care', amount: 64000 }, { name: 'Events', amount: 24000 },
      ],
    },
    recentSavings: [
      { id: 'rs1', businessName: 'Pulse Studio', at: new Date(now() - 6 * 86_400_000).toISOString(), paid: 249900, saved: 50000 },
      { id: 'rs2', businessName: 'Brew & Bloom Café', at: new Date(now() - 8 * 86_400_000).toISOString(), paid: 36000, saved: 18000 },
    ],
    payments: [0, 1, 2].map((i) => ({
      id: `mp${i}`, at: new Date(now() - i * 30 * 86_400_000).toISOString(), amount: 29900, status: 'paid' as const, planName: 'Monthly',
    })),
  };

  const blocked = new Set<string>();
  const requireSocial = () => {
    const u = requireUser();
    if (!socialProfile) fail(403, 'social_profile_required', 'Set up your one-on-one profile first.');
    return { u, p: socialProfile! };
  };
  /** Only invites that work both ways are ever sent to the app. */
  const visibleToMe = (i: OneOnOneInvite, p: SocialProfile) =>
    i.status !== 'cancelled' && !blocked.has(i.host.id) &&
    (i.myStatus !== 'none' || (i.status === 'open' && canMeet(p, { gender: i.host.gender, openTo: i.openTo })));
  /** Requests are for the host only; the match is for the two people involved only. */
  const viewOf = (i: OneOnOneInvite): OneOnOneInvite => ({
    ...i,
    requests: i.myStatus === 'host' ? i.requests : [],
    matchedWith: i.myStatus === 'host' || i.myStatus === 'confirmed' ? i.matchedWith : null,
  });

  const requireUser = () => {
    if (!user) fail(401, 'unauthenticated', 'Please sign in to continue.');
    return user!;
  };
  const isMember = () => membership.status === 'active' || (membership.status === 'cancelled' && !!membership.validUntil && Date.parse(membership.validUntil) > now());

  const summaryOf = (b: (typeof businesses)[number]): BusinessSummary => {
    const { description, verified, categoryNames, address, location, hours, menu, branches, reviews, terms, bookingEnabled, photos, ...s } = b;
    void photos; void description; void verified; void categoryNames; void address; void location; void hours; void menu; void branches; void reviews; void terms; void bookingEnabled;
    return s;
  };
  const offerSummary = (o: (typeof offers)[number]): OfferSummary => {
    const { rule, appliesTo, excludes, channels, terms, example, ...s } = o;
    void rule; void appliesTo; void excludes; void channels; void terms; void example;
    return s;
  };
  const eventSummary = (e: EventDetail): EventSummary => {
    const { description, gatesOpenAt, organiser, ageLimit, ticketTypes, terms, ...s } = e;
    void description; void gatesOpenAt; void organiser; void ageLimit; void ticketTypes; void terms;
    const left = ticketTypes.reduce((n, t) => n + t.remaining, 0);
    return { ...s, soldOut: left === 0, fromPrice: Math.min(...ticketTypes.filter((t) => t.remaining > 0).map((t) => t.price).concat(s.fromPrice)) };
  };

  /** Release ticket holds that expired without payment (server job in production). */
  const releaseExpiredHolds = () => {
    for (const r of reservations.values()) {
      if (r.status === 'held' && Date.parse(r.expiresAt) < now()) {
        const ev = events.find((e) => e.id === r.eventId)!;
        for (const it of r.items) ev.ticketTypes.find((t) => t.id === it.ticketTypeId)!.remaining += it.quantity;
        r.status = 'released';
      }
    }
  };

  /** Mimics the signed provider webhook: verifies once, then applies side effects exactly once. */
  const settle = (p: Payment & { createdAt: number; paymentRequestId: string; applied: boolean }) => {
    if (p.status !== 'pending' || now() - p.createdAt < verifyAfterMs) return;
    const pr = paymentRequests.get(p.paymentRequestId)!;
    p.status = 'verified';
    p.verifiedAt = new Date(now()).toISOString();
    p.providerPaymentId = `pay_demo_${code(10)}`;
    if (p.applied) return;
    p.applied = true;
    if (pr.kind === 'redemption') {
      const red = redemptions.get(pr.context)!;
      red.status = 'paid';
      membership.savings.total += pr.req.discount;
      membership.savings.thisMonth += pr.req.discount;
      membership.savings.redemptions += 1;
      membership.recentSavings.unshift({ id: id('rs'), businessName: red.businessName, at: p.verifiedAt!, paid: pr.req.payable, saved: pr.req.discount });
      redemptionsToday.set(red.offerId, (redemptionsToday.get(red.offerId) ?? 0) + 1);
    } else if (pr.kind === 'tickets') {
      const res = reservations.get(pr.context)!;
      res.status = 'paid';
      const ev = events.find((e) => e.id === res.eventId)!;
      const bookingId = `VBT-${code(4)}-${code(4)}`;
      const flat = res.items.flatMap((it) => Array.from({ length: it.quantity }, () => it.name));
      flat.forEach((typeName, i) => {
        const t: Ticket = {
          id: id('t'), bookingId, eventId: ev.id, eventTitle: ev.title, eventKind: ev.kind, startsAt: ev.startsAt, gatesOpenAt: ev.gatesOpenAt,
          venue: ev.venue, area: ev.area, coverUrl: ev.coverUrl, typeName, attendeeName: res.attendees[i], admissionCode: `${code(3)}-${code(3)}`,
          qrToken: `vibe.t.${code(24)}`, status: 'valid', index: i + 1, of: flat.length, paidTotal: res.total,
        };
        tickets.push(t);
        p.ticketIds.push(t.id);
      });
    } else if (pr.kind === 'membership') {
      const plan = D.membershipPlans.find((pl) => pl.id === pr.context)!;
      const days = plan.interval === 'year' ? 365 : 30;
      membership.status = 'active';
      membership.plan = plan;
      membership.memberNo = membership.memberNo ?? D.demoUser.memberNo;
      membership.validUntil = new Date(now() + days * 86_400_000).toISOString();
      membership.renewsAt = membership.validUntil;
      membership.autoRenew = true;
      membership.payments.unshift({ id: id('mp'), at: p.verifiedAt!, amount: plan.price, status: 'paid', planName: plan.name });
    }
  };

  const newPaymentRequest = (kind: Payment['kind'], payee: string, context: string, req: Omit<PaymentRequest, 'id' | 'currency'>) => {
    const pr: PaymentRequest = { ...req, id: id('pr'), currency: 'INR' };
    paymentRequests.set(pr.id, { req: pr, kind, payee, context });
    return pr;
  };

  const api: VibeApi = {
    mode: 'demo',

    async requestOtp(phone) {
      const digits = phone.replace(/\D/g, '');
      if (!/^[6-9]\d{9}$/.test(digits)) fail(400, 'invalid_phone', 'Enter a valid 10-digit Indian mobile number.');
      const requestId = id('otp');
      otp.set(requestId, { phone: digits, attemptsLeft: 3, expiresAt: now() + 5 * 60_000 });
      return wait({ requestId, maskedPhone: `+91 ${digits.slice(0, 5)} •••${digits.slice(8)}`, expiresInSec: 300, resendInSec: 30, attemptsLeft: 3 });
    },

    async verifyOtp(requestId, value) {
      const ch = otp.get(requestId);
      if (!ch || ch.expiresAt < now()) fail(400, 'otp_expired', 'This code has expired. Request a new one.');
      if (ch!.attemptsLeft <= 0) fail(429, 'otp_locked', 'Too many attempts. Request a new code.');
      if (value !== D.DEMO_OTP) {
        ch!.attemptsLeft -= 1;
        fail(400, 'otp_invalid', `That code is not right. ${ch!.attemptsLeft} attempt${ch!.attemptsLeft === 1 ? '' : 's'} left.`);
      }
      otp.delete(requestId);
      const p = ch!.phone;
      user = { id: D.demoUser.id, name: D.demoUser.name, phoneMasked: `+91 ${p.slice(0, 5)} •••${p.slice(8)}`, vibeId: D.demoUser.vibeId, area: null, isMember: isMember() };
      return wait({ accessToken: `demo.${code(16)}`, refreshToken: `demo.r.${code(16)}`, user, isNewUser: false });
    },

    async logout() {
      user = null;
      return wait(undefined);
    },

    async me() {
      // Survive app reloads in demo mode: a stored demo token restores the demo user.
      if (!user && opts.tokens) {
        const t = await opts.tokens.getAccessToken();
        if (t?.startsWith('demo.')) {
          user = { id: D.demoUser.id, name: D.demoUser.name, phoneMasked: '+91 98765 •••10', vibeId: D.demoUser.vibeId, area: null, isMember: isMember() };
        }
      }
      return wait({ ...requireUser(), isMember: isMember() });
    },
    async updateMe(patch) {
      const u = requireUser();
      Object.assign(u, patch);
      return wait({ ...u, isMember: isMember() });
    },
    async requestAccountDeletion() {
      requireUser();
      return wait({ requestId: id('del'), message: 'We’ve received your request. We’ll confirm by SMS within 7 days. Payment records we must keep by law are retained.' });
    },

    async getCategories() {
      return wait(C.categories);
    },

    async getHome() {
      const s = businesses.map(summaryOf);
      const pick = (ids: string[]) => ids.map((i) => s.find((b) => b.id === i)!).filter(Boolean);
      const evs = events.map(eventSummary);
      return wait({
        banners: [
          { id: 'bn1', eyebrow: 'THIS WEEK', title: 'Members save 30% at Saffron Courtyard', subtitle: 'Pay through VIBE, discount applied automatically', cta: 'View offer', imageUrl: img('biryani', 960), target: { type: 'offer' as const, id: 'o-saffron-30' } },
          { id: 'bn2', eyebrow: 'LIVE THIS MONTH', title: 'Hyderabad after dark', subtitle: 'Jazz, comedy and walks', cta: 'See events', imageUrl: img('jazz', 960), target: { type: 'events' as const } },
        ],
        trending: pick(['b-saffron', 'b-pulse', 'b-lumiere', 'b-deccan']),
        offers: offers.filter((o) => o.id !== 'o-saffron-dessert').slice(0, 4).map(offerSummary),
        events: evs.filter((e) => !e.soldOut).slice(0, 4),
        nearby: [...s].sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 3),
        experiences: evs.filter((e) => e.kind === 'Workshops' || e.kind === 'Tours'),
        activities: [
          { id: 'ac1', name: 'Badminton', note: 'Courts · 1 hr', categoryId: 'fitness.sports.badminton', imageUrl: img('badminton') },
          { id: 'ac2', name: 'Swimming', note: 'Pools · lessons', categoryId: 'fitness.sports.swimming', imageUrl: img('swimming') },
          { id: 'ac3', name: 'Yoga', note: 'Studios · drop-in', categoryId: 'fitness.yoga', imageUrl: img('yoga') },
          { id: 'ac4', name: 'Tennis', note: 'Courts · coaching', categoryId: 'fitness.sports.tennis', imageUrl: img('tennis') },
          { id: 'ac5', name: 'Salons', note: 'Book a slot', categoryId: 'beauty.salons', imageUrl: img('salon') },
          { id: 'ac6', name: 'Indoor play', note: 'For kids', categoryId: 'kids.indoor-play', imageUrl: img('kids') },
        ],
        recentlyAdded: s.filter((b) => b.isNew),
        membershipPromo: isMember() ? null : { price: D.membershipPlans[0].price, interval: 'month' as const },
      });
    },

    async searchBusinesses(q) {
      const text = (q.q ?? '').trim().toLowerCase();
      let list = businesses.filter((b) => {
        if (q.categoryId && !b.categoryIds.some((c) => c === q.categoryId || c.startsWith(q.categoryId + '.'))) return false;
        if (text && !`${b.name} ${b.categoryLabel} ${b.area} ${b.menu.map((m) => m.name).join(' ')}`.toLowerCase().includes(text)) return false;
        if (q.openNow && !b.status.open) return false;
        if (q.memberOffers && !b.hasMemberOffer) return false;
        if (q.minRating && b.rating < q.minRating) return false;
        if (q.maxDistanceKm && b.distanceKm > q.maxDistanceKm) return false;
        if (q.maxPriceLevel && b.priceLevel > q.maxPriceLevel) return false;
        if (q.scope === 'services' && !b.bookingEnabled) return false;
        return true;
      }).map(summaryOf);
      if (q.sort === 'rating') list = list.sort((a, b) => b.rating - a.rating);
      else if (q.sort === 'popular') list = list.sort((a, b) => b.reviewCount - a.reviewCount);
      else list = list.sort((a, b) => a.distanceKm - b.distanceKm);
      return wait(list);
    },

    async getBusiness(bid) {
      const b = businesses.find((x) => x.id === bid) ?? fail(404, 'not_found', 'This business is no longer listed.');
      const detail: BusinessDetail = { ...b!, offers: offers.filter((o) => o.businessId === bid).map(offerSummary) };
      return wait(detail);
    },

    async getOffers(view) {
      const dist = (o: (typeof offers)[number]) => businesses.find((b) => b.id === o.businessId)?.distanceKm ?? 99;
      let list = [...offers];
      if (view === 'member') list = list.filter((o) => o.memberOnly);
      if (view === 'nearby') list = list.sort((a, b) => dist(a) - dist(b));
      if (view === 'ending') list = list.filter((o) => Date.parse(o.endsAt) - now() < 7 * 86_400_000).sort((a, b) => Date.parse(a.endsAt) - Date.parse(b.endsAt));
      if (view === 'new') list = list.slice(-3).reverse();
      if (view === 'trending') list = list.filter((o) => ['o-saffron-30', 'o-brew-bogo', 'o-lumiere-20'].includes(o.id));
      return wait(list.map(offerSummary));
    },

    async getOffer(oid) {
      const o = offers.find((x) => x.id === oid) ?? fail(404, 'not_found', 'This offer has ended or was withdrawn.');
      const { rule, ...detail } = o!;
      void rule;
      return wait(detail);
    },

    async getOfferEligibility(oid) {
      const o = offers.find((x) => x.id === oid) ?? fail(404, 'not_found', 'Offer not found.');
      if (!user) return wait({ eligible: false, reason: 'Sign in to redeem this offer.', redemptionsLeftToday: null, memberValidUntil: null });
      if (o!.memberOnly && !isMember()) return wait({ eligible: false, reason: 'This offer is for VIBE members.', redemptionsLeftToday: null, memberValidUntil: null });
      const left = 1 - (redemptionsToday.get(oid) ?? 0);
      if (left <= 0) return wait({ eligible: false, reason: 'You’ve already used this offer today.', redemptionsLeftToday: 0, memberValidUntil: membership.validUntil });
      return wait({ eligible: true, reason: o!.memberOnly ? 'Active VIBE member' : 'Available to all VIBE users', redemptionsLeftToday: left, memberValidUntil: membership.validUntil });
    },

    async createRedemption(offerId) {
      const u = requireUser();
      const o = offers.find((x) => x.id === offerId) ?? fail(404, 'not_found', 'Offer not found.');
      if (o!.memberOnly && !isMember()) fail(403, 'membership_required', 'This offer is for VIBE members.');
      if ((redemptionsToday.get(offerId) ?? 0) >= 1) fail(409, 'limit_reached', 'You’ve already used this offer today.');
      const biz = businesses.find((b) => b.id === o!.businessId)!;
      const red: Redemption = {
        id: id('rd'), offerId, businessName: biz.name, branchName: biz.area, customerDisplayName: `${u.name.split(' ')[0]} ${u.name.split(' ')[1]?.[0] ?? ''}.`.trim(),
        vibeId: u.vibeId, status: 'awaiting_bill', expiresAt: new Date(now() + 15 * 60_000).toISOString(), paymentRequest: null,
      };
      redemptions.set(red.id, red);
      return wait(red);
    },

    async getRedemption(rid) {
      const red = redemptions.get(rid) ?? fail(404, 'not_found', 'Redemption not found.');
      if (red!.status === 'awaiting_bill' && Date.parse(red!.expiresAt) < now()) red!.status = 'expired';
      return wait(red!);
    },

    async cancelRedemption(rid) {
      const red = redemptions.get(rid);
      if (red && red.status !== 'paid') red.status = 'cancelled';
      return wait(undefined);
    },

    async getPaymentRequest(prId) {
      const entry = paymentRequests.get(prId) ?? fail(404, 'not_found', 'This bill is no longer available.');
      return wait({ ...entry!.req, payeeName: entry!.payee, kind: entry!.kind });
    },

    async startPayment(prId, method: PaymentMethod, idempotencyKey) {
      requireUser();
      const prior = idempotency.get(idempotencyKey);
      if (prior) return wait({ reference: prior, checkout: { mode: 'demo' as const } });
      const entry = paymentRequests.get(prId) ?? fail(404, 'not_found', 'This bill is no longer available.');
      if (Date.parse(entry!.req.expiresAt) < now()) fail(410, 'expired', 'This bill has expired. Ask the staff to send it again.');
      for (const p of payments.values()) {
        if (p.paymentRequestId === prId && (p.status === 'verified' || p.status === 'pending')) fail(409, 'already_paid', 'This bill is already being paid.');
      }
      const reference = `VB-${code(4)}-${code(4)}`;
      payments.set(reference, {
        reference, kind: entry!.kind, status: 'pending', method, amount: entry!.req.payable, savings: entry!.req.discount, payeeName: entry!.payee,
        providerPaymentId: null, verifiedAt: null, failureReason: null, lines: entry!.req.lines, ticketIds: [],
        createdAt: now(), paymentRequestId: prId, applied: false,
      });
      idempotency.set(idempotencyKey, reference);
      return wait({ reference, checkout: { mode: 'demo' as const } });
    },

    async getPayment(reference) {
      const p = payments.get(reference) ?? fail(404, 'not_found', 'Payment not found.');
      settle(p!);
      const { createdAt, paymentRequestId, applied, ...pub } = p!;
      void createdAt; void paymentRequestId; void applied;
      return wait(pub);
    },

    async getEvents(f) {
      releaseExpiredHolds();
      let list = events.map(eventSummary);
      if (f.kind) list = list.filter((e) => e.kind === f.kind);
      if (f.day) list = list.filter((e) => new Date(Date.parse(e.startsAt) + 330 * 60_000).toISOString().slice(0, 10) === f.day);
      return wait(list.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)));
    },

    async getEvent(eid) {
      releaseExpiredHolds();
      const e = events.find((x) => x.id === eid) ?? fail(404, 'not_found', 'Event not found.');
      return wait({ ...e!, ...eventSummary(e!) });
    },

    async reserveTickets(eventId, items, attendees) {
      requireUser();
      releaseExpiredHolds();
      const ev = events.find((x) => x.id === eventId) ?? fail(404, 'not_found', 'Event not found.');
      const wanted = items.filter((i) => i.quantity > 0);
      const qty = wanted.reduce((n, i) => n + i.quantity, 0);
      if (qty === 0) fail(400, 'empty', 'Choose at least one ticket.');
      if (attendees.length !== qty || attendees.some((a) => a.trim().length < 2)) fail(400, 'attendees', 'Add a name for every ticket.');
      for (const it of wanted) {
        const tt = ev!.ticketTypes.find((t) => t.id === it.ticketTypeId) ?? fail(400, 'bad_type', 'Unknown ticket type.');
        if (it.quantity > tt!.maxPerOrder) fail(400, 'max_per_order', `Up to ${tt!.maxPerOrder} ${tt!.name} tickets per order.`);
        if (it.quantity > tt!.remaining) fail(409, 'sold_out', tt!.remaining === 0 ? `${tt!.name} is sold out.` : `Only ${tt!.remaining} ${tt!.name} left.`);
      }
      // Hold inventory atomically (single-threaded here; a DB transaction with row locks on the server).
      const lines = wanted.map((it) => {
        const tt = ev!.ticketTypes.find((t) => t.id === it.ticketTypeId)!;
        tt.remaining -= it.quantity;
        return { ...it, name: tt.name, unitPrice: tt.price };
      });
      const total = lines.reduce((n, l) => n + l.unitPrice * l.quantity, 0);
      const resId = id('res');
      const expiresAt = new Date(now() + 10 * 60_000).toISOString();
      const pr = newPaymentRequest('tickets', ev!.title, resId, {
        billRef: resId.toUpperCase(), raisedBy: 'VIBE Tickets', raisedAt: new Date(now()).toISOString(),
        lines: lines.map((l) => ({ label: `${l.name} × ${l.quantity}`, amount: l.unitPrice * l.quantity })),
        eligibleAmount: total, discount: 0, discountLabel: '', taxes: null, vibeFee: 0, payable: total, expiresAt,
      });
      const res = { id: resId, eventId, items: lines, attendees, total, expiresAt, paymentRequestId: pr.id, status: 'held' as const };
      reservations.set(resId, res);
      const { status, ...pub } = res;
      void status;
      return wait(pub);
    },

    async getMyTickets() {
      requireUser();
      return wait([...tickets].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)));
    },

    async getTicket(tid) {
      const t = tickets.find((x) => x.id === tid) ?? fail(404, 'not_found', 'Ticket not found.');
      return wait(t!);
    },

    async getMembership() {
      if (membership.status === 'cancelled' && membership.validUntil && Date.parse(membership.validUntil) < now()) membership.status = 'none';
      return wait(membership);
    },
    async getMembershipPlans() {
      return wait(D.membershipPlans);
    },
    async subscribe(planId) {
      const u = requireUser();
      const plan = D.membershipPlans.find((p) => p.id === planId) ?? fail(404, 'not_found', 'Plan not found.');
      if (membership.status === 'active') fail(409, 'already_member', 'You already have an active membership.');
      const pr = newPaymentRequest('membership', 'VIBE Membership', plan!.id, {
        billRef: `MEM-${u.vibeId}`, raisedBy: 'VIBE', raisedAt: new Date(now()).toISOString(),
        lines: [{ label: `${plan!.name} membership (incl. GST)`, amount: plan!.price }],
        eligibleAmount: plan!.price, discount: 0, discountLabel: '', taxes: null, vibeFee: 0, payable: plan!.price,
        expiresAt: new Date(now() + 15 * 60_000).toISOString(),
      });
      return wait({ paymentRequestId: pr.id, amount: plan!.price });
    },
    async changePlan(planId) {
      const plan = D.membershipPlans.find((p) => p.id === planId) ?? fail(404, 'not_found', 'Plan not found.');
      if (membership.status !== 'active') fail(409, 'not_member', 'Join first to change plans.');
      membership.plan = plan!; // takes effect at next renewal on the server
      return wait(membership);
    },
    async cancelMembership() {
      if (membership.status !== 'active') fail(409, 'not_member', 'No active membership to cancel.');
      membership.status = 'cancelled';
      membership.autoRenew = false;
      membership.renewsAt = null;
      return wait(membership);
    },

    async getSocialFeed() {
      return wait({ activities: activities.filter((a) => !blocked.has(a.hostId)), groups });
    },
    async joinActivity(aid) {
      requireUser();
      const a = activities.find((x) => x.id === aid) ?? fail(404, 'not_found', 'Activity not found.');
      if (a!.requiresIdVerification) fail(403, 'id_verification_required', 'Verify your age with a government ID to join this event.');
      if (a!.myStatus === 'none') {
        if (a!.going >= a!.capacity) fail(409, 'full', 'This activity is full.');
        a!.myStatus = a!.approvalRequired ? 'requested' : 'joined';
        if (a!.myStatus === 'joined') a!.going += 1;
      }
      return wait(a! as SocialActivity);
    },
    async leaveActivity(aid) {
      const a = activities.find((x) => x.id === aid) ?? fail(404, 'not_found', 'Activity not found.');
      if (a!.myStatus === 'joined') a!.going -= 1;
      a!.myStatus = 'none';
      return wait(a!);
    },
    async joinGroup(gid) {
      requireUser();
      const g = groups.find((x) => x.id === gid) ?? fail(404, 'not_found', 'Group not found.');
      if (g!.myStatus === 'none') g!.myStatus = g!.privacy === 'private' ? 'requested' : 'joined';
      return wait(g!);
    },
    async report(input) {
      requireUser();
      if (!input.reason) fail(400, 'reason', 'Choose a reason.');
      return wait({ reportId: id('rep') });
    },
    async block(userId) {
      requireUser();
      blocked.add(userId);
      // Blocking also withdraws anything pending between the two of you.
      for (const i of oneOnOnes) {
        if (i.host.id === userId && i.myStatus !== 'none') { i.myStatus = 'none'; if (i.status === 'matched') { i.status = 'open'; i.matchedWith = null; } }
        if (i.myStatus === 'host') i.requests = i.requests.filter((m) => m.id !== userId);
      }
      return wait(undefined);
    },

    // ---- One-on-one (18+) ----
    async getSocialProfile() {
      requireUser();
      return wait(socialProfile);
    },
    async saveSocialProfile(input) {
      const u = requireUser();
      if (!['man', 'woman', 'nonbinary', 'undisclosed'].includes(input.gender)) fail(400, 'gender', 'Choose an option for “I am”.');
      if (!['men', 'women', 'anyone'].includes(input.meetPreference)) fail(400, 'preference', 'Choose who you’d like to meet.');
      if (!input.ageConfirmed18) fail(400, 'age_restricted', 'One-on-one is only for members aged 18 and over.');
      if (input.ageBand !== null && !AGE_BANDS.includes(input.ageBand)) fail(400, 'age_band', 'Choose an age range.');
      socialProfile = { firstName: u.name.split(' ')[0], gender: input.gender, meetPreference: input.meetPreference, ageConfirmed18: true, ageBand: input.ageBand };
      for (const i of oneOnOnes) if (i.myStatus === 'host') i.host = { ...i.host, gender: input.gender, ageBand: input.ageBand };
      return wait(socialProfile);
    },
    async getOneOnOnes() {
      const { p } = requireSocial();
      const rank = { host: 0, confirmed: 1, requested: 2, none: 3 } as const;
      const list = oneOnOnes.filter((i) => visibleToMe(i, p))
        .sort((a, b) => rank[a.myStatus] - rank[b.myStatus] || Date.parse(a.startsAt) - Date.parse(b.startsAt));
      return wait(list.map(viewOf));
    },
    async createOneOnOne(input) {
      const { u, p } = requireSocial();
      const activity = input.activity.trim();
      const venueName = input.venueName.trim();
      const note = (input.note ?? '').trim();
      if (activity.length < 3 || activity.length > 60) fail(400, 'activity', 'Describe the plan in 3 to 60 characters.');
      if (venueName.length < 2 || !input.area.trim()) fail(400, 'venue', 'Choose a public place to meet.');
      if (note.length > 140) fail(400, 'note', 'Keep your note under 140 characters.');
      if (!['men', 'women', 'anyone'].includes(input.openTo)) fail(400, 'open_to', 'Choose who can join.');
      const at = Date.parse(input.startsAt);
      if (!(at > now() + 30 * 60_000)) fail(400, 'time', 'Pick a time at least 30 minutes from now.');
      if (at > now() + 30 * 86_400_000) fail(400, 'time', 'Pick a time within the next 30 days.');
      if (oneOnOnes.filter((i) => i.myStatus === 'host' && i.status === 'open').length >= 3) fail(409, 'limit', 'You can have up to 3 open invites at a time.');
      const venue = input.venueBusinessId ? businesses.find((b) => b.id === input.venueBusinessId) : undefined;
      const KIND_IMAGE: Record<string, string> = { coffee: 'coffee', sport: 'badminton', food: 'dinner', walk: 'walk', movie: 'movie' };
      if (!KIND_IMAGE[input.kind]) fail(400, 'kind', 'Choose an activity.');
      const inv: OneOnOneInvite = {
        id: id('oo'), kind: input.kind, activity, note, venueName, venueBusinessId: venue?.id ?? null, area: input.area.trim(), startsAt: input.startsAt,
        durationMin: input.kind === 'movie' ? 150 : 60, costNote: input.kind === 'walk' ? 'Free' : input.kind === 'sport' ? 'Court cost split equally' : 'Each pays their own',
        host: { id: u.id, firstName: p.firstName, ageBand: p.ageBand, gender: p.gender, verified: true },
        openTo: input.openTo, status: 'open', myStatus: 'host', requests: [], matchedWith: null,
        coverUrl: venue?.photos[0] ?? venue?.coverUrl ?? img(KIND_IMAGE[input.kind], 960),
      };
      oneOnOnes.push(inv);
      return wait(viewOf(inv));
    },
    async requestOneOnOne(oid) {
      const { p } = requireSocial();
      const i = oneOnOnes.find((x) => x.id === oid && !blocked.has(x.host.id) && x.status !== 'cancelled') ?? fail(404, 'not_found', 'This invite is no longer available.');
      if (i!.myStatus === 'host') fail(409, 'own_invite', 'This is your own invite.');
      if (i!.myStatus !== 'none') return wait(viewOf(i!));
      if (i!.status !== 'open') fail(409, 'taken', 'Someone else is already joining this one.');
      // Enforced here, not just hidden in the list.
      if (!canMeet(p, { gender: i!.host.gender, openTo: i!.openTo })) fail(403, 'not_eligible', 'This invite isn’t open to your profile.');
      if (oneOnOnes.filter((x) => x.myStatus === 'requested').length >= 5) fail(409, 'limit', 'You have 5 requests waiting. Withdraw one to ask again.');
      i!.myStatus = 'requested';
      return wait(viewOf(i!));
    },
    async cancelOneOnOne(oid) {
      requireUser();
      const i = oneOnOnes.find((x) => x.id === oid) ?? fail(404, 'not_found', 'Invite not found.');
      if (i!.myStatus === 'host') { i!.status = 'cancelled'; i!.requests = []; i!.matchedWith = null; }
      else if (i!.myStatus !== 'none') { if (i!.myStatus === 'confirmed') { i!.status = 'open'; i!.matchedWith = null; } i!.myStatus = 'none'; }
      return wait(undefined);
    },
    async respondOneOnOne(oid, memberId, accept) {
      requireSocial();
      const i = oneOnOnes.find((x) => x.id === oid && x.myStatus === 'host') ?? fail(404, 'not_found', 'Invite not found.');
      const m = i!.requests.find((x) => x.id === memberId) ?? fail(404, 'not_found', 'That request was withdrawn.');
      if (accept) { i!.status = 'matched'; i!.matchedWith = m!; i!.requests = []; }
      else i!.requests = i!.requests.filter((x) => x.id !== memberId);
      return wait(viewOf(i!));
    },

    demo: {
      /** Stands in for the other person accepting your request. */
      async simulateHostAccepts(oid: ID) {
        const i = oneOnOnes.find((x) => x.id === oid && x.myStatus === 'requested') ?? fail(404, 'not_found', 'No pending request on this invite.');
        i!.myStatus = 'confirmed';
        i!.status = 'matched';
        i!.matchedWith = i!.host;
        return wait(viewOf(i!));
      },
      /** Stands in for another member asking to join your invite. */
      async simulateJoinRequest(oid: ID) {
        const { p } = requireSocial();
        const i = oneOnOnes.find((x) => x.id === oid && x.myStatus === 'host' && x.status === 'open') ?? fail(404, 'not_found', 'Invite not found.');
        const next = S.demoRequesters.find((m: MemberCard) =>
          !blocked.has(m.id) && !i!.requests.some((q) => q.id === m.id) &&
          canMeet({ gender: m.gender, meetPreference: 'anyone' }, { gender: p.gender, openTo: i!.openTo }) &&
          canMeet(p, { gender: m.gender, openTo: 'anyone' }));
        if (!next) fail(409, 'nobody', 'No one else matching this invite in the demo.');
        i!.requests.push(next!);
        return wait(viewOf(i!));
      },
      /** Stands in for the merchant entering a bill in the merchant dashboard. */
      async simulateMerchantBill(rid: ID, eligibleAmount: number) {
        const red = redemptions.get(rid) ?? fail(404, 'not_found', 'Redemption not found.');
        if (red!.status !== 'awaiting_bill') fail(409, 'bad_state', 'A bill has already been sent.');
        const offer = offers.find((o) => o.id === red!.offerId)!;
        const q = quote(offer.rule, eligibleAmount, 0);
        const lines = [
          { label: 'Hyderabadi dum biryani × 1', amount: 48000 },
          { label: 'Charcoal seekh kebab × 1', amount: 39000 },
          { label: 'Irani chai pot × 1', amount: 12000 },
          { label: 'Mineral water × 1', amount: 1000 },
        ];
        const pr = newPaymentRequest('redemption', red!.businessName, rid, {
          billRef: `A-${2000 + Math.floor(Math.random() * 999)} · Table 12`, raisedBy: 'Kiran (staff)', raisedAt: new Date(now()).toISOString(),
          lines: offer.businessId === 'b-saffron' && eligibleAmount === 100000 ? lines : [{ label: 'Eligible items', amount: eligibleAmount }],
          eligibleAmount, discount: q.discount, discountLabel: `${offer.title}${q.reason ? ` — ${q.reason}` : ''}`,
          taxes: null, vibeFee: 0, payable: q.payable, expiresAt: new Date(now() + 10 * 60_000).toISOString(),
        });
        red!.status = 'bill_ready';
        red!.paymentRequest = pr;
        return wait(red!);
      },
    },
  };
  return api;
}
