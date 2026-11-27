/**
 * Step 12: can the on-device NBA, NHL and NFL models be improved?
 *
 * Protocol (fixed before any result was seen):
 *   - Data: the ESPN results cached for Step 1 (audit/data/espn), regular season and playoffs, preseason excluded.
 *     No new downloads.
 *   - Production-faithful walk-forward: every game is predicted from the finished games of the previous 365 days
 *     (NFL 730) before its UTC day, exactly the app's on-device history window. Rest days come from the schedule
 *     (the previous game's date), which is public before tip-off.
 *   - Seasons: 2024-25 (NFL 2024) chooses every setting; 2025-26 (NFL 2025) is the test; 2026-27 so far (to
 *     6 Nov 2026) is a fresh check.
 *   - Candidates:
 *       engine   the current on-device model (Elo + recency-weighted points for/against), unchanged
 *       retuned  the same model with its settings re-chosen on the selection season
 *       ridge    opponent-adjusted ratings: time-weighted least squares on each game's (capped) margin, with
 *                home advantage and rest effects learned from the same window; win probability from a normal
 *                model whose spread is fitted on the selection season
 *       blend    ridge and engine margins averaged with a weight chosen on the selection season
 *   - Benchmarks on the same games: ESPN's listed closing line (margin removed), always home.
 *   - Decision: a sport switches to a new model only if its test-season log loss beats the current engine by
 *     at least 0.003 and it is not worse on the selection season.
 *
 *   node --import tsx scripts/audit/us-sports.ts        (writes audit/results/step12.json)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { FinishedMatch, getModel, normalCdf, probabilities, SportModel } from '../../src/engine';
import { MARGIN_SPORTS } from '../../src/engine/models';

const DATA = join(__dirname, '../../../audit/data');
const OUT = join(__dirname, '../../../audit/results/step12.json');
const DAY = 86_400_000;
const d = (y: number, m: number, day = 1) => Date.UTC(y, m - 1, day);

type Row = { id: string; t: number; h: string; a: string; hn: string; an: string; hs: number; as: number; n: 0 | 1; pre: 0 | 1 };
type Game = Row & { restH: number | null; restA: number | null };
const SPORTS = [
  { slug: 'nba', sport: 'basketball', days: 365, sel: [d(2024, 10), d(2025, 7)], test: [d(2025, 10), d(2026, 7)], fresh: [d(2026, 10), d(2026, 11, 7)] },
  { slug: 'nhl', sport: 'ice-hockey', days: 365, sel: [d(2024, 10), d(2025, 7)], test: [d(2025, 10), d(2026, 7)], fresh: [d(2026, 10), d(2026, 11, 7)] },
  { slug: 'nfl', sport: 'american-football', days: 730, sel: [d(2024, 9), d(2025, 3)], test: [d(2025, 9), d(2026, 3)], fresh: [d(2026, 9), d(2026, 11, 7)] },
] as const;

// ------------------------------------------------------------------ data
function loadGames(slug: string): Game[] {
  const rows = (JSON.parse(readFileSync(join(DATA, 'espn', `${slug}.json`), 'utf8')) as Row[]).filter((r) => !r.pre && r.hs !== r.as);
  rows.sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
  const last = new Map<string, number>();
  return rows.map((r) => {
    const rest = (team: string) => {
      const l = last.get(team);
      return l === undefined || r.t - l > 30 * DAY ? null : Math.max(0, Math.round((r.t - l) / DAY) - 1);
    };
    const g = { ...r, restH: rest(r.h), restA: rest(r.a) };
    last.set(r.h, r.t);
    last.set(r.a, r.t);
    return g;
  });
}

function closing(slug: string): Map<string, number> {
  const out = new Map<string, number>();
  const f = join(DATA, 'odds', `${slug}.json`);
  if (!existsSync(f)) return out;
  for (const [id, o] of Object.entries(JSON.parse(readFileSync(f, 'utf8')) as Record<string, { close?: { h?: number; a?: number } } | null>)) {
    const c = o?.close;
    if (c?.h && c?.a && c.h > 1 && c.a > 1) out.set(id, 1 / c.h / (1 / c.h + 1 / c.a));
  }
  return out;
}

// ------------------------------------------------------------------ metrics
const EPS = 1e-12;
type Scored = { y: number; p: number }; // y = 1 home win
function metrics(xs: Scored[]) {
  const n = xs.length;
  if (!n) return null;
  const ll = xs.reduce((s, x) => s - Math.log(Math.max(EPS, x.y ? x.p : 1 - x.p)), 0) / n;
  const br = xs.reduce((s, x) => s + 2 * (x.p - x.y) ** 2, 0) / n; // two-outcome Brier (home and away terms)
  const acc = xs.filter((x) => (x.p >= 0.5 ? 1 : 0) === x.y).length / n;
  return { n, log_loss: round(ll), brier: round(br), hit_rate: round(acc) };
}
function calibration(xs: Scored[]) {
  const bins = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0001];
  const out = [];
  for (let i = 0; i < bins.length - 1; i++) {
    // fold to the favourite's side
    const sel = xs.map((x) => (x.p >= 0.5 ? { p: x.p, y: x.y } : { p: 1 - x.p, y: 1 - x.y })).filter((x) => x.p >= bins[i] && x.p < bins[i + 1]);
    if (sel.length) out.push({ from: bins[i], to: Math.min(1, bins[i + 1]), n: sel.length, given: round(mean(sel.map((x) => x.p))), happened: round(mean(sel.map((x) => x.y))) });
  }
  return out;
}
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / (v.length || 1);
const round = (v: number, k = 4) => Math.round(v * 10 ** k) / 10 ** k;
const inWin = (t: number, w: readonly [number, number]) => t >= w[0] && t < w[1];

// ------------------------------------------------------------------ the current engine, walk-forward per day
type Pred = { id: string; t: number; y: number; margin: number; p: number };
function engineWalk(sport: string, games: Game[], days: number, windows: readonly (readonly [number, number])[], params?: Record<string, number>): Pred[] {
  const lp: Record<string, Record<string, number>> = sport === 'basketball' ? { nba: { homeCourtPts: 2.5, sigma: 12.5, defaultPoints: 114 } } : {};
  const model: SportModel = getModel(sport, params ?? {}, params ? { nba: { ...lp.nba, ...params } } : lp);
  const out: Pred[] = [];
  const byDay = groupByDay(games.filter((g) => windows.some((w) => inWin(g.t, w))));
  for (const [day, todays] of byDay) {
    const from = day * DAY - days * DAY;
    const book = model.newBook();
    for (const g of games) {
      if (g.t >= day * DAY) break;
      if (g.t >= from) book.update(fin(sport, g));
    }
    for (const g of todays) {
      const inp = book.buildInput({ home: `${sport}:${g.h}`, away: `${sport}:${g.a}`, kickoff: new Date(g.t), competition: league(sport), neutral: !!g.n });
      const pr = model.predict(inp);
      const p = probabilities(pr).home ?? 0.5;
      out.push({ id: g.id, t: g.t, y: g.hs > g.as ? 1 : 0, margin: Number(pr.explanation.inputs.expected_margin ?? 0), p });
    }
  }
  return out;
}
const league = (sport: string) => (sport === 'basketball' ? 'nba' : sport === 'ice-hockey' ? 'nhl' : 'nfl');
const fin = (sport: string, g: Game): FinishedMatch => ({ id: g.id, date: new Date(g.t), home: `${sport}:${g.h}`, away: `${sport}:${g.a}`, homeScore: g.hs, awayScore: g.as, competition: league(sport), neutral: !!g.n });
function groupByDay(games: Game[]): [number, Game[]][] {
  const m = new Map<number, Game[]>();
  for (const g of games) m.set(Math.floor(g.t / DAY), [...(m.get(Math.floor(g.t / DAY)) ?? []), g]);
  return [...m.entries()].sort((a, b) => a[0] - b[0]);
}

// ------------------------------------------------------------------ opponent-adjusted ratings (time-weighted ridge)
export type RidgeCfg = { halfLife: number; lambda: number; cap: number; prevSeason: number; rest: 'b2b' | 'nfl' | 'none' };
function restCols(cfg: RidgeCfg, g: Game): number[] {
  if (cfg.rest === 'b2b') return [(g.restH === 0 ? 1 : 0) - (g.restA === 0 ? 1 : 0)];
  if (cfg.rest === 'nfl') {
    const bye = (r: number | null) => (r !== null && r >= 12 ? 1 : 0);
    const shortWk = (r: number | null) => (r !== null && r <= 4 ? 1 : 0);
    return [bye(g.restH) - bye(g.restA), shortWk(g.restH) - shortWk(g.restA)];
  }
  return [];
}

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

/** Ratings from the games in [from, before): returns a margin predictor. */
export function fitRidge(cfg: RidgeCfg, games: Game[], from: number, before: number) {
  const win = games.filter((g) => g.t >= from && g.t < before);
  const teams = [...new Set(win.flatMap((g) => [g.h, g.a]))];
  const idx = new Map(teams.map((t, i) => [t, i]));
  const nr = restCols(cfg, win[0] ?? ({ restH: null, restA: null } as Game)).length;
  const P = teams.length + 1 + nr; // ratings, home advantage, rest effects
  const A = Array.from({ length: P }, () => new Array(P).fill(0));
  const b = new Array(P).fill(0);
  // the most recent gap of 60+ days marks the start of the current season
  let seasonStart = from;
  for (let i = win.length - 1; i > 0; i--) if (win[i].t - win[i - 1].t > 60 * DAY) {
    seasonStart = win[i].t;
    break;
  }
  for (const g of win) {
    const age = (before - g.t) / DAY;
    let w = 0.5 ** (age / cfg.halfLife);
    if (g.t < seasonStart) w *= cfg.prevSeason;
    const y = Math.max(-cfg.cap, Math.min(cfg.cap, g.hs - g.as));
    const x: [number, number][] = [[idx.get(g.h)!, 1], [idx.get(g.a)!, -1]];
    if (!g.n) x.push([teams.length, 1]);
    restCols(cfg, g).forEach((v, k) => v && x.push([teams.length + 1 + k, v]));
    for (const [i, vi] of x) {
      b[i] += w * vi * y;
      for (const [j, vj] of x) A[i][j] += w * vi * vj;
    }
  }
  for (let i = 0; i < teams.length; i++) A[i][i] += cfg.lambda;
  for (let i = teams.length; i < P; i++) A[i][i] += 1; // weak pull to zero for home advantage and rest
  const beta = win.length ? solve(A, b) : new Array(P).fill(0);
  return (g: Game) => {
    const ri = (t: string) => (idx.has(t) ? beta[idx.get(t)!] : 0);
    let m = ri(g.h) - ri(g.a) + (g.n ? 0 : beta[teams.length]);
    restCols(cfg, g).forEach((v, k) => (m += v * beta[teams.length + 1 + k]));
    return { margin: m, hfa: beta[teams.length], rest: beta.slice(teams.length + 1) };
  };
}

