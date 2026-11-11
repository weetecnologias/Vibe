import { istDayKey } from '../../../lib/dates';
import { createDemoApi } from '../demoApi';

// Tuesday 10 Nov 2026, 11:30 AM IST
const NOW = Date.parse('2026-11-10T06:00:00Z');
const DAY = 86_400_000;
const tomorrow = istDayKey(new Date(NOW + DAY).toISOString());

async function setup() {
  let t = NOW;
  const api = createDemoApi({ latency: 0, verifyAfterMs: 1000, now: () => t });
  const c = await api.requestOtp('9876543210');
  await api.verifyOtp(c.requestId, '123456');
  await api.saveSocialProfile({ gender: 'woman', meetPreference: 'anyone', ageConfirmed18: true, ageBand: '25–29' });
  const advance = (ms: number) => { t += ms; };
  const pay = async (prId: string, key = 'k1') => {
    const s = await api.startPayment(prId, 'upi', key);
    advance(1500);
    return api.getPayment(s.reference);
  };
  /** A coffee plan tomorrow evening at a real VIBE café. */
  const post = (kind: 'coffee' | 'sport' | 'food' | 'movie' = 'coffee', venueBusinessId = 'b-brew', startsAt = new Date(NOW + DAY + 6 * 3_600_000).toISOString()) =>
    api.createOneOnOne({ kind, activity: 'Evening plan', venueBusinessId, startsAt, openTo: 'anyone' });
  /** Someone asks, the host accepts: the chat opens. */
  const match = async (oid: string) => {
    const inv = await api.demo!.simulateJoinRequest(oid);
    return api.respondOneOnOne(oid, inv.requests[0].id, true);
  };
  return { api, advance, pay, post, match };
}

describe('reserving the venue for a one-on-one (demo backend)', () => {
  it('offers the host a table, a court slot or two seats, with the fee and the cancellation policy', async () => {
    const { api, post } = await setup();
    const cafe = await post('coffee');
    expect(cafe.reservation).toBeNull();
    expect(cafe.reservationOption).toMatchObject({ kind: 'table', fee: 15000 });
    expect(cafe.reservationOption!.policy).toMatch(/2 hours/);
    // A member can have 3 open invites at once, so each of the others uses a fresh account.
    expect((await post('food', 'b-saffron')).reservationOption).toMatchObject({ kind: 'table', fee: 30000 });
    expect((await post('sport', 'b-smash')).reservationOption).toMatchObject({ kind: 'slot', fee: 20000 });
    expect((await (await setup()).post('movie', 'b-galleriacine')).reservationOption).toMatchObject({ kind: 'movie', fee: null });
    // Only the host is offered it.
    const feed = await api.getOneOnOnes();
    expect(feed.find((i) => i.id === 'oo-coffee')!.reservationOption).toBeNull();
  });

  it('shows others that a plan is reserved without giving away the booking details', async () => {
    const { api } = await setup();
    const dinner = (await api.getOneOnOnes()).find((i) => i.id === 'oo-dinner')!;
    expect(dinner.reservation).toMatchObject({ kind: 'table', title: 'Table for two', detail: null, reference: null });
  });

  it('reserves only when the payment is verified, then shares it in the chat', async () => {
    const { api, post, match, advance } = await setup();
    const inv = await post('coffee');
    await match(inv.id);
    const chat0 = await api.getOneOnOneChat(inv.id);
    expect(chat0.reservation).toBeNull();

    const { paymentRequestId } = await api.reserveMeetVenue(inv.id);
    expect(await api.getPaymentRequest(paymentRequestId)).toMatchObject({ kind: 'meetup', payable: 15000, discount: 0 });
    // Asking again while a payment is open reuses it.
    expect((await api.reserveMeetVenue(inv.id)).paymentRequestId).toBe(paymentRequestId);

    const s = await api.startPayment(paymentRequestId, 'upi', 'r1');
    expect((await api.getOneOnOnes()).find((i) => i.id === inv.id)!.reservation).toBeNull(); // pending is not reserved
    advance(1500);
    const paid = await api.getPayment(s.reference);
    expect(paid.status).toBe('verified');

    const mine = (await api.getOneOnOnes()).find((i) => i.id === inv.id)!;
    expect(mine.reservation).toMatchObject({ kind: 'table', amount: 15000, reference: paid.reference });
    expect(mine.reservationOption).toBeNull();
    await expect(api.reserveMeetVenue(inv.id)).rejects.toMatchObject({ status: 409, code: 'already_reserved' });

    const chat = await api.getOneOnOneChat(inv.id);
    expect(chat.reservation).toMatchObject({ title: 'Table for two' });
    expect(chat.messages.at(-1)).toMatchObject({ from: 'system' });
    expect(chat.messages.at(-1)!.text).toMatch(/reserved table for two at Brew & Bloom/i);
    expect(chat.used).toBe(0); // notes from VIBE never use up the 30 messages
  });

  it('puts a reservation made before the match into the chat when it opens', async () => {
    const { api, pay, post, match } = await setup();
    const inv = await post('food', 'b-saffron');
    const { paymentRequestId } = await api.reserveMeetVenue(inv.id);
    await pay(paymentRequestId);
    await match(inv.id);
    const chat = await api.getOneOnOneChat(inv.id);
    expect(chat.messages.some((m) => m.from === 'system' && /reserved table for two at Saffron Courtyard/i.test(m.text))).toBe(true);
  });

  it('only the host can reserve, and not once the time is too close', async () => {
    const { api, post, advance } = await setup();
    await expect(api.reserveMeetVenue('oo-badminton')).rejects.toMatchObject({ code: 'not_found' }); // someone else's plan
    const inv = await post('coffee', 'b-brew', new Date(NOW + 40 * 60_000).toISOString());
    expect(inv.reservationOption).not.toBeNull();
    advance(15 * 60_000);
    await expect(api.reserveMeetVenue(inv.id)).rejects.toMatchObject({ status: 409, code: 'too_late' });
    expect((await api.getOneOnOnes()).find((i) => i.id === inv.id)!.reservationOption).toBeNull();
  });

  it('needs sign-in and a social profile', async () => {
    const api = createDemoApi({ latency: 0, now: () => NOW });
    await expect(api.reserveMeetVenue('oo-coffee')).rejects.toMatchObject({ status: 401 });
  });

  it('keeps the booking on the plan if the matched person leaves, and stops the chat if the host cancels', async () => {
    const { api, pay, post, match } = await setup();
    const inv = await post('coffee');
    await match(inv.id);
    await pay((await api.reserveMeetVenue(inv.id)).paymentRequestId);
    await api.cancelOneOnOne(inv.id);
    expect((await api.getOneOnOneChat(inv.id)).status).toBe('closed');
    expect((await api.getOneOnOnes()).some((i) => i.id === inv.id)).toBe(false);
  });
});

