import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { SEvent } from '@/data/espn';

import { diffMatches, reminders } from './alerts';

const team = (id: string, short: string) => ({ id: `football:${id}`, espnId: id, name: short, short, abbr: short.slice(0, 3).toUpperCase(), color: '#C8102E', logo: null });
const ev = (over: Partial<SEvent>): SEvent => ({
  id: 'uefa.champions~1',
  espnId: '1',
  league: 'uefa.champions',
  sport: 'football',
  start: '2026-11-04T19:45:00Z',
  status: 'scheduled',
  clock: null,
  home: team('436', 'Fenerbahce'),
  away: team('364', 'Liverpool'),
  homeScore: null,
  awayScore: null,
  venue: null,
  neutral: false,
  round: null,
  details: [],
  quarters: null,
  market: null,
  preseason: false,
  ...over,
});
const all = () => true;

test('first sighting is remembered silently, then kick-off, goals and full time alert once each', () => {
  const t0 = Date.parse('2026-11-04T19:00:00Z');
  let r = diffMatches({}, [ev({})], all, t0);
  assert.equal(r.alerts.length, 0);
  r = diffMatches(r.next, [ev({ status: 'live', clock: "1'", homeScore: 0, awayScore: 0 })], all, t0 + 60_000);
  assert.deepEqual(r.alerts.map((a) => a.kind), ['kickoff']);
  r = diffMatches(r.next, [ev({ status: 'live', homeScore: 0, awayScore: 1, details: [{ type: 'goal', minute: 23, clock: "23'", side: 'away', player: 'Mohamed Salah' }] })], all, t0 + 120_000);
  assert.equal(r.alerts.length, 1);
  assert.equal(r.alerts[0].title, '⚽ Goal! Fenerbahce 0-1 Liverpool');
  assert.ok(r.alerts[0].body.startsWith("Mohamed Salah 23'"));
  // nothing new: no alert
  r = diffMatches(r.next, [ev({ status: 'live', homeScore: 0, awayScore: 1 })], all, t0 + 180_000);
  assert.equal(r.alerts.length, 0);
  // a goal and the final whistle between two background checks
  r = diffMatches(r.next, [ev({ status: 'finished', homeScore: 1, awayScore: 1, details: [{ type: 'penalty_goal', minute: 88, clock: "88'", side: 'home', player: 'Dzeko' }] })], all, t0 + 3 * 3600_000);
  assert.deepEqual(r.alerts.map((a) => a.kind), ['goal', 'fulltime']);
  assert.ok(r.alerts[0].body.includes('(pen)'));
  assert.equal(r.alerts[1].body, 'Draw · Champions League');
  // unwatched matches never alert
  assert.equal(diffMatches(r.next, [ev({ status: 'finished', homeScore: 2, awayScore: 1 })], () => false).alerts.length, 0);
});

test('kick-off reminders: 30 minutes before, only for upcoming watched matches', () => {
  const now = Date.parse('2026-11-04T12:00:00Z');
  const list = reminders([ev({}), ev({ id: 'x~2', status: 'live' }), ev({ id: 'x~3', start: '2026-11-04T12:10:00Z' })], all, (id) => (id === 'uefa.champions~1' ? 'Liverpool 1-2' : null), 30, now);
  assert.equal(list.length, 1);
  assert.equal(list[0].at, Date.parse('2026-11-04T19:15:00Z'));
  assert.equal(list[0].title, 'Fenerbahce v Liverpool in 30 minutes');
  assert.ok(list[0].body.includes('Your pick: Liverpool 1-2'));
});
