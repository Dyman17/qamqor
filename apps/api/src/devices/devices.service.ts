import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDeviceDto, UpdateDeviceDto } from './dto/device.dto';
import * as crypto from 'crypto';
import { DeviceStatus } from '@prisma/client';

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  private async verifyFarmAccess(userId: string, farmId: string) {
    const membership = await this.prisma.farmMember.findUnique({
      where: { userId_farmId: { userId, farmId } },
    });
    if (!membership) {
      throw new ForbiddenException('У вас нет доступа к этому хозяйству');
    }
  }

  async listDevices(userId: string, farmId: string) {
    await this.verifyFarmAccess(userId, farmId);

    return this.prisma.device.findMany({
      where: { farmId },
      include: {
        animal: {
          select: {
            id: true,
            name: true,
            tagNumber: true,
            species: true,
            isOutsideGeofence: true,
          },
        },
      },
      orderBy: { deviceId: 'asc' },
    });
  }

  async getDeviceById(userId: string, farmId: string, deviceId: string) {
    await this.verifyFarmAccess(userId, farmId);

    const device = await this.prisma.device.findFirst({
      where: { deviceId, farmId },
      include: {
        animal: true,
        _count: {
          select: { telemetries: true, alerts: true },
        },
      },
    });

    if (!device) {
      throw new NotFoundException(`Устройство "${deviceId}" не найдено`);
    }

    return device;
  }

  async registerDevice(userId: string, farmId: string, dto: RegisterDeviceDto) {
    await this.verifyFarmAccess(userId, farmId);

    const existing = await this.prisma.device.findUnique({
      where: { deviceId: dto.deviceId.trim() },
    });

    if (existing) {
      throw new ConflictException(`Устройство с ID "${dto.deviceId}" уже существует`);
    }

    const secretKey =
      dto.secretKey?.trim() || `qam_${crypto.randomBytes(16).toString('hex')}`;

    return this.prisma.device.create({
      data: {
        deviceId: dto.deviceId.trim(),
        secretKey,
        farmId,
        firmwareVersion: dto.firmwareVersion || '1.0.0',
        status: DeviceStatus.INACTIVE,
        animalId: dto.animalId,
      },
      include: { animal: true },
    });
  }

  async updateDevice(
    userId: string,
    farmId: string,
    deviceId: string,
    dto: UpdateDeviceDto,
  ) {
    await this.verifyFarmAccess(userId, farmId);

    const device = await this.prisma.device.findFirst({
      where: { deviceId, farmId },
    });

    if (!device) {
      throw new NotFoundException(`Устройство "${deviceId}" не найдено`);
    }

    // Handle animal assignment
    if (dto.animalId !== undefined) {
      if (dto.animalId === null) {
        await this.prisma.device.update({
          where: { id: device.id },
          data: { animalId: null },
        });
      } else {
        await this.prisma.device.update({
          where: { id: device.id },
          data: { animalId: dto.animalId },
        });
      }
    }

    return this.prisma.device.update({
      where: { id: device.id },
      data: {
        ...(dto.firmwareVersion && { firmwareVersion: dto.firmwareVersion }),
        ...(dto.secretKey && { secretKey: dto.secretKey.trim() }),
      },
      include: { animal: true },
    });
  }

  async deleteDevice(userId: string, farmId: string, deviceId: string) {
    await this.verifyFarmAccess(userId, farmId);

    const device = await this.prisma.device.findFirst({
      where: { deviceId, farmId },
    });

    if (!device) {
      throw new NotFoundException(`Устройство "${deviceId}" не найдено`);
    }

    return this.prisma.device.delete({
      where: { id: device.id },
    });
  }
}
