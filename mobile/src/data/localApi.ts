/**
 * On-device implementation of the MK Sports API. Screens call the same paths as with the
 * server (`/feed`, `/matches`, `/matches/:id`, ...); here they are answered from live
 * public data (ESPN) plus the on-device models and pick game.
 */
import { ApiError, OfflineError } from '@/api/errors';
import { argmax, Outcome, Probs, SOURCE_INFO, XG_MODEL } from '@/engine';

import { clubEloFixtures } from './clubelo';
import * as espn from './espn';
import type { SEvent, TeamInfo } from './espn';
import * as game from './game';
import * as pl from './pleagues';
import { ensureSport, historyError, historyVersion, ingest, loadedHistory, onHistoryChange, sportMatches, sportReady, teamInfo } from './history';
import { SourceError } from './http';
import * as centreApi from './centre';
import { LEAGUE_BY_SLUG, LEAGUES, LeagueDef, MATCH_LEAGUES, SportSlug, SPORTS, sportOf } from './leagues';
import * as more from './more';
import { AccAgg, ensureRemoteLoaded, onRemoteChange, refreshRemote, remoteAccuracy, remoteCovers, remoteFile, RemoteMatch, remoteSource } from './remote';
import { DEVICE_TRACK, MODEL_DRAW_NOTE } from '../engine/calls';
import { backtest, bookFor, clearPredictionStores, fromRemote, getBacktest, onPredictionDataChange, PREDICTED_SPORTS, scheduleBacktest, FullPrediction, liveEvaluations, mini, predictEvent, preMatchSnapshot, registerTeams, scoreFinished, scorePrediction, snapshot, sourceStats, storesReady } from './predict';

const DAY = 86_400_000;
export const DISCLAIMER =
  'Predictions are for information and entertainment only and are not betting advice. The pick game is free to play: there are no real-money stakes or prizes.';

// ------------------------------------------------------------------ change notifications
const listeners = new Set<() => void>();
let notifyTimer: ReturnType<typeof setTimeout> | null = null;
export function onLocalDataChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify() {
  if (notifyTimer) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    listeners.forEach((f) => f());
  }, 800);
}
onHistoryChange(notify);
onPredictionDataChange(notify);
onRemoteChange(notify); // a newer published predictions file refreshes open screens

// ------------------------------------------------------------------ fetching
const events = new Map<string, SEvent>(); // everything seen recently, by id
const liveLeagues = new Set<string>();
const seasons = new Map<string, string>();
const leagueErrors = new Map<string, string>();

async function afterFetch(slug: string, list: SEvent[]) {
  for (const e of list) events.set(e.id, e);
  registerTeams(list.flatMap((e) => [e.home, e.away]));
  if (list.some((e) => e.status === 'live')) liveLeagues.add(slug);
  else liveLeagues.delete(slug);
  ingest(slug, list);
  scoreFinished(list);
  if (await game.settle(list)) notify();
}

async function fetchLeague(slug: string, from: number, to: number): Promise<SEvent[]> {
  const now = Date.now();
  const ttl = to < now - DAY ? 3600 : from > now + DAY ? 600 : liveLeagues.has(slug) ? 20 : 90;
  try {
    const sb = await espn.scoreboard(slug, new Date(from), new Date(to), ttl);
    if (sb.season) seasons.set(slug, sb.season);
    leagueErrors.delete(slug);
    await afterFetch(slug, sb.events);
    return sb.events;
  } catch (e) {
    leagueErrors.set(slug, e instanceof Error ? e.message : 'failed');
    throw e;
  }
}

/** Fetch several competitions; tolerate individual failures, fail only if all fail. */
async function fetchLeagues(slugs: string[], from: number, to: number): Promise<SEvent[]> {
  const res = await Promise.allSettled(slugs.map((s) => fetchLeague(s, from, to)));
  const ok = res.filter((r): r is PromiseFulfilledResult<SEvent[]> => r.status === 'fulfilled');
  if (!ok.length && res.length) {
    const err = (res[0] as PromiseRejectedResult).reason;
    if (err instanceof SourceError) throw new ApiError(502, 'source_unavailable', `Live data source unavailable (${err.message})`);
    throw new OfflineError("Can't reach the live data source");
  }
  return ok.flatMap((r) => r.value);
}

function warmSport(sport: SportSlug) {
  if (sportReady(sport)) return;
  // the backtest feeds the source weights and the accuracy page; it runs in the background
  ensureSport(sport).then(() => scheduleBacktest(sport));
}

// ------------------------------------------------------------------ payload builders
const teamMini = (t: TeamInfo) => ({ id: t.id, name: t.name, short_name: t.short, code: t.abbr, color: t.color, logo: t.logo ?? null });
const leagueMini = (slug: string) => ({ id: slug, slug, short_name: LEAGUE_BY_SLUG[slug]?.shortName ?? slug });

function myPick(id: string) {
  const p = game.gameState()?.picks[id];
  return p ? { pick: p.pick, home_score: p.home_score, away_score: p.away_score, status: p.status, points: p.points, banker: !!p.banker } : null;
}

function predictionFor(ev: SEvent): FullPrediction | null {
  if (ev.status !== 'scheduled') return null;
  if (!sportReady(ev.sport)) warmSport(ev.sport);
  const p = predictEvent(ev);
  if (p) snapshot(ev, p);
  return p;
}

function card(ev: SEvent, withPrediction = true) {
  const p = withPrediction ? predictionFor(ev) : null;
  return {
    id: ev.id,
    sport: ev.sport,
    league: leagueMini(ev.league),
    start_time: ev.start,
    status: ev.status,
    clock: ev.clock,
    round: ev.round,
    home: teamMini(ev.home),
    away: teamMini(ev.away),
    home_score: ev.homeScore,
    away_score: ev.awayScore,
    prediction: p ? mini(p) : null,
    my_pick: myPick(ev.id),
    locked: game.isLocked(ev),
    goals: ev.details
      .filter((d) => d.type === 'goal' || d.type === 'own_goal' || d.type === 'penalty_goal')
      .slice(0, 8)
      .map((d) => ({ side: d.side, player: d.player, clock: d.clock, type: d.type })),
  };
}

function leagueOut(l: LeagueDef) {
  return { id: l.slug, slug: l.slug, sport: l.sport, name: l.name, short_name: l.shortName, country: l.country, region: l.region, kind: l.kind, format: l.format, is_featured: l.featured, is_active: true, season: seasons.get(l.slug) ?? null, theme: l.theme, has_leaders: !!l.leaders };
}

function sportOut(s: (typeof SPORTS)[number]) {
  return { id: s.slug, slug: s.slug, name: s.name, color: s.color, icon: s.icon, has_draws: s.hasDraws, score_unit: s.scoreUnit, tier: s.tier, is_active: s.active, predictions: s.predictions, scoring: s.scoring, max_score: s.maxScore, stepper: s.stepper, phase: s.active ? null : s.tier === 1 ? 2 : 3 };
}

function histEvent(sport: SportSlug, m: ReturnType<typeof sportMatches>[number]): SEvent | null {
  const h = teamInfo(sport, m.home);
  const a = teamInfo(sport, m.away);
  if (!h || !a) return null;
  return {
    id: espn.makeEventId(m.league, m.espnId),
    espnId: m.espnId,
    league: m.league,
    sport,
    start: m.date.toISOString(),
    status: 'finished',
    clock: 'FT',
    home: h,
    away: a,
    homeScore: m.homeScore,
    awayScore: m.awayScore,
    venue: null,
    neutral: m.neutral,
    round: null,
    details: [],
    quarters: null,
    market: m.market,
    preseason: false,
  };
}

function formGames(sport: SportSlug, teamId: string, before?: number) {
  const entry = bookFor(sport, before);
  if (!entry) return [];
  return entry.book
    .teamState(teamId)
    .recent.slice(0, 5)
    .map((r, i) => ({
      match_id: `${teamId}-${i}`,
      date: r.date.toISOString(),
      opponent: teamInfo(sport, r.opponent.split(':')[1])?.short ?? r.opponent,
      home: r.isHome,
      score: r.isHome ? `${r.scored}-${r.conceded}` : `${r.conceded}-${r.scored}`,
      result: r.result,
    }));
}

