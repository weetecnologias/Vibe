import { describe, expect, it } from 'vitest';

import { buildEvent, emptyEvent, eventToDraft, type EventDraft } from './eventDraft';
import { fromLocalInput } from './time';
import type { EventRow } from './types';

const filled = (): EventDraft => ({
  ...emptyEvent(), title: 'Biryani Masterclass', venue: 'Saffron Courtyard', area: 'Jubilee Hills', startsAt: '2027-01-15T19:30',
  tickets: [{ name: 'Seat', description: 'Includes lunch', price: '999.50', capacity: '20', maxPerOrder: '4' }],
});

describe('event form', () => {
  it('sends India time as a real instant, doors as a time, and money in paise', () => {
    const r = buildEvent({ ...filled(), doorsMinutes: '45', ageLimit: '18', terms: 'No outside food\n\n' }, false);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.startsAt).toBe('2027-01-15T14:00:00.000Z'); // 19:30 IST
    expect(r.input.gatesOpenAt).toBe('2027-01-15T13:15:00.000Z');
    expect(r.input.ticketTypes).toEqual([{ name: 'Seat', description: 'Includes lunch', price: 99950, capacity: 20, maxPerOrder: 4 }]);
    expect(r.input.ageLimit).toBe(18);
    expect(r.input.terms).toEqual(['No outside food']);
    expect('organiser' in r.input).toBe(false); // merchants don't set the organiser
  });

  it('lets an admin set the organiser and Featured', () => {
    const r = buildEvent({ ...filled(), organiser: 'VIBE Hosts', featured: true }, true);
    expect(r.ok && r.input.organiser).toBe('VIBE Hosts');
    expect(r.ok && r.input.featured).toBe(true);
  });

  it('says what is wrong in plain words', () => {
    expect(buildEvent({ ...filled(), title: '' }, false)).toMatchObject({ ok: false });
    expect(buildEvent({ ...filled(), area: '' }, false)).toMatchObject({ ok: false });
    expect(buildEvent({ ...filled(), doorsMinutes: 'x' }, false)).toMatchObject({ ok: false, error: expect.stringContaining('Doors') });
    expect(buildEvent({ ...filled(), ageLimit: '3' }, false)).toMatchObject({ ok: false, error: expect.stringContaining('age') });
    expect(buildEvent({ ...filled(), tickets: [] }, false)).toMatchObject({ ok: false, error: expect.stringContaining('ticket type') });
    const t = filled().tickets[0];
    expect(buildEvent({ ...filled(), tickets: [{ ...t, price: '12.345' }] }, false)).toMatchObject({ ok: false, error: expect.stringContaining('rupees') });
    expect(buildEvent({ ...filled(), tickets: [{ ...t, capacity: '' }] }, false)).toMatchObject({ ok: false, error: expect.stringContaining('available') });
    expect(buildEvent({ ...filled(), tickets: [{ ...t, maxPerOrder: '99' }] }, false)).toMatchObject({ ok: false });
    expect(buildEvent({ ...filled(), tickets: [t, { ...t, name: ' SEAT ' }] }, false)).toMatchObject({ ok: false, error: expect.stringContaining('own name') });
    expect(buildEvent({ ...filled(), tickets: [{ ...t, price: '0' }] }, false).ok).toBe(true); // free tickets are fine
  });

  it('fills the form back from what the server returned', () => {
    const row: EventRow = {
      id: 'e1', businessId: 'b1', businessName: 'Saffron', organiser: 'Saffron', title: 'Jazz', kind: 'Live Events', description: 'Live', venue: 'Roof', area: 'Banjara Hills',
      startsAt: fromLocalInput('2027-01-15T20:00'), gatesOpenAt: fromLocalInput('2027-01-15T19:15'), coverUrl: null, ageLimit: 21, featured: false, terms: ['A', 'B'], status: 'published', reviewNote: null,
      ticketTypes: [{ id: 't1', name: 'VIP', description: '', price: 149900, capacity: 30, maxPerOrder: 4 }],
    };
    const d = eventToDraft(row);
    expect(d).toMatchObject({ startsAt: '2027-01-15T20:00', doorsMinutes: '45', ageLimit: '21', terms: 'A\nB', coverUrl: '' });
    expect(d.tickets[0]).toEqual({ name: 'VIP', description: '', price: '1499', capacity: '30', maxPerOrder: '4' });
    const back = buildEvent(d, false);
    expect(back.ok && back.input.startsAt).toBe(row.startsAt);
    expect(back.ok && back.input.gatesOpenAt).toBe(row.gatesOpenAt);
  });
});
