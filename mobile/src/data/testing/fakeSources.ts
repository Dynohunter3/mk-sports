/**
 * Test double for the public sources (ESPN feed + ClubElo CSV) with payloads shaped like
 * the real ones. Used by unit tests and by the browser UI test; never by the app itself.
 */
export const DAY = 86_400_000;
export const NOW = Date.now();
export const EPL = ['Arsenal', 'Chelsea', 'Liverpool', 'Manchester City', 'Manchester United', 'Tottenham Hotspur', 'Newcastle United', 'Aston Villa', 'Brighton & Hove Albion', 'West Ham United'];
export const NBA = ['Boston Celtics', 'Los Angeles Lakers', 'Denver Nuggets', 'Miami Heat', 'Golden State Warriors', 'Oklahoma City Thunder'];

function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

export type Ev = { id: string; t: number; h: number; a: number; hs: number | null; as: number | null; state: 'pre' | 'in' | 'post'; name: string; odds?: [number, number, number] };
export const db: Record<string, Ev[]> = { 'eng.1': [], nba: [] };

export function buildWorld() {
  const r = rng(7);
  const strength = EPL.map((_, i) => 0.5 - i * 0.08);
  let id = 1000;
  for (let d = 300; d >= 2; d -= 3) {
    for (let k = 0; k < 4; k++) {
      const h = Math.floor(r() * EPL.length);
      let a = Math.floor(r() * EPL.length);
      if (a === h) a = (a + 1) % EPL.length;
      const lam = (x: number) => Math.max(0.2, 1.35 + x);
      const goals = (l: number) => Math.min(6, Math.floor(-Math.log(r() + 1e-9) * l * 0.9));
      db['eng.1'].push({ id: String(id++), t: NOW - d * DAY + k * 3600_000, h, a, hs: goals(lam(strength[h] - strength[a] + 0.15)), as: goals(lam(strength[a] - strength[h])), state: 'post', name: 'STATUS_FULL_TIME' });
    }
  }
  // today: one live, one later today (with odds), one tomorrow
  db['eng.1'].push({ id: '9001', t: NOW - 30 * 60_000, h: 0, a: 1, hs: 1, as: 0, state: 'in', name: 'STATUS_FIRST_HALF' });
  db['eng.1'].push({ id: '9002', t: NOW + 3 * 3600_000, h: 2, a: 9, hs: null, as: null, state: 'pre', name: 'STATUS_SCHEDULED', odds: [-250, 600, 380] });
  db['eng.1'].push({ id: '9003', t: NOW + 26 * 3600_000, h: 3, a: 4, hs: null, as: null, state: 'pre', name: 'STATUS_SCHEDULED' });
  for (let d = 150; d >= 1; d -= 1) {
    const h = d % NBA.length;
    const a = (d * 7 + 1) % NBA.length === h ? (h + 1) % NBA.length : (d * 7 + 1) % NBA.length;
    const margin = Math.round((NBA.length - h - (NBA.length - a)) * 2 + 3 + (r() - 0.5) * 24) || 1;
    db.nba.push({ id: String(id++), t: NOW - d * DAY, h, a, hs: 110 + Math.max(margin, 0), as: 110 + Math.max(-margin, 0), state: 'post', name: 'STATUS_FINAL' });
  }
  db.nba.push({ id: '9101', t: NOW + 5 * 3600_000, h: 0, a: 1, hs: null, as: null, state: 'pre', name: 'STATUS_SCHEDULED' });
}

const teamJson = (names: string[], i: number) => ({ id: String(100 + i), displayName: names[i], shortDisplayName: names[i].split(' ').slice(-1)[0], abbreviation: names[i].slice(0, 3).toUpperCase(), color: 'cc0000' });

export function eventJson(slug: string, e: Ev) {
  const names = slug === 'nba' ? NBA : EPL;
  return {
    id: e.id,
    date: new Date(e.t).toISOString(),
    competitions: [
      {
        id: e.id,
        date: new Date(e.t).toISOString(),
        venue: { fullName: `${names[e.h]} Arena` },
        neutralSite: false,
        competitors: [
          { homeAway: 'home', score: e.hs === null ? '0' : String(e.hs), team: teamJson(names, e.h) },
          { homeAway: 'away', score: e.as === null ? '0' : String(e.as), team: teamJson(names, e.a) },
        ],
        status: { displayClock: "34'", period: 1, type: { name: e.name, state: e.state, completed: e.state === 'post' } },
        // real feed: prices only before kick-off (modern layout), [null] afterwards
        odds: e.odds && e.state === 'pre' ? [{ drawOdds: { moneyLine: e.odds[2] }, moneyline: { home: { close: { odds: String(e.odds[0]) } }, away: { close: { odds: `+${e.odds[1]}` } }, draw: { close: { odds: `+${e.odds[2]}` } } } }] : [null],
        details: e.state !== 'pre' && e.hs ? [{ type: { text: 'Goal' }, clock: { displayValue: "12'" }, team: { id: String(100 + e.h) }, scoringPlay: true, athletesInvolved: [{ displayName: 'B. Saka' }] }] : [],
      },
    ],
  };
}

