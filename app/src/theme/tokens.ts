/**
 * Qamqor design tokens, brief v3 (direction A3, approved).
 * Values mirror docs/frontend/mockups/tokens.css and docs/frontend/app-design-brief.md sections 2-4.
 *
 * All numeric sizes here are DESIGN px at the 375 reference width (brief 5.5).
 * Screens must not use them directly for layout: read the scaled copy from `useTheme()`
 * (see ./scale.tsx). The static exports below are the s = 1 values.
 *
 * Font: brief 3.1 specifies Inter (self-hosted). No font files are bundled in app/ yet,
 * so no fontFamily is set and the platform system font is used.
 */

export const colors = {
  // Tonal ladder (2.2). surface3 is the dark navigation step (middle of the gradient).
  surface0: '#F6FAF4',
  surface1: '#E1EEDF',
  surface2: '#FDFEFB',
  surface2White: '#FFFFFF',
  surface3: '#0D4A2B',
  surface3Top: '#14603A',
  surface3Bottom: '#0A3D24',
  surfaceGlass: 'rgba(246, 250, 244, 0.93)',
  tonalPressed: '#D3E5D0',

  // Brand: one accent, dark green (2.1)
  primary: '#0D4A2B',
  primaryPressed: '#093820',
  primaryLift: '#14603A',
  onPrimary: '#FFFFFF',
  navText: '#CDE3D2',

  // Ink
  ink: '#0B1A12',
  ink2: '#31453A',
  ink3: '#46594D',
  disabledText: '#586A5E',

  // Status. `signal` is the only red.
  ok: '#0D6B3A',
  okDot: '#14934F',
  warning: '#7A4A00',
  signal: '#B52C08',
  signalPressed: '#8E2106',
  signalMap: '#FF5A1F',
  offline: '#46554C',

  // Lines
  line: '#5F7568',
  borderSubtle: 'rgba(11, 26, 18, 0.10)', // = line-soft, hairline separator
  focusInner: '#F6FAF4',
  focusOuter: '#0B1A12',

  // Map overlays (2.5)
  markerCasing: '#0F2A1C',
  mapLine: '#FFFFFF',
  mapFill: 'rgba(255, 255, 255, 0.04)',
  mapFillActive: 'rgba(255, 255, 255, 0.14)',

  scrim: 'rgba(11, 26, 18, 0.45)',
};

/** Space, 4 px step (brief 4). Names kept; larger steps added. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  x10: 40,
  x12: 48,
};

/** Nested radii (brief 4). `sm/md/lg/xl` kept as names, values follow brief v3. */
export const radius = {
  xs: 6,
  sm: 14,
  md: 18,
  btn: 20,
  lg: 22,
  xl: 24,
  sheet: 32,
  nav: 34,
  pill: 9999,
};

/** Fixed control sizes in design px (brief 4). Visible size; the 44 touch zone comes from hitSlop. */
export const sizes = {
  touch: 48,
  btn: 56,
  btnSm: 52,
  btnCompact: 36,
  fab: 48,
  nav: 68,
  peek: 204,
  icon: 24,
  iconTab: 26,
};

export type TypeRole =
  | 'display'
  | 'title1'
  | 'title2'
  | 'bodyL'
  | 'body'
  | 'bodySm'
  | 'label'
  | 'caption'
  | 'nav';

type Weight = '400' | '500' | '600' | '700';

export interface TypeSpec {
  size: number;
  line: number;
  weight: Weight;
  /** tracking in em */
  em: number;
}

/** Phone scale (brief 3.2), design px at 375. */
export const typePhone: Record<TypeRole, TypeSpec> = {
  display: { size: 40, line: 44, weight: '700', em: -0.045 },
  title1: { size: 26, line: 32, weight: '700', em: -0.03 },
  title2: { size: 20, line: 26, weight: '700', em: -0.025 },
  bodyL: { size: 17, line: 24, weight: '600', em: -0.015 },
  body: { size: 16, line: 22, weight: '400', em: 0 },
  bodySm: { size: 15, line: 22, weight: '400', em: 0 },
  label: { size: 17, line: 22, weight: '600', em: -0.01 },
  caption: { size: 13, line: 18, weight: '500', em: 0 },
  nav: { size: 12, line: 16, weight: '500', em: 0 },
};

/** Tablet scale (brief 3.3), width >= 768. Roles not listed there keep the phone value. */
export const typeTablet: Record<TypeRole, TypeSpec> = {
  ...typePhone,
  display: { ...typePhone.display, size: 44, line: 48 },
  title1: { ...typePhone.title1, size: 28, line: 34 },
  bodyL: { ...typePhone.bodyL, size: 18, line: 26 },
  body: { ...typePhone.body, size: 16, line: 24 },
  caption: { ...typePhone.caption, size: 14, line: 20 },
  nav: { ...typePhone.nav, size: 13, line: 18 },
};

const roleColor: Record<TypeRole, string> = {
  display: colors.ink,
  title1: colors.ink,
  title2: colors.ink,
  bodyL: colors.ink,
  body: colors.ink,
  bodySm: colors.ink,
  label: colors.ink,
  caption: colors.ink2,
  nav: colors.ink2,
};

export interface TextStyleToken {
  fontSize: number;
  lineHeight: number;
  fontWeight: Weight;
  letterSpacing: number;
  color: string;
}

/** Build a text style from a spec with the given size/line mapping (identity = design px). */
export function toTextStyle(
  role: TypeRole,
  spec: TypeSpec,
  fs: (n: number) => number,
  lh: (n: number) => number,
): TextStyleToken {
  const fontSize = fs(spec.size);
  return {
    fontSize,
    lineHeight: lh(spec.line),
    fontWeight: spec.weight,
    // brief 5.5.2: RN letterSpacing = em * scaled font size
    letterSpacing: spec.em * fontSize,
    color: roleColor[role],
  };
}

const identity = (n: number) => n;

/** Static typography at s = 1 (phone). Prefer `useTheme().typography` in screens. */
export const typography = {
  display: toTextStyle('display', typePhone.display, identity, identity),
  title1: toTextStyle('title1', typePhone.title1, identity, identity),
  title2: toTextStyle('title2', typePhone.title2, identity, identity),
  bodyL: toTextStyle('bodyL', typePhone.bodyL, identity, identity),
  body: toTextStyle('body', typePhone.body, identity, identity),
  bodySm: toTextStyle('bodySm', typePhone.bodySm, identity, identity),
  label: toTextStyle('label', typePhone.label, identity, identity),
  caption: toTextStyle('caption', typePhone.caption, identity, identity),
  nav: toTextStyle('nav', typePhone.nav, identity, identity),
  tabular: { fontVariant: ['tabular-nums' as const] },
};
