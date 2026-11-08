/**
 * Day boundaries in a farm's IANA time zone (daily signal limits reset at local midnight).
 * Uses Intl only (no dependency). Default zone of the project: Asia/Aqtau (UTC+5).
 */
const FMT_CACHE = new Map<string, Intl.DateTimeFormat>();

function fmt(tz: string): Intl.DateTimeFormat {
  let f = FMT_CACHE.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    FMT_CACHE.set(tz, f);
  }
  return f;
}

function parts(tz: string, utcMs: number) {
  const o: Record<string, number> = {};
  for (const p of fmt(tz).formatToParts(new Date(utcMs))) {
    if (p.type !== 'literal') o[p.type] = parseInt(p.value, 10);
  }
  return o;
}

/** Offset of `tz` from UTC at the given instant, in ms (+5h for Asia/Aqtau). */
export function tzOffsetMs(tz: string, utcMs: number): number {
  const p = parts(tz, utcMs);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

function localMidnightUtc(tz: string, y: number, m: number, d: number): number {
  const guess = Date.UTC(y, m - 1, d);
  let start = guess - tzOffsetMs(tz, guess);
  start = guess - tzOffsetMs(tz, start); // second pass handles zones whose offset changes that day
  return start;
}

export interface DayWindow {
  /** Local calendar date, YYYY-MM-DD. */
  day: string;
  /** Local midnight (inclusive), as an instant. */
  start: Date;
  /** Next local midnight (exclusive). */
  end: Date;
}

export function dayWindow(now: Date, tz: string): DayWindow {
  let zone = tz;
  try {
    fmt(zone);
  } catch {
    zone = 'Asia/Aqtau';
  }
  const p = parts(zone, now.getTime());
  const start = localMidnightUtc(zone, p.year, p.month, p.day);
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  const end = localMidnightUtc(zone, next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
  const day = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  return { day, start: new Date(start), end: new Date(end) };
}
