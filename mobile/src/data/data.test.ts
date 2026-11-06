/**
 * Data layer end-to-end against a fake ESPN/ClubElo server (payloads shaped like the public
 * feeds). Exercises: history load, feed, match detail + multi-source blend, picks, locking,
 * settlement and accuracy.
 */
import assert from 'node:assert/strict';
import { before, test } from 'node:test';

import { matchFixture, nameSimilarity, parseFixturesCsv } from './clubelo';
import { parseEvent, parseMarket } from './espn';
import { ensureSport } from './history';
import { setFetch } from './http';
import { memoryKV, setKV } from './kv';
import { LEAGUE_BY_SLUG } from './leagues';
import { handleLocal } from './localApi';

import { buildWorld, db, EPL, eventJson, fakeFetch, NOW, requests } from './testing/fakeSources';

before(async () => {
  buildWorld();
  setKV(memoryKV());
  setFetch(fakeFetch);
  await ensureSport('football');
  await ensureSport('basketball');
});

test('parsers: event, status, market', () => {
  const lg = LEAGUE_BY_SLUG['eng.1'];
  const e = parseEvent(eventJson('eng.1', db['eng.1'][0]), lg)!;
  assert.equal(e.status, 'finished');
  assert.equal(e.home.id, 'football:' + (100 + db['eng.1'][0].h));
  assert.equal(e.home.color, '#cc0000');
  const p = parseMarket([{ moneyline: { home: { close: { odds: '-150' } }, away: { close: { odds: '+400' } }, draw: { close: { odds: '+275' } } } }], true)!;
  assert.ok(Math.abs(p.home! + p.draw! + p.away! - 1) < 1e-9 && p.home! > p.draw!);
  assert.equal(parseMarket([{ homeTeamOdds: { moneyLine: -150 } }], true), null);
  const live = parseEvent(eventJson('eng.1', db['eng.1'].find((x) => x.id === '9001')!), lg)!;
  assert.deepEqual([live.status, live.clock, live.homeScore], ['live', "34'", 1]);
});

test('ClubElo: CSV parsing and cross-source team matching', () => {
  const rows = parseFixturesCsv('Date,Country,Home,Away,GD<-5,GD=-1,GD=0,GD=1,GD>5\n2026-11-08,ENG,Man City,Spurs,0.05,0.15,0.25,0.30,0.25\n');
  assert.equal(rows.length, 1);
  assert.ok(Math.abs(rows[0].probs.home! - 0.55) < 1e-9 && Math.abs(rows[0].probs.draw! - 0.25) < 1e-9);
  assert.ok(nameSimilarity('Manchester City', 'Man City') >= 0.9);
  assert.ok(nameSimilarity('Tottenham Hotspur', 'Spurs') >= 0.9);
  assert.ok(nameSimilarity('Arsenal', 'Chelsea') < 0.3);
  const ev = parseEvent(eventJson('eng.1', { ...db['eng.1'][0], t: Date.UTC(2026, 10, 8, 15), h: 3, a: 5 }), LEAGUE_BY_SLUG['eng.1'])!;
  assert.equal(matchFixture(ev, rows)?.home, 'Man City');
});

test('feed: live, today and predictions from real-format data', async () => {
  const feed: any = await handleLocal('GET', '/feed?tz=UTC', null);
  const keys = feed.sections.map((s: any) => s.key);
  assert.ok(keys.includes('live'), keys.join());
  const live = feed.sections.find((s: any) => s.key === 'live').items[0];
  assert.equal(live.locked, true);
  const all = feed.sections.flatMap((s: any) => s.items);
  const upcoming = all.find((c: any) => c.id === 'eng.1~9002');
  assert.ok(upcoming?.prediction, 'upcoming match has a prediction');
  assert.ok(Math.abs(upcoming.prediction.home + upcoming.prediction.draw + upcoming.prediction.away - 1) < 1e-6);
  assert.equal(feed.predictions_loading, false);
});

