import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { assertSameFarm } from '../farms/same-farm';
import { PrismaService } from '../prisma/prisma.service';
import { GeofenceStatus } from '@qamqor/shared';
import { exteriorRing, polygonProblem, polygonAreaHa } from './polygon';
import { CreateGeofenceInputDto, UpdateGeofenceInputDto } from './dto/geofence.dto';

export interface PenDto {
  id: string;
  farmId: string;
  name: string;
  color: string;
  polygon: any;
  animalsCount: number;
  areaHa: number;
}

export function toPenDto(g: any, animalsCount?: number): PenDto {
  return {
    id: g.id,
    farmId: g.farmId,
    name: g.name,
    color: g.color,
    polygon: g.polygonJson,
    animalsCount: animalsCount ?? g._count?.animals ?? 0,
    areaHa: polygonAreaHa(g.polygonJson),
  };
}

@Injectable()
export class GeofenceService {
  private readonly logger = new Logger(GeofenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ==========================================
  // SPATIAL COMPUTATIONS
  // ==========================================

  /**
   * Ray-casting algorithm to determine if a point (lat, lng) is inside a GeoJSON Polygon
   * coordinates: [[[lng, lat], [lng, lat], ...]]
   * Fail-closed: a missing or malformed boundary is NEVER "inside" (callers must treat it as UNKNOWN).
   */
  isPointInPolygon(point: { latitude: number; longitude: number }, polygonGeoJson: any): boolean {
    const ring = exteriorRing(polygonGeoJson);
    if (!ring || ring.length < 4) {
      return false;
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
   * - Red Zone (0m to 100m outside): active breach (audio 2400 Hz + vibration).
   * - Escape / Anti-Panic (speed > 15 km/h or >100m outside): signals disarmed to prevent stampede distress.
   * - UNKNOWN (fail-closed): no boundary, malformed boundary or unreliable fix (> 35 m). Never GREEN,
   *   never any signal; `reason` says why.
   * The impulse is never produced by the server.
   */
  evaluateLocation(
    point: { latitude: number; longitude: number; accuracy: number; speed?: number },
    polygonGeoJson: any,
  ): {
    status: GeofenceStatus;
    isReliable: boolean;
    distanceMeters: number | null;
    zone: 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED' | 'ESCAPE' | 'UNKNOWN';
    toneFrequencyHz: number;
    reason: null | 'NO_BOUNDARY' | 'INVALID_BOUNDARY' | 'LOW_ACCURACY';
  } {
    // If accuracy is poor (> 35 meters), mark as unreliable to prevent false breach alerts
    const isReliable = point.accuracy <= 35;

    const unknown = (reason: 'NO_BOUNDARY' | 'INVALID_BOUNDARY' | 'LOW_ACCURACY') => ({
      status: GeofenceStatus.UNKNOWN,
      isReliable,
      distanceMeters: null,
      zone: 'UNKNOWN' as const,
      toneFrequencyHz: 0,
      reason,
    });

    if (!polygonGeoJson) return unknown('NO_BOUNDARY');
    if (polygonProblem(polygonGeoJson) !== null) return unknown('INVALID_BOUNDARY');
    if (!isReliable) return unknown('LOW_ACCURACY');

    const inside = this.isPointInPolygon(point, polygonGeoJson);
    const rawDistance = this.distanceToPolygonEdgeMeters(point, polygonGeoJson);
    if (!Number.isFinite(rawDistance)) return unknown('INVALID_BOUNDARY');
    const distanceMeters = Math.round(rawDistance * 10) / 10;

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
      reason: null,
    };
  }

  // ==========================================
  // CRUD OPERATIONS
  // ==========================================

  async listGeofences(userId: string, farmId: string): Promise<PenDto[]> {
    const geofences = await this.prisma.geofence.findMany({
      where: { farmId },
      include: { _count: { select: { animals: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
    return geofences.map((g) => toPenDto(g));
  }

  async getGeofenceById(userId: string, farmId: string, geofenceId: string): Promise<PenDto & { animalIds: string[] }> {
    const geofence = await this.prisma.geofence.findFirst({
      where: { id: geofenceId, farmId },
      include: { animals: { select: { id: true } } },
    });
    if (!geofence) {
      throw new NotFoundException('Геозона (пастбище) не найдена');
    }
    return { ...toPenDto(geofence, geofence.animals.length), animalIds: geofence.animals.map((a) => a.id) };
  }

  async createGeofence(userId: string, farmId: string, dto: CreateGeofenceInputDto) {
    await assertSameFarm(this.prisma, farmId, { animalIds: dto.animalIds });

    const geofenceId = await this.prisma.$transaction(async (tx) => {
      const geofence = await tx.geofence.create({
        data: {
          farmId,
          name: dto.name.trim(),
          color: dto.color || '#10B981',
          polygonJson: dto.polygon as any,
        },
      });
      if (dto.animalIds && dto.animalIds.length > 0) {
        await tx.animal.updateMany({
          where: { id: { in: dto.animalIds }, farmId },
          data: { activeGeofenceId: geofence.id },
        });
      }
      return geofence.id;
    });

    return this.getGeofenceById(userId, farmId, geofenceId);
  }

  async updateGeofence(
    userId: string,
    farmId: string,
    geofenceId: string,
    dto: UpdateGeofenceInputDto,
  ) {
    const geofence = await this.prisma.geofence.findFirst({
      where: { id: geofenceId, farmId },
    });

    if (!geofence) {
      throw new NotFoundException('Геозона не найдена');
    }
    await assertSameFarm(this.prisma, farmId, { animalIds: dto.animalIds });

    await this.prisma.$transaction(async (tx) => {
      await tx.geofence.update({
        where: { id: geofenceId },
        data: {
          ...(dto.name && { name: dto.name.trim() }),
          ...(dto.color && { color: dto.color }),
          ...(dto.polygon && { polygonJson: dto.polygon as any }),
        },
      });

      if (dto.animalIds) {
        // The listed animals become the herd of this pen; the others are released.
        await tx.animal.updateMany({
          where: { activeGeofenceId: geofenceId, farmId },
          data: { activeGeofenceId: null },
        });
        if (dto.animalIds.length > 0) {
          await tx.animal.updateMany({
            where: { id: { in: dto.animalIds }, farmId },
            data: { activeGeofenceId: geofenceId },
          });
        }
      }
    });

    return this.getGeofenceById(userId, farmId, geofenceId);
  }

  async deleteGeofence(userId: string, farmId: string, geofenceId: string): Promise<void> {
    const geofence = await this.prisma.geofence.findFirst({
      where: { id: geofenceId, farmId },
    });

    if (!geofence) {
      throw new NotFoundException('Геозона не найдена');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.animal.updateMany({ where: { activeGeofenceId: geofenceId, farmId }, data: { activeGeofenceId: null } });
      await tx.geofence.delete({ where: { id: geofenceId } });
    });
  }
}
