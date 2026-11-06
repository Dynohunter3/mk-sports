/**
 * Match centre, xG, other-sport parsers and the NFL/NHL/MLB margin models, tested on real data
 * captured from ESPN (Galatasaray 2-0 Stuttgart, Champions League, 3 Nov 2026).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { getModel, MARGIN_SPORTS, shotGeometry, teamXg, xgFor } from '@/engine';

import { formationRows, LineupPlayer, parseCentre, parseLineups, parsePlayerPage, parseShots, parseTeamStats, parseTimeline } from './centre';
import { parseArticles, parseCricket, parseF1, parseTennis } from './more';

const summary = JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'summary-gal-stu.json'), 'utf8'));
const GAL = '432';

test('xG matches the Python fit and handles both coordinate systems', () => {
  // reference values from engine/scripts/fit_xg.py with the same coefficients
  const ref: [number, number, number][] = [
    [88.5, 46.0, 0.11319],
    [0.23, 0.5, 0.118859],
    [74.0, 53.0, 0.033396],
    [95.5, 57.7, 0.088401],
    [0.122, 0.458, 0.1514],
  ];
  for (const [x, y, v] of ref) assert.ok(Math.abs(xgFor(x, y) - v) < 1e-5, `${x},${y}: ${xgFor(x, y)} vs ${v}`);
  // the penalty spot reads ~12 m in both systems
  assert.ok(Math.abs(shotGeometry(88.5, 50).dist - shotGeometry(0.23, 0.5).dist) < 0.3);
  assert.equal(xgFor(0, 0, true), 0.766);
  // closer and more central is better
  assert.ok(xgFor(94, 50) > xgFor(85, 50));
  assert.ok(xgFor(85, 50) > xgFor(85, 15));
});

test('line-ups follow the formation, left to right', () => {
  const l = parseLineups(summary, GAL)!;
  assert.ok(l);
  assert.equal(l.home.formation, '4-2-3-1');
  assert.deepEqual(
    l.home.rows.map((r) => r.length),
    [1, 4, 2, 3, 1],
  );
  assert.equal(l.home.rows[0][0].position, 'G');
  // back four: left back first, right back last
  assert.equal(l.home.rows[1][0].position, 'LB');
  assert.equal(l.home.rows[1][3].position, 'RB');
  // goals and substitutions come through
  const all = [...l.home.rows.flat(), ...l.home.bench];
  const batrakov = all.find((p) => p.name.includes('Batrakov'))!;
  assert.equal(batrakov.goals, 2);
  assert.equal(batrakov.subbedOut, "77'");
  const sane = l.home.bench.find((p) => p.name.includes('Sané'))!;
  assert.equal(sane.subbedIn, "77'");
  assert.equal(l.home.bench[0].subbedIn !== null, true); // used substitutes listed first
});

test('formation rows fall back to positions when the formation string does not fit', () => {
  const mk = (position: string, place: number): LineupPlayer => ({ id: String(place), name: position, short: position, jersey: null, position, positionName: null, place, starter: true, headshot: null, subbedIn: null, subbedOut: null, goals: 0, assists: 0, ownGoals: 0, yellow: false, red: false, stats: {} });
  const ps = [mk('G', 1), mk('CD-L', 6), mk('CD', 5), mk('CD-R', 4), mk('LWB', 3), mk('RWB', 2), mk('CM-L', 8), mk('CM', 7), mk('CM-R', 10), mk('CF-L', 9), mk('CF-R', 11)];
  const rows = formationRows(ps, '3-5-2');
  assert.deepEqual(
    rows.map((r) => r.map((p) => p.position)),
    [['G'], ['CD-L', 'CD', 'CD-R'], ['LWB', 'CM-L', 'CM', 'CM-R', 'RWB'], ['CF-L', 'CF-R']],
  );
  const loose = formationRows(ps, null);
  assert.equal(loose[0][0].position, 'G');
  assert.equal(loose.flat().length, 11);
});

test('team stats, shots, xG and timeline from the real match', () => {
  const shots = parseShots(summary, 'Galatasaray', GAL);
  const box = parseTeamStats(summary, 'football', GAL, null);
  const get = (k: string) => box.find((s) => s.key === k)!;
  assert.equal(get('totalShots').home, String(shots.filter((s) => s.side === 'home').length)); // 13 = 13
  assert.equal(get('totalShots').away, String(shots.filter((s) => s.side === 'away').length));
  assert.equal(shots.filter((s) => s.goal && s.side === 'home').length, 2);
  assert.ok(get('passAccuracy').home.endsWith('%'));
  assert.equal(get('possessionPct').home, '52%');
  const x = teamXg(shots);
  assert.ok(x.home > 0.3 && x.home < 3 && x.away > 0.3 && x.away < 3);
  const c = parseCentre(summary, 'football', GAL, 'Galatasaray');
  assert.ok(c.xg && Math.abs(c.xg.home - x.home) < 1e-9);
  assert.equal(c.stats[1].key, 'xg');
  const tl = parseTimeline(summary, GAL, 'Galatasaray');
  const goals = tl.filter((e) => e.type === 'goal');
  assert.deepEqual(
    goals.map((g) => [g.minute, g.side, g.player]),
    [
      ["12'", 'home', 'Alexey Batrakov'],
      ["15'", 'home', 'Alexey Batrakov'],
    ],
  );
  assert.equal(goals[1].detail, 'Assist: Davinson Sánchez');
  assert.ok(tl.some((e) => e.type === 'sub' && e.detail?.startsWith('Off:')));
});

test('player page: season by competition and team-perspective recent scores', () => {
  const bio = { athlete: { displayName: 'Erling Haaland', position: { displayName: 'Forward' }, jersey: '9', age: 26, citizenship: 'Norway', team: { id: '382', displayName: 'Manchester City' }, statsSummary: { statistics: [] } } };
  const overview = {
    statistics: { labels: ['G', 'A'], names: ['totalGoals', 'goalAssists'], displayNames: ['Goals', 'Assists'], splits: [{ displayName: '2026-27 English Premier League', stats: ['9', '0'] }] },
    gameLog: {
      statistics: [{ labels: ['G'], displayNames: ['Goals'], events: [{ eventId: '1', stats: ['0'] }] }],
      events: { '1': { atVs: 'vs', gameDate: '2026-10-31T15:00:00Z', score: '1-0', homeTeamId: '382', awayTeamId: '331', homeTeamScore: '0', awayTeamScore: '1', gameResult: 'L', opponent: { displayName: 'Brighton & Hove Albion' }, team: { id: '382' }, leagueShortName: 'Premier League' } },
    },
  };
  const p = parsePlayerPage(bio, overview, '253989');
  assert.equal(p.season[0].values[0], '9');
  assert.equal(p.recent[0].score, '0-1');
  assert.equal(p.recent[0].result, 'L');
  assert.equal(p.recent[0].home, true);
});

test('tennis, F1, cricket and news parsers', () => {
  const tn = parseTennis({
    events: [{ id: '1', name: 'Paris', date: '2026-10-31', groupings: [{ grouping: { displayName: "Men's Singles" }, competitions: [{ id: 'm1', date: '2026-11-03T10:00Z', status: { type: { state: 'post', shortDetail: 'Final' } }, round: { displayName: 'Round 2' }, competitors: [{ athlete: { displayName: 'A', id: '1' }, winner: true, linescores: [{ value: 6 }, { value: 7, tiebreak: 7 }] }, { athlete: { displayName: 'B', id: '2' }, linescores: [{ value: 3 }, { value: 6, tiebreak: 4 }] }] }] }] }],
  });
  assert.equal(tn.matches[0].players[0].winner, true);
  assert.deepEqual(tn.matches[0].players[1].sets, [3, 6]);
  assert.equal(tn.matches[0].players[0].tiebreaks[1], 7);
  const f = parseF1({ events: [{ id: '9', name: 'Mexico City GP', date: '2026-10-30', competitions: [{ type: { abbreviation: 'Race' }, date: '2026-11-01', status: { type: { state: 'post' } }, competitors: [{ order: 2, athlete: { displayName: 'Hamilton' } }, { order: 1, winner: true, athlete: { displayName: 'Verstappen' } }] }] }], leagues: [{ calendar: [{ label: 'Brazil GP', startDate: '2026-11-08' }] }] });
  assert.equal(f.current[0].sessions[0].results[0].driver, 'Verstappen');
  assert.equal(f.calendar[0].name, 'Brazil GP');
  const cr = parseCricket({ scores: [{ leagues: [{ name: 'Ranji Trophy' }], events: [{ id: 'c1', date: '2026-11-02', status: { summary: 'Day 2', type: { state: 'in' } }, competitions: [{ class: { generalClassCard: 'First-class' }, competitors: [{ team: { displayName: 'Assam', abbreviation: 'ASM' }, score: '211/6' }, { team: { displayName: 'Karnataka', abbreviation: 'KAR' }, score: '' }] }] }] }] });
  assert.equal(cr[0].teams[0].score, '211/6');
  assert.equal(cr[0].format, 'First-class');
  const news = parseArticles({ articles: [{ id: 5, headline: 'Saliba ready', published: '2026-11-03T20:28Z', images: [{ url: 'https://a.espncdn.com/x.jpg' }], links: { web: { href: 'https://espn.com/a' } }, categories: [{ type: 'team', teamId: 359 }] }, { headline: 'no link' }] }, 'eng.1');
  assert.equal(news.length, 1);
  assert.deepEqual(news[0].teamIds, ['359']);
});

test('NFL / NHL / MLB margin models produce sensible, sport-worded forecasts', () => {
  for (const sport of Object.keys(MARGIN_SPORTS)) {
    const model = getModel(sport);
    const book = model.newBook();
    const day = 86_400_000;
    const t0 = Date.parse('2026-01-01');
    const big = sport === 'american-football' ? [31, 13] : sport === 'ice-hockey' ? [5, 2] : [7, 2];
    for (let i = 0; i < 30; i++) {
      book.update({ id: `s${i}`, date: new Date(t0 + i * 2 * day), home: i % 2 ? 'A' : 'B', away: i % 2 ? 'B' : 'A', homeScore: i % 2 ? big[0] : big[1], awayScore: i % 2 ? big[1] : big[0], competition: 'x', neutral: false });
    }
    const inp = book.buildInput({ home: 'A', away: 'B', kickoff: new Date(t0 + 70 * day), competition: 'x', neutral: false, homeName: 'Alphas', awayName: 'Betas' });
    const p = model.predict(inp);
    assert.equal(p.sport, sport);
    assert.equal(p.probDraw, null);
    assert.ok(p.probHome > 0.6, `${sport} strong home team favoured (${p.probHome})`);
    assert.ok(p.predictedHome > p.predictedAway);
    const unit = MARGIN_SPORTS[sport].unitShort;
    assert.ok(p.explanation.steps.some((s) => s.detail.includes(unit)), `${sport} wording uses ${unit}`);
  }
});
