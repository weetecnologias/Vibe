import { quote } from '../pricing';

const pct = (rateBps: number, maxDiscount: number | null = null, minBill: number | null = null) =>
  ({ kind: 'percentage' as const, rateBps, maxDiscount, minBill });

describe('quote', () => {
  it('matches the spec example: ₹1,000 at 30% → ₹300 off, ₹700 payable', () => {
    expect(quote(pct(3000), 100000)).toEqual({ eligibleAmount: 100000, discount: 30000, payable: 70000, reason: null });
  });

  it('caps the discount at maxDiscount', () => {
    expect(quote(pct(3000, 60000), 500000).discount).toBe(60000);
  });

  it('rounds the discount down to the paisa', () => {
    // 30% of ₹333.33 = ₹99.999 → ₹99.99
    expect(quote(pct(3000), 33333).discount).toBe(9999);
  });

  it('gives no discount below the minimum bill and says why', () => {
    const q = quote(pct(3000, null, 50000), 40000);
    expect(q.discount).toBe(0);
    expect(q.payable).toBe(40000);
    expect(q.reason).toMatch(/minimum/i);
  });

  it('never discounts a flat offer below zero', () => {
    expect(quote({ kind: 'flat', amount: 50000, minBill: null }, 30000)).toMatchObject({ discount: 30000, payable: 0 });
  });

  it('adds a disclosed VIBE fee after the discount', () => {
    expect(quote(pct(3000), 100000, 500).payable).toBe(70500);
  });

  it('rejects invalid input', () => {
    expect(() => quote(pct(3000), 0)).toThrow();
    expect(() => quote(pct(3000), 100.5)).toThrow();
    expect(() => quote(pct(0), 100000)).toThrow();
    expect(() => quote(pct(10001), 100000)).toThrow();
  });
});
