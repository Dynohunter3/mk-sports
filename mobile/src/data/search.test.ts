import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parsePlayers, parseTeams, searchCompetitions } from './search';

test('competition search matches names, short names and countries by word starts', () => {
  assert.ok(searchCompetitions('premier').some((l) => l.slug === 'eng.1'));
  assert.ok(searchCompetitions('scot').some((l) => l.slug === 'sco.1'));
  assert.ok(searchCompetitions('league one').some((l) => l.slug === 'eng.3'));
  assert.ok(searchCompetitions('süper').some((l) => l.slug === 'tur.1'));
  assert.deepEqual(searchCompetitions('   '), []);
});

test('search results keep only competitions the app has, with app ids', () => {
  const teams = parseTeams({ items: [
    { id: '359', type: 'team', sport: 'soccer', defaultLeagueSlug: 'eng.1', displayName: 'Arsenal', abbreviation: 'ARS', color: 'e20520', logos: [{ href: 'https://a.espncdn.com/x.png' }] },
    { id: '19973', type: 'team', sport: 'soccer', defaultLeagueSlug: 'eng.w.1', displayName: 'Arsenal' }, // a league the app does not have
  ] });
  assert.deepEqual(teams.map((t) => [t.id, t.league, t.color]), [['football:359', 'eng.1', '#e20520']]);
  const players = parsePlayers({ items: [
    { id: '280555', type: 'player', sport: 'soccer', league: 'eng.1', displayName: 'Bukayo Saka' },
    { id: '2789', type: 'player', sport: 'tennis', league: 'wta', displayName: 'Naomi Osaka' }, // tennis players have no player page
  ] });
  assert.deepEqual(players.map((p) => [p.id, p.league]), [['280555', 'eng.1']]);
});

test('feed headlines lose a repeated section prefix', async () => {
  const { cleanHeadline } = await import('./more');
  assert.equal(cleanHeadline('Transfer rumors, news:Transfer rumors, news: Nico Paz open to Madrid'), 'Transfer rumors, news: Nico Paz open to Madrid');
  assert.equal(cleanHeadline('Transfer rumors, news:Nico Paz open to Madrid'), 'Transfer rumors, news: Nico Paz open to Madrid');
  assert.equal(cleanHeadline('  Arsenal   beat Chelsea 2:1 '), 'Arsenal beat Chelsea 2:1');
  assert.equal(cleanHeadline('Kick-off at 20:00 for the derby'), 'Kick-off at 20:00 for the derby');
});
