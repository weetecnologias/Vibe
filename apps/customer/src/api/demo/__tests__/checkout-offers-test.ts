import { istDayKey } from '../../../lib/dates';
import { createDemoApi } from '../demoApi';

// Tuesday 10 Nov 2026, 11:30 AM IST
const NOW = Date.parse('2026-11-10T06:00:00Z');
const today = istDayKey(new Date(NOW).toISOString());

async function signedIn() {
  let t = NOW;
  const api = createDemoApi({ latency: 0, verifyAfterMs: 1000, now: () => t });
  const c = await api.requestOtp('9876543210');
  await api.verifyOtp(c.requestId, '123456');
  return { api, advance: (ms: number) => { t += ms; } };
}
type Api = Awaited<ReturnType<typeof signedIn>>['api'];

/** Holds `n` seats at a show so the checkout bill is at least `min` paise (picks the priciest show). */
async function holdBill(api: Api, n: number) {
  for (const m of await api.getMovies({ status: 'now_showing' })) {
    for (const c of await api.getMovieShows(m.id, today)) {
      for (const s of c.shows.filter((x) => x.availability === 'available')) {
        const seats = (await api.getSeatMap(s.id)).rows.flatMap((r) => r.seats).filter((x) => x?.status === 'available').slice(0, n).map((x) => x!.id);
        if (seats.length === n) return api.holdSeats(s.id, seats);
      }
    }
  }
  throw new Error('no show');
}
const offerById = async (api: Api, prId: string, id: string) => (await api.getCheckoutOffers(prId)).available.find((o) => o.id === id)!;

