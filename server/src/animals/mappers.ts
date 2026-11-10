import type { Prisma } from '@prisma/client';
import { computeConnState } from '../devices/connectivity';
import { controlModeExpiresAt } from '../devices/control-mode';
import { controlModeTtlMs } from '../devices/devices.service';
import type { CollarControlMode, PositionSource } from '@qamqor/shared';
import { computePulseThreat, type PulseThreatDto } from './pulse-analysis';

export type AnimalStatus = 'ok' | 'danger' | 'warning' | 'offline';

export interface AnimalDto {
  id: string;
  farmId: string;
  name: string;
  tag: string;
  species: 'CATTLE' | 'HORSE' | 'CAMEL' | 'SHEEP' | 'GOAT';
  gender: 'MALE' | 'FEMALE' | 'UNKNOWN';
  breed: string | null;
  birthDate: string | null;
  photoUrl: string | null;
  penId: string | null;
  collarId: string | null;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  lastSeenAt: string | null;
  /** Last pulse, BPM (null = never measured). */
  lastHeartRate: number | null;
  lastHeartRateAt: string | null;
  /** Physiological threat level and baseline analysis based on species */
  pulseThreat?: PulseThreatDto | null;
  status: AnimalStatus;
  /** Demo (simulated) animal; deleted when the farm returns to REAL mode. */
  isDemo: boolean;
  /** Control mode of the animal's collar (null = no collar). */
  controlMode: CollarControlMode | null;
  /** MANUAL when the shown position is the operator's dragged point (collar in GPS_MANUAL), else GPS. */
  positionSource: PositionSource;
  controlModeSince: string | null;
  controlModeExpiresAt: string | null;
}

/** What `toAnimalDto` needs from Prisma (never selects any secret). */
export const ANIMAL_INCLUDE: Prisma.AnimalInclude = {
  device: { select: { deviceId: true, lastHeartbeatAt: true, controlMode: true, controlModeSince: true, controlActivityAt: true } },
  alerts: {
    where: { status: 'ACTIVE', type: { in: ['GPS_LOST', 'SIGNAL_LIMIT_REACHED'] } },
    select: { id: true },
    take: 1,
  },
};

/**
 * Status of the animal on the map/list:
 * danger  - last known position is outside the border;
 * offline - no collar, or the collar has been silent longer than the offline threshold;
 * warning - an active GPS_LOST or SIGNAL_LIMIT_REACHED alert;
 * ok      - otherwise.
 */
export function animalStatus(a: any, now: number = Date.now()): AnimalStatus {
  if (a.isOutsideGeofence) return 'danger';
  const conn = computeConnState({ hasAnimal: true, lastSeenAt: a.device?.lastHeartbeatAt ?? null }, now);
  if (!a.device || conn === 'OFFLINE') return 'offline';
  if (a.alerts?.length) return 'warning';
  return 'ok';
}

export function toAnimalDto(a: any, now: number = Date.now()): AnimalDto {
  return {
    id: a.id,
    farmId: a.farmId,
    name: a.name,
    tag: a.tagNumber,
    species: a.species,
    gender: a.gender,
    breed: a.breed ?? null,
    birthDate: a.birthDate ? a.birthDate.toISOString().slice(0, 10) : null,
    photoUrl: a.photoUrl ?? null,
    penId: a.activeGeofenceId ?? null,
    collarId: a.device?.deviceId ?? null,
    lat: a.lastLatitude ?? null,
    lng: a.lastLongitude ?? null,
    accuracyM: a.lastAccuracy ?? null,
    lastSeenAt: a.lastSeenAt ? a.lastSeenAt.toISOString() : null,
    lastHeartRate: a.lastHeartRate ?? null,
    lastHeartRateAt: a.lastHeartRateAt ? a.lastHeartRateAt.toISOString() : null,
    pulseThreat: computePulseThreat(a.species, a.lastHeartRate),
    status: animalStatus(a, now),
    isDemo: a.isDemo ?? false,
    controlMode: a.device ? (a.device.controlMode ?? 'AUTO') : null,
    positionSource: a.device?.controlMode === 'GPS_MANUAL' ? 'MANUAL' : 'GPS',
    controlModeSince: a.device?.controlMode && a.device.controlMode !== 'AUTO' && a.device.controlModeSince ? new Date(a.device.controlModeSince).toISOString() : null,
    controlModeExpiresAt: a.device ? controlModeExpiresAt(a.device, controlModeTtlMs())?.toISOString() ?? null : null,
  };
}
