import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GeofenceStatus } from '@qamqor/shared';
import { VirtualFenceZone } from '@qamqor/contracts';
import { CreateGeofenceInputDto, UpdateGeofenceInputDto } from './dto/geofence.dto';

@Injectable()
export class GeofenceService {
  private readonly logger = new Logger(GeofenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async verifyFarmAccess(userId: string, farmId: string) {
    const membership = await this.prisma.farmMember.findUnique({
      where: { userId_farmId: { userId, farmId } },
    });
    if (!membership) {
      throw new ForbiddenException('У вас нет доступа к этому хозяйству');
    }
  }

  // ==========================================
  // SPATIAL COMPUTATIONS
  // ==========================================

  /**
   * Ray-casting algorithm to determine if a point (lat, lng) is inside a GeoJSON Polygon
   * coordinates: [[[lng, lat], [lng, lat], ...]]
   */
  isPointInPolygon(point: { latitude: number; longitude: number }, polygonGeoJson: any): boolean {
    if (!polygonGeoJson || !polygonGeoJson.coordinates || !Array.isArray(polygonGeoJson.coordinates)) {
      return true; // No boundary configured, assume inside safe zone
    }

    const ring = polygonGeoJson.coordinates[0]; // Exterior ring
    if (!ring || ring.length < 3) {
      return true;
    }

    const x = point.longitude;
    const y = point.latitude;
    let inside = false;

    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0];
      const yi = ring[i][1];
      const xj = ring[j][0];
      const yj = ring[j][1];

      const intersect =
        yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (intersect) {
        inside = !inside;
      }
    }

