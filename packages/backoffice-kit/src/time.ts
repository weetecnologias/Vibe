/** Dashboards show and take dates in India time, whatever the browser's own time zone is. */
export const IST = 'Asia/Kolkata';

/** An ISO time as `YYYY-MM-DDTHH:mm` in India time, for a datetime-local field. */
export function toLocalInput(iso: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(iso)).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** What a datetime-local field holds (India time) as an ISO instant. */
export const fromLocalInput = (v: string): string => new Date(`${v}:00+05:30`).toISOString();

/** Now (or a number of days from now) for a datetime-local field. */
export const nowLocal = (addDays = 0): string => toLocalInput(new Date(Date.now() + addDays * 86_400_000).toISOString());

/** "10 Nov 2026, 8:55 am" in India time. */
export const showDateTime = (iso: string): string => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: IST });
