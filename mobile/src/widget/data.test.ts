import assert from 'node:assert/strict';
import { test } from 'node:test';

import { stateFrom } from './data';

const ev = (id: string, date: string, state: string, h: [string, string | null], a: [string, string | null], detail = '') => ({
  id, date,
  competitions: [{ status: { type: { state, shortDetail: detail } }, competitors: [
    { homeAway: 'home', team: { abbreviation: h[0], shortDisplayName: h[0], color: 'c8102e' }, score: h[1] === null ? undefined : { displayValue: h[1] } },
    { homeAway: 'away', team: { abbreviation: a[0], shortDisplayName: a[0] }, score: a[1] === null ? undefined : { displayValue: a[1] } },
  ] }],
});

test('widget: a live match comes first, then the next match with the last result', () => {
  const results = { events: [ev('1', '2026-11-21T17:30Z', 'post', ['NEW', '2'], ['ARS', '2'])] };
  const fixtures = { events: [ev('2', '2026-11-29T16:30Z', 'pre', ['ARS', null], ['MNC', null])] };
  const next = stateFrom(results, fixtures, 'eng.1', '#e20520', new Date('2026-11-25T10:00Z'));
  assert.equal(next.kind, 'next');
  if (next.kind === 'next') {
    assert.equal(next.matchId, 'eng.1~2');
    assert.equal(next.home.code, 'ARS');
    assert.equal(next.last, 'Last: NEW 2–2 ARS');
  }
  const liveF = { events: [ev('3', '2026-11-29T16:30Z', 'in', ['ARS', '1'], ['MNC', '0'], "63'"), ...fixtures.events] };
  const live = stateFrom(results, liveF, 'eng.1', '#e20520');
  assert.equal(live.kind, 'live');
  if (live.kind === 'live') assert.deepEqual([live.when, live.home.score, live.away.score], ["63'", '1', '0']);
  assert.equal(stateFrom({ events: [] }, { events: [] }, 'eng.1', '#fff').kind, 'none');
});
