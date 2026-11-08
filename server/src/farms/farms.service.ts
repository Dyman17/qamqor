import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFarmDto, UpdateFarmDto } from './dto/farm.dto';
import { forbiddenFarm, forbiddenRole } from '../common/errors';
import { SIGNAL_LEVELS, SignalLimitDto } from './signal-limits';

export const DEFAULT_FARM_TIMEZONE = 'Asia/Aqtau';

export type Role = 'OWNER' | 'WORKER';

export interface FarmDto {
  id: string;
  name: string;
  description: string | null;
  timezone: string;
  workerCanEditBoundaries: boolean;
  myRole: Role;
  /** REAL | MANUAL | AUTO (demo modes). */
  dataMode: 'REAL' | 'MANUAL' | 'AUTO';
}

export function toFarmDto(farm: any, myRole: Role): FarmDto {
  return {
    id: farm.id,
    name: farm.name,
    description: farm.description ?? null,
    timezone: farm.timezone,
    workerCanEditBoundaries: farm.workerCanEditBoundaries,
    myRole,
    dataMode: farm.dataMode ?? 'REAL',
  };
}

@Injectable()
export class FarmsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Membership of the user in the farm, or 403 FORBIDDEN_FARM. */
  async requireMember(userId: string, farmId: string) {
    const m = await this.prisma.farmMember.findUnique({
      where: { userId_farmId: { userId, farmId } },
      include: { farm: true },
    });
    if (!m) throw forbiddenFarm();
    return m;
  }

  /** Owner membership, or 403 FORBIDDEN_FARM (not a member) / FORBIDDEN_ROLE (worker). */
  async requireOwner(userId: string, farmId: string) {
    const m = await this.requireMember(userId, farmId);
    if (m.role !== 'OWNER') throw forbiddenRole('Действие доступно только владельцу хозяйства');
    return m;
  }

  async listUserFarms(userId: string): Promise<FarmDto[]> {
    const memberships = await this.prisma.farmMember.findMany({
      where: { userId },
      include: { farm: true },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((m) => toFarmDto(m.farm, m.role as Role));
  }

  async getFarmById(userId: string, farmId: string): Promise<FarmDto> {
    const m = await this.requireMember(userId, farmId);
    return toFarmDto(m.farm, m.role as Role);
  }

  /** Only a user who owns at least one farm may create another one. */
  async createFarm(userId: string, dto: CreateFarmDto): Promise<FarmDto> {
    const owned = await this.prisma.farmMember.count({ where: { userId, role: 'OWNER' } });
    if (owned === 0) throw forbiddenRole('Создавать хозяйства может только владелец');

    const farm = await this.prisma.$transaction(async (tx) => {
      const created = await tx.farm.create({
        data: {
          name: dto.name.trim(),
          description: dto.description?.trim(),
          ...(dto.timezone && { timezone: dto.timezone }),
          ownerId: userId,
        },
      });
      await tx.farmMember.create({ data: { userId, farmId: created.id, role: 'OWNER' } });
      return created;
    });
    return toFarmDto(farm, 'OWNER');
  }

  async updateFarm(userId: string, farmId: string, dto: UpdateFarmDto): Promise<FarmDto> {
    await this.requireOwner(userId, farmId);
    const farm = await this.prisma.farm.update({
      where: { id: farmId },
      data: {
        ...(dto.name && { name: dto.name.trim() }),
        ...(dto.description !== undefined && { description: dto.description?.trim() }),
        ...(dto.timezone && { timezone: dto.timezone }),
        ...(dto.workerCanEditBoundaries !== undefined && {
          workerCanEditBoundaries: dto.workerCanEditBoundaries,
        }),
      },
    });
    return toFarmDto(farm, 'OWNER');
  }

  async listMembers(userId: string, farmId: string) {
    await this.requireOwner(userId, farmId);
    const rows = await this.prisma.farmMember.findMany({
      where: { farmId },
      include: { user: { select: { id: true, email: true, fullName: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      userId: r.user.id,
      email: r.user.email,
      fullName: r.user.fullName,
      role: r.role as Role,
    }));
  }

  async removeMember(userId: string, farmId: string, targetUserId: string): Promise<void> {
    const farm = (await this.requireOwner(userId, farmId)).farm;
    const target = await this.prisma.farmMember.findUnique({
      where: { userId_farmId: { userId: targetUserId, farmId } },
    });
    if (!target) throw new NotFoundException('Участник не найден');
    if (target.role === 'OWNER' || farm.ownerId === targetUserId) {
      throw new ConflictException('Владельца хозяйства убрать нельзя');
    }
    await this.prisma.farmMember.delete({ where: { id: target.id } });
  }

  async getSignalLimits(userId: string, farmId: string): Promise<SignalLimitDto[]> {
    await this.requireOwner(userId, farmId);
    return this.readSignalLimits(farmId);
  }

  async readSignalLimits(farmId: string): Promise<SignalLimitDto[]> {
    const rows = await this.prisma.signalLimit.findMany({ where: { farmId } });
    return SIGNAL_LEVELS.map((level) => {
      const r = rows.find((x) => x.level === level);
      return { level, dailyLimit: r?.dailyLimit ?? null, unlimited: r?.unlimited ?? false };
    });
  }

  async putSignalLimits(userId: string, farmId: string, limits: SignalLimitDto[]): Promise<SignalLimitDto[]> {
    await this.requireOwner(userId, farmId);
    await this.prisma.$transaction(
      limits.map((l) =>
        this.prisma.signalLimit.upsert({
          where: { farmId_level: { farmId, level: l.level } },
          update: { dailyLimit: l.dailyLimit, unlimited: l.unlimited },
          create: { farmId, level: l.level, dailyLimit: l.dailyLimit, unlimited: l.unlimited },
        }),
      ),
    );
    return this.readSignalLimits(farmId);
  }
}
