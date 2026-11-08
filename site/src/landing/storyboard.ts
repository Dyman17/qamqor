// Scroll storyboard data (site-brief 3.2) and pure helpers. No three.js import here: this file is part of the shell chunk.

export type V3 = [number, number, number];

export interface SceneDef {
  id: number;
  a: number; // P start
  b: number; // P end
  p0: V3; // Euler (deg, order YXZ) at scene start
  p1: V3; // at the end of the move
  p2?: V3; // optional drift target at scene end (scene 5)
  pos0: V3;
  pos1: V3;
  d0: number;
  d1: number;
  titleKey: string;
}

export const SCENES: SceneDef[] = [
  { id: 1, a: 0.0, b: 0.14, p0: [14, -32, 0], p1: [16, -18, 0], pos0: [0, -0.28, 0], pos1: [0, -0.28, 0], d0: 6.6, d1: 6.2, titleKey: 'l.hero.title' },
  { id: 2, a: 0.14, b: 0.30, p0: [16, -18, 0], p1: [58, -10, 0], pos0: [0.95, 0, 0], pos1: [0.95, 0, 0], d0: 6.2, d1: 5.4, titleKey: 'l.s2.title' },
  { id: 3, a: 0.30, b: 0.46, p0: [58, -10, 0], p1: [8, 84, 0], pos0: [-0.95, 0, 0], pos1: [-0.8, 0, 0], d0: 5.4, d1: 4.2, titleKey: 'l.s3.title' },
  { id: 4, a: 0.46, b: 0.62, p0: [8, 84, 0], p1: [-96, 12, 0], pos0: [0.95, 0, 0], pos1: [0.95, 0, 0], d0: 4.2, d1: 5.0, titleKey: 'l.s4.title' },
  { id: 5, a: 0.62, b: 0.82, p0: [-96, 12, 0], p1: [24, -34, 0], p2: [24, -50, 0], pos0: [0, -0.05, 0], pos1: [0, -0.05, 0], d0: 5.0, d1: 8.6, titleKey: 'l.s5.title' },
  { id: 6, a: 0.82, b: 1.0, p0: [24, -50, 0], p1: [12, -28, 0], pos0: [1.0, 0, 0], pos1: [1.0, 0, 0], d0: 8.6, d1: 7.0, titleKey: 'l.s6.title' },
];

/** Windows (in P) shared by the position/distance blend around scene boundaries: +-0.03 (site-brief 3.1). */
export const BLEND = 0.03;
/** Fraction of a scene (scenes 2..6) in which the pose moves; the remaining 60% is the hold. */
export const MOVE_FRACTION = 0.4;

export const clamp = (v: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, v));
export const smoother = (t: number): number => { const x = clamp(t); return x * x * x * (x * (x * 6 - 15) + 10); };
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const lerp3 = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

export function sceneAt(P: number): number {
  for (let i = SCENES.length - 1; i >= 0; i--) if (P >= SCENES[i].a) return i;
  return 0;
}

/** Explode parameter e (site-brief 3.2 scene 5/6): 0 -> 1 on 0.66..0.74, held to 0.82, back to 0 on 0.82..0.88. */
export function explode(P: number): number {
  if (P < 0.82) return smoother((P - 0.66) / 0.08);
  return 1 - smoother((P - 0.82) / 0.06);
}

/** Dimension-line progress 0..1 per line (length, width, height): drawn on 0.88..0.96. */
export function dimProgress(P: number): [number, number, number] {
  const s = (a: number, b: number) => clamp((P - a) / (b - a));
  return [s(0.88, 0.9067), s(0.9067, 0.9333), s(0.9333, 0.96)];
}

export interface Keyframe {
  euler: V3; // degrees, order YXZ
  pos: V3;
  d: number; // camera distance, scene units
  e: number; // explode 0..1
  dims: [number, number, number];
}

/**
 * Pose, position, distance at progress P. Pose moves during the first 40% of scenes 2..6 (so it is held for the last
 * 60%); position and distance are blended across the +-0.03 window around each boundary. All channels are continuous
 * (each scene ends where the next one starts) and drift +-6 deg about Y inside the hold.
 */
export function keyframeAt(P: number): Keyframe {
  const p = clamp(P);
  const i = sceneAt(p);
  const s = SCENES[i];
  const t = clamp((p - s.a) / (s.b - s.a));
  const moveT = i === 0 ? t : smoother(t / MOVE_FRACTION);
  let euler: V3;
  if (s.p2) {
    // scene 5: move to p1 in the first 40%, then drift linearly to p2
    euler = t < MOVE_FRACTION ? lerp3(s.p0, s.p1, smoother(t / MOVE_FRACTION)) : lerp3(s.p1, s.p2, (t - MOVE_FRACTION) / (1 - MOVE_FRACTION));
  } else {
    euler = lerp3(s.p0, s.p1, moveT);
  }
  euler = [euler[0], euler[1] + 6 * Math.sin(Math.PI * t) * (i === 0 ? 0 : 1) * Math.sin(t * Math.PI * 2), euler[2]];

  const own = (sc: SceneDef, tt: number) => ({ pos: lerp3(sc.pos0, sc.pos1, tt), d: lerp(sc.d0, sc.d1, tt) });
  let { pos, d } = own(s, t);
  // blend with the neighbour near boundaries
  if (i > 0 && p < s.a + BLEND) {
    const prev = own(SCENES[i - 1], 1);
    const k = smoother((p - (s.a - BLEND)) / (2 * BLEND));
    pos = lerp3(prev.pos, own(s, 0).pos, k); d = lerp(prev.d, own(s, 0).d, k);
  } else if (i < SCENES.length - 1 && p > s.b - BLEND) {
    const next = own(SCENES[i + 1], 0);
    const k = smoother((p - (s.b - BLEND)) / (2 * BLEND));
    pos = lerp3(own(s, 1).pos, next.pos, k); d = lerp(own(s, 1).d, next.d, k);
  }
  return { euler, pos, d, e: explode(p), dims: dimProgress(p) };
}

