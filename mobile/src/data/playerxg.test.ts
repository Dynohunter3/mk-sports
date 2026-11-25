import assert from 'node:assert/strict';
import { test } from 'node:test';

import { aggregate, matchPlayerXg, seasonStart, type MatchPlayerXg } from './playerxg';
import { xgFor } from '@/engine/xg';

const player = (id: string, name: string, starter: boolean, sub?: { in?: string; out?: string }) => ({
  athlete: { id, displayName: name },
  starter,
  subbedIn: !!sub?.in,
  subbedOut: !!sub?.out,
  plays: sub ? [{ substitution: true, clock: { displayValue: sub.in ?? sub.out } }] : [],
  position: { abbreviation: starter ? 'F' : 'SUB' },
  formationPlace: starter ? '9' : '0',
});

// a minimal match summary in the feed's shape: commentary names shooters without ids
const SUMMARY = {
  header: { competitions: [{ competitors: [{ homeAway: 'home', id: '1', team: { id: '1', displayName: 'Home FC' } }, { homeAway: 'away', id: '2', team: { id: '2', displayName: 'Away FC' } }] }] },
  rosters: [
    { homeAway: 'home', team: { id: '1' }, formation: '4-4-2', roster: [player('11', 'Ana Striker', true, { out: "70'" }), player('12', 'Ben Sub', false, { in: "70'" }), player('13', 'Unused Sub', false)] },
    { homeAway: 'away', team: { id: '2' }, formation: '4-4-2', roster: [player('21', 'Cal Forward', true)] },
  ],
  commentary: [
    { play: { id: 'a', type: { type: 'shot-on-target' }, team: { id: '1', displayName: 'Home FC' }, fieldPositionX: 0.9, fieldPositionY: 0.5, participants: [{ athlete: { displayName: 'Ana Striker' } }] } },
    { play: { id: 'b', type: { type: 'goal---free-kick' }, team: { id: '1', displayName: 'Home FC' }, fieldPositionX: 0.8, fieldPositionY: 0.4, participants: [{ athlete: { displayName: 'Ana Striker' } }] } },
    { play: { id: 'c', type: { type: 'penalty---scored' }, team: { id: '1', displayName: 'Home FC' }, participants: [{ athlete: { displayName: 'Ben Sub' } }] } },
    { play: { id: 'd', type: { type: 'shot-off-target' }, team: { id: '2', displayName: 'Away FC' }, fieldPositionX: 0.85, fieldPositionY: 0.3, participants: [{ athlete: { displayName: 'Cal Forward' } }] } },
  ],
};

test('per-player match xG: names matched to the line-up, penalties apart, minutes from substitutions', () => {
  const m = matchPlayerXg(SUMMARY);
  assert.equal(m.usable, true);
  const ana = m.p['11'];
  assert.ok(Math.abs(ana[0] - (xgFor(0.9, 0.5) + xgFor(0.8, 0.4))) < 1e-9);
  assert.equal(ana[2], 2); // shots
  assert.equal(ana[3], 1); // the free-kick goal counts
  assert.equal(ana[5], 70); // minutes
  const ben = m.p['12'];
  assert.equal(ben[0], xgFor(0, 0, true));
  assert.equal(ben[1], 0); // no non-penalty xG
  assert.equal(ben[5], 20);
  assert.equal(m.p['13'], undefined); // an unused substitute played no minutes
  assert.equal(m.p['21'][5], 90);
});

test('season aggregate: per 90, and matches without shot positions are left out', () => {
  const games: MatchPlayerXg[] = [
    { v: 1, usable: true, p: { '7': [0.6, 0.6, 3, 1, 1, 90] } },
    { v: 1, usable: true, p: { '7': [0.9, 0.14, 2, 1, 0, 45] } },
    { v: 1, usable: false, p: { '7': [0, 0, 0, 0, 0, 90] } },
    { v: 1, usable: true, p: { '8': [0.3, 0.3, 1, 0, 0, 90] } },
  ];
  const s = aggregate(games, '7');
  assert.equal(s.matches, 2);
  assert.equal(s.skipped, 1);
  assert.equal(s.minutes, 135);
  assert.ok(Math.abs(s.xg - 1.5) < 1e-9 && Math.abs(s.xgPer90! - 1.0) < 1e-9);
  assert.equal(aggregate([{ v: 1, usable: true, p: { '7': [0.2, 0.2, 1, 0, 0, 30] } }], '7').xgPer90, null); // under 90 minutes
});

test('season start: split seasons from 1 July, MLS from 1 January', () => {
  assert.equal(new Date(seasonStart('eng.1', Date.UTC(2026, 10, 25))).toISOString().slice(0, 10), '2026-07-01');
  assert.equal(new Date(seasonStart('eng.1', Date.UTC(2027, 2, 1))).toISOString().slice(0, 10), '2026-07-01');
  assert.equal(new Date(seasonStart('usa.1', Date.UTC(2026, 10, 25))).toISOString().slice(0, 10), '2026-01-01');
});
