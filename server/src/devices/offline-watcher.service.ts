import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AlertsService } from '../alerts/alerts.service';
import { loadAppConfig } from '../config/config';

/** An unclaimed device with no ping for this long is removed. */
export const UNCLAIMED_TTL_DAYS = 7;

/** Postgres advisory lock key: only one server instance runs a tick at a time. */
export const OFFLINE_WATCHER_LOCK_KEY = 727301;

/**
 * Raises DEVICE_OFFLINE for collars of animals that have been silent for longer than
 * OFFLINE_AFTER_MISSED_PINGS x NORMAL_PING_INTERVAL_SEC. Plain setInterval, disabled in tests.
 * Alert creation is idempotent (partial unique index), so a missed lock cannot duplicate alerts.
 * Collars that never pinged are not alerted (nothing was lost); they show as OFFLINE in the list.
 */
@Injectable()
export class OfflineWatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OfflineWatcherService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
  ) {}

  onModuleInit() {
    const cfg = loadAppConfig(process.env);
    if (!cfg.schedulerEnabled) {
      this.logger.log('Offline watcher disabled');
      return;
    }
    this.timer = setInterval(() => {
      this.tick().catch((e) => this.logger.error(`offline watcher tick failed: ${e?.message}`));
      this.purgeUnclaimed().catch((e) => this.logger.error(`unclaimed purge failed: ${e?.message}`));
    }, cfg.offlineCheckIntervalSec * 1000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Deletes never-claimed devices (and, by cascade, their telemetry) silent for UNCLAIMED_TTL_DAYS. */
  async purgeUnclaimed(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - UNCLAIMED_TTL_DAYS * 24 * 3600_000);
    const r = await this.prisma.device.deleteMany({
      where: {
        farmId: null,
        isSimulated: false,
        OR: [{ lastHeartbeatAt: { lt: cutoff } }, { lastHeartbeatAt: null, createdAt: { lt: cutoff } }],
      },
    });
    return r.count;
  }

  /**
   * One pass. Returns whether the lock was obtained and how many stale collars were handled.
   * The periodic pass never touches simulated (demo) collars: their silence is staged by the demo
   * modes, which call this with `deviceIds` to run the real offline logic for exactly those collars.
   */
  async tick(
    now: Date = new Date(),
    opts: { deviceIds?: string[] } = {},
  ): Promise<{ locked: boolean; stale: number }> {
    if (this.running) return { locked: false, stale: 0 };
    this.running = true;
    try {
      const cutoff = new Date(now.getTime() - loadAppConfig(process.env).offlineThresholdSec * 1000);
      return await this.prisma.$transaction(
        async (tx) => {
          const res = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(${OFFLINE_WATCHER_LOCK_KEY}::bigint) AS locked`;
          if (!res?.[0]?.locked) return { locked: false, stale: 0 };

          const stale = await tx.device.findMany({
            where: {
              farmId: { not: null },
              animalId: { not: null },
              lastHeartbeatAt: { not: null, lt: cutoff },
              ...(opts.deviceIds ? { deviceId: { in: opts.deviceIds } } : { isSimulated: false }),
            },
            include: { animal: { select: { id: true, name: true, isDemo: true } } },
          });
          // Collars that already have an open (ACTIVE or ACKNOWLEDGED) offline alert are skipped.
          // All writes go through `tx`: the lock transaction owns the connection, so using the
          // shared client here would deadlock with connection_limit=1.
          const keys = stale.filter((d) => d.animal).map((d) => `DEVICE_OFFLINE:${d.animal!.id}`);
          const open = keys.length
            ? await tx.alert.findMany({
                where: { dedupeKey: { in: keys }, status: { in: ['ACTIVE', 'ACKNOWLEDGED'] } },
                select: { dedupeKey: true },
              })
            : [];
          const openKeys = new Set(open.map((o) => o.dedupeKey));
          for (const d of stale) {
            if (!d.animal || !d.farmId || !d.lastHeartbeatAt) continue;
            if (openKeys.has(`DEVICE_OFFLINE:${d.animal.id}`)) continue;
            await this.alerts.triggerDeviceOffline(
              {
                farmId: d.farmId,
                animalId: d.animal.id,
                animalName: d.animal.name,
                deviceId: d.deviceId,
                lastSeenAt: d.lastHeartbeatAt,
                isDemo: !!d.animal.isDemo,
              },
              tx,
            );
          }
          return { locked: true, stale: stale.length };
        },
        { timeout: 20_000 },
      );
    } finally {
      this.running = false;
    }
  }
}
