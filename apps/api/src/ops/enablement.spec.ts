import { RecordRetentionRule } from '../compliance/rules.service';
import { EnablementInput, evaluateEnablement, MANUAL_STEPS, summarize } from './enablement';

const unset: RecordRetentionRule = { days: null, validated: false, enforceable: null };
const ready: EnablementInput = {
  nodeEnv: 'production',
  config: { appUrl: 'https://app.example.ma', mailDriver: 'resend', opsAlertEmail: 'ops@example.ma', ocrConfigured: true },
  envIssues: [],
  consentLocales: { fr: true, en: true },
  retention: { idImages: { validated: true }, fiche: { days: 730, validated: true, enforceable: 730 }, register: { days: 1825, validated: true, enforceable: 1825 } },
  storageRoundTrip: true,
  chromium: true,
  tax: { disclaimersPresent: true, rulesValidated: true },
};
const statusOf = (i: EnablementInput, id: string) => evaluateEnablement(i).find((c) => c.id === id)?.status;

describe('evaluateEnablement', () => {
  it('has no automatic blocker when everything is in place, and still lists the manual steps', () => {
    const checks = evaluateEnablement(ready);
    expect(summarize(checks)).toEqual({ blocked: false, failed: 0, warnings: 0, manual: MANUAL_STEPS.length });
    expect(checks.filter((c) => c.status === 'manual').length).toBeGreaterThan(0);
  });

  it.each([
    ['env.production', { nodeEnv: 'development' }],
    ['env.valid', { envIssues: ['STORAGE_MASTER_KEYS: required in production'] }],
    ['env.mail', { config: { ...ready.config!, mailDriver: 'console' } }],
    ['env.app-url', { config: { ...ready.config!, appUrl: 'http://app.example.ma' } }],
    ['env.ops-alert', { config: { ...ready.config!, opsAlertEmail: undefined } }],
    ['consent.fr', { consentLocales: { fr: false, en: true } }],
    ['consent.en', { consentLocales: { fr: true, en: false } }],
    ['retention.id-images', { retention: { ...ready.retention, idImages: { validated: false } } }],
    ['retention.fiche', { retention: { ...ready.retention, fiche: unset } }],
    ['retention.fiche', { retention: { ...ready.retention, fiche: { days: 730, validated: false, enforceable: null } } }],
    ['storage.round-trip', { storageRoundTrip: false }],
    ['pdf.chromium', { chromium: false }],
    ['tax.disclaimer', { tax: { disclaimersPresent: false, rulesValidated: true } }],
  ] as [string, Partial<EnablementInput>][])('blocks on %s', (id, change) => {
    const checks = evaluateEnablement({ ...ready, ...change });
    expect(checks.find((c) => c.id === id)?.status).toBe('fail');
    expect(summarize(checks).blocked).toBe(true);
  });

  it('only warns while the tax rules are unvalidated defaults (beta exports)', () => {
    const checks = evaluateEnablement({ ...ready, tax: { disclaimersPresent: true, rulesValidated: false } });
    expect(checks.find((c) => c.id === 'tax.rules')?.status).toBe('warn');
    expect(summarize(checks).blocked).toBe(false);
  });

  it('only warns for a missing worker or an unset register period', () => {
    const checks = evaluateEnablement({ ...ready, config: { ...ready.config!, ocrConfigured: false }, retention: { ...ready.retention, register: unset } });
    expect(statusOf({ ...ready, config: { ...ready.config!, ocrConfigured: false } }, 'env.ocr')).toBe('warn');
    expect(checks.find((c) => c.id === 'retention.register')?.status).toBe('warn');
    expect(summarize(checks)).toMatchObject({ blocked: false, warnings: 2 });
  });

  it('does not run the storage round trip on an invalid environment and blocks', () => {
    const checks = evaluateEnablement({ ...ready, config: null, envIssues: ['S3_BUCKET: required'], storageRoundTrip: null });
    expect(checks.find((c) => c.id === 'storage.round-trip')?.status).toBe('fail');
    expect(checks.some((c) => c.id === 'env.mail')).toBe(false);
  });

  it('never prints a secret: messages carry variable names and reasons only', () => {
    const text = JSON.stringify(evaluateEnablement({ ...ready, envIssues: ['STORAGE_MASTER_KEYS: required in production'] }));
    expect(text).not.toMatch(/ops@example\.ma|app\.example\.ma/);
  });
});
