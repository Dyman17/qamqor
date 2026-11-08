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
  /** Number of reverse-proxy hops to trust for the client IP (0 = none). Default 1 in production. */
  trustProxyHops: number;
  /** A collar is OFFLINE after this many missed normal pings. */
  offlineAfterMissedPings: number;
  /** offlineAfterMissedPings x normalPingIntervalSec. */
  offlineThresholdSec: number;
  /** How often the offline watcher runs (seconds). */
  offlineCheckIntervalSec: number;
  /** The offline watcher is off in tests and when SCHEDULER_ENABLED=false. */
  schedulerEnabled: boolean;
  /** Demo modes (MANUAL / AUTO). false = simulation routes answer 404 and the simulator never starts. */
  demoModesEnabled: boolean;
  /** Simulator tick period (seconds). */
  simTickSec: number;
  /** Demo-only shortened "collar is silent" threshold of the AUTO scenario (seconds). */
  simDemoOfflineSec: number;
}

function intOr(v: string | undefined, def: number): number {
  const n = parseInt(v ?? '', 10);
  return Number.isInteger(n) && n > 0 ? n : def;
}

function nonNegIntOr(v: string | undefined, def: number): number {
  if (v === undefined || v === '') return def;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : def;
}

export function loadAppConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const normalPingIntervalSec = intOr(env.NORMAL_PING_INTERVAL_SEC, 300);
  const offlineAfterMissedPings = intOr(env.OFFLINE_AFTER_MISSED_PINGS, 3);
  return {
    port: intOr(env.PORT, 4000),
    isProduction: env.NODE_ENV === 'production',
    corsOrigins: (env.CORS_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    normalPingIntervalSec,
    emergencyPingIntervalSec: intOr(env.EMERGENCY_PING_INTERVAL_SEC, 60),
    telemetryMaxAgeSec: intOr(env.TELEMETRY_MAX_AGE_SEC, 600),
    telemetryMaxFutureSec: intOr(env.TELEMETRY_MAX_FUTURE_SEC, 120),
    trustProxyHops: nonNegIntOr(env.TRUST_PROXY_HOPS, env.NODE_ENV === 'production' ? 1 : 0),
    offlineAfterMissedPings,
    offlineThresholdSec: offlineAfterMissedPings * normalPingIntervalSec,
    offlineCheckIntervalSec: intOr(env.OFFLINE_CHECK_INTERVAL_SEC, 60),
    schedulerEnabled: env.NODE_ENV !== 'test' && env.SCHEDULER_ENABLED !== 'false',
    demoModesEnabled: env.DEMO_MODES_ENABLED !== 'false',
    simTickSec: intOr(env.SIM_TICK_SEC, 10),
    simDemoOfflineSec: intOr(env.SIM_DEMO_OFFLINE_SEC, 90),
  };
}
