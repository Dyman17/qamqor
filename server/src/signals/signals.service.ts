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

export interface LimitedSignals {
  sound: boolean;
  vibrate: boolean;
  suppressed: boolean;
}

/**
 * Daily per-animal signal accounting. Days are local days of the farm time zone.
 * A limit that is not set (null) or `unlimited` never suppresses anything.
 */
@Injectable()
export class SignalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
  ) {}

  /**
   * Applies the farm daily limits to the signals the zone asks for. A level whose limit is
   * reached is suppressed (and a SIGNAL_LIMIT_REACHED alert is raised once per day);
   * every signal that is delivered is recorded.
   */
  async applyLimits(args: {
    farmId: string;
    timezone: string;
    animal: { id: string; name: string };
    deviceId: string;
    sound: boolean;
    vibrate: boolean;
    now: Date;
    /** false for a retried ping: limits are enforced but nothing is recorded. */
    record?: boolean;
  }): Promise<LimitedSignals> {
    const { farmId, animal, deviceId, now } = args;
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
    }
    return out;
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
