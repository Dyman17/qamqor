import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDeviceDto, UpdateDeviceDto, TestSignalDto } from './dto/device.dto';
import { generateDeviceSecret, hashDeviceSecret } from './device-secret';
import { DeviceStatus } from '@prisma/client';
import { ConnState, computeConnState } from './connectivity';

/** Explicit projection: secrets and hashes are never selected. */
const COLLAR_SELECT = {
  deviceId: true,
  code: true,
  status: true,
  signal: true,
  firmwareVersion: true,
  lastHeartbeatAt: true,
  isSimulated: true,
  animal: { select: { id: true, name: true } },
} as const;

export type { ConnState } from './connectivity';

export interface CollarDto {
  deviceId: string;
  /** 8-digit device code, or null for legacy and simulated collars. */
  code: string | null;
  status: ConnState;
  animalId: string | null;
  animalName: string | null;
  signalRssi: number | null;
  firmwareVersion: string | null;
  lastSeenAt: string | null;
  /** Simulated (demo) collar: `Device.isSimulated`. */
  isDemo: boolean;
}

export function toCollarDto(d: any): CollarDto {
  const last: Date | null = d.lastHeartbeatAt ?? null;
  return {
    deviceId: d.deviceId,
    code: d.code ?? null,
    // Derived from the last ping on every read; the stored Device.status is not trusted.
    status: computeConnState({ hasAnimal: !!d.animal, lastSeenAt: last }),
    animalId: d.animal?.id ?? null,
    animalName: d.animal?.name ?? null,
    signalRssi: d.signal ?? null,
    firmwareVersion: d.firmwareVersion ?? null,
    lastSeenAt: last ? last.toISOString() : null,
    isDemo: d.isSimulated ?? false,
  };
}

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  private async findOwned(farmId: string, deviceId: string) {
    const device = await this.prisma.device.findFirst({ where: { deviceId, farmId } });
    if (!device) throw new NotFoundException(`Устройство "${deviceId}" не найдено`);
    return device;
  }

  async listDevices(userId: string, farmId: string) {
    const rows = await this.prisma.device.findMany({
      where: { farmId },
      select: COLLAR_SELECT,
      orderBy: { deviceId: 'asc' },
    });
    return rows.map(toCollarDto);
  }

  async getDeviceById(userId: string, farmId: string, deviceId: string) {
    const device = await this.prisma.device.findFirst({
      where: { deviceId, farmId },
      select: COLLAR_SELECT,
    });
    if (!device) throw new NotFoundException(`Устройство "${deviceId}" не найдено`);
    return toCollarDto(device);
  }

  async registerDevice(userId: string, farmId: string, dto: RegisterDeviceDto) {
    if (!dto.code && !dto.deviceId) throw new BadRequestException('Укажите 8-значный код устройства (code)');
    // The 8-digit code is the identity; the public id is derived from it. `deviceId` alone is the legacy path.
    const code = dto.code ?? null;
    const deviceId = code ? `QAM-${code}` : dto.deviceId!.trim();
    // Same answer whichever farm owns the code or id: do not reveal ownership.
    const existing = await this.prisma.device.findFirst({
      where: { OR: [{ deviceId }, ...(code ? [{ code }] : [])] },
      select: { id: true },
    });
    if (existing) throw new ConflictException('Устройство с таким кодом уже зарегистрировано');

    if (dto.animalId) {
      const animal = await this.prisma.animal.findFirst({ where: { id: dto.animalId, farmId } });
      if (!animal) throw new NotFoundException('Животное не найдено');
      // A newly registered collar is real; demo animals take only simulated collars.
      if (animal.isDemo) throw new ConflictException('Демо и реальные данные не смешиваются: демо-животному нельзя привязать реальный ошейник');
    }

    const deviceSecret = generateDeviceSecret();
    let created: any;
    try {
      created = await this.prisma.device.create({
        data: {
          deviceId,
          code,
          secretHash: hashDeviceSecret(deviceSecret),
          farmId,
          status: DeviceStatus.INACTIVE,
          animalId: dto.animalId,
        },
        select: COLLAR_SELECT,
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException('Устройство с таким кодом уже зарегистрировано');
      throw e;
    }
    // A claimed collar needs no secret: the 8-digit code is its identity. The (legacy) secret is
    // returned only for the deviceId-only path, once; only its hash is stored.
    return code ? { collar: toCollarDto(created) } : { collar: toCollarDto(created), deviceSecret };
  }

  async rotateSecret(userId: string, farmId: string, deviceId: string) {
    const device = await this.findOwned(farmId, deviceId);
    const deviceSecret = generateDeviceSecret();
    await this.prisma.device.update({
      where: { id: device.id },
      data: { secretHash: hashDeviceSecret(deviceSecret) },
    });
    return { deviceSecret };
  }

  async updateDevice(userId: string, farmId: string, deviceId: string, dto: UpdateDeviceDto) {
    const device = await this.findOwned(farmId, deviceId);

    if (dto.animalId) {
      const animal = await this.prisma.animal.findFirst({ where: { id: dto.animalId, farmId } });
      if (!animal) throw new NotFoundException('Животное не найдено');
      if (!!animal.isDemo !== !!device.isSimulated) {
        throw new ConflictException('Демо и реальные данные не смешиваются: ошейник и животное должны быть оба демо или оба реальные');
      }
      const taken = await this.prisma.device.findFirst({
        where: { animalId: dto.animalId, NOT: { id: device.id } },
      });
      if (taken) throw new ConflictException('У животного уже есть ошейник');
    }

    const updated = await this.prisma.device.update({
      where: { id: device.id },
      data: {
        ...(dto.animalId !== undefined && { animalId: dto.animalId }),
      },
      select: COLLAR_SELECT,
    });
    return toCollarDto(updated);
  }

  async deleteDevice(userId: string, farmId: string, deviceId: string) {
    const device = await this.findOwned(farmId, deviceId);
    await this.prisma.device.delete({ where: { id: device.id } });
  }

  async queueTestSignal(userId: string, farmId: string, deviceId: string, dto: TestSignalDto) {
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
