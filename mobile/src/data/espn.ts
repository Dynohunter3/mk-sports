/**
 * ESPN public JSON feed (site.api.espn.com): fixtures, live scores, results, tables, team
 * news and ESPN Analytics' matchup predictor. Parsers are defensive: every field is
 * optional, and missing data is reported as unavailable rather than guessed.
 */
import { americanToDecimal, impliedFromDecimal, Probs } from '@/engine';

import { get } from './http';
import { LEAGUE_BY_SLUG, LeagueDef, sportOf, SportSlug } from './leagues';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports';
const BASE_V2 = 'https://site.api.espn.com/apis/v2/sports';

export type TeamInfo = { id: string; espnId: string; name: string; short: string; abbr: string; color: string; logo: string | null };
export type MatchStatus = 'scheduled' | 'live' | 'finished' | 'postponed' | 'cancelled';
export type EventDetail = { type: 'goal' | 'own_goal' | 'penalty_goal' | 'yellow_card' | 'red_card'; minute: number | null; clock: string | null; side: 'home' | 'away'; player: string | null };

export type SEvent = {
  id: string; // `${league}~${espnEventId}`
  espnId: string;
  league: string;
  sport: SportSlug;
  start: string; // ISO UTC
  status: MatchStatus;
  clock: string | null;
  home: TeamInfo;
  away: TeamInfo;
  homeScore: number | null;
  awayScore: number | null;
  venue: string | null;
  neutral: boolean;
  round: string | null;
  details: EventDetail[];
  quarters: [number, number][] | null;
  market: Probs | null; // probabilities implied by market prices (prices are never shown)
  preseason: boolean;
};

export type Injury = { player: string; position: string; status: string; detail: string | null; importance: number };
export type SummaryExtra = {
  event: SEvent | null;
  injuries: { home: Injury[]; away: Injury[] } | null;
  predictor: Probs | null;
  h2h: { date: string; homeEspnId: string; awayEspnId: string; homeScore: number; awayScore: number }[] | null;
  attendance: number | null;
};

export const makeEventId = (league: string, espnId: string) => `${league}~${espnId}`;
export function splitEventId(id: string): { league: string; espnId: string } | null {
  const i = id.lastIndexOf('~');
  if (i < 0) return null;
  return { league: id.slice(0, i), espnId: id.slice(i + 1) };
}
export const teamKey = (sport: SportSlug, espnId: string) => `${sport}:${espnId}`;

export const ymd = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/** The crest URL in any of ESPN's team layouts. */
export function logoOf(t: any): string | null {
  const direct = typeof t?.logo === 'string' && t.logo ? t.logo : null;
  const list: any[] = Array.isArray(t?.logos) ? t.logos : [];
  const def = list.find((l) => (l?.rel ?? []).includes('default')) ?? list[0];
  const href = direct ?? def?.href ?? null;
  return typeof href === 'string' && /^https:\/\//.test(href) ? href : null;
}

export function team(sport: SportSlug, t: any): TeamInfo {
  const id = String(t?.id ?? '0');
  const raw = typeof t?.color === 'string' ? t.color.replace('#', '') : '';
  const color = /^[0-9a-f]{6}$/i.test(raw) ? `#${raw}` : '#64748B';
  const name = t?.displayName ?? t?.name ?? t?.location ?? 'TBD';
  return { id: teamKey(sport, id), espnId: id, name, short: t?.shortDisplayName ?? name, abbr: (t?.abbreviation ?? name.slice(0, 3)).toUpperCase(), color, logo: logoOf(t) };
}

const REGULATION: Partial<Record<SportSlug, number>> = { basketball: 4, 'american-football': 4, 'ice-hockey': 3, baseball: 9 };
const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

