import { CHAT_LIMIT } from '../../chat';
import { createDemoApi } from '../demoApi';

const NOW = Date.parse('2026-11-10T06:00:00Z');

function setup() {
  let t = NOW;
  const api = createDemoApi({ latency: 0, now: () => t });
  const advance = (ms: number) => { t += ms; };
  /** Signed in, profile saved, and a match with Rohan (badminton) accepted. */
  const matched = async () => {
    const c = await api.requestOtp('9876543210');
    await api.verifyOtp(c.requestId, '123456');
    await api.saveSocialProfile({ gender: 'man', meetPreference: 'anyone', ageConfirmed18: true, ageBand: '25–29' });
    await api.requestOneOnOne('oo-badminton');
    await api.demo!.simulateHostAccepts('oo-badminton');
  };
  return { api, advance, matched };
}

describe('one-on-one chat', () => {
  it('opens only after the plan is accepted, between the two people', async () => {
    const { api } = setup();
    const c = await api.requestOtp('9876543210');
    await api.verifyOtp(c.requestId, '123456');
    await api.saveSocialProfile({ gender: 'man', meetPreference: 'anyone', ageConfirmed18: true, ageBand: '25–29' });
    await api.requestOneOnOne('oo-badminton');
    await expect(api.getOneOnOneChat('oo-badminton')).rejects.toMatchObject({ code: 'not_found' });
    await api.demo!.simulateHostAccepts('oo-badminton');
    const chat = await api.getOneOnOneChat('oo-badminton');
    expect(chat).toMatchObject({ status: 'open', used: 0, limit: CHAT_LIMIT });
    expect(chat.counterpart.firstName).toBe('Rohan');
    expect(chat.messages[0].from).toBe('system');
    expect(chat.messages[0].text).toMatch(/30 messages/);
  });

  it('sends validated quick replies and rejects anything else', async () => {
    const { api, matched } = setup();
    await matched();
    const dress = await api.sendOneOnOneMessage('oo-badminton', { template: 'dress', value: 'Red' });
    expect(dress.delivered).toBe(true);
    expect(dress.chat.messages.at(-1)).toMatchObject({ from: 'me', text: 'I’m wearing red', quick: true });
    const table = await api.sendOneOnOneMessage('oo-badminton', { template: 'table', value: '12' });
    expect(table.chat.messages.at(-1)?.text).toBe('I’m at table 12');
    await expect(api.sendOneOnOneMessage('oo-badminton', { template: 'seat', value: '100' })).rejects.toMatchObject({ code: 'bad_quick' });
    await expect(api.sendOneOnOneMessage('oo-badminton', { template: 'dress', value: 'Sparkly' })).rejects.toMatchObject({ code: 'bad_quick' });
    await expect(api.sendOneOnOneMessage('oo-badminton', { template: 'status', value: 'Send me your number' })).rejects.toMatchObject({ code: 'bad_quick' });
  });

  it('allows a short typed note about meeting up', async () => {
    const { api, matched } = setup();
    await matched();
    const r = await api.sendOneOnOneMessage('oo-badminton', { text: 'Black shirt, near the window' });
    expect(r.delivered).toBe(true);
    await expect(api.sendOneOnOneMessage('oo-badminton', { text: '   ' })).rejects.toMatchObject({ code: 'empty' });
    await expect(api.sendOneOnOneMessage('oo-badminton', { text: 'x'.repeat(81) })).rejects.toMatchObject({ code: 'too_long' });
  });

  it('stops at 30 messages in total, counting both people', async () => {
    const { api, matched } = setup();
    await matched();
    for (let i = 0; i < 14; i++) await api.sendOneOnOneMessage('oo-badminton', { template: 'status', value: 'I’m here' });
    for (let i = 0; i < 16; i++) await api.demo!.simulateChatReply('oo-badminton');
    const chat = await api.getOneOnOneChat('oo-badminton');
    expect(chat.used).toBe(30);
    expect(chat.status).toBe('limit_reached');
    await expect(api.sendOneOnOneMessage('oo-badminton', { template: 'status', value: 'I’m here' })).rejects.toMatchObject({ code: 'limit_reached' });
    await expect(api.demo!.simulateChatReply('oo-badminton')).rejects.toMatchObject({ code: 'chat_closed' });
  });

  it('closes the chat and blocks both people when a number is shared', async () => {
    const { api, matched } = setup();
    await matched();
    const r = await api.sendOneOnOneMessage('oo-badminton', { text: 'ok 98765 43210 is it' });
    expect(r).toMatchObject({ delivered: false, rejection: 'contact_shared' });
    expect(r.chat).toMatchObject({ status: 'closed', closedReason: 'contact_shared' });
    // The message itself is never stored or shown.
    expect(JSON.stringify(r.chat.messages)).not.toMatch(/98765/);
    expect(r.chat.messages.at(-1)?.from).toBe('system');
    // No more messages, and the other person's invites disappear (blocked).
    await expect(api.sendOneOnOneMessage('oo-badminton', { text: 'hello' })).rejects.toMatchObject({ code: 'chat_closed' });
    expect((await api.getOneOnOnes()).some((i) => i.host.id === 'm-rohan')).toBe(false);
    // Flagged for moderators.
    const log = await api.demo!.moderationLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ kind: 'contact_shared', inviteId: 'oo-badminton', reason: 'phone' });
  });

  it('catches a number typed in pieces', async () => {
    const { api, matched } = setup();
    await matched();
    expect((await api.sendOneOnOneMessage('oo-badminton', { text: '98765' })).delivered).toBe(true);
    const r = await api.sendOneOnOneMessage('oo-badminton', { text: '43210' });
    expect(r.rejection).toBe('contact_shared');
  });

  it('also closes for handles, emails and links', async () => {
    for (const text of ['find me on insta', 'it is rohan@gmail.com', 'www.mysite.in']) {
      const { api, matched } = setup();
      await matched();
      expect((await api.sendOneOnOneMessage('oo-badminton', { text })).rejection).toBe('contact_shared');
    }
  });

  it('closes when the plan is cancelled or the person is blocked', async () => {
    const a = setup();
    await a.matched();
    await a.api.cancelOneOnOne('oo-badminton');
    expect((await a.api.getOneOnOneChat('oo-badminton')).closedReason).toBe('cancelled');

    const b = setup();
    await b.matched();
    await b.api.block('m-rohan');
    expect((await b.api.getOneOnOneChat('oo-badminton')).closedReason).toBe('blocked');
  });

  it('closes after the meetup is over', async () => {
    const { api, advance, matched } = setup();
    await matched();
    advance(9 * 86_400_000);
    const chat = await api.getOneOnOneChat('oo-badminton');
    expect(chat).toMatchObject({ status: 'closed', closedReason: 'ended' });
  });

  it('works for the host too, after accepting a request', async () => {
    const { api, matched } = setup();
    await matched();
    const startsAt = new Date(NOW + 2 * 86_400_000).toISOString();
    const mine = await api.createOneOnOne({ kind: 'sport', activity: 'Shuttle badminton', venueBusinessId: 'b-smash', startsAt, openTo: 'men' });
    const withReq = await api.demo!.simulateJoinRequest(mine.id);
    await api.respondOneOnOne(mine.id, withReq.requests[0].id, true);
    const chat = await api.getOneOnOneChat(mine.id);
    expect(chat.status).toBe('open');
    expect(chat.counterpart.id).toBe(withReq.requests[0].id);
    expect((await api.sendOneOnOneMessage(mine.id, { template: 'spot', value: 'I’m by the window' })).delivered).toBe(true);
  });
});

