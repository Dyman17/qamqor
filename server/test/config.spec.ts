import { validateEnv, KNOWN_WEAK_SECRETS } from '../src/config/env.validation';
import { loadAppConfig } from '../src/config/config';

const good = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/x',
  JWT_SECRET: 'a'.repeat(16) + 'B'.repeat(16) + '1',
};

describe('validateEnv', () => {
  it('accepts a valid set', () => {
    expect(() => validateEnv(good)).not.toThrow();
  });
  it('rejects missing JWT_SECRET', () => {
    expect(() => validateEnv({ DATABASE_URL: good.DATABASE_URL })).toThrow(/JWT_SECRET is required/);
  });
  it('rejects short JWT_SECRET', () => {
    expect(() => validateEnv({ ...good, JWT_SECRET: 'short' })).toThrow(/at least 32/);
  });
  it('rejects known weak values', () => {
    for (const w of KNOWN_WEAK_SECRETS) {
      expect(() => validateEnv({ ...good, JWT_SECRET: w.padEnd(40, 'x') })).toThrow(/known example/);
    }
  });
  it('rejects missing DATABASE_URL', () => {
    expect(() => validateEnv({ JWT_SECRET: good.JWT_SECRET })).toThrow(/DATABASE_URL/);
  });
  it('requires CORS_ORIGINS in production only', () => {
    expect(() => validateEnv({ ...good, NODE_ENV: 'production' })).toThrow(/CORS_ORIGINS/);
    expect(() => validateEnv({ ...good, NODE_ENV: 'production', CORS_ORIGINS: 'https://a.example' })).not.toThrow();
  });
});

describe('loadAppConfig', () => {
  it('reads PORT and defaults', () => {
    const c = loadAppConfig({ PORT: '10000' });
    expect(c.port).toBe(10000);
    expect(c.normalPingIntervalSec).toBe(300);
    expect(c.emergencyPingIntervalSec).toBe(60);
  });
  it('parses CORS_ORIGINS list', () => {
    expect(loadAppConfig({ CORS_ORIGINS: 'https://a.example, https://b.example' }).corsOrigins).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });
});
