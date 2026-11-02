import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFarmDto, UpdateFarmDto } from './dto/farm.dto';
import { UserRole } from '@prisma/client';

@Injectable()
export class FarmsService {
  constructor(private readonly prisma: PrismaService) {}

  async listUserFarms(userId: string) {
    const memberships = await this.prisma.farmMember.findMany({
      where: { userId },
      include: {
        farm: {
          include: {
            _count: {
              select: {
                animals: true,
                devices: true,
                geofences: true,
                alerts: { where: { status: 'ACTIVE' } },
              },
            },
          },
        },
      },
    });

    return memberships.map((m) => ({
      ...m.farm,
      myRole: m.role,
    }));
  }

  async getFarmById(userId: string, farmId: string) {
    const membership = await this.prisma.farmMember.findUnique({
      where: {
        userId_farmId: { userId, farmId },
      },
      include: {
        farm: {
          include: {
            members: {
              include: {
                user: {
                  select: { id: true, fullName: true, email: true, phone: true },
                },
              },
            },
          },
        },
      },
    });

    if (!membership) {
      throw new ForbiddenException('У вас нет доступа к этому хозяйству');
    }

    return {
      ...membership.farm,
      myRole: membership.role,
    };
  }

  async createFarm(userId: string, dto: CreateFarmDto) {
    const farm = await this.prisma.farm.create({
      data: {
        name: dto.name.trim(),
        description: dto.description?.trim(),
        ownerId: userId,
      },
    });

    await this.prisma.farmMember.create({
      data: {
        userId,
        farmId: farm.id,
        role: UserRole.FARM_OWNER,
      },
    });

    return farm;
  }

  async updateFarm(userId: string, farmId: string, dto: UpdateFarmDto) {
    const membership = await this.prisma.farmMember.findUnique({
      where: {
        userId_farmId: { userId, farmId },
      },
    });

    if (!membership || membership.role !== UserRole.FARM_OWNER) {
      throw new ForbiddenException('Только владелец хозяйства может изменять его настройки');
    }

    return this.prisma.farm.update({
      where: { id: farmId },
      data: {
        ...(dto.name && { name: dto.name.trim() }),
        ...(dto.description !== undefined && { description: dto.description?.trim() }),
      },
    });
  }
}
