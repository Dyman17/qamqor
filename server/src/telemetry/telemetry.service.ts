import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { GeofenceService } from '../geofences/geofence.service';
import { AlertsService } from '../alerts/alerts.service';
import { DeviceTelemetryDto } from './dto/device-telemetry.dto';
import { DeviceTelemetryResponseDto } from '@qamqor/contracts';
import { DeviceStatus } from '@qamqor/shared';
import { DEVICE_AUTH_ERROR } from '../devices/device-auth.guard';

type ZoneName = 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED' | 'ESCAPE' | 'UNKNOWN';

@Injectable()
export class TelemetryService {
  private readonly logger = new Logger(TelemetryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly geofenceService: GeofenceService,
    private readonly alertsService: AlertsService,
    private readonly configService: ConfigService,
  ) {}

  private num(key: string, def: number): number {
    const n = parseInt(this.configService.get<string>(key, String(def)), 10);
    return Number.isInteger(n) && n > 0 ? n : def;
  }

  /**
   * Handles a ping from an already authenticated device (see DeviceAuthGuard).
   * Devices are never created here.
   *
   * Fail-closed: without a usable boundary, or with an unreliable fix, the zone is UNKNOWN,
   * every actuator is off and the position is still stored. The impulse is never produced.
   */
  async processDeviceTelemetry(
    device: any,
    dto: DeviceTelemetryDto,
  ): Promise<DeviceTelemetryResponseDto> {
    if (!device || device.deviceId !== dto.deviceId) {
      throw new UnauthorizedException(DEVICE_AUTH_ERROR);
    }

    // Anti-replay and timestamp window
    const pingTime = new Date(dto.timestamp);
    const now = new Date();
    const maxAgeMs = this.num('TELEMETRY_MAX_AGE_SEC', 600) * 1000;
    const maxFutureMs = this.num('TELEMETRY_MAX_FUTURE_SEC', 120) * 1000;
    const skew = pingTime.getTime() - now.getTime(); // negative = in the past
    if (Number.isNaN(skew) || skew < -maxAgeMs || skew > maxFutureMs) {
      throw new BadRequestException('Telemetry timestamp is invalid or outside the acceptable time window.');
    }

    let isOutside: boolean = device.animal?.isOutsideGeofence ?? false;
    let zone: ZoneName = 'UNKNOWN';
    let inFence: boolean | null = null;
    let distanceToBorderMeters: number | null = null;
    let toneFrequencyHz = 0;
    let sound = false;
    let vibrate = false;
    let unknownReason: string | null = 'NO_BOUNDARY';

    let nextInterval = this.num('NORMAL_PING_INTERVAL_SEC', 300);
    const emergencyInterval = this.num('EMERGENCY_PING_INTERVAL_SEC', 60);

    const animal = device.animal;
    const polygon = animal?.activeGeofence?.polygonJson ?? null;

    if (animal) {
      const evaluation = this.geofenceService.evaluateLocation(
        {
          latitude: dto.latitude,
          longitude: dto.longitude,
          accuracy: dto.accuracy,
          speed: dto.speedKmh,
        },
        polygon,
      );
      zone = evaluation.zone;
      unknownReason = evaluation.reason;
      distanceToBorderMeters = evaluation.distanceMeters;

      if (zone !== 'UNKNOWN') {
        toneFrequencyHz = evaluation.toneFrequencyHz;
        inFence = !(zone === 'RED' || zone === 'ESCAPE');
        isOutside = !inFence;

        // GREEN: none; YELLOW: sound; ORANGE/RED: sound+vibration; ESCAPE: none (anti-panic).
        sound = zone === 'YELLOW' || zone === 'ORANGE' || zone === 'RED';
        vibrate = zone === 'ORANGE' || zone === 'RED';

        if (device.farmId) {
          await this.alertsService.resolveGpsLost(animal.id);
        }

        if (isOutside) {
          // Скот сбежал — сокращаем интервал пинга для частого трекинга
          nextInterval = emergencyInterval;
          if (device.farmId) {
            await this.alertsService.triggerGeofenceBreach({
              farmId: device.farmId,
              animalId: animal.id,
              animalName: animal.name,
              deviceId: device.deviceId,
              latitude: dto.latitude,
              longitude: dto.longitude,
            });
          }
        } else if (animal.isOutsideGeofence && device.farmId) {
          // Животное вернулось назад в зону
          await this.alertsService.resolveGeofenceBreach({
            farmId: device.farmId,
            animalId: animal.id,
            animalName: animal.name,
            deviceId: device.deviceId,
            latitude: dto.latitude,
            longitude: dto.longitude,
          });
        }
      } else if (evaluation.reason === 'LOW_ACCURACY' && device.farmId) {
        await this.alertsService.triggerGpsLost({
          farmId: device.farmId,
          animalId: animal.id,
          animalName: animal.name,
          deviceId: device.deviceId,
        });
      }

      // The last known position is stored on every valid ping, whatever the zone.
      await this.prisma.animal.update({
        where: { id: animal.id },
        data: {
          lastLatitude: dto.latitude,
          lastLongitude: dto.longitude,
          lastAccuracy: dto.accuracy,
          lastSeenAt: pingTime,
          isOutsideGeofence: isOutside,
        },
      });
    }

    // Device status: last contact is the server receive time.
    await this.prisma.device.update({
      where: { id: device.id },
      data: {
        signal: dto.signal ?? null,
        status: DeviceStatus.ONLINE,
        lastHeartbeatAt: now,
      },
    });

    // Record Telemetry Point
    await this.prisma.telemetry.create({
      data: {
        deviceId: device.deviceId,
        animalId: animal?.id,
        latitude: dto.latitude,
        longitude: dto.longitude,
        accuracy: dto.accuracy,
        signal: dto.signal,
        isOutsideGeofence: isOutside,
        timestamp: pingTime,
      },
    });

    let warningMessage: string;
    switch (zone) {
      case 'GREEN':
        warningMessage = 'Zone GREEN: safe grazing. No signals.';
        break;
      case 'YELLOW':
        warningMessage = `Zone YELLOW: warning, ${distanceToBorderMeters} m to the border. Sound signal (${toneFrequencyHz} Hz).`;
        break;
      case 'ORANGE':
        warningMessage = `Zone ORANGE: near the border (${distanceToBorderMeters} m). Sound (${toneFrequencyHz} Hz) and vibration.`;
        break;
      case 'RED':
        warningMessage = `Zone RED: outside the border (${distanceToBorderMeters} m). Sound (${toneFrequencyHz} Hz) and vibration.`;
        break;
      case 'ESCAPE':
        warningMessage = `Zone ESCAPE (${distanceToBorderMeters} m outside): signals disabled to avoid panic.`;
        break;
      default:
        warningMessage =
          unknownReason === 'LOW_ACCURACY'
            ? 'Zone UNKNOWN: GPS fix is not reliable. No signals.'
            : unknownReason === 'INVALID_BOUNDARY'
              ? 'Zone UNKNOWN: the boundary is invalid. No signals.'
              : 'Zone UNKNOWN: no boundary is set for this animal. No signals.';
    }

    // Deliver at most one queued test signal per ping (once only).
    let command: { id: string; type: 'TEST_SOUND' | 'TEST_VIBRATION' } | undefined;
    const pending = await this.prisma.deviceCommand.findFirst({
      where: { deviceId: device.deviceId, status: 'PENDING', command: { in: ['TEST_SOUND', 'TEST_VIBRATION'] } },
      orderBy: { createdAt: 'asc' },
    });
    if (pending) {
      const claimed = await this.prisma.deviceCommand.updateMany({
        where: { id: pending.id, status: 'PENDING' },
        data: { status: 'EXECUTED', executedAt: new Date() },
      });
      if (claimed.count === 1) {
        command = { id: pending.id, type: pending.command as 'TEST_SOUND' | 'TEST_VIBRATION' };
      }
    }

    return {
      success: true,
      serverTime: now.toISOString(),
      nextInterval,
      configVersion: 1,
      command,
      inFence,
      zone,
      distanceToBorderMeters,
      toneFrequencyHz,
      sound,
      vibrate,
      vibrateDurationMs: vibrate ? 3000 : 0,
      warningMessage,
    };
  }
}