function parseQuery(path: string): [string, URLSearchParams] {
  const i = path.indexOf('?');
  return i < 0 ? [path, new URLSearchParams()] : [path.slice(0, i), new URLSearchParams(path.slice(i + 1))];
}

const idsParam = (q: URLSearchParams, k: string) => (q.get(k) ?? '').split(',').filter(Boolean);

function localDayBounds(dateStr: string): [number, number] {
  const [y, m, d] = dateStr.split('-').map(Number);
  const start = new Date(y, m - 1, d).getTime();
  return [start, start + DAY];
}

// ------------------------------------------------------------------ handlers
async function feed(q: URLSearchParams) {
  const favSports = idsParam(q, 'sports');
  const favLeagues = idsParam(q, 'leagues').filter((l) => LEAGUE_BY_SLUG[l]?.format === 'match');
  const favTeams = new Set(idsParam(q, 'teams'));
  const myTeam = q.get('team');
  if (myTeam) favTeams.add(myTeam);
  const only = q.get('league');
  // what to download: one competition (league chip), else the favourites, else the featured ones
  const leagues: LeagueDef[] = only
    ? [LEAGUE_BY_SLUG[only]].filter((l) => l && l.format === 'match')
    : favLeagues.length
      ? favLeagues.map((l) => LEAGUE_BY_SLUG[l])
      : MATCH_LEAGUES.filter((l) => l.featured && (!favSports.length || favSports.includes(l.sport)));
  if (!leagues.length) leagues.push(...MATCH_LEAGUES.filter((l) => l.featured));
  const now = Date.now();
  const startToday = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  const all = await fetchLeagues(
    leagues.map((l) => l.slug),
    now - 2 * DAY,
    now + 4 * DAY,
  );
  const interestLeagues = new Set(only ? [only] : favLeagues.length || favTeams.size ? favLeagues : leagues.map((l) => l.slug));
  const interest = (e: SEvent) => interestLeagues.has(e.league) || favTeams.has(e.home.id) || favTeams.has(e.away.id);
  const byTime = (a: SEvent, b: SEvent) => a.start.localeCompare(b.start);
  const seen = new Set<string>();
  const sections: { key: string; title: string; items: ReturnType<typeof card>[] }[] = [];
  const add = (key: string, title: string, list: SEvent[], limit: number) => {
    const fresh = list.filter((e) => !seen.has(e.id)).slice(0, limit);
    fresh.forEach((e) => seen.add(e.id));
    if (fresh.length) sections.push({ key, title, items: fresh.map((e) => card(e)) });
  };
  if (myTeam) {
    const mine = all.filter((e) => e.home.id === myTeam || e.away.id === myTeam);
    const liveMine = mine.filter((e) => e.status === 'live');
    const next = mine.filter((e) => e.status === 'scheduled').sort(byTime)[0];
    const last = mine.filter((e) => e.status === 'finished').sort((a, b) => b.start.localeCompare(a.start))[0];
    add('my_team', 'Your team', [...liveMine, ...(next ? [next] : []), ...(last ? [last] : [])], 3);
  }
  const live = all.filter((e) => e.status === 'live').sort((a, b) => Number(interest(b)) - Number(interest(a)) || byTime(a, b));
  add('live', 'Live now', live, 12);
  if (favTeams.size) add('my_teams', 'Your teams', all.filter((e) => (favTeams.has(e.home.id) || favTeams.has(e.away.id)) && e.status === 'scheduled' && Date.parse(e.start) < now + 7 * DAY).sort(byTime), 8);
  const endToday = startToday + DAY;
  add('today', 'Today', all.filter((e) => interest(e) && e.status === 'scheduled' && Date.parse(e.start) >= startToday && Date.parse(e.start) < endToday).sort(byTime), 20);
  const soon = all.filter((e) => e.status === 'scheduled' && Date.parse(e.start) > now && Date.parse(e.start) < now + 2 * DAY);
  const scored = soon
    .map((e) => ({ e, p: predictionFor(e) }))
    .filter((x) => x.p)
    .sort((x, y) => Math.max(y.p!.probabilities.home ?? 0, y.p!.probabilities.away ?? 0) - Math.max(x.p!.probabilities.home ?? 0, x.p!.probabilities.away ?? 0));
  add('top_predictions', 'Most confident predictions', scored.map((x) => x.e), 5);
  add('upcoming', 'Coming up', all.filter((e) => interest(e) && e.status === 'scheduled' && Date.parse(e.start) >= endToday).sort(byTime), 15);
  add('results', 'Latest results', all.filter((e) => interest(e) && e.status === 'finished').sort((a, b) => b.start.localeCompare(a.start)), 10);
  const st = await game.loadGame();
  const sportsInFeed = new Set(all.map((e) => e.sport));
  return {
    personalised: !!(favSports.length || favLeagues.length || favTeams.size),
    open_picks: Object.values(st.picks).filter((p) => p.status === 'pending').length,
    predictions_loading: [...sportsInFeed].some((s) => !sportReady(s)),
    unavailable: [...leagueErrors.keys()].filter((s) => leagues.some((l) => l.slug === s)).map((s) => LEAGUE_BY_SLUG[s].shortName),
    sections,
  };
}

let fixtureBudgetMs = 20000;
/** Tests only. */
export function setFixtureBudgetForTests(ms: number) {
  fixtureBudgetMs = ms;
}

/** The model's live record: graded predictions (the last one before kick-off), from the published tracker. */
function modelRecord() {
  const a = remoteAccuracy();
  return { last_7_days: a?.live.last_7_days ?? null, last_30_days: a?.live.last_30_days ?? null, graded: a?.live.overall.n ?? 0, generated_at: a?.generated_at ?? null };
}

/** A card for a published prediction when its fixture can't be loaded from the live source. */
function offlineCard(m: RemoteMatch) {
  const team = (t: RemoteMatch['home']): TeamInfo => ({ id: t.id, espnId: t.id, name: t.name, short: t.name, abbr: t.name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase(), color: '#334155', logo: null });
  const ev: SEvent = {
    id: `offline~${m.match_id}`, espnId: m.match_id, league: m.competition, sport: 'football', start: m.kickoff, status: 'scheduled', clock: null,
    home: team(m.home), away: team(m.away), homeScore: null, awayScore: null, venue: null, neutral: false, round: null, details: [], quarters: null, market: null, preseason: false,
  };
  return { ...card(ev, false), prediction: mini(fromRemote(ev, m)), locked: true, offline: true };
}

/** Football competitions on the Predictions screen: the leagues, plus the Champions and Europa League. */
const PREDICTION_LEAGUES = MATCH_LEAGUES.filter((l) => l.sport === 'football' && (l.kind === 'league' || l.slug === 'uefa.champions' || l.slug === 'uefa.europa')).map((l) => l.slug);

