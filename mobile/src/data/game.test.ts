/** The game layer: levels, you against the AI, results to celebrate. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LEVELS, levelFor, type LocalPick, unseenResults, vsAI } from './game';

function pick(id: string, p: Partial<LocalPick>): LocalPick {
  return {
    matchId: id, sport: 'football', league: 'eng.1', kickoff: '2026-11-22T15:00:00Z', homeName: 'A', awayName: 'B', homeCode: 'A', awayCode: 'B',
    homeColor: '#f00', awayColor: '#00f', pick: 'home', home_score: null, away_score: null, ai_pick: 'home', status: 'pending', points: 0,
    result_correct: null, exact_score: false, final_score: null, created_at: '2026-11-20T10:00:00Z', updated_at: '2026-11-20T10:00:00Z', settled_at: null, ...p,
  };
}

test('levels climb with points and report progress to the next one', () => {
  assert.equal(levelFor(0).name, 'Rookie');
  assert.equal(levelFor(9).name, 'Rookie');
  assert.equal(levelFor(10).name, 'Amateur');
  const l = levelFor(37);
  assert.equal(l.name, 'Semi-pro');
  assert.equal(l.next, 'Pro');
  assert.ok(Math.abs(l.progress - (37 - 25) / (50 - 25)) < 1e-9);
  const top = levelFor(10_000);
  assert.equal(top.name, LEVELS[LEVELS.length - 1].name);
  assert.equal(top.next, null);
  assert.equal(top.progress, 1);
});

test('you vs the AI counts only settled picks where the AI had a call', () => {
  const st = {
    profile: { display_name: 'You', created_at: '', consented_at: null, country: null }, badges: {},
    picks: {
      a: pick('a', { pick: 'home', ai_pick: 'away', status: 'won', final_score: [2, 0], settled_at: '2026-11-22T17:00:00Z' }), // you beat the AI
      b: pick('b', { pick: 'draw', ai_pick: 'home', status: 'lost', final_score: [1, 0], settled_at: '2026-11-22T17:05:00Z' }), // AI beat you
      c: pick('c', { pick: 'away', ai_pick: 'away', status: 'won', final_score: [0, 1], settled_at: '2026-11-22T17:10:00Z' }), // both right
      d: pick('d', { pick: 'home', ai_pick: null, status: 'won', final_score: [3, 1], settled_at: '2026-11-22T17:15:00Z' }), // AI had no call
      e: pick('e', { pick: 'home', ai_pick: 'home', status: 'pending' }), // not settled
    },
    seen: { c: '2026-11-22T18:00:00Z' },
  };
  assert.deepEqual(vsAI(st), { matches: 3, you: 2, ai: 2, you_beat_ai: 1, ai_beat_you: 1, leader: 'level' });
  assert.deepEqual(unseenResults(st).map((p) => p.matchId), ['d', 'b', 'a']); // newest first, seen ones left out
});
