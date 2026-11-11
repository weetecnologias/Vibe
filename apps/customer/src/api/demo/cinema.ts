/**
 * DEMO DATA + RULES — development and testing only. Every film here is fictional.
 *
 * Stands in for the cinema side of the backend: which films are running, which
 * cinemas play them and when, each screen's seat layout, and the seat holds that
 * stop two people booking the same seat. The production backend gets this from
 * each cinema (their own system, an aggregator, or the VIBE merchant dashboard)
 * behind the same contract. See docs/movie-booking-integration.md.
 */
import { istDayKey } from '../../lib/dates';
import { ApiError } from '../client';
import type {
  CinemaShows, ID, MovieDetail, MovieFormat, MovieShows, MovieSummary, SeatClass, SeatMap, ShowAvailability, ShowDetail, ShowSummary,
} from '../types';
import { atIST, r } from './data';

export const MAX_SEATS = 6;
export const HOLD_MINUTES = 8;
/** Online booking closes this long before the show starts. */
const BOOKING_CLOSES_MIN = 10;

export type CinemaInfo = { id: ID; name: string; area: string; distanceKm: number; coverUrl: string | null };

type RowDef = { label: string; classId: string; seats: number; aisleAfter: number };
type ScreenDef = { id: string; cinemaId: ID; name: string; format: MovieFormat; classes: SeatClass[]; rows: RowDef[] };
type Show = { id: ID; movieId: ID; screenId: string; startsAt: string; language: string; format: MovieFormat };
type Hold = { id: ID; showId: ID; userId: ID; seatIds: string[]; expiresAt: number; status: 'held' | 'paid' | 'released'; locked: boolean };

// ---------- films ----------
function buildMovies(now: Date): MovieDetail[] {
  const base = { posterUrl: null, votes: 0 };
  return [
    { ...base, id: 'mv-biryani', title: 'Midnight Biryani', certificate: 'UA', durationMin: 142, genres: ['Comedy', 'Drama'], languages: ['Telugu', 'Hindi'], formats: ['2D'],
      rating: 8.2, votes: 12400, releaseDate: atIST(-12, 0, 0, now), status: 'now_showing', director: 'Ananya Rao', cast: ['Karthik Varma', 'Meera Iyer', 'Rohan Deshpande'],
      synopsis: 'A struggling cook has one night to cater a wedding for 500 guests. Nothing goes to plan, and everything turns out fine.' },
    { ...base, id: 'mv-charminar', title: 'The Last Charminar', certificate: 'U', durationMin: 128, genres: ['Drama', 'Historical'], languages: ['Telugu', 'Hindi'], formats: ['2D'],
      rating: 8.6, votes: 9800, releaseDate: atIST(-19, 0, 0, now), status: 'now_showing', director: 'Vikram Sethi', cast: ['Aarav Khan', 'Divya Menon'],
      synopsis: 'Three generations of a family in the Old City hold on to their craft as the neighbourhood changes around them.' },
    { ...base, id: 'mv-monsoon', title: 'Neon Monsoon', certificate: 'UA', durationMin: 118, genres: ['Thriller'], languages: ['Telugu', 'English'], formats: ['2D', 'Dolby Atmos'],
      rating: 7.4, votes: 6100, releaseDate: atIST(-5, 0, 0, now), status: 'now_showing', director: 'Sana Qureshi', cast: ['Imran Ali', 'Neha Kapoor'],
      synopsis: 'A taxi driver picks up a passenger on a rain-soaked night and finds himself in a city-wide chase.' },
    { ...base, id: 'mv-rani', title: 'Rocket Rani', certificate: 'U', durationMin: 104, genres: ['Animation', 'Family'], languages: ['Telugu', 'Hindi', 'English'], formats: ['2D', '3D'],
      rating: 8.0, votes: 5200, releaseDate: atIST(-8, 0, 0, now), status: 'now_showing', director: 'Priya Nair', cast: ['Voices of Kavya Reddy', 'Aditya Rao'],
      synopsis: 'A curious girl builds a rocket from kitchen junk and sets off to find where the moon goes in the daytime.' },
    { ...base, id: 'mv-chai', title: 'Chai Wars', certificate: 'UA', durationMin: 135, genres: ['Comedy'], languages: ['Telugu'], formats: ['2D'],
      rating: 7.1, votes: 3900, releaseDate: atIST(-3, 0, 0, now), status: 'now_showing', director: 'Ravi Teja Naidu', cast: ['Arjun Rao', 'Farah Sheikh'],
      synopsis: 'Two rival chai stalls on the same street, one shared customer base and a town-wide taste test.' },
    { ...base, id: 'mv-lake', title: 'Dark Lake', certificate: 'A', durationMin: 112, genres: ['Horror'], languages: ['Hindi', 'English'], formats: ['2D'],
      rating: 6.8, votes: 2700, releaseDate: atIST(-6, 0, 0, now), status: 'now_showing', director: 'Karan Malhotra', cast: ['Sana Mirza', 'Vikram Joshi'],
      synopsis: 'A group of friends rents a lake house for the weekend. The lake has other plans.' },
    { ...base, id: 'mv-riders', title: 'Sundown Riders', certificate: 'UA', durationMin: 156, genres: ['Action', 'Adventure'], languages: ['Telugu', 'Hindi', 'English'], formats: ['2D', 'IMAX', 'Dolby Atmos'],
      rating: 8.4, votes: 15800, releaseDate: atIST(-2, 0, 0, now), status: 'now_showing', director: 'Rajesh Kumar', cast: ['Aarav Khan', 'Kavya Reddy', 'Imran Ali'],
      synopsis: 'A retired stunt rider is pulled back for one last cross-country race against the clock.' },
    { ...base, id: 'mv-skies', title: 'Saffron Skies', certificate: 'U', durationMin: 131, genres: ['Drama', 'Romance'], languages: ['Telugu', 'Hindi'], formats: ['2D'],
      rating: null, votes: 0, releaseDate: atIST(9, 0, 0, now), status: 'coming_soon', director: 'Ananya Rao', cast: ['Meera Iyer', 'Rohan Deshpande'],
      synopsis: 'Two pilots, one monsoon season and a flight that changes both their plans.' },
  ];
}