test('match detail: multi-source blend, explanation, team news availability', async () => {
  const d: any = await handleLocal('GET', '/matches/eng.1~9002', null);
  const p = d.prediction_full;
  const sources = p.sources.map((s: any) => s.source).sort();
  assert.deepEqual(sources, ['market', 'model']); // ClubElo is switched off in this release (see clubelo.ts)
  assert.ok(Math.abs(p.sources.reduce((s: number, x: any) => s + x.weight, 0) - 1) < 1e-9);
  assert.ok(p.key_factors.length >= 3 && p.key_factors.length <= 5);
  assert.ok(p.explanation.steps.some((s: any) => s.title === 'Combining sources'));
  assert.equal(d.injuries_available, false); // soccer summary had no team news -> "not available", not "none"
  assert.equal(d.standings.length, EPL.length);
  const nba: any = await handleLocal('GET', '/matches/nba~9101', null);
  assert.equal(nba.injuries_available, true);
  assert.equal(nba.injuries.home[0].importance, 1); // season leader -> treated as a star
  assert.ok(nba.prediction_full.sources.some((s: any) => s.source === 'espn'));
  assert.equal(nba.prediction_full.probabilities.draw, undefined);
});

test('pick game: consent, lock, settle', async () => {
  await assert.rejects(handleLocal('PUT', '/picks/eng.1~9002', { pick: 'home' }), (e: any) => e.code === 'consent_required');
  await handleLocal('POST', '/me/consent', {});
  const r: any = await handleLocal('PUT', '/picks/eng.1~9002', { home_score: 2, away_score: 0 });
  assert.equal(r.pick, 'home');
  assert.ok(r.new_badges.includes('first-pick'));
  await assert.rejects(handleLocal('PUT', '/picks/eng.1~9001', { pick: 'home' }), (e: any) => e.code === 'locked');
  await assert.rejects(handleLocal('PUT', '/picks/nba~9101', { pick: 'draw' }), (e: any) => e.code === 'no_draws');
  // the match is played: 2-0 -> exact score = 5 points
  const ev = db['eng.1'].find((x) => x.id === '9002')!;
  Object.assign(ev, { t: NOW - 2 * 3600_000, hs: 2, as: 0, state: 'post', name: 'STATUS_FULL_TIME' });
  setFetch(fakeFetch); // clears the HTTP cache
  await handleLocal('GET', '/matches/eng.1~9002', null);
  const me: any = await handleLocal('GET', '/me', null);
  assert.equal(me.stats.total_points, 5);
  assert.equal(me.stats.exact_scores, 1);
  assert.ok(me.badges.find((b: any) => b.slug === 'sharpshooter').awarded_at);
  const hist: any = await handleLocal('GET', '/me/picks?status=settled', null);
  assert.equal(hist.items[0].pick.points, 5);
});

test('accuracy: walk-forward backtest per source', async () => {
  const acc: any = await handleLocal('GET', '/accuracy?source=backtest', null);
  assert.ok(acc.overall.n > 50);
  const market = acc.by_source.find((s: any) => s.source === 'market');
  assert.ok(market && market.n > 0);
  assert.ok(acc.sports.some((s: any) => s.sport === 'basketball'));
});

test('results come from stored history (no extra season download)', async () => {
  requests.length = 0;
  const page: any = await handleLocal('GET', '/matches?league_id=eng.1&status=finished&order=desc&limit=10', null);
  assert.equal(page.items.length, 10);
  assert.ok(page.next_cursor);
  assert.ok(requests.every((r) => !/dates=\d{8}-/.test(r)), 'no day-range queries');
});

test('forecasts saved before kick-off are scored afterwards (source evidence)', async () => {
  const { liveEvaluations } = await import('./predict');
  await handleLocal('GET', '/matches/eng.1~9003', null); // predicted while scheduled
  const ev = db['eng.1'].find((x) => x.id === '9003')!;
  Object.assign(ev, { t: NOW - 3 * 3600_000, hs: 0, as: 2, state: 'post', name: 'STATUS_FULL_TIME' });
  setFetch(fakeFetch);
  await handleLocal('GET', '/feed?tz=UTC', null);
  const rec = liveEvaluations().find((r) => r.id === 'eng.1~9003');
  assert.ok(rec, 'snapshot was scored');
  assert.equal(rec!.outcome, 'away');
  assert.ok(rec!.sources.model);
});

test('the client never sends day ranges (the real source rejects them)', () => {
  assert.ok(requests.length > 0);
  const bad = requests.find((r) => /dates=\d{8}-/.test(r));
  assert.equal(bad, undefined);
});
