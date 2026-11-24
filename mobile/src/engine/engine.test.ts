/** Parity: the TypeScript engine must reproduce the Python engine (fixtures from engine/scripts). */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  americanToDecimal,
  basketballScoreFor,
  blend,
  evaluate,
  FinishedMatch,
  footballScoreFor,
  getModel,
  impliedFromDecimal,
  normalCdf,
  normalInv,
  Outcome,
  outcomeOf,
  probabilities,
  sourceWeights,
  walkForward,
} from './index';

const fx = JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'parity.json'), 'utf8'));

function matches(raw: any[]): FinishedMatch[] {
  return raw.map((m) => ({ ...m, date: new Date(m.date) }));
}

for (const sport of ['football', 'basketball'] as const) {
  test(`${sport}: predictions match the Python engine`, () => {
    const model = getModel(sport);
    const ms = matches(fx[sport].matches);
    const book = model.newBook();
    book.updateMany(ms);
    for (const [team, elo] of Object.entries(fx[sport].elo as Record<string, number>)) assert.ok(Math.abs(book.rating(team) - elo) < 1e-6, `elo ${team}`);
    for (const { query: q, expected: e } of fx[sport].predictions) {
      const inp = book.buildInput({
        home: q.home,
        away: q.away,
        kickoff: new Date(q.kickoff),
        competition: ms[0].competition,
        neutral: !!q.neutral,
        homeAbsences: q.homeAbsences,
        awayAbsences: q.awayAbsences,
        homeName: `Team ${q.home}`,
        awayName: `Team ${q.away}`,
      });
      const p = model.predict(inp);
      const label = `${q.home} v ${q.away}`;
      assert.ok(Math.abs(p.probHome - e.probHome) < 2e-4, `${label} home ${p.probHome} vs ${e.probHome}`);
      assert.ok(Math.abs(p.probAway - e.probAway) < 2e-4, `${label} away`);
      if (e.probDraw === null) assert.equal(p.probDraw, null);
      else assert.ok(Math.abs((p.probDraw as number) - e.probDraw) < 2e-4, `${label} draw`);
      assert.deepEqual([p.predictedHome, p.predictedAway], [e.predictedHome, e.predictedAway], `${label} score`);
      assert.ok(Math.abs(p.expectedHome - e.expectedHome) < 0.011 && Math.abs(p.expectedAway - e.expectedAway) < 0.011, `${label} expected`);
      assert.equal(p.confidence, e.confidence, `${label} confidence`);
      assert.deepEqual(p.keyFactors.map((f) => f.text), e.factors, `${label} factors`);
      assert.equal(p.explanation.summary, e.summary, `${label} summary`);
    }
  });

  test(`${sport}: walk-forward backtest metrics match`, () => {
    const model = getModel(sport);
    const pairs: [Partial<Record<Outcome, number>>, Outcome][] = [];
    let seen = 0;
    walkForward(model, matches(fx[sport].matches), (m, p) => {
      const o = outcomeOf(m.homeScore, m.awayScore);
      if (sport === 'basketball' && o === 'draw') return;
      if (seen++ >= 100) pairs.push([probabilities(p), o]);
    });
    const m = evaluate(pairs);
    const e = fx[sport].backtest.model;
    assert.equal(m.n, e.n);
    assert.ok(Math.abs(m.logLoss - e.log_loss) < 1e-3, `log loss ${m.logLoss} vs ${e.log_loss}`);
    assert.ok(Math.abs(m.accuracy - e.accuracy) < 1e-3, `accuracy ${m.accuracy} vs ${e.accuracy}`);
  });
}

test('normal distribution helpers', () => {
  assert.ok(Math.abs(normalCdf(1.96) - 0.975) < 1e-4);
  assert.ok(Math.abs(normalInv(0.975) - 1.96) < 1e-3);
  assert.ok(Math.abs(normalInv(normalCdf(-0.7)) + 0.7) < 1e-4);
});

