/** Date helpers. All display is in Asia/Kolkata (UTC+05:30, no DST). */
const IST_OFFSET_MIN = 330;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function ist(iso: string) {
  const d = new Date(new Date(iso).getTime() + IST_OFFSET_MIN * 60_000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), day: d.getUTCDate(), dow: d.getUTCDay(), h: d.getUTCHours(), min: d.getUTCMinutes() };
}

export function formatTime(iso: string): string {
  const { h, min } = ist(iso);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${min ? ':' + String(min).padStart(2, '0') : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

export function formatDay(iso: string): string {
  const { day, m, dow } = ist(iso);
  return `${DOW[dow]}, ${day} ${MON[m]}`;
}

export function formatDate(iso: string): string {
  const { day, m, y } = ist(iso);
  return `${day} ${MON[m]} ${y}`;
}

export function dateBadge(iso: string): { mon: string; day: string; dow: string } {
  const { day, m, dow } = ist(iso);
  return { mon: MON[m].toUpperCase(), day: String(day), dow: DOW[dow].toUpperCase() };
}

/** Key for grouping by IST calendar day, e.g. "2026-11-14". */
export function istDayKey(iso: string): string {
  const { y, m, day } = ist(iso);
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** ISO timestamp for `days` from today (IST calendar) at hh:mm IST. */
export function istAt(days: number, hh: number, mm = 0, now = Date.now()): string {
  const d = new Date(now + IST_OFFSET_MIN * 60_000);
  const utc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days, hh, mm);
  return new Date(utc - IST_OFFSET_MIN * 60_000).toISOString();
}

/** "Today", "Tomorrow" or "Sat, 14 Nov". */
export function relativeDay(iso: string, now = Date.now()): string {
  const key = istDayKey(iso);
  if (key === istDayKey(new Date(now).toISOString())) return 'Today';
  if (key === istDayKey(new Date(now + 86_400_000).toISOString())) return 'Tomorrow';
  return formatDay(iso);
}

/** "Starts in 40 min" for things starting within the hour, otherwise null. */
export function startsInLabel(iso: string, now = Date.now()): string | null {
  const min = Math.round((new Date(iso).getTime() - now) / 60_000);
  if (min < 0 || min > 60) return null;
  return min <= 1 ? 'Starting now' : `Starts in ${min} min`;
}

export function secondsUntil(iso: string, now = Date.now()): number {
  return Math.max(0, Math.round((new Date(iso).getTime() - now) / 1000));
}

export function formatCountdown(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function daysUntil(iso: string, now = Date.now()): number {
  return Math.ceil((new Date(iso).getTime() - now) / 86_400_000);
}
