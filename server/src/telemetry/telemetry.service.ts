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
import { DeviceStatus, GeofenceStatus } from '@qamqor/shared';

export interface DeviceOverride {
  latitude: number;
  longitude: number;
  isOutside: boolean;
  active: boolean;
  sound?: boolean;
  vibrate?: boolean;
  shock?: boolean;
  zone?: 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED' | 'ESCAPE';
  distanceToBorderMeters?: number;
  toneFrequencyHz?: number;
  expiresAt: number;
}

@Injectable()
export class TelemetryService {
  private readonly logger = new Logger(TelemetryService.name);
  private static overrides = new Map<string, DeviceOverride>();

  public setManualOverride(
    deviceId: string,
    override: Omit<DeviceOverride, 'expiresAt'>,
    durationMs: number = 30 * 60 * 1000,
  ) {
    TelemetryService.overrides.set(deviceId, {
      ...override,
      expiresAt: Date.now() + durationMs,
    });
    this.logger.log(`Manual override active for ${deviceId}: outside=${override.isOutside}`);
  }

  public clearManualOverride(deviceId: string) {
    TelemetryService.overrides.delete(deviceId);
  }

  public getManualOverride(deviceId: string): DeviceOverride | null {
    const o = TelemetryService.overrides.get(deviceId);
    if (!o) return null;
    if (Date.now() > o.expiresAt) {
      TelemetryService.overrides.delete(deviceId);
      return null;
    }
    return o;
  }

  async getDeviceLiveStatus(deviceId: string = 'QAM-0001') {
    const [device, latestTelemetry] = await Promise.all([
      this.prisma.device.findUnique({
        where: { deviceId },
        include: {
          animal: {
            include: {
              activeGeofence: true,
            },
          },
        },
      }),
      this.prisma.telemetry.findFirst({
        where: { deviceId },
        orderBy: { timestamp: 'desc' },
      }),
    ]);

    if (!device) {
      return {
        deviceId,
        isOnline: false,
        status: 'OFFLINE',
        secondsSinceLastPing: null,
        lastHeartbeatAt: null,
        battery: null,
        signal: null,
        lastLatitude: null,
        lastLongitude: null,
        gpsAccuracy: null,
        zone: 'GREEN' as const,
        distanceToBorderMeters: null,
        toneFrequencyHz: 0,
        buzzer: false,
        sound: false,
        vibrate: false,
        shock: false,
      };
    }

    const now = Date.now();
    const lastPing = device.lastHeartbeatAt ? new Date(device.lastHeartbeatAt).getTime() : 0;
    // Real online check: online only if ping arrived within the last 15 seconds!
    const isOnline = lastPing > 0 && (now - lastPing) < 15000;
    const override = this.getManualOverride(deviceId);

    let zone: 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED' | 'ESCAPE' = 'GREEN';
    let distanceToBorderMeters: number | null = null;
    let toneFrequencyHz = 0;
    let sound = false;
    let vibrate = false;
    let shock = false;

    if (override && override.active) {
      zone = override.zone ?? (override.shock ? 'RED' : override.vibrate ? 'ORANGE' : override.sound ? 'YELLOW' : override.isOutside ? 'RED' : 'GREEN');
      distanceToBorderMeters = override.distanceToBorderMeters ?? (override.isOutside ? 25 : 50);
      toneFrequencyHz = override.toneFrequencyHz ?? (zone === 'RED' ? 2400 : zone === 'ORANGE' ? 2000 : zone === 'YELLOW' ? 1200 : 0);
      sound = override.sound ?? (zone === 'YELLOW' || zone === 'ORANGE' || zone === 'RED');
      vibrate = override.vibrate ?? (zone === 'ORANGE' || zone === 'RED');
      shock = override.shock ?? (zone === 'RED');
    } else if (device.animal?.activeGeofence && latestTelemetry) {
      const evaluation = this.geofenceService.evaluateLocation(
        {
          latitude: latestTelemetry.latitude,
          longitude: latestTelemetry.longitude,
          accuracy: latestTelemetry.accuracy,
        },
        device.animal.activeGeofence.polygonJson,
      );
      zone = evaluation.zone;
      distanceToBorderMeters = evaluation.distanceMeters;
      toneFrequencyHz = evaluation.toneFrequencyHz;
      sound = (zone === 'YELLOW' || zone === 'ORANGE' || zone === 'RED');
      vibrate = (zone === 'ORANGE' || zone === 'RED');
      shock = (zone === 'RED');
    } else {
      const isOutside = latestTelemetry?.isOutsideGeofence ?? false;
      zone = isOutside ? 'RED' : 'GREEN';
      distanceToBorderMeters = isOutside ? 25 : 50;
      toneFrequencyHz = isOutside ? 2400 : 0;
      sound = isOutside;
      vibrate = isOutside;
      shock = isOutside;
    }

    const buzzer = sound;

    return {
      deviceId: device.deviceId,
      isOnline,
      status: isOnline ? 'ONLINE' : 'OFFLINE',
      secondsSinceLastPing: lastPing > 0 ? Math.round((now - lastPing) / 1000) : null,
      lastHeartbeatAt: device.lastHeartbeatAt?.toISOString() || null,
      battery: device.battery,
      signal: device.signal,
      lastLatitude: latestTelemetry?.latitude ?? null,
      lastLongitude: latestTelemetry?.longitude ?? null,
      gpsAccuracy: latestTelemetry?.accuracy ?? 3.2,
      buzzer,
      sound,
      vibrate,
      shock,
      zone,
      distanceToBorderMeters,
      toneFrequencyHz,
    };
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly geofenceService: GeofenceService,
    private readonly alertsService: AlertsService,
    private readonly configService: ConfigService,
  ) {}

