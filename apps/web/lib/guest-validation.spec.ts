import { entryStampRequired, GuestForm, validate } from './guest-validation';

const NOW = new Date('2026-10-02T00:00:00Z');
const form = (over: Partial<GuestForm> = {}): GuestForm => ({
  docType: 'PASSPORT', fullName: 'Anna Maria Eriksson', nationality: 'SWE', docNumber: 'L898902C3', dob: '1974-08-12', docExpiryDate: '',
  declaredMoroccanNationality: 'no', entryStampNumber: '', cityOfOrigin: 'Stockholm', nextDestination: 'Essaouira', profession: 'Engineer', ...over,
});
// Example exemption for the mechanism only: the real one comes from the API (RuleConfig validated by counsel).
const EXEMPTION = { nationalities: ['MAR'], ifDeclaredMoroccan: true };

describe('entry stamp', () => {
  it('is required from everyone while the API sends no exemption', () => {
    expect(validate(form({ nationality: 'MAR' }), NOW).entryStampNumber).toBe('required');
    expect(entryStampRequired(null, form({ declaredMoroccanNationality: 'yes' }))).toBe(true);
  });

  it('is not asked from a guest the exemption covers, and still asked from the others', () => {
    expect(validate(form({ nationality: 'MAR' }), NOW, EXEMPTION).entryStampNumber).toBeUndefined();
    expect(validate(form({ declaredMoroccanNationality: 'yes' }), NOW, EXEMPTION).entryStampNumber).toBeUndefined();
    expect(validate(form(), NOW, EXEMPTION).entryStampNumber).toBe('required');
    expect(validate(form({ entryStampNumber: 'CMN-1' }), NOW, EXEMPTION)).toEqual({});
  });

  it('accepts the wording suggested to Moroccan guests while no exemption applies', () => {
    expect(validate(form({ nationality: 'MAR', entryStampNumber: 'Citoyen marocain' }), NOW).entryStampNumber).toBeUndefined();
  });
});
