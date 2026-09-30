import { shareStatus, trimUserAgent } from './share.service';

describe('shareStatus', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  it('revoked wins, then expired at the exact expiry, else active', () => {
    expect(shareStatus({ revokedAt: new Date('2026-10-01T11:00:00Z'), expiresAt: new Date('2026-10-02T00:00:00Z') }, now)).toBe('REVOKED');
    expect(shareStatus({ revokedAt: null, expiresAt: now }, now)).toBe('EXPIRED');
    expect(shareStatus({ revokedAt: null, expiresAt: new Date(now.getTime() + 1) }, now)).toBe('ACTIVE');
  });
});

describe('trimUserAgent', () => {
  it('drops control and bidi characters, trims and caps the length', () => {
    expect(trimUserAgent('  Mozilla/5.0\r\n‮ evil\u0000 ')).toBe('Mozilla/5.0 evil');
    expect(trimUserAgent('x'.repeat(500))).toHaveLength(120);
    expect(trimUserAgent(undefined)).toBe('');
  });
});
