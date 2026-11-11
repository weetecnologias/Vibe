import { describe, expect, it } from 'vitest';

import { buildRule, emptyRule, ruleSummary, ruleToDraft } from './rule';

describe('discount rule', () => {
  it('turns typed rupees and percentages into paise and basis points', () => {
    expect(buildRule({ ...emptyRule(), percent: '30', cap: '500', minBill: '1,500' })).toEqual({ ok: true, rule: { kind: 'percentage', rateBps: 3000, flatAmount: null, maxDiscount: 50000, minBill: 150000 } });
    expect(buildRule({ ...emptyRule(), kind: 'flat', flat: '99.50', minBill: '500' })).toEqual({ ok: true, rule: { kind: 'flat', rateBps: null, flatAmount: 9950, maxDiscount: null, minBill: 50000 } });
  });

  it('ignores the fields that do not apply to the chosen kind', () => {
    const r = buildRule({ kind: 'flat', percent: 'junk', flat: '100', cap: 'junk', minBill: '' });
    expect(r).toEqual({ ok: true, rule: { kind: 'flat', rateBps: null, flatAmount: 10000, maxDiscount: null, minBill: null } });
  });

  it('says what is wrong in plain words', () => {
    expect(buildRule(emptyRule())).toMatchObject({ ok: false, error: expect.stringContaining('percentage') });
    expect(buildRule({ ...emptyRule(), percent: '95' })).toMatchObject({ ok: false });
    expect(buildRule({ ...emptyRule(), percent: '10', cap: 'x' })).toMatchObject({ ok: false, error: expect.stringContaining('maximum') });
    expect(buildRule({ ...emptyRule(), kind: 'flat' })).toMatchObject({ ok: false, error: expect.stringContaining('amount') });
    expect(buildRule({ ...emptyRule(), kind: 'flat', flat: '600', minBill: '500' })).toMatchObject({ ok: false, error: expect.stringContaining('minimum bill') });
    expect(buildRule({ ...emptyRule(), percent: '10', minBill: '-5' })).toMatchObject({ ok: false });
  });

  it('round-trips and reads back as a sentence', () => {
    const rule = { kind: 'percentage' as const, rateBps: 1500, flatAmount: null, maxDiscount: 15000, minBill: 30000 };
    expect(buildRule(ruleToDraft(rule))).toEqual({ ok: true, rule });
    expect(ruleSummary(rule)).toBe('15% off, up to ₹150 on bills of ₹300 or more');
    expect(ruleSummary({ kind: 'flat', rateBps: null, flatAmount: 5000, maxDiscount: null, minBill: null })).toBe('₹50 off');
  });
});