test('market prices to probabilities', () => {
  assert.equal(americanToDecimal('+150'), 2.5);
  assert.ok(Math.abs((americanToDecimal(-200) as number) - 1.5) < 1e-9);
  assert.equal(americanToDecimal('EVEN'), 2);
  assert.equal(americanToDecimal(null), null);
  const p = impliedFromDecimal({ home: 1.8, draw: 3.6, away: 4.5 })!;
  assert.ok(Math.abs(p.home! + p.draw! + p.away! - 1) < 1e-12);
  assert.ok(p.home! > p.draw! && p.draw! > p.away!);
});

test('ensemble leans towards the more accurate source', () => {
  const prior = sourceWeights(['model', 'market'], {});
  assert.ok(prior.market > prior.model); // market starts with the higher prior
  // over 200 shared matches the model was 0.05 better per match -> it takes over
  const modelBetter = sourceWeights(['model', 'market'], { market: { n: 200, delta: 0.05 } });
  assert.ok(modelBetter.model > 0.95, JSON.stringify(modelBetter));
  // and the other way round
  const marketBetter = sourceWeights(['model', 'market', 'clubelo'], { market: { n: 200, delta: -0.04 }, clubelo: { n: 40, delta: -0.01 } });
  assert.ok(marketBetter.market > marketBetter.clubelo && marketBetter.clubelo > marketBetter.model, JSON.stringify(marketBetter));
  const thin = sourceWeights(['model', 'market'], { market: { n: 5, delta: 2 } });
  assert.deepEqual(thin, prior); // too little evidence: priors only
  const b = blend(
    [
      { source: 'model', probs: { home: 0.5, draw: 0.3, away: 0.2 } },
      { source: 'market', probs: { home: 0.7, draw: 0.2, away: 0.1 } },
    ],
    { model: 0.25, market: 0.75 },
    true,
  );
  assert.ok(Math.abs(b.home! - 0.65) < 1e-9 && Math.abs(b.draw! + b.home! + b.away! - 1) < 1e-9);
});

test('scorelines agree with blended probabilities', () => {
  const f = footballScoreFor({ home: 0.62, draw: 0.22, away: 0.16 }, 2.7);
  assert.ok(f.score[0] > f.score[1]);
  const d = footballScoreFor({ home: 0.3, draw: 0.4, away: 0.3 }, 2.2);
  assert.equal(d.score[0], d.score[1]);
  const b = basketballScoreFor({ home: 0.3, away: 0.7 }, 226, 12);
  assert.ok(b.score[1] > b.score[0] && b.margin < 0 && Math.abs(b.score[0] + b.score[1] - 226) <= 1);
});

test('goals outlook: a proper score grid, sensible over/under and clean sheets', async () => {
  const { goalsOutlook, goalsRead, scoreGrid } = await import('./scorelines');
  const g = scoreGrid(1.6, 1.1);
  assert.ok(Math.abs(g.flat().reduce((s, v) => s + v, 0) - 1) < 1e-9);
  const o = goalsOutlook(1.6, 1.1);
  assert.equal(o.top.length, 5);
  assert.ok(o.top[0].p >= o.top[4].p);
  assert.ok(o.over25 > 0.4 && o.over25 < 0.6, String(o.over25)); // 2.7 expected goals: near a coin flip
  // a home clean sheet means the away side (1.1 expected) scores none: likelier than the home side (1.6) scoring none
  assert.ok(o.homeCleanSheet < 0.4 && o.awayCleanSheet < o.homeCleanSheet);
  const low = goalsOutlook(0.8, 0.7);
  assert.ok(low.over25 < 0.25);
  assert.deepEqual([low.top[0].h, low.top[0].a], [0, 0]);
  assert.match(goalsRead(1.9, 0.8, 'Arsenal', 'Fulham'), /Arsenal expected to create more/);
  assert.match(goalsRead(0.9, 0.9, 'A', 'B'), /tight, low-scoring.*little between/);
});
