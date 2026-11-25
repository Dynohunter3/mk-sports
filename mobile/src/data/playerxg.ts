/**
 * Player expected goals (xG) for the season, MK Sports' own estimate.
 *
 * - Every shot with a recorded position gets an xG value from the app's shot model (engine/xg.ts). Penalties
 *   use the observed conversion rate.
 * - Per match: each player's xG, non-penalty xG, shots, goals and minutes played (from the line-ups).
 *   Finished matches never change, so a match's figures are saved on the phone and computed only once.
 * - The season: the player's team's finished matches in that competition since the season began.
 * - Matches where positions are missing for more than a fifth of the shots (penalties aside) are left out,
 *   and the page says how many were used.
 */
import { useEffect, useState } from 'react';

import { parseLineups, parseShots, summaryUrl } from './centre';
import { ensureHistory } from './history';
import { get } from './http';
import { readKV, writeKV } from './kv';
import { LEAGUE_BY_SLUG } from './leagues';
import { xgFor } from '@/engine/xg';

/** athlete id -> [xg, non-penalty xg, shots, goals, non-penalty goals, minutes] */
export type MatchPlayerXg = { v: 1; usable: boolean; p: Record<string, [number, number, number, number, number, number]> };
export type SeasonXg = {
  matches: number; // matches with shot positions, in which the player appeared
  skipped: number; // team matches left out for missing shot positions
  minutes: number;
  shots: number;
  goals: number;
  xg: number;
  npxg: number;
  npGoals: number;
  xgPer90: number | null;
  npxgPer90: number | null;
};

const KEY = (league: string, id: string) => `pxg:v1:${league}:${id}`;
const FULL = 90;

const minuteOf = (s: string | null | undefined): number | null => {
  if (!s) return null;
  const m = /(\d+)\s*'?\s*(?:\+\s*(\d+))?/.exec(s);
  return m ? Math.min(FULL, Number(m[1])) : null;
};

/** Per-player figures for one match, from the match summary. Exported for tests. */
export function matchPlayerXg(data: any): MatchPlayerXg {
  const comp = data?.header?.competitions?.[0];
  const home = (comp?.competitors ?? []).find((c: any) => c?.homeAway === 'home');
  const homeId = String(home?.id ?? home?.team?.id ?? '');
  const homeName = home?.team?.displayName ?? '';
  const shots = parseShots(data, homeName, homeId);
  // penalties need no position (they use the conversion rate): coverage is measured on the other shots
  const open = shots.filter((s) => !s.penalty);
  const located = open.filter((s) => s.x !== null && s.y !== null).length;
  const usable = shots.length > 0 && (open.length === 0 || located / open.length >= 0.8);
  const p: MatchPlayerXg['p'] = {};
  const row = (id: string) => (p[id] ??= [0, 0, 0, 0, 0, 0]);
  const lu = parseLineups(data, homeId);
  // commentary names the shooter without an id: match the name to that side's line-up
  const byName: Record<'home' | 'away', Map<string, string>> = { home: new Map(), away: new Map() };
  const norm = (n: string) => n.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  if (lu) {
    for (const [key, side] of [['home', lu.home], ['away', lu.away]] as const) {
      for (const pl of [...side.rows.flat(), ...side.bench]) {
        if (!pl.id) continue;
        byName[key].set(norm(pl.name), pl.id);
        const inAt = pl.starter ? 0 : minuteOf(pl.subbedIn);
        if (inAt === null) continue; // an unused substitute
        const outAt = minuteOf(pl.subbedOut) ?? FULL;
        row(pl.id)[5] += Math.max(0, outAt - inAt);
      }
    }
  }
  if (usable) {
    for (const s of shots) {
      const id = s.playerId ?? (s.player ? byName[s.side].get(norm(s.player)) ?? byName[s.side === 'home' ? 'away' : 'home'].get(norm(s.player)) : undefined);
      if (!id) continue;
      if ((s.x === null || s.y === null) && !s.penalty) continue;
      const v = xgFor(s.x ?? 0, s.y ?? 0, s.penalty);
      const r = row(id);
      r[0] += v;
      if (!s.penalty) r[1] += v;
      r[2] += 1;
      if (s.goal) {
        r[3] += 1;
        if (!s.penalty) r[4] += 1;
      }
    }
  }
  return { v: 1, usable, p };
}

