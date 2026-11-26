/** Whole-percent home/draw/away chances that always add up to 100 (probability picks). */
export type Pct = { home: number; draw: number; away: number };
type K = keyof Pct;

/** Change one outcome by `delta` points; the others give or take the difference in proportion to their size. */
export function adjustPct(p: Pct, key: K, delta: number, keys: K[] = ['home', 'draw', 'away']): Pct {
  const others = keys.filter((k) => k !== key);
  const v = Math.max(0, Math.min(100, p[key] + delta));
  const diff = v - p[key];
  if (!diff) return p;
  const out: Pct = { ...p, [key]: v };
  const pool = others.reduce((s, k) => s + p[k], 0);
  let left = -diff;
  others.forEach((k, i) => {
    const share = i === others.length - 1 ? left : Math.round(pool > 0 ? (-diff * p[k]) / pool : -diff / others.length);
    out[k] = Math.max(0, p[k] + share);
    left -= share;
  });
  return normalisePct(out, keys);
}

/** Round to whole points that add up to exactly 100 (largest remainders), zero for outcomes not in `keys`. */
export function normalisePct(p: Pct, keys: K[] = ['home', 'draw', 'away']): Pct {
  const raw = keys.map((k) => Math.max(0, p[k]));
  const total = raw.reduce((a, b) => a + b, 0) || 1;
  const exact = raw.map((x) => (x / total) * 100);
  const floor = exact.map(Math.floor);
  let rest = 100 - floor.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => [x - floor[i], i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (rest <= 0) break;
    floor[i] += 1;
    rest -= 1;
  }
  const out: Pct = { home: 0, draw: 0, away: 0 };
  keys.forEach((k, i) => (out[k] = floor[i]));
  return out;
}

/** The call a set of chances makes (home first on ties, as the game scores it). */
export function callOf(p: Pct): K {
  return p.home >= p.draw && p.home >= p.away ? 'home' : p.away >= p.draw ? 'away' : 'draw';
}
