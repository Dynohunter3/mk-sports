/**
 * "Deserved" results from expected goals. Each shot is a separate chance to score with probability equal to its
 * xG, so a team's goals follow a Poisson-binomial distribution over its shots. From both teams' distributions:
 * how often each result would happen on those chances, and the expected points (3 for a win, 1 for a draw).
 */

const MAX_GOALS = 15;

/** P(goals = k) for k = 0..MAX_GOALS, from per-shot scoring chances (exact, by dynamic programming). */
export function goalsDistribution(shots: number[]): number[] {
  let d = [1];
  for (const raw of shots) {
    const p = Math.min(0.99, Math.max(0, raw));
    const next = new Array(Math.min(d.length + 1, MAX_GOALS + 1)).fill(0);
    for (let k = 0; k < d.length; k++) {
      next[k] += d[k] * (1 - p);
      next[Math.min(k + 1, MAX_GOALS)] += d[k] * p;
    }
    d = next;
  }
  return d;
}

export type Deserved = { home: number; draw: number; away: number; xptsHome: number; xptsAway: number };

export function deservedResult(homeShots: number[], awayShots: number[]): Deserved {
  const h = goalsDistribution(homeShots);
  const a = goalsDistribution(awayShots);
  let home = 0;
  let draw = 0;
  let away = 0;
  for (let i = 0; i < h.length; i++)
    for (let j = 0; j < a.length; j++) {
      const p = h[i] * a[j];
      if (i > j) home += p;
      else if (i === j) draw += p;
      else away += p;
    }
  return { home, draw, away, xptsHome: 3 * home + draw, xptsAway: 3 * away + draw };
}

const f1 = (x: number) => x.toFixed(1);

/**
 * One line on whether the result matched the chances, e.g. "Arsenal won the xG 2.1–0.7 but lost 0–1."
 * `live` phrases it for a match still going on.
 */
export function deservedLine(home: string, away: string, xgH: number, xgA: number, gH: number, gA: number, live = false): string {
  const xg = `${f1(xgH)}–${f1(xgA)}`;
  const sc = `${gH}–${gA}`;
  if (Math.abs(xgH - xgA) < 0.3) {
    if (gH === gA) return live ? `Even on chances (xG ${xg}) and level at ${sc} so far.` : `Even on chances (xG ${xg}), and it finished level at ${sc}.`;
    const w = gH > gA ? home : away;
    return live ? `Even on chances (xG ${xg}), but ${w} lead ${gH > gA ? sc : `${gA}–${gH}`}.` : `Even on chances (xG ${xg}), but ${w} won ${gH > gA ? sc : `${gA}–${gH}`}.`;
  }
  const homeBetter = xgH > xgA;
  const w = homeBetter ? home : away;
  const wxg = homeBetter ? xg : `${f1(xgA)}–${f1(xgH)}`;
  const own = homeBetter ? gH : gA;
  const opp = homeBetter ? gA : gH;
  const res = `${own}–${opp}`;
  if (live) {
    if (own > opp) return `${w} lead the xG ${wxg} and the score ${res}.`;
    if (own === opp) return `${w} lead the xG ${wxg}, but it's level at ${res}.`;
    return `${w} lead the xG ${wxg} but trail ${res}.`;
  }
  if (own > opp) return `${w} won the xG ${wxg} and the match ${res}.`;
  if (own === opp) return `${w} won the xG ${wxg} but drew ${res}.`;
  return `${w} won the xG ${wxg} but lost ${res}.`;
}

/** Did the chances back the call or the result? Honest both ways.  */
export function chancesVerdict(d: Deserved, pick: 'home' | 'draw' | 'away', result: 'home' | 'draw' | 'away', home: string, away: string): string {
  const fav: 'home' | 'draw' | 'away' = d.home >= d.draw && d.home >= d.away ? 'home' : d.away >= d.draw ? 'away' : 'draw';
  const name = (o: 'home' | 'draw' | 'away') => (o === 'home' ? `${home} win` : o === 'away' ? `${away} win` : 'a draw');
  const odds = `On the chances both sides had: ${home} ${Math.round(d.home * 100)}% · draw ${Math.round(d.draw * 100)}% · ${away} ${Math.round(d.away * 100)}%.`;
  if (pick === result) return `${odds} ${fav === result ? 'The result matched the chances.' : `The call came off, though the chances favoured ${name(fav)}.`}`;
  if (fav === pick) return `${odds} The chances favoured the call (${name(pick)}); the result went the other way.`;
  if (fav === result) return `${odds} The chances backed the result: the call was wrong.`;
  return `${odds} The chances favoured ${name(fav)}: neither the call nor the result.`;
}