  async processDeviceTelemetry(
    token: string | undefined,
    dto: DeviceTelemetryDto,
  ): Promise<DeviceTelemetryResponseDto> {
    const masterSecret = this.configService.get<string>('DEVICE_MASTER_SECRET');

    // 1. Verify Device Existence and Auth Token
    let device = await this.prisma.device.findUnique({
      where: { deviceId: dto.deviceId },
      include: {
        farm: true,
        animal: {
          include: {
            activeGeofence: true,
          },
        },
      },
    });

    // In dev / initial setup: auto-provision device if master secret matches and device does not exist
    if (!device) {
      if (masterSecret && token === masterSecret) {
        this.logger.log(`Auto-provisioning device ${dto.deviceId}`);
        device = await this.prisma.device.create({
          data: {
            deviceId: dto.deviceId,
            secretKey: masterSecret,
            status: DeviceStatus.ONLINE,
          },
          include: {
            farm: true,
            animal: {
              include: {
                activeGeofence: true,
              },
            },
          },
        });
      } else {
        throw new UnauthorizedException(`Device ${dto.deviceId} not registered.`);
      }
    }

    // Verify token against device secretKey or master secret
    const isValidToken =
      (!!token && token === device.secretKey) || (!!masterSecret && token === masterSecret);
    if (!isValidToken) {
      throw new UnauthorizedException('Invalid device authentication token.');
    }

    // 2. Anti-replay and timestamp validation
    const pingTime = new Date(dto.timestamp);
    const now = new Date();
    const diffMinutes = Math.abs((now.getTime() - pingTime.getTime()) / (1000 * 60));
    if (diffMinutes > 1440 * 7) {
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
    let shock = false;

    let nextInterval = parseInt(
      this.configService.get<string>('NORMAL_PING_INTERVAL_SEC', '300'),
      10,
    );
    const emergencyInterval = parseInt(
      this.configService.get<string>('EMERGENCY_PING_INTERVAL_SEC', '60'),
      10,
    );

    const override = this.getManualOverride(device.deviceId);

    if (override && override.active) {
      zone = override.zone ?? (override.shock ? 'RED' : override.vibrate ? 'ORANGE' : override.sound ? 'YELLOW' : override.isOutside ? 'RED' : 'GREEN');
      isOutside = override.isOutside ?? (zone === 'RED' || zone === 'ESCAPE');
      distanceToBorderMeters = override.distanceToBorderMeters ?? (isOutside ? 25 : 50);
      toneFrequencyHz = override.toneFrequencyHz ?? (zone === 'RED' ? 2400 : zone === 'ORANGE' ? 2000 : zone === 'YELLOW' ? 1200 : 0);
      sound = override.sound ?? (zone === 'YELLOW' || zone === 'ORANGE' || zone === 'RED');
      vibrate = override.vibrate ?? (zone === 'ORANGE' || zone === 'RED');
      shock = override.shock ?? (zone === 'RED');

      if (isOutside) {
        nextInterval = emergencyInterval;
      }
      this.logger.log(`Collar ping from ${device.deviceId} controlled by WEBSITE OVERRIDE (zone=${zone}, outside=${isOutside}, sound=${sound}, vibrate=${vibrate}, shock=${shock})`);
    } else if (device.animal && device.animal.activeGeofence) {
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

        // Map triggers:
        // GREEN: sound=false, vibrate=false, shock=false
        // YELLOW: sound=true, vibrate=false, shock=false
        // ORANGE: sound=true, vibrate=true, shock=false
        // RED: sound=true, vibrate=true, shock=true (150ms)
        // ESCAPE: sound=false, vibrate=false, shock=false
        switch (zone) {
          case 'GREEN':
            sound = false;
            vibrate = false;
            shock = false;
            break;
          case 'YELLOW':
            sound = true;
            vibrate = false;
            shock = false;
            break;
          case 'ORANGE':
            sound = true;
            vibrate = true;
            shock = false;
            break;
          case 'RED':
            sound = true;
            vibrate = true;
            shock = true;
            break;
          case 'ESCAPE':
            sound = false;
            vibrate = false;
            shock = false;
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
        shock = isOutside;
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
    let command: string | undefined;

    switch (zone) {
      case 'GREEN':
        warningMessage = '✅ Зона GREEN: Безопасный выпас (>20м до границы). Все триггеры выключены.';
        command = undefined;
        break;
      case 'YELLOW':
        warningMessage = `⚠️ Зона YELLOW: Предупреждение (${distanceToBorderMeters}м до границы). Включен звуковой сигнал (${toneFrequencyHz} Гц).`;
        command = 'WARNING_AUDIO';
        break;
      case 'ORANGE':
        warningMessage = `🟠 Зона ORANGE: Предграничная зона (${distanceToBorderMeters}м до границы). Включены звук (${toneFrequencyHz} Гц) и вибрация.`;
        command = 'PRE_BORDER_WARNING';
        break;
      case 'RED':
        warningMessage = `🚨 Зона RED: Выход за границу (${distanceToBorderMeters}м снаружи)! Включены звук (${toneFrequencyHz} Гц), вибрация и электростимуляция 400кВ.`;
        command = 'BREACH_ALERT';
        break;
      case 'ESCAPE':
        warningMessage = `🏃 Зона ESCAPE / Anti-Panic (${distanceToBorderMeters}м снаружи)! Электростимуляция отключена для предотвращения панического бега стада.`;
        command = 'ESCAPE_ALERT';
        break;
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
      buzzer: sound,
      sound,
      vibrate,
      vibrateDurationMs: vibrate ? 3000 : 0,
      shock,
      shockDurationMs: shock ? 150 : 0,
      warningMessage,
    };
  }
}

