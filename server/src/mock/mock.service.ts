import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TelemetryService } from '../telemetry/telemetry.service';
import { CameraService } from '../camera/camera.service';
import { InjectTelemetryDto, InjectPhotoDto } from './dto/mock.dto';
import { DeviceStatus } from '@prisma/client';

@Injectable()
export class MockService {
  private readonly logger = new Logger(MockService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telemetryService: TelemetryService,
    private readonly cameraService: CameraService,
  ) {}

  private async verifyFarmAccess(userId: string, farmId: string) {
    const membership = await this.prisma.farmMember.findUnique({
      where: { userId_farmId: { userId, farmId } },
    });
    if (!membership) {
      throw new ForbiddenException('У вас нет доступа к этому хозяйству');
    }
  }

  /**
   * 1. Manually inject GPS telemetry & battery from website interface
   */
  async injectManualTelemetry(userId: string, farmId: string, dto: InjectTelemetryDto) {
    await this.verifyFarmAccess(userId, farmId);

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

    // If animal has no device assigned, auto-create a mock test collar!
    if (!device) {
      const mockDeviceId = `QAM-MOCK-${animal.tagNumber.replace(/[^a-zA-Z0-9]/g, '')}`;
      device = await this.prisma.device.upsert({
        where: { deviceId: mockDeviceId },
        update: { animalId: animal.id, farmId },
        create: {
          deviceId: mockDeviceId,
          secretKey: 'qamqor_esp32_device_shared_key_2026',
          animalId: animal.id,
          farmId,
          status: DeviceStatus.ONLINE,
          battery: dto.battery ?? 90,
        },
      });
    }

    const previousState = {
      isOutsideGeofence: animal.isOutsideGeofence,
      latitude: animal.lastLatitude,
      longitude: animal.lastLongitude,
    };

    // Process through the actual telemetry engine!
    const response = await this.telemetryService.processDeviceTelemetry(
      device.secretKey,
      {
        deviceId: device.deviceId,
        timestamp: new Date().toISOString(),
        latitude: dto.latitude,
        longitude: dto.longitude,
        accuracy: dto.accuracy ?? 3.5,
        battery: dto.battery ?? device.battery,
        signal: dto.signal ?? -68,
      },
    );

    // Save manual override so any subsequent ESP32 requests reflect this manual test!
    this.telemetryService.setManualOverride(device.deviceId, {
      latitude: dto.latitude,
      longitude: dto.longitude,
      isOutside: response.vibrate || false,
      active: true,
    });

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
        battery: updatedAnimal?.device?.battery,
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
    await this.verifyFarmAccess(userId, farmId);

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
      battery: animal.device?.battery ?? 85,
    });
  }

  /**
   * 3. One-click button: Return animal back inside pasture
   */
  async simulateReturn(userId: string, farmId: string, animalId: string) {
    await this.verifyFarmAccess(userId, farmId);

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
      battery: animal.device?.battery ?? 85,
    });
  }

  /**
   * 4. Inject a test photo snapshot from the website (camera simulator)
   */
  async injectPhoto(userId: string, farmId: string, dto: InjectPhotoDto) {
    await this.verifyFarmAccess(userId, farmId);

    const animal = await this.prisma.animal.findFirst({
      where: { id: dto.animalId, farmId },
      include: { device: true },
    });

    if (!animal) {
      throw new NotFoundException('Животное не найдено');
    }

    let deviceId = animal.device?.deviceId;
    if (!deviceId) {
      deviceId = `QAM-MOCK-${animal.tagNumber.replace(/[^a-zA-Z0-9]/g, '')}`;
      await this.prisma.device.upsert({
        where: { deviceId },
        update: { animalId: animal.id, farmId },
        create: {
          deviceId,
          secretKey: 'qamqor_esp32_device_shared_key_2026',
          animalId: animal.id,
          farmId,
          status: DeviceStatus.ONLINE,
        },
      });
    }

    // Generate simulated camera frame
    const timeStr = new Date().toLocaleString('kk-KZ', { timeZone: 'Asia/Almaty' });
    const animalTitle = `${animal.species} — "${animal.name}" (${animal.tagNumber})`;

    const svgContent = `
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  <defs>
    <linearGradient id="sky" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#38bdf8" />
      <stop offset="100%" stop-color="#bae6fd" />
    </linearGradient>
    <linearGradient id="steppe" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#84cc16" />
      <stop offset="100%" stop-color="#4d7c0f" />
    </linearGradient>
  </defs>
  <!-- Background Steppe Landscape -->
  <rect width="800" height="340" fill="url(#sky)" />
  <ellipse cx="680" cy="100" rx="45" ry="45" fill="#fde047" opacity="0.9" />
  <rect y="320" width="800" height="280" fill="url(#steppe)" />
  
  <!-- Steppe hills -->
  <path d="M0,340 Q200,280 400,340 T800,330 L800,600 L0,600 Z" fill="#65a30d" opacity="0.8"/>
  <path d="M0,370 Q300,320 600,370 T800,360 L800,600 L0,600 Z" fill="#4d7c0f"/>

  <!-- ESP32-CAM Collar Overlay HUD -->
  <rect x="20" y="20" width="760" height="60" rx="8" fill="#0f172a" opacity="0.85" />
  <text x="40" y="45" fill="#38bdf8" font-family="sans-serif" font-weight="bold" font-size="16">📹 QAMQOR SMART COLLAR ESP32-CAM [LIVE SNAPSHOT]</text>
  <text x="40" y="66" fill="#94a3b8" font-family="monospace" font-size="13">Device: ${deviceId} | Lat: ${(animal.lastLatitude || 43.65).toFixed(4)} N | Lng: ${(animal.lastLongitude || 51.15).toFixed(4)} E | ${timeStr}</text>

  <!-- Crosshair center -->
  <circle cx="400" cy="300" r="30" stroke="#10b981" stroke-width="2" fill="none" opacity="0.6"/>
  <line x1="400" y1="260" x2="400" y2="340" stroke="#10b981" stroke-width="2" opacity="0.6"/>
  <line x1="360" y1="300" x2="440" y2="300" stroke="#10b981" stroke-width="2" opacity="0.6"/>

  <!-- Animal Card bottom HUD -->
  <rect x="20" y="520" width="760" height="60" rx="8" fill="#0f172a" opacity="0.85" />
  <text x="40" y="546" fill="#10b981" font-family="sans-serif" font-weight="bold" font-size="18">${animalTitle}</text>
  <text x="40" y="567" fill="#cbd5e1" font-family="sans-serif" font-size="13">Статус: ${animal.isOutsideGeofence ? '🚨 ВНЕ ПАСТБИЩА' : '🌿 ВНУТРИ ПАСТБИЩА'} | Заряд батареи: ${animal.device?.battery || 95}%</text>
</svg>
    `.trim();

    return this.cameraService.saveSnapshot('qamqor_esp32_device_shared_key_2026', {
      deviceId,
      trigger: 'MOCK_TEST',
      fileBuffer: Buffer.from(svgContent, 'utf-8'),
    });
  }
}

