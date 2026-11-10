/** Helpers of the collar control modes (AUTO / GPS_MANUAL / MANUAL): expiry and leaving GPS_MANUAL. */

export interface ControlModeFields {
  controlMode?: string | null;
  controlActivityAt?: Date | string | null;
}

/** Data that puts a collar back to AUTO and clears the manual point. */
export const AUTO_RESET_DATA = {
  controlMode: 'AUTO' as const,
  manualLatitude: null,
  manualLongitude: null,
  manualPositionAt: null,
  controlModeSince: null,
  controlActivityAt: null,
};

/** When a non-AUTO mode lapses (null in AUTO or when no activity is recorded). */
export function controlModeExpiresAt(d: ControlModeFields, ttlMs: number): Date | null {
  if (!d.controlMode || d.controlMode === 'AUTO' || !d.controlActivityAt) return null;
  return new Date(new Date(d.controlActivityAt).getTime() + ttlMs);
}

/** A non-AUTO mode without any recorded activity counts as lapsed (fail towards AUTO = automatic protection). */
export function isControlModeExpired(d: ControlModeFields, nowMs: number, ttlMs: number): boolean {
  if (!d.controlMode || d.controlMode === 'AUTO') return false;
  if (!d.controlActivityAt) return true;
  return nowMs - new Date(d.controlActivityAt).getTime() >= ttlMs;
}

/**
 * The animal of a collar that leaves GPS_MANUAL still carries the dragged point and the server time of the
 * last drag as `lastSeenAt`, which would make the first real ping look stale. Restores the last RELIABLE real
 * fix stored in the telemetry (the real GPS is stored in GPS_MANUAL too), or clears `lastSeenAt` when there
 * is none. Returns the restored `lastSeenAt`.
 */
export async function leaveGpsManual(db: any, deviceId: string, animalId: string): Promise<Date | null> {
  const real = await db.telemetry.findFirst({
    where: { deviceId, latitude: { not: null }, longitude: { not: null }, accuracy: { lte: 35 } },
    orderBy: { timestamp: 'desc' },
    select: { latitude: true, longitude: true, accuracy: true, timestamp: true },
  });
  if (real) {
    await db.animal.update({
      where: { id: animalId },
      data: { lastLatitude: real.latitude, lastLongitude: real.longitude, lastAccuracy: real.accuracy, lastSeenAt: real.timestamp },
    });
    return real.timestamp;
  }
  await db.animal.update({ where: { id: animalId }, data: { lastSeenAt: null } });
  return null;
}
