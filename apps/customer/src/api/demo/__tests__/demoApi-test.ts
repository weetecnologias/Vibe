import { ApiError } from '../../client';
import { createDemoApi } from '../demoApi';

function setup() {
  let t = Date.parse('2026-11-09T06:00:00Z');
  const api = createDemoApi({ latency: 0, verifyAfterMs: 1000, now: () => t });
  const advance = (ms: number) => { t += ms; };
  const signIn = async () => {
    const c = await api.requestOtp('9876543210');
    await api.verifyOtp(c.requestId, '123456');
  };
  return { api, advance, signIn };
}

const code = (e: unknown) => (e instanceof ApiError ? e.code : String(e));

describe('demo auth', () => {
  it('rejects invalid numbers and locks the OTP after 3 wrong codes', async () => {
    const { api } = setup();
    await expect(api.requestOtp('12345')).rejects.toMatchObject({ code: 'invalid_phone' });
    const c = await api.requestOtp('9876543210');
    for (let i = 0; i < 3; i++) await expect(api.verifyOtp(c.requestId, '000000')).rejects.toMatchObject({ code: 'otp_invalid' });
    await expect(api.verifyOtp(c.requestId, '123456')).rejects.toMatchObject({ code: 'otp_locked' });
  });

  it('requires sign-in for money actions', async () => {
    const { api } = setup();
    await expect(api.createRedemption('o-saffron-30')).rejects.toMatchObject({ status: 401 });
  });
});

describe('Pay & Redeem', () => {
  it('prices the bill on the server and shows success only after verification', async () => {
    const { api, advance, signIn } = setup();
    await signIn();
    const red = await api.createRedemption('o-saffron-30');
    expect(red.status).toBe('awaiting_bill');

    const billed = await api.demo!.simulateMerchantBill(red.id, 100000);
    expect(billed.paymentRequest).toMatchObject({ eligibleAmount: 100000, discount: 30000, payable: 70000 });

    const start = await api.startPayment(billed.paymentRequest!.id, 'upi', 'key-1');
    expect((await api.getPayment(start.reference)).status).toBe('pending');

    advance(1500);
    const paid = await api.getPayment(start.reference);
    expect(paid.status).toBe('verified');
    expect(paid.providerPaymentId).toMatch(/^pay_demo_/);
    expect((await api.getRedemption(red.id)).status).toBe('paid');
  });

  it('is idempotent: the same key never creates a second payment', async () => {
    const { api, signIn } = setup();
    await signIn();
    const red = await api.demo!.simulateMerchantBill((await api.createRedemption('o-saffron-30')).id, 100000);
    const a = await api.startPayment(red.paymentRequest!.id, 'upi', 'same-key');
    const b = await api.startPayment(red.paymentRequest!.id, 'upi', 'same-key');
    expect(a.reference).toBe(b.reference);
    // A different key for a bill that is already being paid is refused.
    await expect(api.startPayment(red.paymentRequest!.id, 'card', 'other-key')).rejects.toMatchObject({ code: 'already_paid' });
  });

  it('applies savings exactly once even if status is polled many times', async () => {
    const { api, advance, signIn } = setup();
    await signIn();
    const before = (await api.getMembership()).savings.total;
    const red = await api.demo!.simulateMerchantBill((await api.createRedemption('o-saffron-30')).id, 100000);
    const { reference } = await api.startPayment(red.paymentRequest!.id, 'upi', 'k');
    advance(2000);
    for (let i = 0; i < 5; i++) await api.getPayment(reference);
    expect((await api.getMembership()).savings.total - before).toBe(30000);
  });

  it('limits one redemption per offer per day', async () => {
    const { api, advance, signIn } = setup();
    await signIn();
    const red = await api.demo!.simulateMerchantBill((await api.createRedemption('o-saffron-30')).id, 100000);
    const { reference } = await api.startPayment(red.paymentRequest!.id, 'upi', 'k');
    advance(2000);
    await api.getPayment(reference);
    await expect(api.createRedemption('o-saffron-30')).rejects.toMatchObject({ code: 'limit_reached' });
  });
});

