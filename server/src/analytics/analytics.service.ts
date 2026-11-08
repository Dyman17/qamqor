import {
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AlertStatus } from '@prisma/client';
import { offlineThresholdMs } from '../devices/connectivity';
import { ALERT_INCLUDE, toAlertDto } from '../alerts/mappers';
import { ANIMAL_INCLUDE, toAnimalDto } from '../animals/mappers';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(userId: string, farmId: string) {

    const [
      totalAnimals,
      outsideGeofence,
      totalDevices,
      onlineDevices,
      activeAlertsCount,
      speciesRaw,
      recentAlerts,
      liveAnimals,
    ] = await Promise.all([
      // Total animals
      this.prisma.animal.count({ where: { farmId } }),

      // Animals outside geofence
      this.prisma.animal.count({ where: { farmId, isOutsideGeofence: true } }),

      // Devices
      this.prisma.device.count({ where: { farmId } }),
      // Online = heard within the offline threshold (derived from the last ping, not the stored status).
      this.prisma.device.count({
        where: { farmId, lastHeartbeatAt: { gte: new Date(Date.now() - offlineThresholdMs()) } },
      }),

      // Active alerts
      this.prisma.alert.count({ where: { farmId, status: AlertStatus.ACTIVE } }),

      // Group by species
      this.prisma.animal.groupBy({
        by: ['species'],
        where: { farmId },
        _count: { id: true },
      }),

      // Recent 5 alerts
      this.prisma.alert.findMany({
        where: { farmId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: ALERT_INCLUDE,
      }),

      // Animals for quick map rendering
      this.prisma.animal.findMany({
        where: { farmId },
        include: ANIMAL_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      }),
    ]);

    const speciesBreakdown = speciesRaw.reduce(
      (acc, curr) => {
        acc[curr.species] = curr._count.id;
        return acc;
      },
      {} as Record<string, number>,
    );

    return {
      stats: {
        totalAnimals,
        insideGeofence: totalAnimals - outsideGeofence,
        outsideGeofence,
        totalDevices,
        onlineDevices,
        offlineDevices: totalDevices - onlineDevices,
        activeAlertsCount,
      },
      speciesBreakdown,
      recentAlerts: recentAlerts.map(toAlertDto),
      liveAnimals: liveAnimals.map((a) => toAnimalDto(a)),
    };
  }
}

