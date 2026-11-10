/**
 * Social filters, as the DEMO adapter applies them for the backend.
 * Times are judged in India Standard Time; "near me" uses the distance the
 * backend works out from the member's chosen area.
 */
import type { SocialFilter, SocialWhen } from '../types';

export const NEAR_ME_KM = 3;
const HOUR = 60 * 60_000;
const IST_MS = 330 * 60_000;

const istDay = (ms: number) => {
  const d = new Date(ms + IST_MS);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
};

/** `any` (or no value) keeps everything; the time windows only include things that haven't started yet. */
export function matchesWhen(startsAt: string, when: SocialWhen | undefined, now: number): boolean {
  if (!when || when === 'any') return true;
  const t = Date.parse(startsAt);
  if (t < now) return false;
  if (when === 'hour') return t - now <= HOUR;
  if (when === 'today') return istDay(t) === istDay(now);
  return t - now <= 7 * 24 * HOUR; // 'week' = the next 7 days
}

export function matchesFilter(item: { startsAt: string; distanceKm: number }, filter: SocialFilter | undefined, now: number): boolean {
  return matchesWhen(item.startsAt, filter?.when, now) && (!filter?.nearMe || item.distanceKm <= NEAR_ME_KM);
}
