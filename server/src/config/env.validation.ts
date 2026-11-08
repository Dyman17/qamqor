/**
 * Startup environment validation (no external deps).
 * Throws with a readable message when the configuration is unsafe or incomplete.
 */
export const KNOWN_WEAK_SECRETS = [
  'qamqor_jwt_dev_super_secret_change_in_production_2026',
  'qamqor_jwt_secret_dev_key_2026_kz',
  'qamqor_esp32_device_shared_key_2026',
  'CHANGE_ME',
  'changeme',
  'secret',
];

export const MIN_JWT_SECRET_LENGTH = 32;

export function validateEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const errors: string[] = [];

  if (!env.DATABASE_URL) errors.push('DATABASE_URL is required');

  const jwt = env.JWT_SECRET;
  if (!jwt) {
    errors.push('JWT_SECRET is required');
  } else {
    if (jwt.length < MIN_JWT_SECRET_LENGTH) {
      errors.push(`JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters`);
    }
    if (KNOWN_WEAK_SECRETS.some((w) => jwt.includes(w))) {
      errors.push('JWT_SECRET must not be a known example or fallback value');
    }
  }

  if (env.NODE_ENV === 'production' && !env.CORS_ORIGINS) {
    errors.push('CORS_ORIGINS is required in production');
  }

  for (const key of ['NORMAL_PING_INTERVAL_SEC', 'EMERGENCY_PING_INTERVAL_SEC', 'TELEMETRY_MAX_AGE_SEC', 'TELEMETRY_MAX_FUTURE_SEC', 'OFFLINE_AFTER_MISSED_PINGS', 'OFFLINE_CHECK_INTERVAL_SEC', 'PORT']) {
    const v = env[key];
    if (v !== undefined && v !== '' && !(Number.isInteger(Number(v)) && Number(v) > 0)) {
      errors.push(`${key} must be a positive integer`);
    }
  }

  if (errors.length) {
    throw new Error(`Invalid environment configuration:\n - ${errors.join('\n - ')}`);
  }
  return env;
}
