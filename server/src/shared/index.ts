/**
 * Qamqor Shared Domain Types and Enums
 */

export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  FARM_OWNER = 'FARM_OWNER',
  FARM_MANAGER = 'FARM_MANAGER',
  VIEWER = 'VIEWER',
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
  LOW_BATTERY = 'LOW_BATTERY',
  NO_GPS = 'NO_GPS',
  INACTIVE = 'INACTIVE',
}

export enum GeofenceStatus {
  INSIDE = 'INSIDE',
  OUTSIDE = 'OUTSIDE',
  UNKNOWN = 'UNKNOWN',
}

export enum AlertType {
  GEOFENCE_BREACH = 'GEOFENCE_BREACH',
  GEOFENCE_RETURN = 'GEOFENCE_RETURN',
  LOW_BATTERY = 'LOW_BATTERY',
  DEVICE_OFFLINE = 'DEVICE_OFFLINE',
  GPS_LOST = 'GPS_LOST',
  DEVICE_RESTORED = 'DEVICE_RESTORED',
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