// ---------- screens and seat layouts ----------
const range = (from: string, to: string) => Array.from({ length: to.charCodeAt(0) - from.charCodeAt(0) + 1 }, (_, i) => String.fromCharCode(from.charCodeAt(0) + i));
const rowsOf = (from: string, to: string, classId: string, seats: number, aisleAfter: number): RowDef[] => range(from, to).map((label) => ({ label, classId, seats, aisleAfter }));
const cls = (id: string, name: string, rupees: number): SeatClass => ({ id, name, price: r(rupees) });

const SCREENS: ScreenDef[] = [
  { id: 'sc-gal-1', cinemaId: 'b-galleriacine', name: 'Screen 1', format: 'Dolby Atmos', classes: [cls('silver', 'Silver', 180), cls('gold', 'Gold', 260), cls('recliner', 'Recliner', 450)],
    rows: [...rowsOf('A', 'D', 'silver', 14, 7), ...rowsOf('E', 'H', 'gold', 14, 7), ...rowsOf('I', 'J', 'recliner', 8, 4)] },
  { id: 'sc-gal-2', cinemaId: 'b-galleriacine', name: 'Screen 2', format: '2D', classes: [cls('silver', 'Silver', 150), cls('gold', 'Gold', 230)],
    rows: [...rowsOf('A', 'E', 'silver', 14, 7), ...rowsOf('F', 'J', 'gold', 14, 7)] },
  { id: 'sc-gal-3', cinemaId: 'b-galleriacine', name: 'Screen 3', format: '3D', classes: [cls('gold', 'Gold', 300), cls('recliner', 'Recliner', 480)],
    rows: [...rowsOf('A', 'G', 'gold', 12, 6), ...rowsOf('H', 'I', 'recliner', 8, 4)] },
  { id: 'sc-lot-1', cinemaId: 'b-lotus', name: 'Screen 1', format: '2D', classes: [cls('stalls', 'Stalls', 120), cls('balcony', 'Balcony', 180)],
    rows: [...rowsOf('A', 'F', 'stalls', 16, 8), ...rowsOf('G', 'J', 'balcony', 12, 6)] },
  { id: 'sc-lux-1', cinemaId: 'b-luxe', name: 'IMAX', format: 'IMAX', classes: [cls('lounge', 'Lounge recliner', 900), cls('imax', 'IMAX', 550)],
    rows: [...rowsOf('A', 'C', 'lounge', 8, 4), ...rowsOf('D', 'J', 'imax', 12, 6)] },
  { id: 'sc-lux-2', cinemaId: 'b-luxe', name: 'Atmos Hall', format: 'Dolby Atmos', classes: [cls('lounge', 'Lounge recliner', 700), cls('prime', 'Prime', 450)],
    rows: [...rowsOf('A', 'B', 'lounge', 8, 4), ...rowsOf('C', 'H', 'prime', 12, 6)] },
];

