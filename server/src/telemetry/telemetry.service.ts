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
import { SignalsService } from '../signals/signals.service';

type ZoneName = 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED' | 'ESCAPE' | 'UNKNOWN';

@Injectable()
export class TelemetryService {
  private readonly logger = new Logger(TelemetryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly geofenceService: GeofenceService,
    private readonly alertsService: AlertsService,
    private readonly configService: ConfigService,
    private readonly signals: SignalsService,
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
    const hasFix = typeof dto.latitude === 'number' && typeof dto.longitude === 'number';
    const lat = dto.latitude as number;
    const lng = dto.longitude as number;
    const acc = dto.accuracy as number;
    // A pulse-only ping (no GPS fix, e.g. indoors) may omit the timestamp: server time is used.
    const now0 = new Date();
    const pingTime = dto.timestamp ? new Date(dto.timestamp) : now0;
    const now = new Date();
    const maxAgeMs = this.num('TELEMETRY_MAX_AGE_SEC', 600) * 1000;
    const maxFutureMs = this.num('TELEMETRY_MAX_FUTURE_SEC', 120) * 1000;
    const skew = pingTime.getTime() - now.getTime(); // negative = in the past
    if (Number.isNaN(skew) || skew < -maxAgeMs || skew > maxFutureMs) {
      throw new BadRequestException('Telemetry timestamp is invalid or outside the acceptable time window.');
    }

    // A retried ping (same device + timestamp) is answered but not counted again.
    const duplicate = !!(await this.prisma.telemetry.findFirst({
      where: { deviceId: device.deviceId, timestamp: pingTime },
      select: { id: true },
    }));
    // An older or equal timestamp must not move the animal backwards.
    const stale = hasFix && !!(device.animal?.lastSeenAt && pingTime.getTime() <= new Date(device.animal.lastSeenAt).getTime());

    let isOutside: boolean = device.animal?.isOutsideGeofence ?? false;
    let zone: ZoneName = 'UNKNOWN';
    let inFence: boolean | null = null;
    let distanceToBorderMeters: number | null = null;
    let toneFrequencyHz = 0;
    let sound = false;
    let vibrate = false;
    let unknownReason: string | null = hasFix ? 'NO_BOUNDARY' : 'NO_FIX';
    let suppressedBy: 'SIGNAL_LIMIT' | null = null;

    let nextInterval = this.num('NORMAL_PING_INTERVAL_SEC', 300);
    const emergencyInterval = this.num('EMERGENCY_PING_INTERVAL_SEC', 60);

    const hr: number | null = typeof dto.heartRate === 'number' ? dto.heartRate : null;
    const animal = device.animal;
    const polygon = animal?.activeGeofence?.polygonJson ?? null;

    if (animal && hasFix) {
      const evaluation = this.geofenceService.evaluateLocation(
        {
          latitude: lat,
          longitude: lng,
          accuracy: acc,
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

          // Daily limits: a level that reached its limit is suppressed and an alert is raised.
          const limited = await this.signals.applyLimits({
            farmId: device.farmId,
            timezone: device.farm?.timezone ?? 'Asia/Aqtau',
            animal: { id: animal.id, name: animal.name, isDemo: !!animal.isDemo },
            deviceId: device.deviceId,
            sound,
            vibrate,
            now,
            record: !duplicate,
          });
          if (limited.suppressed) {
            suppressedBy = 'SIGNAL_LIMIT';
            if (!limited.sound) toneFrequencyHz = 0;
          }
          sound = limited.sound;
          vibrate = limited.vibrate;
        }

        if (stale) {
          // out-of-order ping: no alert changes
        } else if (isOutside) {
          // Скот сбежал — сокращаем интервал пинга для частого трекинга
          nextInterval = emergencyInterval;
          if (device.farmId) {
            await this.alertsService.triggerGeofenceBreach({
              farmId: device.farmId,
              animalId: animal.id,
              animalName: animal.name,
              deviceId: device.deviceId,
              latitude: lat,
              longitude: lng,
              isDemo: !!animal.isDemo,
            });
          }
        } else if (animal.isOutsideGeofence && device.farmId) {
          // Животное вернулось назад в зону
          await this.alertsService.resolveGeofenceBreach({
            farmId: device.farmId,
            animalId: animal.id,
            animalName: animal.name,
            deviceId: device.deviceId,
            latitude: lat,
            longitude: lng,
            isDemo: !!animal.isDemo,
          });
        }
      } else if (evaluation.reason === 'LOW_ACCURACY' && device.farmId && !stale) {
        await this.alertsService.triggerGpsLost({
          farmId: device.farmId,
          animalId: animal.id,
          animalName: animal.name,
          deviceId: device.deviceId,
          isDemo: !!animal.isDemo,
        });
      }

      // The last known position is stored on every valid ping, whatever the zone.
      if (!stale) await this.prisma.animal.update({
        where: { id: animal.id },
        data: {
          lastLatitude: lat,
          lastLongitude: lng,
          lastAccuracy: acc,
          lastSeenAt: pingTime,
          isOutsideGeofence: isOutside,
          ...(hr !== null && { lastHeartRate: hr, lastHeartRateAt: pingTime }),
        },
      });
    }

    
    // Pulse-only ping: keep the latest pulse, no zone logic, no signals, no GPS alerts.
    if (animal && !hasFix && hr !== null) {
      const prev = animal.lastHeartRateAt ? new Date(animal.lastHeartRateAt).getTime() : 0;
      if (pingTime.getTime() >= prev) {
        await this.prisma.animal.update({ where: { id: animal.id }, data: { lastHeartRate: hr, lastHeartRateAt: pingTime } });
      }
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

    // The collar is heard again: close its DEVICE_OFFLINE alert.
    if (animal && device.farmId) {
      await this.alertsService.restoreDevice({
        farmId: device.farmId,
        animalId: animal.id,
        animalName: animal.name,
        deviceId: device.deviceId,
        isDemo: !!animal.isDemo,
      });
    }

    // Record Telemetry Point
    if (!duplicate) await this.prisma.telemetry.create({
      data: {
        deviceId: device.deviceId,
        animalId: animal?.id,
        latitude: hasFix ? lat : null,
        longitude: hasFix ? lng : null,
        accuracy: hasFix ? acc : null,
        signal: dto.signal,
        heartRate: hr,
        satellites: dto.satellites ?? null,
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
          unknownReason === 'NO_FIX'
            ? 'Zone UNKNOWN: no GPS fix. No signals.'
            : unknownReason === 'LOW_ACCURACY'
            ? 'Zone UNKNOWN: GPS fix is not reliable. No signals.'
            : unknownReason === 'INVALID_BOUNDARY'
              ? 'Zone UNKNOWN: the boundary is invalid. No signals.'
              : 'Zone UNKNOWN: no boundary is set for this animal. No signals.';
    }

    if (!device.farmId) warningMessage = 'Device not claimed yet';

    if (suppressedBy) warningMessage += ' Some signals are suppressed by the daily limit.';

    // Deliver at most one queued test signal per ping (once only).
    let command: { id: string; type: 'TEST_SOUND' | 'TEST_SPEAKER' | 'TEST_BUZZER' | 'TEST_VIBRATION' } | undefined;
    const pending = await this.prisma.deviceCommand.findFirst({
      where: { deviceId: device.deviceId, status: 'PENDING', command: { in: ['TEST_SOUND', 'TEST_SPEAKER', 'TEST_BUZZER', 'TEST_VIBRATION'] } },
      orderBy: { createdAt: 'asc' },
    });
    if (pending) {
      const claimed = await this.prisma.deviceCommand.updateMany({
        where: { id: pending.id, status: 'PENDING' },
        data: { status: 'EXECUTED', executedAt: new Date() },
      });
      if (claimed.count === 1) {
        command = { id: pending.id, type: pending.command as any };
      }
    }

    return {
      success: true,
      mode: device.farm?.dataMode === 'AUTO' ? 'AUTO' : device.farm?.dataMode === 'MANUAL' ? 'PILOT' : 'REAL',
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
      suppressedBy,
      warningMessage,
    };
  }
}
