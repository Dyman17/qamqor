// DTOs of docs/architecture/api-contract.md (server is the source of truth).

export type Role = 'OWNER' | 'WORKER';
export type AnimalStatus = 'ok' | 'danger' | 'warning' | 'offline';
export type ConnState = 'ONLINE' | 'OFFLINE' | 'UNASSIGNED';

export interface UserDto {
  id: string;
  email: string;
  fullName: string;
  phone?: string;
}

export interface MembershipDto {
  farmId: string;
  farmName: string;
  role: Role;
}

export interface AuthResponse {
  token: string;
  user: UserDto;
  memberships: MembershipDto[];
}

export interface FarmDto {
  id: string;
  name: string;
  description?: string;
  timezone: string;
  workerCanEditBoundaries: boolean;
  myRole: Role;
}

export interface Animal {
  id: string;
  farmId: string;
  name: string;
  tag: string;
  species: 'CATTLE' | 'HORSE' | 'CAMEL' | 'SHEEP' | 'GOAT';
  gender?: string;
  breed?: string | null;
  penId: string | null;
  collarId: string | null;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  lastSeenAt: string | null;
  status: AnimalStatus;
}

export interface Collar {
  deviceId: string;
  status: ConnState;
  animalId: string | null;
  animalName: string | null;
  signalRssi: number | null;
  firmwareVersion: string | null;
  lastSeenAt: string | null;
}

export interface GeoJSONPolygon {
  type: 'Polygon';
  coordinates: number[][][]; // [lng, lat]
}

export interface GeofencePen {
  id: string;
  farmId: string;
  name: string;
  color: string;
  polygon: GeoJSONPolygon;
  animalsCount: number;
  areaHa: number;
}

export type AlertType =
  | 'GEOFENCE_BREACH'
  | 'GEOFENCE_RETURN'
  | 'DEVICE_OFFLINE'
  | 'DEVICE_RESTORED'
  | 'SIGNAL_LIMIT_REACHED'
  | 'GPS_LOST';

export interface AlertItem {
  id: string;
  type: AlertType;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  status: 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED';
  animalId: string | null;
  animalName: string | null;
  penName: string | null;
  message: string;
  lat: number | null;
  lng: number | null;
  createdAt: string;
  isRead: boolean;
}

export interface AlertStats {
  activeTotal: number;
  activeBreaches: number;
  offline: number;
}