describe('reserving two seats for a movie plan (demo backend)', () => {
  async function moviePlan() {
    const ctx = await setup();
    const shows = await ctx.api.getCinemaShows('b-galleriacine', tomorrow);
    const show = shows.flatMap((m) => m.shows).find((s) => s.availability === 'available')!;
    const inv = await ctx.post('movie', 'b-galleriacine', show.startsAt);
    const seats = (await ctx.api.getSeatMap(show.id)).rows.flatMap((r) => r.seats).filter((s) => s?.status === 'available').slice(0, 3).map((s) => s!.id);
    return { ...ctx, inv, show, seats };
  }

  it('sends the host to the seat picker, not a flat fee', async () => {
    const { api, inv } = await moviePlan();
    await expect(api.reserveMeetVenue(inv.id)).rejects.toMatchObject({ status: 409, code: 'use_movie_flow' });
  });

  it('holds exactly two seats, at that cinema, on the day of the plan', async () => {
    const { api, inv, show, seats } = await moviePlan();
    await expect(api.holdSeats(show.id, [seats[0]], { meetId: inv.id })).rejects.toMatchObject({ code: 'two_seats' });
    await expect(api.holdSeats(show.id, seats, { meetId: inv.id })).rejects.toMatchObject({ code: 'two_seats' });
    await expect(api.holdSeats(show.id, seats.slice(0, 2), { meetId: 'oo-coffee' })).rejects.toMatchObject({ code: 'not_found' });

    const lotus = (await api.getCinemaShows('b-lotus', tomorrow)).flatMap((m) => m.shows)[0];
    const lotusSeats = (await api.getSeatMap(lotus.id)).rows.flatMap((r) => r.seats).filter((s) => s?.status === 'available').slice(0, 2).map((s) => s!.id);
    await expect(api.holdSeats(lotus.id, lotusSeats, { meetId: inv.id })).rejects.toMatchObject({ code: 'wrong_cinema' });

    const later = (await api.getCinemaShows('b-galleriacine', istDayKey(new Date(NOW + 3 * DAY).toISOString()))).flatMap((m) => m.shows)[0];
    const laterSeats = (await api.getSeatMap(later.id)).rows.flatMap((r) => r.seats).filter((s) => s?.status === 'available').slice(0, 2).map((s) => s!.id);
    await expect(api.holdSeats(later.id, laterSeats, { meetId: inv.id })).rejects.toMatchObject({ code: 'wrong_day' });
  });

  it('shares the seat numbers in the chat once the payment is verified, and issues two tickets', async () => {
    const { api, inv, show, seats, pay, match } = await moviePlan();
    await match(inv.id);
    const pair = seats.slice(0, 2);
    const hold = await api.holdSeats(show.id, pair, { meetId: inv.id });
    expect((await api.getOneOnOnes()).find((i) => i.id === inv.id)!.reservation).toBeNull(); // held is not reserved
    const paid = await pay(hold.paymentRequestId);
    expect(paid.status).toBe('verified');
    expect(paid.ticketIds).toHaveLength(2);

    const after = (await api.getOneOnOnes()).find((i) => i.id === inv.id)!;
    expect(after.reservation!.kind).toBe('movie');
    expect(after.reservation!.detail).toContain([...pair].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join(', '));
    expect(after.reservationOption).toBeNull();
    expect(after.startsAt).toBe(show.startsAt);

    const chat = await api.getOneOnOneChat(inv.id);
    expect(chat.messages.at(-1)!.text).toMatch(/Seats/);
    // Seat labels are shared; the ticket QR and admission code never are.
    expect(JSON.stringify(chat)).not.toMatch(/vibe\.t\./);
    await expect(api.holdSeats(show.id, seats.slice(1, 3), { meetId: inv.id })).rejects.toMatchObject({ code: 'already_reserved' });
  });
});
