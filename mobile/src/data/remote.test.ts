/** Published pipeline predictions: matching ESPN fixtures, use in predictEvent, fallbacks, mirror URL. */
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import type { SEvent } from './espn';
import { setFetch } from './http';
import { memoryKV, setKV } from './kv';
import { bestSim, nameSim } from './names';
import { predictEvent } from './predict';
import { ensureRemoteLoaded, REMOTE_URLS, refreshRemote, remoteCovers, remoteFor, RemoteFile, remoteSource, setBundledForTests, setRemoteForTests } from './remote';
import { saferCall, tierOf } from '../engine/calls';

const KICK = '2026-11-08T14:00:00+00:00';

function file(over: Partial<RemoteFile> = {}): RemoteFile {
  return {
    schema: 1,
    generated_at: new Date().toISOString(),
    model_version: 'fb-2026-11-test',
    data_version: 'abc',
    attribution: 'Data: football-data.co.uk, openfootball (public domain).',
    notice: 'info only',
    horizon_days: 21,
    competitions: ['eng.1'],
    matches: [
      {
        match_id: 'eng.1/2026-27/fb-eng-manchester-united~fb-eng-arsenal',
        competition: 'eng.1',
        kickoff: KICK,
        home: { id: 'fb-eng-manchester-united', name: 'Man United', aliases: ['Man United', 'Manchester United FC'] },
        away: { id: 'fb-eng-arsenal', name: 'Arsenal', aliases: ['Arsenal', 'Arsenal FC'] },
        p: { home: 0.31, draw: 0.27, away: 0.42 },
        expected_goals: [1.2, 1.5],
        elo: [1610, 1705],
        components: { elo: [0.3, 0.28, 0.42], dc: [0.32, 0.26, 0.42], dcx: [null, null, null], gbm_nomkt: [0.3, 0.27, 0.43], market: [null, null, null] },
        variant: 'no odds yet',
        confidence: 0.8,
        confidence_label: 'medium',
        confidence_reasons: ['no bookmaker odds yet'],
        made_at: '2026-11-06T11:00:00+00:00',
        last_change: 'first prediction',
        versions: 1,
      },
    ],
    recent: [],
    ...over,
  };
}

function ev(home: string, away: string, start = KICK, league = 'eng.1'): SEvent {
  const team = (n: string) => ({ id: n, espnId: n, name: n, short: n.split(' ')[0], abbr: n.slice(0, 3).toUpperCase(), color: '#000', logo: null });
  return { id: `${league}~1`, espnId: '1', league, sport: 'football', start, status: 'scheduled', clock: null, home: team(home), away: team(away), homeScore: null, awayScore: null, venue: null, neutral: false, round: null, details: [], quarters: null, market: null, preseason: false };
}

beforeEach(() => {
  setKV(memoryKV());
  setBundledForTests(null);
  setRemoteForTests(file());
});

test('names: source spellings match ESPN names', () => {
  assert.equal(nameSim('Man United', 'Manchester United'), 1);
  assert.ok(bestSim(['Manchester United', 'Man Utd'], ['Man United', 'Manchester United FC']) >= 0.99);
  assert.ok(nameSim('Manchester City', 'Manchester United') < 0.75);
});

test('an ESPN fixture finds its published prediction (and only its own)', () => {
  assert.equal(remoteFor(ev('Manchester United', 'Arsenal'))?.p.away, 0.42);
  assert.equal(remoteFor(ev('Manchester United', 'Arsenal', '2026-11-09T12:00:00Z'))?.p.away, 0.42); // within 36 h
  assert.equal(remoteFor(ev('Manchester United', 'Arsenal', '2026-11-12T14:00:00Z')), null); // a different fixture date
  assert.equal(remoteFor(ev('Manchester City', 'Arsenal')), null);
  assert.equal(remoteFor(ev('Arsenal', 'Manchester United')), null); // home/away matter
  assert.equal(remoteFor(ev('Manchester United', 'Arsenal', KICK, 'esp.1')), null); // competition not covered
});

