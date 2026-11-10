import { createDemoApi } from '../demoApi';
import { matchesFilter, matchesWhen, NEAR_ME_KM } from '../socialFilter';

// Tuesday 10 Nov 2026, 3:30 PM IST
const NOW = Date.parse('2026-11-10T10:00:00Z');
const at = (iso: string) => new Date(iso).toISOString();

describe('matchesWhen', () => {
  it('keeps everything for any time', () => {
    expect(matchesWhen(at('2020-01-01T00:00:00Z'), 'any', NOW)).toBe(true);
    expect(matchesWhen(at('2030-01-01T00:00:00Z'), undefined, NOW)).toBe(true);
  });

  it('within an hour = starts in the next 60 minutes', () => {
    expect(matchesWhen(at('2026-11-10T10:40:00Z'), 'hour', NOW)).toBe(true);
    expect(matchesWhen(at('2026-11-10T11:00:00Z'), 'hour', NOW)).toBe(true);
    expect(matchesWhen(at('2026-11-10T11:01:00Z'), 'hour', NOW)).toBe(false);
    expect(matchesWhen(at('2026-11-10T09:59:00Z'), 'hour', NOW)).toBe(false); // already started
  });

  it('today = the rest of today in India time', () => {
    expect(matchesWhen(at('2026-11-10T18:00:00Z'), 'today', NOW)).toBe(true); // 11:30 PM IST
    expect(matchesWhen(at('2026-11-10T18:31:00Z'), 'today', NOW)).toBe(false); // 12:01 AM IST, tomorrow
    expect(matchesWhen(at('2026-11-10T09:00:00Z'), 'today', NOW)).toBe(false); // earlier today, over
  });

  it('this week = the next 7 days', () => {
    expect(matchesWhen(at('2026-11-16T10:00:00Z'), 'week', NOW)).toBe(true);
    expect(matchesWhen(at('2026-11-17T10:00:00Z'), 'week', NOW)).toBe(true);
    expect(matchesWhen(at('2026-11-17T10:01:00Z'), 'week', NOW)).toBe(false);
  });

  it('combines time and distance', () => {
    const soonNear = { startsAt: at('2026-11-10T10:30:00Z'), distanceKm: 1 };
    const soonFar = { startsAt: at('2026-11-10T10:30:00Z'), distanceKm: NEAR_ME_KM + 0.5 };
    expect(matchesFilter(soonNear, { when: 'hour', nearMe: true }, NOW)).toBe(true);
    expect(matchesFilter(soonFar, { when: 'hour', nearMe: true }, NOW)).toBe(false);
    expect(matchesFilter(soonFar, { when: 'hour' }, NOW)).toBe(true);
  });
});

describe('social feed filters (demo backend, real clock)', () => {
  async function signedIn() {
    const api = createDemoApi({ latency: 0 });
    const c = await api.requestOtp('9876543210');
    await api.verifyOtp(c.requestId, '123456');
    await api.saveSocialProfile({ gender: 'man', meetPreference: 'anyone', ageConfirmed18: true, ageBand: '25–29' });
    return api;
  }

  it('returns only activities starting within the hour', async () => {
    const api = await signedIn();
    const { activities } = await api.getSocialFeed({ when: 'hour' });
    expect(activities.map((a) => a.id)).toEqual(['sa-chai-soon']);
  });

  it('near me keeps only places within 3 km, groups always come back', async () => {
    const api = await signedIn();
    const all = await api.getSocialFeed();
    const near = await api.getSocialFeed({ nearMe: true });
    expect(near.activities.length).toBeGreaterThan(0);
    expect(near.activities.length).toBeLessThan(all.activities.length);
    expect(near.activities.every((a) => a.distanceKm <= NEAR_ME_KM)).toBe(true);
    expect(near.groups).toEqual(all.groups);
  });

  it('sorts activities by start time', async () => {
    const api = await signedIn();
    const { activities } = await api.getSocialFeed();
    const times = activities.map((a) => Date.parse(a.startsAt));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('filters open one-on-one invites but always keeps my own plans', async () => {
    const api = await signedIn();
    expect((await api.getOneOnOnes({ when: 'hour' })).map((i) => i.id)).toEqual(['oo-soon']);

    const startsAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const mine = await api.createOneOnOne({ kind: 'sport', activity: 'Badminton', venueBusinessId: 'b-smash', startsAt, openTo: 'anyone' });
    expect(mine.distanceKm).toBeGreaterThan(NEAR_ME_KM); // Smash Arena is 3.2 km
    const near = await api.getOneOnOnes({ when: 'hour', nearMe: true });
    expect(near.map((i) => i.id)).toContain(mine.id);
    expect(near.filter((i) => i.myStatus === 'none').every((i) => i.distanceKm <= NEAR_ME_KM)).toBe(true);
  });
});
