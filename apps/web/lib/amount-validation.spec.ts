import { AmountsForm, buildAmountsBody, parseAmount, parsePartySize, toInputText } from './amount-validation';

describe('parseAmount', () => {
  it('accepts whole and decimal amounts, with a point or a comma', () => {
    expect(parseAmount('1234')).toEqual({ ok: true, value: '1234' });
    expect(parseAmount('1234.50')).toEqual({ ok: true, value: '1234.50' });
    expect(parseAmount('1234,5')).toEqual({ ok: true, value: '1234.5' });
    expect(parseAmount(' 0 ')).toEqual({ ok: true, value: '0' });
    expect(parseAmount('999999999.99')).toEqual({ ok: true, value: '999999999.99' });
  });

  it('accepts spaces used as thousands separators', () => {
    expect(parseAmount('1 234,50')).toEqual({ ok: true, value: '1234.50' });
    expect(parseAmount('1 234')).toEqual({ ok: true, value: '1234' });
  });

  it('treats an empty field as a cleared figure', () => {
    expect(parseAmount('')).toEqual({ ok: true, value: null });
    expect(parseAmount('   ')).toEqual({ ok: true, value: null });
  });

  it.each(['-5', '+5', '1e3', '12.345', '12,345', '1,234.50', '1.234,50', 'abc', '12.', '.5', '1000000000', '0x10', 'NaN', 'Infinity', '1,,5'])('refuses %j', (v) => {
    expect(parseAmount(v)).toEqual({ ok: false });
  });
});

describe('parsePartySize', () => {
  it('accepts 1 to 50 and an empty field', () => {
    expect(parsePartySize('4')).toEqual({ ok: true, value: 4 });
    expect(parsePartySize('50')).toEqual({ ok: true, value: 50 });
    expect(parsePartySize('')).toEqual({ ok: true, value: null });
  });
  it.each(['0', '51', '-1', '2.5', '1e1', 'a', '100'])('refuses %j', (v) => {
    expect(parsePartySize(v)).toEqual({ ok: false });
  });
});

describe('buildAmountsBody', () => {
  const empty: AmountsForm = { nightlyRevenue: '', cleaningFee: '', addonRevenue: '', discounts: '', refunds: '', platformCommission: '', taxeSejourAmount: '', partySize: '' };

  it('sends every field as text, an empty one as null, and the party size as an integer', () => {
    const r = buildAmountsBody({ ...empty, nightlyRevenue: '1500,00', cleaningFee: '200', taxeSejourAmount: '0', partySize: '3' });
    expect(r).toEqual({
      ok: true,
      body: { nightlyRevenue: '1500.00', cleaningFee: '200', addonRevenue: null, discounts: null, refunds: null, platformCommission: null, taxeSejourAmount: '0', partySize: 3 },
    });
  });

  it('names every field that is not acceptable and sends nothing', () => {
    const r = buildAmountsBody({ ...empty, nightlyRevenue: '12.345', refunds: '-1', partySize: '99' });
    expect(r).toEqual({ ok: false, errors: { nightlyRevenue: 'invalid', refunds: 'invalid', partySize: 'invalid' } });
  });
});

describe('toInputText', () => {
  it('shows a stored value or nothing', () => {
    expect(toInputText('1234.5')).toBe('1234.5');
    expect(toInputText(3)).toBe('3');
    expect(toInputText(null)).toBe('');
    expect(toInputText(undefined)).toBe('');
  });
});