test('predictEvent uses the published prediction for covered football (no on-device model)', () => {
  const p = predictEvent(ev('Manchester United', 'Arsenal'))!;
  assert.equal(p.model, 'mksports-pipeline');
  assert.equal(p.model_version, 'fb-2026-11-test');
  assert.deepEqual(p.probabilities, { home: 0.31, draw: 0.27, away: 0.42 });
  assert.equal(p.confidence, 'medium');
  assert.ok(p.explanation.steps.some((s) => s.title === 'Confidence' && s.detail.includes('no bookmaker odds yet')));
  assert.ok(p.key_factors.some((f) => f.text.includes('Bookmaker odds not published yet')));
});

test('a stale file is ignored so the app falls back instead of showing old forecasts', () => {
  setRemoteForTests(file({ generated_at: new Date(Date.now() - 4 * 86400_000).toISOString() }));
  assert.equal(remoteCovers('eng.1'), false);
  assert.equal(remoteFor(ev('Manchester United', 'Arsenal')), null);
});

test('refresh: Pages down -> mirror; invalid files are rejected; last good copy survives an outage', async () => {
  setRemoteForTests(null);
  const good = file({ model_version: 'fb-from-mirror' });
  const calls: string[] = [];
  setFetch((async (url: string) => {
    calls.push(url);
    if (url.startsWith(REMOTE_URLS[0])) return new Response('nope', { status: 503 });
    return new Response(JSON.stringify(good), { status: 200 });
  }) as unknown as typeof fetch);
  assert.equal(await refreshRemote(true), true);
  assert.ok(calls.some((u) => u.startsWith(REMOTE_URLS[0])) && calls.some((u) => u.startsWith(REMOTE_URLS[1])));
  assert.equal(predictEvent(ev('Manchester United', 'Arsenal'))!.model_version, 'fb-from-mirror');
  // both hosts down: the saved copy is kept
  setFetch((async () => new Response('down', { status: 500 })) as unknown as typeof fetch);
  assert.equal(await refreshRemote(true), true);
  assert.equal(remoteFor(ev('Manchester United', 'Arsenal'))?.p.home, 0.31);
  // a malformed file never replaces a good one
  setFetch((async () => new Response(JSON.stringify({ schema: 99 }), { status: 200 })) as unknown as typeof fetch);
  await refreshRemote(true);
  assert.equal(predictEvent(ev('Manchester United', 'Arsenal'))!.model_version, 'fb-from-mirror');
});

test('a draw call from the service is shown as a draw with a drawn score', async () => {
  const { mini } = await import('./predict');
  const f = file();
  f.matches[0].p = { home: 0.36, draw: 0.31, away: 0.33 };
  f.matches[0].call = { pick: 'draw', pick_probability: 0.31, tier: 'toss-up', draw_call: true, double_chance: { call: 'home or draw', probability: 0.67 } };
  f.matches[0].goals = { over25: 0.44, btts: 0.52 };
  setRemoteForTests(f, {
    schema: 1, generated_at: new Date().toISOString(), model_version: 'fb-test', note: '', live: { overall: { n: 0, correct: 0, hit_rate: null, log_loss: null, brier: null, by_confidence: {} }, competitions: {}, recent: [] }, backtest: null,
    track_record: { tiers: { 'toss-up': { n: 1400, hit_rate: 0.37, share: 0.18 } }, draw_calls: { n: 400, hit_rate: 0.31, share: 0.05, base_rate: 0.25 }, all_matches: { n: 7740, hit_rate: 0.52 }, bookmaker: { n: 7542, hit_rate: 0.528 }, double_chance: { n: 7740, hit_rate: 0.79, strong: { n: 1400, hit_rate: 0.91, share: 0.18 } } },
  });
  const p = predictEvent(ev('Manchester United', 'Arsenal'))!;
  assert.equal(p.pick, 'draw');
  assert.equal(p.predicted_score[0], p.predicted_score[1]);
  assert.equal(mini(p).pick, 'draw');
  assert.equal(mini(p).tier, 'toss-up');
  assert.equal(p.call?.tier_hit_rate, 0.37);
  assert.equal(p.call?.safer.label, 'Manchester or draw');
  assert.deepEqual(p.goals, { over25: 0.44, btts: 0.52 });
  assert.ok(p.explanation.summary.startsWith('Draw called'));
  // without a call (older file) the plain most-likely outcome is used
  setRemoteForTests(file());
  assert.equal(predictEvent(ev('Manchester United', 'Arsenal'))!.pick, 'away');
});

