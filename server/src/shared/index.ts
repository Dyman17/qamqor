/**
 * Qamqor Shared Domain Types and Enums
 */

export enum FarmRole {
  OWNER = 'OWNER',
  WORKER = 'WORKER',
}

export enum AnimalSpecies {
  HORSE = 'HORSE',   // Жылқы
  CAMEL = 'CAMEL',   // Түйе
  CATTLE = 'CATTLE', // Сиыр
  SHEEP = 'SHEEP',   // Қой
  GOAT = 'GOAT',     // Ешкі
}

export enum AnimalGender {
  MALE = 'MALE',
  FEMALE = 'FEMALE',
  UNKNOWN = 'UNKNOWN',
}

export enum DeviceStatus {
  ONLINE = 'ONLINE',
  OFFLINE = 'OFFLINE',
  NO_GPS = 'NO_GPS',
  INACTIVE = 'INACTIVE',
}

/** Control mode of a real collar (see docs/architecture/api-contract.md). */
export type CollarControlMode = 'AUTO' | 'GPS_MANUAL' | 'MANUAL';
export const COLLAR_CONTROL_MODES: readonly CollarControlMode[] = ['AUTO', 'GPS_MANUAL', 'MANUAL'];
/** Where the shown position of an animal comes from. */
export type PositionSource = 'GPS' | 'MANUAL';

export enum GeofenceStatus {
  INSIDE = 'INSIDE',
  OUTSIDE = 'OUTSIDE',
  UNKNOWN = 'UNKNOWN',
}

export enum AlertType {
  GEOFENCE_BREACH = 'GEOFENCE_BREACH',
  GEOFENCE_RETURN = 'GEOFENCE_RETURN',
  DEVICE_OFFLINE = 'DEVICE_OFFLINE',
  GPS_LOST = 'GPS_LOST',
  DEVICE_RESTORED = 'DEVICE_RESTORED',
  SIGNAL_LIMIT_REACHED = 'SIGNAL_LIMIT_REACHED',
}

export enum AlertSeverity {
  INFO = 'INFO',
  WARNING = 'WARNING',
  CRITICAL = 'CRITICAL',
}

export enum AlertStatus {
  ACTIVE = 'ACTIVE',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  RESOLVED = 'RESOLVED',
}

export interface Coordinates {
  latitude: number;
  longitude: number;
  altitude?: number;
  accuracy?: number;
}

export interface GeofencePolygon {
  type: 'Polygon';
  coordinates: number[][][]; // GeoJSON format: [[[lng, lat], [lng, lat], ...]]
}

