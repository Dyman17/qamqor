import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TelemetryService } from '../telemetry/telemetry.service';
import { OfflineWatcherService } from '../devices/offline-watcher.service';
import { loadAppConfig } from '../config/config';
import { DemoDataService } from './demo-data.service';
import { penGeometryOf } from './pen-cache';
import { PenGeometry } from './geometry';
import {
  AnimalSim,
  FarmSim,
  SCRIPTED_ROLES,
  hashSeed,
  newAnimalSim,
  newFarmSim,
  restoreAnimalSim,
  stepAnimal,
} from './scenario';

/** Nobody has looked at the simulation for this long: the farm is skipped and the database is left alone. */
export const VIEW_TTL_MS = 3 * 60_000;
/** A tick lease that nobody released expires after this long (crash safety, several instances). */
export const LEASE_MS = 30_000;
const CLEANUP_EVERY_MS = 5 * 60_000;
export const DEMO_TELEMETRY_KEEP_MS = 30 * 60_000;
export const DEMO_SIGNAL_KEEP_MS = 2 * 3600_000;
export const DEMO_ALERT_KEEP_MS = 3600_000;
export const DEMO_ALERT_MAX = 200;

interface FarmState {
  sim: FarmSim;
  animals: Map<string, AnimalSim>;
  /** Fresh start: the first animals get the scripted opening roles. After a restart state is restored instead. */
  scripted: boolean;
  nextRole: number;
  lastCleanup: number;
}

export interface TickStats {
  farms: number;
  animals: number;
  pings: number;
  skippedNoViewer: boolean;
}

/**
 * AUTO mode: drives the demo herd through the real telemetry pipeline (TelemetryService), so zones,
 * daily limits and alerts are the production logic. Plain setInterval like OfflineWatcherService.
 *
 * Cost control: a farm is processed only while somebody polls GET /farms/:id/simulation (3 min), animals
 * are pinged one after another, and the tick lease is an UPDATE on the farm row (works with
 * connection_limit=1 and with several instances; the advisory-lock-in-a-transaction pattern of the
 * offline watcher would deadlock here because pings use the shared client).
 */
