import { loadAppConfig } from '../config/config';

export type ConnState = 'ONLINE' | 'OFFLINE' | 'UNASSIGNED';

/** Collar is offline after this many missed pings (default 3 x NORMAL_PING_INTERVAL_SEC = 900 s). */
export function offlineThresholdMs(env: Record<string, string | undefined> = process.env): number {
  return loadAppConfig(env).offlineThresholdSec * 1000;
}

/**
 * Connectivity is derived from the time of the last ping, never stored.
 * A collar without an animal is UNASSIGNED; an assigned one that was never heard is OFFLINE.
 */
export function computeConnState(
  d: { hasAnimal: boolean; lastSeenAt: Date | null | undefined },
  now: number = Date.now(),
  thresholdMs: number = offlineThresholdMs(),
): ConnState {
  if (!d.hasAnimal) return 'UNASSIGNED';
  if (!d.lastSeenAt) return 'OFFLINE';
  return now - d.lastSeenAt.getTime() > thresholdMs ? 'OFFLINE' : 'ONLINE';
}
