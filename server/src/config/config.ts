export interface AppConfig {
  port: number;
  isProduction: boolean;
  corsOrigins: string[];
  normalPingIntervalSec: number;
  emergencyPingIntervalSec: number;
  /** Telemetry older than this is rejected (seconds). */
  telemetryMaxAgeSec: number;
  /** Telemetry stamped later than now + this is rejected (seconds). */
  telemetryMaxFutureSec: number;
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
    telemetryMaxAgeSec: intOr(env.TELEMETRY_MAX_AGE_SEC, 600),
    telemetryMaxFutureSec: intOr(env.TELEMETRY_MAX_FUTURE_SEC, 120),
  };
}