function ridgeWalk(cfg: RidgeCfg, games: Game[], days: number, windows: readonly (readonly [number, number])[]) {
  const out: { id: string; t: number; y: number; margin: number }[] = [];
  for (const [day, todays] of groupByDay(games.filter((g) => windows.some((w) => inWin(g.t, w))))) {
    const pred = fitRidge(cfg, games, day * DAY - days * DAY, day * DAY);
    for (const g of todays) out.push({ id: g.id, t: g.t, y: g.hs > g.as ? 1 : 0, margin: pred(g).margin });
  }
  return out;
}

/** The spread of the normal model, fitted by maximum likelihood (golden-section search on log loss). */
function fitSigma(xs: { y: number; margin: number }[], lo: number, hi: number): number {
  const loss = (s: number) => xs.reduce((acc, x) => {
    const p = normalCdf(x.margin / s);
    return acc - Math.log(Math.max(EPS, x.y ? p : 1 - p));
  }, 0);
  let a = lo;
  let b = hi;
  const g = (Math.sqrt(5) - 1) / 2;
  for (let k = 0; k < 60; k++) {
    const c = b - g * (b - a);
    const e = a + g * (b - a);
    if (loss(c) < loss(e)) b = e;
    else a = c;
  }
  return (a + b) / 2;
}

