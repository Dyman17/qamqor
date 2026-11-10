import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { CollarControlMode } from '@qamqor/shared';
import { PrismaService } from '../prisma/prisma.service';
import { GeofenceService } from '../geofences/geofence.service';
import { AlertsService } from '../alerts/alerts.service';
import { computePulseThreat } from '../animals/pulse-analysis';
import { COLLAR_SELECT, toCollarDto } from '../devices/devices.service';
import { TelemetryService, TelemetryStreamEvent, ZoneName } from './telemetry.service';
import { leaveGpsManual } from '../devices/control-mode';

export interface ManualPositionResult {
  deviceId: string;
  controlMode: 'GPS_MANUAL';
  positionSource: 'MANUAL';
  position: { latitude: number; longitude: number; at: string };
  zone: ZoneName;
  inFence: boolean | null;
  distanceToBorderMeters: number | null;
}

/**
 * Operator control of a real collar: the control mode and, in GPS_MANUAL, the animal's dragged position.
 * Signals are never queued or delivered here: the zone signals go out only in the collar's own telemetry
 * reply (see TelemetryService.processDeviceTelemetry), which sees the manual position stored here.
 */
@Injectable()
export class CollarControlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geofence: GeofenceService,
    private readonly alerts: AlertsService,
    private readonly telemetry: TelemetryService,
  ) {}

  /** A real (non-simulated) collar of this farm that is attached to an animal. */
  private async loadControllable(farmId: string, deviceId: string): Promise<any> {
    const device: any = await this.prisma.device.findFirst({
      where: { deviceId, farmId },
      include: { animal: { include: { activeGeofence: true } } },
    });
    if (!device) throw new NotFoundException(`Устройство "${deviceId}" не найдено`);
    if (device.isSimulated) throw new ConflictException('Режимы управления доступны только для реальных ошейников');
    if (!device.animal) throw new ConflictException('Ошейник не привязан к животному');
    return device;
  }

  /** Switches the mode. Leaving GPS_MANUAL clears the manual position. */
  async setControlMode(farmId: string, deviceId: string, mode: CollarControlMode) {
    const device = await this.loadControllable(farmId, deviceId);
    const stayingManual = device.controlMode === 'GPS_MANUAL' && mode === 'GPS_MANUAL';
    if (mode === 'GPS_MANUAL' && !stayingManual && device.farmId) {
      // GPS alerts are not raised in GPS_MANUAL: close one that is still open.
      await this.alerts.resolveGpsLost(device.animal.id);
    }
    const now = new Date();
    const entering = mode !== 'AUTO' && device.controlMode !== mode;
    const updated = await this.prisma.device.update({
      where: { id: device.id },
      data: {
        controlMode: mode,
        ...(!stayingManual && { manualLatitude: null, manualLongitude: null, manualPositionAt: null }),
        // Operator activity: the non-AUTO mode lapses CONTROL_MODE_TTL_MIN after the last one.
        controlModeSince: mode === 'AUTO' ? null : entering ? now : (device.controlModeSince ?? now),
        controlActivityAt: mode === 'AUTO' ? null : now,
      },
      select: COLLAR_SELECT,
    });
    if (device.controlMode === 'GPS_MANUAL' && mode !== 'GPS_MANUAL') {
      // The animal still carries the dragged point and the server time of the last drag: restore the last
      // real fix so the next real ping is not mistaken for a stale one.
      await leaveGpsManual(this.prisma, device.deviceId, device.animal.id);
    }
    return toCollarDto(updated);
  }

  /**
   * Moves the animal to the dragged point: zone, animal position, breach alert and a stream event for
   * every open map of the farm. 409 unless the collar is in GPS_MANUAL.
   */
  async setManualPosition(farmId: string, deviceId: string, latitude: number, longitude: number): Promise<ManualPositionResult> {
    const device = await this.loadControllable(farmId, deviceId);
    if (device.controlMode !== 'GPS_MANUAL') {
      throw new ConflictException('Ручная позиция доступна только в режиме GPS_MANUAL');
    }
    const animal = device.animal;
    const evaluation = this.geofence.evaluateLocation(
      { latitude, longitude, accuracy: 0, speed: 0 },
      animal.activeGeofence?.polygonJson ?? null,
    );
    const zone = evaluation.zone as ZoneName;
    const prevOutside: boolean = animal.isOutsideGeofence ?? false;
    let isOutside = prevOutside;
    let inFence: boolean | null = null;
    if (zone !== 'UNKNOWN') {
      inFence = !(zone === 'RED' || zone === 'ESCAPE');
      isOutside = !inFence;
    }
    const now = new Date();
    const nowMs = now.getTime();

    await this.prisma.device.update({
      where: { id: device.id },
      data: { manualLatitude: latitude, manualLongitude: longitude, manualPositionAt: now, controlActivityAt: now },
    });
    await this.prisma.animal.update({
      where: { id: animal.id },
      data: { lastLatitude: latitude, lastLongitude: longitude, lastAccuracy: 0, lastSeenAt: now, isOutsideGeofence: isOutside },
    });

    // Alerts on the transitions only (the ping path re-checks an outside animal every 15 s).
    if (device.farmId && zone !== 'UNKNOWN') {
      const base = {
        farmId: device.farmId,
        animalId: animal.id,
        animalName: animal.name,
        deviceId: device.deviceId,
        latitude,
        longitude,
        isDemo: !!animal.isDemo,
      };
      if (isOutside && !prevOutside) await this.alerts.triggerGeofenceBreach({ ...base, freshBreach: true });
      else if (!isOutside && prevOutside) await this.alerts.resolveGeofenceBreach(base);
    }

    const hr = TelemetryService.freshStoredHeartRate(animal, nowMs);
    const event: TelemetryStreamEvent = {
      farmId: device.farmId ?? null,
      deviceId: device.deviceId,
      code: device.code ?? null,
      animalId: animal.id,
      animalName: animal.name ?? null,
      heartRate: hr?.value ?? null,
      lastHeartRateAt: hr?.at ?? null,
      pulseThreat: computePulseThreat(animal.species, hr?.value ?? null),
      latitude,
      longitude,
      accuracyM: 0,
      zone,
      inFence,
      distanceToBorderMeters: evaluation.distanceMeters,
      sound: false, // signals leave only in the collar's telemetry reply
      vibrate: false,
      lastSeenAt: now.toISOString(),
      serverTime: now.toISOString(),
      rssi: device.signal ?? null,
      controlMode: 'GPS_MANUAL',
      positionSource: 'MANUAL',
    };
    this.telemetry.publishEvent(event);

    return {
      deviceId: device.deviceId,
      controlMode: 'GPS_MANUAL',
      positionSource: 'MANUAL',
      position: { latitude, longitude, at: now.toISOString() },
      zone,
      inFence,
      distanceToBorderMeters: evaluation.distanceMeters,
    };
  }
}
