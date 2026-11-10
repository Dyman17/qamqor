import {
  AnimalSpecies,
  AnimalGender,
  DeviceStatus,
  AlertStatus,
  AlertType,
  AlertSeverity,
  FarmRole,
} from '../shared';

// ==========================================
// 1. VIRTUAL FENCING & STEERING CONSTRAINTS (V2)
// ==========================================

export enum Zone {
  GREEN = 'GREEN',
  YELLOW = 'YELLOW',
  ORANGE = 'ORANGE',
  RED = 'RED',
  ESCAPE = 'ESCAPE',
  UNKNOWN = 'UNKNOWN',
}

export const VirtualFenceZone = Zone;
export type VirtualFenceZone = Zone;

// The impulse (shock) is not part of the API: it is never requested, returned or described here
// until hardware and a veterinary opinion are approved.

// ==========================================
// 2. ESP32 DEVICE INGESTION CONTRACT
// Endpoint: POST /api/v1/device/telemetry
// ==========================================

export interface DeviceTelemetryRequestDto {
  /** 8-digit device code (^[0-9]{8}$); may also be sent in the X-Device-Code header. */
  code?: string;
  /** Legacy public collar id; optional, ignored: the code identifies the device. */
  deviceId?: string;
  /** ISO 8601; accepted when not older than 10 min and not later than +2 min (configurable). */
  timestamp?: string;
  /** latitude, longitude and accuracy go together; omit all three when there is no GPS fix. */
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  signal?: number;
  speedKmh?: number;
  hdop?: number;
  satellites?: number;
  /** Pulse, BPM (20..250); null or absent = no sensor contact. */
  heartRate?: number | null;
}

export interface DeviceTelemetryResponseDto {
  success: boolean;
  /** Farm data mode for the collar: REAL, PILOT (owner-driven demo) or AUTO (server demo). */
  mode?: 'REAL' | 'PILOT' | 'AUTO';
  /** The request's device code, echoed. The firmware discards a response whose code differs. */
  code?: string;
  serverTime: string;
  nextInterval: number;
  configVersion: number;
  command?: { id: string; type: 'TEST_SOUND' | 'TEST_SPEAKER' | 'TEST_BUZZER' | 'TEST_VIBRATION' };
  /** null = boundary not set / invalid or unreliable fix (zone UNKNOWN). */
  inFence: boolean | null;
  zone: Zone | 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED' | 'ESCAPE' | 'UNKNOWN';
  distanceToBorderMeters: number | null;
  toneFrequencyHz: number;
  vibrate: boolean;
  vibrateDurationMs: number;
  sound: boolean;
  /** Set when a daily signal limit suppressed a signal. */
  suppressedBy?: 'SIGNAL_LIMIT' | null;
  warningMessage?: string;
  /** Control mode of the collar (AUTO when absent). MANUAL = no automatic zone signals, GPS_MANUAL = the operator's point is used. */
  controlMode?: 'AUTO' | 'GPS_MANUAL' | 'MANUAL';
}

// ==========================================
// 2b. COLLAR CONTROL MODES
// PATCH /api/v1/devices/:id/control-mode, PUT /api/v1/devices/:id/manual-position
// ==========================================

export interface SetControlModeRequestDto {
  mode: 'AUTO' | 'GPS_MANUAL' | 'MANUAL';
}

export interface ManualPositionRequestDto {
  latitude: number;
  longitude: number;
}

export interface ManualPositionResponseDto {
  deviceId: string;
  controlMode: 'GPS_MANUAL';
  positionSource: 'MANUAL';
  position: { latitude: number; longitude: number; at: string };
  zone: 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED' | 'ESCAPE' | 'UNKNOWN';
  inFence: boolean | null;
  distanceToBorderMeters: number | null;
}

// ==========================================
// 3. AUTHENTICATION & USERS
// ==========================================

export interface RegisterUserDto {
  email: string;
  password: string;
  fullName: string;
  phone?: string;
  farmName?: string;
}

export interface LoginDto {
  email: string;
  password: string;
}

export interface AuthResponseDto {
  token: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    farmId?: string;
  };
}

// ==========================================
// 4. ANIMALS
// ==========================================

export interface CreateAnimalDto {
  name: string;
  tagNumber: string;
  species: AnimalSpecies;
  gender?: AnimalGender;
  birthDate?: string;
  breed?: string;
  notes?: string;
  deviceId?: string;
}

export interface AnimalResponseDto {
  id: string;
  farmId: string;
  name: string;
  tagNumber: string;
  species: AnimalSpecies;
  gender: AnimalGender;
  breed?: string;
  deviceId?: string;
  lastLatitude?: number;
  lastLongitude?: number;
  lastSeenAt?: string;
  isOutsideGeofence: boolean;
}

// ==========================================
// 5. GEOFENCES (PASTURES)
// ==========================================

export interface CreateGeofenceDto {
  name: string;
  description?: string;
  color?: string;
  polygon: {
    type: 'Polygon';
    coordinates: number[][][];
  };
}

export interface GeofenceResponseDto {
  id: string;
  farmId: string;
  name: string;
  description?: string;
  color: string;
  polygon: any;
  animalsCount?: number;
}

// ==========================================
// 6. ALERTS
// ==========================================

export interface AlertResponseDto {
  id: string;
  farmId: string;
  animalId?: string;
  animalName?: string;
  deviceId?: string;
  type: AlertType;
  severity: AlertSeverity;
  status: AlertStatus;
  message: string;
  latitude?: number;
  longitude?: number;
  createdAt: string;
}