describe('one-on-one places: VIBE recommendations only', () => {
  const when = new Date(NOW + 2 * 86_400_000).toISOString();
  async function signedIn() {
    const { api } = setup();
    const c = await api.requestOtp('9876543210');
    await api.verifyOtp(c.requestId, '123456');
    await api.saveSocialProfile({ gender: 'woman', meetPreference: 'anyone', ageConfirmed18: true, ageBand: '30–34' });
    return api;
  }

  it('accepts a listed place that suits the activity and takes its name and area from the listing', async () => {
    const api = await signedIn();
    const inv = await api.createOneOnOne({ kind: 'coffee', activity: 'Coffee', venueBusinessId: 'b-matcha', startsAt: when, openTo: 'anyone' });
    expect(inv).toMatchObject({ venueName: 'Matcha Lab', venueBusinessId: 'b-matcha', area: 'Madhapur' });
  });

  it('rejects places that are not VIBE listings', async () => {
    const api = await signedIn();
    await expect(api.createOneOnOne({ kind: 'coffee', activity: 'Coffee', venueBusinessId: 'b-not-a-place', startsAt: when, openTo: 'anyone' })).rejects.toMatchObject({ code: 'venue' });
    await expect(api.createOneOnOne({ kind: 'coffee', activity: 'Coffee', venueBusinessId: '', startsAt: when, openTo: 'anyone' })).rejects.toMatchObject({ code: 'venue' });
  });

  it('rejects a listed place that does not suit the activity', async () => {
    const api = await signedIn();
    await expect(api.createOneOnOne({ kind: 'coffee', activity: 'Coffee', venueBusinessId: 'b-pulse', startsAt: when, openTo: 'anyone' })).rejects.toMatchObject({ code: 'venue' });
    await expect(api.createOneOnOne({ kind: 'sport', activity: 'Badminton', venueBusinessId: 'b-matcha', startsAt: when, openTo: 'anyone' })).rejects.toMatchObject({ code: 'venue' });
  });

  it('every seeded invite is at a listed VIBE business', async () => {
    const api = await signedIn();
    const all = await api.getOneOnOnes();
    expect(all.length).toBeGreaterThan(0);
    const places = new Set((await api.searchBusinesses({})).map((b) => b.id));
    for (const i of all) expect(places.has(i.venueBusinessId)).toBe(true);
  });
});
