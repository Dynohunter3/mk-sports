/**
 * Football predictions published by the MK Sports data pipeline (pipeline/mkmodel/production.py).
 *
 * The daily job publishes `football_predictions.json` to GitHub Pages, with a mirror on the
 * repository's `predictions` branch. The app downloads it, keeps the last good copy on the device,
 * and matches each ESPN fixture to a published prediction by competition, kick-off (±36 h) and team
 * names (every source's spelling is published). For covered competitions the app shows these
 * predictions instead of computing its own. If the file cannot be fetched and no copy is saved, or a
 * fixture has no published prediction, callers fall back to the on-device engine, so an outage
 * never removes predictions.
 */
import { get } from './http';
import { readKV, writeKV } from './kv';
import { bestSim } from './names';
import type { SEvent } from './espn';

export const REMOTE_URLS = [
  'https://dynohunter3.github.io/mk-sports/football_predictions.json',
  'https://raw.githubusercontent.com/Dynohunter3/mk-sports/predictions/football_predictions.json',
];
const KV_KEY = 'remote:football:v1';
const REFRESH_MS = 15 * 60 * 1000;
const MAX_AGE_MS = 3 * 24 * 3600 * 1000; // older than this and the file is ignored (the job runs daily)

export type RemoteTeam = { id: string; name: string; aliases: string[] };
export type RemoteMatch = {
  match_id: string;
  competition: string;
  kickoff: string;
  home: RemoteTeam;
  away: RemoteTeam;
  p: { home: number; draw: number; away: number };
  expected_goals: [number | null, number | null];
  elo: [number | null, number | null];
  components: Record<'elo' | 'dc' | 'dcx' | 'gbm_nomkt' | 'market', (number | null)[]>;
  variant: 'with odds' | 'no odds yet';
  confidence: number;
  confidence_label: 'high' | 'medium' | 'low';
  confidence_reasons: string[];
  made_at: string;
  last_change: string;
  versions?: number;
  model_version?: string;
  result?: [number, number] | null;
  /** The call the service makes from the probabilities (schema addition; older files lack it). */
  call?: RemoteCall;
  goals?: { over25: number | null; btts: number | null };
};
export type Tier = 'strong' | 'likely' | 'lean' | 'toss-up';
export type RemoteCall = {
  pick: 'home' | 'draw' | 'away';
  pick_probability: number;
  tier: Tier;
  draw_call: boolean;
  double_chance: { call: 'home or draw' | 'away or draw' | 'home or away'; probability: number };
};
export type TrackRecord = { n: number; hit_rate: number };
export type RemoteFile = {
  schema: number;
  generated_at: string;
  model_version: string;
  data_version: string;
  attribution: string;
  notice: string;
  horizon_days: number;
  competitions: string[];
  matches: RemoteMatch[];
  recent?: RemoteMatch[];
};

export type AccAgg = { n: number; correct: number; hit_rate: number | null; log_loss: number | null; brier: number | null; by_confidence: Partial<Record<'high' | 'medium' | 'low', { n: number; hit_rate: number }>> };
type Trio = { accuracy: number; log_loss: number; brier: number };
export type RemoteAccuracy = {
  schema: number;
  generated_at: string;
  model_version: string | null;
  live: {
    overall: AccAgg;
    competitions: Record<string, AccAgg>;
    recent: { match_id: string; competition: string; kickoff: string; home: string; away: string; score: string; pick: 'home' | 'draw' | 'away'; probability: number; correct: number; confidence_label: 'high' | 'medium' | 'low' }[];
  };
  backtest: { source: string; period: string; competitions: Record<string, { n: number; new: Trio; previous: Trio | null; bookmaker: Trio | null }> } | null;
  /** Backtest hit rates of the calls the app shows: by strength, draws, double chance, goal markets. */
  track_record?: {
    tiers: Partial<Record<Tier, TrackRecord & { share: number }>>;
    draw_calls: TrackRecord & { share: number; base_rate: number };
    all_matches: TrackRecord;
    bookmaker: TrackRecord;
    double_chance: TrackRecord & { strong: TrackRecord & { share: number } };
    /** matches not called a draw but rated at least min_draw: how many ended level */
    draw_note?: { min_draw: number; n: number; share: number; ended_level: number };
    over25?: TrackRecord & { confident: TrackRecord & { share: number } };
    btts?: TrackRecord & { confident: TrackRecord & { share: number } };
  };
  note: string;
};
const ACC_KEY = 'remote:accuracy:v1';
let accuracyDoc: RemoteAccuracy | null = null;
// The newest predictions file at build time, shipped inside the app: the new model's calls (draws
// included) are available from the first launch and while the live file can't be reached. It is used
// for matches inside its own horizon only, and anything newer (saved or downloaded) replaces it.
// eslint-disable-next-line @typescript-eslint/no-require-imports
let bundled: { predictions: unknown; accuracy: unknown } | null = { predictions: require('../../assets/data/football_predictions.json'), accuracy: require('../../assets/data/accuracy.json') };
/** Tests only: run without the built-in snapshot. */
export function setBundledForTests(b: { predictions: unknown; accuracy: unknown } | null) {
  bundled = b;
}
export const remoteAccuracy = () => accuracyDoc;
const accValid = (a: unknown): a is RemoteAccuracy => !!a && (a as RemoteAccuracy).schema === 1 && !!(a as RemoteAccuracy).live;

