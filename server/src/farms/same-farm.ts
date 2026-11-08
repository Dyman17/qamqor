import { NotFoundException } from '@nestjs/common';

export interface FarmRefs {
  animalId?: string | null;
  deviceId?: string | null; // public deviceId ("QAM-0001")
  geofenceId?: string | null;
  animalIds?: string[] | null;
}

/**
 * Single place that checks that every referenced entity belongs to the request's farm.
 * Anything foreign (or missing) is reported as 404 so that existence in other farms is not revealed.
 */
export async function assertSameFarm(prisma: any, farmId: string, refs: FarmRefs): Promise<void> {
  if (refs.animalId) {
    const n = await prisma.animal.count({ where: { id: refs.animalId, farmId } });
    if (!n) throw new NotFoundException('Животное не найдено');
  }
  if (refs.deviceId) {
    const n = await prisma.device.count({ where: { deviceId: refs.deviceId, farmId } });
    if (!n) throw new NotFoundException('Устройство не найдено');
  }
  if (refs.geofenceId) {
    const n = await prisma.geofence.count({ where: { id: refs.geofenceId, farmId } });
    if (!n) throw new NotFoundException('Загон не найден');
  }
  if (refs.animalIds && refs.animalIds.length > 0) {
    const unique = Array.from(new Set(refs.animalIds));
    const n = await prisma.animal.count({ where: { id: { in: unique }, farmId } });
    if (n !== unique.length) throw new NotFoundException('Животное не найдено');
  }
}
