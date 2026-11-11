import { istDayKey } from '../../../lib/dates';
import { ApiError } from '../../client';
import { businesses } from '../catalog';
import { createCinema, HOLD_MINUTES, MAX_SEATS } from '../cinema';
import { createDemoApi } from '../demoApi';

// Tuesday 10 Nov 2026, 11:30 AM IST
const NOW = Date.parse('2026-11-10T06:00:00Z');
const DAY = 86_400_000;
const today = istDayKey(new Date(NOW).toISOString());
const dayKey = (n: number) => istDayKey(new Date(NOW + n * DAY).toISOString());

const cinemas = businesses
  .filter((b) => b.primaryCategoryId.startsWith('movies.cinemas'))
  .map((b) => ({ id: b.id, name: b.name, area: b.area, distanceKm: b.distanceKm, coverUrl: b.coverUrl }));

function engine() {
  let t = NOW;
  let n = 0;
  const cinema = createCinema({ now: () => t, newId: (p) => `${p}-${++n}`, cinemas });
  return { cinema, advance: (ms: number) => { t += ms; } };
}

const code = (fn: () => unknown) => {
  try { fn(); } catch (e) { return e instanceof ApiError ? e.code : String(e); }
  return 'no error';
};

/** A show today that is still open for booking and has seats free. */
function openShow(cinema: ReturnType<typeof createCinema>) {
  for (const m of cinema.movies({ status: 'now_showing' })) {
    for (const c of cinema.showtimesForMovie(m.id, today)) {
      const s = c.shows.find((x) => x.availability === 'available');
      if (s) return s;
    }
  }
  throw new Error('no open show');
}

describe('films and showtimes', () => {
  it('lists running films, coming-soon films and filters by language', () => {
    const { cinema } = engine();
    const now = cinema.movies({ status: 'now_showing' });
    expect(now.length).toBeGreaterThanOrEqual(6);
    expect(cinema.movies({ status: 'coming_soon' }).map((m) => m.title)).toEqual(['Saffron Skies']);
    expect(cinema.movies({ language: 'English' }).every((m) => m.languages.includes('English'))).toBe(true);
    expect(() => cinema.movie('mv-nope')).toThrow(/no longer listed/);
  });

  it('shows which cinemas play a film, nearest first, with no shows that already started', () => {
    const { cinema } = engine();
    const m = cinema.movies({ status: 'now_showing' }).find((x) => cinema.showtimesForMovie(x.id, today).length > 1)!;
    const list = cinema.showtimesForMovie(m.id, today);
    expect(list.length).toBeGreaterThan(1);
    expect(list.map((c) => c.cinema.distanceKm)).toEqual([...list.map((c) => c.cinema.distanceKm)].sort((a, b) => a - b));
    for (const c of list) {
      for (const s of c.shows) expect(Date.parse(s.startsAt)).toBeGreaterThan(NOW);
      expect(c.shows.map((s) => Date.parse(s.startsAt))).toEqual(c.shows.map((s) => Date.parse(s.startsAt)).sort((a, b) => a - b));
    }
  });

  it('shows what each cinema runs, and only that cinema’s shows', () => {
    const { cinema } = engine();
    const films = cinema.showtimesForCinema('b-lotus', today);
    expect(films.length).toBeGreaterThan(0);
    for (const f of films) expect(f.shows.every((s) => s.screenName === 'Screen 1')).toBe(true); // single-screen cinema
    expect(code(() => cinema.showtimesForCinema('b-pulse', today))).toBe('not_found'); // a gym is not a cinema
  });

  it('has shows at every cinema on each of the next 6 days, and none after that', () => {
    const { cinema } = engine();
    for (const c of cinemas) {
      for (let d = 0; d < 6; d++) expect(cinema.showtimesForCinema(c.id, dayKey(d)).length).toBeGreaterThan(0);
      expect(cinema.showtimesForCinema(c.id, dayKey(7))).toEqual([]);
    }
  });

  it('only runs a film in a format it is made for', () => {
    const { cinema } = engine();
    for (const m of cinema.movies({ status: 'now_showing' })) {
      for (let d = 0; d < 6; d++) for (const c of cinema.showtimesForMovie(m.id, dayKey(d))) for (const s of c.shows) expect(m.formats).toContain(s.format);
    }
  });
});

describe('seat maps', () => {
  it('describes rows, classes, aisle gaps and a seat limit', () => {
    const { cinema } = engine();
    const show = openShow(cinema);
    const map = cinema.seatMap(show.id);
    expect(map.maxSeats).toBe(MAX_SEATS);
    expect(map.holdMinutes).toBe(HOLD_MINUTES);
    expect(map.classes.length).toBeGreaterThanOrEqual(2);
    const ids = map.rows.flatMap((r) => r.seats.filter(Boolean).map((s) => s!.id));
    expect(new Set(ids).size).toBe(ids.length); // no duplicate seats
    expect(map.rows.every((r) => map.classes.some((c) => c.id === r.classId))).toBe(true);
    expect(map.rows.some((r) => r.seats.includes(null))).toBe(true); // aisle
    expect(map.show.cinemaName).toBeTruthy();
  });

  it('is unknown for a made-up show', () => {
    expect(code(() => engine().cinema.seatMap('sh-nope'))).toBe('not_found');
  });
});

