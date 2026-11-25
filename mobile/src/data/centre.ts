/**
 * Match centre: line-ups in formation, live team statistics (with the app's own xG from shot
 * positions), the match timeline and per-player numbers, all from ESPN's match summary.
 * Player pages: season statistics by competition, the last five matches and bio.
 */
import { ShotEvent, teamXg } from '@/engine/xg';

import { get } from './http';
import { LEAGUE_BY_SLUG, SportSlug } from './leagues';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
const WEB = 'https://site.web.api.espn.com/apis/common/v3/sports';

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

export function summaryUrl(league: string, espnId: string) {
  const lg = LEAGUE_BY_SLUG[league];
  return `${SITE}/${lg.espnSport}/${lg.slug}/summary?event=${espnId}`;
}

// ------------------------------------------------------------------ line-ups
export type LineupPlayer = {
  id: string;
  name: string;
  short: string;
  jersey: string | null;
  position: string; // ESPN abbreviation (G, CD-L, AM-R, F, SUB...)
  positionName: string | null;
  place: number; // formation place (1 = goalkeeper), 0 for substitutes
  starter: boolean;
  headshot: string | null;
  subbedIn: string | null; // minute, e.g. "68'"
  subbedOut: string | null;
  goals: number;
  assists: number;
  ownGoals: number;
  yellow: boolean;
  red: boolean;
  stats: Record<string, number>; // this match: G, A, SHOT, SOG, FC, FA, YC, RC, SV, GA, OFF...
};

export type Lineup = { side: 'home' | 'away'; teamId: string; formation: string | null; rows: LineupPlayer[][]; bench: LineupPlayer[]; color: string | null };

function depthOf(pos: string): number {
  const p = pos.toUpperCase();
  if (p === 'G' || p === 'GK') return 0;
  if (p.startsWith('LWB') || p.startsWith('RWB') || p === 'WB') return 1.5;
  if (p.startsWith('CD') || p.startsWith('CB') || p === 'RB' || p === 'LB' || p === 'D' || p === 'SW') return 1;
  if (p.startsWith('DM') || p === 'CDM') return 2;
  if (p.startsWith('CM') || p === 'LM' || p === 'RM' || p === 'M') return 3;
  if (p.startsWith('AM') || p === 'LW' || p === 'RW' || p === 'CAM') return 4;
  if (p.startsWith('CF') || p === 'F' || p === 'ST' || p === 'S' || p === 'SS') return 5;
  return 3;
}

/** Left-to-right order from the player's own point of view (L = left). */
function lateralOf(pos: string): number {
  const p = pos.toUpperCase();
  if (/^L/.test(p)) return -2;
  if (/^R/.test(p)) return 2;
  if (p.endsWith('-L')) return -1;
  if (p.endsWith('-R')) return 1;
  return 0;
}

/** Starters arranged in rows from the goalkeeper forward, following the formation string. */
export function formationRows(starters: LineupPlayer[], formation: string | null): LineupPlayer[][] {
  const gk = starters.filter((p) => depthOf(p.position) === 0 || p.place === 1).slice(0, 1);
  const outfield = starters.filter((p) => !gk.includes(p));
  const sorted = [...outfield].sort((a, b) => depthOf(a.position) - depthOf(b.position) || lateralOf(a.position) - lateralOf(b.position) || a.place - b.place);
  const lines = (formation ?? '')
    .split('-')
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n) && n > 0);
  let rows: LineupPlayer[][];
  if (lines.length && lines.reduce((s, n) => s + n, 0) === sorted.length) {
    rows = [];
    let i = 0;
    for (const n of lines) {
      rows.push(sorted.slice(i, i + n));
      i += n;
    }
  } else {
    const byDepth = new Map<number, LineupPlayer[]>();
    for (const p of sorted) byDepth.set(Math.floor(depthOf(p.position)), [...(byDepth.get(Math.floor(depthOf(p.position))) ?? []), p]);
    rows = [...byDepth.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
  }
  rows = rows.map((r) => [...r].sort((a, b) => lateralOf(a.position) - lateralOf(b.position) || a.place - b.place));
  return gk.length ? [gk, ...rows] : rows;
}

