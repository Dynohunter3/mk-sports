import { createContext, ReactNode, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';

import { LEAGUE_BY_SLUG, type LeagueTheme as LeagueColors } from '@/data/leagues';
import { usePrefs } from '@/state/prefs';

/** MK Sports brand: electric green -> cyan on deep navy. */
export const BRAND = { green: '#2CF59A', cyan: '#16C6FF', navy: '#0B1430', ink: '#060A16' };

export const dark = {
  mode: 'dark' as const,
  bg: '#060A16',
  surface: '#0F1628',
  surface2: '#18223A',
  border: '#24304A',
  text: '#EEF3FA',
  textDim: '#A6B3C6',
  textMuted: '#6E7B90',
  brand: BRAND.green,
  brandText: '#04120B',
  accent2: BRAND.cyan,
  live: '#FF4D5E',
  win: '#22C55E',
  loss: '#F87171',
  draw: '#94A3B8',
  pending: '#F5A524',
  // expressive accents (celebrations, game, highlights)
  hot: '#FF3D81',
  violet: '#9B6BFF',
  gold: '#FFC93C',
  overlay: 'rgba(0,0,0,0.6)',
  // glass
  glass: 'rgba(255,255,255,0.055)',
  glassStrong: 'rgba(20,28,48,0.82)',
  glassBorder: 'rgba(255,255,255,0.10)',
  glassHighlight: 'rgba(255,255,255,0.09)',
  // hero gradient (top of screens)
  heroFrom: '#14245A',
  heroTo: '#060A16',
  onHero: '#FFFFFF',
  pitch: '#1E7A46',
  pitchLine: 'rgba(255,255,255,0.35)',
};

export type Palette = Omit<typeof dark, 'mode'> & { mode: 'dark' | 'light' };

export const light: Palette = {
  mode: 'light',
  bg: '#EEF2F8',
  surface: '#FFFFFF',
  surface2: '#E6ECF5',
  border: '#D3DCE8',
  text: '#0B1222',
  textDim: '#46556B',
  textMuted: '#7A879A',
  brand: '#0A9F63',
  brandText: '#FFFFFF',
  accent2: '#0090C7',
  live: '#E11D48',
  win: '#16A34A',
  loss: '#DC2626',
  draw: '#64748B',
  pending: '#B45309',
  hot: '#E11D74',
  violet: '#7C3AED',
  gold: '#B7791F',
  overlay: 'rgba(15,23,42,0.45)',
  glass: 'rgba(255,255,255,0.72)',
  glassStrong: 'rgba(255,255,255,0.9)',
  glassBorder: 'rgba(15,23,42,0.08)',
  glassHighlight: 'rgba(255,255,255,0.9)',
  heroFrom: '#1B3A8A',
  heroTo: '#EEF2F8',
  onHero: '#FFFFFF',
  pitch: '#2E8B57',
  pitchLine: 'rgba(255,255,255,0.45)',
};

/** Fallback sport colours (the API sends the authoritative ones). */
export const SPORT_COLORS: Record<string, string> = {
  football: '#22C55E',
  basketball: '#F97316',
  'american-football': '#8B5CF6',
  'ice-hockey': '#38BDF8',
  baseball: '#EF4444',
  cricket: '#3B82F6',
  tennis: '#EAB308',
  formula1: '#E11D48',
};

export const SPORT_ICONS: Record<string, string> = {
  football: 'soccer',
  basketball: 'basketball',
  cricket: 'cricket',
  tennis: 'tennis',
  'american-football': 'football',
  baseball: 'baseball',
  'ice-hockey': 'hockey-puck',
  formula1: 'flag-checkered',
  'rugby-union': 'rugby',
  volleyball: 'volleyball',
  combat: 'boxing-glove',
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 10, md: 14, lg: 20, xl: 28, pill: 999 };
/** Minimum touch target (Android guidelines: 48dp). */
export const TAP = 48;
/** Room the floating tab bar takes at the bottom of tab screens. */
export const TAB_BAR_SPACE = 96;

// ------------------------------------------------------------------ colour helpers
export { alpha, contrastRatio, forWhiteText, luminance, mix, onColor, relLuminance, rgb } from './color';
import { alpha, contrastRatio, forWhiteText, luminance, mix, onColor, relLuminance, rgb } from './color';

function distance(a: string, b: string): number {
  const x = rgb(a);
  const y = rgb(b);
  return Math.sqrt(x.reduce((s, v, i) => s + (v - y[i]) ** 2, 0)) / 441.7;
}

/** A team colour that reads on the current background (very dark or very light kits are lifted or toned). */
export function readable(hex: string | null | undefined, base: Palette, fallback?: string): string {
  if (!hex || !/^#?[0-9a-f]{3,8}$/i.test(hex)) return fallback ?? base.brand;
  const h = hex.startsWith('#') ? hex : `#${hex}`;
  const l = luminance(h);
  if (base.mode === 'dark') return l < 0.22 ? mix(h, '#FFFFFF', 0.42) : l < 0.32 ? mix(h, '#FFFFFF', 0.22) : h;
  return l > 0.82 ? mix(h, '#000000', 0.35) : h;
}

/** Home and away colours for a match: readable, and distinct from each other (a clash falls back to the palette). */
export function matchColors(home: string | null | undefined, away: string | null | undefined, base: Palette): [string, string] {
  const h = readable(home, base, base.brand);
  let a = readable(away, base, base.pending);
  if (distance(h, a) < 0.18) a = distance(h, base.pending) > 0.25 ? base.pending : base.accent2;
  return [h, a];
}

/** A competition's colours applied on top of the base palette. */
export function leaguePalette(base: Palette, th: LeagueColors): Palette {
  const accentOk = base.mode === 'dark' ? luminance(th.accent) > 0.32 : luminance(th.accent) < 0.62;
  const brand = accentOk ? th.accent : base.mode === 'dark' ? mix(th.accent, '#FFFFFF', 0.45) : mix(th.primary, '#000000', 0.1);
  return {
    ...base,
    brand,
    brandText: onColor(brand),
    accent2: base.mode === 'dark' ? mix(th.primary, '#FFFFFF', 0.35) : th.primary,
    heroFrom: th.primary,
    heroTo: base.mode === 'dark' ? mix(th.secondary, base.bg, 0.35) : mix(th.primary, base.bg, 0.82),
    glass: base.mode === 'dark' ? alpha(mix(th.primary, '#FFFFFF', 0.2), 0.1) : base.glass,
    glassBorder: base.mode === 'dark' ? alpha(mix(th.primary, '#FFFFFF', 0.6), 0.16) : base.glassBorder,
  };
}

const ThemeCtx = createContext<Palette>(dark);
const BaseCtx = createContext<Palette>(dark);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const { prefs } = usePrefs();
  const palette = useMemo(() => {
    const wanted = prefs.theme === 'system' ? (system === 'light' ? 'light' : 'dark') : prefs.theme;
    return wanted === 'light' ? light : dark;
  }, [prefs.theme, system]);
  return (
    <BaseCtx.Provider value={palette}>
      <ThemeCtx.Provider value={palette}>{children}</ThemeCtx.Provider>
    </BaseCtx.Provider>
  );
}

/** Re-themes everything inside it in a competition's colours (null = MK Sports colours). */
export function LeagueTheme({ league, children }: { league: string | null | undefined; children: ReactNode }) {
  const base = useContext(BaseCtx);
  const value = useMemo(() => {
    const th = league ? LEAGUE_BY_SLUG[league]?.theme : null;
    return th ? leaguePalette(base, th) : base;
  }, [base, league]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);
export const useBaseTheme = () => useContext(BaseCtx);
export const leagueColors = (league: string | null | undefined): LeagueColors | null => (league ? LEAGUE_BY_SLUG[league]?.theme ?? null : null);
