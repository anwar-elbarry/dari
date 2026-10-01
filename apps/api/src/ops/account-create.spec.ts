import { parseAccountArgs } from './account-create';

describe('parseAccountArgs', () => {
  const base = ['--company', '  Riad Test ', '--name', 'Owner Test', '--email', ' Owner@Example.MA '];

  it('trims, lower-cases the e-mail and defaults to one seat', () => {
    expect(parseAccountArgs(base)).toEqual({ ok: true, account: { companyName: 'Riad Test', ownerName: 'Owner Test', email: 'owner@example.ma', seatLimit: 1 } });
  });

  it('reads --seats as a whole number', () => {
    const r = parseAccountArgs([...base, '--seats', '3']);
    expect(r.ok && r.account.seatLimit).toBe(3);
  });

  it.each([['0'], ['1.5'], ['-2'], ['abc'], ['1001']])('refuses --seats %s', (seats) => {
    expect(parseAccountArgs([...base, '--seats', seats])).toEqual({ ok: false, problems: [expect.stringContaining('--seats')] });
  });

  it('lists every missing or invalid field', () => {
    const r = parseAccountArgs(['--email', 'not-an-email']);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problems).toHaveLength(3);
  });

  it('refuses unknown options and positionals', () => {
    expect(parseAccountArgs([...base, '--password', 'x']).ok).toBe(false);
    expect(parseAccountArgs([...base, 'extra']).ok).toBe(false);
  });
});
