import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AlertsService } from '../alerts/alerts.service';
import { dayWindow } from '../common/farm-day';
import { effectiveLimit } from '../farms/signal-limits';

export interface DaySignals {
  day: string;
  sound: { used: number; limit: number | null };
  vibration: { used: number; limit: number | null };
  /** The impulse is switched off: nothing is ever delivered, nothing is counted. */
  impulse: { used: 0; limit: number | null; available: false };
}

/** Default minimum gap between two delivered signals of one kind for one animal. */
export const DEFAULT_SIGNAL_COOLDOWN_SEC = 30;

export interface LimitedSignals {
  sound: boolean;
  vibrate: boolean;
  suppressed: boolean;
}

/**
 * Signals are episodic: per animal and kind (sound, vibration) at most one signal is delivered per
 * cooldown, however often the collar pings. A signal inside the cooldown is silently dropped (it is
 * normal behaviour, not a suppression): nothing is recorded and nothing counts against the daily limit.
 *
 * Daily per-animal signal accounting. Days are local days of the farm time zone.
 * A limit that is not set (null) or `unlimited` never suppresses anything.
 */
@Injectable()
export class SignalsService {
  /**
   * Cooldown cache: last delivered signal per animal+level (ms). The database (latest SignalEvent per
   * animal+level, index [animalId, level, at]) is the source of truth and is read only on a cache miss
   * (the first signal decision after a restart), so a ping loop inside the cooldown costs no query.
   * Single instance assumption, like the rest of the in-memory state.
   */
  private readonly lastSignal = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
  ) {}

  /**
   * Applies the per-kind cooldown and the farm daily limits to the signals the zone asks for.
   * A kind inside its cooldown is dropped quietly. A level whose daily limit is reached is suppressed
   * (and a SIGNAL_LIMIT_REACHED alert is raised once per day); every signal that is delivered is recorded.
   */
  async applyLimits(args: {
    farmId: string;
    timezone: string;
    animal: { id: string; name: string; isDemo?: boolean };
    deviceId: string;
    sound: boolean;
    vibrate: boolean;
    now: Date;
    /** false: limits and cooldown are enforced but nothing is recorded. */
    record?: boolean;
    /** Minimum seconds between two delivered signals of one kind (default 30; 0 = off). */
    cooldownSec?: number;
    /**
     * The animal entered a MORE severe signalling zone: the cooldown is skipped (the signals are still
     * recorded and counted against the daily limits).
     */
    escalation?: boolean;
  }): Promise<LimitedSignals> {
    const { farmId, animal, deviceId, now } = args;
    const cooldownMs = args.escalation ? 0 : (args.cooldownSec ?? DEFAULT_SIGNAL_COOLDOWN_SEC) * 1000;
    if (!args.sound && !args.vibrate) return { sound: false, vibrate: false, suppressed: false };

    const win = dayWindow(now, args.timezone);
    const rows = await this.prisma.signalLimit.findMany({ where: { farmId } });
    const out: LimitedSignals = { sound: args.sound, vibrate: args.vibrate, suppressed: false };
    const toRecord: Array<'SOUND' | 'VIBRATION'> = [];

    for (const [level, wanted] of [
      ['SOUND', args.sound],
      ['VIBRATION', args.vibrate],
    ] as const) {
      if (!wanted) continue;
      if (await this.inCooldown(animal.id, level, now.getTime(), cooldownMs)) {
        if (level === 'SOUND') out.sound = false;
        else out.vibrate = false;
        continue;
      }
      const limit = effectiveLimit(rows.find((r) => r.level === level));
      if (limit !== null) {
        const used = await this.prisma.signalEvent.count({
          where: { animalId: animal.id, level, at: { gte: win.start, lt: win.end } },
        });
        if (used >= limit) {
          if (level === 'SOUND') out.sound = false;
          else out.vibrate = false;
          out.suppressed = true;
          await this.alerts.triggerSignalLimit({
            farmId,
            animalId: animal.id,
            animalName: animal.name,
            deviceId,
            level,
            day: win.day,
            isDemo: animal.isDemo,
          });
          continue;
        }
      }
      toRecord.push(level);
    }

    if (toRecord.length && args.record !== false) {
      await this.prisma.signalEvent.createMany({
        data: toRecord.map((level) => ({ farmId, animalId: animal.id, deviceId, level, at: now })),
      });
      for (const level of toRecord) this.lastSignal.set(`${animal.id}:${level}`, now.getTime());
    }
    return out;
  }

  private async inCooldown(
    animalId: string,
    level: 'SOUND' | 'VIBRATION',
    nowMs: number,
    cooldownMs: number,
  ): Promise<boolean> {
    if (cooldownMs <= 0) return false;
    const key = `${animalId}:${level}`;
    let last = this.lastSignal.get(key);
    if (last === undefined) {
      const row = await this.prisma.signalEvent.findFirst({
        where: { animalId, level },
        orderBy: { at: 'desc' },
        select: { at: true },
      });
      if (!row) return false;
      last = new Date(row.at).getTime();
      this.lastSignal.set(key, last);
    }
    return nowMs - last < cooldownMs;
  }

  /** Counters for GET /animals/:id/signals. */
  async daySummary(farmId: string, animalId: string, now: Date = new Date()): Promise<DaySignals> {
    const farm = await this.prisma.farm.findUnique({ where: { id: farmId }, select: { timezone: true } });
    const win = dayWindow(now, farm?.timezone ?? 'Asia/Aqtau');
    const [limits, grouped] = await Promise.all([
      this.prisma.signalLimit.findMany({ where: { farmId } }),
      this.prisma.signalEvent.groupBy({
        by: ['level'],
        where: { animalId, at: { gte: win.start, lt: win.end } },
        _count: { _all: true },
      }),
    ]);
    const used = (lvl: string) => grouped.find((g) => g.level === lvl)?._count._all ?? 0;
    const lim = (lvl: string) => effectiveLimit(limits.find((l) => l.level === lvl));
    return {
      day: win.day,
      sound: { used: used('SOUND'), limit: lim('SOUND') },
      vibration: { used: used('VIBRATION'), limit: lim('VIBRATION') },
      impulse: { used: 0, limit: lim('IMPULSE'), available: false },
    };
  }
}