// ------------------------------------------------------------------ main
const GRID: Record<string, { halfLife: number[]; lambda: number[]; cap: number[]; prevSeason: number[]; rest: RidgeCfg['rest']; sigma: [number, number] }> = {
  basketball: { halfLife: [30, 60, 90, 150], lambda: [2, 5, 10, 20], cap: [20, 30, 99], prevSeason: [0.25, 0.5, 1], rest: 'b2b', sigma: [8, 20] },
  'ice-hockey': { halfLife: [45, 90, 150, 300], lambda: [5, 10, 20, 40], cap: [2, 3, 99], prevSeason: [0.25, 0.5, 1], rest: 'b2b', sigma: [1, 5] },
  'american-football': { halfLife: [60, 120, 240, 400], lambda: [1, 2, 4, 8], cap: [14, 21, 99], prevSeason: [0.25, 0.5, 1], rest: 'nfl', sigma: [8, 20] },
};
const RETUNE: Record<string, Record<string, number[]>> = {
  basketball: { homeCourtPts: [1.5, 2, 2.5], sigma: [11.5, 12.5, 13.5], eloWeight: [0.3, 0.5, 0.7], pointsAlpha: [0.05, 0.1], backToBackPts: [-1, -2] },
  'ice-hockey': { homeCourtPts: [0, 0.1, 0.2], sigma: [2.2, 2.4, 2.7], eloWeight: [0.7, 0.85, 1], k: [12, 20, 30] },
  'american-football': { homeCourtPts: [1, 1.6, 2.2], sigma: [12.5, 13.5, 14.5], eloWeight: [0.4, 0.6, 0.8], k: [30, 40, 50] },
};

