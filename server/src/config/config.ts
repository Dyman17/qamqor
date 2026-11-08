export interface AppConfig {
  port: number;
  isProduction: boolean;
  corsOrigins: string[];
  normalPingIntervalSec: number;
  emergencyPingIntervalSec: number;
}

function intOr(v: string | undefined, def: number): number {
  const n = parseInt(v ?? '', 10);
  return Number.isInteger(n) && n > 0 ? n : def;
}

export function loadAppConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  return {
    port: intOr(env.PORT, 4000),
    isProduction: env.NODE_ENV === 'production',
    corsOrigins: (env.CORS_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    normalPingIntervalSec: intOr(env.NORMAL_PING_INTERVAL_SEC, 300),
    emergencyPingIntervalSec: intOr(env.EMERGENCY_PING_INTERVAL_SEC, 60),
  };
}
