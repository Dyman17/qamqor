import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { assertSameFarm } from '../farms/same-farm';
import { forbiddenRole } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateAnimalInputDto,
  UpdateAnimalInputDto,
  SteerDto,
  ListAnimalsQueryDto,
} from './dto/animal.dto';
import { ANIMAL_INCLUDE, AnimalDto, toAnimalDto } from './mappers';
import { ALERT_INCLUDE, AlertDto, toAlertDto } from '../alerts/mappers';
import { Page, pageOf } from '../common/pagination';
import { computeConnState } from '../devices/connectivity';
import { resolveCollarAlerts } from '../alerts/alerts.service';

const NO_BOUNDARY_RIGHTS = 'Назначать загон может владелец или работник при включённом праве';

function isUnique(e: any): boolean {
  return e?.code === 'P2002';
}

@Injectable()
export class AnimalsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 404 unless the animal belongs to the farm. */
  async ensureInFarm(farmId: string, animalId: string): Promise<void> {
    await assertSameFarm(this.prisma, farmId, { animalId });
  }

  async listAnimals(userId: string, farmId: string, q: ListAnimalsQueryDto = {}): Promise<Page<AnimalDto>> {
    const where: any = { farmId };
    if (q.species) where.species = q.species;
    if (q.penId) where.activeGeofenceId = q.penId;
    if (q.search) {
      const s = q.search.trim();
      where.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { tagNumber: { contains: s, mode: 'insensitive' } },
      ];
    }
    const rows = await this.prisma.animal.findMany({
      where,
      include: ANIMAL_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
    const now = Date.now();
    let dtos = rows.map((r) => toAnimalDto(r, now));
    if (q.status) dtos = dtos.filter((d) => d.status === q.status);
    return pageOf(dtos, q);
  }

  async getAnimalById(userId: string, farmId: string, animalId: string): Promise<AnimalDto> {
    const animal = await this.prisma.animal.findFirst({
      where: { id: animalId, farmId },
      include: ANIMAL_INCLUDE,
    });
    if (!animal) throw new NotFoundException('Животное не найдено');
    return toAnimalDto(animal);
  }

  /** Latest `limit` points in the optional [from, to] range, oldest first. */
  async getAnimalTrack(
    userId: string,
    farmId: string,
    animalId: string,
    opts: { limit: number; from?: Date; to?: Date },
  ) {
    const animal = await this.prisma.animal.findFirst({
      where: { id: animalId, farmId },
      select: { id: true, name: true, tagNumber: true },
    });
    if (!animal) throw new NotFoundException('Животное не найдено');

    const rows = await this.prisma.telemetry.findMany({
      where: {
        animalId,
        ...((opts.from || opts.to) && {
          timestamp: { ...(opts.from && { gte: opts.from }), ...(opts.to && { lte: opts.to }) },
        }),
      },
      orderBy: { timestamp: 'desc' },
      take: opts.limit,
      select: {
        latitude: true,
        longitude: true,
        accuracy: true,
        isOutsideGeofence: true,
        timestamp: true,
      },
    });

    return {
      animal: { id: animal.id, name: animal.name, tag: animal.tagNumber },
      points: rows.reverse().map((r) => ({
        lat: r.latitude,
        lng: r.longitude,
        accuracyM: r.accuracy,
        at: r.timestamp.toISOString(),
        isOutside: r.isOutsideGeofence,
      })),
    };
  }

  /** Recent alerts of the animal (the signal counters are added by the controller). */
  async recentAlerts(farmId: string, animalId: string, limit = 20): Promise<AlertDto[]> {
    await this.ensureInFarm(farmId, animalId);
    const rows = await this.prisma.alert.findMany({
      where: { farmId, animalId },
      include: ALERT_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(toAlertDto);
  }

  async createAnimal(
    userId: string,
    farmId: string,
    dto: CreateAnimalInputDto,
    canEditBoundaries = true,
  ): Promise<AnimalDto> {
    // Putting an animal into a pen is a herd move: owner, or worker with the switch on.
    if (dto.penId && !canEditBoundaries) throw forbiddenRole(NO_BOUNDARY_RIGHTS);

    await assertSameFarm(this.prisma, farmId, { geofenceId: dto.penId, deviceId: dto.collarId });

    const tagNumber = dto.tag.trim();
    const existingTag = await this.prisma.animal.findUnique({
      where: { farmId_tagNumber: { farmId, tagNumber } },
    });
    if (existingTag) throw new ConflictException(`Животное с биркой "${tagNumber}" уже зарегистрировано`);

    let created: { id: string };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const animal = await tx.animal.create({
          data: {
            farmId,
            name: dto.name.trim(),
            tagNumber,
            species: dto.species,
            gender: dto.gender,
            breed: dto.breed?.trim(),
            birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
            photoUrl: dto.photoUrl,
            activeGeofenceId: dto.penId,
          },
        });
        if (dto.collarId) {
          // A real animal never takes a simulated (demo) collar.
          const res = await tx.device.updateMany({
            where: { deviceId: dto.collarId, farmId, animalId: null, isSimulated: false },
            data: { animalId: animal.id },
          });
          if (res.count !== 1) throw new ConflictException('Ошейник уже привязан к другому животному или демо-ошейник');
        }
        return animal;
      });
    } catch (e) {
      if (isUnique(e)) throw new ConflictException(`Животное с биркой "${tagNumber}" уже зарегистрировано`);
      throw e;
    }
    return this.getAnimalById(userId, farmId, created.id);
  }

  async updateAnimal(
    userId: string,
    farmId: string,
    animalId: string,
    dto: UpdateAnimalInputDto,
    canEditBoundaries = true,
  ): Promise<AnimalDto> {
    if (dto.penId !== undefined && !canEditBoundaries) throw forbiddenRole(NO_BOUNDARY_RIGHTS);

    const animal = await this.prisma.animal.findFirst({ where: { id: animalId, farmId } });
    if (!animal) throw new NotFoundException('Животное не найдено');

    const tagNumber = dto.tag?.trim();
    if (tagNumber && tagNumber !== animal.tagNumber) {
      const conflict = await this.prisma.animal.findUnique({
        where: { farmId_tagNumber: { farmId, tagNumber } },
      });
      if (conflict) throw new ConflictException(`Бирка "${tagNumber}" уже занята`);
    }

    await assertSameFarm(this.prisma, farmId, { geofenceId: dto.penId, deviceId: dto.collarId });

    try {
      await this.prisma.$transaction(async (tx) => {
        if (dto.collarId !== undefined) {
          await tx.device.updateMany({ where: { animalId }, data: { animalId: null } });
          if (dto.collarId !== null) {
            // Demo and real never mix: a demo animal takes only a simulated collar and vice versa.
            const res = await tx.device.updateMany({
              where: { deviceId: dto.collarId, farmId, animalId: null, isSimulated: !!animal.isDemo },
              data: { animalId },
            });
            if (res.count !== 1) throw new ConflictException('Ошейник уже привязан к другому животному или не подходит (демо и реальные данные не смешиваются)');
          }
        }
        await tx.animal.update({
          where: { id: animalId },
          data: {
            ...(dto.name && { name: dto.name.trim() }),
            ...(tagNumber && { tagNumber }),
            ...(dto.species && { species: dto.species }),
            ...(dto.gender && { gender: dto.gender }),
            ...(dto.breed !== undefined && { breed: dto.breed?.trim() }),
            ...(dto.birthDate !== undefined && { birthDate: new Date(dto.birthDate) }),
            ...(dto.photoUrl !== undefined && { photoUrl: dto.photoUrl }),
            ...(dto.penId !== undefined && { activeGeofenceId: dto.penId }),
          },
        });
      });
    } catch (e) {
      if (isUnique(e)) throw new ConflictException('Бирка или ошейник уже заняты');
      throw e;
    }
    return this.getAnimalById(userId, farmId, animalId);
  }

  async deleteAnimal(userId: string, farmId: string, animalId: string): Promise<void> {
    await this.ensureInFarm(farmId, animalId);
    await this.prisma.$transaction(async (tx) => {
      await resolveCollarAlerts(tx, animalId);
      await tx.device.updateMany({ where: { animalId }, data: { animalId: null } });
      await tx.animal.delete({ where: { id: animalId } });
    });
  }

  /** Binds a collar of this farm to the animal; the animal's previous collar is released. */
  async assignCollar(userId: string, farmId: string, animalId: string, deviceId: string): Promise<AnimalDto> {
    await assertSameFarm(this.prisma, farmId, { animalId, deviceId });
    try {
      await this.prisma.$transaction(async (tx) => {
        const device = await tx.device.findFirst({ where: { deviceId, farmId } });
        if (!device) throw new NotFoundException('Устройство не найдено');
        if (device.animalId === animalId) return; // already bound to this animal
        if (device.animalId) throw new ConflictException('Ошейник уже привязан к другому животному');
        // Demo and real never mix (409): a simulated collar belongs to a demo animal only.
        const target = await tx.animal.findFirst({ where: { id: animalId, farmId }, select: { isDemo: true } });
        if (!!target?.isDemo !== !!device.isSimulated) {
          throw new ConflictException('Демо и реальные данные не смешиваются: ошейник и животное должны быть оба демо или оба реальные');
        }
        await tx.device.updateMany({ where: { animalId }, data: { animalId: null } });
        const res = await tx.device.updateMany({
          where: { id: device.id, farmId, animalId: null },
          data: { animalId },
        });
        if (res.count !== 1) throw new ConflictException('Ошейник уже привязан к другому животному');
      });
    } catch (e) {
      if (isUnique(e)) throw new ConflictException('Ошейник уже привязан к другому животному');
      throw e;
    }
    return this.getAnimalById(userId, farmId, animalId);
  }

  async unassignCollar(userId: string, farmId: string, animalId: string): Promise<AnimalDto> {
    await this.ensureInFarm(farmId, animalId);
    await this.prisma.$transaction(async (tx) => {
      await tx.device.updateMany({ where: { animalId, farmId }, data: { animalId: null } });
      await resolveCollarAlerts(tx, animalId);
    });
    return this.getAnimalById(userId, farmId, animalId);
  }

  /**
   * Group move: sets the target pen for every listed animal of this farm (404 for any foreign id
   * or pen). Collars receive the new border with their next ping. `skippedOffline` lists animals
   * that are updated but cannot be reached right now (no collar or collar offline).
   */
  async steer(userId: string, farmId: string, dto: SteerDto) {
    const ids = Array.from(new Set(dto.animalIds));
    await assertSameFarm(this.prisma, farmId, { animalIds: ids, geofenceId: dto.targetPenId });

    const animals = await this.prisma.animal.findMany({
      where: { id: { in: ids }, farmId },
      include: { device: { select: { lastHeartbeatAt: true } } },
    });
    const now = Date.now();
    const skippedOffline = animals
      .filter((a) => !a.device || computeConnState({ hasAnimal: true, lastSeenAt: a.device.lastHeartbeatAt }, now) === 'OFFLINE')
      .map((a) => a.id);

    const res = await this.prisma.animal.updateMany({
      where: { id: { in: ids }, farmId },
      data: { activeGeofenceId: dto.targetPenId },
    });
    return { updated: res.count, skippedOffline };
  }
}