@Injectable()
export class SimulatorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SimulatorService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly viewed = new Map<string, number>();
  private readonly farms = new Map<string, FarmState>();
  /** Farms an owner action is taking over: the tick yields at the next animal boundary. */
  private readonly claimed = new Set<string>();
  /** Herd size to trim down to on the next tick (set by start on a running simulation). */
  private readonly pendingTrim = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly telemetry: TelemetryService,
    private readonly watcher: OfflineWatcherService,
    private readonly demo: DemoDataService,
  ) {}

  onModuleInit() {
    const cfg = loadAppConfig(process.env);
    if (!cfg.schedulerEnabled || !cfg.demoModesEnabled) {
      this.logger.log('Simulator disabled');
      return;
    }
    this.timer = setInterval(() => {
      this.tick().catch((e) => this.logger.error(`simulator tick failed: ${e?.message}`));
    }, cfg.simTickSec * 1000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ---- viewers ----

  markViewed(farmId: string, now: number = Date.now()): void {
    this.viewed.set(farmId, now);
  }

  isViewed(farmId: string, now: number = Date.now()): boolean {
    const t = this.viewed.get(farmId);
    return t !== undefined && now - t <= VIEW_TTL_MS;
  }

  // ---- scenario state ----

  /** A fresh scenario for the farm (start, reset): the scripted opening plays again. */
  beginFarm(farmId: string, seed?: number, now: number = Date.now()): void {
    this.farms.set(farmId, this.newState(farmId, seed ?? (hashSeed(farmId) ^ (now >>> 0)), now, true));
  }

  /** An owner action takes over the farm: a running tick stops after the animal it is on. */
  claim(farmId: string): void {
    this.claimed.add(farmId);
  }

  unclaim(farmId: string): void {
    this.claimed.delete(farmId);
  }

  requestTrim(farmId: string, herd: number): void {
    this.pendingTrim.set(farmId, herd);
  }

  forgetFarm(farmId: string): void {
    this.farms.delete(farmId);
    this.viewed.delete(farmId);
  }

  private newState(farmId: string, seed: number, now: number, scripted: boolean): FarmState {
    return { sim: newFarmSim(seed, now), animals: new Map(), scripted, nextRole: 0, lastCleanup: now };
  }

  // ---- tick ----

  async tick(now: Date = new Date()): Promise<TickStats> {
    const stats: TickStats = { farms: 0, animals: 0, pings: 0, skippedNoViewer: false };
    if (this.running) return stats;
    this.running = true;
    try {
      const cfg = loadAppConfig(process.env);
      if (!cfg.demoModesEnabled) return stats;
      const ms = now.getTime();
      for (const [id, t] of this.viewed) if (ms - t > VIEW_TTL_MS) this.viewed.delete(id);
      if (this.viewed.size === 0) {
        // Nobody is watching: not a single database call (Neon may sleep).
        stats.skippedNoViewer = true;
        return stats;
      }
      const farms = await this.prisma.farm.findMany({
        where: { id: { in: [...this.viewed.keys()] }, dataMode: 'AUTO' },
      });
      for (const farm of farms) {
        if (!farm.simUntil || farm.simUntil.getTime() <= ms) {
          await this.autoStop(farm.id);
          continue;
        }
        if (this.claimed.has(farm.id)) continue;
        const lease = await this.prisma.farm.updateMany({
          where: { id: farm.id, dataMode: 'AUTO', OR: [{ simLeaseUntil: null }, { simLeaseUntil: { lt: now } }] },
          data: { simLeaseUntil: new Date(ms + LEASE_MS) },
        });
        if (lease.count !== 1) continue; // another instance (or an unfinished tick) holds the farm
        try {
          stats.farms++;
          const r = await this.processFarm(farm, now, cfg);
          stats.animals += r.animals;
          stats.pings += r.pings;
        } catch (e: any) {
          this.logger.error(`simulation of farm ${farm.id} failed: ${e?.message}`);
        } finally {
          await this.prisma.farm.updateMany({ where: { id: farm.id }, data: { simLeaseUntil: null } });
        }
      }
      return stats;
    } finally {
      this.running = false;
    }
  }

  /**
   * Takes the farm's tick lease for an owner action (REAL purge, start) so it cannot interleave with
   * a running tick. Waits briefly for a tick in progress; false = still held.
   */
  async acquireLease(farmId: string, waitMs = 15_000): Promise<boolean> {
    const deadline = Date.now() + waitMs;
    for (;;) {
      const now = new Date();
      const r = await this.prisma.farm.updateMany({
        where: { id: farmId, OR: [{ simLeaseUntil: null }, { simLeaseUntil: { lt: now } }] },
        data: { simLeaseUntil: new Date(now.getTime() + LEASE_MS) },
      });
      if (r.count === 1) return true;
      if (Date.now() >= deadline) return false;
      await new Promise((res) => setTimeout(res, 250));
    }
  }

  async releaseLease(farmId: string): Promise<void> {
    await this.prisma.farm.updateMany({ where: { id: farmId }, data: { simLeaseUntil: null } });
  }

  /** The planned time is over: MANUAL, demo data stays. */
  async autoStop(farmId: string): Promise<void> {
    await this.prisma.farm.updateMany({
      where: { id: farmId, dataMode: 'AUTO' },
      data: { dataMode: 'MANUAL', simUntil: null, simLeaseUntil: null },
    });
    this.forgetFarm(farmId);
  }

  private demoDevices(farmId: string) {
    return this.prisma.device.findMany({
      where: { farmId, isSimulated: true, animal: { isDemo: true } },
      include: { farm: true, animal: { include: { activeGeofence: true } } },
      orderBy: [{ animal: { createdAt: 'asc' } }, { id: 'asc' }],
    });
  }

  private async processFarm(farm: any, now: Date, cfg: ReturnType<typeof loadAppConfig>) {
    const ms = now.getTime();
    const trimTo = this.pendingTrim.get(farm.id);
    if (trimTo !== undefined) {
      this.pendingTrim.delete(farm.id);
      await this.demo.trimHerd(farm.id, trimTo);
    }
    let devices = await this.demoDevices(farm.id);
    if (devices.length < Math.min(farm.simHerd, 20) || devices.some((d) => !d.animal?.activeGeofence)) {
      // Fresh read: the owner may have switched the farm away (REAL purge) since the tick began.
      const fresh = await this.prisma.farm.findUnique({ where: { id: farm.id } });
      if (!fresh || fresh.dataMode !== 'AUTO') return { animals: 0, pings: 0 };
      await this.demo.ensureHerd(farm.id, farm.simHerd);
      devices = await this.demoDevices(farm.id);
    }
    let state = this.farms.get(farm.id);
    if (!state) {
      state = this.newState(farm.id, hashSeed(farm.id) ^ (ms >>> 0), ms, false);
      this.farms.set(farm.id, state);
    }
    const stepCfg = { speed: farm.simSpeed || 1, tickSec: cfg.simTickSec, offlineSec: cfg.simDemoOfflineSec };
    let pings = 0;
    let checked = 0;
    for (const device of devices) {
      // An owner action wins: stop after the current animal so the lease is released at once.
      if (this.claimed.has(farm.id)) break;
      if (checked++ > 0) {
        const cur = await this.prisma.farm.findUnique({ where: { id: farm.id }, select: { dataMode: true } });
        if (!cur || cur.dataMode !== 'AUTO') break;
      }
      const animal: any = device.animal;
      const geom = penGeometryOf(animal?.activeGeofence);
      if (!geom) continue; // no valid pen: nothing is guessed
      try {
        let sim = state.animals.get(animal.id);
        if (!sim) {
          const role = state.scripted ? SCRIPTED_ROLES[state.nextRole++] ?? null : null;
          const last =
            animal.lastLatitude != null && animal.lastLongitude != null
              ? geom.toLocal(animal.lastLatitude, animal.lastLongitude)
              : null;
          sim = role
            ? newAnimalSim(geom, state.sim.rng, role, stepCfg.speed)
            : restoreAnimalSim(geom, state.sim.rng, last, stepCfg.speed);
          state.animals.set(animal.id, sim);
        }
        const out = stepAnimal(sim, geom, state.sim, ms, stepCfg);
        if (out.goOffline) {
          const locked = await this.forceOffline(device, now);
          if (!locked) {
            // The watcher was busy: say "now" again next tick.
            sim.silentLeft = 1;
            sim.holdLeft = 0;
          }
        }
        if (out.ping) {
          await this.sendPing(device, geom, out.ping, now);
          pings++;
        }
      } catch (e: any) {
        this.logger.warn(`demo animal ${animal?.id} skipped: ${e?.message}`);
      }
    }
    if (ms - state.lastCleanup >= CLEANUP_EVERY_MS) {
      state.lastCleanup = ms;
      await this.cleanup(farm.id, now);
    }
    return { animals: devices.length, pings };
  }

  /**
   * The collar's last contact is moved back past the offline threshold and the real offline watcher
   * runs for this collar only, so DEVICE_OFFLINE comes from the production logic.
   * Returns false when the watcher is busy (retry later).
   */
  async forceOffline(device: { id: string; deviceId: string }, now: Date = new Date()): Promise<boolean> {
    const threshold = loadAppConfig(process.env).offlineThresholdSec;
    await this.prisma.device.update({
      where: { id: device.id },
      data: { lastHeartbeatAt: new Date(now.getTime() - (threshold + 60) * 1000) },
    });
    const res = await this.watcher.tick(now, { deviceIds: [device.deviceId] });
    return res.locked;
  }

  private async sendPing(
    device: any,
    geom: PenGeometry,
    ping: { pos: { x: number; y: number }; accuracy: number; speedKmh: number },
    now: Date,
  ) {
    const g = geom.toGeo(ping.pos);
    const last = device.animal?.lastSeenAt ? new Date(device.animal.lastSeenAt).getTime() : 0;
    const ts = new Date(Math.max(now.getTime(), last + 1));
    return this.telemetry.processDeviceTelemetry(device, {
      deviceId: device.deviceId,
      timestamp: ts.toISOString(),
      latitude: g.latitude,
      longitude: g.longitude,
      accuracy: Math.round(ping.accuracy * 10) / 10,
      signal: -70,
      speedKmh: Math.round(ping.speedKmh * 10) / 10,
    } as any);
  }

  private readonly idleCleanup = new Map<string, number>();

  /**
   * MANUAL farms have no tick, so their demo history is trimmed from the state read instead
   * (at most once per 5 min per farm, 24 h time to live): cheap and bounded.
   */
  async cleanupIdle(farmId: string, now: Date = new Date()): Promise<void> {
    const last = this.idleCleanup.get(farmId) ?? 0;
    if (now.getTime() - last < CLEANUP_EVERY_MS) return;
    this.idleCleanup.set(farmId, now.getTime());
    const day = 24 * 3600_000;
    await this.cleanup(farmId, now, { telemetryMs: day, signalMs: day, alertMs: day });
  }

  /** Keeps the demo footprint small: old telemetry, signal events and resolved alerts, alert cap. */
  async cleanup(
    farmId: string,
    now: Date = new Date(),
    ttl: { telemetryMs: number; signalMs: number; alertMs: number } = {
      telemetryMs: DEMO_TELEMETRY_KEEP_MS,
      signalMs: DEMO_SIGNAL_KEEP_MS,
      alertMs: DEMO_ALERT_KEEP_MS,
    },
  ): Promise<void> {
    const ms = now.getTime();
    await this.prisma.telemetry.deleteMany({
      where: { timestamp: { lt: new Date(ms - ttl.telemetryMs) }, animal: { farmId, isDemo: true } },
    });
    await this.prisma.signalEvent.deleteMany({
      where: { farmId, at: { lt: new Date(ms - ttl.signalMs) }, animal: { isDemo: true } },
    });
    await this.prisma.alert.deleteMany({
      where: { farmId, isDemo: true, status: 'RESOLVED', resolvedAt: { lt: new Date(ms - ttl.alertMs) } },
    });
    const total = await this.prisma.alert.count({ where: { farmId, isDemo: true } });
    if (total > DEMO_ALERT_MAX) {
      const old = await this.prisma.alert.findMany({
        where: { farmId, isDemo: true, status: 'RESOLVED' },
        orderBy: { createdAt: 'asc' },
        take: total - DEMO_ALERT_MAX,
        select: { id: true },
      });
      if (old.length) await this.prisma.alert.deleteMany({ where: { id: { in: old.map((a) => a.id) } } });
    }
    // One-off legacy: the retired MockModule created simulated QAM-MOCK-* collars (never real ones).
    await this.prisma.device.deleteMany({
      where: { farmId, isSimulated: true, deviceId: { startsWith: 'QAM-MOCK-' } },
    });
  }
}
