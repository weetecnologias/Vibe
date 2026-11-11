import { bpsToPercent, formatINR, paiseToRupees, percentToBps, rupeesToPaise } from './money';
import type { OfferKind } from './types';
import { Field } from './ui';

/** The discount rule shared by a merchant's offers and VIBE's checkout coupons. People type rupees and percentages; the API takes paise and basis points. */
export type RuleDraft = { kind: OfferKind; percent: string; flat: string; cap: string; minBill: string };

export type Rule = { kind: OfferKind; rateBps: number | null; flatAmount: number | null; maxDiscount: number | null; minBill: number | null };

export const emptyRule = (): RuleDraft => ({ kind: 'percentage', percent: '', flat: '', cap: '', minBill: '' });

export const ruleToDraft = (r: Rule): RuleDraft => ({ kind: r.kind, percent: bpsToPercent(r.rateBps), flat: paiseToRupees(r.flatAmount), cap: paiseToRupees(r.maxDiscount), minBill: paiseToRupees(r.minBill) });

/** The rule in API units, or what is wrong in plain words. The server checks the same rules again. */
export function buildRule(d: RuleDraft): { ok: true; rule: Rule } | { ok: false; error: string } {
  const bps = d.kind === 'percentage' ? percentToBps(d.percent) : null;
  if (d.kind === 'percentage' && (bps === null || bps < 1 || bps > 9000)) return { ok: false, error: 'Enter a percentage between 0.01 and 90.' };
  const flat = d.kind === 'flat' ? rupeesToPaise(d.flat) : null;
  if (d.kind === 'flat' && (flat === null || flat < 1)) return { ok: false, error: 'Enter the discount amount in rupees.' };
  const cap = d.kind === 'percentage' && d.cap.trim() ? rupeesToPaise(d.cap) : null;
  if (d.kind === 'percentage' && d.cap.trim() && (cap === null || cap < 1)) return { ok: false, error: 'The maximum discount must be an amount in rupees.' };
  const min = d.minBill.trim() ? rupeesToPaise(d.minBill) : null;
  if (d.minBill.trim() && min === null) return { ok: false, error: 'The minimum bill must be an amount in rupees.' };
  if (flat !== null && min !== null && flat > min) return { ok: false, error: 'The flat discount can’t be more than the minimum bill.' };
  return { ok: true, rule: { kind: d.kind, rateBps: bps, flatAmount: flat, maxDiscount: cap, minBill: min } };
}

/** "30% off, up to ₹500 on bills of ₹500 or more" */
export function ruleSummary(r: Rule): string {
  const what = r.kind === 'percentage' ? `${bpsToPercent(r.rateBps)}% off${r.maxDiscount ? `, up to ${formatINR(r.maxDiscount)}` : ''}` : `${formatINR(r.flatAmount ?? 0)} off`;
  return `${what}${r.minBill ? ` on bills of ${formatINR(r.minBill)} or more` : ''}`;
}

export function RuleFields({ draft, onChange, name = 'kind' }: { draft: RuleDraft; onChange: (d: RuleDraft) => void; name?: string }) {
  const set = (patch: Partial<RuleDraft>) => onChange({ ...draft, ...patch });
  return (
    <fieldset className="hours">
      <legend>Discount</legend>
      <div className="row" style={{ gap: 20 }}>
        <label className="check"><input type="radio" name={name} checked={draft.kind === 'percentage'} onChange={() => set({ kind: 'percentage' })} /> Percentage off</label>
        <label className="check"><input type="radio" name={name} checked={draft.kind === 'flat'} onChange={() => set({ kind: 'flat' })} /> Flat amount off</label>
      </div>
      {draft.kind === 'percentage' ? (
        <div className="grid2">
          <Field label="Percentage"><input inputMode="decimal" value={draft.percent} onChange={(e) => set({ percent: e.target.value })} placeholder="30" /></Field>
          <Field label="Maximum discount (₹)" hint="Optional. Caps the saving on large bills."><input inputMode="decimal" value={draft.cap} onChange={(e) => set({ cap: e.target.value })} placeholder="500" /></Field>
        </div>
      ) : (
        <Field label="Discount (₹)"><input inputMode="decimal" value={draft.flat} onChange={(e) => set({ flat: e.target.value })} placeholder="100" /></Field>
      )}
      <Field label="Minimum bill (₹)" hint="Optional. Applies only when the bill is at least this much."><input inputMode="decimal" value={draft.minBill} onChange={(e) => set({ minBill: e.target.value })} placeholder="500" /></Field>
    </fieldset>
  );
}