/** Every upcoming football prediction for the next few days, with the call, its strength and the safer call. */
async function predictionsList(q: URLSearchParams) {
  const days = Math.min(10, Math.max(1, Number(q.get('days') ?? 7) || 7));
  const now = Date.now();
  let items: ReturnType<typeof card>[];
  let offline = false;
  let slow = false;
  let all: SEvent[] | null = null;
  const fetched = fetchLeagues(PREDICTION_LEAGUES, now - DAY, now + (days + 1) * DAY);
  try {
    // a connection that hangs (weak signal, captive Wi-Fi) can take minutes to fail: after the budget, show the
    // published predictions and let the fixtures keep loading in the background for the next refresh
    const first = await Promise.race([fetched, new Promise<null>((r) => setTimeout(() => r(null), fixtureBudgetMs))]);
    if (first !== null) all = first;
    else if (remoteFile()) {
      slow = true;
      fetched.catch(() => undefined);
    } else all = await fetched;
  } catch (e) {
    if (!remoteFile()) throw e;
    offline = true;
  }
  if (all) {
    const upcoming = [...new Map(all.map((e) => [e.id, e])).values()]
      .filter((e) => e.status === 'scheduled' && Date.parse(e.start) > now - 3 * 3600 * 1000 && Date.parse(e.start) < now + days * DAY)
      .sort((a, b) => a.start.localeCompare(b.start));
    items = upcoming.map((e) => card(e)).filter((c) => c.prediction);
  } else {
    // fixtures can't be loaded (or are slow): list the published predictions themselves (built in or saved), so
    // the screen still works. Rows are marked so the app doesn't open a match page it can't load.
    const f = remoteFile()!;
    items = f.matches
      .filter((m) => remoteCovers(m.competition) && Date.parse(m.kickoff) > now - 3 * 3600 * 1000 && Date.parse(m.kickoff) < now + days * DAY)
      .sort((a, b) => a.kickoff.localeCompare(b.kickoff))
      .map(offlineCard);
  }
  const counts = new Map<string, number>();
  for (const c of items) counts.set(c.league.id, (counts.get(c.league.id) ?? 0) + 1);
  const rec = remoteAccuracy()?.track_record;
  const f = remoteFile();
  return {
    days,
    offline: offline || slow,
    slow,
    results: { record: modelRecord(), items: (remoteAccuracy()?.live.recent ?? []).slice(0, 120) },
    items,
    leagues: PREDICTION_LEAGUES.filter((l) => counts.has(l)).map((l) => ({ slug: l, short_name: LEAGUE_BY_SLUG[l].shortName, n: counts.get(l)! })),
    model: f ? { version: f.model_version, generated_at: f.generated_at, source: remoteSource() } : null,
    // backtest hit rates of the published model (two seasons), and of the on-device engine for matches it predicts
    track: {
      model: rec
        ? {
            tiers: Object.fromEntries(Object.entries(rec.tiers).map(([k, v]) => [k, v?.hit_rate ?? null])),
            draw_calls: rec.draw_calls.hit_rate,
            draw_base_rate: rec.draw_calls.base_rate,
            safer: rec.double_chance.hit_rate,
            safer_strong: rec.double_chance.strong.hit_rate,
            draw_note: rec.draw_note?.ended_level ?? MODEL_DRAW_NOTE.drawn,
          }
        : null,
      device: { tiers: DEVICE_TRACK.tiers, safer: DEVICE_TRACK.safer, draw_note: DEVICE_TRACK.drawNote.drawn },
    },
    unavailable: [...leagueErrors.keys()].filter((s) => PREDICTION_LEAGUES.includes(s)).map((s) => LEAGUE_BY_SLUG[s].shortName),
  };
}

async function matches(q: URLSearchParams) {
  const sport = q.get('sport') as SportSlug | null;
  const leagueId = q.get('league_id');
  const teamId = q.get('team_id');
  const status = q.get('status');
  const order = q.get('order') === 'desc' ? 'desc' : 'asc';
  const limit = Math.min(100, Number(q.get('limit') ?? 30));
  const offset = Number(q.get('cursor') ?? 0) || 0;
  const teamSport = teamId ? (teamId.split(':')[0] as SportSlug) : null;
  const leagues = leagueId ? [leagueId] : (idsParam(q, 'leagues').length ? idsParam(q, 'leagues') : MATCH_LEAGUES.filter((l) => !(sport ?? teamSport) || l.sport === (sport ?? teamSport)).map((l) => l.slug)).filter((l) => LEAGUE_BY_SLUG[l]?.format === 'match');
  const now = Date.now();
  let from: number;
  let to: number;
  if (q.get('date')) [from, to] = localDayBounds(q.get('date')!);
  else {
    from = q.get('from') ? Date.parse(q.get('from')!) : status === 'finished' ? now - 30 * DAY : now - DAY;
    to = q.get('to') ? Date.parse(q.get('to')!) : status === 'finished' ? now : from + (teamId ? 24 : 30) * DAY;
  }
  let list: SEvent[] = [];
  if (status === 'finished' && !q.get('date')) {
    // results come from the stored history (no extra download), plus anything from the last 2 days
    const sports = new Set(leagues.map((s) => LEAGUE_BY_SLUG[s].sport as SportSlug));
    for (const sp of sports) {
      if (!sportReady(sp)) await ensureSport(sp);
      for (const m of sportMatches(sp)) if (leagues.includes(m.league)) {
        const e = histEvent(sp, m);
        if (e) list.push(e);
      }
    }
    const recent = await fetchLeagues(leagues, now - 2 * DAY, now).catch(() => []);
    const ids = new Set(list.map((e) => e.id));
    list.push(...recent.filter((e) => e.status === 'finished' && !ids.has(e.id)));
  } else {
    // pad by a day each side: the source buckets dates in its own time zone
    list = (await fetchLeagues(leagues, from - DAY, to + DAY)).filter((e) => Date.parse(e.start) >= from && Date.parse(e.start) < to);
  }
  if (teamId) list = list.filter((e) => e.home.id === teamId || e.away.id === teamId);
  if (status) list = list.filter((e) => e.status === status);
  const uniq = [...new Map(list.map((e) => [e.id, e])).values()];
  uniq.sort((a, b) => (order === 'asc' ? a.start.localeCompare(b.start) : b.start.localeCompare(a.start)));
  const page = uniq.slice(offset, offset + limit);
  return { items: page.map((e) => card(e)), next_cursor: offset + limit < uniq.length ? String(offset + limit) : null };
}

async function matchDetail(id: string) {
  const ids = espn.splitEventId(id);
  if (!ids || !LEAGUE_BY_SLUG[ids.league]) throw new ApiError(404, 'not_found', 'Match not found');
  const known = events.get(id);
  let extra: Awaited<ReturnType<typeof espn.summary>> | null = null;
  try {
    extra = await espn.summary(id, known?.status === 'live' ? 20 : known?.status === 'scheduled' ? 300 : 900);
  } catch (e) {
    if (!known) throw e instanceof SourceError ? new ApiError(502, 'source_unavailable', e.message) : new OfflineError();
  }
  const fresh = extra?.event ?? known!;
  if (!sportReady(fresh.sport)) await ensureSport(fresh.sport); // history also supplies short team names
  const better = (t: TeamInfo, k?: TeamInfo) => {
    const b = k && k.espnId === t.espnId ? k : teamInfo(fresh.sport, t.espnId) ?? t;
    return { ...b, logo: b.logo ?? t.logo ?? k?.logo ?? null }; // stored history may predate crests
  };
  const ev: SEvent = {
    ...fresh,
    home: better(fresh.home, known?.home),
    away: better(fresh.away, known?.away),
    venue: fresh.venue ?? known?.venue ?? null,
    round: fresh.round ?? known?.round ?? null,
    market: fresh.market ?? known?.market ?? null,
    details: fresh.details?.length ? fresh.details : known?.details ?? [],
  };
  await afterFetch(ev.league, [ev]);
  const sport = ev.sport;
  const started = ev.status !== 'scheduled';
  const kickoff = Date.parse(ev.start);
  const opts = { injuries: extra?.injuries ?? null, espnPredictor: extra?.predictor ?? null, before: started ? kickoff : undefined };
  const p = predictEvent(ev, opts);
  if (p && !started) snapshot(ev, p);
  if (p && started) {
    const snap = preMatchSnapshot(id);
    if (snap) p.trigger = 'pre-match (saved before kick-off)';
    if (ev.status === 'finished' && ev.homeScore !== null && ev.awayScore !== null) {
      // judged on the call that was shown (a draw call included), not only the most likely outcome
      const o = ev.homeScore > ev.awayScore ? 'home' : ev.homeScore < ev.awayScore ? 'away' : 'draw';
      p.correct = p.pick ? p.pick === o : scorePrediction(p.probabilities, ev.homeScore, ev.awayScore).correct;
    }
  }
  const lg = LEAGUE_BY_SLUG[ev.league];
  let table: Awaited<ReturnType<typeof standingsRows>> = [];
  try {
    table = await standingsRows(ev.league);
  } catch {
    table = [];
  }
  let h2h: { match_id: string; date: string; opponent: string; home: boolean; score: string; result: 'W' | 'D' | 'L' }[] = [];
  if (extra?.h2h?.length) {
    h2h = extra.h2h.slice(0, 5).map((g, i) => {
      const homeIsOurHome = g.homeEspnId === ev.home.espnId;
      const ours = homeIsOurHome ? g.homeScore! : g.awayScore!;
      const theirs = homeIsOurHome ? g.awayScore! : g.homeScore!;
      return { match_id: `h2h-${i}`, date: g.date, opponent: ev.away.short, home: homeIsOurHome, score: `${g.homeScore}-${g.awayScore}`, result: ours > theirs ? 'W' : ours < theirs ? 'L' : 'D' };
    });
  } else {
    const entry = bookFor(sport, started ? kickoff : undefined);
    h2h = (entry?.book.headToHead(ev.home.id, ev.away.id) ?? []).slice(0, 5).map((m, i) => {
      const homeIsOurHome = m.home === ev.home.id;
      const ours = homeIsOurHome ? m.homeScore : m.awayScore;
      const theirs = homeIsOurHome ? m.awayScore : m.homeScore;
      return { match_id: `h2h-${i}`, date: m.date.toISOString(), opponent: ev.away.short, home: homeIsOurHome, score: `${m.homeScore}-${m.awayScore}`, result: ours > theirs ? 'W' : ours < theirs ? 'L' : 'D' };
    });
  }
  const entry = bookFor(sport, started ? kickoff : undefined);
  const rating = (t: TeamInfo) => {
    if (!entry) return null;
    const s = entry.book.teamState(t.id);
    return { elo: Math.round(s.elo), attack: sport === 'football' ? s.attack : null, defence: sport === 'football' ? s.defence : null, points_for: s.pointsFor, points_against: s.pointsAgainst, games: s.games, form: s.recent.slice(0, 5).map((r) => r.result).join('') };
  };
  const sp = sportOf(sport)!;
  return {
    ...card(ev, false),
    prediction: p ? mini(p) : null,
    venue: ev.venue,
    neutral: ev.neutral,
    score_detail: ev.quarters ? { quarters: ev.quarters } : {},
    events: ev.details.map((d) => ({ type: d.type, minute: d.minute, clock: d.clock, side: d.side, player: d.player })),
    prediction_full: p,
    form: { home: formGames(sport, ev.home.id, started ? kickoff : undefined), away: formGames(sport, ev.away.id, started ? kickoff : undefined) },
    head_to_head: h2h,
    standings: table,
    injuries: extra?.injuries ?? { home: [], away: [] },
    injuries_available: !!extra?.injuries,
    ratings: { home: rating(ev.home), away: rating(ev.away) },
    scoring: sp.scoring,
    has_draws: sp.hasDraws,
    score_unit: sp.scoreUnit,
    league_name: lg.name,
    attendance: extra?.attendance ?? null,
  };
}

