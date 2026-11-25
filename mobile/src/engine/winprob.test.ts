import assert from 'node:assert/strict';
import { test } from 'node:test';

import { scoreGrid } from './scorelines';
import { clockMinute, eventsFromDetail, winProbability, winProbabilityPath } from './winprob';

const close = (a: number, b: number, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('at kick-off the live probability equals the pre-match score grid', () => {
  const p = winProbability(1.6, 1.1, 0, 0, 0);
  const g = scoreGrid(1.6, 1.1);
  let home = 0;
  let draw = 0;
  g.forEach((row, h) => row.forEach((v, a) => (h > a ? (home += v) : h === a ? (draw += v) : 0)));
  close(p.home, home);
  close(p.draw, draw);
  close(p.home + p.draw + p.away, 1, 1e-9);
});

test('a late lead is almost decisive; a late 0-0 is mostly a draw', () => {
  assert.ok(winProbability(1.5, 1.5, 85, 1, 0).home > 0.85);
  assert.ok(winProbability(1.5, 1.5, 94, 0, 0).draw > 0.95);
  assert.ok(winProbability(1.5, 1.5, 30, 0, 2).away > 0.75);
});

test('a red card moves the probability against the side that lost a player', () => {
  const before = winProbability(1.4, 1.2, 30, 0, 0);
  const after = winProbability(1.4, 1.2, 30, 0, 0, 1, 0);
  assert.ok(after.home < before.home && after.away > before.away);
});

test('the path replays goals and red cards and ends on the result', () => {
  const ev = eventsFromDetail(
    [
      { type: 'goal', minute: 10, side: 'home' },
      { type: 'red_card', minute: 40, side: 'away' },
      { type: 'goal', minute: 66, side: 'home' },
    ],
    [2, 0],
  );
  const path = winProbabilityPath(1.3, 1.3, ev, 90, true, [2, 0]);
  assert.equal(path[0].minute, 0);
  assert.ok(path[11].home > path[9].home); // the goal at 10'
  assert.ok(path[41].away < path[39].away); // the red card at 40'
  assert.deepEqual([path.at(-1)!.home, path.at(-1)!.draw, path.at(-1)!.away], [1, 0, 0]);
  for (const p of path) close(p.home + p.draw + p.away, 1, 1e-9);
});

test('own goals are flipped when that is what makes the goals add up to the score', () => {
  // the feed lists the own goal under the side of the player who scored it
  const ev = eventsFromDetail([{ type: 'own_goal', minute: 20, side: 'home' }, { type: 'goal', minute: 50, side: 'away' }], [0, 2]);
  assert.deepEqual(ev.filter((e) => e.kind === 'goal').map((e) => e.side), ['away', 'away']);
  // already credited to the side that benefits: left as it is
  const ev2 = eventsFromDetail([{ type: 'own_goal', minute: 20, side: 'away' }], [0, 1]);
  assert.equal(ev2[0].side, 'away');
});

test('match clock parsing', () => {
  assert.equal(clockMinute("63'"), 63);
  assert.equal(clockMinute("45'+2'"), 47);
  assert.equal(clockMinute("90'+4'"), 94);
  assert.equal(clockMinute('HT'), 45);
  assert.equal(clockMinute(null), null);
  assert.equal(clockMinute(null, 'finished'), 90);
});
