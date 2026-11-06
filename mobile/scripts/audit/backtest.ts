/**
 * Audit step 1c: walk-forward backtest of the CURRENT production engine (v2.1, ESPN-only), plus
 * benchmarks, on the last two full seasons of every competition.
 *
 * Production-faithful: on each match day the rating book is rebuilt from the finished matches
 * of the previous `historyDays` (365; NFL 730) of that sport, exactly as the app's on-device
 * history window works, and every match of that day is predicted from it. Nothing from the
 * match day or later is visible (no leakage). Every match is scored, including cold starts,
 * because users see those predictions too.
 *
 * Benchmarks on the same matches:
 *   home   : always pick the home side (accuracy); its probabilistic twin uses the league's
 *            home/draw/away frequencies over the previous 365 days
 *   elo    : simple Elo (K=20, fixed home advantage, 1/3 regression between seasons, no MOV);
 *            football draw probability = league draw rate over the previous 365 days
 *   market : bookmaker closing odds, margin removed proportionally. Pinnacle closing
 *            (football-data.co.uk) where available, else the market average closing, else the
 *            closing line ESPN lists (DraftKings / ESPN BET / Bet365)
 *
 *   node --import tsx scripts/audit/backtest.ts            (writes audit/results/step1.json)
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { FinishedMatch, getModel, outcomeOf, Probs, probabilities, SportModel } from '../../src/engine';
import { LEAGUE_BY_SLUG, MATCH_LEAGUES, SportSlug } from '../../src/data/leagues';
import { matchFootballData, readFootballData } from './footballdata';
import { EVAL_WINDOWS } from './windows';

const DATA = join(__dirname, '../../../audit/data');
const OUT = join(__dirname, '../../../audit/results');
const DAY = 86_400_000;
type Row = { id: string; t: number; h: string; a: string; hn: string; an: string; hs: number; as: number; n: 0 | 1; pre: 0 | 1 };
type O = 'home' | 'draw' | 'away';

// ------------------------------------------------------------------ metrics
const EPS = 1e-12;
function norm(p: Probs, threeWay: boolean): Probs {
  const keys: O[] = threeWay ? ['home', 'draw', 'away'] : ['home', 'away'];
  const s = keys.reduce((x, k) => x + Math.max(0, p[k] ?? 0), 0) || 1;
  return Object.fromEntries(keys.map((k) => [k, Math.max(0, p[k] ?? 0) / s])) as Probs;
}
const ll = (p: Probs, o: O) => -Math.log(Math.max(EPS, p[o] ?? 0));
const brier = (p: Probs, o: O) => (Object.keys(p) as O[]).reduce((s, k) => s + ((p[k] ?? 0) - (k === o ? 1 : 0)) ** 2, 0);
const top = (p: Probs): O => (Object.entries(p) as [O, number][]).sort((x, y) => y[1] - x[1])[0][0];

type Rec = { league: string; sport: string; id: string; t: number; o: O; model: Probs; full: Probs; elo: Probs; base: Probs; market: Probs | null; marketSrc: string | null; minGames: number; cross: boolean; shift: Probs | null; w400: Probs };

function summary(list: Rec[], key: 'model' | 'full' | 'elo' | 'base' | 'market' | 'w400') {
  const xs = list.filter((r) => r[key]);
  const n = xs.length;
  if (!n) return null;
  const acc = xs.filter((r) => top(r[key] as Probs) === r.o).length / n;
  return { n, accuracy: acc, logLoss: xs.reduce((s, r) => s + ll(r[key] as Probs, r.o), 0) / n, brier: xs.reduce((s, r) => s + brier(r[key] as Probs, r.o), 0) / n };
}

function calibration(list: Rec[], key: 'model' | 'market' | 'elo') {
  const bins = Array.from({ length: 10 }, () => ({ n: 0, p: 0, hit: 0 }));
  for (const r of list) {
    const p = r[key];
    if (!p) continue;
    for (const k of Object.keys(p) as O[]) {
      const v = p[k] ?? 0;
      const b = bins[Math.min(9, Math.floor(v * 10))];
      b.n += 1;
      b.p += v;
      b.hit += r.o === k ? 1 : 0;
    }
  }
  const total = bins.reduce((s, b) => s + b.n, 0) || 1;
  const rows = bins.map((b, i) => ({ bin: `${i * 10}-${i * 10 + 10}%`, n: b.n, predicted: b.n ? b.p / b.n : null, observed: b.n ? b.hit / b.n : null }));
  const ece = rows.reduce((s, r) => s + (r.n ? (r.n / total) * Math.abs((r.observed ?? 0) - (r.predicted ?? 0)) : 0), 0);
  return { rows, ece };
}

// ------------------------------------------------------------------ simple Elo benchmark
const ELO_HFA: Record<string, number> = { football: 60, basketball: 100, 'american-football': 55, 'ice-hockey': 30, baseball: 24 };
class SimpleElo {
  r = new Map<string, number>();
  last = new Map<string, number>();
  constructor(private hfa: number) {}
  get(team: string, t: number) {
    let v = this.r.get(team) ?? 1500;
    const l = this.last.get(team);
    if (l !== undefined && t - l > 60 * DAY) v = 1500 + (v - 1500) * (2 / 3); // season break
    return v;
  }
  expect(h: string, a: string, t: number, neutral: boolean) {
    return 1 / (1 + 10 ** ((this.get(a, t) - this.get(h, t) - (neutral ? 0 : this.hfa)) / 400));
  }
  update(m: Row) {
    const e = this.expect(m.h, m.a, m.t, !!m.n);
    const s = m.hs > m.as ? 1 : m.hs < m.as ? 0 : 0.5;
    const rh = this.get(m.h, m.t);
    const ra = this.get(m.a, m.t);
    this.r.set(m.h, rh + 20 * (s - e));
    this.r.set(m.a, ra - 20 * (s - e));
    this.last.set(m.h, m.t);
    this.last.set(m.a, m.t);
  }
}

// ------------------------------------------------------------------ helpers
function loadRows(slug: string): Row[] {
  const f = join(DATA, 'espn', `${slug}.json`);
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as Row[]).filter((r) => !r.pre) : [];
}
const toFinished = (sport: string, m: Row & { league: string }): FinishedMatch => ({ id: `${m.league}~${m.id}`, date: new Date(m.t), home: `${sport}:${m.h}`, away: `${sport}:${m.a}`, homeScore: m.hs, awayScore: m.as, competition: m.league, neutral: !!m.n });

function modelFor(sport: string): SportModel {
  const lp: Record<string, Record<string, number>> = {};
  for (const l of MATCH_LEAGUES) if (l.sport === sport && l.modelParams) lp[l.slug] = l.modelParams;
  return getModel(sport, {}, lp);
}

function predictWith(model: SportModel, pool: (Row & { league: string })[], sport: string, from: number, to: number, m: Row & { league: string }) {
  const book = model.newBook();
  for (const x of pool) if (x.t >= from && x.t < to) book.update(toFinished(sport, x));
  const inp = book.buildInput({ home: `${sport}:${m.h}`, away: `${sport}:${m.a}`, kickoff: new Date(m.t), competition: m.league, neutral: !!m.n });
  return { p: probabilities(model.predict(inp)) as Probs, minGames: Math.min(inp.home.games, inp.away.games) };
}

function marketOdds(slug: string): Map<string, { p: Probs; src: string }> {
  const out = new Map<string, { p: Probs; src: string }>();
  const f = join(DATA, 'odds', `${slug}.json`);
  if (!existsSync(f)) return out;
  const threeWay = LEAGUE_BY_SLUG[slug].sport === 'football';
  for (const [id, o] of Object.entries(JSON.parse(readFileSync(f, 'utf8')) as Record<string, any>)) {
    if (!o) continue;
    const c = o.close;
    if (!c.h || !c.a || (threeWay && !c.d)) continue;
    const inv = { home: 1 / c.h, away: 1 / c.a, ...(threeWay ? { draw: 1 / c.d } : {}) };
    out.set(id, { p: norm(inv, threeWay), src: `ESPN core closing (${o.provider})` });
  }
  return out;
}

// ------------------------------------------------------------------ main
(async () => {
  const t0 = Date.now();
  const sports = [...new Set(MATCH_LEAGUES.map((l) => l.sport as SportSlug))];
  const recs: Rec[] = [];
  const notes: Record<string, unknown> = {};
  const eloMeans: Record<string, Record<string, number>> = {};
  for (const sport of sports) {
    const leagues = MATCH_LEAGUES.filter((l) => l.sport === sport);
    const pool = leagues.flatMap((l) => loadRows(l.slug).map((r) => ({ ...r, league: l.slug }))).sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
    if (!pool.length) continue;
    const winDays = Math.max(...leagues.map((l) => l.historyDays ?? 365));
    const model = modelFor(sport);
    const threeWay = sport === 'football';
    // home/draw/away base rates per league over the previous 365 days
    const baseMemo = new Map<string, Probs>();
    const byLeague = new Map<string, typeof pool>();
    for (const x of pool) byLeague.set(x.league, [...(byLeague.get(x.league) ?? []), x]);
    const baseRate = (league: string, t: number): Probs => {
      const key = `${league}|${t}`;
      const hit = baseMemo.get(key);
      if (hit) return hit;
      const v = baseRateRaw(league, t);
      baseMemo.set(key, v);
      return v;
    };
    const baseRateRaw = (league: string, t: number): Probs => {
      const xs = (byLeague.get(league) ?? []).filter((x) => x.t < t && x.t >= t - 365 * DAY);
      const n = xs.length || 1;
      const h = xs.filter((x) => x.hs > x.as).length / n;
      const d = xs.filter((x) => x.hs === x.as).length / n;
      return threeWay ? norm({ home: h || 0.45, draw: d || 0.27, away: 1 - h - d || 0.28 }, true) : norm({ home: h || 0.54, away: 1 - h || 0.46 }, false);
    };
    // domestic league of each team (most frequent league among its matches) for the cross-league flag
    const leagueOf = new Map<string, Map<string, number>>();
    for (const x of pool) for (const tm of [x.h, x.a]) {
      const k = leagueOf.get(tm) ?? new Map();
      if (LEAGUE_BY_SLUG[x.league].kind === 'league') k.set(x.league, (k.get(x.league) ?? 0) + 1);
      leagueOf.set(tm, k);
    }
    const homeLeague = (tm: string) => [...(leagueOf.get(tm) ?? new Map()).entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    // full-history incremental book (root-cause comparison) and the simple Elo benchmark
    const fullBook = model.newBook();
    const elo = new SimpleElo(ELO_HFA[sport] ?? 50);
    // group by UTC day; daily rebuild of the production window
    const byDay = new Map<number, typeof pool>();
    for (const x of pool) byDay.set(Math.floor(x.t / DAY), [...(byDay.get(Math.floor(x.t / DAY)) ?? []), x]);
    const days = [...byDay.keys()].sort((a, b) => a - b);
    // incremental window book: rebuild once per day (cheap enough; exact production semantics)
    let i0 = 0;
    for (const day of days) {
      const dayStart = day * DAY;
      const todays = byDay.get(day)!;
      const evalToday = todays.filter((m) => {
        const w = EVAL_WINDOWS[m.league];
        return w && m.t >= w[0] && m.t < w[1];
      });
      if (evalToday.length) {
        const windowFrom = dayStart - winDays * DAY;
        const book = model.newBook();
        while (i0 < pool.length && pool[i0].t < windowFrom) i0++;
        for (let i = i0; i < pool.length && pool[i].t < dayStart; i++) book.update(toFinished(sport, pool[i]));
        // window 400 days: what an older install holds (the app keeps up to historyDays + 35 days)
        const book400 = model.newBook();
        for (const x of pool) if (x.t >= dayStart - (winDays + 35) * DAY && x.t < dayStart) book400.update(toFinished(sport, x));
        const marketBy = new Map<string, Map<string, { p: Probs; src: string }>>();
        for (const m of evalToday) {
          const o = outcomeOf(m.hs, m.as) as O;
          if (!threeWay && o === 'draw') continue; // NFL ties: excluded, as in the app
          const inp = book.buildInput({ home: `${sport}:${m.h}`, away: `${sport}:${m.a}`, kickoff: new Date(m.t), competition: m.league, neutral: !!m.n });
          const pm = norm(probabilities(model.predict(inp)) as Probs, threeWay);
          const inpF = fullBook.buildInput({ home: `${sport}:${m.h}`, away: `${sport}:${m.a}`, kickoff: new Date(m.t), competition: m.league, neutral: !!m.n });
          const pf = norm(probabilities(model.predict(inpF)) as Probs, threeWay);
          const inp4 = book400.buildInput({ home: `${sport}:${m.h}`, away: `${sport}:${m.a}`, kickoff: new Date(m.t), competition: m.league, neutral: !!m.n });
          const p4 = norm(probabilities(model.predict(inp4)) as Probs, threeWay);
          const e = elo.expect(m.h, m.a, m.t, !!m.n);
          const br = baseRate(m.league, dayStart);
          const pd = threeWay ? (br.draw ?? 0.26) : 0;
          const pe = threeWay ? norm({ home: Math.max(0.02, e - pd / 2), draw: pd, away: Math.max(0.02, 1 - e - pd / 2) }, true) : norm({ home: e, away: 1 - e }, false);
          if (!marketBy.has(m.league)) marketBy.set(m.league, marketOdds(m.league));
          const mk = marketBy.get(m.league)!.get(m.id) ?? null;
          const hl = homeLeague(m.h);
          const al = homeLeague(m.a);
          recs.push({ league: m.league, sport, id: m.id, t: m.t, o, model: pm, full: pf, elo: pe, base: br, market: mk?.p ?? null, marketSrc: mk?.src ?? null, minGames: Math.min(inp.home.games, inp.away.games), cross: !!hl && !!al && hl !== al, shift: null, w400: p4 });
        }
      }
      for (const m of todays) {
        fullBook.update(toFinished(sport, m));
        elo.update(m);
      }
    }
    // league strength as the current engine sees it: mean Elo of each domestic league's teams at the end
    if (sport === 'football') {
      const per: Record<string, number[]> = {};
      for (const tm of leagueOf.keys()) {
        const l = homeLeague(tm);
        if (!l) continue;
        (per[l] ??= []).push(fullBook.teamState(`football:${tm}`).elo);
      }
      eloMeans.football = Object.fromEntries(Object.entries(per).map(([l, v]) => [l, v.reduce((s, x) => s + x, 0) / v.length]));
    }
    console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${sport}: ${recs.filter((r) => r.sport === sport).length} matches evaluated`);
  }

  // window-start shift instability: same match, window starting 7 days later (sample of 1500 per sport)
  const shiftStats: Record<string, unknown> = {};
  for (const sport of sports) {
    const leagues = MATCH_LEAGUES.filter((l) => l.sport === sport);
    const pool = leagues.flatMap((l) => loadRows(l.slug).map((r) => ({ ...r, league: l.slug }))).sort((a, b) => a.t - b.t);
    const model = modelFor(sport);
    const winDays = Math.max(...leagues.map((l) => l.historyDays ?? 365));
    const xs = recs.filter((r) => r.sport === sport);
    const step = Math.max(1, Math.floor(xs.length / 400));
    const diffs: number[] = [];
    let flips = 0;
    for (let k = 0; k < xs.length; k += step) {
      const r = xs[k];
      const m = pool.find((x) => x.id === r.id && x.league === r.league)!;
      const dayStart = Math.floor(m.t / DAY) * DAY;
      const a = predictWith(model, pool, sport, dayStart - winDays * DAY, dayStart, m).p;
      const b = predictWith(model, pool, sport, dayStart - (winDays - 7) * DAY, dayStart, m).p;
      diffs.push(Math.abs((a.home ?? 0) - (b.home ?? 0)));
      if (top(a) !== top(b)) flips++;
    }
    diffs.sort((x, y) => x - y);
    shiftStats[sport] = { sampled: diffs.length, meanAbsDeltaHome: diffs.reduce((s, x) => s + x, 0) / (diffs.length || 1), p90: diffs[Math.floor(diffs.length * 0.9)] ?? null, max: diffs[diffs.length - 1] ?? null, favouriteFlips: flips / (diffs.length || 1) };
  }
  notes.windowShift = shiftStats;

  // football-data.co.uk (Pinnacle closing) for the domestic leagues it covers
  const fd = readFootballData(join(DATA, 'fd'));
  const fdMatch: Record<string, unknown> = {};
  for (const [slug, rows] of Object.entries(fd)) {
    const espnRows = loadRows(slug);
    const res = matchFootballData(espnRows, rows);
    fdMatch[slug] = { fdRows: rows.length, matched: res.size };
    for (const r of recs) {
      if (r.league !== slug || r.market) continue;
      const hit = res.get(r.id);
      if (!hit) continue;
      r.market = hit.p;
      r.marketSrc = hit.src;
    }
  }
  notes.footballDataMatching = fdMatch;

  // ------------------------------------------------------------------ report
  const groups: [string, (r: Rec) => boolean][] = [
    ...sports.map((s) => [`sport:${s}`, (r: Rec) => r.sport === s] as [string, (r: Rec) => boolean]),
    ...MATCH_LEAGUES.map((l) => [`league:${l.slug}`, (r: Rec) => r.league === l.slug] as [string, (r: Rec) => boolean]),
  ];
  const table: Record<string, unknown> = {};
  for (const [name, f] of groups) {
    const xs = recs.filter(f);
    if (!xs.length) continue;
    const withMk = xs.filter((r) => r.market);
    const homeAcc = xs.filter((r) => r.o === 'home').length / xs.length;
    table[name] = {
      n: xs.length,
      alwaysHomeAccuracy: homeAcc,
      model: summary(xs, 'model'),
      modelFullHistory: summary(xs, 'full'),
      modelWindow400: summary(xs, 'w400'),
      homeRateBaseline: summary(xs, 'base'),
      simpleElo: summary(xs, 'elo'),
      market: { coverage: withMk.length / xs.length, sources: [...new Set(withMk.map((r) => r.marketSrc))], bookmaker: summary(withMk, 'market'), modelSameMatches: summary(withMk, 'model'), eloSameMatches: summary(withMk, 'elo') },
      warm: summary(xs.filter((r) => r.minGames >= 5), 'model'),
      cold: summary(xs.filter((r) => r.minGames < 5), 'model'),
      coldShare: xs.filter((r) => r.minGames < 5).length / xs.length,
      crossLeague: { model: summary(xs.filter((r) => r.cross), 'model'), market: summary(xs.filter((r) => r.cross && r.market), 'market'), modelSame: summary(xs.filter((r) => r.cross && r.market), 'model') },
      calibrationModel: calibration(xs, 'model'),
      calibrationMarket: calibration(withMk, 'market'),
      drawPicks: xs[0].sport === 'football' ? { modelPicksDraw: xs.filter((r) => top(r.model) === 'draw').length / xs.length, actualDraws: xs.filter((r) => r.o === 'draw').length / xs.length, meanModelDrawProb: xs.reduce((s, r) => s + (r.model.draw ?? 0), 0) / xs.length } : null,
      homeBias: { meanModelHome: xs.reduce((s, r) => s + (r.model.home ?? 0), 0) / xs.length, actualHome: homeAcc },
      windowDrift400vs365: xs.reduce((s, r) => s + Math.abs((r.model.home ?? 0) - (r.w400.home ?? 0)), 0) / xs.length,
    };
  }
  // determinism: the same inputs twice must give byte-identical predictions
  const hash = createHash('sha256').update(JSON.stringify(recs.map((r) => [r.id, r.model]))).digest('hex');
  const out = { generatedAt: new Date().toISOString(), engine: 'MK Sports engine v2.1 (as shipped in app 1.4.1)', windows: EVAL_WINDOWS, totals: { matches: recs.length }, table, notes, eloMeans, predictionHash: hash };
  writeFileSync(join(OUT, process.env.OUT_NAME ?? 'step1.json'), JSON.stringify(out, null, 1));
  writeFileSync(join(OUT, (process.env.OUT_NAME ?? 'step1.json').replace('.json', '.records.json')), JSON.stringify(recs));
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s, ${recs.length} predictions, hash ${hash.slice(0, 16)}`);
  process.exit(0);
})();
