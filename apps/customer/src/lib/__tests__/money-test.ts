import { formatINR, priceLevelLabel, rupees } from '../money';
import { isValidIndianMobile, isValidPersonName } from '../validation';

describe('formatINR', () => {
  it('formats whole rupees with Indian grouping', () => {
    expect(formatINR(100000)).toBe('₹1,000');
    expect(formatINR(12345600)).toBe('₹1,23,456');
    expect(formatINR(1234567800)).toBe('₹1,23,45,678');
    expect(formatINR(29900)).toBe('₹299');
  });

  it('shows paise when present or when asked', () => {
    expect(formatINR(70050)).toBe('₹700.50');
    expect(formatINR(70000, { decimals: 'always' })).toBe('₹700.00');
    expect(formatINR(70005, { decimals: 'always' })).toBe('₹700.05');
  });

  it('formats negatives with a true minus sign', () => {
    expect(formatINR(-30000)).toBe('−₹300');
  });

  it('rejects non-integer paise so floats never reach the UI', () => {
    expect(() => formatINR(700.5)).toThrow();
  });

  it('converts rupees to paise without float drift', () => {
    expect(rupees(0.1 + 0.2)).toBe(30);
    expect(rupees(299)).toBe(29900);
  });

  it('labels price levels', () => {
    expect(priceLevelLabel(3)).toBe('₹₹₹');
    expect(priceLevelLabel(9)).toBe('₹₹₹₹');
  });
});

describe('validation', () => {
  it('accepts 10-digit Indian mobiles starting 6–9', () => {
    expect(isValidIndianMobile('9876543210')).toBe(true);
    expect(isValidIndianMobile('6000000000')).toBe(true);
    expect(isValidIndianMobile('5876543210')).toBe(false);
    expect(isValidIndianMobile('987654321')).toBe(false);
  });

  it('validates attendee names', () => {
    expect(isValidPersonName('Aarav Reddy')).toBe(true);
    expect(isValidPersonName("D'Souza")).toBe(true);
    expect(isValidPersonName('A')).toBe(false);
    expect(isValidPersonName('   ')).toBe(false);
    expect(isValidPersonName('1234')).toBe(false);
  });
});