describe('seat holds never double-book', () => {
  const freeSeats = (cinema: ReturnType<typeof createCinema>, showId: string, n: number, forUser?: string) =>
    cinema.seatMap(showId, forUser).rows.flatMap((r) => r.seats).filter((s) => s && s.status === 'available').slice(0, n).map((s) => s!.id);

  it('holds seats at the right price and refuses the same seats to someone else', () => {
    const { cinema } = engine();
    const show = openShow(cinema);
    const [a, b] = freeSeats(cinema, show.id, 2);
    const h = cinema.hold(show.id, [a, b], 'user-1');
    expect(h.seats).toHaveLength(2);
    expect(h.total).toBe(h.seats.reduce((n, s) => n + s.price, 0));
    expect(code(() => cinema.hold(show.id, [a], 'user-2'))).toBe('seat_taken');
    expect(code(() => cinema.hold(show.id, [b, ...freeSeats(cinema, show.id, 1, 'user-2').filter((x) => x !== a && x !== b)], 'user-2'))).toBe('seat_taken');
    // The seats show as unavailable to others, but free to the person holding them.
    const others = cinema.seatMap(show.id, 'user-2').rows.flatMap((r) => r.seats).find((s) => s?.id === a);
    expect(others?.status).toBe('unavailable');
    const mine = cinema.seatMap(show.id, 'user-1').rows.flatMap((r) => r.seats).find((s) => s?.id === a);
    expect(mine?.status).toBe('available');
  });

  it('lets a customer change their mind: a new hold replaces their old unpaid one', () => {
    const { cinema } = engine();
    const show = openShow(cinema);
    const [a, b] = freeSeats(cinema, show.id, 2);
    cinema.hold(show.id, [a], 'user-1');
    cinema.hold(show.id, [b], 'user-1');
    expect(() => cinema.hold(show.id, [a], 'user-2')).not.toThrow(); // `a` was released
    expect(code(() => cinema.hold(show.id, [b], 'user-2'))).toBe('seat_taken');
  });

  it('releases unpaid holds after the hold time', () => {
    const { cinema, advance } = engine();
    const show = openShow(cinema);
    const [a] = freeSeats(cinema, show.id, 1);
    cinema.hold(show.id, [a], 'user-1');
    advance((HOLD_MINUTES - 1) * 60_000);
    expect(code(() => cinema.hold(show.id, [a], 'user-2'))).toBe('seat_taken');
    advance(2 * 60_000);
    expect(() => cinema.hold(show.id, [a], 'user-2')).not.toThrow();
  });

  it('keeps seats while a payment is in flight, even past the hold time', () => {
    const { cinema, advance } = engine();
    const show = openShow(cinema);
    const [a] = freeSeats(cinema, show.id, 1);
    const h = cinema.hold(show.id, [a], 'user-1');
    cinema.lock(h.holdId);
    advance((HOLD_MINUTES + 5) * 60_000);
    expect(code(() => cinema.hold(show.id, [a], 'user-2'))).toBe('seat_taken');
    expect(cinema.markPaid(h.holdId).seats.map((s) => s.id)).toEqual([a]);
  });

  it('makes paid seats permanently unavailable, and marking paid twice is harmless', () => {
    const { cinema, advance } = engine();
    const show = openShow(cinema);
    const [a] = freeSeats(cinema, show.id, 1);
    const h = cinema.hold(show.id, [a], 'user-1');
    cinema.lock(h.holdId);
    cinema.markPaid(h.holdId);
    cinema.markPaid(h.holdId);
    advance(60 * 60_000);
    expect(code(() => cinema.hold(show.id, [a], 'user-2'))).toBe('seat_taken');
  });

  it('cannot pay for a hold that expired and was released', () => {
    const { cinema, advance } = engine();
    const show = openShow(cinema);
    const [a] = freeSeats(cinema, show.id, 1);
    const h = cinema.hold(show.id, [a], 'user-1');
    advance((HOLD_MINUTES + 1) * 60_000);
    cinema.seatMap(show.id); // any read releases expired holds
    expect(code(() => cinema.markPaid(h.holdId))).toBe('expired');
  });

  it('enforces the seat limit, valid seats and an open show', () => {
    const { cinema, advance } = engine();
    const show = openShow(cinema);
    const many = freeSeats(cinema, show.id, MAX_SEATS + 1);
    expect(code(() => cinema.hold(show.id, many, 'u'))).toBe('max_seats');
    expect(code(() => cinema.hold(show.id, [], 'u'))).toBe('empty');
    expect(code(() => cinema.hold(show.id, ['Z99'], 'u'))).toBe('bad_seat');
    expect(code(() => cinema.hold('sh-nope', ['A1'], 'u'))).toBe('not_found');
    // The same seat listed twice counts once.
    const [a] = many;
    expect(cinema.hold(show.id, [a, a], 'u').seats).toHaveLength(1);
    // Booking closes shortly before the show starts.
    advance(Date.parse(show.startsAt) - NOW - 5 * 60_000);
    expect(code(() => cinema.hold(show.id, [many[1]], 'u2'))).toBe('show_closed');
  });
});