let file: RemoteFile | null = null;
let byComp = new Map<string, RemoteMatch[]>();
let lastTry = 0;
let loading: Promise<boolean> | null = null;
const listeners = new Set<() => void>();
export const stats = { matched: 0, unmatched: 0, source: 'none' as 'none' | 'network' | 'saved' | 'bundled' };

function valid(f: unknown): f is RemoteFile {
  const x = f as RemoteFile;
  return !!x && x.schema === 1 && Array.isArray(x.matches) && Array.isArray(x.competitions) && typeof x.model_version === 'string';
}

function install(f: RemoteFile, source: 'network' | 'saved' | 'bundled') {
  file = f;
  stats.source = source;
  byComp = new Map();
  for (const m of [...f.matches, ...(f.recent ?? [])]) byComp.set(m.competition, [...(byComp.get(m.competition) ?? []), m]);
  for (const fn of listeners) fn();
}

export function onRemoteChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Make the built-in snapshot available synchronously (first launch, before any download finishes). */
export function ensureRemoteLoaded() {
  if (!file) installBundled();
  if (!accuracyDoc && bundled && accValid(bundled.accuracy)) accuracyDoc = bundled.accuracy;
}

/** Fetch the newest file (best effort, at most every 15 min); keeps the last good copy. */
export async function refreshRemote(force = false): Promise<boolean> {
  if (loading) return loading;
  if (!force && Date.now() - lastTry < REFRESH_MS) return !!file;
  lastTry = Date.now();
  const bucket = Math.floor(Date.now() / REFRESH_MS);
  loading = (async () => {
    if (!file) {
      const saved = await readKV<RemoteFile>(KV_KEY);
      if (valid(saved) && Date.now() - Date.parse(saved.generated_at) < MAX_AGE_MS) install(saved, 'saved');
      else installBundled();
    }
    if (!accuracyDoc) {
      const savedAcc = await readKV<RemoteAccuracy>(ACC_KEY);
      if (accValid(savedAcc)) accuracyDoc = savedAcc;
      else if (bundled && accValid(bundled.accuracy)) accuracyDoc = bundled.accuracy;
    }
    // 1. predictions (Pages, then the mirror); a failure keeps the last good copy
    let ok = false;
    for (const url of REMOTE_URLS) {
      try {
        const f = await get<unknown>(`${url}?t=${bucket}`, { ttl: 600, timeoutMs: 12000, retries: 1 });
        if (!valid(f)) continue;
        if (!file || f.generated_at !== file.generated_at || f.model_version !== file.model_version) {
          install(f, 'network');
          await writeKV(KV_KEY, f);
        }
        ok = true;
        break;
      } catch {
        // try the mirror
      }
    }
    // 2. the accuracy file next to it: best effort, never blocks predictions
    for (const url of REMOTE_URLS) {
      try {
        const a = await get<unknown>(`${url.replace('football_predictions.json', 'accuracy.json')}?t=${bucket}`, { ttl: 600, timeoutMs: 12000, retries: 1 });
        if (accValid(a)) {
          accuracyDoc = a;
          await writeKV(ACC_KEY, a);
          break;
        }
      } catch {
        // mirror next
      }
    }
    return ok || !!file;
  })().finally(() => {
    loading = null;
  });
  return loading;
}

function installBundled() {
  if (!bundled || !valid(bundled.predictions)) return;
  const b = bundled.predictions;
  if (Date.now() < Date.parse(b.generated_at) + b.horizon_days * DAY_MS) install(b, 'bundled');
}
const DAY_MS = 86400 * 1000;

export const remoteFile = () => file;
export const remoteSource = () => stats.source;

/** Is this competition one the pipeline predicts (so the app should not compute its own)? */
export function remoteCovers(league: string): boolean {
  if (!file || !file.competitions.includes(league)) return false;
  const age = Date.now() - Date.parse(file.generated_at);
  // a downloaded or saved file is trusted for 3 days; the built-in snapshot for its own horizon
  return stats.source === 'bundled' ? age < file.horizon_days * DAY_MS : age < MAX_AGE_MS;
}

/** The published prediction for an ESPN fixture, or null. */
export function remoteFor(ev: SEvent): RemoteMatch | null {
  if (!remoteCovers(ev.league)) return null;
  const t = Date.parse(ev.start);
  let best: RemoteMatch | null = null;
  let bestScore = 0;
  for (const m of byComp.get(ev.league) ?? []) {
    if (Math.abs(Date.parse(m.kickoff) - t) > 36 * 3600 * 1000) continue;
    const h = bestSim([ev.home.name, ev.home.short], m.home.aliases);
    const a = bestSim([ev.away.name, ev.away.short], m.away.aliases);
    // both sides must look alike (every source's spelling is published, so real fixtures score ~1)
    if (Math.min(h, a) < 0.6 || Math.max(h, a) < 0.75) continue;
    const score = h + a - Math.abs(Date.parse(m.kickoff) - t) / (48 * 3600 * 1000);
    if (score > bestScore) {
      best = m;
      bestScore = score;
    }
  }
  if (best) stats.matched++;
  else stats.unmatched++;
  return best;
}

/** Tests only. */
export function setRemoteForTests(f: RemoteFile | null, acc: RemoteAccuracy | null = null) {
  file = null;
  stats.source = 'none';
  accuracyDoc = acc;
  byComp = new Map();
  if (f) install(f, 'network');
  lastTry = Date.now();
}
