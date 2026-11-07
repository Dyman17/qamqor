import {
  AnimalSpecies,
  AnimalGender,
  DeviceStatus,
  AlertStatus,
  AlertType,
  AlertSeverity,
  UserRole,
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

export type OperatingMode = 'ACTIVE' | 'TRAINING' | 'SOUND_ONLY';

export interface ShockSpec {
  voltageEstimateV: number;
  energyJoules: number;
  maxPulseDurationMs: number;
  minCooldownMs: number;
  maxShocksInWindow: number;
  windowSeconds: number;
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
  contractVersion: number;
  computedAt: number;
  source: 'DEVICE' | 'SERVER';
  zone: Zone;
  distanceToBorderMeters: number | null;
  toneLevel: number | null;
  toneFreqHz: number | null;
  actuators: ActuatorState;
  fixQuality: FixQuality;
  blockReason: string | null;
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
      coordinates: number[][][];
    };
  };
  gates: any[];
  hmacSignature: string;
}

// ==========================================
// 2. ESP32 DEVICE INGESTION CONTRACT
// Endpoint: POST /api/v1/device/telemetry
// ==========================================

export interface DeviceTelemetryRequestDto {
  deviceId: string;
  timestamp: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  battery: number;
  signal?: number;
  speedKmh?: number;
  hdop?: number;
  satellites?: number;
}

export interface DeviceTelemetryResponseDto {
  success: boolean;
  serverTime: string;
  nextInterval: number;
  configVersion: number;
  command?: string;
  inFence: boolean;
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