async function standingsRows(slug: string) {
  const rows = await espn.standings(slug);
  const sport = LEAGUE_BY_SLUG[slug].sport as SportSlug;
  const entry = bookFor(sport);
  return rows.map((r) => ({
    position: r.position,
    group: r.group,
    team: teamMini(r.team),
    played: r.played,
    won: r.won,
    drawn: r.drawn,
    lost: r.lost,
    points_for: r.pf,
    points_against: r.pa,
    points: r.points,
    ot_losses: r.otLosses,
    win_pct: r.winPct,
    games_behind: r.gamesBehind,
    streak: r.streak,
    note: r.note,
    form: entry ? entry.book.teamState(r.team.id).recent.slice(0, 5).map((x) => x.result).join('') : '',
  }));
}

async function teamsSearch(q: URLSearchParams) {
  const search = (q.get('search') ?? '').toLowerCase();
  const sport = q.get('sport');
  const leagueId = q.get('league_id');
  const limit = Number(q.get('limit') ?? 30);
  const slugs = leagueId ? [leagueId] : MATCH_LEAGUES.filter((l) => !sport || l.sport === sport).map((l) => l.slug);
  const lists = await Promise.allSettled(slugs.map((s) => espn.teams(s)));
  const seen = new Map<string, TeamInfo>();
  const leaguesByTeam = new Map<string, string[]>();
  lists.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    for (const t of r.value) {
      seen.set(t.id, t);
      leaguesByTeam.set(t.id, [...(leaguesByTeam.get(t.id) ?? []), slugs[i]]);
    }
  });
  if (!seen.size && lists.length && lists.every((r) => r.status === 'rejected')) throw new OfflineError("Can't reach the live data source");
  let out = [...seen.values()];
  if (search) out = out.filter((t) => t.name.toLowerCase().includes(search) || t.short.toLowerCase().includes(search) || t.abbr.toLowerCase() === search);
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out.slice(0, limit).map((t) => {
    const sp = t.id.split(':')[0] as SportSlug;
    const s = bookFor(sp)?.book.teamState(t.id);
    return { ...teamMini(t), sport: sp, country: null, venue_name: null, venue_city: null, elo: s && s.games ? Math.round(s.elo) : null, form: s ? s.recent.slice(0, 5).map((r) => r.result).join('') : null, leagues: leaguesByTeam.get(t.id) ?? [] };
  });
}

async function me() {
  const st = await game.loadGame();
  return {
    id: 'device',
    display_name: st.profile.display_name,
    avatar: st.profile.avatar ?? '⚽',
    email: null,
    phone: null,
    country: st.profile.country,
    auth_provider: 'device',
    consented: !!st.profile.consented_at,
    marketing_opt_in: false,
    onboarded: true,
    notification_prefs: {},
    favourites: { sports: [], leagues: [], teams: [] },
    stats: game.stats(st),
    badges: game.BADGES.map((b) => ({ ...b, awarded_at: st.badges[b.slug] ?? null })),
    created_at: st.profile.created_at,
  };
}

// ------------------------------------------------------------------ private leagues
/** My score card for private leagues, from the game on this phone. */
async function myCard(): Promise<pl.Card> {
  const st = await game.loadGame();
  const s = game.stats(st);
  const pts = game.pointsByPeriod(st);
  const wk = pts.weeks.find((w) => w.key === pts.current_week);
  return {
    id: st.profile.member_id ?? 'unknown0000',
    name: st.profile.display_name === 'You' ? 'Player' : st.profile.display_name,
    avatar: st.profile.avatar ?? '⚽',
    points: s.total_points,
    week: wk?.points ?? 0,
    wk: pts.current_week,
    correct: s.picks_correct,
    settled: s.picks_settled,
    streak: s.current_streak,
    at: Math.floor(Date.now() / 1000),
  };
}

async function privateLeagues() {
  const me = await myCard();
  await pl.refreshMine(me);
  const list = await pl.leagues();
  return {
    me,
    week: me.wk,
    leagues: list.map((l) => {
      const season = pl.table(Object.values(l.members), me.wk, 'season');
      return { code: l.code, name: l.name, created_at: l.created_at, members: season, week_table: pl.table(Object.values(l.members), me.wk, 'week'), my_rank: season.find((r) => r.id === me.id)?.rank ?? null };
    }),
  };
}

async function shareLeague(code: string) {
  const me = await myCard();
  await pl.refreshMine(me);
  const l = (await pl.leagues()).find((x) => x.code === pl.normaliseCode(code));
  if (!l) throw new ApiError(404, 'not_found', 'League not found');
  // my fresh card first, then everyone else's latest
  const cards = [me, ...Object.values(l.members).filter((c) => c.id !== me.id).sort((a, b) => b.at - a.at)];
  const url = pl.linkFor(pl.encodeLeague(l, cards));
  const rank = pl.table(cards, me.wk).find((r) => r.id === me.id)?.rank;
  const text = `🏆 MK Sports league "${l.name}" (code ${l.code})\n${me.avatar} ${me.name}: ${me.points} pts${rank ? ` · #${rank} of ${cards.length}` : ''}\nTap to join or update the table: ${url}\n\nFree to play, no money involved.`;
  return { url, text, code: l.code, name: l.name };
}

/** Everything the game screens need: level, you vs the AI, streaks, badges, results to celebrate. */
async function gameSummary() {
  const st = await game.loadGame();
  const s = game.stats(st);
  const brief = (p: game.LocalPick) => ({
    match_id: p.matchId, sport: p.sport, league: p.league, kickoff: p.kickoff, home: p.homeName, away: p.awayName,
    home_code: p.homeCode, away_code: p.awayCode, home_color: p.homeColor, away_color: p.awayColor, home_logo: p.homeLogo ?? null, away_logo: p.awayLogo ?? null,
    pick: p.pick, ai_pick: p.ai_pick, status: p.status, points: p.points, final_score: p.final_score, exact_score: p.exact_score, banker: !!p.banker,
  });
  const settled = Object.values(st.picks).filter((p) => p.status !== 'pending').sort((a, b) => (b.settled_at ?? b.kickoff).localeCompare(a.settled_at ?? a.kickoff));
  return {
    consented: !!st.profile.consented_at,
    display_name: st.profile.display_name,
    level: game.levelFor(s.total_points),
    stats: s,
    vs_ai: game.vsAI(st),
    badges: game.BADGES.map((b) => ({ ...b, awarded_at: st.badges[b.slug] ?? null })),
    unseen: game.unseenResults(st).map(brief),
    recent: settled.slice(0, 12).map(brief),
    pending: Object.values(st.picks).filter((p) => p.status === 'pending').sort((a, b) => a.kickoff.localeCompare(b.kickoff)).map(brief),
    banker: (() => {
      const b = game.bankerOfWeek(st, game.weekKey(new Date()));
      return b ? brief(b) : null;
    })(),
    seasons: game.seasonArchive(st),
  };
}