function mapStatus(st: any, sport: SportSlug): { status: MatchStatus; clock: string | null } {
  const type = st?.type ?? {};
  const name: string = String(type.name ?? '').toUpperCase();
  const state: string = type.state ?? 'pre';
  if (name.includes('POSTPONED')) return { status: 'postponed', clock: null };
  if (name.includes('CANCEL') || name.includes('ABANDON') || name.includes('FORFEIT')) return { status: 'cancelled', clock: null };
  if (state === 'pre') return { status: 'scheduled', clock: null };
  if (state === 'in') {
    if (name.includes('HALFTIME')) return { status: 'live', clock: 'HT' };
    const period = num(st?.period) ?? 0;
    if (sport === 'baseball') return { status: 'live', clock: type.shortDetail ?? `${ordinal(period)} inning` };
    if (sport === 'basketball' || sport === 'american-football') {
      if (name.includes('END_PERIOD')) return { status: 'live', clock: `End Q${period}` };
      const q = period > 4 ? `OT${period - 4 > 1 ? period - 4 : ''}` : `Q${period}`;
      return { status: 'live', clock: `${q} ${st?.displayClock ?? ''}`.trim() };
    }
    if (sport === 'ice-hockey') {
      const p = period > 4 ? 'SO' : period === 4 ? 'OT' : `P${period}`;
      if (name.includes('END_PERIOD')) return { status: 'live', clock: `End ${p}` };
      return { status: 'live', clock: p === 'SO' ? 'Shootout' : `${p} ${st?.displayClock ?? ''}`.trim() };
    }
    return { status: 'live', clock: st?.displayClock ?? type.shortDetail ?? 'LIVE' };
  }
  // post
  const reg = REGULATION[sport];
  const period = num(st?.period) ?? 0;
  const clock = name.includes('PEN')
    ? 'Pens'
    : name.includes('AET') || name.includes('EXTRA')
      ? 'AET'
      : reg && period > reg
        ? sport === 'baseball'
          ? `F/${period}`
          : sport === 'ice-hockey' && period > 4
            ? 'FT/SO'
            : 'FT/OT'
        : 'FT';
  return { status: type.completed === false && !name.includes('FINAL') && !name.includes('FULL_TIME') ? 'postponed' : 'finished', clock };
}

/** Market prices -> probabilities. Handles both ESPN odds layouts. */
export function parseMarket(odds: any, hasDraws: boolean): Probs | null {
  const o = Array.isArray(odds) ? odds[0] : odds;
  if (!o) return null;
  const pick = (legacy: any, modern: any) => americanToDecimal(legacy?.moneyLine ?? modern?.close?.odds ?? modern?.current?.odds ?? modern?.open?.odds ?? null);
  const prices = {
    home: pick(o.homeTeamOdds, o.moneyline?.home),
    away: pick(o.awayTeamOdds, o.moneyline?.away),
    ...(hasDraws ? { draw: pick(o.drawOdds, o.moneyline?.draw) } : {}),
  };
  if (!prices.home || !prices.away || (hasDraws && !prices.draw)) return null;
  return impliedFromDecimal(prices as Record<string, number>);
}

function parseDetails(comp: any, homeEspnId: string): EventDetail[] {
  const out: EventDetail[] = [];
  for (const d of comp?.details ?? []) {
    const text = String(d?.type?.text ?? '').toLowerCase();
    let type: EventDetail['type'] | null = null;
    if (d?.redCard || text.includes('red card')) type = 'red_card';
    else if (d?.yellowCard || text.includes('yellow card')) type = 'yellow_card';
    else if (d?.scoringPlay || text.includes('goal')) type = d?.ownGoal || text.includes('own goal') ? 'own_goal' : d?.penaltyKick || text.includes('penalty') ? 'penalty_goal' : 'goal';
    if (!type || d?.shootout) continue;
    const clock = d?.clock?.displayValue ?? null;
    out.push({
      type,
      minute: clock ? num(String(clock).split("'")[0]) : null,
      clock,
      side: String(d?.team?.id) === homeEspnId ? 'home' : 'away',
      player: d?.athletesInvolved?.[0]?.displayName ?? d?.athletesInvolved?.[0]?.shortName ?? null,
    });
  }
  return out;
}

