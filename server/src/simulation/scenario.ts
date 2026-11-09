import { Pt, PenGeometry, add, moveToward, rotate, scale, sub, unit, len } from './geometry';

/** Deterministic PRNG (mulberry32): same seed, same scenario. No dependency. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type Phase =
  | 'GRAZE'
  | 'APPROACH'
  | 'TURN_BACK'
  | 'BREAKOUT'
  | 'ESCAPED'
  | 'HERDED_BACK'
  | 'GPS_LOST'
  | 'OFFLINE';

/** Plausible cattle pulse, BPM: 48-84, small noise; higher while the animal is escaping or being herded. */
export function heartRateFor(phase: Phase, rng: () => number = Math.random): number {
  const centre =
    phase === 'BREAKOUT' || phase === 'ESCAPED' ? 76 : phase === 'HERDED_BACK' || phase === 'TURN_BACK' ? 70 : phase === 'APPROACH' ? 62 : 58;
  const noise = (rng() + rng() + rng() - 1.5) * 8; // about +-6 bpm
  return Math.max(48, Math.min(84, Math.round(centre + noise)));
}

/** Resting pulse for manual pings. */
export const restingHeartRate = (): number => heartRateFor('GRAZE');

export type Plan = 'TURN_BACK' | 'BREAKOUT';
/** Scripted opening role of an animal: guarantees every key event within the first minutes. */
export type Role = Plan | 'GPS_LOST' | 'OFFLINE';
export const SCRIPTED_ROLES: Role[] = ['TURN_BACK', 'BREAKOUT', 'GPS_LOST', 'OFFLINE'];

export interface AnimalSim {
  phase: Phase;
  pos: Pt;
  heading: number;
  ticks: number;
  grazeLeft: number;
  plan: Plan;
  /** Fixed plan of a scripted animal (null = 70/30 draw). */
  forcedPlan: Plan | null;
  /** Interior target for TURN_BACK / HERDED_BACK. */
  home: Pt | null;
  outDir: Pt | null;
  crossed: boolean;
  holdLeft: number;
  gpsLeft: number;
  silentLeft: number;
  /** Scripted GPS_LOST / OFFLINE start tick. */
  eventAtTick: number | null;
  eventKind: 'GPS_LOST' | 'OFFLINE' | null;
}

export interface FarmSim {
  rng: () => number;
  /** Earliest time (ms) the next random GPS_LOST / OFFLINE may start: one of each kind per 8-10 min. */
  nextGpsAt: number;
  nextOfflineAt: number;
}

export interface StepCfg {
  /** 1, 2, 5 or 10. */
  speed: number;
  tickSec: number;
  /** Demo-only shortened "collar is silent" threshold (seconds). */
  offlineSec: number;
}

export interface StepOut {
  /** null = the collar sends nothing this tick. */
  ping: { pos: Pt; accuracy: number; speedKmh: number } | null;
  /** The silence is long enough: the simulator pushes lastHeartbeatAt back and runs the offline watcher. */
  goOffline?: boolean;
  phase: Phase;
}

export const newFarmSim = (seed: number, now: number): FarmSim => ({
  rng: mulberry32(seed),
  nextGpsAt: now + 4 * 60_000,
  nextOfflineAt: now + 6 * 60_000,
});

const randTicks = (rng: () => number, lo: number, hi: number, speed: number) =>
  Math.max(2, Math.ceil((lo + rng() * (hi - lo)) / speed));

function base(pos: Pt, rng: () => number, speed: number): AnimalSim {
  return {
    phase: 'GRAZE',
    pos,
    heading: rng() * Math.PI * 2,
    ticks: 0,
    grazeLeft: randTicks(rng, 15, 30, speed),
    plan: 'TURN_BACK',
    forcedPlan: null,
    home: null,
    outDir: null,
    crossed: false,
    holdLeft: 0,
    gpsLeft: 0,
    silentLeft: 0,
    eventAtTick: null,
    eventKind: null,
  };
}

/** Fresh state of an animal. A scripted role makes the opening deterministic (see SCRIPTED_ROLES). */
export function newAnimalSim(pen: PenGeometry, rng: () => number, role: Role | null, speed = 1): AnimalSim {
  if (role === 'TURN_BACK' || role === 'BREAKOUT') {
    // 45-80 m from the border: the approach shows GREEN, YELLOW, ORANGE within the first minute.
    const a = base(pen.interiorPoint(rng, 45, 80), rng, speed);
    a.phase = 'APPROACH';
    a.plan = role;
    a.forcedPlan = role;
    return a;
  }
  const a = base(pen.interiorPoint(rng, 25), rng, speed);
  if (role === 'GPS_LOST' || role === 'OFFLINE') {
    a.eventKind = role;
    a.eventAtTick = 2;
  }
  return a;
}

