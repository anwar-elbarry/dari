import { redactText, redactValue } from './redact';

describe('redactText', () => {
  it.each([
    ['email', 'reset failed for fatima.benali@example.com today', 'fatima.benali@example.com'],
    ['international phone', 'call +212 6 12 34 56 78 now', '+212 6 12 34 56 78'],
    ['national phone', 'call 06 12 34 56 78 now', '06 12 34 56 78'],
    ['passport number', 'document XK1234567 rejected', 'XK1234567'],
    ['CIN number', 'cin BK123456 read', 'BK123456'],
    ['MRZ line 1', 'P<MARSPECIMEN<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<<', 'SPECIMEN<<ANNA'],
    ['MRZ line 2', 'L898902C36MAR7408122F1204159ZE184226B<<<<<10', 'L898902C36MAR7408122F1204159ZE184226B<<<<<10'],
    ['token', 'link /checkin/Zm9vYmFyYmF6cXV4eHl6MTIzNDU2Nzg5MGFiY2RlZg', 'Zm9vYmFyYmF6cXV4eHl6MTIzNDU2Nzg5MGFiY2RlZg'],
    ['long digits', 'account 123456789012 failed', '123456789012'],
  ])('removes a %s', (_label, text, secret) => {
    const out = redactText(text);
    expect(out).not.toContain(secret);
    expect(out).toMatch(/\[[a-z]+\]/);
  });

  it('keeps ids and ordinary technical text readable', () => {
    const text = 'feed 3f2b8c1e-9d4a-4c7e-8a55-1b2c3d4e5f60 synced 12 events in 340 ms (2026-09-29)';
    expect(redactText(text)).toBe(text);
  });
});

describe('redactValue', () => {
  it('masks sensitive keys at any depth and redacts other strings', () => {
    const out = redactValue({
      bookingId: 'b1',
      guest: { firstName: 'Anna', documentNumber: 'L898902C3', notes: 'mail anna@example.com' },
      list: [{ password: 'x' }],
    });
    expect(JSON.stringify(out)).not.toMatch(/Anna|L898902C3|anna@example\.com/);
    expect(out).toMatchObject({ bookingId: 'b1', guest: { firstName: '[redacted]' }, list: [{ password: '[redacted]' }] });
  });

  it('does not loop on deep or circular structures', () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => redactValue(a)).not.toThrow();
  });
});