async function myPicks(q: URLSearchParams) {
  const st = await game.loadGame();
  const status = q.get('status') ?? 'all';
  const limit = Number(q.get('limit') ?? 20);
  const offset = Number(q.get('cursor') ?? 0) || 0;
  const list = Object.values(st.picks)
    .filter((p) => status === 'all' || (status === 'pending' ? p.status === 'pending' : p.status !== 'pending'))
    .sort((a, b) => b.kickoff.localeCompare(a.kickoff));
  const page = list.slice(offset, offset + limit).map((p) => {
    const ev = events.get(p.matchId);
    const match = ev
      ? card(ev, false)
      : {
          id: p.matchId,
          sport: p.sport,
          league: leagueMini(p.league),
          start_time: p.kickoff,
          status: p.status === 'pending' ? 'scheduled' : p.status === 'void' ? 'cancelled' : 'finished',
          clock: p.final_score ? 'FT' : null,
          round: null,
          home: { id: `${p.matchId}-h`, name: p.homeName, short_name: p.homeName, code: p.homeCode, color: p.homeColor, logo: p.homeLogo ?? null },
          away: { id: `${p.matchId}-a`, name: p.awayName, short_name: p.awayName, code: p.awayCode, color: p.awayColor, logo: p.awayLogo ?? null },
          home_score: p.final_score?.[0] ?? null,
          away_score: p.final_score?.[1] ?? null,
          prediction: null,
          my_pick: null,
          locked: Date.parse(p.kickoff) <= Date.now(),
        };
    return { match, pick: { pick: p.pick, home_score: p.home_score, away_score: p.away_score, status: p.status, points: p.points }, created_at: p.created_at };
  });
  return { items: page, next_cursor: offset + limit < list.length ? String(offset + limit) : null };
}

/** Settle picks whose matches finished while the app was closed. */
export async function settlePending(): Promise<void> {
  const st = await game.loadGame();
  const pending = Object.values(st.picks).filter((p) => p.status === 'pending' && Date.parse(p.kickoff) < Date.now());
  const byLeague = new Map<string, number[]>();
  for (const p of pending) byLeague.set(p.league, [...(byLeague.get(p.league) ?? []), Date.parse(p.kickoff)]);
  await Promise.allSettled([...byLeague.entries()].map(([slug, ts]) => fetchLeague(slug, Math.min(...ts) - DAY, Math.max(...ts) + DAY)));
}

/** Same rule as the pipeline (mkmodel.production.record_check), for files published before it existed. */
export function recordCheck(n: number, live: number | null, expected: number | null): import('@/api/types').RecordCheck {
  const MIN = 100;
  if (!expected || !n || live === null) return { status: 'no_data', n: n ?? 0, expected, band: null, min_n: MIN, message: 'No graded matches yet.' };
  const band = 1.96 * Math.sqrt((expected * (1 - expected)) / n);
  const range = `${((expected - band) * 100).toFixed(1)}–${((expected + band) * 100).toFixed(1)}%`;
  const status = n < MIN ? 'too_few' : live < expected - band ? 'below' : live > expected + band ? 'above' : 'within';
  const message =
    status === 'too_few'
      ? `${n} graded matches: chance alone moves the hit rate by about ±${Math.round(band * 100)} points, so it is too early to judge.`
      : `Live hit rate ${(live * 100).toFixed(1)}% over ${n} matches is ${status === 'within' ? 'within' : status} the tested range (${range}).`;
  return { status, n, live, expected, band, min_n: MIN, message };
}

