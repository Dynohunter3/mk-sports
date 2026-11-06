/**
 * Results history per competition: the last ~12 months of real finished matches, stored
 * compactly on the device. It feeds the ratings (Elo, attack/defence, net rating), form,
 * head-to-head and the walk-forward accuracy evaluation. Loaded once, then updated
 * incrementally (and from every live/finished match the app sees anyway).
 */
import type { Probs } from '@/engine';

import { scoreboard, scoreboardYear, SEvent, TeamInfo } from './espn';
import { readKV, removeKV, writeKV } from './kv';
import { LEAGUE_BY_SLUG, MATCH_LEAGUES, SportSlug } from './leagues';

const DAY = 86_400_000;
const windowDays = (slug: string) => LEAGUE_BY_SLUG[slug]?.historyDays ?? 365;
const keepDays = (slug: string) => windowDays(slug) + 35;
const REFRESH_MS = 6 * 3600 * 1000;
const KEY = (slug: string) => `hist:v1:${slug}`;

// [espnId, kickoff ms, home espnId, away espnId, homeScore, awayScore, neutral, mHome, mDraw, mAway]
export type Compact = [string, number, string, string, number, number, 0 | 1, number?, number?, number?];
// teams: espnId -> [name, short, abbr, colour, crest url]
export type LeagueHistory = { syncedTo: number; matches: Compact[]; teams: Record<string, [string, string, string, string, (string | null)?]> };

const histories = new Map<string, LeagueHistory>();
const loading = new Map<string, Promise<LeagueHistory>>();
const errors = new Map<string, string>();
let version = 0;
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const dirty = new Set<string>();

export const historyVersion = () => version;
export function onHistoryChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function bump() {
  version += 1;
  listeners.forEach((fn) => fn());
}

function scheduleSave(slug: string) {
  dirty.add(slug);
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    const slugs = [...dirty];
    dirty.clear();
    for (const s of slugs) {
      const h = histories.get(s);
      if (h) await writeKV(KEY(s), h);
    }
  }, 1500);
}

function rememberTeam(h: LeagueHistory, t: TeamInfo) {
  const prev = h.teams[t.espnId];
  h.teams[t.espnId] = [t.name, t.short, t.abbr, t.color, t.logo ?? prev?.[4] ?? null];
}

/** Merge finished matches into a league's history. Returns true if anything changed. */
function merge(h: LeagueHistory, events: SEvent[], slug: string): boolean {
  let changed = false;
  const idx = new Map(h.matches.map((m, i) => [m[0], i]));
  for (const e of events) {
    rememberTeam(h, e.home);
    rememberTeam(h, e.away);
    if (e.status !== 'finished' || e.homeScore === null || e.awayScore === null || e.preseason) continue;
    const m = e.market;
    const row: Compact = [e.espnId, Date.parse(e.start), e.home.espnId, e.away.espnId, e.homeScore, e.awayScore, e.neutral ? 1 : 0];
    if (m && m.home !== undefined && m.away !== undefined) row.push(m.home, m.draw ?? -1, m.away);
    const at = idx.get(e.espnId);
    if (at === undefined) {
      idx.set(e.espnId, h.matches.length);
      h.matches.push(row);
      changed = true;
    } else {
      const old = h.matches[at];
      if (old[4] !== row[4] || old[5] !== row[5]) {
        // a corrected score: keep any market prices we already had
        h.matches[at] = row.length > 7 ? row : ([...row, ...old.slice(7)] as Compact);
        changed = true;
      }
    }
  }
  if (changed) {
    const cutoff = Date.now() - keepDays(slug) * DAY;
    h.matches = h.matches.filter((m) => m[1] >= cutoff).sort((a, b) => a[1] - b[1]);
  }
  return changed;
}

/** Called with every batch of events the app fetches (keeps history fresh for free). */
export function ingest(slug: string, events: SEvent[]) {
  const h = histories.get(slug);
  if (!h) return;
  if (merge(h, events, slug)) {
    scheduleSave(slug);
    bump();
  }
}

