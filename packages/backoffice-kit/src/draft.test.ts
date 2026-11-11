import { describe, expect, it } from 'vitest';

import { emptyDraft, fromDraft, toDraft } from './draft';
import type { Profile } from './types';

const filled = () => ({ ...emptyDraft(), name: 'Saffron Courtyard', area: 'Jubilee Hills' });

describe('business form draft', () => {
  it('sends money in paise and hours as a full week', () => {
    const r = fromDraft({ ...filled(), costForTwo: '1,200.50', lat: '17.4326', lng: '78.4071', terms: 'Prices include taxes\n\n  Offers vary  ', photos: 'https://a.example/1.jpg\nhttps://a.example/2.jpg' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.profile.costForTwo).toBe(120050);
    expect(r.profile.lat).toBe(17.4326);
    expect(r.profile.terms).toEqual(['Prices include taxes', 'Offers vary']);
    expect(r.profile.photos).toHaveLength(2);
    expect(r.profile.hours).toHaveLength(7);
    expect(r.profile.hours[0]).toEqual({ dow: 0, opens: '09:00', closes: '22:00' });
  });

  it('sends a closed day as no times at all', () => {
    const d = filled();
    d.hours[6] = { open: false, opens: '09:00', closes: '22:00' };
    const r = fromDraft(d);
    expect(r.ok && r.profile.hours[6]).toEqual({ dow: 6, opens: null, closes: null });
  });

  it('says what is wrong in plain words', () => {
    expect(fromDraft({ ...filled(), name: ' ' })).toEqual({ ok: false, error: 'Enter the business name.' });
    expect(fromDraft({ ...filled(), area: '' })).toMatchObject({ ok: false });
    expect(fromDraft({ ...filled(), costForTwo: '12.345' })).toMatchObject({ ok: false, error: expect.stringContaining('rupees') });
    expect(fromDraft({ ...filled(), lat: '95' })).toMatchObject({ ok: false });
    expect(fromDraft({ ...filled(), lng: 'abc' })).toMatchObject({ ok: false });
    const noTimes = filled();
    noTimes.hours[2] = { open: true, opens: '', closes: '' };
    expect(fromDraft(noTimes)).toMatchObject({ ok: false, error: expect.stringContaining('Wednesday') });
  });

  it('round-trips a profile from the server', () => {
    const p: Profile = {
      name: 'Brew', area: 'Banjara Hills', address: 'Road 12', lat: 17.4, lng: 78.4, description: 'Cafe', logoUrl: null, coverUrl: 'https://x.example/c.jpg', priceLevel: 3, costForTwo: 45000,
      terms: ['One'], bookingEnabled: true, photos: ['https://x.example/p.jpg'], hours: [{ dow: 0, opens: '08:00', closes: '22:30' }, { dow: 1, opens: null, closes: null }],
    };
    const r = fromDraft(toDraft(p));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.profile).toMatchObject({ name: 'Brew', priceLevel: 3, costForTwo: 45000, bookingEnabled: true, coverUrl: 'https://x.example/c.jpg', logoUrl: null });
    expect(r.profile.hours[0]).toEqual({ dow: 0, opens: '08:00', closes: '22:30' });
    expect(r.profile.hours[1]).toEqual({ dow: 1, opens: null, closes: null });
    expect(r.profile.hours[5]).toEqual({ dow: 5, opens: null, closes: null }); // days not in the data are closed
  });
});
