import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SOURCE_PRIORS_BY_SPORT, sourceWeights } from './ensemble';
import { getModel } from './models';
import { fullFit, type RidgeCfg, type RidgeGame, RidgeStore } from './ridge';

const DAY = 86_400_000;
const cfg: RidgeCfg = { halfLife: 60, lambda: 2, cap: 20, prevSeason: 1, backToBack: true };

function season(seed = 7) {
  // deterministic pseudo-random league: 8 teams with true strengths, home edge 3 points
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const strength = [8, 5, 3, 1, -1, -3, -5, -8];
  const games: RidgeGame[] = [];
  let t = Date.UTC(2025, 9, 20);
  for (let k = 0; k < 400; k++) {
    const h = Math.floor(rnd() * 8);
    let a = Math.floor(rnd() * 8);
    if (a === h) a = (a + 1) % 8;
    const noise = (rnd() + rnd() + rnd() - 1.5) * 20;
    games.push({ t, h: `T${h}`, a: `T${a}`, m: Math.round(strength[h] - strength[a] + 3 + noise), n: false, b2b: rnd() < 0.1 ? 1 : 0 });
    t += 0.4 * DAY;
  }
  return games;
}

test('rolled-forward sums give the same ratings as a direct fit', () => {
  const games = season();
  const st = new RidgeStore();
  for (const g of games) st.add(g.t, g.h, g.a, g.m, g.n, g.b2b, 'nba');
  for (const at of [games[150].t, games[260].t, games[399].t + DAY]) {
    const day = Math.floor(at / DAY) * DAY;
    const rolled = st.fit(cfg, 'nba', at);
    const direct = fullFit(cfg, games.filter((g) => g.t < day), day);
    assert.equal(rolled.games, direct.games);
    for (const [team, r] of direct.ratings) assert.ok(Math.abs((rolled.ratings.get(team) ?? 0) - r) < 1e-9, team);
    assert.ok(Math.abs(rolled.homeAdvantage - direct.homeAdvantage) < 1e-9);
  }
  // asking about an earlier day after a later one rebuilds correctly
  const early = st.fit(cfg, 'nba', games[100].t + 3 * DAY);
  const d = Math.floor((games[100].t + 3 * DAY) / DAY) * DAY;
  const ref = fullFit(cfg, games.filter((g) => g.t < d), d);
  assert.ok(Math.abs((early.ratings.get('T0') ?? 0) - (ref.ratings.get('T0') ?? 0)) < 1e-9);
});

test('ratings recover the true order and the home edge', () => {
  const games = season(11);
  const fit = fullFit({ ...cfg, halfLife: 10_000 }, games, games[games.length - 1].t + DAY);
  const order = [...fit.ratings].sort((x, y) => y[1] - x[1]).map(([t]) => t);
  assert.deepEqual(order.slice(0, 2), ['T0', 'T1']);
  assert.deepEqual(order.slice(-2), ['T6', 'T7']);
  assert.ok(fit.homeAdvantage > 1.5 && fit.homeAdvantage < 4.5, `home edge ${fit.homeAdvantage}`);
  const st = new RidgeStore();
  for (const g of games.slice(0, 20)) st.add(g.t, g.h, g.a, g.m, g.n, g.b2b, 'nba');
  assert.equal(st.margin(cfg, 'nba', 'T0', 'T7', false, 0, games[25].t), null); // too few games to rate
});

test('the NBA model blends the opponent-adjusted margin only when asked to', () => {
  const games = season(3);
  const plain = getModel('basketball');
  const blended = getModel('basketball', {}, { nba: { ridgeWeight: 0.7, sigma: 10.81 } });
  const feed = (m: ReturnType<typeof getModel>) => {
    const book = m.newBook();
    for (const g of games) book.update({ id: String(g.t), date: new Date(g.t), home: g.h, away: g.a, homeScore: 100 + Math.max(0, g.m), awayScore: 100 + Math.max(0, -g.m) + (g.m === 0 ? 1 : 0), competition: 'nba', neutral: false });
    return m.predict(book.buildInput({ home: 'T0', away: 'T7', kickoff: new Date(games[games.length - 1].t + DAY), competition: 'nba' }));
  };
  const a = feed(plain);
  const b = feed(blended);
  assert.ok(!a.explanation.steps.some((s) => s.title.startsWith('Opponent-adjusted')));
  assert.ok(b.explanation.steps.some((s) => s.title.startsWith('Opponent-adjusted')));
  assert.equal(b.explanation.inputs.ridge_weight, 0.7);
  assert.ok(b.probHome > 0.5);
});

test('with bookmaker odds listed, the US sports lean 90% on the market', () => {
  for (const sport of ['basketball', 'ice-hockey', 'american-football']) {
    const w = sourceWeights(['model', 'market'], {}, 2, SOURCE_PRIORS_BY_SPORT[sport]);
    assert.ok(Math.abs(w.market - 0.9) < 1e-9, sport);
  }
  const football = sourceWeights(['model', 'market'], {}, 2, SOURCE_PRIORS_BY_SPORT.football ?? {});
  assert.ok(Math.abs(football.market - 2 / 3) < 1e-9); // unchanged elsewhere
});