function parsePlayer(p: any): LineupPlayer {
  const a = p?.athlete ?? {};
  const stats: Record<string, number> = {};
  for (const s of p?.stats ?? []) {
    const v = num(s?.value ?? s?.displayValue);
    if (s?.abbreviation && v !== null) stats[s.abbreviation] = v;
  }
  const plays: any[] = p?.plays ?? [];
  const subPlay = plays.find((x) => x?.substitution);
  const pos = p?.position?.abbreviation ?? (p?.starter ? 'M' : 'SUB');
  return {
    id: String(a?.id ?? ''),
    name: a?.displayName ?? a?.fullName ?? 'Unknown',
    short: a?.shortName ?? a?.displayName ?? '',
    jersey: p?.jersey ?? a?.jersey ?? null,
    position: pos,
    positionName: p?.position?.displayName ?? null,
    place: num(p?.formationPlace) ?? 0,
    starter: !!p?.starter,
    headshot: typeof a?.headshot?.href === 'string' ? a.headshot.href : null,
    subbedIn: p?.subbedIn ? subPlay?.clock?.displayValue ?? '' : null,
    subbedOut: p?.subbedOut ? subPlay?.clock?.displayValue ?? '' : null,
    goals: stats.G ?? plays.filter((x) => x?.didScore && !x?.ownGoal).length,
    assists: stats.A ?? plays.filter((x) => x?.didAssist).length,
    ownGoals: stats.OG ?? plays.filter((x) => x?.ownGoal && x?.didScore).length,
    yellow: (stats.YC ?? 0) > 0 || plays.some((x) => x?.yellowCard),
    red: (stats.RC ?? 0) > 0 || plays.some((x) => x?.redCard),
    stats,
  };
}

export function parseLineups(data: any, homeEspnId: string): { home: Lineup; away: Lineup } | null {
  const rosters: any[] = data?.rosters ?? [];
  if (rosters.length < 2) return null;
  const out: Partial<Record<'home' | 'away', Lineup>> = {};
  for (const r of rosters) {
    const side: 'home' | 'away' = r?.homeAway === 'home' || String(r?.team?.id) === homeEspnId ? 'home' : 'away';
    const players: LineupPlayer[] = (r?.roster ?? []).map(parsePlayer);
    const starters = players.filter((p) => p.starter);
    if (!starters.length) return null; // line-ups not announced yet
    const color = typeof r?.team?.color === 'string' && /^[0-9a-f]{6}$/i.test(r.team.color) ? `#${r.team.color}` : null;
    out[side] = {
      side,
      teamId: String(r?.team?.id ?? ''),
      formation: r?.formation ?? null,
      rows: formationRows(starters, r?.formation ?? null),
      bench: players.filter((p) => !p.starter).sort((a, b) => Number(!!b.subbedIn) - Number(!!a.subbedIn)),
      color,
    };
  }
  return out.home && out.away ? { home: out.home, away: out.away } : null;
}

// ------------------------------------------------------------------ team statistics
export type TeamStat = { key: string; label: string; home: string; away: string; homeValue: number | null; awayValue: number | null; percent?: boolean; note?: string };

const FOOTBALL_STATS: { key: string; label: string; percent?: boolean }[] = [
  { key: 'possessionPct', label: 'Possession', percent: true },
  { key: 'xg', label: 'Expected goals (xG)' },
  { key: 'totalShots', label: 'Total shots' },
  { key: 'shotsOnTarget', label: 'Shots on target' },
  { key: 'blockedShots', label: 'Blocked shots' },
  { key: 'wonCorners', label: 'Corners' },
  { key: 'foulsCommitted', label: 'Fouls' },
  { key: 'totalPasses', label: 'Passes' },
  { key: 'passAccuracy', label: 'Pass accuracy', percent: true },
  { key: 'offsides', label: 'Offsides' },
  { key: 'saves', label: 'Saves' },
  { key: 'yellowCards', label: 'Yellow cards' },
  { key: 'redCards', label: 'Red cards' },
  { key: 'totalTackles', label: 'Tackles' },
  { key: 'interceptions', label: 'Interceptions' },
];

function statMap(t: any): Record<string, { v: number | null; d: string; label: string }> {
  const m: Record<string, { v: number | null; d: string; label: string }> = {};
  for (const s of t?.statistics ?? []) {
    if (!s?.name) continue;
    m[s.name] = { v: num(s?.value ?? s?.displayValue), d: String(s?.displayValue ?? ''), label: s?.label ?? s?.displayName ?? s.name };
  }
  return m;
}

