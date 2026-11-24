import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { clearMemoryCache, setFetch } from './http';
import { findPhoto, personSim, PHOTO_BASE, pickPlayer, resetPhotos, type PhotoRow } from './photos';

// same cases as pipeline/tests/test_photos.py, so both sides match names the same way
test('person names: the surname must agree for a partial match', () => {
  assert.equal(personSim('Bukayo Saka', 'Bukayo Saka'), 1);
  assert.equal(personSim('Kylian Mbappé', 'Kylian Mbappe'), 1);
  assert.equal(personSim('Son Heung-Min', 'Son Heung-min'), 1);
  assert.equal(personSim('Rodri', 'Rodri'), 1);
  assert.equal(personSim('Adam Smith', 'Adam Duda'), 0);
  assert.equal(personSim('Keane Lewis-Potter', 'Luca Lewis'), 0);
  const s = personSim('Bruno Miguel Borges Fernandes', 'Bruno Fernandes');
  assert.ok(s >= 0.5 && s <= 1);
});

const row = (q: string, name: string, espn = '', ver = 'v1'): PhotoRow => [q, name, espn, ver, 'Jane Photo', 'CC BY-SA 4.0', 2025];

test('pickPlayer refuses ties and weak matches', () => {
  const rows = [row('Q1', 'Gabriel Jesus'), row('Q2', 'Gabriel Martinelli'), row('Q3', 'Gabriel Magalhães')];
  assert.equal(pickPlayer('Gabriel Martinelli', rows)?.[0], 'Q2');
  assert.equal(pickPlayer('Gabriel', rows), null);
  assert.equal(pickPlayer('Adam Smith', [row('Q9', 'Adam Duda')]), null);
});

type Routes = Record<string, unknown>;
let calls: string[] = [];
function serve(routes: Routes) {
  calls = [];
  setFetch((async (url: string) => {
    calls.push(url);
    for (const [k, v] of Object.entries(routes)) if (url.includes(k)) return v === 503 ? new Response('down', { status: 503 }) : new Response(JSON.stringify(v), { status: 200 });
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch);
}

const META = { v: 1, updated: '2026-11-24T00:00:00+00:00', players: 3, months: ['2001-09', '1999-01'] };
const SHARD_2001 = { v: 1, p: { '2001-09-05': [row('Q1', 'Bukayo Saka', '296466', 'abc'), row('Q8', 'Someone Else')] } };
const SHARD_1999 = { v: 1, p: { '1999-01-14': [row('Q2', 'Declan Rice', '', 'def')] } };
const ESPN = { v: 1, p: { '296466': ['Q1', 'abc', 'Jane Photo', 'CC BY-SA 4.0', 2025] } };
const ROSTER = { athletes: [{ id: '999', displayName: 'Declan Rice', dateOfBirth: '1999-01-14T08:00Z' }] };

beforeEach(() => {
  clearMemoryCache();
  resetPhotos();
});

test('matches by birth date and name, by ESPN ID, and through the team squad', async () => {
  serve({ 'photos/meta.json': META, 'photos/d/2001-09.json': SHARD_2001, 'photos/d/1999-01.json': SHARD_1999, 'photos/espn.json': ESPN, '/teams/359/roster': ROSTER });
  const saka = await findPhoto({ id: '296466', name: 'Bukayo Saka', dob: '2001-09-05', league: 'eng.1' });
  assert.equal(saka?.uri, `${PHOTO_BASE}/i/Q1.jpg?v=abc`);
  assert.equal(saka?.artist, 'Jane Photo');
  // no birth date given: it comes from the team's squad (team as the app's "sport:espnId")
  const rice = await findPhoto({ id: '999', name: 'Declan Rice', team: 'football:359', league: 'eng.1' });
  assert.equal(rice?.qid, 'Q2');
  // no birth date and no squad: the ESPN ID index
  const byId = await findPhoto({ id: '296466', name: 'B. Saka', league: 'eng.1' });
  assert.equal(byId?.qid, 'Q1');
  // a different player born the same day is not mistaken for him
  assert.equal(await findPhoto({ name: 'Unknown Player', dob: '2001-09-05', league: 'eng.1' }), null);
});

test('other sports are never looked up', async () => {
  serve({ 'photos/meta.json': META });
  assert.equal(await findPhoto({ id: '1', name: 'LeBron James', league: 'nba' }), null);
  assert.equal(calls.length, 0);
});

test('when the photo files are down the app falls back quietly and does not keep asking', async () => {
  serve({ 'photos/meta.json': 503 });
  assert.equal(await findPhoto({ name: 'Bukayo Saka', dob: '2001-09-05', league: 'eng.1' }), null);
  const n = calls.length;
  assert.equal(await findPhoto({ name: 'Declan Rice', dob: '1999-01-14', league: 'eng.1' }), null);
  assert.equal(calls.length, n);
});
