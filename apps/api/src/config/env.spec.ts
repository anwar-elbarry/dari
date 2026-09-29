import { parseEnv } from './env';

const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };

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

  it('never echoes values in the error message', () => {
    const secret = 'postgresql-not-a-url-s3cr3t';
    expect(() => parseEnv({ DATABASE_URL: secret })).toThrow(expect.objectContaining({ message: expect.not.stringContaining(secret) }));
  });
});