test('the built-in snapshot is used inside its own horizon only, and a download replaces it', async () => {
  const DAY = 86400e3;
  // 10 days old, 21-day horizon: older than the 3 days a download is trusted, but still inside its horizon
  setRemoteForTests(null);
  setBundledForTests({ predictions: file({ generated_at: new Date(Date.now() - 10 * DAY).toISOString(), matches: file().matches.map((m) => ({ ...m, kickoff: new Date(Date.now() + DAY).toISOString() })) }), accuracy: null });
  ensureRemoteLoaded();
  assert.equal(remoteSource(), 'bundled');
  assert.equal(remoteCovers('eng.1'), true);
  assert.ok(remoteFor(ev('Manchester United', 'Arsenal', new Date(Date.now() + DAY).toISOString())));
  // past its horizon: not installed, so the app falls back to the on-device engine
  setRemoteForTests(null);
  setBundledForTests({ predictions: file({ generated_at: new Date(Date.now() - 22 * DAY).toISOString() }), accuracy: null });
  ensureRemoteLoaded();
  assert.equal(remoteSource(), 'none');
  assert.equal(remoteCovers('eng.1'), false);
  // a newer file from the network replaces the snapshot
  setRemoteForTests(null);
  setBundledForTests({ predictions: file({ generated_at: new Date(Date.now() - 5 * DAY).toISOString() }), accuracy: null });
  setFetch((async (url: string) => (url.includes('football_predictions') ? new Response(JSON.stringify(file({ model_version: 'fb-new' })), { status: 200 }) : new Response('nope', { status: 404 }))) as unknown as typeof fetch);
  assert.equal(await refreshRemote(true), true);
  assert.equal(remoteSource(), 'network');
});

test('safer call always contains the call; tiers follow the pick probability', () => {
  assert.deepEqual(saferCall({ home: 0.34, draw: 0.33, away: 0.33 }, 'draw').pair, 'home or draw');
  assert.equal(saferCall({ home: 0.2, draw: 0.32, away: 0.48 }, 'draw').pair, 'away or draw'); // never "home or away" for a draw
  assert.equal(saferCall({ home: 0.5, draw: 0.2, away: 0.3 }, 'home').pair, 'home or away');
  assert.equal(saferCall({ home: 0.5, draw: 0.3, away: 0.2 }, 'home').pair, 'home or draw');
  assert.deepEqual([tierOf(0.65), tierOf(0.649), tierOf(0.5), tierOf(0.4), tierOf(0.39)], ['strong', 'likely', 'likely', 'lean', 'toss-up']);
});

test('published predictions carry the draw note when a draw is close but not called', () => {
  const m = file().matches[0];
  setRemoteForTests(file({ matches: [{ ...m, p: { home: 0.4, draw: 0.3, away: 0.3 }, call: { pick: 'home', pick_probability: 0.4, tier: 'lean', draw_call: false, double_chance: { call: 'home or draw', probability: 0.7 } } }] }));
  const p = predictEvent(ev('Manchester United', 'Arsenal'))!;
  assert.equal(p.call?.source, 'model');
  assert.match(p.call?.draw_note ?? '', /real possibility \(30%\): 29% of matches rated like this ended level/);
  setRemoteForTests(file({ matches: [{ ...m, p: { home: 0.5, draw: 0.25, away: 0.25 }, call: { pick: 'home', pick_probability: 0.5, tier: 'likely', draw_call: false, double_chance: { call: 'home or draw', probability: 0.75 } } }] }));
  assert.equal(predictEvent(ev('Manchester United', 'Arsenal'))!.call?.draw_note, undefined);
});

