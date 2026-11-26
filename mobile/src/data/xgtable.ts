/**
 * The xG table: each team's expected points from the chances in its league matches this season, next to the
 * points it actually took. Worked out on the phone from ESPN's shot positions with the app's xG model.
 *
 * - Per match: every shot's xG for each side (penalties at the observed conversion rate). A match's shots are
 *   saved on the phone once it has finished, so each match is downloaded only once.
 * - Expected points: from the exact chance of each result on those shots (engine/xgresult.ts).
 * - Matches missing positions for more than a fifth of their open-play shots are left out, for both teams,
 *   and the table says how many.
 */
import { useEffect, useState } from 'react';

import { deservedResult } from '@/engine/xgresult';
import { xgFor } from '@/engine/xg';

import { parseShots, summaryUrl } from './centre';
import { ensureHistory } from './history';
import { get } from './http';
import { readKV, writeKV } from './kv';
import { LEAGUE_BY_SLUG } from './leagues';
import { seasonStart } from './playerxg';

export type MatchShots = { v: 1; usable: boolean; h: number[]; a: number[] };
export type XgRow = {
  team: { id: string; name: string; short_name: string; color: string; logo: string | null };
  matches: number;
  xgFor: number;
  xgAgainst: number;
  xpts: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
};
export type XgTable = { rows: XgRow[]; used: number; skipped: number; total: number };

const KEY = (league: string, id: string) => `txg:v1:${league}:${id}`;

/** Each side's shot xG values from a match summary. Exported for tests. */
export function matchShots(data: any): MatchShots {
  const comp = data?.header?.competitions?.[0];
  const home = (comp?.competitors ?? []).find((c: any) => c?.homeAway === 'home');
  const shots = parseShots(data, home?.team?.displayName ?? '', String(home?.id ?? home?.team?.id ?? ''));
  const open = shots.filter((s) => !s.penalty);
  const located = open.filter((s) => s.x !== null && s.y !== null).length;
  const usable = shots.length > 0 && (open.length === 0 || located / open.length >= 0.8);
  const out: MatchShots = { v: 1, usable, h: [], a: [] };
  if (!usable) return out;
  for (const s of shots) {
    if ((s.x === null || s.y === null) && !s.penalty) continue;
    const v = Math.round(xgFor(s.x ?? 0, s.y ?? 0, s.penalty) * 1000) / 1000;
    (s.side === 'home' ? out.h : out.a).push(v);
  }
  return out;
}

async function forMatch(league: string, id: string): Promise<MatchShots | null> {
  const saved = await readKV<MatchShots>(KEY(league, id));
  if (saved && saved.v === 1) return saved;
  try {
    const r = matchShots(await get<any>(summaryUrl(league, id), { ttl: 3600, timeoutMs: 15000, retries: 1 }));
    await writeKV(KEY(league, id), r); // finished matches only (from the results history): final figures
    return r;
  } catch {
    return null;
  }
}

/** Build the table from matches: [id, home, away, homeGoals, awayGoals] with their shots. Exported for tests. */
export function tableFrom(matches: { home: string; away: string; hg: number; ag: number; shots: MatchShots | null }[], teams: Record<string, XgRow['team']>): XgTable {
  const rows = new Map<string, XgRow>();
  const row = (id: string) => {
    let r = rows.get(id);
    if (!r) {
      r = { team: teams[id] ?? { id, name: id, short_name: id, color: '#888888', logo: null }, matches: 0, xgFor: 0, xgAgainst: 0, xpts: 0, points: 0, goalsFor: 0, goalsAgainst: 0 };
      rows.set(id, r);
    }
    return r;
  };
  let used = 0;
  let skipped = 0;
  for (const m of matches) {
    if (!m.shots || !m.shots.usable) {
      skipped += 1;
      continue;
    }
    used += 1;
    const d = deservedResult(m.shots.h, m.shots.a);
    const xh = m.shots.h.reduce((a, b) => a + b, 0);
    const xa = m.shots.a.reduce((a, b) => a + b, 0);
    for (const [id, xf, xa_, xp, gf, ga] of [
      [m.home, xh, xa, d.xptsHome, m.hg, m.ag],
      [m.away, xa, xh, d.xptsAway, m.ag, m.hg],
    ] as const) {
      const r = row(id);
      r.matches += 1;
      r.xgFor += xf;
      r.xgAgainst += xa_;
      r.xpts += xp;
      r.goalsFor += gf;
      r.goalsAgainst += ga;
      r.points += gf > ga ? 3 : gf === ga ? 1 : 0;
    }
  }
  const out = [...rows.values()].sort((a, b) => b.xpts - a.xpts || b.xgFor - b.xgAgainst - (a.xgFor - a.xgAgainst));
  return { rows: out, used, skipped, total: matches.length };
}

export async function buildXgTable(league: string, onProgress?: (done: number, total: number) => void): Promise<XgTable | null> {
  if (LEAGUE_BY_SLUG[league]?.sport !== 'football') return null;
  const h = await ensureHistory(league);
  const from = seasonStart(league);
  const list = h.matches.filter((m) => m[1] >= from && m[1] < Date.now() - 3 * 3600 * 1000);
  if (!list.length) return null;
  const shots = new Map<string, MatchShots | null>();
  let done = 0;
  const queue = list.map((m) => m[0]);
  const worker = async () => {
    while (queue.length) {
      const id = queue.shift()!;
      shots.set(id, await forMatch(league, id));
      onProgress?.(++done, list.length);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  const teams: Record<string, XgRow['team']> = {};
  for (const [id, t] of Object.entries(h.teams)) teams[id] = { id, name: t[0], short_name: t[1], color: t[3], logo: t[4] ?? null };
  return tableFrom(
    list.map((m) => ({ home: m[2], away: m[3], hg: m[4], ag: m[5], shots: shots.get(m[0]) ?? null })),
    teams,
  );
}

/** How many of this season's league matches still need downloading (for the data-saver prompt). */
export async function xgTableToFetch(league: string): Promise<number> {
  const h = await ensureHistory(league);
  const from = seasonStart(league);
  let n = 0;
  for (const m of h.matches) if (m[1] >= from && m[1] < Date.now() - 3 * 3600 * 1000 && !(await readKV<MatchShots>(KEY(league, m[0])))) n++;
  return n;
}

export function useXgTable(league: string, enabled: boolean) {
  const [state, setState] = useState<{ loading: boolean; done: number; total: number; data: XgTable | null }>({ loading: false, done: 0, total: 0, data: null });
  useEffect(() => {
    if (!enabled || LEAGUE_BY_SLUG[league]?.sport !== 'football') return;
    let alive = true;
    setState({ loading: true, done: 0, total: 0, data: null });
    buildXgTable(league, (done, total) => alive && setState((s) => ({ ...s, done, total })))
      .catch(() => null)
      .then((data) => alive && setState((s) => ({ ...s, loading: false, data })));
    return () => {
      alive = false;
    };
  }, [league, enabled]);
  return state;
}