export function parseTeamStats(data: any, sport: SportSlug, homeEspnId: string, xg: { home: number; away: number } | null): TeamStat[] {
  const teams: any[] = data?.boxscore?.teams ?? [];
  if (teams.length < 2) return [];
  const hT = teams.find((t) => String(t?.team?.id) === homeEspnId) ?? teams.find((t) => t?.homeAway === 'home') ?? teams[0];
  const aT = teams.find((t) => t !== hT) ?? teams[1];
  const h = statMap(hT);
  const a = statMap(aT);
  if (sport !== 'football') {
    return Object.keys(h)
      .filter((k) => a[k] && h[k].d !== '' && a[k].d !== '')
      .slice(0, 24)
      .map((k) => ({ key: k, label: h[k].label, home: h[k].d, away: a[k]?.d ?? '', homeValue: h[k].v, awayValue: a[k]?.v ?? null }));
  }
  const out: TeamStat[] = [];
  for (const s of FOOTBALL_STATS) {
    if (s.key === 'xg') {
      if (xg) out.push({ key: 'xg', label: s.label, home: xg.home.toFixed(2), away: xg.away.toFixed(2), homeValue: xg.home, awayValue: xg.away, note: 'MK Sports estimate from shot positions' });
      continue;
    }
    if (s.key === 'passAccuracy') {
      const hp = h.totalPasses?.v;
      const ap = a.totalPasses?.v;
      const ha = h.accuratePasses?.v;
      const aa = a.accuratePasses?.v;
      if (hp && ap && ha !== null && ha !== undefined && aa !== null && aa !== undefined) {
        const hv = Math.round((100 * ha) / hp);
        const av = Math.round((100 * aa) / ap);
        out.push({ key: s.key, label: s.label, home: `${hv}%`, away: `${av}%`, homeValue: hv, awayValue: av, percent: true });
      }
      continue;
    }
    const hv = h[s.key];
    const av = a[s.key];
    if (!hv || !av || hv.v === null || av.v === null) continue;
    if (s.key === 'possessionPct') out.push({ key: s.key, label: s.label, home: `${Math.round(hv.v)}%`, away: `${Math.round(av.v)}%`, homeValue: hv.v, awayValue: av.v, percent: true });
    else out.push({ key: s.key, label: s.label, home: String(Math.round(hv.v)), away: String(Math.round(av.v)), homeValue: hv.v, awayValue: av.v });
  }
  return out;
}

// ------------------------------------------------------------------ shots & xG
const SHOT_TYPES = new Set(['shot-off-target', 'shot-on-target', 'shot-blocked', 'shot-hit-woodwork', 'goal', 'penalty---scored', 'penalty---missed', 'penalty---saved']);

export function parseShots(data: any, homeName: string, homeEspnId: string): ShotEvent[] {
  const plays: any[] = (data?.commentary ?? []).map((c: any) => c?.play).filter(Boolean);
  const src = plays.length ? plays : data?.keyEvents ?? [];
  const out: ShotEvent[] = [];
  const seen = new Set<string>();
  for (const p of src) {
    const t = String(p?.type?.type ?? '');
    // goals also come as subtypes such as "goal---free-kick"; own goals are not the scorer's shots
    const isGoal = t === 'goal' || t.startsWith('goal---') || t === 'penalty---scored';
    if ((!SHOT_TYPES.has(t) && !isGoal) || p?.shootout || /own/i.test(t)) continue;
    if (p?.id && seen.has(p.id)) continue;
    if (p?.id) seen.add(p.id);
    const teamName = p?.team?.displayName;
    const side: 'home' | 'away' = String(p?.team?.id ?? '') === homeEspnId || teamName === homeName ? 'home' : 'away';
    out.push({
      side,
      x: num(p?.fieldPositionX),
      y: num(p?.fieldPositionY),
      penalty: t.startsWith('penalty'),
      goal: isGoal,
      minute: p?.clock?.displayValue ?? null,
      player: p?.participants?.[0]?.athlete?.displayName ?? null,
      playerId: p?.participants?.[0]?.athlete?.id ? String(p.participants[0].athlete.id) : null,
      type: t,
    });
  }
  return out;
}

