import { describe, expect, it } from 'vitest';

import { bpsToPercent, formatINR, paiseToRupees, percentToBps, rupeesToPaise } from './money';

describe('rupeesToPaise', () => {
  it('turns what people type into integer paise', () => {
    expect(rupeesToPaise('1500')).toBe(150000);
    expect(rupeesToPaise('1,500')).toBe(150000);
    expect(rupeesToPaise('₹ 250.00')).toBe(25000);
    expect(rupeesToPaise('99.5')).toBe(9950);
    expect(rupeesToPaise('0.07')).toBe(7);
    expect(rupeesToPaise('0')).toBe(0);
  });

  it('never goes through floating point', () => {
    // 19.99 * 100 is 1998.9999999999998 in JavaScript.
    expect(rupeesToPaise('19.99')).toBe(1999);
    expect(rupeesToPaise('1.15')).toBe(115);
    expect(rupeesToPaise('0.29')).toBe(29);
  });

  it('refuses anything ambiguous instead of guessing', () => {
    for (const bad of ['', 'abc', '-5', '1.234', '1..2', '1e3', '12.', '.5', '1,2,3.456', '9'.repeat(30)]) expect(rupeesToPaise(bad)).toBeNull();
  });
});

describe('paiseToRupees', () => {
  it('fills a form field and round-trips', () => {
    expect(paiseToRupees(150000)).toBe('1500');
    expect(paiseToRupees(9950)).toBe('99.50');
    expect(paiseToRupees(7)).toBe('0.07');
    expect(paiseToRupees(null)).toBe('');
    for (const p of [0, 1, 99, 100, 12345, 99999999]) expect(rupeesToPaise(paiseToRupees(p))).toBe(p);
  });
});

describe('formatINR', () => {
  it('uses Indian digit grouping', () => {
    expect(formatINR(150000)).toBe('₹1,500');
    expect(formatINR(12345678900)).toBe('₹12,34,56,789');
    expect(formatINR(9950)).toBe('₹99.50');
    expect(formatINR(-4862)).toBe('−₹48.62');
    expect(formatINR(0)).toBe('₹0');
    expect(formatINR(100000)).toBe('₹1,000');
  });
});

describe('percent and basis points', () => {
  it('converts both ways', () => {
    expect(percentToBps('30')).toBe(3000);
    expect(percentToBps('12.5%')).toBe(1250);
    expect(percentToBps('7.25')).toBe(725);
    expect(percentToBps('abc')).toBeNull();
    expect(percentToBps('-1')).toBeNull();
    expect(bpsToPercent(3000)).toBe('30');
    expect(bpsToPercent(1250)).toBe('12.5');
    expect(bpsToPercent(null)).toBe('');
  });
});
