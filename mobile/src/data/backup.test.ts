import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BackupError, makeBackup, parseBackup, restoreBackup, summary } from './backup';
import { gameState, loadGame, makePick, resetGame, updateProfile } from './game';
import { memoryKV, setKV } from './kv';
import * as pleagues from './pleagues';
import type { SEvent } from './espn';

const ev = (id: string, start: string): SEvent => {
  const team = (n: string) => ({ id: `football:${n}`, espnId: n, name: n, short: n, abbr: n.slice(0, 3).toUpperCase(), color: '#000', logo: null });
  return { id, espnId: id, league: 'eng.1', sport: 'football', start, status: 'scheduled', clock: null, home: team('Home'), away: team('Away'), homeScore: null, awayScore: null, venue: null, neutral: false, round: null, details: [], quarters: null, market: null, preseason: false } as SEvent;
};

test('a backup restores picks, profile, leagues and settings on a new phone', async () => {
  setKV(memoryKV());
  await resetGame();
  pleagues.resetForTests();
  await loadGame();
  await updateProfile({ consented_at: new Date().toISOString(), display_name: 'Tester', avatar: '🦁' });
  await makePick(ev('eng.1~1', '2030-06-05T12:00:00Z'), { pick: 'home', banker: true }, 'home');
  const me = { id: 'm1', name: 'Tester', avatar: '🦁', points: 0, week: 0, wk: '2030-W23', correct: 0, settled: 0, streak: 0, at: 1 };
  await pleagues.create('Office league', me);
  const prefs = { theme: 'light', favoriteTeam: { id: 'football:359', name: 'Arsenal' } };
  const text = JSON.stringify(await makeBackup(prefs));

  // a new phone: nothing saved
  setKV(memoryKV());
  await resetGame();
  pleagues.resetForTests();
  assert.equal(Object.keys((await loadGame()).picks).length, 0);
  const b = parseBackup(text);
  assert.deepEqual([summary(b).picks, summary(b).leagues, summary(b).settings], [1, 1, true]);
  const restoredPrefs = await restoreBackup(b);
  assert.deepEqual(restoredPrefs, prefs);
  assert.equal(gameState()!.profile.display_name, 'Tester');
  assert.equal(gameState()!.picks['eng.1~1'].banker, true);
  assert.deepEqual((await pleagues.leagues()).map((l) => l.name), ['Office league']);
  // it was saved, not just held in memory
  pleagues.resetForTests();
  assert.equal((await pleagues.leagues()).length, 1);
});

test('the 2.1 export format is accepted; other files are refused with a clear message', () => {
  const old = parseBackup(JSON.stringify({ profile: { display_name: 'Old', created_at: '', consented_at: null, country: null }, picks: [{ matchId: 'eng.1~9', status: 'won' }], badges: { 'first-pick': '2026-01-01' } }));
  assert.equal(summary(old).picks, 1);
  assert.equal(summary(old).leagues, 0);
  assert.throws(() => parseBackup('not json'), BackupError);
  assert.throws(() => parseBackup(JSON.stringify({ hello: 1 })), BackupError);
});
