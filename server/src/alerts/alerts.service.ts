import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AlertType, AlertSeverity, AlertStatus } from '@qamqor/shared';

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ==========================================
  // INGESTION EVENT HANDLERS
  // ==========================================

  async triggerGeofenceBreach(data: {
    farmId: string;
    animalId: string;
    animalName: string;
    deviceId: string;
    latitude: number;
    longitude: number;
  }) {
    const existing = await this.prisma.alert.findFirst({
      where: {
        animalId: data.animalId,
        type: AlertType.GEOFENCE_BREACH,
        status: AlertStatus.ACTIVE,
      },
    });

    if (existing) {
      this.logger.debug(`Active breach alert already exists for animal ${data.animalId}`);
      return existing;
    }

    this.logger.warn(`ALERT: Animal ${data.animalName} (${data.animalId}) exited geofence at [${data.latitude}, ${data.longitude}]`);

    return this.prisma.alert.create({
      data: {
        farmId: data.farmId,
        animalId: data.animalId,
        deviceId: data.deviceId,
        type: AlertType.GEOFENCE_BREACH,
        severity: AlertSeverity.CRITICAL,
        status: AlertStatus.ACTIVE,
        message: `Животное "${data.animalName}" покинуло границы пастбища! Координаты: ${data.latitude.toFixed(4)}, ${data.longitude.toFixed(4)}`,
        latitude: data.latitude,
        longitude: data.longitude,
      },
    });
  }

  async resolveGeofenceBreach(data: {
    farmId: string;
    animalId: string;
    animalName: string;
    deviceId: string;
    latitude: number;
    longitude: number;
  }) {
    const activeBreaches = await this.prisma.alert.findMany({
      where: {
        animalId: data.animalId,
        type: AlertType.GEOFENCE_BREACH,
        status: AlertStatus.ACTIVE,
      },
    });

    for (const alert of activeBreaches) {
      await this.prisma.alert.update({
        where: { id: alert.id },
        data: {
          status: AlertStatus.RESOLVED,
          resolvedAt: new Date(),
        },
      });
    }

    if (activeBreaches.length > 0) {
      this.logger.log(`Animal ${data.animalName} returned inside safe pasture.`);
      return this.prisma.alert.create({
        data: {
          farmId: data.farmId,
          animalId: data.animalId,
          deviceId: data.deviceId,
          type: AlertType.GEOFENCE_RETURN,
          severity: AlertSeverity.INFO,
          status: AlertStatus.RESOLVED,
          resolvedAt: new Date(),
          message: `Животное "${data.animalName}" вернулось в безопасную зону пастбища.`,
          latitude: data.latitude,
          longitude: data.longitude,
        },
      });
    }
  }

  // ==========================================
  // QUERY & RESOLUTION APIS
  // ==========================================

  async listAlerts(
    userId: string,
    farmId: string,
    filters?: {
      status?: AlertStatus;
      type?: AlertType;
      severity?: AlertSeverity;
      animalId?: string;
    },
  ) {

    const where: any = { farmId };

    if (filters?.status) where.status = filters.status;
    if (filters?.type) where.type = filters.type;
    if (filters?.severity) where.severity = filters.severity;
    if (filters?.animalId) where.animalId = filters.animalId;

    return this.prisma.alert.findMany({
      where,
      include: {
        animal: {
          select: { id: true, name: true, tagNumber: true, species: true },
        },
        device: {
          select: { id: true, deviceId: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async updateAlertStatus(
    userId: string,
    farmId: string,
    alertId: string,
    status: AlertStatus,
  ) {

    const alert = await this.prisma.alert.findFirst({
      where: { id: alertId, farmId },
    });

    if (!alert) {
      throw new NotFoundException('Оповещение не найдено');
    }

    return this.prisma.alert.update({
      where: { id: alertId },
      data: {
        status,
        ...(status === AlertStatus.RESOLVED && { resolvedAt: new Date() }),
      },
    });
  }

  async getAlertStats(userId: string, farmId: string) {

    const [activeTotal, activeBreaches] = await Promise.all([
      this.prisma.alert.count({
        where: { farmId, status: AlertStatus.ACTIVE },
      }),
      this.prisma.alert.count({
        where: {
          farmId,
          status: AlertStatus.ACTIVE,
          type: AlertType.GEOFENCE_BREACH,
        },
      }),
    ]);

    return {
      activeTotal,
      activeBreaches,
    };
  }
}