    return inside;
  }

  /**
   * Calculates the minimum distance in meters from a point (latitude, longitude)
   * to the closest segment of a GeoJSON Polygon perimeter.
   * Uses equirectangular Cartesian segment projection algorithm.
   */
  distanceToPolygonEdgeMeters(
    point: { latitude: number; longitude: number },
    polygonGeoJson: any,
  ): number {
    if (!polygonGeoJson) {
      return Infinity;
    }

    let coordinates = polygonGeoJson.coordinates;
    if (polygonGeoJson.geometry?.coordinates) {
      coordinates = polygonGeoJson.geometry.coordinates;
    }

    if (!coordinates || !Array.isArray(coordinates) || coordinates.length === 0) {
      return Infinity;
    }

    const ring = coordinates[0];
    if (!ring || !Array.isArray(ring) || ring.length < 2) {
      return Infinity;
    }

    const R = 6371000; // Mean Earth radius in meters
    const latRad = (point.latitude * Math.PI) / 180;
    const cosLat = Math.cos(latRad);

    const degToRad = Math.PI / 180;
    const toMeterX = degToRad * R * cosLat;
    const toMeterY = degToRad * R;

    let minDistanceSq = Infinity;
    const numPoints = ring.length;

    for (let i = 0; i < numPoints; i++) {
      const p1 = ring[i];
      const p2 = ring[(i + 1) % numPoints];

      if (!p1 || !p2 || (p1[0] === p2[0] && p1[1] === p2[1])) {
        continue;
      }

      // GeoJSON coordinates are [longitude, latitude]
      const x1 = (p1[0] - point.longitude) * toMeterX;
      const y1 = (p1[1] - point.latitude) * toMeterY;
      const x2 = (p2[0] - point.longitude) * toMeterX;
      const y2 = (p2[1] - point.latitude) * toMeterY;

      const dx = x2 - x1;
      const dy = y2 - y1;
      const lenSq = dx * dx + dy * dy;

      let distSq: number;
      if (lenSq === 0) {
        distSq = x1 * x1 + y1 * y1;
      } else {
        const t = Math.max(0, Math.min(1, -(x1 * dx + y1 * dy) / lenSq));
        const projX = x1 + t * dx;
        const projY = y1 + t * dy;
        distSq = projX * projX + projY * projY;
      }

      if (distSq < minDistanceSq) {
        minDistanceSq = distSq;
      }
    }

    if (minDistanceSq === Infinity) {
      return Infinity;
    }

    return Math.sqrt(minDistanceSq);
  }

  /**
   * Evaluates geofence status and 4-zone livestock steering parameters:
   * - Green Zone (>20m inside): safe, all triggers off.
   * - Yellow Zone (5m to 20m inside): warning audio siren (scaled frequency: 800 - 1600 Hz).
   * - Orange Zone (0m to 5m inside): pre-border warning (audio siren 1600 - 2400 Hz + vibration).
   * - Red Zone (0m to 100m outside): active breach (audio 2400 Hz + vibration + shock).
   * - Escape / Anti-Panic (speed > 15 km/h or >100m outside): disarm shock to prevent stampede distress.
   */
  evaluateLocation(
    point: { latitude: number; longitude: number; accuracy: number; speed?: number },
    polygonGeoJson: any,
  ): {
    status: GeofenceStatus;
    isReliable: boolean;
    distanceMeters: number;
    zone: 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED' | 'ESCAPE';
    toneFrequencyHz: number;
  } {
    // If accuracy is poor (> 35 meters), mark as unreliable to prevent false breach alerts
    const isReliable = point.accuracy <= 35;

    if (!polygonGeoJson) {
      return {
        status: GeofenceStatus.INSIDE,
        isReliable,
        distanceMeters: 9999,
        zone: 'GREEN',
        toneFrequencyHz: 0,
      };
    }

    const inside = this.isPointInPolygon(point, polygonGeoJson);
    const rawDistance = this.distanceToPolygonEdgeMeters(point, polygonGeoJson);
    const distanceMeters = rawDistance === Infinity ? 9999 : Math.round(rawDistance * 10) / 10;

    let zone: 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED' | 'ESCAPE';
    let toneFrequencyHz = 0;

    if (inside) {
      if (distanceMeters > 20) {
        zone = 'GREEN';
        toneFrequencyHz = 0;
      } else if (distanceMeters > 5) {
        zone = 'YELLOW';
        toneFrequencyHz = Math.max(
          800,
          Math.min(1600, 800 + Math.round(((20 - distanceMeters) / 15) * 800)),
        );
      } else {
        zone = 'ORANGE';
        toneFrequencyHz = Math.max(
          1600,
          Math.min(2400, 1600 + Math.round(((5 - distanceMeters) / 5) * 800)),
        );
      }
    } else {
      // Escape condition: speed > 15 km/h or > 100m outside
      if (distanceMeters > 100 || (point.speed !== undefined && point.speed > 15)) {
        zone = 'ESCAPE';
        toneFrequencyHz = 0;
      } else {
        zone = 'RED';
        toneFrequencyHz = 2400;
      }
    }

    return {
      status: inside ? GeofenceStatus.INSIDE : GeofenceStatus.OUTSIDE,
      isReliable,
      distanceMeters,
      zone,
      toneFrequencyHz,
    };
  }

  // ==========================================
  // CRUD OPERATIONS
  // ==========================================

  async listGeofences(userId: string, farmId: string) {
    await this.verifyFarmAccess(userId, farmId);

    const geofences = await this.prisma.geofence.findMany({
      where: { farmId },
      include: {
        _count: {
          select: { animals: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return geofences.map((g) => ({
      ...g,
      animalsCount: g._count.animals,
    }));
  }

  async getGeofenceById(userId: string, farmId: string, geofenceId: string) {
    await this.verifyFarmAccess(userId, farmId);

    const geofence = await this.prisma.geofence.findFirst({
      where: { id: geofenceId, farmId },
      include: {
        animals: {
          select: {
            id: true,
            name: true,
            tagNumber: true,
            species: true,
            isOutsideGeofence: true,
            lastLatitude: true,
            lastLongitude: true,
          },
        },
      },
    });

    if (!geofence) {
      throw new NotFoundException('Геозона (пастбище) не найдена');
    }

    return geofence;
  }

  async createGeofence(userId: string, farmId: string, dto: CreateGeofenceInputDto) {
    await this.verifyFarmAccess(userId, farmId);

    const geofence = await this.prisma.geofence.create({
      data: {
        farmId,
        name: dto.name.trim(),
        description: dto.description?.trim(),
        color: dto.color || '#10B981',
        polygonJson: dto.polygonJson as any,
      },
    });

    if (dto.animalIds && Array.isArray(dto.animalIds) && dto.animalIds.length > 0) {
      await this.prisma.animal.updateMany({
        where: { id: { in: dto.animalIds }, farmId },
        data: { activeGeofenceId: geofence.id },
      });
    }

    return this.getGeofenceById(userId, farmId, geofence.id);
  }

  async updateGeofence(
    userId: string,
    farmId: string,
    geofenceId: string,
    dto: UpdateGeofenceInputDto,
  ) {
    await this.verifyFarmAccess(userId, farmId);

    const geofence = await this.prisma.geofence.findFirst({
      where: { id: geofenceId, farmId },
    });

    if (!geofence) {
      throw new NotFoundException('Геозона не найдена');
    }

    const updated = await this.prisma.geofence.update({
      where: { id: geofenceId },
      data: {
        ...(dto.name && { name: dto.name.trim() }),
        ...(dto.description !== undefined && { description: dto.description?.trim() }),
        ...(dto.color && { color: dto.color }),
        ...(dto.polygonJson && { polygonJson: dto.polygonJson as any }),
      },
    });

    if (dto.animalIds && Array.isArray(dto.animalIds)) {
      // Unassign existing
      await this.prisma.animal.updateMany({
        where: { activeGeofenceId: geofenceId, farmId },
        data: { activeGeofenceId: null },
      });
      // Assign new
      if (dto.animalIds.length > 0) {
        await this.prisma.animal.updateMany({
          where: { id: { in: dto.animalIds }, farmId },
          data: { activeGeofenceId: geofenceId },
        });
      }
    }

    return this.getGeofenceById(userId, farmId, geofenceId);
  }

  async deleteGeofence(userId: string, farmId: string, geofenceId: string) {
    await this.verifyFarmAccess(userId, farmId);

    const geofence = await this.prisma.geofence.findFirst({
      where: { id: geofenceId, farmId },
    });

    if (!geofence) {
      throw new NotFoundException('Геозона не найдена');
    }

    // Unassign animals
    await this.prisma.animal.updateMany({
      where: { activeGeofenceId: geofenceId },
      data: { activeGeofenceId: null },
    });

    return this.prisma.geofence.delete({
      where: { id: geofenceId },
    });
  }
}
