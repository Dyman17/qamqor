import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { assertSameFarm } from '../farms/same-farm';
import { forbiddenRole } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAnimalInputDto, UpdateAnimalInputDto } from './dto/animal.dto';
import { AnimalSpecies } from '@prisma/client';

@Injectable()
export class AnimalsService {
  constructor(private readonly prisma: PrismaService) {}

  async listAnimals(
    userId: string,
    farmId: string,
    filters?: {
      species?: AnimalSpecies;
      isOutsideGeofence?: boolean;
      search?: string;
    },
  ) {

    const where: any = { farmId };

    if (filters?.species) {
      where.species = filters.species;
    }

    if (filters?.isOutsideGeofence !== undefined) {
      where.isOutsideGeofence = filters.isOutsideGeofence;
    }

    if (filters?.search) {
      const q = filters.search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { tagNumber: { contains: q, mode: 'insensitive' } },
      ];
    }

    return this.prisma.animal.findMany({
      where,
      include: {
        device: {
          select: {
            id: true,
            deviceId: true,
            status: true,
            signal: true,
            lastHeartbeatAt: true,
          },
        },
        activeGeofence: {
          select: {
            id: true,
            name: true,
            color: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getAnimalById(userId: string, farmId: string, animalId: string) {

    const animal = await this.prisma.animal.findFirst({
      where: { id: animalId, farmId },
      include: {
        device: {
          select: {
            id: true,
            deviceId: true,
            status: true,
            signal: true,
            lastHeartbeatAt: true,
            firmwareVersion: true,
          },
        },
        activeGeofence: true,
        alerts: {
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!animal) {
      throw new NotFoundException('Животное не найдено');
    }

    return animal;
  }

  /** 404 unless the animal belongs to the farm. */
  async ensureInFarm(farmId: string, animalId: string): Promise<void> {
    await assertSameFarm(this.prisma, farmId, { animalId });
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

    if (!animal) {
      throw new NotFoundException('Животное не найдено');
    }

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

  async createAnimal(
    userId: string,
    farmId: string,
    dto: CreateAnimalInputDto,
    canEditBoundaries = true,
  ) {
    // Putting an animal into a pen is a herd move: owner, or worker with the switch on.
    if (dto.activeGeofenceId && !canEditBoundaries) {
      throw forbiddenRole('Назначать загон может владелец или работник при включённом праве');
    }

    await assertSameFarm(this.prisma, farmId, {
      geofenceId: dto.activeGeofenceId,
      deviceId: dto.deviceId,
    });

    const existingTag = await this.prisma.animal.findUnique({
      where: { farmId_tagNumber: { farmId, tagNumber: dto.tagNumber.trim() } },
    });

    if (existingTag) {
      throw new ConflictException(`Животное с биркой "${dto.tagNumber}" уже зарегистрировано`);
    }

    const animal = await this.prisma.animal.create({
      data: {
        farmId,
        name: dto.name.trim(),
        tagNumber: dto.tagNumber.trim(),
        species: dto.species,
        gender: dto.gender,
        breed: dto.breed?.trim(),
        photoUrl: dto.photoUrl,
        activeGeofenceId: dto.activeGeofenceId,
      },
    });

    // Link device if provided
    if (dto.deviceId) {
      await this.prisma.device.updateMany({
        where: { deviceId: dto.deviceId, farmId },
        data: { animalId: animal.id },
      });
    }

    return this.getAnimalById(userId, farmId, animal.id);
  }

  async updateAnimal(
    userId: string,
    farmId: string,
    animalId: string,
    dto: UpdateAnimalInputDto,
    canEditBoundaries = true,
  ) {
    if (dto.activeGeofenceId !== undefined && !canEditBoundaries) {
      throw forbiddenRole('Назначать загон может владелец или работник при включённом праве');
    }

    const animal = await this.prisma.animal.findFirst({
      where: { id: animalId, farmId },
    });

    if (!animal) {
      throw new NotFoundException('Животное не найдено');
    }

    if (dto.tagNumber && dto.tagNumber !== animal.tagNumber) {
      const conflict = await this.prisma.animal.findUnique({
        where: { farmId_tagNumber: { farmId, tagNumber: dto.tagNumber.trim() } },
      });
      if (conflict) {
        throw new ConflictException(`Бирка "${dto.tagNumber}" уже занята`);
      }
    }

    await assertSameFarm(this.prisma, farmId, {
      geofenceId: dto.activeGeofenceId,
      deviceId: dto.deviceId,
    });

    // Handle device attachment / detachment
    if (dto.deviceId !== undefined) {
      if (dto.deviceId === null) {
        // Detach current device
        await this.prisma.device.updateMany({
          where: { animalId },
          data: { animalId: null },
        });
      } else {
        // Detach from previous and attach to this
        await this.prisma.device.updateMany({
          where: { animalId },
          data: { animalId: null },
        });
        await this.prisma.device.updateMany({
          where: { deviceId: dto.deviceId, farmId },
          data: { animalId },
        });
      }
    }

    await this.prisma.animal.update({
      where: { id: animalId },
      data: {
        ...(dto.name && { name: dto.name.trim() }),
        ...(dto.tagNumber && { tagNumber: dto.tagNumber.trim() }),
        ...(dto.species && { species: dto.species }),
        ...(dto.gender && { gender: dto.gender }),
        ...(dto.breed !== undefined && { breed: dto.breed?.trim() }),
        ...(dto.photoUrl !== undefined && { photoUrl: dto.photoUrl }),
        ...(dto.activeGeofenceId !== undefined && { activeGeofenceId: dto.activeGeofenceId }),
      },
    });

    return this.getAnimalById(userId, farmId, animalId);
  }

  async deleteAnimal(userId: string, farmId: string, animalId: string) {

    const animal = await this.prisma.animal.findFirst({
      where: { id: animalId, farmId },
    });

    if (!animal) {
      throw new NotFoundException('Животное не найдено');
    }

    // Unlink device
    await this.prisma.device.updateMany({
      where: { animalId },
      data: { animalId: null },
    });

    return this.prisma.animal.delete({
      where: { id: animalId },
    });
  }
}

