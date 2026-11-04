import {
  AnimalSpecies,
  AnimalGender,
  DeviceStatus,
  AlertStatus,
  AlertType,
  AlertSeverity,
  UserRole,
} from '@qamqor/shared';

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

// Backward-compatibility alias
export const VirtualFenceZone = Zone;
export type VirtualFenceZone = Zone;

export type OperatingMode = 'ACTIVE' | 'TRAINING' | 'SOUND_ONLY';

export interface ShockSpec {
  voltageEstimateV: number;     // Estimated output voltage, e.g. 5000 - 8000 V
  energyJoules: number;         // Output energy, e.g. 0.05 - 0.2 J
  maxPulseDurationMs: number;   // Max 150 ms
  minCooldownMs: number;        // Min 6000 ms
  maxShocksInWindow: number;    // Max 3 pulses
  windowSeconds: number;        // 600 seconds (10 min)
}

export const DEFAULT_SHOCK_SPEC: ShockSpec = {
  voltageEstimateV: 7000,
  energyJoules: 0.1,
  maxPulseDurationMs: 150,
  minCooldownMs: 6000,
  maxShocksInWindow: 3,
  windowSeconds: 600,
};

export interface FixQuality {
  hdop: number;
  satellites: number;
  accuracyM: number;
  ageMs: number;
}

export interface ActuatorState {
  sound: boolean;
  vibrate: boolean;
  shock: boolean;
  shockDurationMs: number;
}

export interface ShockBudget {
  used: number;
  limit: number;
  windowSec: number;
}

/**
 * Formula for tone level:
 * (17, 20] -> 1 (800 Hz)
 * (14, 17] -> 2 (1200 Hz)
 * (11, 14] -> 3 (1600 Hz)
 * (8, 11]  -> 4 (2000 Hz)
 * [5, 8] and below -> 5 (2400 Hz)
 */
export function toneLevelFromDistance(distanceMeters: number): number {
  if (distanceMeters > 20) return 0;
  if (distanceMeters > 17) return 1;
  if (distanceMeters > 14) return 2;
  if (distanceMeters > 11) return 3;
  if (distanceMeters > 8) return 4;
  return 5;
}

export function toneFreqHz(toneLevel: number): number {
  if (toneLevel <= 0) return 0;
  return 800 + (Math.min(5, Math.max(1, toneLevel)) - 1) * 400;
}

export interface DeviceStatusV2 {
  deviceId: string;
  contractVersion: number;      // 2
  computedAt: number;           // UTC epoch ms
  source: 'DEVICE' | 'SERVER';
  zone: Zone;
  distanceToBorderMeters: number | null; // + inside, - outside
  toneLevel: number | null;     // 1 - 5
  toneFreqHz: number | null;    // 800 - 2400 Hz
  actuators: ActuatorState;
  fixQuality: FixQuality;
  blockReason: string | null;   // HDOP, SATS, ACCURACY, STALE, JUMP, NOT_CONFIRMED, LIMIT, MODE
  mode: OperatingMode;
  shockBudget: ShockBudget;
  configVersion: number;
  firmwareVersion: string;
  speedKmh: number | null;
  battery: number | null;
  signal: number | null;
}

export interface DeviceConfigV2 {
  deviceId: string;
  configVersion: number;
  mode: OperatingMode;
  shockSpec: ShockSpec;
  geofence: {
    id: string;
    polygon: {
      type: 'Polygon';
      coordinates: number[][][]; // GeoJSON [[[lon, lat], ...]]
    };
  };
  gates: any[];
  hmacSignature: string;
}

// ==========================================
// 2. ESP32 DEVICE INGESTION CONTRACT
// Endpoint: POST /api/v1/device/telemetry
// Header: Authorization: Bearer <DEVICE_SECRET>
// ==========================================

export interface DeviceTelemetryRequestDto {
  deviceId: string;
  timestamp: string; // ISO 8601 string, e.g. "2026-11-02T18:00:00Z"
  latitude: number;  // e.g. 43.6501
  longitude: number; // e.g. 51.1572
  accuracy: number;  // meters, e.g. 4.5
  battery: number;   // 0 - 100 percentage
  signal?: number;   // dBm RSSI, e.g. -75
  speedKmh?: number; // optional smoothed speed
  hdop?: number;
  satellites?: number;
}

export interface DeviceTelemetryResponseDto {
  success: boolean;
  serverTime: string;    // ISO 8601 string
  nextInterval: number;  // Interval until next ping in seconds (e.g. 300)
  configVersion: number; // Device config version
  command?: string;      // Optional command from server
  inFence: boolean;      // true if within designated pasture, false if breach
  zone?: Zone | 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED' | 'ESCAPE' | 'UNKNOWN';
  distanceToBorderMeters?: number;
  toneFrequencyHz?: number;
  toneLevel?: number;
  vibrate: boolean;
  vibrateDurationMs: number;
  buzzer: boolean;
  sound?: boolean;
  shock?: boolean;
  shockDurationMs?: number;
  blockReason?: string | null;
  warningMessage?: string;
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
    role: UserRole;
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
  battery?: number;
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
    coordinates: number[][][]; // GeoJSON [[[lng, lat], ...]]
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