const SLOTS: [number, number][] = [[10, 15], [13, 20], [16, 30], [19, 40], [22, 45]];
const DAYS = 6;

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function buildShows(movies: MovieDetail[], now: Date): Show[] {
  const out: Show[] = [];
  for (const sc of SCREENS) {
    const eligible = movies.filter((m) => m.status === 'now_showing' && m.formats.includes(sc.format));
    if (!eligible.length) continue;
    for (let d = 0; d < DAYS; d++) {
      SLOTS.forEach(([hh, mm], slot) => {
        const m = eligible[(hash(sc.id) + d * 2 + slot) % eligible.length];
        out.push({ id: `sh-${sc.id}-${d}-${slot}`, movieId: m.id, screenId: sc.id, startsAt: atIST(d, hh, mm, now), language: m.languages[(slot + d) % m.languages.length], format: sc.format });
      });
    }
  }
  return out;
}

const seatIdsOf = (sc: ScreenDef) => sc.rows.flatMap((row) => Array.from({ length: row.seats }, (_, i) => `${row.label}${i + 1}`));

/** Seats other people have already bought for this show (deterministic, so the demo looks lived-in). */
function presold(show: Show, sc: ScreenDef): Set<string> {
  const h = hash(show.id);
  const fraction = h % 23 === 0 ? 1 : [0.12, 0.3, 0.45, 0.6, 0.78, 0.9][h % 6];
  let x = h || 1;
  const sold = new Set<string>();
  for (const id of seatIdsOf(sc)) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    if ((x % 1000) / 1000 < fraction) sold.add(id);
  }
  return sold;
}

const availabilityOf = (free: number, total: number): ShowAvailability =>
  free === 0 ? 'sold_out' : free / total < 0.15 ? 'almost_full' : free / total < 0.4 ? 'filling_fast' : 'available';

const fail = (status: number, code: string, message: string): never => {
  throw new ApiError(message, status, code);
};

type SeatLine = { id: string; label: string; classId: ID; className: string; price: number };

