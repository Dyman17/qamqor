import { BadRequestException } from '@nestjs/common';

export const SIGNAL_LEVELS = ['SOUND', 'VIBRATION', 'IMPULSE'] as const;
export type SignalLevelName = (typeof SIGNAL_LEVELS)[number];

export const MAX_DAILY_LIMIT = 1000;

export interface SignalLimitDto {
  level: SignalLevelName;
  dailyLimit: number | null;
  unlimited: boolean;
}

/**
 * Validates the body of PUT /farms/:id/signal-limits (a JSON array).
 * dailyLimit: null = not set, integer >= 1 (0 and negatives rejected); unlimited: boolean.
 */
export function parseSignalLimits(body: unknown): SignalLimitDto[] {
  if (!Array.isArray(body)) throw new BadRequestException('Ожидается массив лимитов');
  if (body.length > SIGNAL_LEVELS.length) throw new BadRequestException('Слишком много элементов');
  const seen = new Set<string>();
  return body.map((raw: any) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new BadRequestException('Некорректный элемент лимита');
    }
    const extra = Object.keys(raw).filter((k) => !['level', 'dailyLimit', 'unlimited'].includes(k));
    if (extra.length) throw new BadRequestException(`Неизвестные поля: ${extra.join(', ')}`);
    if (!SIGNAL_LEVELS.includes(raw.level)) throw new BadRequestException('level: SOUND, VIBRATION или IMPULSE');
    if (seen.has(raw.level)) throw new BadRequestException(`Повтор уровня ${raw.level}`);
    seen.add(raw.level);
    const dailyLimit = raw.dailyLimit ?? null;
    if (dailyLimit !== null && (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > MAX_DAILY_LIMIT)) {
      throw new BadRequestException(`dailyLimit: целое от 1 до ${MAX_DAILY_LIMIT} или null`);
    }
    const unlimited = raw.unlimited ?? false;
    if (typeof unlimited !== 'boolean') throw new BadRequestException('unlimited: boolean');
    return { level: raw.level, dailyLimit, unlimited };
  });
}

/** Effective limit for a level: null = no suppression. */
export function effectiveLimit(row?: { dailyLimit: number | null; unlimited: boolean } | null): number | null {
  if (!row || row.unlimited) return null;
  return row.dailyLimit ?? null;
}