async function accuracy(q: URLSearchParams) {
  const source = q.get('source') ?? 'all';
  const sportFilter = q.get('sport');
  type Item = { sport: string; league: string; correct: boolean; brier: number; logLoss: number; confidence: string };
  const items: Item[] = [];
  const perSource: Record<string, { n: number; correct: number; brier: number; ll: number }> = {};
  const addSource = (s: string, p: Probs, o: Outcome) => {
    const a = (perSource[s] ??= { n: 0, correct: 0, brier: 0, ll: 0 });
    const r = scorePrediction(p, o === 'home' ? 1 : 0, o === 'away' ? 1 : 0);
    a.n += 1;
    a.correct += r.correct ? 1 : 0;
    a.brier += r.brier;
    a.ll += r.logLoss;
  };
  const sports = PREDICTED_SPORTS.filter((s) => (!sportFilter || s === sportFilter) && (sportFilter || s === 'football' || s === 'basketball' || sportReady(s)));
  // football: the published tracker (every pipeline prediction graded + its backtest) replaces on-device numbers
  const ra = remoteAccuracy();
  const fbRemote = !!ra && sports.includes('football');
  for (const sp of sports) {
    if (fbRemote && sp === 'football') continue;
    if (!sportReady(sp)) await ensureSport(sp);
    if (source !== 'live') {
      for (const r of (getBacktest(sp) ?? backtest(sp)).records) {
        const s = scorePrediction(r.model, r.outcome === 'home' ? 1 : 0, r.outcome === 'away' ? 1 : 0);
        items.push({ sport: sp, league: r.league, correct: s.correct, brier: s.brier, logLoss: s.logLoss, confidence: r.confidence });
        addSource('model', r.model, r.outcome);
        if (r.market) addSource('market', r.market, r.outcome);
      }
    }
  }
  const live = liveEvaluations().filter((e) => sports.includes(e.sport) && !(fbRemote && e.sport === 'football'));
  if (source !== 'backtest') {
    for (const e of live) {
      const s = scorePrediction(e.blended, e.outcome === 'home' ? 1 : 0, e.outcome === 'away' ? 1 : 0);
      items.push({ sport: e.sport, league: e.league, correct: s.correct, brier: s.brier, logLoss: s.logLoss, confidence: e.confidence });
      for (const [k, p] of Object.entries(e.sources)) addSource(`${k}:live`, p!, e.outcome);
      addSource('blended:live', e.blended, e.outcome);
    }
  }
  const row = (key: string, name: string, sport: string, list: Item[]) => {
    const n = list.length;
    const conf: Record<string, { n: number; hit_rate: number }> = {};
    for (const c of ['high', 'medium', 'low']) {
      const l = list.filter((x) => x.confidence === c);
      if (l.length) conf[c] = { n: l.length, hit_rate: l.filter((x) => x.correct).length / l.length };
    }
    return {
      key,
      name,
      sport,
      n,
      correct: list.filter((x) => x.correct).length,
      hit_rate: n ? list.filter((x) => x.correct).length / n : null,
      brier: n ? list.reduce((s, x) => s + x.brier, 0) / n : null,
      log_loss: n ? list.reduce((s, x) => s + x.logLoss, 0) / n : null,
      by_confidence: conf,
    };
  };
  const weights = Object.fromEntries(sports.filter((sp) => !(fbRemote && sp === 'football')).map((sp) => [sp, sourceStats(sp)]));
  type Row = ReturnType<typeof row>;
  const fromAgg = (key: string, name: string, sport: string, a: Partial<AccAgg> & { n: number }): Row => ({
    key, name, sport, n: a.n, correct: a.correct ?? Math.round((a.hit_rate ?? 0) * a.n), hit_rate: a.hit_rate ?? null, brier: a.brier ?? null, log_loss: a.log_loss ?? null,
    by_confidence: (a.by_confidence ?? {}) as Row['by_confidence'],
  });
  const combine = (key: string, name: string, sport: string, rows: Row[]): Row => {
    const rs = rows.filter((r) => r.n);
    const n = rs.reduce((x, r) => x + r.n, 0);
    const w = (f: (r: Row) => number | null) => (n ? rs.reduce((x, r) => x + (f(r) ?? 0) * r.n, 0) / n : null);
    const conf: Row['by_confidence'] = {};
    for (const c of ['high', 'medium', 'low'] as const) {
      const parts = rs.map((r) => r.by_confidence[c]).filter((b): b is { n: number; hit_rate: number } => !!b);
      const m = parts.reduce((x, b) => x + b.n, 0);
      if (m) conf[c] = { n: m, hit_rate: parts.reduce((x, b) => x + b.hit_rate * b.n, 0) / m };
    }
    return { key, name, sport, n, correct: rs.reduce((x, r) => x + r.correct, 0), hit_rate: w((r) => r.hit_rate), brier: w((r) => r.brier), log_loss: w((r) => r.log_loss), by_confidence: conf };
  };
  const fbLeagues: Row[] = [];
  if (fbRemote) {
    for (const l of MATCH_LEAGUES.filter((x) => x.sport === 'football')) {
      const lv = ra!.live.competitions[l.slug];
      const bt = ra!.backtest?.competitions[l.slug];
      const liveRow = lv && lv.n ? fromAgg(l.slug, l.name, 'football', lv) : null;
      const btRow = bt ? fromAgg(l.slug, l.name, 'football', { n: bt.n, hit_rate: bt.new.accuracy, log_loss: bt.new.log_loss, brier: bt.new.brier }) : null;
      const pick = source === 'live' ? [liveRow] : source === 'backtest' ? [btRow] : [liveRow, btRow];
      const r = combine(l.slug, l.name, 'football', pick.filter((x): x is Row => !!x));
      if (r.n) fbLeagues.push(r);
    }
  }
  const deviceSports = sports.filter((sp) => !(fbRemote && sp === 'football')).map((sp) => row(sp, sportOf(sp)!.name, sp, items.filter((i) => i.sport === sp)));
  const sportRows = [...(fbRemote ? [combine('football', sportOf('football')!.name, 'football', fbLeagues)] : []), ...deviceSports].filter((r) => r.n);
  const fbRecent = fbRemote && source !== 'backtest'
    ? ra!.live.recent.map((g) => ({ match_id: g.match_id, home: g.home, away: g.away, score: g.score, predicted: g.pick, probability: g.probability, correct: !!g.correct, confidence: g.confidence_label }))
    : [];
  const btAll = ra?.backtest?.competitions['all'];
  const fbSources = fbRemote && btAll && source !== 'live'
    ? [
        { source: 'model', kind: 'backtest', label: 'MK Sports model (football)', n: btAll.n, hit_rate: btAll.new.accuracy, brier: btAll.new.brier, log_loss: btAll.new.log_loss },
        ...(btAll.previous ? [{ source: 'previous', kind: 'backtest', label: 'Previous engine (football)', n: btAll.n, hit_rate: btAll.previous.accuracy, brier: btAll.previous.brier, log_loss: btAll.previous.log_loss }] : []),
        ...(btAll.bookmaker ? [{ source: 'market', kind: 'backtest', label: 'Bookmaker closing odds (football)', n: btAll.n, hit_rate: btAll.bookmaker.accuracy, brier: btAll.bookmaker.brier, log_loss: btAll.bookmaker.log_loss }] : []),
      ]
    : [];
  const footballBacktest = fbRemote && ra!.backtest
    ? MATCH_LEAGUES.filter((l) => ra!.backtest!.competitions[l.slug]).map((l) => {
        const c = ra!.backtest!.competitions[l.slug];
        return { key: l.slug, name: l.name, n: c.n, new_log_loss: c.new.log_loss, previous_log_loss: c.previous?.log_loss ?? null, bookmaker_log_loss: c.bookmaker?.log_loss ?? null };
      })
    : [];
  return {
    source,
    updated_at: new Date().toISOString(),
    overall: combine('all', 'All sports', 'all', [row('all', 'All sports', 'all', items), ...fbLeagues]),
    sports: sportRows,
    leagues: [...fbLeagues, ...MATCH_LEAGUES.filter((l) => !(fbRemote && l.sport === 'football')).map((l) => row(l.slug, l.name, l.sport, items.filter((i) => i.league === l.slug))).filter((r) => r.n)],
    football_backtest: footballBacktest,
    football_note: fbRemote ? ra!.note : null,
    football_track: fbRemote ? ra!.track_record ?? null : null,
    football_quality: fbRemote && ra!.track_record
      ? {
          backtest_n: ra!.track_record.all_matches.n,
          rps: ra!.track_record.rps ?? null,
          bookmaker_rps: ra!.track_record.bookmaker_rps ?? null,
          model_rps_same_matches: ra!.track_record.model_rps_same_matches ?? null,
          live_rps: ra!.live.overall.rps ?? null,
          live_n: ra!.live.overall.n,
          calibration: ra!.track_record.pick_calibration ?? [],
          record: ra!.live.record_check ?? recordCheck(ra!.live.overall.n, ra!.live.overall.hit_rate, ra!.track_record.all_matches.hit_rate),
        }
      : null,
    recent: [...fbRecent, ...live.slice(0, 10).map((e) => ({ match_id: e.id, home: e.home, away: e.away, score: e.score, predicted: argmax(e.blended), probability: Math.max(...Object.values(e.blended).map(Number)), correct: argmax(e.blended) === e.outcome, confidence: e.confidence }))].slice(0, 20),
    by_source: [...fbSources, ...Object.entries(perSource).map(([k, v]) => {
      const [src, kind] = k.split(':');
      const info = (SOURCE_INFO as Record<string, { label: string }>)[src];
      return { source: src, kind: kind ?? 'backtest', label: src === 'blended' ? 'MK Sports (blended)' : info?.label ?? src, n: v.n, hit_rate: v.correct / v.n, brier: v.brier / v.n, log_loss: v.ll / v.n };
    })],
    source_evidence: weights,
    baseline_note:
      'Backtest = every match of the last 12 months predicted only from results before it (cold starts skipped). Live = forecasts this phone saved before kick-off, scored after the final whistle. Hit rate = share of matches where the most likely outcome happened; Brier score and log loss measure probability quality (lower is better).',
  };
}

// ------------------------------------------------------------------ match centre, players, stats, news
async function matchCentre(id: string) {
  const ids = espn.splitEventId(id);
  if (!ids || !LEAGUE_BY_SLUG[ids.league]) throw new ApiError(404, 'not_found', 'Match not found');
  let ev = events.get(id);
  if (!ev) {
    const sum = await espn.summary(id, 60).catch(() => null);
    if (!sum?.event) throw new OfflineError("Can't reach the live data source");
    ev = sum.event;
  }
  const ttl = ev.status === 'live' ? 20 : ev.status === 'scheduled' ? 300 : 1800;
  try {
    const c = await centreApi.centre(ids.league, ids.espnId, ttl, ev.sport, ev.home.espnId, ev.home.name);
    return { ...c, match_id: id, sport: ev.sport, status: ev.status, clock: ev.clock, home: teamMini(ev.home), away: teamMini(ev.away), home_score: ev.homeScore, away_score: ev.awayScore, xg_model: { shots: XG_MODEL.shots, matches: XG_MODEL.matches } };
  } catch (e) {
    if (e instanceof SourceError) throw new ApiError(502, 'source_unavailable', e.message);
    throw new OfflineError();
  }
}

async function player(id: string, q: URLSearchParams) {
  const league = q.get('league') ?? '';
  if (!LEAGUE_BY_SLUG[league]) throw new ApiError(400, 'bad_request', 'league is required');
  let page: centreApi.PlayerPage;
  try {
    page = await centreApi.playerPage(league, id);
  } catch (e) {
    if (e instanceof SourceError && e.status === 404) throw new ApiError(404, 'not_found', 'Player not found');
    if (e instanceof SourceError) throw new ApiError(502, 'source_unavailable', e.message);
    throw new OfflineError();
  }
  let thisMatch: centreApi.LineupPlayer | null = null;
  const matchId = q.get('match');
  if (matchId) {
    const c = (await matchCentre(matchId).catch(() => null)) as Awaited<ReturnType<typeof matchCentre>> | null;
    const all = c?.lineups ? [c.lineups.home, c.lineups.away].flatMap((l) => [...l.rows.flat(), ...l.bench]) : [];
    thisMatch = all.find((p) => p.id === id) ?? null;
  }
  const teamLogo = page.team ? teamInfo(LEAGUE_BY_SLUG[league].sport as SportSlug, page.team.espnId)?.logo ?? page.team.logo : null;
  return { ...page, team: page.team ? { ...page.team, id: `${LEAGUE_BY_SLUG[league].sport}:${page.team.espnId}`, logo: teamLogo } : null, this_match: thisMatch, league };
}

