import { entryStampRequired, parseEntryStampExemption } from './entry-stamp';

// Example values for the mechanism only: which guests are exempt is counsel's decision, stored in RuleConfig.
const RULE = { nationalities: ['MAR'], ifDeclaredMoroccan: true };

describe('entryStampRequired', () => {
  it('is required for everyone while no exemption applies', () => {
    expect(entryStampRequired(null, { nationality: 'MAR', declaredMoroccanNationality: true })).toBe(true);
  });

  it('follows the exemption: by nationality, or by the declared Moroccan nationality', () => {
    expect(entryStampRequired(RULE, { nationality: 'MAR', declaredMoroccanNationality: false })).toBe(false);
    expect(entryStampRequired(RULE, { nationality: 'FRA', declaredMoroccanNationality: true })).toBe(false);
    expect(entryStampRequired(RULE, { nationality: 'FRA', declaredMoroccanNationality: false })).toBe(true);
    expect(entryStampRequired(RULE, { nationality: null, declaredMoroccanNationality: null })).toBe(true);
    expect(entryStampRequired({ nationalities: ['MAR'], ifDeclaredMoroccan: false }, { nationality: 'FRA', declaredMoroccanNationality: true })).toBe(true);
  });
});

describe('parseEntryStampExemption', () => {
  it('keeps well-formed values only', () => {
    expect(parseEntryStampExemption(RULE)).toEqual(RULE);
    expect(parseEntryStampExemption({ nationalities: ['MAR', 'mar', 'MARO', 3, 'MAR'] })).toEqual({ nationalities: ['MAR'], ifDeclaredMoroccan: false });
    expect(parseEntryStampExemption({ ifDeclaredMoroccan: 'yes' })).toBeNull();
  });

  it('gives null for an exemption that covers nobody or a malformed row', () => {
    for (const v of [null, undefined, [], 'MAR', {}, { nationalities: [] }]) expect(parseEntryStampExemption(v)).toBeNull();
  });
});
