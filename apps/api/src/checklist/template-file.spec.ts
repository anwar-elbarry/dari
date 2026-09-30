import { parseTemplateFile } from './template-file';

const step = (o: object = {}) => ({ code: 'proof_of_ownership', nameFr: 'Justificatif de propriété', nameEn: 'Proof of ownership', position: 1, ...o });
const file = (o: object = {}) => ({ city: 'Marrakech', steps: [step()], ...o });

describe('parseTemplateFile', () => {
  it('accepts a list with no validation and keeps it unvalidated', () => {
    const r = parseTemplateFile(file());
    expect(r).toEqual({ ok: true, template: { city: 'Marrakech', validatedBy: null, validatedAt: null, steps: [{ code: 'proof_of_ownership', licenseType: null, condition: null, position: 1, nameFr: 'Justificatif de propriété', nameEn: 'Proof of ownership' }] } });
  });

  it('reads a licence type, a condition and a validation', () => {
    const r = parseTemplateFile(file({ validatedBy: 'Counsel', validatedAt: '2026-10-31', steps: [step({ licenseType: 'RIAD', condition: 'meals' })] }));
    expect(r.ok && r.template.validatedAt?.toISOString()).toBe('2026-10-31T00:00:00.000Z');
    expect(r.ok && r.template.steps[0]).toMatchObject({ licenseType: 'RIAD', condition: 'meals' });
  });

  it.each([
    ['not an object', []],
    ['no city', file({ city: '' })],
    ['no steps', file({ steps: [] })],
    ['a validator without a date', file({ validatedBy: 'Counsel' })],
    ['a date without a validator', file({ validatedAt: '2026-10-31' })],
    ['a malformed date', file({ validatedBy: 'Counsel', validatedAt: '31/10/2026' })],
    ['a bad code', file({ steps: [step({ code: 'Bad Code' })] })],
    ['a duplicate code', file({ steps: [step(), step({ position: 2 })] })],
    ['a missing English name', file({ steps: [step({ nameEn: '' })] })],
    ['a fractional position', file({ steps: [step({ position: 1.5 })] })],
    ['an unknown licence type', file({ steps: [step({ licenseType: 'CASTLE' })] })],
    ['a step that is not an object', file({ steps: ['x'] })],
  ])('refuses %s', (_name, input) => {
    expect(parseTemplateFile(input).ok).toBe(false);
  });

  it('names every problem, with the step number, and never echoes a value', () => {
    const r = parseTemplateFile(file({ steps: [step({ code: 'SECRET VALUE', position: 0 })] }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problems.join(' ')).toMatch(/step 1/);
      expect(r.problems.join(' ')).not.toContain('SECRET VALUE');
    }
  });
});
