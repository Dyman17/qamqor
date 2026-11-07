import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAnimalInputDto, UpdateAnimalInputDto } from './dto/animal.dto';
import { AnimalSpecies } from '@prisma/client';

@Injectable()
export class AnimalsService {
  constructor(private readonly prisma: PrismaService) {}

  private async verifyFarmAccess(userId: string, farmId: string) {
    const membership = await this.prisma.farmMember.findUnique({
      where: { userId_farmId: { userId, farmId } },
    });
    if (!membership) {
      throw new ForbiddenException('У вас нет доступа к этому хозяйству');
    }
    return membership;
  }

  async listAnimals(
    userId: string,
    farmId: string,
    filters?: {
      species?: AnimalSpecies;
      isOutsideGeofence?: boolean;
      search?: string;
    },
  ) {
    await this.verifyFarmAccess(userId, farmId);

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
            battery: true,
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
    await this.verifyFarmAccess(userId, farmId);

    const animal = await this.prisma.animal.findFirst({
      where: { id: animalId, farmId },
      include: {
        device: true,
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

  async getAnimalTrack(
    userId: string,
    farmId: string,
    animalId: string,
    limit: number = 100,
  ) {
    await this.verifyFarmAccess(userId, farmId);

    const animal = await this.prisma.animal.findFirst({
      where: { id: animalId, farmId },
      select: { id: true, name: true, tagNumber: true },
    });

    if (!animal) {
      throw new NotFoundException('Животное не найдено');
    }

    const points = await this.prisma.telemetry.findMany({
      where: { animalId },
      orderBy: { timestamp: 'asc' },
      take: limit,
      select: {
        latitude: true,
        longitude: true,
        accuracy: true,
        battery: true,
        isOutsideGeofence: true,
        timestamp: true,
      },
    });

    return {
      animal,
      points,
    };
  }

  async createAnimal(userId: string, farmId: string, dto: CreateAnimalInputDto) {
    await this.verifyFarmAccess(userId, farmId);

    const existingTag = await this.prisma.animal.findUnique({
      where: { tagNumber: dto.tagNumber.trim() },
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
      await this.prisma.device.update({
        where: { deviceId: dto.deviceId },
        data: { animalId: animal.id, farmId },
      });
    }

    return this.getAnimalById(userId, farmId, animal.id);
  }

  async updateAnimal(
    userId: string,
    farmId: string,
    animalId: string,
    dto: UpdateAnimalInputDto,
  ) {
    await this.verifyFarmAccess(userId, farmId);

    const animal = await this.prisma.animal.findFirst({
      where: { id: animalId, farmId },
    });

    if (!animal) {
      throw new NotFoundException('Животное не найдено');
    }

    if (dto.tagNumber && dto.tagNumber !== animal.tagNumber) {
      const conflict = await this.prisma.animal.findUnique({
        where: { tagNumber: dto.tagNumber.trim() },
      });
      if (conflict) {
        throw new ConflictException(`Бирка "${dto.tagNumber}" уже занята`);
      }
    }

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
        await this.prisma.device.update({
          where: { deviceId: dto.deviceId },
          data: { animalId, farmId },
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
    await this.verifyFarmAccess(userId, farmId);

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

