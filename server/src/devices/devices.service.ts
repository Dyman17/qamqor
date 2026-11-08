import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDeviceDto, UpdateDeviceDto, TestSignalDto } from './dto/device.dto';
import { generateDeviceSecret, hashDeviceSecret } from './device-secret';
import { DeviceStatus } from '@prisma/client';

/** Explicit projection: secrets and hashes are never selected. */
const COLLAR_SELECT = {
  deviceId: true,
  status: true,
  signal: true,
  firmwareVersion: true,
  lastHeartbeatAt: true,
  isSimulated: true,
  animal: { select: { id: true, name: true } },
} as const;

const ONLINE_WINDOW_MS = 900 * 1000;

export type ConnState = 'ONLINE' | 'OFFLINE' | 'UNASSIGNED';

export interface CollarDto {
  deviceId: string;
  status: ConnState;
  animalId: string | null;
  animalName: string | null;
  signalRssi: number | null;
  firmwareVersion: string | null;
  lastSeenAt: string | null;
}

export function toCollarDto(d: any): CollarDto {
  const last: Date | null = d.lastHeartbeatAt ?? null;
  let status: ConnState;
  if (!d.animal) status = 'UNASSIGNED';
  else status = last && Date.now() - last.getTime() < ONLINE_WINDOW_MS ? 'ONLINE' : 'OFFLINE';
  return {
    deviceId: d.deviceId,
    status,
    animalId: d.animal?.id ?? null,
    animalName: d.animal?.name ?? null,
    signalRssi: d.signal ?? null,
    firmwareVersion: d.firmwareVersion ?? null,
    lastSeenAt: last ? last.toISOString() : null,
  };
}

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

  private async findOwned(farmId: string, deviceId: string) {
    const device = await this.prisma.device.findFirst({ where: { deviceId, farmId } });
    if (!device) throw new NotFoundException(`Устройство "${deviceId}" не найдено`);
    return device;
  }

  async listDevices(userId: string, farmId: string) {
    await this.verifyFarmAccess(userId, farmId);
    const rows = await this.prisma.device.findMany({
      where: { farmId },
      select: COLLAR_SELECT,
      orderBy: { deviceId: 'asc' },
    });
    return rows.map(toCollarDto);
  }

  async getDeviceById(userId: string, farmId: string, deviceId: string) {
    await this.verifyFarmAccess(userId, farmId);
    const device = await this.prisma.device.findFirst({
      where: { deviceId, farmId },
      select: COLLAR_SELECT,
    });
    if (!device) throw new NotFoundException(`Устройство "${deviceId}" не найдено`);
    return toCollarDto(device);
  }

  async registerDevice(userId: string, farmId: string, dto: RegisterDeviceDto) {
    await this.verifyFarmAccess(userId, farmId);

    const deviceId = dto.deviceId.trim();
    // Same answer whichever farm owns the id: do not reveal ownership.
    const existing = await this.prisma.device.findUnique({ where: { deviceId } });
    if (existing) throw new ConflictException('Устройство с таким ID уже зарегистрировано');

    if (dto.animalId) {
      const animal = await this.prisma.animal.findFirst({ where: { id: dto.animalId, farmId } });
      if (!animal) throw new NotFoundException('Животное не найдено');
    }

    const deviceSecret = generateDeviceSecret();
    const created = await this.prisma.device.create({
      data: {
        deviceId,
        secretHash: hashDeviceSecret(deviceSecret),
        farmId,
        firmwareVersion: dto.firmwareVersion || '1.0.0',
        status: DeviceStatus.INACTIVE,
        animalId: dto.animalId,
      },
      select: COLLAR_SELECT,
    });
    // The secret is returned this once; only its hash is stored.
    return { collar: toCollarDto(created), deviceSecret };
  }

  async rotateSecret(userId: string, farmId: string, deviceId: string) {
    await this.verifyFarmAccess(userId, farmId);
    const device = await this.findOwned(farmId, deviceId);
    const deviceSecret = generateDeviceSecret();
    await this.prisma.device.update({
      where: { id: device.id },
      data: { secretHash: hashDeviceSecret(deviceSecret) },
    });
    return { deviceSecret };
  }

  async updateDevice(userId: string, farmId: string, deviceId: string, dto: UpdateDeviceDto) {
    await this.verifyFarmAccess(userId, farmId);
    const device = await this.findOwned(farmId, deviceId);

    if (dto.animalId) {
      const animal = await this.prisma.animal.findFirst({ where: { id: dto.animalId, farmId } });
      if (!animal) throw new NotFoundException('Животное не найдено');
    }

    const updated = await this.prisma.device.update({
      where: { id: device.id },
      data: {
        ...(dto.animalId !== undefined && { animalId: dto.animalId }),
        ...(dto.firmwareVersion && { firmwareVersion: dto.firmwareVersion }),
      },
      select: COLLAR_SELECT,
    });
    return toCollarDto(updated);
  }

  async deleteDevice(userId: string, farmId: string, deviceId: string) {
    await this.verifyFarmAccess(userId, farmId);
    const device = await this.findOwned(farmId, deviceId);
    await this.prisma.device.delete({ where: { id: device.id } });
  }

  async queueTestSignal(userId: string, farmId: string, deviceId: string, dto: TestSignalDto) {
    await this.verifyFarmAccess(userId, farmId);
    const device = await this.findOwned(farmId, deviceId);
    const command = await this.prisma.deviceCommand.create({
      data: {
        deviceId: device.deviceId,
        command: dto.signal === 'SOUND' ? 'TEST_SOUND' : 'TEST_VIBRATION',
        status: 'PENDING',
        payload: { requestedBy: userId },
      },
    });
    return { commandId: command.id };
  }
}