async function forMatch(league: string, espnId: string): Promise<MatchPlayerXg | null> {
  const saved = await readKV<MatchPlayerXg>(KEY(league, espnId));
  if (saved && saved.v === 1) return saved;
  try {
    const data = await get<any>(summaryUrl(league, espnId), { ttl: 3600, timeoutMs: 15000, retries: 1 });
    const r = matchPlayerXg(data);
    // only finished matches reach here (from the results history), so the figures are final
    await writeKV(KEY(league, espnId), r);
    return r;
  } catch {
    return null;
  }
}

export function seasonStart(league: string, now = Date.now()): number {
  const d = new Date(now);
  if (league === 'usa.1') return Date.UTC(d.getUTCFullYear(), 0, 1); // MLS is played within a calendar year
  const y = d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return Date.UTC(y, 6, 1);
}

export function aggregate(matches: MatchPlayerXg[], athleteId: string): SeasonXg {
  const s = { matches: 0, skipped: 0, minutes: 0, shots: 0, goals: 0, xg: 0, npxg: 0, npGoals: 0 };
  for (const m of matches) {
    if (!m.usable) {
      s.skipped += 1;
      continue;
    }
    const r = m.p[athleteId];
    if (!r || r[5] <= 0) continue;
    s.matches += 1;
    s.xg += r[0];
    s.npxg += r[1];
    s.shots += r[2];
    s.goals += r[3];
    s.npGoals += r[4];
    s.minutes += r[5];
  }
  const per = (v: number) => (s.minutes >= 90 ? (v / s.minutes) * 90 : null);
  return { ...s, xgPer90: per(s.xg), npxgPer90: per(s.npxg) };
}

/** The season figures for a player of `teamEspnId` in `league`; `onProgress(done, total)` while matches load. */
export async function playerSeasonXg(league: string, teamEspnId: string, athleteId: string, onProgress?: (done: number, total: number) => void): Promise<SeasonXg | null> {
  if (LEAGUE_BY_SLUG[league]?.sport !== 'football') return null;
  const team = teamEspnId.split(':').pop() ?? teamEspnId;
  const h = await ensureHistory(league);
  const from = seasonStart(league);
  const ids = h.matches.filter((m) => (m[2] === team || m[3] === team) && m[1] >= from && m[1] < Date.now()).map((m) => m[0]);
  if (!ids.length) return null;
  const out: MatchPlayerXg[] = [];
  let done = 0;
  const queue = [...ids];
  const worker = async () => {
    while (queue.length) {
      const id = queue.shift()!;
      const r = await forMatch(league, id);
      if (r) out.push(r);
      onProgress?.(++done, ids.length);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return aggregate(out, athleteId);
}

export function usePlayerSeasonXg(league: string | undefined, teamEspnId: string | null | undefined, athleteId: string | undefined) {
  const [state, setState] = useState<{ loading: boolean; done: number; total: number; data: SeasonXg | null }>({ loading: false, done: 0, total: 0, data: null });
  useEffect(() => {
    if (!league || !teamEspnId || !athleteId || LEAGUE_BY_SLUG[league]?.sport !== 'football') return;
    let alive = true;
    setState({ loading: true, done: 0, total: 0, data: null });
    playerSeasonXg(league, teamEspnId, athleteId, (done, total) => alive && setState((s) => ({ ...s, done, total })))
      .catch(() => null)
      .then((data) => alive && setState((s) => ({ ...s, loading: false, data })));
    return () => {
      alive = false;
    };
  }, [league, teamEspnId, athleteId]);
  return state;
}
