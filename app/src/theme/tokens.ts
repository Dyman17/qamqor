/**
 * Qamqor Design Tokens
 * Mirrored directly from docs/frontend/mockups/tokens.css (Direction A3 "Горизонт современный")
 */

export const colors = {
  // Surface layers
  surface0: '#0d1f14',       // Deepest steppe green background
  surface1: '#142a1c',       // Card & component container
  surface2: '#1b3624',       // Raised element / tonal block
  surface3: '#22442e',       // Top highlights & active states
  surfaceGlass: 'rgba(20, 42, 28, 0.88)',

  // Brand Accent (Fresh pasture lime glow)
  primary: '#bcf06f',
  primaryPressed: '#a3d957',
  onPrimary: '#0d1f14',
  accentGlow: 'rgba(188, 240, 111, 0.25)',

  // Typography Ink
  ink: '#f4fbf5',            // Pure text primary
  ink2: '#a4c2ac',           // Muted secondary text
  ink3: '#6a8d73',           // Captions / placeholders

  // Status & Telemetry Indicators
  ok: '#38e078',             // In Zone / Online
  okMap: '#22c55e',
  warning: '#facc15',        // Pre-border warning / Low Wi-Fi
  signal: '#f87171',         // Out of zone breach (Red)
  signalPressed: '#ef4444',
  offline: '#94a3b8',        // Device disconnected (Gray)

  // Borders
  borderSubtle: 'rgba(255, 255, 255, 0.08)',
  borderGlow: 'rgba(188, 240, 111, 0.22)',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 9999,
};

export const typography = {
  display: { fontSize: 28, fontWeight: '700' as const, color: colors.ink },
  title1: { fontSize: 22, fontWeight: '700' as const, color: colors.ink },
  title2: { fontSize: 18, fontWeight: '600' as const, color: colors.ink },
  bodyL: { fontSize: 16, fontWeight: '600' as const, color: colors.ink },
  body: { fontSize: 14, fontWeight: '400' as const, color: colors.ink },
  caption: { fontSize: 12, fontWeight: '500' as const, color: colors.ink2 },
  tabular: { fontVariant: ['tabular-nums' as const] },
};

