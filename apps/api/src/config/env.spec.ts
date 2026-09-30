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

  it('requires an API key with the resend driver, and accepts it in production', () => {
    for (const MAIL_DRIVER of ['resend']) {
      expect(() => parseEnv({ ...base, MAIL_DRIVER })).toThrow(/MAIL_API_KEY/);
      expect(parseEnv({ ...base, MAIL_DRIVER, MAIL_API_KEY: 'k'.repeat(20) }).MAIL_DRIVER).toBe(MAIL_DRIVER);
    }
    const storage = { STORAGE_DRIVER: 's3', S3_BUCKET: 'dari-private', S3_ACCESS_KEY: 'a', S3_SECRET_KEY: 'b', S3_SSE: 'true', STORAGE_MASTER_KEYS: `k1:${Buffer.alloc(32, 7).toString('base64')}` };
    const prod = { ...base, ...storage, NODE_ENV: 'production', JWT_ACCESS_SECRET: 'Zq3'.repeat(15), REDIS_URL: 'redis://localhost:6379' };
    expect(parseEnv({ ...prod, MAIL_DRIVER: 'resend', MAIL_API_KEY: 'k'.repeat(20) }).MAIL_DRIVER).toBe('resend');
  });

  describe('object storage', () => {
    const key = () => `k1:${Buffer.alloc(32, 7).toString('base64')}`;
    const s3 = { STORAGE_DRIVER: 's3', S3_BUCKET: 'dari-private', S3_ACCESS_KEY: 'a', S3_SECRET_KEY: 'b', STORAGE_MASTER_KEYS: key() };
    const prod = { ...base, NODE_ENV: 'production', JWT_ACCESS_SECRET: 'Zq3'.repeat(15), REDIS_URL: 'redis://localhost:6379', MAIL_DRIVER: 'resend', MAIL_API_KEY: 'k'.repeat(20) };

    it('runs in development with the memory driver and no key', () => {
      expect(parseEnv(base)).toMatchObject({ STORAGE_DRIVER: 'memory', STORAGE_MAX_BYTES: 16 * 1024 * 1024, S3_FORCE_PATH_STYLE: true, S3_SSE: false });
    });

    it('requires bucket, credentials and master keys with the s3 driver', () => {
      expect(() => parseEnv({ ...base, STORAGE_DRIVER: 's3' })).toThrow(/S3_BUCKET[\s\S]*STORAGE_MASTER_KEYS/);
      expect(parseEnv({ ...base, ...s3 }).STORAGE_DRIVER).toBe('s3');
    });

    it('validates the master keys without echoing them', () => {
      const bad = 'k1:' + 'A'.repeat(20);
      let message = '';
      try {
        parseEnv({ ...base, STORAGE_MASTER_KEYS: bad });
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toMatch(/STORAGE_MASTER_KEYS/);
      expect(message).not.toContain('AAAAAAAAAA');
    });

    it('in production requires s3, master keys, server-side encryption and https once the feature is on', () => {
      const on = { ...prod, GUEST_CHECKIN_ENABLED: 'true' };
      expect(() => parseEnv(on)).toThrow(/STORAGE_DRIVER/);
      expect(() => parseEnv({ ...on, ...s3 })).toThrow(/S3_SSE/);
      expect(() => parseEnv({ ...on, ...s3, S3_SSE: 'true', S3_ENDPOINT: 'http://storage.internal:9000' })).toThrow(/S3_ENDPOINT/);
      expect(parseEnv({ ...on, ...s3, S3_SSE: 'true', S3_ENDPOINT: 'https://storage.internal' }).STORAGE_DRIVER).toBe('s3');
    });

    it('in production does not need storage while the feature is off', () => {
      expect(parseEnv(prod).GUEST_CHECKIN_ENABLED).toBe(false);
    });
  });

  describe('document worker', () => {
    it('needs a strong shared secret when a URL is set, and is optional otherwise', () => {
      expect(parseEnv(base).OCR_SERVICE_URL).toBeUndefined();
      expect(() => parseEnv({ ...base, OCR_SERVICE_URL: 'http://ocr:8001' })).toThrow(/OCR_SHARED_SECRET/);
      expect(() => parseEnv({ ...base, OCR_SERVICE_URL: 'http://ocr:8001', OCR_SHARED_SECRET: 'short' })).toThrow(/OCR_SHARED_SECRET/);
      expect(parseEnv({ ...base, OCR_SERVICE_URL: 'http://ocr:8001', OCR_SHARED_SECRET: 's'.repeat(32) }).OCR_SERVICE_URL).toBe('http://ocr:8001');
    });
  });

  describe('GUEST_CHECKIN_ENABLED', () => {
    it('is on in development and test, off by default in production', () => {
      expect(parseEnv(base).GUEST_CHECKIN_ENABLED).toBe(true);
      expect(parseEnv({ ...base, NODE_ENV: 'test' }).GUEST_CHECKIN_ENABLED).toBe(true);
      const prod = { ...base, NODE_ENV: 'production', JWT_ACCESS_SECRET: 'Zq3'.repeat(15), REDIS_URL: 'redis://localhost:6379', MAIL_DRIVER: 'resend', MAIL_API_KEY: 'k'.repeat(20) };
      expect(parseEnv(prod).GUEST_CHECKIN_ENABLED).toBe(false);
    });

    it('can be switched explicitly', () => {
      expect(parseEnv({ ...base, GUEST_CHECKIN_ENABLED: 'false' }).GUEST_CHECKIN_ENABLED).toBe(false);
      expect(() => parseEnv({ ...base, GUEST_CHECKIN_ENABLED: 'yes' })).toThrow(/GUEST_CHECKIN_ENABLED/);
    });
  });

  describe('WHATSAPP_ENABLED', () => {
    const prod = { ...base, NODE_ENV: 'production', JWT_ACCESS_SECRET: 'Zq3'.repeat(15), REDIS_URL: 'redis://localhost:6379', MAIL_DRIVER: 'resend', MAIL_API_KEY: 'k'.repeat(20) };
    it('is on in development and test, off by default in production, independent of the other flags', () => {
      expect(parseEnv(base).WHATSAPP_ENABLED).toBe(true);
      expect(parseEnv({ ...base, NODE_ENV: 'test' }).WHATSAPP_ENABLED).toBe(true);
      expect(parseEnv(prod).WHATSAPP_ENABLED).toBe(false);
      expect(parseEnv({ ...prod, WHATSAPP_ENABLED: 'false' }).WHATSAPP_ENABLED).toBe(false);
      expect(parseEnv({ ...prod, GUEST_CHECKIN_ENABLED: 'false' }).WHATSAPP_ENABLED).toBe(false);
    });
    it('can be switched explicitly and refuses other values', () => {
      expect(parseEnv({ ...base, WHATSAPP_ENABLED: 'false' }).WHATSAPP_ENABLED).toBe(false);
      expect(() => parseEnv({ ...base, WHATSAPP_ENABLED: 'yes' })).toThrow(/WHATSAPP_ENABLED/);
    });
    it('does not make the storage settings mandatory: it stores no file', () => {
      expect(parseEnv({ ...prod, WHATSAPP_ENABLED: 'true' }).WHATSAPP_ENABLED).toBe(true);
    });
  });

  describe.each(['POLICE_REGISTER_ENABLED', 'SECURE_SHARE_ENABLED', 'TAX_REPORTS_ENABLED'] as const)('%s', (flag) => {
    const prod = { ...base, NODE_ENV: 'production', JWT_ACCESS_SECRET: 'Zq3'.repeat(15), REDIS_URL: 'redis://localhost:6379', MAIL_DRIVER: 'resend', MAIL_API_KEY: 'k'.repeat(20) };
    it('is on in development and test, off by default in production, and independent of the check-in flag', () => {
      expect(parseEnv(base)[flag]).toBe(true);
      expect(parseEnv({ ...base, NODE_ENV: 'test' })[flag]).toBe(true);
      expect(parseEnv(prod)[flag]).toBe(false);
      expect(parseEnv({ ...prod, GUEST_CHECKIN_ENABLED: 'false', [flag]: 'false' })[flag]).toBe(false);
    });
    it('can be switched explicitly and refuses other values', () => {
      expect(parseEnv({ ...base, [flag]: 'false' })[flag]).toBe(false);
      expect(() => parseEnv({ ...base, [flag]: 'yes' })).toThrow(new RegExp(flag));
    });
    it('in production needs the storage settings once on, even with the guest feature off', () => {
      expect(() => parseEnv({ ...prod, [flag]: 'true' })).toThrow(/STORAGE_DRIVER/);
    });
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
