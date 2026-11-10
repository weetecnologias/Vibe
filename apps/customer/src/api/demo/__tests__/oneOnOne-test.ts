import { createDemoApi } from '../demoApi';
import { accepts, canMeet } from '../matching';

describe('matching rules', () => {
  it('maps preferences to genders', () => {
    expect(accepts('anyone', 'nonbinary')).toBe(true);
    expect(accepts('men', 'man')).toBe(true);
    expect(accepts('men', 'woman')).toBe(false);
    expect(accepts('women', 'woman')).toBe(true);
    expect(accepts('women', 'undisclosed')).toBe(false);
  });

  it('requires both sides to be open to each other', () => {
    // Man who wants to meet women, host is a woman open to anyone → match.
    expect(canMeet({ gender: 'man', meetPreference: 'women' }, { gender: 'woman', openTo: 'anyone' })).toBe(true);
    // Man looking for men, woman host → no.
    expect(canMeet({ gender: 'man', meetPreference: 'men' }, { gender: 'woman', openTo: 'anyone' })).toBe(false);
    // Male-to-male: man open to men, host man open to men → yes.
    expect(canMeet({ gender: 'man', meetPreference: 'men' }, { gender: 'man', openTo: 'men' })).toBe(true);
    // Women-only invite hides from men even if they're open to anyone.
    expect(canMeet({ gender: 'man', meetPreference: 'anyone' }, { gender: 'woman', openTo: 'women' })).toBe(false);
  });
});

function setup() {
  let t = Date.parse('2026-11-10T06:00:00Z');
  const api = createDemoApi({ latency: 0, now: () => t });
  const signIn = async () => {
    const c = await api.requestOtp('9876543210');
    await api.verifyOtp(c.requestId, '123456');
  };
  return { api, signIn, advance: (ms: number) => { t += ms; } };
}

describe('one-on-one (demo backend)', () => {
  it('requires an 18+ social profile before showing anything', async () => {
    const { api, signIn } = setup();
    await signIn();
    expect(await api.getSocialProfile()).toBeNull();
    await expect(api.getOneOnOnes()).rejects.toMatchObject({ code: 'social_profile_required' });
    await expect(api.saveSocialProfile({ gender: 'man', meetPreference: 'anyone', ageConfirmed18: false, ageBand: '25–29' }))
      .rejects.toMatchObject({ code: 'age_restricted' });
  });

  it('only lists invites that work both ways', async () => {
    const { api, signIn } = setup();
    await signIn();
    await api.saveSocialProfile({ gender: 'man', meetPreference: 'anyone', ageConfirmed18: true, ageBand: '25–29' });
    const forAnyoneMan = await api.getOneOnOnes();
    expect(forAnyoneMan.every((i) => i.openTo !== 'women')).toBe(true);
    expect(forAnyoneMan.map((i) => i.id)).toEqual(expect.arrayContaining(['oo-badminton', 'oo-tennis', 'oo-coffee']));

    await api.saveSocialProfile({ gender: 'man', meetPreference: 'women', ageConfirmed18: true, ageBand: '25–29' });
    const forManSeekingWomen = await api.getOneOnOnes();
    expect(forManSeekingWomen.every((i) => i.host.gender === 'woman' && i.openTo !== 'women')).toBe(true);

    await api.saveSocialProfile({ gender: 'woman', meetPreference: 'women', ageConfirmed18: true, ageBand: '30–34' });
    const forWomanSeekingWomen = await api.getOneOnOnes();
    expect(forWomanSeekingWomen.map((i) => i.id)).toEqual(expect.arrayContaining(['oo-chai', 'oo-doubles']));
    expect(forWomanSeekingWomen.every((i) => i.host.gender === 'woman')).toBe(true);
  });

  it('refuses requests the host is not open to, even with a known id', async () => {
    const { api, signIn } = setup();
    await signIn();
    await api.saveSocialProfile({ gender: 'man', meetPreference: 'anyone', ageConfirmed18: true, ageBand: '25–29' });
    await expect(api.requestOneOnOne('oo-chai')).rejects.toMatchObject({ code: 'not_eligible' });
  });

  it('runs the request → accept flow and hides requests from non-hosts', async () => {
    const { api, signIn } = setup();
    await signIn();
    await api.saveSocialProfile({ gender: 'man', meetPreference: 'anyone', ageConfirmed18: true, ageBand: '25–29' });
    const req = await api.requestOneOnOne('oo-badminton');
    expect(req.myStatus).toBe('requested');
    expect(req.requests).toEqual([]);
    const ok = await api.demo!.simulateHostAccepts('oo-badminton');
    expect(ok.myStatus).toBe('confirmed');
    expect(ok.matchedWith?.firstName).toBe('Rohan');
  });

  it('lets a member post an invite, receive a request and accept it', async () => {
    const { api, signIn } = setup();
    await signIn();
    await api.saveSocialProfile({ gender: 'man', meetPreference: 'anyone', ageConfirmed18: true, ageBand: '25–29' });
    const startsAt = new Date(Date.parse('2026-11-10T06:00:00Z') + 2 * 86_400_000).toISOString();
    const mine = await api.createOneOnOne({ kind: 'sport', activity: 'Shuttle badminton', venueName: 'Smash Arena', venueBusinessId: 'b-smash', area: 'Kondapur', startsAt, openTo: 'men' });
    expect(mine.myStatus).toBe('host');
    const withReq = await api.demo!.simulateJoinRequest(mine.id);
    expect(withReq.requests).toHaveLength(1);
    expect(withReq.requests[0].gender).toBe('man'); // only men, as the invite says
    const matched = await api.respondOneOnOne(mine.id, withReq.requests[0].id, true);
    expect(matched.status).toBe('matched');
    expect(matched.matchedWith?.id).toBe(withReq.requests[0].id);
  });

  it('validates new invites', async () => {
    const { api, signIn } = setup();
    await signIn();
    await api.saveSocialProfile({ gender: 'woman', meetPreference: 'anyone', ageConfirmed18: true, ageBand: '30–34' });
    const soon = new Date(Date.parse('2026-11-10T06:10:00Z')).toISOString();
    await expect(api.createOneOnOne({ kind: 'coffee', activity: 'Coffee', venueName: 'Matcha Lab', venueBusinessId: 'b-matcha', area: 'Madhapur', startsAt: soon, openTo: 'anyone' }))
      .rejects.toMatchObject({ code: 'time' });
  });

  it('blocking a host hides their invites', async () => {
    const { api, signIn } = setup();
    await signIn();
    await api.saveSocialProfile({ gender: 'man', meetPreference: 'anyone', ageConfirmed18: true, ageBand: '25–29' });
    await api.block('m-rohan');
    expect((await api.getOneOnOnes()).some((i) => i.host.id === 'm-rohan')).toBe(false);
  });
});
