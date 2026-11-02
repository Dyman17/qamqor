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
// 1. ESP32 DEVICE INGESTION CONTRACT
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
}

export interface DeviceTelemetryResponseDto {
  success: boolean;
  serverTime: string;    // ISO 8601 string
  nextInterval: number;  // Interval until next ping in seconds (e.g. 300)
  configVersion: number; // Device config version
  command?: string;      // Optional command from server (e.g. "BUZZ_ALARM", "LOCATE_IMMEDIATELY")
}

// ==========================================
// 2. AUTHENTICATION & USERS
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
// 3. ANIMALS
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
// 4. GEOFENCES (PASTURES)
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
// 5. ALERTS
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