/** Scene text visibility (opacity 0..1), fades at both edges; scene 1 starts visible, scene 6 stays to the end. */
export function textOpacity(i: number, P: number): number {
  const s = SCENES[i];
  const fade = 0.02;
  const inA = i === 0 ? 1 : smoother((P - (s.a + 0.015)) / fade);
  const outA = i === SCENES.length - 1 ? 1 : 1 - smoother((P - (s.b - 0.015 - fade)) / fade);
  return clamp(Math.min(inA, outA));
}

// ---- Callouts (site-brief 2.3). Points in STL mm (x, y, z); normal in STL axes for the facing test. ----
export interface CalloutDef {
  id: string;
  key: string; // i18n key
  scene: number; // 1-based
  from: number; // P at which it appears
  to: number; // P at which it disappears
  points: V3[];
  normal: V3;
  lid?: boolean; // moves with the lid (explode)
  off: [number, number]; // label offset from the first point, px (desktop)
  facing?: number; // dot threshold, default 0.15
}

export const CALLOUTS: CalloutDef[] = [
  { id: 'panel', key: 'l.co.panel', scene: 2, from: 0.22, to: 0.31, points: [[-20, 0, 90]], normal: [0, 0, 1], off: [-150, -70] },
  { id: 'gps', key: 'l.co.gps', scene: 2, from: 0.22, to: 0.31, points: [[30, 0, 90]], normal: [0, 0, 1], off: [110, -90] },
  { id: 'speaker', key: 'l.co.speaker', scene: 3, from: 0.38, to: 0.47, points: [[-105, 0, 42]], normal: [-1, 0, 0], off: [-10, -190] },
  { id: 'hole', key: 'l.co.hole', scene: 3, from: 0.38, to: 0.47, points: [[105, 0, 42]], normal: [1, 0, 0], off: [130, 90] },
  { id: 'motor', key: 'l.co.motor', scene: 4, from: 0.55, to: 0.63, points: [[0, 22, 0]], normal: [0, 0, -1], off: [-30, -150] },
  { id: 'sensor', key: 'l.co.sensor', scene: 4, from: 0.55, to: 0.63, points: [[0, 0, 0]], normal: [0, 0, -1], off: [150, 100] },
  { id: 'holes5', key: 'l.co.holes5', scene: 4, from: 0.55, to: 0.63, points: [[-20, -20, 0], [20, -20, 0]], normal: [0, 0, -1], off: [-170, 120] },
  { id: 'arch', key: 'l.co.arch', scene: 4, from: 0.55, to: 0.63, points: [[0, -30, 6]], normal: [0, 0, -1], off: [20, 150] },
  { id: 'hinge', key: 'l.co.hinge', scene: 5, from: 0.72, to: 0.82, points: [[0, 48, 70]], normal: [0, 0.6, 0.6], lid: true, off: [150, -90], facing: -0.4 },
  { id: 'latch', key: 'l.co.latch', scene: 5, from: 0.72, to: 0.82, points: [[55, -44, 70]], normal: [0, -1, 0], lid: true, off: [140, 70], facing: -0.2 },
];

/** Dimension lines (scene 6): endpoints in STL mm, offset outside the box. Order of drawing: length, width, height. */
export const DIMS: { id: 'length' | 'width' | 'height'; a: V3; b: V3; label: V3 }[] = [
  { id: 'length', a: [-105, -48, -10], b: [105, -48, -10], label: [0, -48, -10] },
  { id: 'width', a: [112, -40, -10], b: [112, 40, -10], label: [112, 0, -10] },
  { id: 'height', a: [-114, -48, 0], b: [-114, -48, 90], label: [-114, -48, 45] },
];

/** Spotlight / CSS beam strength along the scroll (site-brief 11.4): smootherstep ramps between holds. */
export function beamAt(P: number): number {
  const m = (a: number, b: number, t: number) => lerp(a, b, smoother(t));
  if (P < 0.3) return 1;
  if (P < 0.46) return m(1, 0.55, (P - 0.3) / 0.16);
  if (P < 0.59) return 0.55;
  if (P < 0.65) return m(0.55, 0.85, (P - 0.59) / 0.06);
  if (P < 0.79) return 0.85;
  if (P < 0.85) return m(0.85, 0.6, (P - 0.79) / 0.06);
  return 0.6;
}
