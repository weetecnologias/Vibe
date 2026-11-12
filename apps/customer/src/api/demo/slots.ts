import type { ID, SlotBooking, SlotBookingItem, SlotGrid, SlotPick, VenueSport } from '../types';

/**
 * Demo stand-in for the backend's slot booking (sports and fitness, like Playo). Each sports or fitness place gets courts, turfs, nets or
 * classes by its category; the demo venue is open 6 AM to 10 PM every day. Holds count against availability until they expire or are paid.
 * Mirrors backend/src/main/java/in/vibe/backend/slots/SlotBooking.java closely enough for the screens to behave the same.
 */
type Resource = { id: ID; businessId: ID; sport: string; name: string; kind: 'court' | 'spots'; capacity: number; slotMinutes: number; price: number; peak?: { price: number; from: number; to: number; weekend: boolean } };
type Setup = { sport: string; name: string; kind: 'court' | 'spots'; count: number; capacity: number; price: number; peak?: { price: number; from: number; to: number; weekend: boolean } };

const r = (rupees: number) => rupees * 100;
const SETUPS: Record<string, Setup[]> = {
  'fitness.sports.badminton': [
    { sport: 'Badminton', name: 'Court', kind: 'court', count: 4, capacity: 1, price: r(350), peak: { price: r(500), from: 18, to: 22, weekend: true } },
    { sport: 'Pickleball', name: 'Pickleball court', kind: 'court', count: 2, capacity: 1, price: r(400), peak: { price: r(550), from: 18, to: 22, weekend: true } },
  ],
  'fitness.sports.tennis': [{ sport: 'Tennis', name: 'Hard court', kind: 'court', count: 3, capacity: 1, price: r(600), peak: { price: r(800), from: 17, to: 21, weekend: true } }],
  'fitness.sports.football': [{ sport: 'Football', name: '5-a-side turf', kind: 'court', count: 2, capacity: 1, price: r(1200), peak: { price: r(1600), from: 18, to: 23, weekend: true } }],
  'fitness.sports.cricket': [{ sport: 'Cricket', name: 'Net', kind: 'court', count: 3, capacity: 1, price: r(500), peak: { price: r(700), from: 17, to: 21, weekend: true } }],
  'fitness.sports.swimming': [{ sport: 'Swimming', name: 'Pool session', kind: 'spots', count: 1, capacity: 25, price: r(200) }],
  'fitness.sports.skating': [{ sport: 'Skating', name: 'Rink session', kind: 'spots', count: 1, capacity: 20, price: r(250) }],
  'fitness.sports.martial-arts': [{ sport: 'Martial arts', name: 'Open class', kind: 'spots', count: 1, capacity: 15, price: r(300) }],
  'fitness.yoga': [{ sport: 'Yoga', name: 'Yoga class', kind: 'spots', count: 1, capacity: 15, price: r(300), peak: { price: r(400), from: 6, to: 8, weekend: false } }],
  'fitness.gyms': [{ sport: 'Gym', name: 'Gym session', kind: 'spots', count: 1, capacity: 40, price: r(250) }],
  'fitness.training': [{ sport: 'Personal training', name: 'Coach', kind: 'court', count: 2, capacity: 1, price: r(800) }],
  'fitness.wellness': [{ sport: 'Recovery', name: 'Recovery session', kind: 'spots', count: 1, capacity: 6, price: r(900) }],
  'movies.private-theatres': [{ sport: 'Private screening', name: 'Screen', kind: 'court', count: 2, capacity: 1, price: r(1499), peak: { price: r(1999), from: 18, to: 23, weekend: true } }],
};

const OPEN = 6, CLOSE = 22, HOLD_MS = 10 * 60_000, DAYS_AHEAD = 14;

type Held = SlotBooking & { customerId: ID };