describe('offers at checkout (demo backend)', () => {
  it('lists member and public offers with a reason for any that do not apply', async () => {
    const { api } = await signedIn();
    const hold = await holdBill(api, 6); // a big bill so every minimum is met
    const { applied, available } = await api.getCheckoutOffers(hold.paymentRequestId);
    expect(applied).toBeNull();
    expect(available.map((o) => o.code).sort()).toEqual(['GROUP100', 'MEMBERFLIX', 'WELCOME50'].sort()); // no event-only offer on a movie
    const flix = available.find((o) => o.code === 'MEMBERFLIX')!;
    expect(flix).toMatchObject({ memberOnly: true, eligible: true });
    expect(flix.saving).toBeGreaterThan(0);
    expect(available.every((o) => o.eligible === (o.reason === null))).toBe(true);
  });

  it('applies by id or by code (any case), reprices from the server and never stacks', async () => {
    const { api } = await signedIn();
    const hold = await holdBill(api, 4);
    const before = await api.getPaymentRequest(hold.paymentRequestId);
    const flix = await offerById(api, hold.paymentRequestId, 'co-member-movies');

    const a = await api.applyOffer(hold.paymentRequestId, 'memberflix');
    expect(a.appliedOffer).toMatchObject({ code: 'MEMBERFLIX', memberOnly: true });
    expect(a.discount).toBe(flix.saving);
    expect(a.payable).toBe(before.payable - flix.saving);

    // A second offer replaces the first; the discount is never added on top.
    const b = await api.applyOffer(hold.paymentRequestId, 'co-welcome');
    expect(b.appliedOffer?.code).toBe('WELCOME50');
    expect(b.discount).toBe(5000);
    expect(b.payable).toBe(before.payable - 5000);
    expect((await api.getPaymentRequest(hold.paymentRequestId)).payable).toBe(b.payable);

    const removed = await api.removeOffer(hold.paymentRequestId);
    expect(removed.appliedOffer).toBeNull();
    expect(removed.payable).toBe(before.payable);
    expect(removed.discount).toBe(0);
  });

  it('rejects unknown codes and offers for another kind of booking', async () => {
    const { api } = await signedIn();
    const hold = await holdBill(api, 2);
    await expect(api.applyOffer(hold.paymentRequestId, 'NOPE')).rejects.toMatchObject({ status: 404, code: 'invalid_code' });
    await expect(api.applyOffer(hold.paymentRequestId, '')).rejects.toMatchObject({ code: 'invalid_code' });
    await expect(api.applyOffer(hold.paymentRequestId, 'MEMBERLIVE')).rejects.toMatchObject({ status: 409, code: 'not_eligible' }); // event-only
    await expect(api.getCheckoutOffers('pr-missing')).rejects.toMatchObject({ status: 404 });
  });

  it('enforces the minimum bill with a reason', async () => {
    const { api } = await signedIn();
    const hold = await holdBill(api, 1);
    const group = await offerById(api, hold.paymentRequestId, 'co-group');
    expect(group.eligible).toBe(false);
    expect(group.reason).toMatch(/Spend ₹1,500/);
    await expect(api.applyOffer(hold.paymentRequestId, 'GROUP100')).rejects.toMatchObject({ code: 'not_eligible' });
  });

  it('keeps member offers for active members only', async () => {
    const { api, advance } = await signedIn();
    const hold = await holdBill(api, 4);
    expect((await offerById(api, hold.paymentRequestId, 'co-member-movies')).eligible).toBe(true);
    await api.cancelMembership();
    expect((await offerById(api, hold.paymentRequestId, 'co-member-movies')).eligible).toBe(true); // paid period still running
    advance(40 * 86_400_000); // the paid period has ended (the bill itself has long expired)
    expect(await offerById(api, hold.paymentRequestId, 'co-member-movies')).toMatchObject({ eligible: false, reason: 'For VIBE members.' });
    await expect(api.applyOffer(hold.paymentRequestId, 'MEMBERFLIX')).rejects.toMatchObject({ code: 'expired' });
  });

  it('charges the offer price, records the saving on the payment and on the ticket total', async () => {
    const { api, advance } = await signedIn();
    const hold = await holdBill(api, 4);
    const base = (await api.getPaymentRequest(hold.paymentRequestId)).payable;
    const applied = await api.applyOffer(hold.paymentRequestId, 'MEMBERFLIX');
    const start = await api.startPayment(hold.paymentRequestId, 'upi', 'offer-1');
    const pending = await api.getPayment(start.reference);
    expect(pending).toMatchObject({ amount: applied.payable, savings: applied.discount, offerTitle: applied.appliedOffer!.title });
    expect(pending.amount).toBe(base - applied.discount);
    advance(1500);
    expect((await api.getPayment(start.reference)).status).toBe('verified');
    expect(await api.getMyTickets()).toHaveLength(4);
  });

  it('locks the offer once payment has started', async () => {
    const { api } = await signedIn();
    const hold = await holdBill(api, 2);
    await api.applyOffer(hold.paymentRequestId, 'WELCOME50');
    await api.startPayment(hold.paymentRequestId, 'upi', 'lock-1');
    await expect(api.removeOffer(hold.paymentRequestId)).rejects.toMatchObject({ status: 409, code: 'locked' });
    await expect(api.applyOffer(hold.paymentRequestId, 'GROUP100')).rejects.toMatchObject({ code: 'locked' });
  });

  it('allows the welcome offer on the first paid booking only', async () => {
    const { api, advance } = await signedIn();
    const first = await holdBill(api, 2);
    await api.applyOffer(first.paymentRequestId, 'WELCOME50');
    const start = await api.startPayment(first.paymentRequestId, 'upi', 'w-1');
    advance(1500);
    expect((await api.getPayment(start.reference)).status).toBe('verified');

    const second = await holdBill(api, 2);
    const w = await offerById(api, second.paymentRequestId, 'co-welcome');
    expect(w).toMatchObject({ eligible: false, reason: 'For your first booking only.' });
    await expect(api.applyOffer(second.paymentRequestId, 'WELCOME50')).rejects.toMatchObject({ code: 'not_eligible' });
  });

  it('requires sign-in', async () => {
    const api = createDemoApi({ latency: 0, now: () => NOW });
    await expect(api.getCheckoutOffers('pr-1')).rejects.toMatchObject({ status: 401 });
    await expect(api.applyOffer('pr-1', 'WELCOME50')).rejects.toMatchObject({ status: 401 });
  });
});