export function createCinema(deps: { now: () => number; newId: (prefix: string) => string; cinemas: CinemaInfo[] }) {
  const { now, newId } = deps;
  const movies = buildMovies(new Date(now()));
  const shows = buildShows(movies, new Date(now()));
  const showById = new Map(shows.map((s) => [s.id, s]));
  const movieById = new Map(movies.map((m) => [m.id, m]));
  const sold = new Map<string, Set<string>>();
  const holds = new Map<ID, Hold>();

  const screenOf = (id: string) => SCREENS.find((s) => s.id === id)!;
  const cinemaOf = (id: ID) => deps.cinemas.find((c) => c.id === id)!;
  const soldFor = (show: Show) => {
    if (!sold.has(show.id)) sold.set(show.id, presold(show, screenOf(show.screenId)));
    return sold.get(show.id)!;
  };

  /** Frees holds nobody paid for. A hold with a payment in progress ("locked") is never released early. */
  const releaseExpired = () => {
    for (const h of holds.values()) if (h.status === 'held' && !h.locked && h.expiresAt <= now()) h.status = 'released';
  };
  /** Seats currently held. `forUser` sees their own unpaid holds as free, so they can re-pick after going back. */
  const heldIds = (showId: ID, forUser?: ID) => {
    const set = new Set<string>();
    for (const h of holds.values()) {
      if (h.showId !== showId || h.status !== 'held') continue;
      if (forUser && h.userId === forUser && !h.locked) continue;
      h.seatIds.forEach((s) => set.add(s));
    }
    return set;
  };
  const unavailable = (show: Show, forUser?: ID) => new Set([...soldFor(show), ...heldIds(show.id, forUser)]);

  const summary = (show: Show): ShowSummary => {
    const sc = screenOf(show.screenId);
    const total = seatIdsOf(sc).length;
    return {
      id: show.id, startsAt: show.startsAt, language: show.language, format: show.format, screenName: sc.name,
      priceFrom: Math.min(...sc.classes.map((c) => c.price)), availability: availabilityOf(total - unavailable(show).size, total),
    };
  };
  const detail = (show: Show): ShowDetail => {
    const m = movieById.get(show.movieId)!;
    const c = cinemaOf(screenOf(show.screenId).cinemaId);
    return { ...summary(show), movieId: m.id, movieTitle: m.title, certificate: m.certificate, cinemaId: c.id, cinemaName: c.name, area: c.area };
  };
  const bookable = (show: Show) => Date.parse(show.startsAt) > now() + BOOKING_CLOSES_MIN * 60_000;
  const toSummary = (m: MovieDetail): MovieSummary => {
    const { synopsis, director, cast, ...s } = m;
    void synopsis; void director; void cast;
    return s;
  };
  const seatLines = (sc: ScreenDef, ids: string[]): SeatLine[] =>
    [...ids].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((id) => {
      const row = sc.rows.find((rw) => rw.label === id.match(/^[A-Z]+/)![0])!;
      const c = sc.classes.find((k) => k.id === row.classId)!;
      return { id, label: id, classId: c.id, className: c.name, price: c.price };
    });

  return {
    movies(filter: { status?: MovieSummary['status']; language?: string } = {}): MovieSummary[] {
      return movies
        .filter((m) => (!filter.status || m.status === filter.status) && (!filter.language || m.languages.includes(filter.language)))
        .map(toSummary);
    },

    movie(id: ID): MovieDetail {
      return movieById.get(id) ?? fail(404, 'not_found', 'This film is no longer listed.');
    },

    /** Which cinemas play a film on a day (YYYY-MM-DD, India time), nearest first, with showtimes. */
    showtimesForMovie(movieId: ID, date: string): CinemaShows[] {
      this.movie(movieId);
      releaseExpired();
      const byCinema = new Map<ID, ShowSummary[]>();
      for (const s of shows) {
        if (s.movieId !== movieId || istDayKey(s.startsAt) !== date || !bookable(s)) continue;
        const cid = screenOf(s.screenId).cinemaId;
        byCinema.set(cid, [...(byCinema.get(cid) ?? []), summary(s)]);
      }
      return [...byCinema]
        .map(([cid, list]) => ({ cinema: { ...cinemaOf(cid), coverUrl: undefined }, shows: list.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)) }))
        .map(({ cinema, shows: list }) => ({ cinema: { id: cinema.id, name: cinema.name, area: cinema.area, distanceKm: cinema.distanceKm }, shows: list }))
        .sort((a, b) => a.cinema.distanceKm - b.cinema.distanceKm);
    },

    /** What a cinema is running on a day, film by film. */
    showtimesForCinema(cinemaId: ID, date: string): MovieShows[] {
      if (!deps.cinemas.some((c) => c.id === cinemaId)) fail(404, 'not_found', 'This cinema isn’t taking online bookings yet.');
      releaseExpired();
      const byMovie = new Map<ID, ShowSummary[]>();
      for (const s of shows) {
        if (screenOf(s.screenId).cinemaId !== cinemaId || istDayKey(s.startsAt) !== date || !bookable(s)) continue;
        byMovie.set(s.movieId, [...(byMovie.get(s.movieId) ?? []), summary(s)]);
      }
      return [...byMovie].map(([mid, list]) => ({
        movie: toSummary(movieById.get(mid)!),
        shows: list.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)),
      })).sort((a, b) => b.movie.votes - a.movie.votes);
    },

    seatMap(showId: ID, forUser?: ID): SeatMap {
      releaseExpired();
      const show = showById.get(showId) ?? fail(404, 'not_found', 'This show is no longer available.');
      const sc = screenOf(show!.screenId);
      const taken = unavailable(show!, forUser);
      return {
        show: detail(show!),
        classes: sc.classes,
        maxSeats: MAX_SEATS,
        holdMinutes: HOLD_MINUTES,
        rows: sc.rows.map((row) => {
          const seats: SeatMap['rows'][number]['seats'] = [];
          for (let n = 1; n <= row.seats; n++) {
            const id = `${row.label}${n}`;
            seats.push({ id, number: n, status: taken.has(id) ? 'unavailable' : 'available' });
            if (n === row.aisleAfter && n < row.seats) seats.push(null); // aisle gap
          }
          return { label: row.label, classId: row.classId, seats };
        }),
      };
    },

    /** Holds seats for a few minutes while the customer pays. Two people can never hold the same seat. */
    hold(showId: ID, seatIds: string[], userId: ID) {
      releaseExpired();
      const show = showById.get(showId) ?? fail(404, 'not_found', 'This show is no longer available.');
      if (!bookable(show!)) fail(409, 'show_closed', 'Booking for this show has closed.');
      const ids = [...new Set(seatIds)];
      if (ids.length === 0) fail(400, 'empty', 'Choose at least one seat.');
      if (ids.length > MAX_SEATS) fail(400, 'max_seats', `You can book up to ${MAX_SEATS} seats at a time.`);
      const sc = screenOf(show!.screenId);
      const valid = new Set(seatIdsOf(sc));
      if (ids.some((s) => !valid.has(s))) fail(400, 'bad_seat', 'One of those seats doesn’t exist on this screen.');
      // A customer's earlier unpaid hold on this show never blocks them.
      for (const h of holds.values()) if (h.showId === showId && h.userId === userId && h.status === 'held' && !h.locked) h.status = 'released';
      const taken = unavailable(show!);
      const lost = ids.filter((s) => taken.has(s));
      if (lost.length) fail(409, 'seat_taken', `${lost.join(', ')} ${lost.length > 1 ? 'were' : 'was'} just taken. Please choose other seats.`);
      const hold: Hold = { id: newId('hold'), showId, userId, seatIds: ids, expiresAt: now() + HOLD_MINUTES * 60_000, status: 'held', locked: false };
      holds.set(hold.id, hold);
      const seats = seatLines(sc, ids);
      return { holdId: hold.id, show: detail(show!), seats, total: seats.reduce((n, s) => n + s.price, 0), expiresAt: new Date(hold.expiresAt).toISOString() };
    },

    /** Called when a payment starts, so the seats can't be released while money may be in flight. */
    lock(holdId: ID) {
      const h = holds.get(holdId);
      if (h && h.status === 'held') h.locked = true;
    },

    /** Called once the payment is verified: the seats become sold for good. Safe to call twice. */
    markPaid(holdId: ID) {
      const h = holds.get(holdId) ?? fail(410, 'expired', 'This booking has expired.');
      const show = showById.get(h!.showId)!;
      const sc = screenOf(show.screenId);
      if (h!.status === 'released') fail(410, 'expired', 'This booking has expired.');
      if (h!.status === 'held') {
        h!.status = 'paid';
        h!.seatIds.forEach((s) => soldFor(show).add(s));
      }
      const seats = seatLines(sc, h!.seatIds);
      return { show: detail(show), coverUrl: cinemaOf(sc.cinemaId).coverUrl, seats, total: seats.reduce((n, s) => n + s.price, 0) };
    },
  };
}
