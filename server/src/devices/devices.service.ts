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
import { controlModeExpiresAt } from './control-mode';
import { loadAppConfig } from '../config/config';

export function controlModeTtlMs(env: Record<string, string | undefined> = process.env): number {
  return loadAppConfig(env).controlModeTtlMin * 60_000;
}
import type { CollarControlMode, PositionSource } from '@qamqor/shared';

/** Explicit projection: secrets and hashes are never selected. */
export const COLLAR_SELECT = {
  deviceId: true,
  code: true,
  status: true,
  signal: true,
  firmwareVersion: true,
  lastHeartbeatAt: true,
  isSimulated: true,
  controlMode: true,
  controlModeSince: true,
  controlActivityAt: true,
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
  /** AUTO (default), GPS_MANUAL (position dragged by the operator) or MANUAL (no automatic signals). */
  controlMode: CollarControlMode;
  /** MANUAL while the position is the operator's point (GPS_MANUAL), otherwise GPS. */
  positionSource: PositionSource;
  /** When the current MANUAL / GPS_MANUAL mode was entered (null in AUTO). */
  controlModeSince: string | null;
  /** When it lapses back to AUTO without operator activity (null in AUTO): for a persistent badge. */
  controlModeExpiresAt: string | null;
}

export function positionSourceOf(controlMode: string | null | undefined): PositionSource {
  return controlMode === 'GPS_MANUAL' ? 'MANUAL' : 'GPS';
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
    controlMode: d.controlMode ?? 'AUTO',
    positionSource: positionSourceOf(d.controlMode),
    controlModeSince: d.controlMode && d.controlMode !== 'AUTO' && d.controlModeSince ? new Date(d.controlModeSince).toISOString() : null,
    controlModeExpiresAt: controlModeExpiresAt(d, controlModeTtlMs())?.toISOString() ?? null,
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
      select: { id: true, farmId: true, code: true },
    });
    // An unclaimed device (created by its first ping) is attached to this farm, history kept.
    const claimable = !!(existing && code && existing.farmId === null && existing.code === code);
    if (existing && !claimable) throw new ConflictException('Устройство с таким кодом уже зарегистрировано');

    if (dto.animalId) {
      const animal = await this.prisma.animal.findFirst({ where: { id: dto.animalId, farmId } });
      if (!animal) throw new NotFoundException('Животное не найдено');
      // A newly registered collar is real; demo animals take only simulated collars.
      if (animal.isDemo) throw new ConflictException('Демо и реальные данные не смешиваются: демо-животному нельзя привязать реальный ошейник');
    }

    const deviceSecret = generateDeviceSecret();
    let created: any;
    try {
      if (claimable) {
        const r = await this.prisma.device.updateMany({
          where: { id: existing!.id, farmId: null },
          data: { farmId, animalId: dto.animalId },
        });
        if (r.count !== 1) throw new ConflictException('Устройство с таким кодом уже зарегистрировано');
        created = await this.prisma.device.findFirst({ where: { id: existing!.id }, select: COLLAR_SELECT });
      } else created = await this.prisma.device.create({
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
    let commandStr: string;
    if (dto.signal === 'BUZZER') commandStr = 'TEST_BUZZER';
    else if (dto.signal === 'SPEAKER') commandStr = 'TEST_SPEAKER';
    else if (dto.signal === 'VIBRATION') commandStr = 'TEST_VIBRATION';
    else commandStr = 'TEST_SOUND';

    // An operator command in a manual mode counts as activity (keeps the mode from lapsing).
    if (device.controlMode && device.controlMode !== 'AUTO') {
      await this.prisma.device.update({ where: { id: device.id }, data: { controlActivityAt: new Date() } });
    }
    const command = await this.prisma.deviceCommand.create({
      data: {
        deviceId: device.deviceId,
        command: commandStr,
        status: 'PENDING',
        payload: { requestedBy: userId },
      },
    });
    return { commandId: command.id };
  }
}
