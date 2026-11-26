import assert from 'node:assert/strict';
import { test } from 'node:test';

import { headlineZone, matchTeam, proofFor, simLeague, simPct, type SimDoc, type SimLeague, type SimTeam, weeklyChange } from './published';
import { tableFrom } from './xgtable';

const team = (name: string, zones: SimTeam['zones'], week_ago?: SimTeam['zones']): SimTeam => ({
  id: `fb-${name}`, name, aliases: [name, `${name} FC`], played: 13, points: 20, gd: 0, gf: 10, exp_points: 50, points_range: [45, 55], positions: [0.5, 0.5], zones, week_ago,
});

test('simulation percentages never claim certainty they do not have', () => {
  assert.equal(simPct(0.343), '34%');
  assert.equal(simPct(0.003), '<1%');
  assert.equal(simPct(0.997), '>99%');
  assert.equal(simPct(1), '>99%');
  assert.equal(simPct(0), '<1%');
});

test('weekly change hides simulation noise under 2 points', () => {
  const t = team('Arsenal', { title: 0.34, relegation: 0 }, { title: 0.29, relegation: 0.004 });
  assert.equal(weeklyChange(t, 'title'), 5);
  assert.equal(weeklyChange(t, 'relegation'), null);
  assert.equal(weeklyChange(team('X', { title: 0.3 }), 'title'), null);
});

test('the headline zone is the one most in play', () => {
  const lg = { zones: [{ key: 'title', from: 1, to: 1, label: 'Title' }, { key: 'top4', from: 1, to: 4, label: 'Top four' }, { key: 'relegation', from: 18, to: 20, label: 'Relegation' }] } as SimLeague;
  assert.equal(headlineZone(lg, team('A', { title: 0.79, top4: 0.999, relegation: 0 }))?.key, 'title');
  assert.equal(headlineZone(lg, team('B', { title: 0.01, top4: 0.45, relegation: 0 }))?.key, 'top4');
  assert.equal(headlineZone(lg, team('C', { title: 0, top4: 0, relegation: 0.3 }))?.key, 'relegation');
});

test('teams match by any published spelling; stale simulations are not shown', () => {
  const teams = [team('Manchester United', {}), team('Manchester City', {})];
  assert.equal(matchTeam(teams, ['Manchester City'])?.name, 'Manchester City');
  assert.equal(matchTeam(teams, ['Real Madrid']), null);
  const doc = { schema: 1, generated_at: '2026-11-26T12:00:00Z', competitions: [{ competition: 'eng.1' }] } as unknown as SimDoc;
  assert.ok(simLeague(doc, 'eng.1', Date.parse('2026-11-27T12:00:00Z')));
  assert.equal(simLeague(doc, 'eng.1', Date.parse('2026-12-02T12:00:00Z')), null);
  assert.equal(simLeague(doc, 'esp.1', Date.parse('2026-11-27T12:00:00Z')), null);
});

test('proof lookup is by match and the moment the version was made', () => {
  const doc = { schema: 1 as const, repository: 'o/r', updated_at: '', entries: { 'm1@2026-11-26T08:00:00+00:00': { commit: 'abc', at: '2026-11-26T08:05:00+00:00', kickoff: '2026-11-30T15:00:00+00:00' } } };
  assert.equal(proofFor(doc, 'm1', '2026-11-26T08:00:00+00:00')?.commit, 'abc');
  assert.equal(proofFor(doc, 'm1', '2026-11-26T14:00:00+00:00'), null);
  assert.equal(proofFor(null, 'm1', undefined), null);
});

test('xG table: expected points per match, unusable matches left out for both sides', () => {
  const teams = { a: { id: 'a', name: 'A', short_name: 'A', color: '#f00', logo: null }, b: { id: 'b', name: 'B', short_name: 'B', color: '#00f', logo: null } };
  const t = tableFrom(
    [
      { home: 'a', away: 'b', hg: 0, ag: 1, shots: { v: 1, usable: true, h: [0.5, 0.4, 0.3, 0.2], a: [0.05] } },
      { home: 'b', away: 'a', hg: 2, ag: 2, shots: { v: 1, usable: false, h: [], a: [] } },
    ],
    teams,
  );
  assert.equal(t.used, 1);
  assert.equal(t.skipped, 1);
  const a = t.rows.find((r) => r.team.id === 'a')!;
  const b = t.rows.find((r) => r.team.id === 'b')!;
  assert.equal(t.rows[0].team.id, 'a'); // ranked by expected points
  assert.equal(a.points, 0);
  assert.equal(b.points, 3);
  assert.ok(a.xpts > 2 && b.xpts < 0.5);
  assert.ok(Math.abs(a.xgFor - 1.4) < 1e-9 && Math.abs(a.xgAgainst - 0.05) < 1e-9);
});
