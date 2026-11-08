import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TelemetryService } from '../telemetry/telemetry.service';
import { InjectTelemetryDto } from './dto/mock.dto';
import { DeviceStatus } from '@prisma/client';
import { generateDeviceSecret, hashDeviceSecret } from '../devices/device-secret';

@Injectable()
export class MockService {
  private readonly logger = new Logger(MockService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telemetryService: TelemetryService,
  ) {}

  /**
   * 1. Manually inject GPS telemetry from website interface
   */
  async injectManualTelemetry(userId: string, farmId: string, dto: InjectTelemetryDto) {

    // Look up by animalId or deviceId
    const animal = await this.prisma.animal.findFirst({
      where: {
        farmId,
        OR: [{ id: dto.animalId }, { device: { deviceId: dto.animalId } }],
      },
      include: {
        device: true,
        activeGeofence: true,
      },
    });

    if (!animal) {
      throw new NotFoundException(`Животное "${dto.animalId}" не найдено`);
    }

    let device = animal.device;

    // The simulator never touches real collars.
    if (device && !device.isSimulated) {
      throw new ForbiddenException('Симулятор работает только с симулированными ошейниками');
    }

    // If animal has no device assigned, create a simulated collar (random secret, only its hash is stored).
    if (!device) {
      const mockDeviceId = `QAM-MOCK-${animal.tagNumber.replace(/[^a-zA-Z0-9]/g, '')}`;
      const clash = await this.prisma.device.findUnique({ where: { deviceId: mockDeviceId } });
      if (clash && !clash.isSimulated) {
        throw new ForbiddenException('Симулятор работает только с симулированными ошейниками');
      }
      device = await this.prisma.device.upsert({
        where: { deviceId: mockDeviceId },
        update: { animalId: animal.id, farmId },
        create: {
          deviceId: mockDeviceId,
          secretHash: hashDeviceSecret(generateDeviceSecret()),
          isSimulated: true,
          animalId: animal.id,
          farmId,
          status: DeviceStatus.ONLINE,
        },
      });
    }

    const previousState = {
      isOutsideGeofence: animal.isOutsideGeofence,
      latitude: animal.lastLatitude,
      longitude: animal.lastLongitude,
    };

    // Process through the actual telemetry engine!
    const fullDevice = await this.prisma.device.findUnique({
      where: { id: device.id },
      include: { farm: true, animal: { include: { activeGeofence: true } } },
    });
    const response = await this.telemetryService.processDeviceTelemetry(
      fullDevice,
      {
        deviceId: device.deviceId,
        timestamp: new Date().toISOString(),
        latitude: dto.latitude,
        longitude: dto.longitude,
        accuracy: dto.accuracy ?? 3.5,
        signal: dto.signal ?? -68,
      },
    );

    // Fetch updated animal state
    const updatedAnimal = await this.prisma.animal.findUnique({
      where: { id: animal.id },
      include: { device: true },
    });

    return {
      success: true,
      mode: 'MANUAL_INJECTION',
      deviceId: device.deviceId,
      animalName: animal.name,
      tagNumber: animal.tagNumber,
      previousState,
      newState: {
        isOutsideGeofence: updatedAnimal?.isOutsideGeofence,
        latitude: updatedAnimal?.lastLatitude,
        longitude: updatedAnimal?.lastLongitude,
      },
      collarResponse: response,
      serverNextInterval: response.nextInterval,
      message: updatedAnimal?.isOutsideGeofence
        ? `🚨 Животное "${animal.name}" вышло за границы пастбища! На ошейник отправлена команда ВИБРАЦИИ.`
        : `✅ Животное "${animal.name}" находится внутри пастбища. Вибрация отключена.`,
    };
  }

  /**
   * 2. One-click button: Simulate animal escaping outside pasture
   */
  async simulateBreach(userId: string, farmId: string, animalId: string) {

    const animal = await this.prisma.animal.findFirst({
      where: { id: animalId, farmId },
      include: { activeGeofence: true, device: true },
    });

    if (!animal) {
      throw new NotFoundException('Животное не найдено');
    }

    // Determine an escape coordinate outside pasture
    let breachLat = 43.6650;
    let breachLng = 51.1750;

    if (animal.activeGeofence?.polygonJson) {
      const geo = animal.activeGeofence.polygonJson as any;
      if (geo.coordinates && geo.coordinates[0] && geo.coordinates[0].length > 0) {
        const ring = geo.coordinates[0];
        // Take maximum lat/lng and add 0.015 (~1.5 km out)
        const maxLat = Math.max(...ring.map((p: number[]) => p[1]));
        const maxLng = Math.max(...ring.map((p: number[]) => p[0]));
        breachLat = parseFloat((maxLat + 0.012).toFixed(6));
        breachLng = parseFloat((maxLng + 0.012).toFixed(6));
      }
    }

    return this.injectManualTelemetry(userId, farmId, {
      animalId: animal.id,
      latitude: breachLat,
      longitude: breachLng,
    });
  }

  /**
   * 3. One-click button: Return animal back inside pasture
   */
  async simulateReturn(userId: string, farmId: string, animalId: string) {

    const animal = await this.prisma.animal.findFirst({
      where: { id: animalId, farmId },
      include: { activeGeofence: true, device: true },
    });

    if (!animal) {
      throw new NotFoundException('Животное не найдено');
    }

    // Determine center coordinate inside pasture
    let safeLat = 43.6500;
    let safeLng = 51.1570;

    if (animal.activeGeofence?.polygonJson) {
      const geo = animal.activeGeofence.polygonJson as any;
      if (geo.coordinates && geo.coordinates[0] && geo.coordinates[0].length > 0) {
        const ring = geo.coordinates[0];
        const avgLat = ring.reduce((sum: number, p: number[]) => sum + p[1], 0) / ring.length;
        const avgLng = ring.reduce((sum: number, p: number[]) => sum + p[0], 0) / ring.length;
        safeLat = parseFloat(avgLat.toFixed(6));
        safeLng = parseFloat(avgLng.toFixed(6));
      }
    }

    return this.injectManualTelemetry(userId, farmId, {
      animalId: animal.id,
      latitude: safeLat,
      longitude: safeLng,
    });
  }
}
