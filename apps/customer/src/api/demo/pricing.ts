/**
 * Offer pricing used by the DEMO adapter to stand in for the backend.
 * The production backend owns this logic; the app must never price bills itself.
 * Rates are in basis points (3000 = 30%) and all money is integer paise.
 */
import type { Paise } from '../types';

export type OfferRule =
  | { kind: 'percentage'; rateBps: number; maxDiscount: Paise | null; minBill: Paise | null }
  | { kind: 'flat'; amount: Paise; minBill: Paise | null };

export type Quote = { eligibleAmount: Paise; discount: Paise; payable: Paise; reason: string | null };

export function quote(rule: OfferRule, eligibleAmount: Paise, vibeFee: Paise = 0): Quote {
  if (!Number.isInteger(eligibleAmount) || eligibleAmount <= 0) {
    throw new Error('Eligible amount must be a positive integer number of paise');
  }
  if (rule.minBill !== null && eligibleAmount < rule.minBill) {
    return { eligibleAmount, discount: 0, payable: eligibleAmount + vibeFee, reason: 'Bill is below the minimum for this offer' };
  }
  let discount: Paise;
  if (rule.kind === 'percentage') {
    if (rule.rateBps <= 0 || rule.rateBps > 10_000) throw new Error('rateBps must be between 1 and 10000');
    // Round down to the paisa so the customer is never charged a fraction.
    discount = Math.floor((eligibleAmount * rule.rateBps) / 10_000);
    if (rule.maxDiscount !== null) discount = Math.min(discount, rule.maxDiscount);
  } else {
    discount = Math.min(rule.amount, eligibleAmount);
  }
  return { eligibleAmount, discount, payable: eligibleAmount - discount + vibeFee, reason: null };
}
