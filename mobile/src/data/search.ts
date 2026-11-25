/**
 * Search: competitions from the app's own list (on the phone), teams and players from ESPN's search (the same
 * source as the rest of the app's match data), limited to competitions the app covers.
 */
import { get } from './http';
import { LEAGUE_BY_SLUG, LEAGUES, type LeagueDef } from './leagues';

const SEARCH = 'https://site.web.api.espn.com/apis/common/v3/search';
// ESPN sport -> the app's sport
const SPORT: Record<string, string> = { soccer: 'football', basketball: 'basketball', football: 'american-football', hockey: 'ice-hockey', baseball: 'baseball' };

export type TeamHit = { id: string; espnId: string; name: string; abbr: string; color: string; logo: string | null; league: string; leagueName: string };
export type PlayerHit = { id: string; name: string; league: string; leagueName: string; sport: string };

const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Competitions whose name, short name or country contain every word of the query (as word starts). */
export function searchCompetitions(q: string): LeagueDef[] {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return LEAGUES.filter((l) => {
    const hay = fold(`${l.name} ${l.shortName} ${l.country ?? ''} ${l.slug}`).split(/[^a-z0-9.]+/);
    return words.every((w) => hay.some((h) => h.startsWith(w)));
  }).slice(0, 8);
}

/** Only results in competitions the app has (ESPN also returns women's leagues, colleges, MMA and so on). */
export function parseTeams(data: any): TeamHit[] {
  const out: TeamHit[] = [];
  for (const it of data?.items ?? []) {
    const slug = String(it?.defaultLeagueSlug ?? it?.league ?? '');
    const lg = LEAGUE_BY_SLUG[slug];
    const sport = SPORT[String(it?.sport ?? '')];
    if (it?.type !== 'team' || !lg || !sport || lg.sport !== sport || !it?.id) continue;
    out.push({
      id: `${sport}:${it.id}`,
      espnId: String(it.id),
      name: String(it.displayName ?? it.name ?? ''),
      abbr: String(it.abbreviation ?? '').toUpperCase(),
      color: /^[0-9a-f]{6}$/i.test(String(it.color ?? '')) ? `#${it.color}` : '#334155',
      logo: typeof it?.logos?.[0]?.href === 'string' ? it.logos[0].href : null,
      league: slug,
      leagueName: lg.shortName,
    });
  }
  return out;
}

export function parsePlayers(data: any): PlayerHit[] {
  const out: PlayerHit[] = [];
  for (const it of data?.items ?? []) {
    const slug = String(it?.league ?? '');
    const lg = LEAGUE_BY_SLUG[slug];
    const sport = SPORT[String(it?.sport ?? '')];
    if (it?.type !== 'player' || !lg || !sport || lg.sport !== sport || !it?.id) continue;
    out.push({ id: String(it.id), name: String(it.displayName ?? ''), league: slug, leagueName: lg.shortName, sport });
  }
  return out;
}

export async function searchAll(q: string): Promise<{ competitions: LeagueDef[]; teams: TeamHit[]; players: PlayerHit[]; error: boolean }> {
  const query = q.trim();
  const competitions = searchCompetitions(query);
  if (query.length < 2) return { competitions, teams: [], players: [], error: false };
  const url = (type: string) => `${SEARCH}?query=${encodeURIComponent(query)}&limit=25&type=${type}`;
  const [t, p] = await Promise.allSettled([get<any>(url('team'), { ttl: 600, retries: 1 }), get<any>(url('player'), { ttl: 600, retries: 1 })]);
  return {
    competitions,
    teams: t.status === 'fulfilled' ? parseTeams(t.value).slice(0, 10) : [],
    players: p.status === 'fulfilled' ? parsePlayers(p.value).slice(0, 12) : [],
    error: t.status === 'rejected' && p.status === 'rejected',
  };
}
