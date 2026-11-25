/**
 * What the "My team" home-screen widget shows: the favourite team's live match, otherwise its next match
 * (and the last result). Runs without the app open (Android calls the widget task), so it reads the saved
 * settings and asks ESPN's team schedule directly.
 */
import { LEAGUE_BY_SLUG } from '@/data/leagues';

export type WidgetTeam = { code: string; name: string; color: string; score: string | null };
export type WidgetState =
  | { kind: 'none'; reason: 'no_team' | 'unsupported' | 'offline' }
  | { kind: 'live' | 'next' | 'last'; matchId: string; competition: string; when: string; home: WidgetTeam; away: WidgetTeam; last?: string | null };

const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
const ok = (c: unknown) => (typeof c === 'string' && /^[0-9a-f]{6}$/i.test(c) ? `#${c}` : null);

function teamOf(c: any, fallbackColor: string): WidgetTeam {
  const score = c?.score && typeof c.score === 'object' ? c.score.displayValue : c?.score;
  return {
    code: String(c?.team?.abbreviation ?? c?.team?.shortDisplayName ?? '???').toUpperCase().slice(0, 4),
    name: String(c?.team?.shortDisplayName ?? c?.team?.displayName ?? ''),
    color: ok(c?.team?.color) ?? fallbackColor,
    score: score === undefined || score === null || score === '' ? null : String(score),
  };
}

const timeLabel = (iso: string, now: Date) => {
  const d = new Date(iso);
  const day = d.toDateString() === now.toDateString() ? 'Today' : d.toDateString() === new Date(now.getTime() + 86400000).toDateString() ? 'Tomorrow' : d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  return `${day} · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

/** Build the state from the two schedule responses (results newest first, fixtures soonest first). Exported for tests. */
export function stateFrom(results: any, fixtures: any, league: string, teamColor: string, now = new Date()): WidgetState {
  const all = [...(fixtures?.events ?? []), ...(results?.events ?? [])];
  const st = (e: any) => e?.competitions?.[0]?.status?.type?.state;
  const make = (e: any, kind: 'live' | 'next' | 'last', last?: string | null): WidgetState => {
    const c = e.competitions[0];
    const home = c.competitors.find((x: any) => x.homeAway === 'home');
    const away = c.competitors.find((x: any) => x.homeAway === 'away');
    const status = c?.status?.type;
    const when = kind === 'live' ? (status?.shortDetail ?? 'Live') : kind === 'last' ? 'Full time' : timeLabel(e.date, now);
    return { kind, matchId: `${league}~${e.id}`, competition: LEAGUE_BY_SLUG[league]?.shortName ?? league, when, home: teamOf(home, kind === 'live' ? teamColor : '#334155'), away: teamOf(away, '#334155'), last: last ?? null };
  };
  const live = all.find((e) => st(e) === 'in');
  if (live) return make(live, 'live');
  const lastE = (results?.events ?? []).find((e: any) => st(e) === 'post');
  const lastLine = lastE
    ? (() => {
        const c = lastE.competitions[0];
        const h = teamOf(c.competitors.find((x: any) => x.homeAway === 'home'), '#334155');
        const a = teamOf(c.competitors.find((x: any) => x.homeAway === 'away'), '#334155');
        return `Last: ${h.code} ${h.score ?? ''}–${a.score ?? ''} ${a.code}`;
      })()
    : null;
  const next = (fixtures?.events ?? []).find((e: any) => st(e) === 'pre');
  if (next) return make(next, 'next', lastLine);
  if (lastE) return make(lastE, 'last');
  return { kind: 'none', reason: 'offline' };
}

export async function loadWidgetState(prefs: any): Promise<WidgetState> {
  const fav = prefs?.favoriteTeam;
  if (!fav?.id) return { kind: 'none', reason: 'no_team' };
  const espnId = String(fav.id).split(':').pop();
  const league = (fav.leagues ?? []).find((l: string) => LEAGUE_BY_SLUG[l]?.format === 'match') as string | undefined;
  const lg = league ? LEAGUE_BY_SLUG[league] : null;
  if (!lg || !espnId) return { kind: 'none', reason: 'unsupported' };
  const url = (q: string) => `${SITE}/${lg.espnSport}/${lg.slug}/teams/${espnId}/schedule${q}`;
  try {
    const [r, f] = await Promise.all([fetch(url('')).then((x) => x.json()), fetch(url('?fixture=true')).then((x) => x.json())]);
    return stateFrom(r, f, lg.slug, fav.color ?? '#2CF59A');
  } catch {
    return { kind: 'none', reason: 'offline' };
  }
}
