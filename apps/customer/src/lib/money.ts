import type { Paise } from '@/api/types';

/** Group digits Indian style: 1234567 -> 12,34,567. */
function groupIndian(n: number): string {
  const s = String(n);
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  return rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
}

/**
 * Format integer paise as rupees. `decimals: 'auto'` drops ".00" for whole rupees.
 * Never uses floating-point for the rupee/paise split.
 */
export function formatINR(paise: Paise, opts: { decimals?: 'always' | 'auto' | 'never'; sign?: boolean } = {}): string {
  if (!Number.isInteger(paise)) throw new Error(`formatINR expects integer paise, got ${paise}`);
  const { decimals = 'auto', sign = false } = opts;
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const p = abs % 100;
  let out = '₹' + groupIndian(rupees);
  if (decimals === 'always' || (decimals === 'auto' && p !== 0)) out += '.' + String(p).padStart(2, '0');
  if (negative) return '−' + out;
  if (sign && paise > 0) return '+' + out;
  return out;
}

export const rupees = (r: number): Paise => Math.round(r * 100);

export function priceLevelLabel(level: number): string {
  return '₹'.repeat(Math.max(1, Math.min(4, level)));
}
