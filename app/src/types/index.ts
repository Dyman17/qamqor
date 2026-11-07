export type AnimalStatus = 'ok' | 'danger' | 'warning' | 'offline';

export interface Animal {
  id: string;
  name: string;
  tag: string;
  pen: string;
  collarId: string;
  breed: string;
  lat: number;
  lng: number;
  status: AnimalStatus;
  lastSeenMinutesAgo: number;
}

export interface Collar {
  deviceId: string;
  status: 'ONLINE' | 'OFFLINE' | 'UNASSIGNED';
  battery: number;
  signalRssi: number;
  animalId?: string;
  animalName?: string;
  firmwareVersion: string;
}

export interface AlertItem {
  id: string;
  type: 'danger' | 'offline' | 'warning';
  title: string;
  animalId?: string;
  animalName?: string;
  penName?: string;
  timeAgo: string;
  isRead: boolean;
}

export interface GeofencePen {
  id: string;
  name: string;
  animalsCount: number;
  isApplied: boolean;
  areaHa: number;
  polygon: number[][];
}

