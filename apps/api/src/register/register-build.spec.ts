import { buildRegister, digestOf, RegisterGuest, RegisterStay } from './register-build';

const property = { name: 'Riad Yasmine', address: '12 Derb', commune: 'Marrakech' };
const MONTH_END = new Date('2026-11-01T00:00:00Z');
const guest = (id: string, over: Partial<RegisterGuest> = {}): RegisterGuest => ({
  id, status: 'VERIFIED', guestIndex: 1, docType: 'PASSPORT', fullName: `Guest ${id}`, nationality: 'SWE', docNumber: `D${id}`, dob: new Date('1980-01-01'),
  entryStampNumber: 'S1', cityOfOrigin: 'Paris', nextDestination: 'Fès', profession: 'Engineer', ...over,
});
const stay = (id: string, checkIn: string, checkOut: string, guests: RegisterGuest[], partySize: number | null = null): RegisterStay => ({ id, checkIn: new Date(checkIn), checkOut: new Date(checkOut), partySize, guests });

describe('buildRegister', () => {
  it('lists one row per submitted guest, by arrival then guest index, numbered from 1', () => {
    const { rows, problems } = buildRegister(
      [stay('b', '2026-10-12', '2026-10-14', [guest('g3')]), stay('a', '2026-10-03', '2026-10-05', [guest('g2', { guestIndex: 2 }), guest('g1', { guestIndex: 1 })])],
      property, MONTH_END,
    );
    expect(rows.map((r) => [r.n, r.guest.id])).toEqual([[1, 'g1'], [2, 'g2'], [3, 'g3']]);
    expect(problems).toEqual([]);
  });

  it('marks a stay that goes on after the month, once', () => {
    const { rows } = buildRegister([stay('a', '2026-10-30', '2026-11-03', [guest('g1')]), stay('b', '2026-10-30', '2026-11-01', [guest('g2')])], property, MONTH_END);
    expect(rows.map((r) => r.continuesNextMonth)).toEqual([true, false]); // leaving on the 1st ends inside the month
  });

  it('reports each kind of incomplete record by id, never by name or value', () => {
    const { problems, summary } = buildRegister(
      [
        stay('none', '2026-10-01', '2026-10-02', []),
        stay('party', '2026-10-02', '2026-10-04', [guest('p1')], 3),
        stay('draft', '2026-10-03', '2026-10-05', [guest('d1', { status: 'PENDING', guestIndex: null, fullName: null })]),
        stay('miss', '2026-10-04', '2026-10-06', [guest('m1', { entryStampNumber: null, profession: '  ', docNumber: '' })]),
        stay('unv', '2026-10-05', '2026-10-07', [guest('u1', { status: 'SUBMITTED' })]),
      ],
      property, MONTH_END,
    );
    expect(problems).toEqual([
      { kind: 'NO_CHECKIN', bookingId: 'none' },
      { kind: 'PARTY_INCOMPLETE', bookingId: 'party' },
      { kind: 'DRAFT', bookingId: 'draft', guestId: 'd1' },
      { kind: 'MISSING_FIELD', bookingId: 'miss', guestId: 'm1', fields: ['docNumber', 'entryStampNumber', 'profession'] },
      { kind: 'UNVERIFIED', bookingId: 'unv', guestId: 'u1' },
    ]);
    expect(summary).toEqual({ stays: 5, guests: 3, problems: 5, byKind: { NO_CHECKIN: 1, PARTY_INCOMPLETE: 1, DRAFT: 1, MISSING_FIELD: 1, UNVERIFIED: 1 } });
    expect(JSON.stringify(problems) + JSON.stringify(summary)).not.toMatch(/Guest|Paris|Engineer/);
  });

  it('keeps an incomplete guest in the register (the row is printed, the gap is reported) but never a draft', () => {
    const { rows } = buildRegister([stay('a', '2026-10-04', '2026-10-06', [guest('m1', { profession: null }), guest('d1', { status: 'PENDING', guestIndex: null })])], property, MONTH_END);
    expect(rows.map((r) => r.guest.id)).toEqual(['m1']);
  });

  it('does not report a party as incomplete when the party size is unknown or met', () => {
    const { problems } = buildRegister([stay('a', '2026-10-04', '2026-10-06', [guest('g1')], null), stay('b', '2026-10-05', '2026-10-06', [guest('g2'), guest('g3', { guestIndex: 2 })], 2)], property, MONTH_END);
    expect(problems).toEqual([]);
  });
});

describe('digestOf', () => {
  const base = () => [stay('a', '2026-10-04', '2026-10-06', [guest('g1')], 1)];
  it('is stable for the same data, whatever the order of the guests', () => {
    const one = [stay('a', '2026-10-04', '2026-10-06', [guest('g1'), guest('g2', { guestIndex: 2 })])];
    const two = [stay('a', '2026-10-04', '2026-10-06', [guest('g2', { guestIndex: 2 }), guest('g1')])];
    expect(digestOf(one, property)).toBe(digestOf(two, property));
  });
  it.each([
    ['a printed field', (s: RegisterStay[]) => (s[0].guests[0].profession = 'Doctor')],
    ['a status', (s: RegisterStay[]) => (s[0].guests[0].status = 'SUBMITTED')],
    ['a stay date', (s: RegisterStay[]) => (s[0].checkOut = new Date('2026-10-07'))],
    ['a new guest', (s: RegisterStay[]) => s[0].guests.push(guest('g9', { guestIndex: 2 }))],
  ])('changes with %s', (_l, change) => {
    const s = base();
    const before = digestOf(s, property);
    change(s);
    expect(digestOf(s, property)).not.toBe(before);
  });
  it('changes with the property details printed in the header, and contains no value in clear', () => {
    expect(digestOf(base(), { ...property, name: 'Other' })).not.toBe(digestOf(base(), property));
    expect(digestOf(base(), property)).toMatch(/^[0-9a-f]{64}$/);
  });
});
