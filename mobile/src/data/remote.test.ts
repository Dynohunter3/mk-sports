/** Published pipeline predictions: matching ESPN fixtures, use in predictEvent, fallbacks, mirror URL. */
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import type { SEvent } from './espn';
import { setFetch } from './http';
import { memoryKV, setKV } from './kv';
import { bestSim, nameSim } from './names';
import { predictEvent } from './predict';
import { REMOTE_URLS, refreshRemote, remoteCovers, remoteFor, RemoteFile, setRemoteForTests } from './remote';

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
