import { parseEnv } from './env';

const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db', JWT_ACCESS_SECRET: 'x'.repeat(32) };

describe('parseEnv', () => {
  it('applies defaults', () => {
    const env = parseEnv(base);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3001);
    expect(env.MAIL_DRIVER).toBe('console');
    expect(env.TRUST_PROXY).toBe(1);
  });

  it('coerces numeric strings', () => {
    expect(parseEnv({ ...base, PORT: '8080', THROTTLE_LIMIT: '5' })).toMatchObject({ PORT: 8080, THROTTLE_LIMIT: 5 });
  });

  it('fails when DATABASE_URL is missing', () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it('refuses the console mail driver in production', () => {
    expect(() => parseEnv({ ...base, NODE_ENV: 'production' })).toThrow(/MAIL_DRIVER/);
  });

  it('refuses the file mail driver in production', () => {
    expect(() => parseEnv({ ...base, NODE_ENV: 'production', MAIL_DRIVER: 'file' })).toThrow(/MAIL_DRIVER/);
  });

  it('requires an API key with the brevo and resend drivers, and accepts them in production', () => {
    for (const MAIL_DRIVER of ['brevo', 'resend']) {
      expect(() => parseEnv({ ...base, MAIL_DRIVER })).toThrow(/MAIL_API_KEY/);
      expect(parseEnv({ ...base, MAIL_DRIVER, MAIL_API_KEY: 'k'.repeat(20) }).MAIL_DRIVER).toBe(MAIL_DRIVER);
    }
    const prod = { ...base, NODE_ENV: 'production', JWT_ACCESS_SECRET: 'Zq3'.repeat(15), REDIS_URL: 'redis://localhost:6379' };
    expect(parseEnv({ ...prod, MAIL_DRIVER: 'brevo', MAIL_API_KEY: 'k'.repeat(20) }).MAIL_DRIVER).toBe('brevo');
  });

  it('requires a long JWT secret', () => {
    expect(() => parseEnv({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('refuses placeholder or short JWT secrets in production', () => {
    const prod = { ...base, NODE_ENV: 'production', MAIL_DRIVER: 'console' };
    expect(() => parseEnv({ ...prod, JWT_ACCESS_SECRET: 'change-me-to-a-long-random-value-000000' })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => parseEnv({ ...prod, JWT_ACCESS_SECRET: 'x'.repeat(40) })).toThrow(/JWT_ACCESS_SECRET/);
    // Only MAIL_DRIVER remains wrong with a proper secret.
    expect(() => parseEnv({ ...prod, JWT_ACCESS_SECRET: 'Zq3'.repeat(15) })).toThrow(/^(?!.*JWT_ACCESS_SECRET).*MAIL_DRIVER/s);
  });

  it('derives secure cookies from NODE_ENV and refuses insecure cookies in production', () => {
    expect(parseEnv(base).COOKIE_SECURE).toBe(false);
    expect(parseEnv({ ...base, COOKIE_SECURE: 'true' }).COOKIE_SECURE).toBe(true);
    expect(() => parseEnv({ ...base, NODE_ENV: 'production', MAIL_DRIVER: 'console', COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE/);
  });

  it('requires REDIS_URL in production only', () => {
    expect(parseEnv(base).REDIS_URL).toBeUndefined();
    expect(() => parseEnv({ ...base, NODE_ENV: 'production', MAIL_DRIVER: 'console' })).toThrow(/REDIS_URL/);
  });

  it('refuses insecure calendar fetching in production', () => {
    expect(parseEnv({ ...base, ICAL_ALLOW_INSECURE: 'true' }).ICAL_ALLOW_INSECURE).toBe(true);
    expect(() => parseEnv({ ...base, NODE_ENV: 'production', ICAL_ALLOW_INSECURE: 'true' })).toThrow(/ICAL_ALLOW_INSECURE/);
  });

  it('refuses disabled rate limiting in production', () => {
    expect(parseEnv({ ...base, RATE_LIMIT_ENABLED: 'false' }).RATE_LIMIT_ENABLED).toBe(false);
    expect(() => parseEnv({ ...base, NODE_ENV: 'production', RATE_LIMIT_ENABLED: 'false' })).toThrow(/RATE_LIMIT_ENABLED/);
  });

  it('never echoes values in the error message', () => {
    const secret = 'postgresql-not-a-url-s3cr3t';
    expect(() => parseEnv({ ...base, DATABASE_URL: secret })).toThrow(expect.objectContaining({ message: expect.not.stringContaining(secret) }));
  });
});
