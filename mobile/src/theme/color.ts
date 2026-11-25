/** Colour maths shared by the theme (pure: no React, so it can be unit-tested). */
export function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}
/** WCAG relative luminance (sRGB, linearised). */
export function relLuminance(hex: string): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
/** WCAG contrast ratio between two colours, 1 to 21. 4.5 is the minimum for body text, 3 for large text. */
export function contrastRatio(a: string, b: string): number {
  const x = relLuminance(a);
  const y = relLuminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const INK = '#0B0F14';
/** Black or white text on a coloured background: whichever has the higher contrast ratio (yellow or light kits get black). */
export function onColor(hex: string): string {
  return contrastRatio(hex, '#FFFFFF') >= contrastRatio(hex, INK) ? '#FFFFFF' : INK;
}
/** Darken a colour just enough for white text on it to reach `min` contrast (team colours behind white headlines). */
export function forWhiteText(hex: string, min = 4.5): string {
  let c = hex;
  for (let i = 0; i < 30 && contrastRatio(c, '#FFFFFF') < min; i++) c = mix(c, '#000000', 0.06);
  return c;
}
export function alpha(hex: string, a: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
export function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
