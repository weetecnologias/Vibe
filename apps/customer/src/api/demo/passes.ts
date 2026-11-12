import { passEnd } from '@/lib/dates';

import type { ID, VenuePass, VenuePlan } from '../types';

/**
 * DEMO DATA — monthly memberships at gyms, yoga and meditation studios, and trainers. Mirrors
 * backend/src/main/java/in/vibe/backend/slots/VenuePasses.java: choose a plan and a start date (today to 60 days ahead),
 * it's held for 10 minutes while you pay, then it's valid from the start date for the plan's months.
 */
const r = (rupees: number) => rupees * 100;
type Setup = Omit<VenuePlan, 'id' | 'perMonth' | 'active' | 'sortOrder'>;
const PLANS: Record<string, Setup[]> = {
  'fitness.gyms': [
    { name: 'Monthly unlimited', months: 1, price: r(2999), description: 'Unlimited gym access, every day.', benefits: ['All floors and equipment', 'Locker and shower', 'Free fitness assessment'] },
    { name: '3 months', months: 3, price: r(7999), description: 'Save ₹1,000 against monthly.', benefits: ['Everything in Monthly', '2 personal training sessions'] },
    { name: '12 months', months: 12, price: r(24999), description: 'Best value: about ₹2,083 a month.', benefits: ['Everything in 3 months', 'Freeze for up to 30 days'] },
  ],
  'fitness.yoga': [
    { name: 'Monthly yoga and meditation', months: 1, price: r(2499), description: 'Unlimited classes, morning and evening batches.', benefits: ['Hatha, vinyasa and yin classes', 'Guided meditation', 'Mat provided'] },
    { name: '3 months', months: 3, price: r(6499), description: 'Save ₹1,000 against monthly.', benefits: ['Everything in Monthly', 'One private session'] },
  ],
  'fitness.training': [
    { name: '12 sessions a month', months: 1, price: r(9999), description: 'Three sessions a week with your coach.', benefits: ['Personal plan and diet guidance', 'Progress check every 2 weeks'] },
    { name: '3 months, 12 sessions a month', months: 3, price: r(26999), description: 'Save ₹3,000 against monthly.', benefits: ['Everything in Monthly', 'Body composition scans'] },
  ],
  'fitness.sports.martial-arts': [
    { name: 'Monthly classes', months: 1, price: r(1999), description: 'All open classes for a month.', benefits: ['Beginner and advanced batches', 'Grading included'] },
  ],
};
const HOLD_MS = 10 * 60_000, START_WITHIN_DAYS = 60;
const DAY = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

type Held = VenuePass & { customerId: ID; planId: ID };
type Biz = { id: ID; name: string; area: string; address: string; primaryCategoryId: string };

export function createPasses(opts: { now: () => number; businesses: Biz[]; newId: (p: string) => string; code: (n: number) => string }) {
  const plans = new Map<ID, VenuePlan & { businessId: ID }>();
  for (const b of opts.businesses) {
    (PLANS[b.primaryCategoryId] ?? []).forEach((p, i) => {
      const id = `${b.id}-plan-${i + 1}`;
      plans.set(id, { ...p, id, businessId: b.id, perMonth: Math.round(p.price / p.months), active: true, sortOrder: i });
    });
  }
  const passes = new Map<ID, Held>();
  const today = () => new Date(opts.now() + 330 * 60_000).toISOString().slice(0, 10);
  const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const view = (p: Held): VenuePass => {
    const t = today();
    if (p.status === 'held' && Date.parse(p.expiresAt) <= opts.now()) p.status = 'released';
    const activeNow = p.status === 'paid' && t >= p.startsOn && t <= p.endsOn;
    const daysLeft = p.status !== 'paid' || t > p.endsOn ? 0 : Math.round((Date.parse(`${p.endsOn}T00:00:00Z`) - Date.parse(`${t > p.startsOn ? t : p.startsOn}T00:00:00Z`)) / 86_400_000) + 1;
    const { customerId: _c, planId: _p, ...pub } = p;
    void _c; void _p;
    return { ...pub, activeNow, daysLeft };
  };

  return {
    plans(businessId: ID): VenuePlan[] {
      return [...plans.values()].filter((p) => p.businessId === businessId && p.active).sort((a, b) => a.sortOrder - b.sortOrder).map(({ businessId: _b, ...p }) => { void _b; return p; });
    },

    hold(customerId: ID, planId: ID, startsOn: string): { pass: VenuePass; line: { label: string; amount: number } } {
      const plan = plans.get(planId);
      const biz = plan && opts.businesses.find((b) => b.id === plan.businessId);
      if (!plan || !biz || !plan.active) throw Object.assign(new Error('This plan isn’t on sale any more.'), { status: 404, code: 'not_found' });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn) || startsOn < today() || startsOn > addDays(today(), START_WITHIN_DAYS)) {
        throw Object.assign(new Error(`Choose a start date from today to ${START_WITHIN_DAYS} days ahead.`), { status: 400, code: 'start' });
      }
      for (const p of passes.values()) if (p.customerId === customerId && p.businessId === biz.id && p.status === 'held') p.status = 'released';
      const endsOn = passEnd(startsOn, plan.months);
      const pass: Held = {
        id: opts.newId('vp'), businessId: biz.id, businessName: biz.name, area: biz.area, address: biz.address, planName: plan.name, months: plan.months, status: 'held',
        startsOn, endsOn, activeNow: false, daysLeft: 0, passRef: `VBP-${opts.code(4)}-${opts.code(4)}`, passCode: null, total: plan.price,
        expiresAt: new Date(opts.now() + HOLD_MS).toISOString(), paymentRequestId: '', paidAt: null, checkIns: 0, customerId, planId,
      };
      passes.set(pass.id, pass);
      const day = (d: string) => DAY.format(new Date(`${d}T00:00:00Z`));
      return { pass: view(pass), line: { label: `${plan.name} · ${day(startsOn)} – ${day(endsOn)}`, amount: plan.price } };
    },

    attachPaymentRequest(passId: ID, prId: ID) { const p = passes.get(passId); if (p) p.paymentRequestId = prId; },

    markPaid(passId: ID) {
      const p = passes.get(passId);
      if (!p || p.status === 'paid') return;
      p.status = 'paid';
      p.paidAt = new Date(opts.now()).toISOString();
      p.passCode = `${opts.code(3)}-${opts.code(3)}`;
    },

    get(customerId: ID, id: ID): VenuePass {
      const p = passes.get(id);
      if (!p || p.customerId !== customerId) throw Object.assign(new Error('Membership not found.'), { status: 404, code: 'not_found' });
      return view(p);
    },

    mine(customerId: ID): VenuePass[] {
      return [...passes.values()].filter((p) => p.customerId === customerId && p.status === 'paid').map(view).sort((a, b) => b.endsOn.localeCompare(a.endsOn));
    },
  };
}