async function fetchRange(slug: string, from: number, to: number): Promise<SEvent[]> {
  // A calendar year that starts inside the window is one request; the partial year before it is
  // fetched month by month, so nothing outside the window is downloaded.
  const out: SEvent[] = [];
  const fromYear = new Date(from).getUTCFullYear();
  const toYear = new Date(to).getUTCFullYear();
  const yearly = !!LEAGUE_BY_SLUG[slug].yearly; // e.g. NBA/NHL/MLB years exceed the 1000-event page
  for (let y = fromYear; y <= toYear; y++) {
    const yStart = Date.UTC(y, 0, 1);
    const yEnd = Date.UTC(y + 1, 0, 1) - 1;
    if (yearly && yStart >= from) out.push(...(await scoreboardYear(slug, y, 3600)).events);
    else out.push(...(await scoreboard(slug, new Date(Math.max(from, yStart)), new Date(Math.min(to, yEnd)), 3600)).events);
  }
  return out;
}

export function historyError(slug: string) {
  return errors.get(slug) ?? null;
}

/** Load (or refresh) one league's history. Safe to call often. */
export function ensureHistory(slug: string): Promise<LeagueHistory> {
  const cur = histories.get(slug);
  if (cur && Date.now() - cur.syncedTo < REFRESH_MS) return Promise.resolve(cur);
  if (loading.has(slug)) return loading.get(slug)!;
  const p = (async () => {
    let h = cur ?? (await readKV<LeagueHistory>(KEY(slug)));
    const now = Date.now();
    try {
      if (!h || !h.matches) {
        h = { syncedTo: 0, matches: [], teams: {} };
        merge(h, await fetchRange(slug, now - windowDays(slug) * DAY, now), slug);
      } else if (now - h.syncedTo >= REFRESH_MS) {
        merge(h, await fetchRange(slug, Math.max(now - windowDays(slug) * DAY, h.syncedTo - 3 * DAY), now), slug);
      }
      h.syncedTo = now;
      errors.delete(slug);
      histories.set(slug, h);
      scheduleSave(slug);
      bump();
      return h;
    } catch (e) {
      errors.set(slug, e instanceof Error ? e.message : 'failed');
      if (h) {
        histories.set(slug, h); // keep serving what we have (offline)
        return h;
      }
      throw e;
    } finally {
      loading.delete(slug);
    }
  })();
  loading.set(slug, p);
  return p;
}

/** Load history for every competition in a sport (3 at a time). Resolves when all settle. */
export async function ensureSport(sport: SportSlug): Promise<void> {
  const slugs = MATCH_LEAGUES.filter((l) => l.sport === sport).map((l) => l.slug);
  const queue = [...slugs];
  const workers = Array.from({ length: 3 }, async () => {
    while (queue.length) {
      const s = queue.shift()!;
      await ensureHistory(s).catch(() => undefined);
    }
  });
  await Promise.all(workers);
}

export const sportReady = (sport: SportSlug) => MATCH_LEAGUES.filter((l) => l.sport === sport).every((l) => histories.has(l.slug) || errors.has(l.slug));
export const loadedHistory = (slug: string) => histories.get(slug) ?? null;

export type HistMatch = { espnId: string; league: string; date: Date; home: string; away: string; homeScore: number; awayScore: number; neutral: boolean; market: Probs | null };

export function sportMatches(sport: SportSlug, before?: number): HistMatch[] {
  const out: HistMatch[] = [];
  for (const l of MATCH_LEAGUES) {
    if (l.sport !== sport) continue;
    const h = histories.get(l.slug);
    if (!h) continue;
    for (const m of h.matches) {
      if (before !== undefined && m[1] >= before) continue;
      const market = m.length > 7 ? ((m[8] ?? -1) >= 0 ? { home: m[7]!, draw: m[8]!, away: m[9]! } : { home: m[7]!, away: m[9]! }) : null;
      out.push({ espnId: m[0], league: l.slug, date: new Date(m[1]), home: m[2], away: m[3], homeScore: m[4], awayScore: m[5], neutral: !!m[6], market });
    }
  }
  return out.sort((a, b) => a.date.getTime() - b.date.getTime() || (a.espnId < b.espnId ? -1 : 1));
}

export function teamInfo(sport: SportSlug, espnId: string): TeamInfo | null {
  for (const l of MATCH_LEAGUES) {
    if (l.sport !== sport) continue;
    const t = histories.get(l.slug)?.teams[espnId];
    if (t) return { id: `${sport}:${espnId}`, espnId, name: t[0], short: t[1], abbr: t[2], color: t[3], logo: t[4] ?? null };
  }
  return null;
}

export async function clearHistory() {
  histories.clear();
  await removeKV('hist:');
  bump();
}
