import { validateEnv } from './validate-env';

describe('validateEnv (Phase 1: config validation)', () => {
  const base = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    JWT_ACCESS_SECRET: 'checkpoint-dev-jwt-access-secret-replace-in-production',
  };

  it('accepts a valid development config and returns it unchanged', () => {
    const env = { ...base, PORT: '4000', REFRESH_TOKEN_EXPIRES_DAYS: '30' };
    expect(validateEnv(env)).toBe(env);
  });

  it.each(['DATABASE_URL', 'JWT_ACCESS_SECRET'])('refuses to start without %s', (key) => {
    expect(() => validateEnv({ ...base, [key]: '' })).toThrow(key);
  });

  it.each(['PORT', 'REFRESH_TOKEN_EXPIRES_DAYS'])('refuses a %s that is not a positive whole number', (key) => {
    expect(() => validateEnv({ ...base, [key]: 'abc' })).toThrow(key);
    expect(() => validateEnv({ ...base, [key]: '0' })).toThrow(key);
  });

  it('refuses the example JWT secret or a short one in production', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production' })).toThrow('JWT_ACCESS_SECRET');
    expect(() => validateEnv({ ...base, NODE_ENV: 'production', JWT_ACCESS_SECRET: 'short' })).toThrow(
      'JWT_ACCESS_SECRET',
    );
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'production', JWT_ACCESS_SECRET: 'x'.repeat(32) }),
    ).not.toThrow();
  });

  it('lists every problem at once', () => {
    expect(() => validateEnv({ PORT: 'x' })).toThrow(/DATABASE_URL[\s\S]*JWT_ACCESS_SECRET[\s\S]*PORT/);
  });
});