/** One ESPN event (scoreboard item, or summary header) -> SEvent. */
export function parseEvent(raw: any, league: LeagueDef): SEvent | null {
  const comp = raw?.competitions?.[0];
  const cs: any[] = comp?.competitors ?? [];
  const h = cs.find((c) => c?.homeAway === 'home') ?? cs[0];
  const a = cs.find((c) => c?.homeAway === 'away') ?? cs[1];
  const espnId = String(raw?.id ?? comp?.id ?? '');
  if (!h || !a || !espnId) return null;
  const sport = league.sport as SportSlug;
  const { status, clock } = mapStatus(comp?.status ?? raw?.status, sport);
  const started = status === 'live' || status === 'finished';
  const home = team(sport, h.team);
  const away = team(sport, a.team);
  const lines = (c: any): number[] => (c?.linescores ?? []).map((l: any) => num(l?.value ?? l?.displayValue) ?? 0);
  const hl = lines(h);
  const al = lines(a);
  const notes = comp?.notes?.[0]?.headline ?? comp?.type?.text ?? null;
  return {
    id: makeEventId(league.slug, espnId),
    espnId,
    league: league.slug,
    sport,
    start: new Date(comp?.date ?? raw?.date).toISOString(),
    status,
    clock,
    home,
    away,
    homeScore: started ? num(h.score?.value ?? h.score) : null,
    awayScore: started ? num(a.score?.value ?? a.score) : null,
    venue: comp?.venue?.fullName ?? null,
    neutral: !!comp?.neutralSite || !!league.neutral,
    round: typeof notes === 'string' && notes.length < 60 ? notes : null,
    details: parseDetails(comp, home.espnId),
    quarters: sport !== 'football' && hl.length && hl.length === al.length ? hl.map((v, i) => [v, al[i]] as [number, number]) : null,
    market: parseMarket(comp?.odds, !!sportOf(sport)?.hasDraws),
    preseason: raw?.season?.type === 1 || raw?.season?.slug === 'preseason',
  };
}

export type Scoreboard = { events: SEvent[]; season: string | null };

// ESPN's scoreboard accepts a single day (YYYYMMDD), a month (YYYYMM) or a year (YYYY), not
// arbitrary day ranges. Month/year buckets follow US Eastern time, so callers pad ranges.
async function scoreboardQuery(slug: string, dates: string | null, ttl: number): Promise<Scoreboard> {
  const lg = LEAGUE_BY_SLUG[slug];
  const q = dates ? `?dates=${dates}&limit=1000` : '';
  const data: any = await get(`${BASE}/${lg.espnSport}/${slug}/scoreboard${q}`, { ttl });
  const events = (data?.events ?? []).map((e: any) => parseEvent(e, lg)).filter(Boolean) as SEvent[];
  const s = data?.leagues?.[0]?.season;
  if (s?.year) seasonInfo.set(slug, { year: Number(s.year), type: String(s?.type?.id ?? s?.type?.type ?? '1'), start: s?.startDate ?? null, name: s?.displayName ?? String(s.year) });
  return { events, season: s?.displayName ?? (s?.year ? String(s.year) : null) };
}

/** Season year/type as ESPN numbers them (needed by its statistics endpoints). */
export type SeasonInfo = { year: number; type: string; start: string | null; name: string };
const seasonInfo = new Map<string, SeasonInfo>();
export async function currentSeason(slug: string): Promise<SeasonInfo | null> {
  if (!seasonInfo.has(slug)) await scoreboardQuery(slug, null, 300).catch(() => null);
  return seasonInfo.get(slug) ?? null;
}

/** Today's / the current round's matches: the freshest view for live scores. */
export const scoreboardCurrent = (slug: string, ttl: number) => scoreboardQuery(slug, null, ttl);
export const scoreboardYear = (slug: string, year: number, ttl: number) => scoreboardQuery(slug, String(year), ttl);

const monthKey = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