export function createSlots(opts: { now: () => number; businesses: { id: ID; name: string; area: string; address: string; primaryCategoryId: string }[]; newId: (p: string) => string; code: (n: number) => string }) {
  const resources: Resource[] = [];
  for (const b of opts.businesses) {
    for (const s of SETUPS[b.primaryCategoryId] ?? []) {
      for (let n = 1; n <= s.count; n++) {
        resources.push({ id: `${b.id}-${s.sport}-${n}`.replace(/\s+/g, '-').toLowerCase(), businessId: b.id, sport: s.sport, name: s.count > 1 ? `${s.name} ${n}` : s.name, kind: s.kind, capacity: s.capacity, slotMinutes: 60, price: s.price, peak: s.peak });
      }
    }
  }
  const bookings = new Map<ID, Held>();

  const ist = (ms: number) => new Date(ms + 330 * 60_000); // read with getUTC* for India time
  const priceAt = (res: Resource, startMs: number) => {
    if (!res.peak) return res.price;
    const d = ist(startMs), h = d.getUTCHours(), weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
    return (res.peak.weekend && weekend) || (h >= res.peak.from && h < res.peak.to) ? res.peak.price : res.price;
  };
  const priceFor = (res: Resource, startMs: number, minutes: number, spots: number) => {
    let t = 0;
    for (let m = 0; m < minutes; m += res.slotMinutes) t += priceAt(res, startMs + m * 60_000);
    return t * spots;
  };
  const live = (b: Held) => b.status === 'paid' || (b.status === 'held' && Date.parse(b.expiresAt) > opts.now());
  const taken = (res: Resource, from: number, to: number) => {
    let n = 0;
    for (const b of bookings.values()) {
      if (!live(b)) continue;
      for (const i of b.items) if (i.resourceId === res.id && Date.parse(i.startsAt) < to && Date.parse(i.endsAt) > from) n += i.spots;
    }
    return n;
  };
  /** Midnight India time for a YYYY-MM-DD date, as a UTC timestamp. */
  const dayStart = (date: string) => Date.parse(`${date}T00:00:00+05:30`);
  const label = (ms: number) => { const d = ist(ms); const h = d.getUTCHours(), m = d.getUTCMinutes(); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
  const short = (ms: number) => { const d = ist(ms); const h = d.getUTCHours(), m = d.getUTCMinutes(); return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`; };
  /** "6–7 AM", "6–8 AM", "11 AM–1 PM": the same as the backend's SlotBooking.range. */
  const range = (from: number, to: number) => { const a = short(from), b = short(to); return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)}–${b}` : `${a}–${b}`; };

  return {
    fromPrice(businessId: ID): number | null {
      const rs = resources.filter((x) => x.businessId === businessId);
      return rs.length ? Math.min(...rs.map((x) => x.price)) : null;
    },

    sports(businessId: ID): VenueSport[] {
      const by = new Map<string, Resource[]>();
      for (const x of resources.filter((y) => y.businessId === businessId)) by.set(x.sport, [...(by.get(x.sport) ?? []), x]);
      return [...by.entries()].map(([sport, rs]) => ({ sport, kind: rs[0].kind, resources: rs.length, fromPrice: Math.min(...rs.map((x) => x.price)), slotMinutes: 60 }));
    },

    grid(businessId: ID, sport: string, date: string, minutes?: number): SlotGrid {
      const rs = resources.filter((x) => x.businessId === businessId && x.sport.toLowerCase() === sport.toLowerCase());
      if (!rs.length) throw Object.assign(new Error(`This venue doesn’t take bookings for ${sport}.`), { status: 404, code: 'not_found' });
      const durations = [60, 120, 180];
      const len = minutes && durations.includes(minutes) ? minutes : 60;
      const today = ist(opts.now()).toISOString().slice(0, 10);
      const far = new Date(dayStart(today) + DAYS_AHEAD * 86_400_000 + 330 * 60_000).toISOString().slice(0, 10);
      if (date < today || date > far) return { date, sport, minutes: len, slotMinutes: 60, durations, kind: rs[0].kind, slots: [], closedReason: `Bookings open ${DAYS_AHEAD} days ahead.` };
      const slots = [];
      for (let h = OPEN; h + len / 60 <= CLOSE; h++) {
        const from = dayStart(date) + h * 3_600_000, to = from + len * 60_000;
        const past = from <= opts.now();
        const options = rs.map((x) => { const left = past ? 0 : x.capacity - taken(x, from, to); return { resourceId: x.id, name: x.name, available: left > 0, spotsLeft: Math.max(0, left), price: priceFor(x, from, len, 1) }; });
        const avail = options.filter((o) => o.available);
        slots.push({ startsAt: new Date(from).toISOString(), endsAt: new Date(to).toISOString(), label: range(from, to), startLabel: label(from), available: avail.length > 0, fromPrice: Math.min(...(avail.length ? avail : options).map((o) => o.price)), options });
      }
      return { date, sport, minutes: len, slotMinutes: 60, durations, kind: rs[0].kind, slots, closedReason: null };
    },

    /** Returns the booking and the lines and total for its payment request. */
    hold(customerId: ID, businessId: ID, picks: SlotPick[]): { booking: SlotBooking; lines: { label: string; amount: number }[]; total: number } {
      const biz = opts.businesses.find((b) => b.id === businessId);
      if (!biz) throw Object.assign(new Error('This venue is no longer available.'), { status: 404, code: 'not_found' });
      for (const b of bookings.values()) if (b.customerId === customerId && b.businessId === businessId && b.status === 'held') b.status = 'released';
      const items: SlotBookingItem[] = [];
      for (const p of picks) {
        const res = resources.find((x) => x.id === p.resourceId && x.businessId === businessId);
        if (!res) throw Object.assign(new Error('That court or session isn’t available here.'), { status: 400, code: 'bad_resource' });
        const spots = res.kind === 'court' ? 1 : p.spots ?? 1;
        const from = Date.parse(p.startsAt), to = from + p.minutes * 60_000;
        if (from <= opts.now()) throw Object.assign(new Error('That time has passed. Choose a later slot.'), { status: 409, code: 'past' });
        const left = res.capacity - taken(res, from, to) - items.filter((i) => i.resourceId === res.id && Date.parse(i.startsAt) < to && Date.parse(i.endsAt) > from).reduce((n, i) => n + i.spots, 0);
        if (spots > left) throw Object.assign(new Error(res.kind === 'court' ? `${res.name} is already booked at ${label(from)}. Choose another court or time.` : `Only ${Math.max(0, left)} spots left in ${res.name} at ${label(from)}.`), { status: 409, code: 'slot_taken' });
        items.push({ resourceId: res.id, resourceName: res.name, sport: res.sport, startsAt: new Date(from).toISOString(), endsAt: new Date(to).toISOString(), spots, price: priceFor(res, from, p.minutes, spots) });
      }
      const total = items.reduce((n, i) => n + i.price, 0);
      const booking: Held = {
        id: opts.newId('sb'), businessId, businessName: biz.name, area: biz.area, address: biz.address, status: 'held', bookingRef: `VBS-${opts.code(4)}-${opts.code(4)}`, entryCode: null,
        total, expiresAt: new Date(opts.now() + HOLD_MS).toISOString(), paymentRequestId: '', items, paidAt: null, checkedInAt: null, customerId,
      };
      bookings.set(booking.id, booking);
      const lines = items.map((i) => ({ label: `${i.sport} · ${i.resourceName} · ${range(Date.parse(i.startsAt), Date.parse(i.endsAt))}${i.spots > 1 ? ` × ${i.spots}` : ''}`, amount: i.price }));
      return { booking, lines, total };
    },

    attachPaymentRequest(bookingId: ID, prId: ID) { const b = bookings.get(bookingId); if (b) b.paymentRequestId = prId; },

    markPaid(bookingId: ID) {
      const b = bookings.get(bookingId);
      if (!b || b.status === 'paid') return;
      b.status = 'paid';
      b.paidAt = new Date(opts.now()).toISOString();
      b.entryCode = `${opts.code(3)}-${opts.code(3)}`;
    },

    get(customerId: ID, id: ID): SlotBooking {
      const b = bookings.get(id);
      if (!b || b.customerId !== customerId) throw Object.assign(new Error('Booking not found.'), { status: 404, code: 'not_found' });
      if (b.status === 'held' && Date.parse(b.expiresAt) <= opts.now()) b.status = 'released';
      const { customerId: _c, ...pub } = b;
      void _c;
      return pub;
    },

    mine(customerId: ID): SlotBooking[] {
      return [...bookings.values()].filter((b) => b.customerId === customerId && b.status === 'paid').map(({ customerId: _c, ...pub }) => { void _c; return pub; })
        .sort((a, b) => Date.parse(b.items[0].startsAt) - Date.parse(a.items[0].startsAt));
    },

    release(customerId: ID, id: ID) { const b = bookings.get(id); if (b && b.customerId === customerId && b.status === 'held') b.status = 'released'; },
  };
}