async function leagueLeaders(slug: string) {
  const lg = LEAGUE_BY_SLUG[slug];
  if (!lg) throw new ApiError(404, 'not_found', 'League not found');
  const out: { key: string; label: string; team_stat: boolean; rows: { rank: number; athlete_id: string | null; name: string; position: string | null; headshot: string | null; team: ReturnType<typeof teamMini> | null; value: string }[] }[] = [];
  if (lg.leaders) {
    try {
      for (const c of await more.leaders(slug, 5)) {
        out.push({ key: c.key, label: c.label, team_stat: false, rows: c.rows.map((r) => ({ rank: r.rank, athlete_id: r.athleteId || null, name: r.name, position: r.position, headshot: r.headshot, team: r.team ? teamMini(teamInfo(lg.sport as SportSlug, r.team.espnId) ?? r.team) : null, value: r.value })) });
      }
    } catch {
      /* falls back to the team numbers below */
    }
  }
  // team clean sheets / goals from this season's real results
  if (lg.sport === 'football' && lg.format === 'match') {
    if (!sportReady('football')) await ensureSport('football');
    const season = await espn.currentSeason(slug);
    const since = season?.start ? Date.parse(season.start) : Date.now() - 300 * DAY;
    const per = new Map<string, { cs: number; gf: number; ga: number; p: number }>();
    for (const m of sportMatches('football')) {
      if (m.league !== slug || m.date.getTime() < since) continue;
      for (const [t, f, a] of [
        [m.home, m.homeScore, m.awayScore],
        [m.away, m.awayScore, m.homeScore],
      ] as const) {
        const r = per.get(t) ?? { cs: 0, gf: 0, ga: 0, p: 0 };
        r.p += 1;
        r.gf += f;
        r.ga += a;
        if (a === 0) r.cs += 1;
        per.set(t, r);
      }
    }
    const rows = (key: 'cs' | 'gf' | 'ga', asc = false) =>
      [...per.entries()]
        .map(([t, r]) => ({ t, r, info: teamInfo('football', t) }))
        .filter((x) => x.info)
        .sort((a, b) => (asc ? a.r[key] - b.r[key] : b.r[key] - a.r[key]) || a.r.p - b.r.p)
        .slice(0, 5)
        .map((x, i) => ({ rank: i + 1, athlete_id: null, name: x.info!.name, position: null, headshot: null, team: teamMini(x.info!), value: `${x.r[key]} in ${x.r.p}` }));
    if (per.size) {
      out.push({ key: 'cleanSheets', label: 'Clean sheets (team)', team_stat: true, rows: rows('cs') });
      out.push({ key: 'teamGoals', label: 'Goals scored (team)', team_stat: true, rows: rows('gf') });
      out.push({ key: 'bestDefence', label: 'Fewest conceded (team)', team_stat: true, rows: rows('ga', true) });
    }
  }
  return { league: slug, season: seasons.get(slug) ?? null, categories: out };
}

async function newsFeed(q: URLSearchParams) {
  const leagues = idsParam(q, 'leagues').filter((l) => LEAGUE_BY_SLUG[l]);
  const list = leagues.length ? leagues : MATCH_LEAGUES.filter((l) => l.featured).map((l) => l.slug);
  const team = q.get('team');
  const teamLeague = q.get('team_league');
  const limit = Math.min(60, Number(q.get('limit') ?? 30));
  const teamEspn = team?.split(':')[1] ?? null;
  const jobs: Promise<more.Article[]>[] = list.slice(0, 8).map((l) => more.news(l, null, 15));
  if (teamEspn && teamLeague && LEAGUE_BY_SLUG[teamLeague]) jobs.unshift(more.news(teamLeague, teamEspn, 15));
  const res = await Promise.allSettled(jobs);
  if (res.every((r) => r.status === 'rejected')) throw new OfflineError("Can't reach the news source");
  const seen = new Set<string>();
  const items: (more.Article & { my_team: boolean })[] = [];
  res.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    for (const a of r.value) {
      const k = a.headline.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      items.push({ ...a, my_team: !!teamEspn && (a.teamIds.includes(teamEspn) || (i === 0 && !!teamLeague)) });
    }
  });
  items.sort((a, b) => b.published.localeCompare(a.published));
  return { items: items.slice(0, limit), my_team: items.filter((a) => a.my_team).slice(0, 10) };
}

async function teamHub(id: string, q: URLSearchParams) {
  const [sport, espnId] = id.split(':') as [SportSlug, string];
  if (!sportOf(sport) || !espnId || !MATCH_LEAGUES.some((l) => l.sport === sport)) throw new ApiError(404, 'not_found', 'Team not found');
  const given = idsParam(q, 'leagues').filter((l) => LEAGUE_BY_SLUG[l]?.sport === sport && LEAGUE_BY_SLUG[l].format === 'match');
  let info: TeamInfo | null = teamInfo(sport, espnId);
  // every competition the team is entered in (team lists are cached for a week)
  const cands = MATCH_LEAGUES.filter((l) => l.sport === sport);
  const lists = await Promise.allSettled(cands.map((l) => espn.teams(l.slug)));
  const found = cands
    .filter((l, i) => {
      const r = lists[i];
      if (r.status !== 'fulfilled') return false;
      const t = r.value.find((x) => x.espnId === espnId);
      if (t && !info) info = t;
      return !!t;
    })
    .map((l) => l.slug);
  const leagueIds = [...new Set([...given, ...found])].sort((a, b) => MATCH_LEAGUES.findIndex((l) => l.slug === a) - MATCH_LEAGUES.findIndex((l) => l.slug === b));
  if (!leagueIds.length) throw new ApiError(404, 'not_found', 'Team not found');
  const primary = given.find((l) => LEAGUE_BY_SLUG[l].kind === 'league') ?? leagueIds.find((l) => LEAGUE_BY_SLUG[l].kind === 'league') ?? leagueIds[0];
  const now = Date.now();
  const evs = await fetchLeagues(leagueIds, now - 45 * DAY, now + 45 * DAY);
  const mine = [...new Map(evs.filter((e) => e.home.id === id || e.away.id === id).map((e) => [e.id, e])).values()];
  const fromEv = mine[0] ? (mine[0].home.id === id ? mine[0].home : mine[0].away) : null;
  const t = fromEv ? { ...fromEv, logo: fromEv.logo ?? info?.logo ?? null } : info;
  if (!t) throw new ApiError(404, 'not_found', 'Team not found');
  const upcoming = mine.filter((e) => e.status === 'scheduled' || e.status === 'live').sort((a, b) => a.start.localeCompare(b.start));
  const recent = mine.filter((e) => e.status === 'finished').sort((a, b) => b.start.localeCompare(a.start));
  const [table, articles, ld, sq] = await Promise.all([
    standingsRows(primary).catch(() => []),
    more.news(primary, espnId, 12).catch(() => [] as more.Article[]),
    LEAGUE_BY_SLUG[primary].leaders ? leagueLeaders(primary).catch(() => null) : Promise.resolve(null),
    more.squad(primary, espnId).catch(() => [] as more.SquadPlayer[]),
  ]);
  const idx = table.findIndex((r) => r.team.id === id);
  const entry = bookFor(sport);
  const st = entry?.book.teamState(id);
  return {
    team: teamMini(t),
    sport,
    league: leagueOut(LEAGUE_BY_SLUG[primary]),
    leagues: leagueIds.map((l) => leagueOut(LEAGUE_BY_SLUG[l])),
    standing: idx >= 0 ? table[idx] : null,
    table: idx >= 0 ? table.filter((r) => r.group === table[idx].group) : [],
    upcoming: upcoming.slice(0, 6).map((e) => card(e)),
    recent: recent.slice(0, 8).map((e) => card(e, false)),
    form: st ? st.recent.slice(0, 5).map((r) => r.result).join('') : '',
    elo: st && st.games ? Math.round(st.elo) : null,
    news: articles,
    leaders: (ld?.categories ?? []).filter((c) => !c.team_stat).map((c) => ({ ...c, rows: c.rows.filter((r) => r.team?.id === id) })).filter((c) => c.rows.length),
    squad: sq,
  };
}

