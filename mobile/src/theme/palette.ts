/** The two colour palettes (no React Native imports, so tests can check them). */
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

/**
 * Light mode: white cards with soft shadows on a cool off-white, and colours dark enough to read as text (each
 * text colour is at least 4.5:1 on the background; theme.test.ts checks it). Headers with white text (`Hero`, the
 * player page) stay deep in the competition's colour, heroFrom to heroTo, and their content uses the dark palette
 * (`DarkSurface`).
 */
export const light: Palette = {
  mode: 'light',
  bg: '#F3F6FA',
  surface: '#FFFFFF',
  surface2: '#EAEFF6',
  border: '#DCE3EE',
  text: '#0B1222',
  textDim: '#44526A',
  textMuted: '#5F6B80',
  brand: '#077D52',
  brandText: '#FFFFFF',
  accent2: '#006FA8',
  live: '#E11D48',
  win: '#15803D',
  loss: '#C81E1E',
  draw: '#64748B',
  pending: '#B45309',
  hot: '#C8135F',
  violet: '#7C3AED',
  gold: '#8F5F06',
  overlay: 'rgba(15,23,42,0.45)',
  // opaque: on Android a shadow shows through a see-through card
  glass: '#FFFFFF',
  glassStrong: 'rgba(255,255,255,0.96)',
  glassBorder: 'rgba(15,23,42,0.07)',
  glassHighlight: 'rgba(255,255,255,0)',
  heroFrom: '#1B3A8A',
  heroTo: '#0E1F4D',
  onHero: '#FFFFFF',
  pitch: '#2E8B57',
  pitchLine: 'rgba(255,255,255,0.45)',
};
