import React, { createContext, useContext, useMemo } from 'react';
import { PixelRatio, useWindowDimensions } from 'react-native';
import { makeScaleWith, Scale } from './scaleCore';
import {
  colors,
  radius as radiusBase,
  sizes as sizesBase,
  spacing as spacingBase,
  toTextStyle,
  typePhone,
  typeTablet,
  TextStyleToken,
  TypeRole,
} from './tokens';

export type { Scale } from './scaleCore';

/** makeScale(w) -> { s, fs, lh, slop, hit, hairline: 1, compact, ... } (brief 5.5). */
export function makeScale(w: number): Scale {
  return makeScaleWith(w, (n) => PixelRatio.roundToNearestPixel(n));
}

export interface Theme {
  scale: Scale;
  colors: typeof colors;
  /** scaled space / radius / control sizes (design px * s) */
  spacing: Record<keyof typeof spacingBase, number>;
  radius: Record<keyof typeof radiusBase, number>;
  sizes: Record<keyof typeof sizesBase, number>;
  typography: Record<TypeRole, TextStyleToken> & { tabular: { fontVariant: 'tabular-nums'[] } };
  /** scale any design px value (icons, marker diameters, one-off sizes) */
  sz: Scale['sz'];
  fs: Scale['fs'];
  lh: Scale['lh'];
  /** hitSlop for a control of design size n */
  hit: Scale['hit'];
  hairline: 1;
  /** compact (limit) mode: w < 337.5 */
  compact: boolean;
}

function scaleRecord<K extends string>(
  rec: Record<K, number>,
  sz: (n: number) => number,
): Record<K, number> {
  const out = {} as Record<K, number>;
  (Object.keys(rec) as K[]).forEach((k) => {
    // the pill radius is a sentinel, not a size
    out[k] = rec[k] >= 9999 ? rec[k] : sz(rec[k]);
  });
  return out;
}

export function makeTheme(w: number): Theme {
  const scale = makeScale(w);
  const specs = scale.tablet ? typeTablet : typePhone;
  const typo = { tabular: { fontVariant: ['tabular-nums' as const] } } as Theme['typography'];
  (Object.keys(specs) as TypeRole[]).forEach((role) => {
    typo[role] = toTextStyle(role, specs[role], scale.fs, scale.lh);
  });
  const sp = scaleRecord(spacingBase, scale.sz);
  // compact (brief 5.5.3): screen margins and block padding 16 -> 12, horizontal gaps 12 -> 8
  if (scale.compact) {
    sp.lg = scale.sz(12);
    sp.md = scale.sz(8);
  }
  return {
    scale,
    colors,
    spacing: sp,
    radius: scaleRecord(radiusBase, scale.sz),
    sizes: scaleRecord(sizesBase, scale.sz),
    typography: typo,
    sz: scale.sz,
    fs: scale.fs,
    lh: scale.lh,
    hit: scale.hit,
    hairline: 1,
    compact: scale.compact,
  };
}

const ThemeContext = createContext<Theme | null>(null);

/** Provides the theme for the current WINDOW width; recomputes on rotation / split-screen. */
export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { width } = useWindowDimensions();
  const theme = useMemo(() => makeTheme(Math.round(width * 100) / 100), [width]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
};

export function useTheme(): Theme {
  const t = useContext(ThemeContext);
  if (!t) throw new Error('useTheme must be used inside <ThemeProvider>');
  return t;
}

export function useScale(): Scale {
  return useTheme().scale;
}
