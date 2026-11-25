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

// ------------------------------------------------------------------ banker and season archive
import { gameState, loadGame, makePick, PickError, resetGame, seasonArchive, settle, updateProfile } from './game';
import { memoryKV, setKV } from './kv';
import type { SEvent } from './espn';

function ev(id: string, start: string, over: Partial<SEvent> = {}): SEvent {
  const team = (n: string) => ({ id: `football:${n}`, espnId: n, name: n, short: n, abbr: n.slice(0, 3).toUpperCase(), color: '#000', logo: null });
  return { id, espnId: id, league: 'eng.1', sport: 'football', start, status: 'scheduled', clock: null, home: team('Home'), away: team('Away'), homeScore: null, awayScore: null, venue: null, neutral: false, round: null, details: [], quarters: null, market: null, preseason: false, ...over } as SEvent;
}

test('banker: one a week, double points, and it can move only until its match kicks off', async () => {
  setKV(memoryKV());
  await resetGame();
  await loadGame();
  await updateProfile({ consented_at: new Date().toISOString() });
  const a = ev('eng.1~1', '2030-06-05T12:00:00Z'); // Wednesday
  const b = ev('eng.1~2', '2030-06-06T12:00:00Z'); // Thursday, same week
  const c = ev('eng.1~3', '2030-06-12T12:00:00Z'); // the next week
  await makePick(a, { pick: 'home', banker: true }, 'home');
  await makePick(c, { pick: 'away', banker: true }, 'home'); // another week: both stay bankers
  await makePick(b, { pick: 'home', banker: true }, 'home'); // moves the week's banker from a to b
  let st = gameState()!;
  assert.equal(st.picks['eng.1~1'].banker, false);
  assert.equal(st.picks['eng.1~2'].banker, true);
  assert.equal(st.picks['eng.1~3'].banker, true);
  // re-saving a pick keeps its banker
  await makePick(b, { pick: 'home', home_score: 2, away_score: 0 }, 'home');
  assert.equal(gameState()!.picks['eng.1~2'].banker, true);
  // once b's match is under way (no longer pending), the banker can't move to a
  gameState()!.picks['eng.1~2'].status = 'lost';
  await assert.rejects(makePick(a, { pick: 'home', banker: true }, 'home'), (e: unknown) => e instanceof PickError && e.code === 'banker_locked');
  gameState()!.picks['eng.1~2'].status = 'pending';
  // settling: b right with the exact score = (3 + 2) x 2; c wrong = 0
  await settle([{ ...b, status: 'finished', homeScore: 2, awayScore: 0 }, { ...c, status: 'finished', homeScore: 1, awayScore: 0 }]);
  st = gameState()!;
  assert.equal(st.picks['eng.1~2'].points, 10);
  assert.equal(st.picks['eng.1~3'].points, 0);
});

test('season archive groups settled picks by July-June season, newest first', () => {
  const st = {
    profile: { display_name: 'You', created_at: '', consented_at: null, country: null }, badges: {},
    picks: {
      a: pick('a', { kickoff: '2025-03-01T15:00:00Z', status: 'won', points: 3, settled_at: '2025-03-01T17:00:00Z' }),
      b: pick('b', { kickoff: '2025-04-01T15:00:00Z', status: 'lost', points: 0, settled_at: '2025-04-01T17:00:00Z', banker: true }),
      c: pick('c', { kickoff: '2025-09-01T15:00:00Z', status: 'won', points: 10, exact_score: true, settled_at: '2025-09-01T17:00:00Z', banker: true }),
      d: pick('d', { kickoff: '2025-09-08T15:00:00Z', status: 'won', points: 3, settled_at: '2025-09-08T17:00:00Z' }),
      e: pick('e', { kickoff: '2025-09-09T15:00:00Z', status: 'pending' }),
    },
  };
  const arch = seasonArchive(st);
  assert.deepEqual(arch.map((s) => s.season), ['2025-26', '2024-25']);
  assert.deepEqual([arch[0].points, arch[0].picks, arch[0].correct, arch[0].exact, arch[0].best_streak, arch[0].bankers, arch[0].bankers_won], [13, 2, 2, 1, 2, 1, 1]);
  assert.deepEqual([arch[1].points, arch[1].picks, arch[1].correct, arch[1].bankers, arch[1].bankers_won], [3, 2, 1, 1, 0]);
});