function cartesian<T extends Record<string, number[]>>(g: T): Record<keyof T, number>[] {
  let acc: Record<string, number>[] = [{}];
  for (const [k, vs] of Object.entries(g)) acc = acc.flatMap((a) => vs.map((v) => ({ ...a, [k]: v })));
  return acc as Record<keyof T, number>[];
}

(async () => {
  const t0 = Date.now();
  const report: Record<string, unknown> = { generated_at: new Date().toISOString(), protocol: 'see the header of scripts/audit/us-sports.ts' };
  for (const S of SPORTS) {
    const games = loadGames(S.slug);
    const market = closing(S.slug);
    const W = [S.sel, S.test, S.fresh] as const;
    const part = (t: number) => (inWin(t, S.sel) ? 'selection' : inWin(t, S.test) ? 'test' : inWin(t, S.fresh) ? 'fresh' : null);
    // 1) current engine
    const eng = engineWalk(S.sport, games, S.days, W);
    // 2) retuned engine: settings chosen on the selection season only
    const base = { ...(MARGIN_SPORTS[S.sport]?.params ?? {}), ...(S.sport === 'basketball' ? { homeCourtPts: 2.5, sigma: 12.5, defaultPoints: 114 } : {}) } as Record<string, number>;
    let bestRet = { ll: Infinity, params: {} as Record<string, number> };
    for (const combo of cartesian(RETUNE[S.sport])) {
      const preds = engineWalk(S.sport, games, S.days, [S.sel], { ...base, ...combo });
      const ll = metrics(preds.map((x) => ({ y: x.y, p: x.p })))!.log_loss;
      if (ll < bestRet.ll) bestRet = { ll, params: { ...base, ...combo } };
    }
    const ret = engineWalk(S.sport, games, S.days, W, bestRet.params);
    // 3) ridge: grid on the selection season, spread fitted there too
    const G = GRID[S.sport];
    let bestRidge = { ll: Infinity, cfg: null as RidgeCfg | null, sigma: 0 };
    for (const halfLife of G.halfLife) for (const lambda of G.lambda) for (const cap of G.cap) for (const prevSeason of G.prevSeason) {
      const cfg: RidgeCfg = { halfLife, lambda, cap, prevSeason, rest: G.rest };
      const sel = ridgeWalk(cfg, games, S.days, [S.sel]);
      const sigma = fitSigma(sel, G.sigma[0], G.sigma[1]);
      const ll = metrics(sel.map((x) => ({ y: x.y, p: normalCdf(x.margin / sigma) })))!.log_loss;
      if (ll < bestRidge.ll) bestRidge = { ll, cfg, sigma };
    }
    const rid = ridgeWalk(bestRidge.cfg!, games, S.days, W);
    // 4) blend of the ridge and engine margins (weight and spread chosen on the selection season)
    const engBy = new Map(eng.map((x) => [x.id, x]));
    const selPairs = rid.filter((x) => part(x.t) === 'selection').map((x) => ({ y: x.y, r: x.margin, e: engBy.get(x.id)!.margin }));
    let bestBlend = { ll: Infinity, w: 1, sigma: bestRidge.sigma };
    for (let w = 0; w <= 1.0001; w += 0.1) {
      const xs = selPairs.map((x) => ({ y: x.y, margin: w * x.r + (1 - w) * x.e }));
      const sigma = fitSigma(xs, G.sigma[0], G.sigma[1]);
      const ll = metrics(xs.map((x) => ({ y: x.y, p: normalCdf(x.margin / sigma) })))!.log_loss;
      if (ll < bestBlend.ll) bestBlend = { ll, w: round(w, 2), sigma };
    }
    // score every candidate on every part, on the same games
    const rows = rid.map((x) => {
      const e = engBy.get(x.id)!;
      const rt = ret.find((z) => z.id === x.id)!;
      return {
        part: part(x.t)!, y: x.y, engine: e.p, retuned: rt.p,
        ridge: normalCdf(x.margin / bestRidge.sigma),
        blend: normalCdf((bestBlend.w * x.margin + (1 - bestBlend.w) * e.margin) / bestBlend.sigma),
        market: market.get(x.id) ?? null, home: 1,
      };
    });
    const out: Record<string, unknown> = {
      games: { selection: rows.filter((r) => r.part === 'selection').length, test: rows.filter((r) => r.part === 'test').length, fresh: rows.filter((r) => r.part === 'fresh').length },
      chosen: { retuned: bestRet.params, ridge: { ...bestRidge.cfg, sigma: round(bestRidge.sigma, 3) }, blend: { w: bestBlend.w, sigma: round(bestBlend.sigma, 3) } },
    };
    for (const p of ['selection', 'test', 'fresh'] as const) {
      const xs = rows.filter((r) => r.part === p);
      const withMk = xs.filter((r) => r.market !== null);
      out[p] = {
        engine: metrics(xs.map((r) => ({ y: r.y, p: r.engine }))),
        retuned: metrics(xs.map((r) => ({ y: r.y, p: r.retuned }))),
        ridge: metrics(xs.map((r) => ({ y: r.y, p: r.ridge }))),
        blend: metrics(xs.map((r) => ({ y: r.y, p: r.blend }))),
        always_home: metrics(xs.map((r) => ({ y: r.y, p: 0.5 + 1e-9 }))),
        same_games_as_market: withMk.length
          ? { n: withMk.length, market: metrics(withMk.map((r) => ({ y: r.y, p: r.market! }))), engine: metrics(withMk.map((r) => ({ y: r.y, p: r.engine }))), ridge: metrics(withMk.map((r) => ({ y: r.y, p: r.ridge }))), blend: metrics(withMk.map((r) => ({ y: r.y, p: r.blend }))) }
          : null,
        calibration: { engine: calibration(xs.map((r) => ({ y: r.y, p: r.engine }))), blend: calibration(xs.map((r) => ({ y: r.y, p: r.blend }))) },
      };
    }
    // secondary analysis: the app blends the bookmakers' view in when ESPN lists odds, as a linear pool with
    // fixed priors (market 2, model 1, i.e. 2/3 on the market). Is that weight right? Chosen on the selection
    // season, scored on the test season, for the current model and for the chosen NBA candidate.
    const poolLL = (xs: typeof rows, key: 'engine' | 'blend', wk: number) =>
      metrics(xs.filter((r) => r.market !== null).map((r) => ({ y: r.y, p: wk * r.market! + (1 - wk) * r[key] })))!;
    const pool: Record<string, unknown> = {};
    for (const key of ['engine', 'blend'] as const) {
      const sel = rows.filter((r) => r.part === 'selection');
      let best = { wk: 2 / 3, ll: Infinity };
      for (let wk = 0; wk <= 1.0001; wk += 0.05) {
        const ll = poolLL(sel, key, wk).log_loss;
        if (ll < best.ll) best = { wk: round(wk, 2), ll };
      }
      const test = rows.filter((r) => r.part === 'test');
      pool[key] = { chosen_market_weight: best.wk, test_current_weight_2_3: poolLL(test, key, 2 / 3), test_chosen_weight: poolLL(test, key, best.wk), test_market_only: poolLL(test, key, 1) };
    }
    out.market_pool = pool;
    if (process.env.STEP12_ROWS) writeFileSync(`${process.env.STEP12_ROWS}.${S.slug}.json`, JSON.stringify(rows));
    report[S.slug] = out;
    console.error(S.slug, JSON.stringify({ chosen: out.chosen, test: (out.test as Record<string, unknown>) }, null, 0).slice(0, 900), `${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  writeFileSync(OUT, JSON.stringify(report, null, 1));
})();