// ------------------------------------------------------------------ timeline
export type TimelineItem = { minute: string; type: 'goal' | 'own_goal' | 'penalty_goal' | 'penalty_miss' | 'yellow_card' | 'red_card' | 'sub' | 'var' | 'period'; side: 'home' | 'away' | null; player: string | null; detail: string | null; text: string };

export function parseTimeline(data: any, homeEspnId: string, homeName: string): TimelineItem[] {
  const out: TimelineItem[] = [];
  for (const k of data?.keyEvents ?? []) {
    const t = String(k?.type?.type ?? '');
    const text = String(k?.text ?? '');
    const side: 'home' | 'away' | null = k?.team ? (String(k.team.id) === homeEspnId || k.team.displayName === homeName ? 'home' : 'away') : null;
    const names: string[] = (k?.participants ?? []).map((p: any) => p?.athlete?.displayName).filter(Boolean);
    const minute = k?.clock?.displayValue ?? '';
    let type: TimelineItem['type'] | null = null;
    let detail: string | null = null;
    if (t === 'goal' || t.startsWith('goal')) {
      type = /own goal/i.test(text) ? 'own_goal' : 'goal';
      detail = names[1] ? `Assist: ${names[1]}` : null;
    } else if (t === 'penalty---scored') type = 'penalty_goal';
    else if (t === 'penalty---missed' || t === 'penalty---saved') type = 'penalty_miss';
    else if (t === 'yellow-card') type = 'yellow_card';
    else if (t === 'red-card' || t === 'yellow-red-card') type = 'red_card';
    else if (t === 'substitution') {
      type = 'sub';
      detail = names[1] ? `Off: ${names[1]}` : null;
    } else if (t.includes('var')) type = 'var';
    else if (t === 'halftime' || t === 'end-regular-time' || t === 'kickoff' || t === 'start-2nd-half') {
      type = 'period';
    }
    if (!type) continue;
    if (type === 'period' && !text) continue;
    out.push({ minute, type, side, player: names[0] ?? null, detail, text });
  }
  return out;
}

// ------------------------------------------------------------------ top performers (other sports)
export type Performer = { side: 'home' | 'away'; category: string; player: string; value: string; headshot: string | null; id: string | null };

export function parseLeaders(data: any, homeEspnId: string): Performer[] {
  const out: Performer[] = [];
  for (const t of data?.leaders ?? []) {
    const side: 'home' | 'away' = String(t?.team?.id) === homeEspnId ? 'home' : 'away';
    for (const c of t?.leaders ?? []) {
      const l = c?.leaders?.[0];
      if (!l?.athlete) continue;
      out.push({ side, category: c?.displayName ?? c?.name ?? '', player: l.athlete.displayName ?? '', value: l.displayValue ?? '', headshot: l.athlete?.headshot?.href ?? null, id: l.athlete?.id ? String(l.athlete.id) : null });
    }
  }
  return out;
}

// ------------------------------------------------------------------ full centre payload
export type Centre = {
  lineups: { home: Lineup; away: Lineup } | null;
  stats: TeamStat[];
  xg: { home: number; away: number; shots: number; located: number } | null;
  shots: ShotEvent[];
  timeline: TimelineItem[];
  commentary: { minute: string; text: string }[];
  performers: Performer[];
  referee: string | null;
};

export function parseCentre(data: any, sport: SportSlug, homeEspnId: string, homeName: string): Centre {
  const shots = sport === 'football' ? parseShots(data, homeName, homeEspnId) : [];
  const located = shots.filter((s) => s.x !== null).length;
  const x = shots.length && located / shots.length >= 0.8 ? teamXg(shots) : null; // only when positions are recorded for most attempts
  const comm: { minute: string; text: string }[] = (data?.commentary ?? [])
    .map((c: any) => ({ minute: c?.time?.displayValue ?? '', text: String(c?.text ?? '') }))
    .filter((c: { text: string }) => c.text)
    .reverse()
    .slice(0, 40);
  const officials: any[] = data?.gameInfo?.officials ?? [];
  return {
    lineups: sport === 'football' ? parseLineups(data, homeEspnId) : null,
    stats: parseTeamStats(data, sport, homeEspnId, x ? { home: x.home, away: x.away } : null),
    xg: x ? { home: x.home, away: x.away, shots: x.total, located: x.located } : null,
    shots,
    timeline: sport === 'football' ? parseTimeline(data, homeEspnId, homeName) : [],
    commentary: comm,
    performers: sport === 'football' ? [] : parseLeaders(data, homeEspnId),
    referee: officials[0]?.fullName ?? officials[0]?.displayName ?? null,
  };
}