test('predictions list: with the live source down, the published predictions are listed (marked offline)', async () => {
  const { handleLocal } = await import('./localApi');
  const soon = new Date(Date.now() + 2 * 86400e3).toISOString();
  const m = file().matches[0];
  setRemoteForTests(file({ matches: [{ ...m, kickoff: soon, call: { pick: 'away', pick_probability: 0.42, tier: 'lean', draw_call: false, double_chance: { call: 'away or draw', probability: 0.69 } } }] }));
  setFetch((async () => new Response('down', { status: 503 })) as unknown as typeof fetch);
  const r: any = await handleLocal('GET', '/predictions?days=7', null);
  assert.equal(r.offline, true);
  assert.equal(r.items.length, 1);
  const c = r.items[0];
  assert.equal(c.offline, true);
  assert.equal(c.prediction.pick, 'away');
  assert.equal(c.prediction.tier, 'lean');
  assert.equal(c.prediction.source, 'model');
  assert.equal(c.prediction.safer, 'Arsenal or draw');
  assert.deepEqual(r.leagues, [{ slug: 'eng.1', short_name: 'Premier League', n: 1 }]);
});

test('a published prediction that moved shows where it came from and why', () => {
  const m = file().matches[0];
  setRemoteForTests(file({ matches: [{ ...m, versions: 2, last_change: 'bookmaker odds published', previous: { p: { home: 0.25, draw: 0.28, away: 0.47 }, pick: 'away', made_at: '2026-11-05T10:00:00+00:00' }, call: { pick: 'away', pick_probability: 0.42, tier: 'lean', draw_call: false, double_chance: { call: 'away or draw', probability: 0.69 } } }] }));
  const p = predictEvent(ev('Manchester United', 'Arsenal'))!;
  assert.deepEqual(p.call?.movement, { from: { home: 0.25, draw: 0.28, away: 0.47 }, from_pick: 'away', at: '2026-11-05T10:00:00+00:00', reason: 'bookmaker odds published' });
  setRemoteForTests(file());
  assert.equal(predictEvent(ev('Manchester United', 'Arsenal'))!.call?.movement, undefined); // first version: nothing to show
});

test('results and the model record come from the published tracker', async () => {
  const { handleLocal } = await import('./localApi');
  const w = { matches: { n: 40, hit_rate: 0.575 }, safer_call: { n: 40, hit_rate: 0.8 }, strong: { n: 6, hit_rate: 0.833 } };
  const graded = { match_id: 'x', competition: 'eng.1', kickoff: '2026-11-22T15:00:00+00:00', home: 'Man City', away: 'Fulham', score: '1-1', pick: 'home' as const,
    probability: 0.65, correct: 0, confidence_label: 'high' as const, tier: 'strong' as const, safer_call: 'home or draw' as const, safer_correct: 1, over25_correct: 1 };
  const agg = { n: 40, correct: 23, hit_rate: 0.575, log_loss: 0.96, brier: 0.58, by_confidence: {} };
  setRemoteForTests(file(), { schema: 1, generated_at: new Date().toISOString(), model_version: 'fb-x', live: { overall: agg, competitions: {}, recent: [graded], last_7_days: w, last_30_days: w }, backtest: null, note: '' });
  const rec: any = await handleLocal('GET', '/model/record', null);
  assert.equal(rec.graded, 40);
  assert.equal(rec.last_30_days.matches.hit_rate, 0.575);
  setFetch((async () => new Response('down', { status: 503 })) as unknown as typeof fetch);
  const list: any = await handleLocal('GET', '/predictions?days=7', null);
  assert.equal(list.results.items[0].safer_correct, 1);
  assert.equal(list.results.record.last_7_days.strong.n, 6);
});

test('predictions list: a hanging connection shows the published predictions after the time budget', async () => {
  const { handleLocal, setFixtureBudgetForTests } = await import('./localApi');
  const soon = new Date(Date.now() + 2 * 86400e3).toISOString();
  setRemoteForTests(file({ matches: [{ ...file().matches[0], kickoff: soon }] }));
  setFetch((() => new Promise(() => undefined)) as unknown as typeof fetch); // never answers
  setFixtureBudgetForTests(50);
  const t0 = Date.now();
  const r: any = await handleLocal('GET', '/predictions?days=7', null);
  assert.ok(Date.now() - t0 < 5000);
  assert.equal(r.slow, true);
  assert.equal(r.offline, true);
  assert.equal(r.items.length, 1);
  setFixtureBudgetForTests(20000);
});
