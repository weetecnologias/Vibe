import { paiseToRupees, rupeesToPaise } from './money';
import { DAYS, type Hour, type Profile } from './types';

/** What a person types, before it is turned into the API shape. */
export type ProfileDraft = {
  name: string; area: string; address: string; lat: string; lng: string; description: string; logoUrl: string; coverUrl: string;
  priceLevel: string; costForTwo: string; terms: string; bookingEnabled: boolean; photos: string;
  hours: { open: boolean; opens: string; closes: string }[];
};

export const emptyDraft = (): ProfileDraft => ({
  name: '', area: '', address: '', lat: '', lng: '', description: '', logoUrl: '', coverUrl: '', priceLevel: '2', costForTwo: '', terms: '', bookingEnabled: false, photos: '',
  hours: DAYS.map(() => ({ open: true, opens: '09:00', closes: '22:00' })),
});

export function toDraft(p: Profile): ProfileDraft {
  return {
    name: p.name, area: p.area, address: p.address, lat: p.lat === null ? '' : String(p.lat), lng: p.lng === null ? '' : String(p.lng), description: p.description,
    logoUrl: p.logoUrl ?? '', coverUrl: p.coverUrl ?? '', priceLevel: String(p.priceLevel), costForTwo: paiseToRupees(p.costForTwo), terms: p.terms.join('\n'),
    bookingEnabled: p.bookingEnabled, photos: p.photos.join('\n'),
    hours: DAYS.map((_, d) => {
      const h = p.hours.find((x) => x.dow === d);
      return h && h.opens && h.closes ? { open: true, opens: h.opens, closes: h.closes } : { open: false, opens: '09:00', closes: '22:00' };
    }),
  };
}

const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);
const num = (s: string) => (s.trim() === '' ? null : Number(s));

/** Turns the draft into the API shape, or says what is wrong. Money is entered in rupees and sent in paise. */
export function fromDraft(d: ProfileDraft): { ok: true; profile: Profile } | { ok: false; error: string } {
  if (!d.name.trim()) return { ok: false, error: 'Enter the business name.' };
  if (!d.area.trim()) return { ok: false, error: 'Enter the area, for example Jubilee Hills.' };
  const lat = num(d.lat), lng = num(d.lng);
  if ((lat !== null && (Number.isNaN(lat) || lat < -90 || lat > 90)) || (lng !== null && (Number.isNaN(lng) || lng < -180 || lng > 180))) return { ok: false, error: 'Latitude and longitude must be valid numbers.' };
  let cost: number | null = null;
  if (d.costForTwo.trim() !== '') {
    cost = rupeesToPaise(d.costForTwo);
    if (cost === null) return { ok: false, error: 'Cost for two must be an amount in rupees, like 1200 or 1,200.50.' };
  }
  for (let i = 0; i < 7; i++) {
    const h = d.hours[i];
    if (h.open && (!h.opens || !h.closes)) return { ok: false, error: `Set opening and closing times for ${DAYS[i]}, or mark it closed.` };
  }
  const hours: Hour[] = d.hours.map((h, dow) => ({ dow, opens: h.open ? h.opens : null, closes: h.open ? h.closes : null }));
  return {
    ok: true,
    profile: {
      name: d.name.trim(), area: d.area.trim(), address: d.address.trim(), lat, lng, description: d.description.trim(), logoUrl: d.logoUrl.trim() || null, coverUrl: d.coverUrl.trim() || null,
      priceLevel: Number(d.priceLevel), costForTwo: cost, terms: lines(d.terms), bookingEnabled: d.bookingEnabled, photos: lines(d.photos), hours,
    },
  };
}