export async function centre(league: string, espnId: string, ttl: number, sport: SportSlug, homeEspnId: string, homeName: string): Promise<Centre> {
  const data = await get(summaryUrl(league, espnId), { ttl });
  return parseCentre(data, sport, homeEspnId, homeName);
}

// ------------------------------------------------------------------ players
export type PlayerPage = {
  id: string;
  name: string;
  position: string | null;
  jersey: string | null;
  age: number | null;
  nationality: string | null;
  flag: string | null;
  height: string | null;
  team: { espnId: string; name: string; logo: string | null } | null;
  headshot: string | null;
  season: { competition: string; labels: string[]; names: string[]; values: string[] }[];
  summary: { label: string; value: string }[];
  recent: { eventId: string; date: string; opponent: string; opponentLogo: string | null; home: boolean; score: string; result: string | null; competition: string; stats: { label: string; value: string }[] }[];
};

export function parsePlayerPage(bio: any, overview: any, id: string): PlayerPage {
  const a = bio?.athlete ?? {};
  const stats = overview?.statistics ?? {};
  const season = (stats?.splits ?? []).map((sp: any) => ({ competition: sp?.displayName ?? '', labels: stats?.labels ?? [], names: stats?.displayNames ?? stats?.names ?? [], values: (sp?.stats ?? []).map(String) }));
  const gl = overview?.gameLog ?? {};
  const glStats = gl?.statistics?.[0] ?? {};
  const evMap = gl?.events ?? {};
  const recent = (glStats?.events ?? []).map((e: any) => {
    const ev = evMap[e?.eventId] ?? {};
    const opp = ev?.opponent ?? {};
    const labels: string[] = glStats?.displayNames ?? glStats?.labels ?? [];
    // ESPN's "score" is winner-first; show it from the player's team's side instead
    const ourId = String(ev?.team?.id ?? '');
    const hs = num(ev?.homeTeamScore);
    const as = num(ev?.awayTeamScore);
    const ours = ourId && String(ev?.homeTeamId) === ourId ? hs : as;
    const theirs = ourId && String(ev?.homeTeamId) === ourId ? as : hs;
    return {
      eventId: String(e?.eventId ?? ''),
      date: ev?.gameDate ?? '',
      opponent: opp?.displayName ?? opp?.abbreviation ?? '',
      opponentLogo: typeof opp?.logo === 'string' ? opp.logo : null,
      home: ev?.atVs === 'vs',
      score: ours !== null && theirs !== null ? `${ours}-${theirs}` : ev?.score ?? '',
      result: ev?.gameResult ?? null,
      competition: ev?.leagueShortName ?? ev?.leagueName ?? '',
      stats: (e?.stats ?? []).map((v: unknown, i: number) => ({ label: labels[i] ?? '', value: String(v) })),
    };
  });
  const sum = (a?.statsSummary?.statistics ?? []).map((s: any) => ({ label: s?.displayName ?? s?.name ?? '', value: String(s?.displayValue ?? '') }));
  return {
    id,
    name: a?.displayName ?? '',
    position: a?.position?.displayName ?? null,
    jersey: a?.jersey ?? null,
    age: num(a?.age),
    nationality: a?.citizenship ?? null,
    flag: a?.flag?.href ?? null,
    height: a?.displayHeight ?? null,
    team: a?.team ? { espnId: String(a.team.id), name: a.team.displayName ?? a.team.name ?? '', logo: (a.team.logos?.[0]?.href as string) ?? null } : null,
    headshot: a?.headshot?.href ?? null,
    season,
    summary: sum,
    recent,
  };
}

export async function playerPage(league: string, id: string): Promise<PlayerPage> {
  const lg = LEAGUE_BY_SLUG[league];
  const base = `${WEB}/${lg.espnSport}/${lg.slug}/athletes/${id}`;
  const [bio, overview] = await Promise.all([get(base, { ttl: 6 * 3600 }), get(`${base}/overview`, { ttl: 1800 }).catch(() => null)]);
  return parsePlayerPage(bio, overview, id);
}
