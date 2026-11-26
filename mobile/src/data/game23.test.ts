/** 2.3 game additions: probability picks (Brier score), F1 and tennis picks, season recap, week report. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { SEvent } from './espn';
import {
  brier, gameState, loadGame, makePick, makeSpecial, PickError, probabilityRecord, resetGame, scorePodium, scoreTennis, seasonRecap, settle, settleSpecials, stats,
  updateProfile, validateProbs, weekReport, type LocalPick,
} from './game';
import { memoryKV, setKV } from './kv';
import { adjustPct, callOf, normalisePct } from '@/lib/probs';

function ev(id: string, start: string, over: Partial<SEvent> = {}): SEvent {
  const team = (n: string) => ({ id: `football:${n}`, espnId: n, name: n, short: n, abbr: n.slice(0, 3).toUpperCase(), color: '#000', logo: null });
  return { id, espnId: id, league: 'eng.1', sport: 'football', start, status: 'scheduled', clock: null, home: team('Home'), away: team('Away'), homeScore: null, awayScore: null, venue: null, neutral: false, round: null, details: [], quarters: null, market: null, preseason: false, ...over } as SEvent;
}

async function fresh() {
  setKV(memoryKV());
  await resetGame();
  await loadGame();
  await updateProfile({ consented_at: new Date().toISOString() });
}

test('Brier score: 0 is perfect, a third each scores 0.67, certain and wrong scores 2', () => {
  assert.equal(brier({ home: 1, draw: 0, away: 0 }, 'home'), 0);
  assert.ok(Math.abs(brier({ home: 1 / 3, draw: 1 / 3, away: 1 / 3 }, 'away') - 2 / 3) < 1e-12);
  assert.equal(brier({ home: 1, draw: 0, away: 0 }, 'away'), 2);
});

test('probability picks must add up to 100% and make a call', () => {
  assert.deepEqual(validateProbs(true, { home: 0.5, draw: 0.3, away: 0.2 }).pick, 'home');
  assert.equal(validateProbs(true, { home: 0.2, draw: 0.45, away: 0.35 }).pick, 'draw');
  assert.throws(() => validateProbs(true, { home: 0.5, draw: 0.3, away: 0.3 }), (e: unknown) => e instanceof PickError && e.code === 'probs_sum');
  assert.throws(() => validateProbs(true, { home: 1.2, draw: -0.1, away: -0.1 }), (e: unknown) => e instanceof PickError && e.code === 'invalid_probs');
  assert.equal(validateProbs(false, { home: 0.4, draw: 0.9, away: 0.6 }).probs.draw, 0); // no draws in this sport
});

test('the percentage editor keeps whole numbers that add up to 100', () => {
  const p = adjustPct({ home: 45, draw: 30, away: 25 }, 'home', 5);
  assert.equal(p.home, 50);
  assert.equal(p.home + p.draw + p.away, 100);
  const q = adjustPct({ home: 100, draw: 0, away: 0 }, 'home', -5);
  assert.equal(q.home + q.draw + q.away, 100);
  assert.equal(q.home, 95);
  const two = adjustPct({ home: 50, draw: 0, away: 50 }, 'away', 5, ['home', 'away']);
  assert.deepEqual(two, { home: 45, draw: 0, away: 55 });
  assert.deepEqual(normalisePct({ home: 0.333, draw: 0.333, away: 0.334 }), { home: 33, draw: 33, away: 34 });
  assert.equal(callOf({ home: 40, draw: 20, away: 40 }), 'home');
});

test('a probability pick is saved with the AI numbers of the same moment, settles, and scores by Brier', async () => {
  await fresh();
  const e = ev('eng.1~p1', '2030-06-05T12:00:00Z');
  const { pick } = await makePick(e, { probs: { home: 0.6, draw: 0.25, away: 0.15 } }, 'away', { home: 0.3, draw: 0.3, away: 0.4 });
  assert.equal(pick.pick, 'home');
  assert.equal(pick.home_score, null);
  await settle([{ ...e, status: 'finished', homeScore: 2, awayScore: 1 }]);
  const st = gameState()!;
  assert.equal(st.picks[e.id].status, 'won');
  const r = probabilityRecord(st);
  assert.equal(r.matches, 1);
  assert.ok(Math.abs(r.you! - brier({ home: 0.6, draw: 0.25, away: 0.15 }, 'home')) < 1e-9);
  assert.ok(Math.abs(r.ai! - brier({ home: 0.3, draw: 0.3, away: 0.4 }, 'home')) < 1e-9);
  assert.equal(r.leader, 'you');
  assert.equal(r.better, 1);
});

test('F1 podium and tennis scoring', () => {
  assert.equal(scorePodium(['A', 'B', 'C'], ['A', 'B', 'C']), 20);
  assert.equal(scorePodium(['A', 'B', 'C'], ['B', 'A', 'C']), 2 + 2 + 5);
  assert.equal(scorePodium(['A', 'B', 'X'], ['C', 'D', 'E']), 0);
  assert.equal(scorePodium(['Max Verstappen', 'B', 'C'], ['max verstappen', 'Z', 'Y']), 5); // names compared loosely
  assert.equal(scoreTennis(0, 3, { winner: 0, sets: 3 }), 5);
  assert.equal(scoreTennis(0, 3, { winner: 0, sets: 2 }), 3);
  assert.equal(scoreTennis(1, 2, { winner: 0, sets: 2 }), 0);
});

test('F1 and tennis picks lock at the start, settle from results, add to points, and go void if never resolved', async () => {
  await fresh();
  const start = '2030-06-07T13:00:00Z';
  await assert.rejects(makeSpecial({ kind: 'f1', id: 'f1:1', name: 'GP', start, podium: ['A', 'A', 'B'] }, Date.parse('2030-06-01T00:00:00Z')), (e: unknown) => e instanceof PickError && e.code === 'invalid_podium');
  await makeSpecial({ kind: 'f1', id: 'f1:1', name: 'GP', start, podium: ['A', 'B', 'C'] }, Date.parse('2030-06-01T00:00:00Z'));
  await assert.rejects(makeSpecial({ kind: 'f1', id: 'f1:2', name: 'GP2', start, podium: ['A', 'B', 'C'] }, Date.parse(start) + 1), (e: unknown) => e instanceof PickError && e.code === 'locked');
  await assert.rejects(
    makeSpecial({ kind: 'tennis', id: 'tennis:atp:9', tour: 'atp', name: 'X', start, players: ['P', 'Q'], winner: 0, sets: 4, bestOf: 3 }, Date.parse('2030-06-01T00:00:00Z')),
    (e: unknown) => e instanceof PickError && e.code === 'invalid_sets',
  );
  await makeSpecial({ kind: 'tennis', id: 'tennis:atp:9', tour: 'atp', name: 'X', start, players: ['P', 'Q'], winner: 1, sets: 2, bestOf: 3 }, Date.parse('2030-06-01T00:00:00Z'));
  await makeSpecial({ kind: 'tennis', id: 'tennis:wta:7', tour: 'wta', name: 'Y', start, players: ['R', 'S'], winner: 0, sets: 2, bestOf: 3 }, Date.parse('2030-06-01T00:00:00Z'));
  const n = await settleSpecials({ f1: { 'f1:1': ['A', 'C', 'B'] }, tennis: { 'tennis:atp:9': { winner: 1, sets: 2 } } }, Date.parse(start) + 86400000);
  assert.equal(n, 2);
  const st = gameState()!;
  assert.equal(st.specials!['f1:1'].points, 5 + 2 + 2);
  assert.equal(st.specials!['tennis:atp:9'].points, 5);
  assert.equal(st.specials!['tennis:wta:7'].status, 'pending');
  assert.equal(stats(st).total_points, 14);
  await settleSpecials({}, Date.parse(start) + 11 * 86400000);
  assert.equal(gameState()!.specials!['tennis:wta:7'].status, 'void');
});

function pick(id: string, p: Partial<LocalPick>): LocalPick {
  return {
    matchId: id, sport: 'football', league: 'eng.1', kickoff: '2026-11-22T15:00:00Z', homeName: 'Arsenal', awayName: 'Chelsea', homeCode: 'ARS', awayCode: 'CHE',
    homeColor: '#f00', awayColor: '#00f', pick: 'home', home_score: null, away_score: null, ai_pick: 'home', status: 'won', points: 3,
    result_correct: true, exact_score: false, final_score: [1, 0], created_at: '2026-11-20T10:00:00Z', updated_at: '2026-11-20T10:00:00Z', settled_at: '2026-11-22T17:00:00Z', ...p,
  };
}

test('season recap: best pick is the least likely call that came off; the team called best needs three picks', () => {
  const st = {
    profile: { display_name: 'You', created_at: '', consented_at: null, country: null }, badges: {},
    picks: {
      a: pick('a', { settled_at: '2026-10-01T17:00:00Z', kickoff: '2026-10-01T15:00:00Z', ai_probs: { home: 0.6, draw: 0.25, away: 0.15 } }),
      b: pick('b', { settled_at: '2026-10-08T17:00:00Z', kickoff: '2026-10-08T15:00:00Z', pick: 'away', ai_pick: 'home', final_score: [0, 2], homeName: 'Fulham', homeCode: 'FUL', awayName: 'Arsenal', awayCode: 'ARS', ai_probs: { home: 0.5, draw: 0.28, away: 0.22 } }),
      c: pick('c', { settled_at: '2026-10-15T17:00:00Z', kickoff: '2026-10-15T15:00:00Z', status: 'lost', points: 0, final_score: [0, 0], ai_pick: 'home' }),
      d: pick('d', { settled_at: '2026-10-22T17:00:00Z', kickoff: '2026-10-22T15:00:00Z' }),
      old: pick('old', { kickoff: '2025-03-01T15:00:00Z', settled_at: '2025-03-01T17:00:00Z' }), // last season
    },
  };
  const r = seasonRecap(st, '2026-27');
  assert.equal(r.picks, 4);
  assert.equal(r.correct, 3);
  assert.equal(r.longest_streak, 2);
  assert.equal(r.best_pick?.pick.matchId, 'b'); // the AI gave it 22%
  assert.equal(r.best_pick?.ai_chance, 0.22);
  assert.equal(r.best_team?.name, 'Arsenal');
  assert.equal(r.best_team?.correct, 3);
  assert.deepEqual(r.vs_ai, { matches: 4, you: 3, ai: 2 });
});

test('week report: this week if anything settled, otherwise last week', () => {
  const now = new Date('2026-11-26T12:00:00Z'); // a Thursday
  const st = {
    profile: { display_name: 'You', created_at: '', consented_at: null, country: null }, badges: {},
    picks: { a: pick('a', { kickoff: '2026-11-22T15:00:00Z', banker: true, points: 6 }) }, // the Sunday before
  };
  const r = weekReport(st, now);
  assert.equal(r.current, false);
  assert.equal(r.points, 6);
  assert.deepEqual(r.banker, { match: 'Arsenal v Chelsea', won: true, points: 6 });
  st.picks = { ...st.picks, b: pick('b', { kickoff: '2026-11-25T19:00:00Z', status: 'lost', points: 0, final_score: [0, 1] }) } as typeof st.picks;
  const r2 = weekReport(st, now);
  assert.equal(r2.current, true);
  assert.equal(r2.picks, 1);
  assert.deepEqual(r2.vs_ai, { matches: 1, you: 0, ai: 0 });
});
