/**
 * Other files the MK Sports pipeline publishes next to the predictions (GitHub Pages first, the
 * `predictions` branch as the mirror):
 *   - simulations.json: the season simulator (title, top four, promotion, relegation chances);
 *   - elo/<competition>.json: each team's rating history (the model's own Elo);
 *   - proof.json: the public commit that first published each prediction.
 * Each is cached on the device; a failed download keeps the last good copy.
 */
import { useEffect, useState } from 'react';

import { get } from './http';
import { readKV, writeKV } from './kv';
import { bestSim } from './names';

export const SITE_BASES = ['https://dynohunter3.github.io/mk-sports/', 'https://raw.githubusercontent.com/Dynohunter3/mk-sports/predictions/'];
export const REPO_URL = 'https://github.com/Dynohunter3/mk-sports';
const REFRESH_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------------------- types
export type SimZoneKey = 'title' | 'top4' | 'europe' | 'promotion' | 'playoffs' | 'relegation';
export type SimZone = { key: SimZoneKey; from: number; to: number; label: string };
export type SimTeam = {
  id: string;
  name: string;
  aliases: string[];
  played: number;
  points: number;
  gd: number;
  gf: number;
  exp_points: number;
  points_range: [number, number];
  /** chance of each finishing place, 1st first */
  positions: number[];
  zones: Partial<Record<SimZoneKey, number>>;
  week_ago?: Partial<Record<SimZoneKey, number>>;
};
export type SimLeague = {
  competition: string;
  season: string;
  played: number;
  remaining: number;
  from_predictions: number;
  zones: SimZone[];
  week_ago: { at: string; backfilled: boolean } | null;
  teams: SimTeam[];
};
export type SimDoc = {
  schema: 1;
  generated_at: string;
  model_version: string;
  simulations: number;
  method: string;
  notice: string;
  competitions: SimLeague[];
  not_simulated: Record<string, string>;
  /** the simulator's backtest on finished seasons (Brier score per zone; lower is better) */
  tested?: {
    source: string;
    period: string;
    league_seasons: number;
    zones: Partial<Record<SimZoneKey, { n: number; events: number; brier: number; brier_table_now: number; brier_base_rate: number }>>;
    positions: { teams: number; rps: number; rps_stays_where_it_is: number };
    calibration: { from: number; to: number; n: number; mean_p: number; happened: number }[];
  } | null;
};
export type EloTeam = { id: string; name: string; aliases: string[]; rating: number; rank: number; points: [number, number][] };
export type EloDoc = {
  schema: 1;
  generated_at: string;
  competition: string;
  season: string;
  about: string;
  league_average: [string, number][];
  teams: EloTeam[];
};
export type ProofEntry = { commit: string; at: string; kickoff: string; run?: string };
export type ProofDoc = { schema: 1; repository: string; updated_at: string; entries: Record<string, ProofEntry> };

// ---------------------------------------------------------------------------- loading
type Slot<T> = { value: T | null; at: number; loading: Promise<T | null> | null; subs: Set<(v: T | null) => void> };
const slots = new Map<string, Slot<unknown>>();

function slot<T>(path: string): Slot<T> {
  let s = slots.get(path) as Slot<T> | undefined;
  if (!s) {
    s = { value: null, at: 0, loading: null, subs: new Set() };
    slots.set(path, s as Slot<unknown>);
  }
  return s;
}

/** Fetch a published file (best effort, at most every 30 min); falls back to the saved copy. */
export async function loadPublished<T>(path: string, valid: (x: unknown) => x is T, force = false): Promise<T | null> {
  const s = slot<T>(path);
  if (s.loading) return s.loading;
  if (!force && s.value && Date.now() - s.at < REFRESH_MS) return s.value;
  s.loading = (async () => {
    const key = `pub:${path}`;
    if (!s.value) {
      const saved = await readKV<T>(key);
      if (valid(saved)) s.value = saved;
    }
    const bucket = Math.floor(Date.now() / REFRESH_MS);
    for (const base of SITE_BASES) {
      try {
        const x = await get<unknown>(`${base}${path}?t=${bucket}`, { ttl: 600, timeoutMs: 12000, retries: 1 });
        if (!valid(x)) continue;
        s.value = x;
        s.at = Date.now();
        await writeKV(key, x);
        break;
      } catch {
        // next mirror
      }
    }
    for (const fn of s.subs) fn(s.value);
    return s.value;
  })().finally(() => {
    s.loading = null;
  });
  return s.loading;
}

