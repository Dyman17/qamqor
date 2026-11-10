import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AlertType, AlertSeverity, AlertStatus } from '@qamqor/shared';
import { ALERT_INCLUDE, AlertDto, toAlertDto } from './mappers';
import { Page, PAGE_DEFAULT_LIMIT } from '../common/pagination';

const OPEN_STATUSES = [AlertStatus.ACTIVE, AlertStatus.ACKNOWLEDGED];

/** A breach alert the user resolved is not re-raised for this long while the animal stays outside. */
export const BREACH_RESOLVED_COOLDOWN_MS = 10 * 60_000;

/** Closes an animal's open DEVICE_OFFLINE and GPS_LOST alerts (collar removed, animal deleted). */
export async function resolveCollarAlerts(db: any, animalId: string): Promise<void> {
  await db.alert.updateMany({
    where: {
      animalId,
      type: { in: [AlertType.DEVICE_OFFLINE, AlertType.GPS_LOST] },
      status: { in: OPEN_STATUSES },
    },
    data: { status: AlertStatus.RESOLVED, resolvedAt: new Date() },
  });
}

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ==========================================
  // INGESTION EVENT HANDLERS
  // ==========================================

  /**
   * Creates an ACTIVE alert once per dedupeKey. A partial unique index (see migration
   * 0007_alert_dedupe) makes concurrent creations safe: the loser gets P2002 and the existing
   * alert is returned.
   */
  private async createActiveOnce(data: {
    farmId: string;
    animalId?: string | null;
    deviceId?: string | null;
    type: AlertType;
    severity: AlertSeverity;
    message: string;
    latitude?: number | null;
    longitude?: number | null;
    dedupeKey: string;
    isDemo?: boolean;
  }, db: any = this.prisma) {
    // An ACKNOWLEDGED alert is still "open": the condition has not cleared, so it is not re-raised.
    const open = await db.alert.findFirst({ where: { dedupeKey: data.dedupeKey, status: { in: OPEN_STATUSES } } });
    if (open) return open;
    try {
      return await db.alert.create({ data: { ...data, isDemo: data.isDemo ?? false, status: AlertStatus.ACTIVE } });
    } catch (e: any) {
      // Inside a transaction a failed statement aborts it, so only the shared client can recover here.
      if (e?.code === 'P2002' && db === this.prisma) {
        return this.prisma.alert.findFirst({ where: { dedupeKey: data.dedupeKey, status: AlertStatus.ACTIVE } });
      }
      throw e;
    }
  }

  async triggerGeofenceBreach(data: {
    farmId: string;
    animalId: string;
    animalName: string;
    deviceId: string;
    latitude: number;
    longitude: number;
    isDemo?: boolean;
    /**
     * true = the animal has just crossed the border (it was inside on the previous ping): always a new
     * event. Otherwise (still outside) a breach alert that was resolved less than
     * BREACH_RESOLVED_COOLDOWN_MS ago is not re-created, so a resolved alert does not come back on the next ping.
     */
    freshBreach?: boolean;
  }) {
    const dedupeKey = `${AlertType.GEOFENCE_BREACH}:${data.animalId}`;
    const existing = await this.prisma.alert.findFirst({
      where: { dedupeKey, status: { in: OPEN_STATUSES } },
    });

    if (existing) {
      this.logger.debug(`Open breach alert already exists for animal ${data.animalId}`);
      return existing;
    }

    if (!data.freshBreach) {
      const recentlyResolved = await this.prisma.alert.findFirst({
        where: {
          animalId: data.animalId,
          type: AlertType.GEOFENCE_BREACH,
          status: AlertStatus.RESOLVED,
          resolvedAt: { gte: new Date(Date.now() - BREACH_RESOLVED_COOLDOWN_MS) },
        },
        select: { id: true },
      });
      if (recentlyResolved) {
        this.logger.debug(`Breach alert for animal ${data.animalId} was resolved recently, not re-raised`);
        return null;
      }
    }

    this.logger.warn(`ALERT: Animal ${data.animalName} (${data.animalId}) exited geofence at [${data.latitude}, ${data.longitude}]`);

    return this.createActiveOnce({
      farmId: data.farmId,
      animalId: data.animalId,
      deviceId: data.deviceId,
      type: AlertType.GEOFENCE_BREACH,
      severity: AlertSeverity.CRITICAL,
      message: `Животное "${data.animalName}" покинуло границы пастбища! Координаты: ${data.latitude.toFixed(4)}, ${data.longitude.toFixed(4)}`,
      latitude: data.latitude,
      longitude: data.longitude,
      dedupeKey,
      isDemo: data.isDemo,
    });
  }

  /** The fix is too inaccurate to judge the position (zone UNKNOWN). One ACTIVE alert per animal. */
  async triggerGpsLost(data: { farmId: string; animalId: string; animalName: string; deviceId: string; isDemo?: boolean }) {
    const dedupeKey = `${AlertType.GPS_LOST}:${data.animalId}`;
    const existing = await this.prisma.alert.findFirst({ where: { dedupeKey, status: { in: OPEN_STATUSES } } });
    if (existing) return existing;
    return this.createActiveOnce({
      farmId: data.farmId,
      animalId: data.animalId,
      deviceId: data.deviceId,
      type: AlertType.GPS_LOST,
      severity: AlertSeverity.WARNING,
      message: `Ненадёжный GPS-сигнал у животного "${data.animalName}": положение не определено.`,
      dedupeKey,
      isDemo: data.isDemo,
    });
  }

  /** A reliable fix is back: close the animal's ACTIVE GPS_LOST alert. */
  async resolveGpsLost(animalId: string) {
    await this.prisma.alert.updateMany({
      where: { animalId, type: AlertType.GPS_LOST, status: { in: OPEN_STATUSES } },
      data: { status: AlertStatus.RESOLVED, resolvedAt: new Date() },
    });
  }

  /** The collar of an animal has been silent longer than the offline threshold. */
  async triggerDeviceOffline(data: {
    farmId: string;
    animalId: string;
    animalName: string;
    deviceId: string;
    lastSeenAt: Date;
    isDemo?: boolean;
  }, db: any = this.prisma) {
    return this.createActiveOnce({
      farmId: data.farmId,
      animalId: data.animalId,
      deviceId: data.deviceId,
      type: AlertType.DEVICE_OFFLINE,
      severity: AlertSeverity.WARNING,
      message: `Нет связи с ошейником ${data.deviceId} (животное "${data.animalName}"). Последний сигнал: ${data.lastSeenAt.toISOString()}.`,
      dedupeKey: `${AlertType.DEVICE_OFFLINE}:${data.animalId}`,
      isDemo: data.isDemo,
    }, db);
  }

  /** The collar pinged again: close ACTIVE DEVICE_OFFLINE alerts and leave a DEVICE_RESTORED note. */
  async restoreDevice(data: { farmId: string; animalId: string; animalName: string; deviceId: string; isDemo?: boolean }) {
    const closed = await this.prisma.alert.updateMany({
      where: { animalId: data.animalId, type: AlertType.DEVICE_OFFLINE, status: { in: OPEN_STATUSES } },
      data: { status: AlertStatus.RESOLVED, resolvedAt: new Date() },
    });
    if (closed.count === 0) return null;
    return this.prisma.alert.create({
      data: {
        farmId: data.farmId,
        animalId: data.animalId,
        deviceId: data.deviceId,
        type: AlertType.DEVICE_RESTORED,
        severity: AlertSeverity.INFO,
        status: AlertStatus.RESOLVED,
        resolvedAt: new Date(),
        isDemo: data.isDemo ?? false,
        message: `Связь с ошейником ${data.deviceId} (животное "${data.animalName}") восстановлена.`,
      },
    });
  }

  /**
   * A daily signal limit suppressed a signal. One alert per animal, level and local day,
   * even if it was acknowledged in the meantime.
   */
  async triggerSignalLimit(data: {
    farmId: string;
    animalId: string;
    animalName: string;
    deviceId: string;
    level: 'SOUND' | 'VIBRATION';
    day: string;
    isDemo?: boolean;
  }) {
    const dedupeKey = `${AlertType.SIGNAL_LIMIT_REACHED}:${data.animalId}:${data.level}:${data.day}`;
    const existing = await this.prisma.alert.findFirst({ where: { dedupeKey } });
    if (existing) return existing;
    const label = data.level === 'SOUND' ? 'звук' : 'вибрация';
    return this.createActiveOnce({
      farmId: data.farmId,
      animalId: data.animalId,
      deviceId: data.deviceId,
      type: AlertType.SIGNAL_LIMIT_REACHED,
      severity: AlertSeverity.WARNING,
      message: `Достигнут суточный лимит сигнала «${label}» для животного "${data.animalName}". Дальнейшие сигналы сегодня подавляются.`,
      dedupeKey,
      isDemo: data.isDemo,
    });
  }

  async resolveGeofenceBreach(data: {
    farmId: string;
    animalId: string;
    animalName: string;
    deviceId: string;
    latitude: number;
    longitude: number;
    isDemo?: boolean;
  }) {
    const activeBreaches = await this.prisma.alert.findMany({
      where: {
        animalId: data.animalId,
        type: AlertType.GEOFENCE_BREACH,
        status: { in: OPEN_STATUSES },
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
          isDemo: data.isDemo ?? false,
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
    q: { status?: AlertStatus; type?: AlertType; animalId?: string; limit?: number; cursor?: string } = {},
  ): Promise<Page<AlertDto>> {
    const where: any = { farmId };
    if (q.status) where.status = q.status;
    if (q.type) where.type = q.type;
    if (q.animalId) where.animalId = q.animalId;

    const limit = q.limit ?? PAGE_DEFAULT_LIMIT;
    const rows = await this.prisma.alert.findMany({
      where,
      include: ALERT_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: limit + 1,
      ...(q.cursor && { cursor: { id: q.cursor }, skip: 1 }),
    });
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(toAlertDto);
    return { items, nextCursor: hasMore && items.length ? items[items.length - 1].id : null };
  }

  async updateAlertStatus(
    userId: string,
    farmId: string,
    alertId: string,
    status: AlertStatus,
  ): Promise<AlertDto> {
    const alert = await this.prisma.alert.findFirst({
      where: { id: alertId, farmId },
    });

    if (!alert) {
      throw new NotFoundException('Оповещение не найдено');
    }

    try {
      const updated = await this.prisma.alert.update({
        where: { id: alertId },
        data: {
          status,
          // Handling an alert marks it as seen.
          ...(status !== AlertStatus.ACTIVE && { isRead: true }),
          ...(status === AlertStatus.RESOLVED && { resolvedAt: new Date() }),
        },
        include: ALERT_INCLUDE,
      });
      return toAlertDto(updated);
    } catch (e: any) {
      // Re-activating while another ACTIVE alert of the same kind exists (partial unique index).
      if (e?.code === 'P2002') throw new ConflictException('Для этого животного уже есть активное оповещение такого типа');
      throw e;
    }
  }

  async markAllRead(userId: string, farmId: string): Promise<{ updated: number }> {
    const res = await this.prisma.alert.updateMany({ where: { farmId, isRead: false }, data: { isRead: true } });
    return { updated: res.count };
  }

  async getAlertStats(userId: string, farmId: string) {

    const [activeTotal, activeBreaches, offline] = await Promise.all([
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
      this.prisma.alert.count({
        where: { farmId, status: AlertStatus.ACTIVE, type: AlertType.DEVICE_OFFLINE },
      }),
    ]);

    return {
      activeTotal,
      activeBreaches,
      offline,
    };
  }
}
