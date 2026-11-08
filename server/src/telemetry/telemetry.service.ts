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

@Injectable()
export class TelemetryService {
  private readonly logger = new Logger(TelemetryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly geofenceService: GeofenceService,
    private readonly alertsService: AlertsService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Handles a ping from an already authenticated device (see DeviceAuthGuard).
   * Devices are never created here.
   */
  async processDeviceTelemetry(
    device: any,
    dto: DeviceTelemetryDto,
  ): Promise<DeviceTelemetryResponseDto> {
    if (!device || device.deviceId !== dto.deviceId) {
      throw new UnauthorizedException(DEVICE_AUTH_ERROR);
    }

    // 2. Anti-replay and timestamp validation
    const pingTime = new Date(dto.timestamp);
    const now = new Date();
    const diffMinutes = Math.abs((now.getTime() - pingTime.getTime()) / (1000 * 60));
    if (Number.isNaN(pingTime.getTime()) || !(diffMinutes <= 1440 * 7)) {
      // Reject coordinates older than 7 days or far in future
      throw new BadRequestException('Telemetry timestamp is out of acceptable time window.');
    }

    // 3. Geofencing check & 4-Zone Livestock Steering
    let isOutside = false;
    let zone: 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED' | 'ESCAPE' = 'GREEN';
    let distanceToBorderMeters = 9999;
    let toneFrequencyHz = 0;
    let sound = false;
    let vibrate = false;

    let nextInterval = parseInt(
      this.configService.get<string>('NORMAL_PING_INTERVAL_SEC', '300'),
      10,
    );
    const emergencyInterval = parseInt(
      this.configService.get<string>('EMERGENCY_PING_INTERVAL_SEC', '60'),
      10,
    );

    if (device.animal && device.animal.activeGeofence) {
      const evaluation = this.geofenceService.evaluateLocation(
        {
          latitude: dto.latitude,
          longitude: dto.longitude,
          accuracy: dto.accuracy,
        },
        device.animal.activeGeofence.polygonJson,
      );

      // Only trigger if accuracy is reliable (prevent false positives)
      if (evaluation.isReliable) {
        zone = evaluation.zone;
        distanceToBorderMeters = evaluation.distanceMeters;
        toneFrequencyHz = evaluation.toneFrequencyHz;
        isOutside = (zone === 'RED' || zone === 'ESCAPE');

        // GREEN: none; YELLOW: sound; ORANGE: sound+vibration; RED: sound+vibration; ESCAPE: none (anti-panic).
        // The impulse is never produced by the server.
        switch (zone) {
          case 'GREEN':
            sound = false;
            vibrate = false;
            break;
          case 'YELLOW':
            sound = true;
            vibrate = false;
            break;
          case 'ORANGE':
            sound = true;
            vibrate = true;
            break;
          case 'RED':
            sound = true;
            vibrate = true;
            break;
          case 'ESCAPE':
            sound = false;
            vibrate = false;
            break;
        }

        if (isOutside) {
          // Скот сбежал — сокращаем интервал пинга для частого трекинга
          nextInterval = emergencyInterval;

          if (device.farmId) {
            await this.alertsService.triggerGeofenceBreach({
              farmId: device.farmId,
              animalId: device.animal.id,
              animalName: device.animal.name,
              deviceId: device.deviceId,
              latitude: dto.latitude,
              longitude: dto.longitude,
            });
          }
        } else if (device.animal.isOutsideGeofence) {
          // Животное вернулось назад в зону
          if (device.farmId) {
            await this.alertsService.resolveGeofenceBreach({
              farmId: device.farmId,
              animalId: device.animal.id,
              animalName: device.animal.name,
              deviceId: device.deviceId,
              latitude: dto.latitude,
              longitude: dto.longitude,
            });
          }
        }
      } else {
        // Retain prior status if accuracy is low
        isOutside = device.animal.isOutsideGeofence;
        zone = isOutside ? 'RED' : 'GREEN';
        sound = isOutside;
        vibrate = isOutside;
        distanceToBorderMeters = evaluation.distanceMeters;
        toneFrequencyHz = isOutside ? 2400 : 0;
      }

      // Update animal state
      await this.prisma.animal.update({
        where: { id: device.animal.id },
        data: {
          lastLatitude: dto.latitude,
          lastLongitude: dto.longitude,
          lastAccuracy: dto.accuracy,
          lastSeenAt: pingTime,
          isOutsideGeofence: isOutside,
        },
      });
    }

    // 4. Update Device Status
    await this.prisma.device.update({
      where: { id: device.id },
      data: {
        battery: dto.battery,
        signal: dto.signal ?? null,
        status: dto.battery <= 15 ? DeviceStatus.LOW_BATTERY : DeviceStatus.ONLINE,
        lastHeartbeatAt: now,
      },
    });

    // 5. Battery check alert
    if (device.farmId) {
      await this.alertsService.checkLowBattery({
        farmId: device.farmId,
        animalId: device.animal?.id,
        deviceId: device.deviceId,
        battery: dto.battery,
      });
    }

    // 6. Record Telemetry Point
    await this.prisma.telemetry.create({
      data: {
        deviceId: device.deviceId,
        animalId: device.animal?.id,
        latitude: dto.latitude,
        longitude: dto.longitude,
        accuracy: dto.accuracy,
        battery: dto.battery,
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
      inFence: !isOutside,
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
