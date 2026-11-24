/**
 * Scorelines from expected goals: an independent-Poisson score grid with the Dixon-Coles adjustment for
 * low scores (the same model family the predictions use). Gives the most likely scores, over/under and
 * clean-sheet chances shown in the match page's goals outlook.
 */
const MAX = 8;

function poisson(l: number): number[] {
  const out = [Math.exp(-l)];
  for (let k = 1; k <= MAX; k++) out.push((out[k - 1] * l) / k);
  return out;
}

/** P[h][a] for 0..MAX goals each, normalised. rho < 0 lifts 0-0 and 1-1 slightly (Dixon-Coles). */
export function scoreGrid(lh: number, la: number, rho = -0.08): number[][] {
  const ph = poisson(Math.max(0.05, lh));
  const pa = poisson(Math.max(0.05, la));
  const tau = (h: number, a: number) =>
    h === 0 && a === 0 ? 1 - lh * la * rho : h === 0 && a === 1 ? 1 + lh * rho : h === 1 && a === 0 ? 1 + la * rho : h === 1 && a === 1 ? 1 - rho : 1;
  const g = ph.map((x, h) => pa.map((y, a) => Math.max(0, x * y * tau(h, a))));
  const total = g.flat().reduce((s, v) => s + v, 0);
  return g.map((row) => row.map((v) => v / total));
}

export function goalsOutlook(lh: number, la: number) {
  const g = scoreGrid(lh, la);
  const cells: { h: number; a: number; p: number }[] = [];
  g.forEach((row, h) => row.forEach((p, a) => cells.push({ h, a, p })));
  const sum = (f: (h: number, a: number) => boolean) => cells.filter((c) => f(c.h, c.a)).reduce((s, c) => s + c.p, 0);
  return {
    top: [...cells].sort((x, y) => y.p - x.p).slice(0, 5),
    over25: sum((h, a) => h + a >= 3),
    homeCleanSheet: sum((_, a) => a === 0),
    awayCleanSheet: sum((h) => h === 0),
    total: lh + la,
  };
}

/** A one-line read of the game from the expected goals. */
export function goalsRead(lh: number, la: number, home: string, away: string): string {
  const total = lh + la;
  const diff = lh - la;
  const tempo = total < 2.2 ? 'A tight, low-scoring game' : total > 3.1 ? 'Goals expected at both ends' : 'An average number of goals';
  const edge = Math.abs(diff) < 0.25 ? 'with little between the sides' : `with ${diff > 0 ? home : away} expected to create more (${Math.max(lh, la).toFixed(1)} vs ${Math.min(lh, la).toFixed(1)} expected goals)`;
  return `${tempo} (${total.toFixed(1)} expected), ${edge}.`;
}
