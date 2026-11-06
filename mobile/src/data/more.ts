/**
 * Player leaders, news, and the sports that don't fit the head-to-head pipeline
 * (tennis, Formula 1, cricket). All from ESPN's public feeds; nothing is estimated here.
 */
import { currentSeason, logoOf, standings as leagueStandings, TeamInfo, teams as leagueTeams } from './espn';
import { get } from './http';
import { LEAGUE_BY_SLUG, SportSlug } from './leagues';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
const SITE_V2 = 'https://site.api.espn.com/apis/v2/sports';
const CORE = 'https://sports.core.api.espn.com/v2/sports';

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const https = (u: string) => u.replace(/^http:\/\//, 'https://');

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

// ------------------------------------------------------------------ player leaders
export type LeaderRow = { rank: number; athleteId: string; name: string; short: string; position: string | null; headshot: string | null; team: TeamInfo | null; value: string; numeric: number | null };
export type LeaderCategory = { key: string; label: string; rows: LeaderRow[]; note?: string };

const SKIP = new Set(['goalsLeaders', 'assistsLeaders']); // duplicates of goals/assists with a combined label

export async function leaders(slug: string, perCategory = 5): Promise<LeaderCategory[]> {
  const lg = LEAGUE_BY_SLUG[slug];
  const season = await currentSeason(slug);
  if (!season) return [];
  const data: any = await get(`${CORE}/${lg.espnSport}/leagues/${slug}/seasons/${season.year}/types/${season.type}/leaders?limit=${perCategory}`, { ttl: 3 * 3600 });
  const cats: any[] = (data?.categories ?? []).filter((c: any) => !SKIP.has(c?.name)).slice(0, 12);
  const refs = new Set<string>();
  for (const c of cats) for (const l of (c?.leaders ?? []).slice(0, perCategory)) if (l?.athlete?.$ref) refs.add(https(l.athlete.$ref));
  const athletes = new Map<string, any>();
  await pool([...refs], 6, async (u) => {
    try {
      athletes.set(u, await get(u, { ttl: 24 * 3600 }));
    } catch {
      /* one missing athlete shouldn't hide the category */
    }
  });
  const teamList = await leagueTeams(slug).catch(() => [] as TeamInfo[]);
  const byEspn = new Map(teamList.map((t) => [t.espnId, t]));
  return cats.map((c) => ({
    key: c.name,
    label: c.displayName ?? c.name,
    rows: (c?.leaders ?? []).slice(0, perCategory).map((l: any, i: number) => {
      const a = athletes.get(https(l?.athlete?.$ref ?? '')) ?? {};
      const teamId = /\/teams\/(\d+)/.exec(l?.team?.$ref ?? a?.team?.$ref ?? '')?.[1] ?? null;
      return {
        rank: i + 1,
        athleteId: String(a?.id ?? /\/athletes\/(\d+)/.exec(l?.athlete?.$ref ?? '')?.[1] ?? ''),
        name: a?.displayName ?? a?.fullName ?? 'Unknown player',
        short: a?.shortName ?? a?.displayName ?? '',
        position: a?.position?.abbreviation ?? null,
        headshot: a?.headshot?.href ?? null,
        team: teamId ? byEspn.get(teamId) ?? null : null,
        value: String(l?.displayValue ?? l?.value ?? ''),
        numeric: num(l?.value),
      };
    }),
  }));
}

// ------------------------------------------------------------------ news
export type Article = { id: string; headline: string; description: string | null; published: string; image: string | null; url: string | null; byline: string | null; league: string; teamIds: string[]; type: string };

export function parseArticles(data: any, league: string): Article[] {
  return (data?.articles ?? [])
    .map((a: any) => {
      const img = (a?.images ?? []).find((i: any) => typeof i?.url === 'string');
      return {
        id: String(a?.id ?? a?.dataSourceIdentifier ?? a?.headline ?? ''),
        headline: String(a?.headline ?? '').trim(),
        description: a?.description ?? null,
        published: a?.published ?? a?.lastModified ?? '',
        image: img?.url ?? null,
        url: a?.links?.mobile?.href ?? a?.links?.web?.href ?? null,
        byline: a?.byline ?? null,
        league,
        teamIds: (a?.categories ?? []).filter((c: any) => c?.type === 'team' && c?.teamId).map((c: any) => String(c.teamId)),
        type: String(a?.type ?? 'Story'),
      };
    })
    .filter((a: Article) => a.headline && a.url);
}

export async function news(slug: string, teamEspnId?: string | null, limit = 25): Promise<Article[]> {
  const lg = LEAGUE_BY_SLUG[slug];
  const path = lg.format === 'match' || lg.format === 'tennis' ? `${lg.espnSport}/${slug}` : lg.format === 'racing' ? 'racing/f1' : 'cricket';
  const q = `limit=${limit}${teamEspnId ? `&team=${teamEspnId}` : ''}`;
  const data = await get(`${SITE}/${path}/news?${q}`, { ttl: 600 });
  return parseArticles(data, slug);
}

// ------------------------------------------------------------------ tennis
export type TennisPlayer = { id: string | null; name: string; short: string; flag: string | null; seed: string | null; winner: boolean; sets: (number | null)[]; tiebreaks: (number | null)[] };
export type TennisMatch = { id: string; tournament: string; draw: string; round: string | null; start: string; state: 'pre' | 'in' | 'post'; status: string; court: string | null; players: [TennisPlayer, TennisPlayer] };
export type TennisBoard = { tournaments: { id: string; name: string; start: string; end: string | null; venue: string | null; major: boolean }[]; matches: TennisMatch[] };

function tennisPlayer(c: any): TennisPlayer {
  const a = c?.athlete ?? {};
  const names = (c?.roster?.athletes ?? []).map((x: any) => x?.shortName ?? x?.displayName).filter(Boolean);
  return {
    id: a?.id ? String(a.id) : null,
    name: a?.displayName ?? (names.length ? names.join(' / ') : 'TBD'),
    short: a?.shortName ?? (names.length ? names.join(' / ') : 'TBD'),
    flag: a?.flag?.href ?? null,
    seed: c?.seed ? String(c.seed) : c?.curatedRank?.current ? String(c.curatedRank.current) : null,
    winner: !!c?.winner,
    sets: (c?.linescores ?? []).map((l: any) => num(l?.value)),
    tiebreaks: (c?.linescores ?? []).map((l: any) => num(l?.tiebreak)),
  };
}

export function parseTennis(data: any): TennisBoard {
  const tournaments: TennisBoard['tournaments'] = [];
  const matches: TennisMatch[] = [];
  for (const e of data?.events ?? []) {
    tournaments.push({ id: String(e?.id), name: e?.name ?? '', start: e?.date ?? '', end: e?.endDate ?? null, venue: e?.venue?.fullName ?? null, major: !!e?.major });
    for (const g of e?.groupings ?? []) {
      const draw = g?.grouping?.displayName ?? '';
      for (const c of g?.competitions ?? []) {
        const cs: any[] = c?.competitors ?? [];
        if (cs.length < 2) continue;
        const st = c?.status?.type ?? {};
        matches.push({
          id: String(c?.id),
          tournament: e?.name ?? '',
          draw,
          round: c?.round?.displayName ?? null,
          start: c?.date ?? e?.date ?? '',
          state: (st?.state ?? 'pre') as TennisMatch['state'],
          status: st?.shortDetail ?? st?.detail ?? '',
          court: c?.venue?.court ?? c?.venue?.fullName ?? null,
          players: [tennisPlayer(cs[0]), tennisPlayer(cs[1])],
        });
      }
    }
  }
  return { tournaments, matches };
}

export async function tennis(tour: 'atp' | 'wta'): Promise<TennisBoard> {
  return parseTennis(await get(`${SITE}/tennis/${tour}/scoreboard`, { ttl: 60 }));
}

export type RankRow = { rank: number; previous: number | null; points: number | null; name: string; flag: string | null; id: string | null; trend: string | null };
export async function tennisRankings(tour: 'atp' | 'wta', limit = 100): Promise<RankRow[]> {
  const data: any = await get(`${SITE}/tennis/${tour}/rankings`, { ttl: 6 * 3600 });
  const r = data?.rankings?.[0]?.ranks ?? [];
  return r.slice(0, limit).map((x: any) => ({ rank: num(x?.current) ?? 0, previous: num(x?.previous), points: num(x?.points), name: x?.athlete?.displayName ?? '', flag: x?.athlete?.flag?.href ?? null, id: x?.athlete?.id ? String(x.athlete.id) : null, trend: x?.trend ?? null }));
}

// ------------------------------------------------------------------ Formula 1
export type RaceSession = { name: string; start: string; state: 'pre' | 'in' | 'post'; results: { pos: number; driver: string; flag: string | null; winner: boolean }[] };
export type RaceWeekend = { id: string; name: string; start: string; end: string | null; circuit: string | null; city: string | null; sessions: RaceSession[] };
export type F1Board = { current: RaceWeekend[]; calendar: { name: string; start: string; end: string | null }[] };

export function parseF1(data: any): F1Board {
  const current: RaceWeekend[] = (data?.events ?? []).map((e: any) => ({
    id: String(e?.id),
    name: e?.name ?? '',
    start: e?.date ?? '',
    end: e?.endDate ?? null,
    circuit: e?.circuit?.fullName ?? e?.competitions?.[0]?.venue?.fullName ?? null,
    city: e?.circuit?.address?.city ?? null,
    sessions: (e?.competitions ?? []).map((c: any) => ({
      name: c?.type?.abbreviation ?? c?.type?.text ?? '',
      start: c?.date ?? '',
      state: (c?.status?.type?.state ?? 'pre') as RaceSession['state'],
      results: (c?.competitors ?? [])
        .map((x: any) => ({ pos: num(x?.order) ?? 0, driver: x?.athlete?.displayName ?? '', flag: x?.athlete?.flag?.href ?? null, winner: !!x?.winner }))
        .sort((a: { pos: number }, b: { pos: number }) => a.pos - b.pos),
    })),
  }));
  const calendar = (data?.leagues?.[0]?.calendar ?? []).map((c: any) => ({ name: c?.label ?? '', start: c?.startDate ?? '', end: c?.endDate ?? null }));
  return { current, calendar };
}

export async function f1(): Promise<F1Board> {
  return parseF1(await get(`${SITE}/racing/f1/scoreboard`, { ttl: 120 }));
}

export type F1Standing = { rank: number; name: string; flag: string | null; points: number; color: string | null };
export async function f1Standings(): Promise<{ drivers: F1Standing[]; constructors: F1Standing[] }> {
  const data: any = await get(`${SITE_V2}/racing/f1/standings`, { ttl: 3 * 3600 });
  const pick = (ch: any, team: boolean): F1Standing[] =>
    (ch?.standings?.entries ?? []).map((e: any) => {
      const st: Record<string, number> = {};
      for (const s of e?.stats ?? []) if (s?.name) st[s.name] = num(s?.value) ?? 0;
      const who = team ? e?.team : e?.athlete;
      return { rank: st.rank ?? 0, name: who?.displayName ?? who?.name ?? '', flag: team ? null : who?.flag?.href ?? null, points: st.championshipPts ?? st.points ?? 0, color: team && who?.color ? `#${who.color}` : null };
    });
  const ch: any[] = data?.children ?? [];
  return { drivers: pick(ch.find((c) => /driver/i.test(c?.name)) ?? ch[0], false), constructors: pick(ch.find((c) => /constructor/i.test(c?.name)) ?? ch[1], true) };
}

// ------------------------------------------------------------------ cricket
export type CricketTeam = { name: string; abbr: string; logo: string | null; score: string; winner: boolean };
export type CricketMatch = { id: string; competition: string; description: string | null; format: string | null; start: string; state: 'pre' | 'in' | 'post'; status: string; venue: string | null; teams: [CricketTeam, CricketTeam] };

export function parseCricket(data: any): CricketMatch[] {
  const out: CricketMatch[] = [];
  for (const s of data?.scores ?? []) {
    const lg = s?.leagues?.[0] ?? {};
    for (const e of s?.events ?? []) {
      const c = e?.competitions?.[0] ?? {};
      const cs: any[] = c?.competitors ?? [];
      if (cs.length < 2) continue;
      const st = e?.status?.type ?? c?.status?.type ?? {};
      const team = (x: any): CricketTeam => ({ name: x?.team?.displayName ?? '', abbr: x?.team?.abbreviation ?? '', logo: logoOf(x?.team), score: String(x?.score ?? ''), winner: x?.winner === true || x?.winner === 'true' });
      out.push({
        id: String(e?.id),
        competition: lg?.name ?? lg?.abbreviation ?? '',
        description: c?.description ?? e?.description ?? null,
        format: c?.class?.generalClassCard ?? null,
        start: e?.date ?? '',
        state: (st?.state ?? 'pre') as CricketMatch['state'],
        status: e?.status?.summary ?? c?.status?.summary ?? st?.description ?? '',
        venue: c?.venue?.fullName ?? null,
        teams: [team(cs[0]), team(cs[1])],
      });
    }
  }
  return out;
}

export async function cricket(): Promise<CricketMatch[]> {
  return parseCricket(await get(`${SITE}/cricket/scorepanel`, { ttl: 60 }));
}

// ------------------------------------------------------------------ team squad
export type SquadPlayer = { id: string; name: string; jersey: string | null; position: string | null; age: number | null; nationality: string | null; headshot: string | null };
export async function squad(slug: string, teamEspnId: string): Promise<SquadPlayer[]> {
  const lg = LEAGUE_BY_SLUG[slug];
  const data: any = await get(`${SITE}/${lg.espnSport}/${slug}/teams/${teamEspnId}/roster`, { ttl: 12 * 3600 });
  const raw: any[] = Array.isArray(data?.athletes?.[0]?.items) ? data.athletes.flatMap((g: any) => g?.items ?? []) : data?.athletes ?? [];
  return raw.map((a: any) => ({ id: String(a?.id ?? ''), name: a?.displayName ?? '', jersey: a?.jersey ?? null, position: a?.position?.abbreviation ?? a?.position?.displayName ?? null, age: num(a?.age), nationality: a?.citizenship ?? null, headshot: a?.headshot?.href ?? null }));
}

export { leagueStandings };
export type { SportSlug };
