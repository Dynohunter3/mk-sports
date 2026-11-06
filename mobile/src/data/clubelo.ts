/**
 * ClubElo (clubelo.com): independent Elo ratings for European clubs. Its public API
 * publishes outcome probabilities for upcoming fixtures as CSV (one request covers every
 * fixture). We read the goal-difference distribution and sum it into home/draw/away.
 */
import type { Probs } from '@/engine';

import type { SEvent } from './espn';
import { get } from './http';
import { LEAGUE_BY_SLUG } from './leagues';

export const CLUBELO_URL = 'https://api.clubelo.com/Fixtures';
/**
 * Off in this release: ClubElo's API did not complete an HTTPS connection during testing (it
 * appears to be plain-HTTP only, which Android blocks by default), so its data could not be
 * verified. Flip to true once it is reachable over HTTPS and checked against live data.
 */
export const CLUBELO_ENABLED = false;

export type EloFixture = { date: string; country: string; home: string; away: string; probs: Probs };

export function parseFixturesCsv(csv: string): EloFixture[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const head = lines[0].split(',').map((h) => h.trim());
  const col = (name: string) => head.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const iDate = col('Date');
  const iCountry = col('Country');
  const iHome = col('Home');
  const iAway = col('Away');
  // goal-difference buckets: "GD<-5", "GD=-1", "GD=0", "GD>5" ...
  const gd = head
    .map((h, i) => {
      const m = /^GD\s*([<>=])\s*(-?\d+)$/i.exec(h);
      if (!m) return null;
      const v = Number(m[2]);
      return { i, sign: m[1] === '<' ? -1 : m[1] === '>' ? 1 : Math.sign(v) };
    })
    .filter(Boolean) as { i: number; sign: number }[];
  if (iHome < 0 || iAway < 0 || !gd.length) return [];
  const out: EloFixture[] = [];
  for (const line of lines.slice(1)) {
    const c = line.split(',');
    let h = 0;
    let d = 0;
    let a = 0;
    for (const g of gd) {
      const p = Number(c[g.i]);
      if (!Number.isFinite(p)) continue;
      if (g.sign > 0) h += p;
      else if (g.sign < 0) a += p;
      else d += p;
    }
    const z = h + d + a;
    if (z <= 0) continue;
    out.push({ date: (c[iDate] ?? '').trim(), country: (c[iCountry] ?? '').trim(), home: (c[iHome] ?? '').trim(), away: (c[iAway] ?? '').trim(), probs: { home: h / z, draw: d / z, away: a / z } });
  }
  return out;
}

const STOP = new Set(['fc', 'afc', 'cf', 'sc', 'ac', 'as', 'ssc', 'club', 'de', 'calcio', 'sv', 'vfl', 'vfb', 'fk', 'sk', 'cd', 'ud', 'rc', 'rcd', 'og', 'ogc', 'the', 'hotspur', 'albion', 'and']);
const ALIASES: Record<string, string> = {
  'man city': 'manchester city',
  'man united': 'manchester united',
  'man utd': 'manchester united',
  forest: 'nottingham forest',
  "nott'm forest": 'nottingham forest',
  wolves: 'wolverhampton wanderers',
  spurs: 'tottenham',
  'paris sg': 'paris saint germain',
  psg: 'paris saint germain',
  inter: 'internazionale',
  milan: 'ac milan',
  gladbach: 'monchengladbach',
  leverkusen: 'bayer leverkusen',
  bayern: 'bayern munich',
  atletico: 'atletico madrid',
  betis: 'real betis',
  sociedad: 'real sociedad',
  celta: 'celta vigo',
};

export function normName(s: string): string {
  const base = s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9' ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const aliased = ALIASES[base] ?? base;
  return aliased
    .split(' ')
    .filter((w) => w && !STOP.has(w))
    .join(' ');
}

function trigrams(s: string): Set<string> {
  const t = `  ${s} `;
  const out = new Set<string>();
  for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3));
  return out;
}

export function nameSimilarity(a: string, b: string): number {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.9;
  const tx = trigrams(x);
  const ty = trigrams(y);
  let inter = 0;
  tx.forEach((g) => ty.has(g) && inter++);
  return inter / (tx.size + ty.size - inter);
}

const bestName = (names: string[], target: string) => Math.max(...names.map((n) => nameSimilarity(n, target)));

/** Find ClubElo's forecast for an ESPN event (same day, best name match on both sides). */
export function matchFixture(ev: SEvent, fixtures: EloFixture[]): EloFixture | null {
  const day = ev.start.slice(0, 10);
  const prev = new Date(Date.parse(ev.start) - 86_400_000).toISOString().slice(0, 10);
  const country = LEAGUE_BY_SLUG[ev.league]?.clubelo;
  const cands = fixtures.filter((f) => (f.date === day || f.date === prev) && (!country || !f.country || f.country === country));
  let best: EloFixture | null = null;
  let bestScore = 0;
  const hn = [ev.home.name, ev.home.short];
  const an = [ev.away.name, ev.away.short];
  for (const f of cands) {
    const sh = bestName(hn, f.home);
    const sa = bestName(an, f.away);
    if (sh < 0.45 || sa < 0.45) continue;
    if (sh + sa > bestScore) {
      best = f;
      bestScore = sh + sa;
    }
  }
  return best;
}

let cache: { at: number; rows: EloFixture[] } | null = null;

export async function clubEloFixtures(): Promise<EloFixture[]> {
  if (!CLUBELO_ENABLED) return [];
  if (cache && Date.now() - cache.at < 3600_000) return cache.rows;
  const csv = await get<string>(CLUBELO_URL, { ttl: 3600, kind: 'text', retries: 1 });
  cache = { at: Date.now(), rows: parseFixturesCsv(csv) };
  return cache.rows;
}

/** Synchronous lookup against whatever is already loaded (never blocks rendering). */
export function clubEloFor(ev: SEvent): Probs | null {
  if (!CLUBELO_ENABLED || ev.sport !== 'football' || !cache) return null;
  const lg = LEAGUE_BY_SLUG[ev.league];
  if (!lg?.clubelo && ev.league !== 'uefa.champions') return null;
  return matchFixture(ev, cache.rows)?.probs ?? null;
}
