import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GeofenceStatus } from '@qamqor/shared';
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
   * Evaluates geofence status with false-positive protection (GPS accuracy check)
   */
  evaluateLocation(
    point: { latitude: number; longitude: number; accuracy: number },
    polygonGeoJson: any,
  ): { status: GeofenceStatus; isReliable: boolean } {
    // If accuracy is poor (> 35 meters), mark as unreliable to prevent false breach alerts
    const isReliable = point.accuracy <= 35;

    if (!polygonGeoJson) {
      return { status: GeofenceStatus.INSIDE, isReliable };
    }

    const inside = this.isPointInPolygon(point, polygonGeoJson);
    return {
      status: inside ? GeofenceStatus.INSIDE : GeofenceStatus.OUTSIDE,
      isReliable,
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

    return this.prisma.geofence.create({
      data: {
        farmId,
        name: dto.name.trim(),
        description: dto.description?.trim(),
        color: dto.color || '#10B981',
        polygonJson: dto.polygonJson as any,
      },
    });
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

    return this.prisma.geofence.update({
      where: { id: geofenceId },
      data: {
        ...(dto.name && { name: dto.name.trim() }),
        ...(dto.description !== undefined && { description: dto.description?.trim() }),
        ...(dto.color && { color: dto.color }),
        ...(dto.polygonJson && { polygonJson: dto.polygonJson as any }),
      },
    });
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
