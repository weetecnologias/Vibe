import { paiseToRupees, rupeesToPaise } from './money';
import { fromLocalInput, nowLocal, toLocalInput } from './time';
import type { EventInput, EventRow } from './types';

/** What a person types for an event and its tickets. Money is typed in rupees and sent in paise; times are India time. */
/** id is kept for ticket types that already exist, so an edit changes them instead of replacing them (tickets may already be sold). */
export type TicketDraft = { id?: string; name: string; description: string; price: string; capacity: string; maxPerOrder: string };

export type EventDraft = {
  title: string; kind: string; description: string; venue: string; area: string; startsAt: string; doorsMinutes: string; coverUrl: string; ageLimit: string; terms: string;
  organiser: string; featured: boolean; tickets: TicketDraft[];
};

export const emptyTicket = (): TicketDraft => ({ name: '', description: '', price: '', capacity: '', maxPerOrder: '6' });

export const emptyEvent = (): EventDraft => ({
  title: '', kind: 'Workshops', description: '', venue: '', area: '', startsAt: nowLocal(7), doorsMinutes: '30', coverUrl: '', ageLimit: '', terms: '', organiser: '', featured: false, tickets: [{ ...emptyTicket(), name: 'General' }],
});

export function eventToDraft(e: EventRow): EventDraft {
  const doors = Math.max(0, Math.round((Date.parse(e.startsAt) - Date.parse(e.gatesOpenAt)) / 60_000));
  return {
    title: e.title, kind: e.kind, description: e.description, venue: e.venue, area: e.area, startsAt: toLocalInput(e.startsAt), doorsMinutes: String(doors), coverUrl: e.coverUrl ?? '',
    ageLimit: e.ageLimit === null ? '' : String(e.ageLimit), terms: e.terms.join('\n'), organiser: e.organiser, featured: e.featured,
    tickets: e.ticketTypes.map((t) => ({ id: t.id, name: t.name, description: t.description, price: paiseToRupees(t.price), capacity: String(t.capacity), maxPerOrder: String(t.maxPerOrder) })),
  };
}

const wholeNumber = (s: string): number | null => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : null);

/** The request body, or what is wrong in plain words. The server checks the same rules again. */
export function buildEvent(d: EventDraft, admin: boolean): { ok: true; input: EventInput } | { ok: false; error: string } {
  if (!d.title.trim()) return { ok: false, error: 'Give the event a title.' };
  if (!d.venue.trim() || !d.area.trim()) return { ok: false, error: 'Enter the venue and the area.' };
  if (!d.startsAt) return { ok: false, error: 'Choose when the event starts.' };
  const start = Date.parse(fromLocalInput(d.startsAt));
  const doors = wholeNumber(d.doorsMinutes);
  if (doors === null || doors > 600) return { ok: false, error: 'Doors open between 0 and 600 minutes before the start.' };
  let age: number | null = null;
  if (d.ageLimit.trim()) {
    age = wholeNumber(d.ageLimit);
    if (age === null || age < 5 || age > 99) return { ok: false, error: 'The age limit must be between 5 and 99, or left empty.' };
  }
  if (d.tickets.length === 0) return { ok: false, error: 'Add at least one ticket type.' };
  const names = new Set<string>();
  const tickets: EventInput['ticketTypes'] = [];
  for (const [i, t] of d.tickets.entries()) {
    const label = `Ticket ${i + 1}`;
    if (!t.name.trim()) return { ok: false, error: `${label} needs a name.` };
    if (names.has(t.name.trim().toLowerCase())) return { ok: false, error: 'Each ticket type needs its own name.' };
    names.add(t.name.trim().toLowerCase());
    const price = rupeesToPaise(t.price);
    if (price === null) return { ok: false, error: `${t.name}: enter the price in rupees, like 500 or 0 for free.` };
    const capacity = wholeNumber(t.capacity);
    if (capacity === null || capacity > 100_000) return { ok: false, error: `${t.name}: enter how many tickets are available.` };
    const max = wholeNumber(t.maxPerOrder);
    if (max === null || max < 1 || max > 20) return { ok: false, error: `${t.name}: the most one person can buy must be between 1 and 20.` };
    tickets.push({ ...(t.id ? { id: t.id } : {}), name: t.name.trim(), description: t.description.trim(), price, capacity, maxPerOrder: max });
  }
  return {
    ok: true,
    input: {
      title: d.title.trim(), kind: d.kind, description: d.description.trim(), venue: d.venue.trim(), area: d.area.trim(), startsAt: fromLocalInput(d.startsAt),
      gatesOpenAt: new Date(start - doors * 60_000).toISOString(), coverUrl: d.coverUrl.trim() || null, ageLimit: age,
      terms: d.terms.split('\n').map((l) => l.trim()).filter(Boolean), ticketTypes: tickets,
      ...(admin ? { organiser: d.organiser.trim() || null, featured: d.featured } : {}),
    },
  };
}
