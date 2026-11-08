import type { Prisma } from '@prisma/client';

export interface AlertDto {
  id: string;
  type: string;
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

/** Prisma include that `toAlertDto` needs. */
export const ALERT_INCLUDE: Prisma.AlertInclude = {
  animal: { select: { id: true, name: true, activeGeofence: { select: { name: true } } } },
};

export function toAlertDto(a: any): AlertDto {
  return {
    id: a.id,
    type: a.type,
    severity: a.severity,
    status: a.status,
    animalId: a.animalId ?? null,
    animalName: a.animal?.name ?? null,
    penName: a.animal?.activeGeofence?.name ?? null,
    message: a.message,
    lat: a.latitude ?? null,
    lng: a.longitude ?? null,
    createdAt: a.createdAt.toISOString(),
    isRead: a.isRead ?? false,
  };
}
