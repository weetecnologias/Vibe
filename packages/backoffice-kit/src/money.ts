/**
 * Money is integer paise on the wire and in the database. People type rupees.
 * Parsing is strict: anything ambiguous returns null so the form can say so, instead of guessing.
 */

/** "1,500" → 150000, "99.5" → 9950, "₹ 250.00" → 25000. Null when it isn't a valid non-negative amount with at most 2 decimals. */
export function rupeesToPaise(input: string): number | null {
  const s = input.replace(/[₹\s,]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return Number.isSafeInteger(paise) ? paise : null;
}

/** 150000 → "1500", 9950 → "99.50". For filling a form field. */
export function paiseToRupees(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return '';
  const whole = Math.floor(paise / 100);
  const frac = paise % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, '0')}`;
}

/** 150000 → "₹1,500", 9950 → "₹99.50" (Indian digit grouping), -4862 → "−₹48.62". */
export function formatINR(paise: number): string {
  if (paise < 0) return `−${formatINR(-paise)}`;
  const whole = Math.floor(paise / 100);
  const frac = paise % 100;
  const s = String(whole);
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3 : last3;
  return `₹${grouped}${frac ? '.' + String(frac).padStart(2, '0') : ''}`;
}

/** 3000 → "30", 1250 → "12.5". Percentages are stored as basis points. */
export function bpsToPercent(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) return '';
  const v = bps / 100;
  return Number.isInteger(v) ? String(v) : String(v);
}

/** "30" → 3000, "12.5" → 1250. Null when not a number with at most 2 decimals. */
export function percentToBps(input: string): number | null {
  const s = input.replace(/[%\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}
