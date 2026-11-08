import {
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AlertStatus, DeviceStatus } from '@prisma/client';

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
      this.prisma.device.count({ where: { farmId, status: DeviceStatus.ONLINE } }),

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
        include: {
          animal: { select: { name: true, tagNumber: true, species: true } },
        },
      }),

      // Animals for quick map rendering
      this.prisma.animal.findMany({
        where: { farmId },
        select: {
          id: true,
          name: true,
          tagNumber: true,
          species: true,
          gender: true,
          isOutsideGeofence: true,
          lastLatitude: true,
          lastLongitude: true,
          lastAccuracy: true,
          lastSeenAt: true,
          device: {
            select: {
              deviceId: true,
              signal: true,
              status: true,
            },
          },
          activeGeofence: {
            select: {
              id: true,
              name: true,
              color: true,
            },
          },
        },
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
      recentAlerts,
      liveAnimals,
    };
  }
}

