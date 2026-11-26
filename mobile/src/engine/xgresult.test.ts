import assert from 'node:assert/strict';
import { test } from 'node:test';

import { chancesVerdict, deservedLine, deservedResult, goalsDistribution } from './xgresult';

test('goals from shots follow the Poisson-binomial distribution', () => {
  const d = goalsDistribution([0.5, 0.5]);
  assert.deepEqual(d.map((x) => Math.round(x * 100) / 100), [0.25, 0.5, 0.25]);
  assert.deepEqual(goalsDistribution([]), [1]);
  const many = goalsDistribution(new Array(40).fill(0.1));
  assert.ok(Math.abs(many.reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

test('deserved result: probabilities sum to one and expected points follow', () => {
  const d = deservedResult([0.5, 0.3, 0.1, 0.76], [0.05, 0.08]);
  assert.ok(Math.abs(d.home + d.draw + d.away - 1) < 1e-9);
  assert.ok(d.home > 0.7 && d.away < 0.1);
  assert.ok(Math.abs(d.xptsHome - (3 * d.home + d.draw)) < 1e-12);
  // no shots at all: a certain 0-0
  const z = deservedResult([], []);
  assert.equal(z.draw, 1);
  assert.equal(z.xptsHome, 1);
});

test('the deserved line reads the result against the chances', () => {
  assert.equal(deservedLine('Arsenal', 'Chelsea', 2.1, 0.7, 0, 1), 'Arsenal won the xG 2.1–0.7 but lost 0–1.');
  assert.equal(deservedLine('Arsenal', 'Chelsea', 0.4, 1.9, 1, 1), 'Chelsea won the xG 1.9–0.4 but drew 1–1.');
  assert.equal(deservedLine('Arsenal', 'Chelsea', 0.4, 1.9, 0, 2), 'Chelsea won the xG 1.9–0.4 and the match 2–0.');
  assert.equal(deservedLine('Arsenal', 'Chelsea', 1.2, 1.1, 2, 0), 'Even on chances (xG 1.2–1.1), but Arsenal won 2–0.');
  assert.equal(deservedLine('Arsenal', 'Chelsea', 1.6, 0.6, 0, 1, true), 'Arsenal lead the xG 1.6–0.6 but trail 0–1.');
});

test('a missed call is explained honestly either way', () => {
  const homeChances = { home: 0.7, draw: 0.2, away: 0.1, xptsHome: 2.3, xptsAway: 0.5 };
  assert.match(chancesVerdict(homeChances, 'home', 'away', 'ARS', 'CHE'), /favoured the call \(ARS win\); the result went the other way/);
  assert.match(chancesVerdict(homeChances, 'away', 'home', 'ARS', 'CHE'), /backed the result: the call was wrong/);
  assert.match(chancesVerdict(homeChances, 'home', 'home', 'ARS', 'CHE'), /matched the chances/);
});
