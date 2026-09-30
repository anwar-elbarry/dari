import { centimesToDecimal, mulBps, mulRatio, nonNegative, toCentimes } from './money';

describe('money in centimes', () => {
  it('converts decimals to centimes without a float', () => {
    expect(toCentimes('1234.5')).toBe(123450);
    expect(toCentimes('0.1')).toBe(10);
    expect(toCentimes('0.07')).toBe(7);
    expect(toCentimes('-12.30')).toBe(-1230);
    expect(toCentimes('99999999.99')).toBe(9_999_999_999);
    expect(toCentimes({ toFixed: (dp: number) => (12.3).toFixed(dp) })).toBe(1230);
    expect(toCentimes(null)).toBeNull();
    expect(toCentimes(undefined)).toBeNull();
  });

  it('refuses anything that is not a decimal with at most two places', () => {
    for (const bad of ['', '1e3', '1,5', '12.345', 'abc', '1 000', '--1']) expect(() => toCentimes(bad)).toThrow();
  });

  it('writes centimes back in the Decimal(12,2) form', () => {
    expect(centimesToDecimal(123450)).toBe('1234.50');
    expect(centimesToDecimal(7)).toBe('0.07');
    expect(centimesToDecimal(-1230)).toBe('-12.30');
    expect(centimesToDecimal(0)).toBe('0.00');
    expect(() => centimesToDecimal(1.5)).toThrow();
  });

  it('rounds half away from zero, per line', () => {
    expect(mulBps(1005, 1000)).toBe(101); // 100.5 -> 101
    expect(mulBps(1004, 1000)).toBe(100);
    expect(mulBps(-1005, 1000)).toBe(-101);
    expect(mulBps(1, 5000)).toBe(1); // 0.5 -> 1
    expect(mulBps(0, 1500)).toBe(0);
    expect(mulRatio(1000, 1000, 11_000)).toBe(91); // 90.909... -> 91
  });

  it('is exact on large amounts', () => {
    // 9 999 999 999 c at 15 % = 1 499 999 999.85 c -> 1 500 000 000 c (half-up)
    expect(mulBps(9_999_999_999, 1500)).toBe(1_500_000_000);
    expect(mulRatio(9_007_199_254_740_991, 1, 1)).toBe(9_007_199_254_740_991);
  });

  it('refuses invalid ratios', () => {
    expect(() => mulRatio(1.5, 1, 1)).toThrow();
    expect(() => mulRatio(1, 1, 0)).toThrow();
  });

  it('never returns a negative tax', () => {
    expect(nonNegative(-5)).toBe(0);
    expect(nonNegative(5)).toBe(5);
  });
});
