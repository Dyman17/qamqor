/**
 * Phone scaling core (brief v3, section 5.5). Pure functions, no react-native import,
 * so it can be unit-tested with `node --test`.
 *
 *   s = clamp(0.9, w / 375, 1);  w >= 768 (tablet layout) -> s = 1
 *   compact = w < 337.5          (single binary switch, no interpolation)
 *   fs(n) = max(11, n * s)       text floor 11
 *   slop(n) = max(0, (44 - n * s) / 2)   hitSlop per side so the touch zone is >= 44
 */
export const REF_WIDTH = 375;
export const MIN_SCALE = 0.9;
export const TABLET_WIDTH = 768;
export const COMPACT_WIDTH = 337.5;
export const MIN_FONT = 11;
export const MIN_TOUCH = 44;

export type Rounder = (n: number) => number;

export interface Scale {
  /** window width in dp */
  w: number;
  /** phone scale factor, 0.9..1; always 1 on tablet */
  s: number;
  /** limit mode (w < 337.5) */
  compact: boolean;
  /** tablet layout (w >= 768) */
  tablet: boolean;
  /** hairlines are always 1 real px (never StyleSheet.hairlineWidth) */
  hairline: 1;
  /** scale a size in design px (spacing, radius, control size, icon) */
  sz: (n: number) => number;
  /** scaled font size with the 11 px floor */
  fs: (n: number) => number;
  /** scaled line height, rounded to the nearest physical pixel */
  lh: (n: number) => number;
  /** hitSlop amount per side for a control of design size n */
  slop: (n: number) => number;
  /** ready-made hitSlop object for a control of design size n */
  hit: (n: number) => { top: number; bottom: number; left: number; right: number };
}

const clamp = (lo: number, v: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function makeScaleWith(w: number, round: Rounder): Scale {
  const tablet = w >= TABLET_WIDTH;
  const s = tablet ? 1 : clamp(MIN_SCALE, w / REF_WIDTH, 1);
  const slop = (n: number) => Math.max(0, (MIN_TOUCH - n * s) / 2);
  return {
    w,
    s,
    compact: !tablet && w < COMPACT_WIDTH,
    tablet,
    hairline: 1,
    sz: (n) => n * s,
    fs: (n) => Math.max(MIN_FONT, n * s),
    lh: (n) => round(n * s),
    slop,
    hit: (n) => {
      const p = slop(n);
      return { top: p, bottom: p, left: p, right: p };
    },
  };
}
