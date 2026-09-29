import { grossBase } from './gross-base';

describe('grossBase', () => {
  it('applies the administrative formula', () => {
    expect(
      grossBase({ nightly: 100_000, cleaning: 10_000, addons: 5_000, discounts: 8_000, refunds: 2_000 }),
    ).toBe(105_000);
  });
});
