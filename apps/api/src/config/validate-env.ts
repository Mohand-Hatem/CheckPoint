const EXAMPLE_JWT_SECRET = 'checkpoint-dev-jwt-access-secret-replace-in-production';

// ConfigModule `validate`: stop the app at startup instead of failing on the first request.
export function validateEnv(env: Record<string, unknown>): Record<string, unknown> {
  const problems: string[] = [];

  for (const key of ['DATABASE_URL', 'JWT_ACCESS_SECRET']) {
    if (typeof env[key] !== 'string' || !(env[key] as string).trim()) {
      problems.push(`${key} is required`);
    }
  }
  for (const key of ['PORT', 'REFRESH_TOKEN_EXPIRES_DAYS']) {
    if (env[key] !== undefined && env[key] !== '' && !/^[1-9]\d*$/.test(String(env[key]))) {
      problems.push(`${key} must be a positive whole number`);
    }
  }
  const secret = env.JWT_ACCESS_SECRET;
  if (env.NODE_ENV === 'production' && typeof secret === 'string' && secret.trim()) {
    if (secret === EXAMPLE_JWT_SECRET || secret.length < 32) {
      problems.push('JWT_ACCESS_SECRET must be a private value of at least 32 characters in production');
    }
  }

  if (problems.length) {
    throw new Error(`Invalid configuration:\n- ${problems.join('\n- ')}`);
  }
  return env;
}
