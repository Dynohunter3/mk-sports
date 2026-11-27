import { createContext, ReactNode, useContext, useMemo } from 'react';
import { useColorScheme, type ViewStyle } from 'react-native';

import { LEAGUE_BY_SLUG, type LeagueTheme as LeagueColors } from '@/data/leagues';
import { usePrefs } from '@/state/prefs';

import { alpha, luminance, mix, onColor, rgb } from './color';
import { dark, light, type Palette } from './palette';

export { BRAND, dark, light, type Palette } from './palette';

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
    heroTo: base.mode === 'dark' ? mix(th.secondary, base.bg, 0.35) : mix(th.primary, '#0B1222', 0.45),
    glass: base.mode === 'dark' ? alpha(mix(th.primary, '#FFFFFF', 0.2), 0.1) : base.glass,
    glassBorder: base.mode === 'dark' ? alpha(mix(th.primary, '#FFFFFF', 0.6), 0.16) : base.glassBorder,
  };
}

const ThemeCtx = createContext<Palette>(dark);
const BaseCtx = createContext<Palette>(dark);
const LeagueCtx = createContext<string | null>(null);

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
  return (
    <LeagueCtx.Provider value={league ?? null}>
      <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>
    </LeagueCtx.Provider>
  );
}

/** Content on a deep, competition-coloured header: uses the dark palette in both modes, so its text stays light. */
export function DarkSurface({ children }: { children: ReactNode }) {
  const t = useContext(ThemeCtx);
  const value = useDarkPalette();
  return value === t ? <>{children}</> : <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

/** The palette `DarkSurface` gives its content: the current one in dark mode, its dark twin in light mode. */
export function useDarkPalette(): Palette {
  const t = useContext(ThemeCtx);
  const base = useContext(BaseCtx);
  const league = useContext(LeagueCtx);
  return useMemo(() => {
    if (base.mode === 'dark') return t;
    const th = league ? LEAGUE_BY_SLUG[league]?.theme : null;
    return th ? leaguePalette(dark, th) : dark;
  }, [t, base.mode, league]);
}

/** The soft shadow that gives light-mode cards their depth (none in dark mode, where the glass edge does that). */
export function cardShadow(t: Palette, lift = 1): ViewStyle | null {
  if (t.mode === 'dark') return null;
  return { shadowColor: '#0B1A3A', shadowOpacity: 0.07 * lift, shadowRadius: 10 * lift, shadowOffset: { width: 0, height: 3 * lift }, elevation: 2 * lift };
}

export const useTheme = () => useContext(ThemeCtx);
export const useBaseTheme = () => useContext(BaseCtx);
export const leagueColors = (league: string | null | undefined): LeagueColors | null => (league ? LEAGUE_BY_SLUG[league]?.theme ?? null : null);