describe('ticketing', () => {
  it('never oversells: holds inventory and rejects requests beyond what is left', async () => {
    const { api, signIn } = setup();
    await signIn();
    const ev = await api.getEvent('e-pottery'); // 6 seats, max 2 per order
    expect(ev.ticketTypes[0].remaining).toBe(6);

    for (let i = 0; i < 3; i++) await api.reserveTickets('e-pottery', [{ ticketTypeId: 'tt-pot', quantity: 2 }], ['Asha K', 'Ravi M']);
    expect((await api.getEvent('e-pottery')).ticketTypes[0].remaining).toBe(0);

    const err = await api.reserveTickets('e-pottery', [{ ticketTypeId: 'tt-pot', quantity: 1 }], ['Late Comer']).catch((e) => e);
    expect(code(err)).toBe('sold_out');
  });

  it('releases unpaid holds after they expire', async () => {
    const { api, advance, signIn } = setup();
    await signIn();
    await api.reserveTickets('e-pottery', [{ ticketTypeId: 'tt-pot', quantity: 2 }], ['Asha K', 'Ravi M']);
    expect((await api.getEvent('e-pottery')).ticketTypes[0].remaining).toBe(4);
    advance(11 * 60_000);
    expect((await api.getEvent('e-pottery')).ticketTypes[0].remaining).toBe(6);
  });

  it('enforces per-order limits and one name per ticket', async () => {
    const { api, signIn } = setup();
    await signIn();
    await expect(api.reserveTickets('e-pottery', [{ ticketTypeId: 'tt-pot', quantity: 3 }], ['A1', 'B1', 'C1'])).rejects.toMatchObject({ code: 'max_per_order' });
    await expect(api.reserveTickets('e-pottery', [{ ticketTypeId: 'tt-pot', quantity: 2 }], ['Only One'])).rejects.toMatchObject({ code: 'attendees' });
  });

  it('issues one ticket per attendee with unique admission codes after verified payment', async () => {
    const { api, advance, signIn } = setup();
    await signIn();
    const res = await api.reserveTickets('e-jazz', [{ ticketTypeId: 'tt-jazz-vip', quantity: 2 }], ['Aarav Reddy', 'Meera S']);
    expect(res.total).toBe(2 * 149900);
    const { reference } = await api.startPayment(res.paymentRequestId, 'upi', 'tix');
    expect(await api.getMyTickets()).toHaveLength(0); // nothing issued before verification
    advance(2000);
    const p = await api.getPayment(reference);
    expect(p.ticketIds).toHaveLength(2);
    const tickets = await api.getMyTickets();
    expect(tickets.map((t) => t.attendeeName)).toEqual(['Aarav Reddy', 'Meera S']);
    expect(new Set(tickets.map((t) => t.admissionCode)).size).toBe(2);
    expect(tickets.every((t) => t.status === 'valid')).toBe(true);
  });
});

describe('membership & social', () => {
  it('keeps benefits until the period ends after cancelling, then blocks member-only redemption', async () => {
    const { api, advance, signIn } = setup();
    await signIn();
    await api.cancelMembership();
    expect((await api.getOfferEligibility('o-saffron-30')).eligible).toBe(true);

    advance(31 * 86_400_000);
    expect((await api.getMembership()).status).toBe('none');
    expect((await api.getOfferEligibility('o-saffron-30')).eligible).toBe(false);
    await expect(api.createRedemption('o-saffron-30')).rejects.toMatchObject({ code: 'membership_required' });
    // Offers open to all users still work.
    expect((await api.getOfferEligibility('o-saffron-dessert')).eligible).toBe(true);
  });

  it('requires approval for approval-only activities and ID for age-restricted ones', async () => {
    const { api, signIn } = setup();
    await signIn();
    expect((await api.joinActivity('sa-dinner')).myStatus).toBe('requested');
    expect((await api.joinActivity('sa-run')).myStatus).toBe('joined');
    await expect(api.joinActivity('sa-speed')).rejects.toMatchObject({ code: 'id_verification_required' });
  });
});