// ------------------------------------------------------------------ router
export async function handleLocal(method: string, fullPath: string, body: any): Promise<unknown> {
  await Promise.all([game.loadGame(), storesReady()]);
  clubEloFixtures().catch(() => undefined); // best effort, refreshes hourly
  ensureRemoteLoaded(); // the built-in snapshot, until a newer file is saved or downloaded
  refreshRemote().catch(() => undefined); // published football predictions, best effort, every 15 min
  const [path, q] = parseQuery(fullPath);
  const seg = path.split('/').filter(Boolean);

  if (method === 'GET') {
    if (path === '/meta') return { app: 'MK Sports', mode: 'device', disclaimer: DISCLAIMER, free_to_play: true, shows_odds: false, age_gate_required: false, sources: ['MK Sports model (football: football-data.co.uk, openfootball)', 'ESPN (fixtures, scores, other sports)'] };
    if (path === '/sports') return SPORTS.filter((s) => q.get('include_inactive') === 'true' || s.active).map(sportOut);
    if (path === '/leagues') return LEAGUES.filter((l) => (!q.get('sport') || l.sport === q.get('sport')) && (q.get('format') !== 'match' || l.format === 'match')).map(leagueOut);
    if (seg[0] === 'leagues' && seg.length === 2) {
      const l = LEAGUE_BY_SLUG[seg[1]];
      if (!l) throw new ApiError(404, 'not_found', 'League not found');
      return { ...leagueOut(l), color: sportOf(l.sport)!.color, history_loaded: !!loadedHistory(l.slug), error: historyError(l.slug) };
    }
    if (seg[0] === 'leagues' && seg[2] === 'standings') return standingsRows(seg[1]);
    if (path === '/teams') return teamsSearch(q);
    if (seg[0] === 'teams' && seg.length === 2) return teamHub(decodeURIComponent(seg[1]), q);
    if (seg[0] === 'leagues' && seg[2] === 'leaders') return leagueLeaders(seg[1]);
    if (seg[0] === 'matches' && seg[2] === 'centre') return matchCentre(decodeURIComponent(seg[1]));
    if (seg[0] === 'players' && seg.length === 2) return player(decodeURIComponent(seg[1]), q);
    if (path === '/news') return newsFeed(q);
    if (seg[0] === 'tennis' && (seg[1] === 'atp' || seg[1] === 'wta')) return seg[2] === 'rankings' ? more.tennisRankings(seg[1]) : more.tennis(seg[1]);
    if (path === '/f1') return more.f1();
    if (path === '/f1/standings') return more.f1Standings();
    if (path === '/cricket') return more.cricket();
    if (path === '/feed') return feed(q);
    if (path === '/matches') return matches(q);
    if (path === '/predictions') return predictionsList(q);
    if (path === '/model/record') return modelRecord();
    if (path === '/matches/live') {
      const now = Date.now();
      const wanted = idsParam(q, 'leagues').filter((l) => LEAGUE_BY_SLUG[l]?.format === 'match');
      const all = await fetchLeagues(
        wanted.length ? wanted : MATCH_LEAGUES.filter((l) => l.featured).map((l) => l.slug),
        now - DAY,
        now + DAY,
      );
      return all.filter((e) => e.status === 'live').map((e) => card(e, false));
    }
    if (seg[0] === 'matches' && seg.length === 2) return matchDetail(decodeURIComponent(seg[1]));
    if (path === '/me') return me();
    if (path === '/me/picks') return myPicks(q);
    if (path === '/me/game') return gameSummary();
    if (path === '/pleagues') return privateLeagues();
    if (seg[0] === 'pleagues' && seg[2] === 'share') return shareLeague(seg[1]);
    if (path === '/me/export') {
      const st = await game.loadGame();
      return { profile: st.profile, picks: Object.values(st.picks), badges: st.badges, exported_at: new Date().toISOString() };
    }
    if (path === '/picks') {
      const ids = idsParam(q, 'match_ids');
      const st = await game.loadGame();
      return ids.map((id) => st.picks[id]).filter(Boolean);
    }
    if (path === '/local/points') return game.pointsByPeriod(await game.loadGame());
    if (path === '/accuracy') return accuracy(q);
    if (path === '/auth/config') return { mode: 'device', methods: [] };
  }
  if (method === 'PUT' && seg[0] === 'picks') {
    const id = decodeURIComponent(seg[1]);
    let ev = events.get(id);
    if (!ev) {
      const d = await matchDetail(id);
      ev = events.get(id) ?? undefined;
      if (!ev) throw new ApiError(404, 'not_found', `Match ${d.id} not found`);
    }
    try {
      const p = predictEvent(ev);
      const { pick, newBadges } = await game.makePick(ev, body ?? {}, p ? argmax(p.probabilities) : null);
      notify();
      return { match_id: id, pick: pick.pick, home_score: pick.home_score, away_score: pick.away_score, status: pick.status, points: pick.points, result_correct: null, exact_score: false, locks_at: ev.start, new_badges: newBadges, banker: !!pick.banker };
    } catch (e) {
      if (e instanceof game.PickError) throw new ApiError(e.status, e.code, e.message, { code: e.code, message: e.message });
      throw e;
    }
  }
  if (method === 'DELETE' && seg[0] === 'picks') {
    const id = decodeURIComponent(seg[1]);
    const ev = events.get(id);
    if (!ev) throw new ApiError(404, 'not_found', 'Match not found');
    try {
      await game.deletePick(ev);
      notify();
      return null;
    } catch (e) {
      if (e instanceof game.PickError) throw new ApiError(e.status, e.code, e.message, { code: e.code, message: e.message });
      throw e;
    }
  }
  if (method === 'PATCH' && path === '/me') {
    await game.updateProfile({
      ...(body?.display_name ? { display_name: String(body.display_name).slice(0, 40) } : {}),
      ...(body?.country ? { country: body.country } : {}),
      ...(body?.avatar && game.AVATARS.includes(String(body.avatar)) ? { avatar: String(body.avatar) } : {}),
    });
    return me();
  }
  if (method === 'POST' && path === '/pleagues') {
    const l = await pl.create(String(body?.name ?? ''), await myCard());
    notify();
    return { code: l.code };
  }
  if (method === 'POST' && path === '/pleagues/join') {
    try {
      const l = await pl.join(String(body?.code ?? ''), body?.name ? String(body.name) : null, await myCard());
      notify();
      return { code: l.code };
    } catch (e) {
      throw new ApiError(400, 'bad_code', e instanceof Error ? e.message : 'Invalid code');
    }
  }
  if (method === 'POST' && path === '/pleagues/link') {
    try {
      const d = pl.decodeLeague(String(body?.data ?? ''));
      const before = (await pl.leagues()).some((x) => x.code === d.code);
      const l = await pl.join(d.code, d.name, await myCard(), d.cards);
      notify();
      return { code: l.code, name: l.name, joined: !before, members: Object.keys(l.members).length };
    } catch (e) {
      throw new ApiError(400, 'bad_link', e instanceof Error ? e.message : 'This link could not be read');
    }
  }
  if (method === 'DELETE' && seg[0] === 'pleagues' && seg[1]) {
    await pl.leave(seg[1]);
    notify();
    return { ok: true };
  }
  if (method === 'POST' && path === '/me/game/seen') {
    await game.markSeen(Array.isArray(body?.ids) ? body.ids.map(String) : []);
    notify();
    return gameSummary();
  }
  if (method === 'POST' && path === '/me/consent') {
    await game.updateProfile({ consented_at: new Date().toISOString() });
    return me();
  }
  if (method === 'PUT' && path === '/me/favourites') return me();
  if (method === 'DELETE' && path === '/me') {
    // "Delete my data": picks, profile and saved forecasts (public match history is kept)
    await game.resetGame();
    await clearPredictionStores();
    notify();
    return null;
  }
  throw new ApiError(404, 'not_found', `No such endpoint: ${method} ${path}`);
}

export { historyVersion };