function usePublished<T>(path: string | null, valid: (x: unknown) => x is T): T | null {
  const [v, setV] = useState<T | null>(path ? slot<T>(path).value : null);
  useEffect(() => {
    if (!path) {
      setV(null);
      return;
    }
    const s = slot<T>(path);
    setV(s.value);
    const fn = (x: T | null) => setV(x);
    s.subs.add(fn);
    void loadPublished(path, valid);
    return () => {
      s.subs.delete(fn);
    };
  }, [path, valid]);
  return v;
}

export const isSimDoc = (x: unknown): x is SimDoc => !!x && (x as SimDoc).schema === 1 && Array.isArray((x as SimDoc).competitions);
export const isEloDoc = (x: unknown): x is EloDoc => !!x && (x as EloDoc).schema === 1 && Array.isArray((x as EloDoc).teams);
export const isProofDoc = (x: unknown): x is ProofDoc => !!x && (x as ProofDoc).schema === 1 && typeof (x as ProofDoc).entries === 'object';

export const useSimulations = () => usePublished<SimDoc>('simulations.json', isSimDoc);
export const useEloHistory = (league: string | null | undefined) => usePublished<EloDoc>(league ? `elo/${league}.json` : null, isEloDoc);
export const useProof = () => usePublished<ProofDoc>('proof.json', isProofDoc);

// ---------------------------------------------------------------------------- lookups
/** A simulated league, if it is fresh enough to show (the job runs every 6 hours; 4 days of slack). */
export function simLeague(doc: SimDoc | null, league: string, now = Date.now()): SimLeague | null {
  if (!doc || now - Date.parse(doc.generated_at) > 4 * 86400 * 1000) return null;
  return doc.competitions.find((c) => c.competition === league) ?? null;
}

/** Match an app team (ESPN names) to a published team by every source's spelling. */
export function matchTeam<T extends { aliases: string[] }>(teams: T[], names: (string | null | undefined)[]): T | null {
  const ns = names.filter((x): x is string => !!x);
  let best: T | null = null;
  let score = 0;
  for (const t of teams) {
    const s = bestSim(ns, t.aliases);
    if (s > score) {
      score = s;
      best = t;
    }
  }
  return score >= 0.75 ? best : null;
}

/** Change since last week in whole percentage points, or null when it is within simulation noise (under 2 points). */
export function weeklyChange(t: SimTeam, key: SimZoneKey): number | null {
  const now = t.zones[key];
  const then = t.week_ago?.[key];
  if (now == null || then == null) return null;
  const d = Math.round(100 * (now - then));
  return Math.abs(d) >= 2 ? d : null;
}

/** "34%", "<1%", ">99%": simulation results never claim certainty they don't have. */
export function simPct(p: number | undefined): string {
  if (p == null) return '–';
  // not happening in any of 10,000 simulations is not the same as impossible, and the reverse
  if (p < 0.005) return '<1%';
  if (p >= 0.995) return '>99%';
  return `${Math.round(100 * p)}%`;
}

/** The headline zone for a team: the one that is most in play (closest to 50%), title first on ties. */
export function headlineZone(league: SimLeague, t: SimTeam): SimZone | null {
  let best: SimZone | null = null;
  let bestScore = -1;
  for (const z of league.zones) {
    const p = t.zones[z.key];
    if (p == null) continue;
    const score = Math.min(p, 1 - p) + (z.key === 'title' ? 0.02 : 0);
    if (p >= 0.01 && score > bestScore) {
      best = z;
      bestScore = score;
    }
  }
  return best;
}

export function proofFor(doc: ProofDoc | null, matchId: string, madeAt: string | undefined): ProofEntry | null {
  if (!doc || !madeAt) return null;
  return doc.entries[`${matchId}@${madeAt}`] ?? null;
}

export const commitUrl = (sha: string) => `${REPO_URL}/commit/${sha}`;
export const RECORD_PAGE = `${SITE_BASES[0]}record.html`;