const ymd = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
export const requests: string[] = [];

export const fakeFetch = (async (input: RequestInfo | URL) => {
  const url = new URL(String(input));
  requests.push(url.pathname + url.search);
  const ok = (body: unknown, text = false) => ({ ok: true, status: 200, json: async () => body, text: async () => (text ? (body as string) : JSON.stringify(body)) }) as Response;
  if (url.host === 'api.clubelo.com') {
    const d = new Date(NOW + 3 * 3600_000).toISOString().slice(0, 10);
    return ok(`Date,Country,Home,Away,GD<-5,GD=-1,GD=0,GD=1,GD>5\n${d},ENG,Liverpool,West Ham,0.02,0.10,0.18,0.40,0.30\n`, true);
  }
  const m = /sports\/(soccer|basketball)\/([^/]+)\/(scoreboard|summary|standings|teams)/.exec(url.pathname);
  if (!m) return { ok: false, status: 404, json: async () => ({}), text: async () => '' } as Response;
  const slug = m[2];
  const list = db[slug] ?? [];
  if (m[3] === 'scoreboard') {
    const dates = url.searchParams.get('dates');
    let from: number;
    let to: number;
    if (!dates) [from, to] = [NOW - DAY, NOW + 2 * DAY]; // "current" view
    else if (/^\d{4}$/.test(dates)) [from, to] = [Date.UTC(+dates, 0, 1), Date.UTC(+dates + 1, 0, 1)];
    else if (/^\d{6}$/.test(dates)) [from, to] = [Date.UTC(+dates.slice(0, 4), +dates.slice(4) - 1, 1), Date.UTC(+dates.slice(0, 4), +dates.slice(4), 1)];
    else if (/^\d{8}$/.test(dates)) [from, to] = [ymd(dates), ymd(dates) + DAY];
    else return { ok: false, status: 400, json: async () => ({ code: 400, message: 'Failed to get events endpoint.' }), text: async () => '' } as Response; // like the real API
    return ok({ leagues: [{ season: { displayName: '2026-27' } }], events: list.filter((e) => e.t >= from && e.t < to).map((e) => eventJson(slug, e)) });
  }
  if (m[3] === 'summary') {
    const e = list.find((x) => x.id === url.searchParams.get('event'))!;
    const ev = eventJson(slug, e);
    const series = list.filter((x) => x.state === 'post' && ((x.h === e.h && x.a === e.a) || (x.h === e.a && x.a === e.h))).slice(-3);
    const seasonseries = [{ type: 'head-to-head', events: series.map((x) => ({ id: x.id, date: new Date(x.t).toISOString(), statusType: { completed: true }, competitors: [{ homeAway: 'home', score: String(x.hs), team: { id: String(100 + x.h) } }, { homeAway: 'away', score: String(x.as), team: { id: String(100 + x.a) } }] })) }];
    return ok({ header: { id: e.id, competitions: ev.competitions }, seasonseries, ...(slug === 'nba' ? { injuries: [{ team: { id: String(100 + e.h) }, injuries: [{ status: 'Out', athlete: { displayName: 'Star Player', position: { abbreviation: 'F' } }, details: { type: 'Knee' } }] }], leaders: [{ leaders: [{ leaders: [{ athlete: { displayName: 'Star Player' } }] }] }], predictor: { homeTeam: { gameProjection: '61.0' }, awayTeam: { gameProjection: '39.0' } } } : {}) });
  }
  if (m[3] === 'standings') {
    const names = slug === 'nba' ? NBA : EPL;
    return ok({ children: [{ name: 'Table', standings: { entries: names.map((n, i) => ({ team: teamJson(names, i), stats: [{ name: 'rank', value: i + 1 }, { name: 'gamesPlayed', value: 10 }, { name: 'wins', value: 10 - i }, { name: 'ties', value: 0 }, { name: 'losses', value: i }, { name: 'points', value: 30 - 3 * i }] })) } }] });
  }
  const names = slug === 'nba' ? NBA : EPL;
  return ok({ sports: [{ leagues: [{ teams: names.map((_, i) => ({ team: teamJson(names, i) })) }] }] });
}) as typeof fetch;