/** Restores an animal after a server restart: GRAZE at the last known position (if it is still inside). */
export function restoreAnimalSim(pen: PenGeometry, rng: () => number, last: Pt | null, speed = 1): AnimalSim {
  if (last && pen.inside(last) && pen.edgeDist(last) >= 22) return base(last, rng, speed);
  return base(pen.interiorPoint(rng, 25), rng, speed);
}

const kmh = (stepM: number, tickSec: number) => Math.min(12, (stepM * 3.6) / tickSec);
const heading = (from: Pt, to: Pt) => Math.atan2(to.y - from.y, to.x - from.x);

function goodFix(rng: () => number) {
  return 3 + rng() * 4;
}

/**
 * One tick of one animal. Pure: no clock, no database. The caller sends the ping through the
 * real telemetry pipeline, so zones, limits and alerts come from the production logic.
 *
 * Zone speed note: the reported speed never exceeds 12 km/h, otherwise the server would classify
 * the crossing as ESCAPE (speed > 15 km/h) and the RED zone would be skipped.
 */
export function stepAnimal(a: AnimalSim, pen: PenGeometry, farm: FarmSim, now: number, cfg: StepCfg): StepOut {
  const { rng } = farm;
  const sp = Math.max(1, cfg.speed);
  a.ticks++;

  switch (a.phase) {
    case 'GRAZE': {
      // Scripted opening events, then rare random ones (one of each kind per 8-10 min per farm).
      if (a.eventKind && a.eventAtTick !== null && a.ticks >= a.eventAtTick) {
        const kind = a.eventKind;
        a.eventKind = null;
        a.eventAtTick = null;
        return startEvent(a, farm, now, cfg, kind, false);
      }
      if (a.ticks > 3) {
        if (now >= farm.nextGpsAt && rng() < 0.04) return startEvent(a, farm, now, cfg, 'GPS_LOST', true);
        if (now >= farm.nextOfflineAt && rng() < 0.04) return startEvent(a, farm, now, cfg, 'OFFLINE', true);
      }
      a.heading += (rng() - 0.5) * 0.9;
      const step = rng() * 5 * Math.min(sp, 2);
      const cand = add(a.pos, scale({ x: Math.cos(a.heading), y: Math.sin(a.heading) }, step));
      let moved = 0;
      if (pen.inside(cand) && pen.edgeDist(cand) >= 22) {
        a.pos = cand;
        moved = step;
      } else {
        // Reflect: turn back towards the deeper part of the pen.
        a.heading = heading(a.pos, pen.bestInterior()) + (rng() - 0.5) * 0.6;
      }
      if (--a.grazeLeft <= 0) {
        a.phase = 'APPROACH';
        a.plan = a.forcedPlan ?? (rng() < 0.7 ? 'TURN_BACK' : 'BREAKOUT');
      }
      return { ping: { pos: a.pos, accuracy: goodFix(rng), speedKmh: kmh(moved, cfg.tickSec) }, phase: 'GRAZE' };
    }

    case 'APPROACH': {
      const { q, dist } = pen.nearest(a.pos);
      if (dist <= 4.5) {
        a.crossed = false;
        a.outDir = unit(sub(q, a.pos), unit(sub(q, pen.bestInterior())));
        a.home = pen.interiorPoint(rng, 30);
        a.phase = a.plan === 'BREAKOUT' ? 'BREAKOUT' : 'TURN_BACK';
        return stepAnimal(a, pen, farm, now, cfg);
      }
      // Never jump over a zone: GREEN -> YELLOW (>= 18 m) -> ORANGE (~4 m), whatever the speed.
      const want = 14 * sp;
      let step = dist > 20 ? Math.min(want, dist - 18) : Math.min(want, dist - 4);
      step = Math.max(step, 0.5);
      const before = a.pos;
      a.pos = moveToward(a.pos, q, step);
      return { ping: { pos: a.pos, accuracy: goodFix(rng), speedKmh: kmh(len(sub(a.pos, before)), cfg.tickSec) }, phase: 'APPROACH' };
    }

    case 'TURN_BACK': {
      // The animal reacted to the signal: back towards the interior.
      const home = a.home ?? pen.bestInterior();
      const before = a.pos;
      a.pos = moveToward(a.pos, home, 14 * sp);
      if ((pen.inside(a.pos) && pen.edgeDist(a.pos) > 25) || a.ticks > 60) {
        a.phase = 'GRAZE';
        a.ticks = 0;
        a.grazeLeft = randTicks(rng, 15, 30, sp);
      }
      return { ping: { pos: a.pos, accuracy: goodFix(rng), speedKmh: kmh(len(sub(a.pos, before)), cfg.tickSec) }, phase: 'TURN_BACK' };
    }

    case 'BREAKOUT': {
      const before = a.pos;
      const dir = a.outDir ?? { x: 1, y: 0 };
      const wanted = a.crossed ? 30 * sp : pen.edgeDist(a.pos) + 15;
      let next: Pt | null = null;
      for (const deg of [0, 40, -40, 80, -80, 120, -120, 180]) {
        const d = rotate(dir, (deg * Math.PI) / 180);
        const cand = add(a.pos, scale(d, wanted));
        if (!pen.inside(cand)) {
          next = cand;
          a.outDir = d;
          break;
        }
      }
      if (!next) {
        // The shape allows no way out from here: the animal turns back instead.
        a.phase = 'TURN_BACK';
        return stepAnimal(a, pen, farm, now, cfg);
      }
      a.pos = next;
      a.crossed = true;
      if (pen.edgeDist(a.pos) > 105) {
        a.phase = 'ESCAPED';
        a.holdLeft = Math.max(2, Math.ceil(3 / sp));
      }
      return { ping: { pos: a.pos, accuracy: goodFix(rng), speedKmh: kmh(len(sub(a.pos, before)), cfg.tickSec) }, phase: 'BREAKOUT' };
    }

    case 'ESCAPED': {
      // Far outside: the server disarms the signals (anti-panic) and shortens the ping interval.
      const jitter = { x: (rng() - 0.5) * 2, y: (rng() - 0.5) * 2 };
      if (--a.holdLeft <= 0) {
        a.phase = 'HERDED_BACK';
        a.ticks = 0;
        a.home = pen.interiorPoint(rng, 30);
      }
      return { ping: { pos: add(a.pos, jitter), accuracy: goodFix(rng), speedKmh: 0 }, phase: 'ESCAPED' };
    }

    case 'HERDED_BACK': {
      const home = a.home ?? pen.bestInterior();
      const before = a.pos;
      a.pos = a.ticks > 60 ? { ...home } : moveToward(a.pos, home, 35 * sp);
      if (pen.inside(a.pos) && pen.edgeDist(a.pos) > 25) {
        a.phase = 'GRAZE';
        a.ticks = 0;
        a.grazeLeft = randTicks(rng, 15, 30, sp);
      }
      return { ping: { pos: a.pos, accuracy: goodFix(rng), speedKmh: kmh(len(sub(a.pos, before)), cfg.tickSec) }, phase: 'HERDED_BACK' };
    }

    case 'GPS_LOST': {
      // Two pings with a useless fix (zone UNKNOWN, GPS_LOST alert), then the fix is back.
      const accuracy = 60 + rng() * 20;
      if (--a.gpsLeft <= 0) {
        a.phase = 'GRAZE';
        a.ticks = 0;
        a.grazeLeft = randTicks(rng, 15, 30, sp);
      }
      return { ping: { pos: a.pos, accuracy, speedKmh: 0 }, phase: 'GPS_LOST' };
    }

    case 'OFFLINE': {
      // The collar is silent. Demo-only: the real 15 min threshold is shortened to cfg.offlineSec.
      if (a.silentLeft > 0) {
        a.silentLeft--;
        if (a.silentLeft === 0) {
          a.holdLeft = Math.max(1, Math.ceil(3 / sp));
          return { ping: null, goOffline: true, phase: 'OFFLINE' };
        }
        return { ping: null, phase: 'OFFLINE' };
      }
      if (--a.holdLeft > 0) return { ping: null, phase: 'OFFLINE' };
      // Back on air: DEVICE_RESTORED.
      a.phase = 'GRAZE';
      a.ticks = 0;
      a.grazeLeft = randTicks(rng, 15, 30, sp);
      return { ping: { pos: a.pos, accuracy: goodFix(rng), speedKmh: 0 }, phase: 'OFFLINE' };
    }
  }
}

function startEvent(
  a: AnimalSim,
  farm: FarmSim,
  now: number,
  cfg: StepCfg,
  kind: 'GPS_LOST' | 'OFFLINE',
  random: boolean,
): StepOut {
  const sp = Math.max(1, cfg.speed);
  const cooldown = (8 + farm.rng() * 2) * 60_000;
  if (kind === 'GPS_LOST') {
    if (random) farm.nextGpsAt = now + cooldown;
    // Two pings with a useless fix in total; this tick is the first one.
    a.phase = 'GPS_LOST';
    a.gpsLeft = 1;
    return { ping: { pos: a.pos, accuracy: 60 + farm.rng() * 20, speedKmh: 0 }, phase: 'GPS_LOST' };
  }
  if (random) farm.nextOfflineAt = now + cooldown;
  a.phase = 'OFFLINE';
  a.silentLeft = Math.max(2, Math.ceil(cfg.offlineSec / cfg.tickSec / sp));
  a.holdLeft = 0;
  return { ping: null, phase: 'OFFLINE' };
}
