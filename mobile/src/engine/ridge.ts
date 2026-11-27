/**
 * Opponent-adjusted team ratings for margin sports (Step 12): time-weighted least squares on each game's margin.
 *
 *   margin(home, away) = rating[home] - rating[away] + homeAdvantage (unless neutral) + backToBack x (b2b home - b2b away)
 *
 * Each game counts by 0.5^(age / halfLife); games from before the current season's start (the last gap of 60+
 * days) count `prevSeason` times as much; margins are capped at `cap`; ratings are pulled towards 0 by `lambda`
 * (in games' worth of weight). Unlike a running points-for/against average, beating a strong team counts for
 * more than beating a weak one. Chosen on the 2024-25 NBA season and tested on 2025-26 (docs/audit/STEP12_US_SPORTS.md).
 *
 * Ratings for a day use the games before that day's start (one fit per day). Because every game's weight shrinks
 * by the same factor as time passes, the weighted sums are kept and rolled forward (scaled, plus the new games)
 * instead of rebuilt; `prevSeason` other than 1 needs the season boundary, so it falls back to a full rebuild.
 */
const DAY = 86_400_000;

export type RidgeCfg = { halfLife: number; lambda: number; cap: number; prevSeason: number; backToBack: boolean };
export type RidgeGame = { t: number; h: string; a: string; m: number; n: boolean; b2b: number };
export type RidgeFit = { ratings: Map<string, number>; homeAdvantage: number; backToBack: number; games: number; day: number };

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    const v = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / v;
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-12));
}

/** Weighted normal equations. Index 0 = home advantage, 1 = back-to-back, 2.. = teams. */
class Sums {
  A: number[][] = [
    [0, 0],
    [0, 0],
  ];
  b: number[] = [0, 0];
  idx = new Map<string, number>();
  tref = -Infinity;
  used = 0; // games of this competition folded in so far
  col(team: string): number {
    let i = this.idx.get(team);
    if (i === undefined) {
      i = this.b.length;
      this.idx.set(team, i);
      for (const row of this.A) row.push(0);
      this.A.push(new Array(i + 1).fill(0));
      this.b.push(0);
    }
    return i;
  }
  scale(f: number) {
    for (const row of this.A) for (let k = 0; k < row.length; k++) row[k] *= f;
    for (let k = 0; k < this.b.length; k++) this.b[k] *= f;
  }
  addGame(g: RidgeGame, w: number, cfg: RidgeCfg) {
    const y = Math.max(-cfg.cap, Math.min(cfg.cap, g.m));
    const x: [number, number][] = [
      [this.col(g.h), 1],
      [this.col(g.a), -1],
    ];
    if (!g.n) x.push([0, 1]);
    if (cfg.backToBack && g.b2b) x.push([1, g.b2b]);
    for (const [i, vi] of x) {
      this.b[i] += w * vi * y;
      for (const [j, vj] of x) this.A[i][j] += w * vi * vj;
    }
  }
  solveFor(cfg: RidgeCfg, games: number, day: number): RidgeFit {
    const P = this.b.length;
    const A = this.A.map((row) => [...row]);
    A[0][0] += 1;
    A[1][1] += 1;
    for (let i = 2; i < P; i++) A[i][i] += cfg.lambda;
    const beta = games ? solve(A, this.b) : new Array(P).fill(0);
    return { ratings: new Map([...this.idx].map(([t, i]) => [t, beta[i]])), homeAdvantage: beta[0], backToBack: beta[1], games, day };
  }
}

export class RidgeStore {
  private games = new Map<string, RidgeGame[]>(); // per competition, in time order
  private cache = new Map<string, RidgeFit>();
  private rolling = new Map<string, Sums>();

  /** Record a finished game (in time order); `b2bDiff` is (home on a back-to-back) - (away on a back-to-back). */
  add(t: number, home: string, away: string, margin: number, neutral: boolean, b2bDiff: number, competition: string) {
    const list = this.games.get(competition) ?? [];
    list.push({ t, h: home, a: away, m: margin, n: neutral, b2b: b2bDiff });
    if (list.length > 1 && t < list[list.length - 2].t) {
      list.sort((x, y) => x.t - y.t);
      this.rolling.clear(); // out of order: rebuild the sums on demand
    }
    this.games.set(competition, list);
    // a fit for day D uses games before D's start: only fits for later days can change
    for (const [k, f] of this.cache) if (f.day * DAY > t) this.cache.delete(k);
    for (const [k, s] of this.rolling) if (s.tref > t) this.rolling.delete(k);
  }

  get size() {
    let n = 0;
    for (const l of this.games.values()) n += l.length;
    return n;
  }

  private key(cfg: RidgeCfg, competition: string) {
    return `${competition}|${cfg.halfLife}|${cfg.lambda}|${cfg.cap}|${cfg.prevSeason}|${cfg.backToBack}`;
  }

  /** Ratings for games on the UTC day of `time`, from this competition's games before that day. */
  fit(cfg: RidgeCfg, competition: string, time: number): RidgeFit {
    const day = Math.floor(time / DAY);
    const at = day * DAY;
    const ck = `${this.key(cfg, competition)}|${day}`;
    const hit = this.cache.get(ck);
    if (hit) return hit;
    const list = this.games.get(competition) ?? [];
    let fit: RidgeFit;
    if (cfg.prevSeason === 1) {
      // roll the stored sums forward to `at`, or rebuild them when asked about an earlier day
      const decay = Math.LN2 / (cfg.halfLife * DAY);
      const rk = this.key(cfg, competition);
      let s = this.rolling.get(rk);
      if (!s || at < s.tref) {
        s = new Sums();
        this.rolling.set(rk, s);
      }
      if (s.tref !== -Infinity && at > s.tref) s.scale(Math.exp(-(at - s.tref) * decay));
      while (s.used < list.length && list[s.used].t < at) {
        const g = list[s.used];
        s.addGame(g, Math.exp(-(at - g.t) * decay), cfg);
        s.used += 1;
      }
      s.tref = at;
      fit = s.solveFor(cfg, s.used, day);
    } else {
      fit = fullFit(
        cfg,
        list.filter((g) => g.t < at),
        at,
      );
    }
    if (this.cache.size > 64) this.cache.clear();
    this.cache.set(ck, fit);
    return fit;
  }

  /** The expected home margin, or null with too few games to rate. */
  margin(cfg: RidgeCfg, competition: string, home: string, away: string, neutral: boolean, b2bDiff: number, at: number, minGames = 50) {
    const f = this.fit(cfg, competition, at);
    if (f.games < minGames) return null;
    const r = (t: string) => f.ratings.get(t) ?? 0;
    const hfa = neutral ? 0 : f.homeAdvantage;
    const rest = cfg.backToBack ? b2bDiff * f.backToBack : 0;
    return { margin: r(home) - r(away) + hfa + rest, home: r(home), away: r(away), homeAdvantage: hfa, rest };
  }
}

/** The direct computation, games before `at` only (also the reference the tests compare the rolling sums with). */
export function fullFit(cfg: RidgeCfg, win: RidgeGame[], at: number): RidgeFit {
  const s = new Sums();
  let seasonStart = -Infinity;
  for (let i = win.length - 1; i > 0; i--)
    if (win[i].t - win[i - 1].t > 60 * DAY) {
      seasonStart = win[i].t;
      break;
    }
  const decay = Math.LN2 / (cfg.halfLife * DAY);
  for (const g of win) s.addGame(g, Math.exp(-(at - g.t) * decay) * (g.t < seasonStart ? cfg.prevSeason : 1), cfg);
  return s.solveFor(cfg, win.length, Math.floor(at / DAY));
}
