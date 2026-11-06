/**
 * Calibrates the margin model for NFL / NHL / MLB on real ESPN results (walk-forward:
 * every game predicted from earlier games only). Coordinate descent over the main
 * parameters, scored by log loss on games after a warm-up period.
 *
 *   NODE_USE_ENV_PROXY=1 node --import tsx scripts/calibrate-margin.ts [nfl|nhl|mlb ...]
 */
import { BASKETBALL_DEFAULTS, BasketballModel, BasketballParams, evaluate, FinishedMatch, MARGIN_SPORTS, outcomeOf, Probs, probabilities } from '../src/engine';
import { scoreboard, scoreboardYear, SEvent } from '../src/data/espn';
import { LEAGUE_BY_SLUG, SportSlug } from '../src/data/leagues';

const DAY = 86_400_000;

async function load(slug: string, days: number): Promise<FinishedMatch[]> {
  const lg = LEAGUE_BY_SLUG[slug];
  const now = Date.now();
  const from = now - days * DAY;
  const evs: SEvent[] = [];
  for (let y = new Date(from).getUTCFullYear(); y <= new Date(now).getUTCFullYear(); y++) {
    if (lg.yearly) evs.push(...(await scoreboardYear(slug, y, 3600)).events);
    else evs.push(...(await scoreboard(slug, new Date(Math.max(from, Date.UTC(y, 0, 1))), new Date(Math.min(now, Date.UTC(y + 1, 0, 1) - 1)), 3600)).events);
  }
  const seen = new Set<string>();
  return evs
    .filter((e) => e.status === 'finished' && !e.preseason && e.homeScore !== null && e.awayScore !== null && Date.parse(e.start) >= from && !seen.has(e.id) && seen.add(e.id))
    .map((e) => ({ id: e.id, date: new Date(e.start), home: e.home.id, away: e.away.id, homeScore: e.homeScore!, awayScore: e.awayScore!, competition: slug, neutral: e.neutral }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

function score(sport: SportSlug, params: BasketballParams, ms: FinishedMatch[], from: number, to = ms.length) {
  const m = MARGIN_SPORTS[sport];
  const model = new BasketballModel({}, {}, { sport, name: m.name, unit: m.unit, unitShort: m.unitShort, defaults: params });
  const book = model.newBook();
  const pairs: [Probs, ReturnType<typeof outcomeOf>][] = [];
  const conf: Record<string, [number, number]> = {};
  ms.forEach((g, i) => {
    if (i >= from && i < to) {
      const inp = book.buildInput({ home: g.home, away: g.away, kickoff: g.date, competition: g.competition, neutral: g.neutral });
      const o = outcomeOf(g.homeScore, g.awayScore);
      if (o !== 'draw' && Math.min(inp.home.games, inp.away.games) >= 3) {
        const p = model.predict(inp);
        const pr = probabilities(p);
        pairs.push([pr, o]);
        const c = (conf[p.confidence] ??= [0, 0]);
        c[0] += 1;
        c[1] += (pr.home ?? 0) >= 0.5 === (o === 'home') ? 1 : 0;
      }
    }
    book.update(g);
  });
  return { ...evaluate(pairs), conf };
}

const GRID: Partial<Record<keyof BasketballParams, number[]>> = {
  k: [3, 4, 6, 8, 10, 14, 20, 26, 32, 40],
  homeAdvantageElo: [0, 15, 24, 30, 40, 48, 60, 75],
  eloPointsPerPoint: [15, 20, 25, 30, 45, 60, 75, 90, 120, 160, 200, 260],
  eloWeight: [0.3, 0.45, 0.6, 0.7, 0.85, 1],
  netShrink: [0.3, 0.5, 0.6, 0.8, 1],
  pointsAlpha: [0.02, 0.03, 0.05, 0.08, 0.12, 0.15, 0.2],
  homeCourtPts: [0, 0.1, 0.15, 0.2, 0.3, 1, 1.6, 2.2],
  sigma: [1.8, 2.1, 2.4, 2.8, 3.6, 4.0, 4.4, 5.0, 11, 12.5, 13.5, 15],
  backToBackPts: [0, -0.1, -0.2, -0.4],
};

async function calibrate(slug: string) {
  const sport = LEAGUE_BY_SLUG[slug].sport as SportSlug;
  const days = slug === 'nfl' ? 1100 : 560;
  const ms = await load(slug, days);
  // tune on games 30-70% of the way through, report on the last 30% (never seen while tuning)
  const warm = Math.floor(ms.length * 0.3);
  const split = Math.floor(ms.length * 0.7);
  let best: BasketballParams = { ...BASKETBALL_DEFAULTS, ...MARGIN_SPORTS[sport].params };
  const start = score(sport, best, ms, split);
  let bestScore = score(sport, best, ms, warm, split);
  console.log(`${slug}: ${ms.length} real games (${ms[0]?.date.toISOString().slice(0, 10)} -> ${ms[ms.length - 1]?.date.toISOString().slice(0, 10)}), scored ${bestScore.n} after warm-up`);
  console.log(`  current settings on the held-out games: logloss ${start.logLoss.toFixed(4)} hit ${(start.accuracy * 100).toFixed(1)}% (n=${start.n})`);
  for (let round = 0; round < 3; round++) {
    let improved = false;
    for (const [key, values] of Object.entries(GRID) as [keyof BasketballParams, number[]][]) {
      if (sport === 'baseball' && key === 'backToBackPts') continue; // daily schedule: no back-to-back effect
      for (const v of values) {
        const cand = { ...best, [key]: v };
        const s = score(sport, cand, ms, warm, split);
        if (s.logLoss < bestScore.logLoss - 1e-5) {
          best = cand;
          bestScore = s;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  const test = score(sport, best, ms, split);
  const homeRate = ms.slice(split).filter((g) => g.homeScore > g.awayScore).length / Math.max(1, ms.length - split);
  console.log(`  tuned, on the held-out games: logloss ${test.logLoss.toFixed(4)} brier ${test.brier.toFixed(4)} hit ${(test.accuracy * 100).toFixed(1)}% n=${test.n} (always-home hit ${(homeRate * 100).toFixed(1)}%, coin-flip logloss 0.6931)`);
  console.log('  by confidence (held-out):', Object.fromEntries(Object.entries(test.conf).map(([k, [n, c]]) => [k, `${((c / n) * 100).toFixed(0)}% of ${n}`])));
  const keys = Object.keys(GRID) as (keyof BasketballParams)[];
  console.log('  params:', JSON.stringify(Object.fromEntries(keys.map((k) => [k, best[k]]))));
}

(async () => {
  const which = process.argv.slice(2).length ? process.argv.slice(2) : ['nfl', 'nhl', 'mlb'];
  for (const s of which) await calibrate(s);
  process.exit(0);
})();