/** Every match in [from, to] (whole months are fetched and cached); live data merged on top. */
export async function scoreboard(slug: string, from: Date, to: Date, ttl: number): Promise<Scoreboard> {
  const now = Date.now();
  const months: string[] = [];
  const cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  while (cur.getTime() <= to.getTime()) {
    months.push(monthKey(cur));
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  const thisMonth = monthKey(new Date(now));
  const parts = await Promise.all(
    months.map((m) => scoreboardQuery(slug, m, m === thisMonth ? Math.max(ttl, 120) : m < thisMonth ? 6 * 3600 : 900)),
  );
  const byId = new Map<string, SEvent>();
  let season: string | null = null;
  for (const p of parts) {
    season = p.season ?? season;
    for (const e of p.events) byId.set(e.id, e);
  }
  if (from.getTime() <= now + 2 * DAY_MS && to.getTime() >= now - 2 * DAY_MS) {
    const live = await scoreboardQuery(slug, null, Math.min(ttl, 30));
    season = live.season ?? season;
    for (const e of live.events) byId.set(e.id, e); // freshest status/score wins
  }
  return { events: [...byId.values()], season };
}

const DAY_MS = 86_400_000;

export async function summary(eventId: string, ttl: number): Promise<SummaryExtra> {
  const ids = splitEventId(eventId);
  if (!ids) return { event: null, injuries: null, predictor: null, h2h: null, attendance: null };
  const lg = LEAGUE_BY_SLUG[ids.league];
  const data: any = await get(`${BASE}/${lg.espnSport}/${lg.slug}/summary?event=${ids.espnId}`, { ttl });
  const header = data?.header;
  const event = header ? parseEvent({ id: header.id ?? ids.espnId, competitions: header.competitions, season: header.season }, lg) : null;
  if (event && !event.market) event.market = parseMarket(data?.pickcenter, !!sportOf(lg.sport)?.hasDraws);
  if (event && !event.venue) event.venue = data?.gameInfo?.venue?.fullName ?? null;
  const homeId = event?.home.espnId;

  // Team news (ESPN publishes it for some sports/leagues only)
  let injuries: SummaryExtra['injuries'] = null;
  if (Array.isArray(data?.injuries) && event) {
    const leaders = new Map<string, number>(); // player -> importance from season leaders
    for (const t of data?.leaders ?? []) {
      for (const cat of t?.leaders ?? []) {
        (cat?.leaders ?? []).forEach((l: any, i: number) => {
          const n = l?.athlete?.displayName;
          if (n) leaders.set(n, Math.max(leaders.get(n) ?? 0, i === 0 ? 1 : 0.7));
        });
      }
    }
    injuries = { home: [], away: [] };
    for (const t of data.injuries) {
      const side = String(t?.team?.id) === homeId ? 'home' : 'away';
      for (const inj of t?.injuries ?? []) {
        const player = inj?.athlete?.displayName ?? inj?.athlete?.shortName;
        if (!player) continue;
        const st = String(inj?.status ?? '').toLowerCase();
        const status = st.includes('out') || st.includes('injur') ? 'injured' : st.includes('susp') ? 'suspended' : 'doubtful';
        const detail = [inj?.details?.type, inj?.details?.detail].filter(Boolean).join(' – ') || inj?.shortComment || null;
        injuries[side].push({ player, position: inj?.athlete?.position?.abbreviation ?? '', status, detail, importance: leaders.get(player) ?? 0.3 });
      }
    }
  }

  // ESPN Analytics matchup predictor (win %)
  let predictor: Probs | null = null;
  const ph = num(data?.predictor?.homeTeam?.gameProjection);
  const pa = num(data?.predictor?.awayTeam?.gameProjection);
  if (ph !== null && pa !== null && ph + pa > 0) {
    const tie = lg.sport === 'football' ? Math.max(0, 100 - ph - pa) : 0; // ESPN's soccer predictor leaves the draw implicit
    predictor = lg.sport === 'football' ? { home: ph / 100, draw: tie / 100, away: pa / 100 } : { home: ph / (ph + pa), away: pa / (ph + pa) };
  }

  // head-to-head: ESPN's season-series / last meetings
  let h2h: SummaryExtra['h2h'] = null;
  const series: any[] = (data?.seasonseries ?? []).flatMap((x: any) => x?.events ?? []);
  if (series.length) {
    h2h = series
      .filter((g: any) => g?.statusType?.completed || g?.status === 'post')
      .map((g: any) => {
        const h = (g?.competitors ?? []).find((c: any) => c?.homeAway === 'home');
        const a = (g?.competitors ?? []).find((c: any) => c?.homeAway === 'away');
        return { date: g?.date, homeEspnId: String(h?.team?.id ?? ''), awayEspnId: String(a?.team?.id ?? ''), homeScore: num(h?.score), awayScore: num(a?.score) };
      })
      .filter((g: any) => g.date && g.homeScore !== null && g.awayScore !== null)
      .sort((x: any, y: any) => String(y.date).localeCompare(String(x.date))) as NonNullable<SummaryExtra['h2h']>;
  }
  return { event, injuries, predictor, h2h, attendance: num(data?.gameInfo?.attendance) };
}

export type StandingRowRaw = {
  team: TeamInfo;
  group: string | null;
  position: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  otLosses: number | null;
  pf: number;
  pa: number;
  points: number;
  winPct: number | null;
  gamesBehind: string | null;
  streak: string | null;
  note: string | null;
};

export async function standings(slug: string): Promise<StandingRowRaw[]> {
  const lg = LEAGUE_BY_SLUG[slug];
  const sport = lg.sport as SportSlug;
  const data: any = await get(`${BASE_V2}/${lg.espnSport}/${slug}/standings`, { ttl: 600 });
  const groups: any[] = data?.children?.length ? data.children : [data];
  const out: StandingRowRaw[] = [];
  for (const g of groups) {
    const entries: any[] = g?.standings?.entries ?? [];
    const rows = entries.map((e) => {
      const s: Record<string, number> = {};
      const txt: Record<string, string> = {};
      for (const st of e?.stats ?? []) {
        const v = num(st?.value ?? st?.displayValue);
        if (st?.name && v !== null) s[st.name] = v;
        if (st?.type && v !== null) s[st.type] = v;
        if (st?.name && typeof st?.displayValue === 'string') txt[st.name] = st.displayValue;
      }
      const won = s.wins ?? 0;
      const lost = s.losses ?? 0;
      const ties = s.ties ?? 0;
      const otl = sport === 'ice-hockey' ? s.otLosses ?? s.overtimeLosses ?? 0 : null;
      const played = s.gamesPlayed ?? won + lost + ties + (otl ?? 0);
      return {
        team: team(sport, e?.team),
        group: groups.length > 1 ? g?.name ?? g?.abbreviation ?? null : null,
        position: s.rank ?? s.playoffSeed ?? 0,
        played,
        won,
        drawn: ties,
        lost,
        otLosses: otl,
        pf: s.pointsFor ?? 0,
        pa: s.pointsAgainst ?? 0,
        points: sport === 'football' ? s.points ?? 3 * won + ties : sport === 'ice-hockey' ? s.points ?? 2 * won + (otl ?? 0) : won,
        winPct: s.winPercent ?? (played ? won / played : null),
        gamesBehind: txt.gamesBehind && txt.gamesBehind !== '' ? txt.gamesBehind : null,
        streak: txt.streak ?? null,
        note: e?.note?.description ?? null,
      };
    });
    const byRecord = (x: StandingRowRaw, y: StandingRowRaw) =>
      sport === 'football' || sport === 'ice-hockey' ? y.points - x.points || y.pf - y.pa - (x.pf - x.pa) : (y.winPct ?? 0) - (x.winPct ?? 0);
    rows.sort((x, y) => (x.position && y.position ? x.position - y.position : byRecord(x, y)));
    rows.forEach((r, i) => (r.position = i + 1));
    out.push(...rows);
  }
  return out;
}

export async function teams(slug: string): Promise<TeamInfo[]> {
  const lg = LEAGUE_BY_SLUG[slug];
  const data: any = await get(`${BASE}/${lg.espnSport}/${slug}/teams`, { ttl: 7 * 86400 });
  const list: any[] = data?.sports?.[0]?.leagues?.[0]?.teams ?? [];
  return list.map((t) => team(lg.sport as SportSlug, t?.team ?? t));
}