describe('booking and paying (demo backend)', () => {
  async function signedIn() {
    let t = NOW;
    const api = createDemoApi({ latency: 0, verifyAfterMs: 1000, now: () => t });
    const c = await api.requestOtp('9876543210');
    await api.verifyOtp(c.requestId, '123456');
    return { api, advance: (ms: number) => { t += ms; } };
  }

  async function firstOpenShow(api: Awaited<ReturnType<typeof signedIn>>['api']) {
    for (const m of await api.getMovies({ status: 'now_showing' })) {
      for (const c of await api.getMovieShows(m.id, today)) {
        const s = c.shows.find((x) => x.availability === 'available');
        if (s) return s;
      }
    }
    throw new Error('no open show');
  }

  it('turns a verified payment into one ticket per seat, with seat labels', async () => {
    const { api, advance } = await signedIn();
    const show = await firstOpenShow(api);
    const map = await api.getSeatMap(show.id);
    const seats = map.rows.flatMap((r) => r.seats).filter((s) => s?.status === 'available').slice(0, 2).map((s) => s!.id);

    const hold = await api.holdSeats(show.id, seats);
    const pr = await api.getPaymentRequest(hold.paymentRequestId);
    expect(pr).toMatchObject({ kind: 'movie', payable: hold.total, discount: 0 });
    expect(pr.lines.length).toBeGreaterThan(0);
    expect(await api.getMyTickets()).toHaveLength(0); // nothing issued before the payment is verified

    const start = await api.startPayment(hold.paymentRequestId, 'upi', 'movie-1');
    expect((await api.getPayment(start.reference)).status).toBe('pending');
    advance(1500);
    const paid = await api.getPayment(start.reference);
    expect(paid.status).toBe('verified');
    expect(paid.ticketIds).toHaveLength(2);

    const tickets = await api.getMyTickets();
    expect(tickets.map((t) => t.seatLabel).sort()).toEqual([...seats].sort());
    expect(tickets.every((t) => t.eventKind === 'Movies' && t.status === 'valid')).toBe(true);
    expect(new Set(tickets.map((t) => t.admissionCode)).size).toBe(2);

    // The seats are gone for everyone, including the person who bought them.
    const after = (await api.getSeatMap(show.id)).rows.flatMap((r) => r.seats).filter((s) => s && seats.includes(s.id));
    expect(after.every((s) => s!.status === 'unavailable')).toBe(true);
    await expect(api.holdSeats(show.id, [seats[0]])).rejects.toMatchObject({ code: 'seat_taken' });
  });

  it('paying twice with the same key never sells seats twice', async () => {
    const { api, advance } = await signedIn();
    const show = await firstOpenShow(api);
    const seat = (await api.getSeatMap(show.id)).rows.flatMap((r) => r.seats).find((s) => s?.status === 'available')!.id;
    const hold = await api.holdSeats(show.id, [seat]);
    const a = await api.startPayment(hold.paymentRequestId, 'upi', 'same');
    const b = await api.startPayment(hold.paymentRequestId, 'upi', 'same');
    expect(a.reference).toBe(b.reference);
    advance(2000);
    for (let i = 0; i < 4; i++) await api.getPayment(a.reference);
    expect(await api.getMyTickets()).toHaveLength(1);
  });

  it('refuses to start a payment once the hold has expired', async () => {
    const { api, advance } = await signedIn();
    const show = await firstOpenShow(api);
    const seat = (await api.getSeatMap(show.id)).rows.flatMap((r) => r.seats).find((s) => s?.status === 'available')!.id;
    const hold = await api.holdSeats(show.id, [seat]);
    advance((HOLD_MINUTES + 1) * 60_000);
    await expect(api.startPayment(hold.paymentRequestId, 'upi', 'late')).rejects.toMatchObject({ code: 'expired' });
    // And the seat is back on sale.
    const again = (await api.getSeatMap(show.id)).rows.flatMap((r) => r.seats).find((s) => s?.id === seat);
    expect(again?.status).toBe('available');
  });

  it('needs a signed-in customer to hold seats', async () => {
    const api = createDemoApi({ latency: 0, now: () => NOW });
    const show = await firstOpenShow(api as never);
    await expect(api.holdSeats(show.id, ['A1'])).rejects.toMatchObject({ status: 401 });
  });
});
