/**
 * The free-to-play pick game, stored on this device (port of backend services/scoring.py
 * and settlement.py). Picks lock at kick-off and settle automatically from real results.
 */
import { Outcome, outcomeOf } from '@/engine';

import type { SEvent } from './espn';
import { readKV, removeKV, writeKV } from './kv';
import { sportOf, SportSlug } from './leagues';

export type LocalPick = {
  matchId: string;
  sport: SportSlug;
  league: string;
  kickoff: string;
  homeName: string;
  awayName: string;
  homeCode: string;
  awayCode: string;
  homeColor: string;
  awayColor: string;
  homeLogo?: string | null;
  awayLogo?: string | null;
  pick: Outcome;
  home_score: number | null;
  away_score: number | null;
  ai_pick: Outcome | null;
  status: 'pending' | 'won' | 'lost' | 'void';
  points: number;
  result_correct: boolean | null;
  exact_score: boolean;
  final_score: [number, number] | null;
  created_at: string;
  updated_at: string;
  settled_at: string | null;
};

export type Profile = {
  display_name: string;
  created_at: string;
  consented_at: string | null;
  country: string | null;
  /** random id for private-league score cards (made once per phone) */
  member_id?: string;
  /** an emoji shown next to the name */
  avatar?: string;
};
export const AVATARS = ['⚽', '🦁', '🐆', '🦅', '🔥', '⚡', '👑', '🎯', '🚀', '🐐', '🌍', '💎'];
type State = { profile: Profile; picks: Record<string, LocalPick>; badges: Record<string, string>; seen?: Record<string, string> };

const KEY = 'game:v1';
let state: State | null = null;

export const BADGES = [
  { slug: 'first-pick', name: 'First Pick', description: 'Made your first prediction', icon: 'hand-pointing-right' },
  { slug: 'first-win', name: 'On the Board', description: 'Your first correct result', icon: 'check-circle' },
  { slug: 'sharpshooter', name: 'Sharpshooter', description: 'Predicted an exact score', icon: 'bullseye-arrow' },
  { slug: 'streak-3', name: 'Hat-trick', description: '3 correct results in a row', icon: 'fire' },
  { slug: 'streak-5', name: 'On Fire', description: '5 correct results in a row', icon: 'fire-circle' },
  { slug: 'streak-10', name: 'Unstoppable', description: '10 correct results in a row', icon: 'lightning-bolt' },
  { slug: 'half-century', name: 'Half Century', description: 'Scored 50 points', icon: 'star' },
  { slug: 'centurion', name: 'Centurion', description: 'Scored 100 points', icon: 'trophy' },
  { slug: 'multi-sport', name: 'All-Rounder', description: 'Correct picks in two different sports', icon: 'medal' },
  { slug: 'beat-the-ai', name: 'Beat the AI', description: "Correct pick that went against the AI's favourite", icon: 'robot-confused' },
];

export async function loadGame(): Promise<State> {
  if (!state) {
    state = (await readKV<State>(KEY)) ?? { profile: { display_name: 'You', created_at: new Date().toISOString(), consented_at: null, country: null }, picks: {}, badges: {} };
    if (!state.profile.member_id) {
      state.profile.member_id = Array.from({ length: 12 }, () => 'abcdefghijkmnpqrstuvwxyz23456789'[Math.floor(Math.random() * 32)]).join('');
      await writeKV(KEY, state);
    }
  }
  return state;
}

const save = () => writeKV(KEY, state);

// ------------------------------------------------------------------ rules
export type Rules = { result_points: number; exact_score_bonus: number; margin_bonus: number; margin_tolerance: number; max_points: number };

export class PickError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 422,
  ) {
    super(message);
  }
}

export function scorePick(r: Rules, pick: Outcome, ah: number, aa: number, ph: number | null, pa: number | null) {
  const correct = pick === outcomeOf(ah, aa);
  const hasScore = ph !== null && pa !== null;
  const exact = correct && hasScore && ph === ah && pa === aa;
  let points = 0;
  let margin = false;
  if (correct) {
    points += r.result_points;
    if (exact) points += r.exact_score_bonus;
    else if (hasScore && r.margin_bonus > 0 && Math.abs((ph as number) - (pa as number) - (ah - aa)) <= r.margin_tolerance) {
      margin = true;
      points += r.margin_bonus;
    }
  }
  return { points, status: correct ? ('won' as const) : ('lost' as const), correct, exact, margin };
}

export function validatePick(hasDraws: boolean, pick: Outcome | null | undefined, h: number | null | undefined, a: number | null | undefined, maxScore: number): Outcome {
  if ((h === null || h === undefined) !== (a === null || a === undefined)) throw new PickError('incomplete_score', 'Give both scores or neither');
  if (h !== null && h !== undefined && a !== null && a !== undefined) {
    if (!(h >= 0 && h <= maxScore && a >= 0 && a <= maxScore)) throw new PickError('invalid_score', `Scores must be between 0 and ${maxScore}`);
    const implied = outcomeOf(h, a);
    if (!pick) pick = implied;
    else if (pick !== implied) throw new PickError('score_mismatch', `A ${h}-${a} score doesn't match that pick`);
  }
  if (pick !== 'home' && pick !== 'draw' && pick !== 'away') throw new PickError('invalid_pick', 'Pick must be home, draw or away');
  if (pick === 'draw' && !hasDraws) throw new PickError('no_draws', 'This sport has no draws');
  return pick;
}

export const isLocked = (ev: Pick<SEvent, 'status' | 'start'>, now = Date.now()) => ev.status !== 'scheduled' || now >= Date.parse(ev.start);

// ------------------------------------------------------------------ actions
export async function makePick(ev: SEvent, body: { pick?: Outcome | null; home_score?: number | null; away_score?: number | null }, aiPick: Outcome | null): Promise<{ pick: LocalPick; newBadges: string[] }> {
  const st = await loadGame();
  if (!st.profile.consented_at) throw new PickError('consent_required', 'Please accept the terms first', 403);
  if (isLocked(ev)) throw new PickError('locked', 'Picks for this match locked at kick-off', 409);
  const sport = sportOf(ev.sport)!;
  if (!sport.predictions) throw new PickError('not_supported', 'The pick game is not available for this sport', 400);
  const outcome = validatePick(sport.hasDraws, body.pick, body.home_score, body.away_score, sport.maxScore);
  const now = new Date().toISOString();
  const prev = st.picks[ev.id];
  const p: LocalPick = {
    matchId: ev.id,
    sport: ev.sport,
    league: ev.league,
    kickoff: ev.start,
    homeName: ev.home.short,
    awayName: ev.away.short,
    homeCode: ev.home.abbr,
    awayCode: ev.away.abbr,
    homeColor: ev.home.color,
    awayColor: ev.away.color,
    homeLogo: ev.home.logo,
    awayLogo: ev.away.logo,
    pick: outcome,
    home_score: body.home_score ?? null,
    away_score: body.away_score ?? null,
    ai_pick: aiPick,
    status: 'pending',
    points: 0,
    result_correct: null,
    exact_score: false,
    final_score: null,
    created_at: prev?.created_at ?? now,
    updated_at: now,
    settled_at: null,
  };
  st.picks[ev.id] = p;
  const newBadges = prev ? [] : award(st);
  await save();
  return { pick: p, newBadges };
}

export async function deletePick(ev: SEvent) {
  const st = await loadGame();
  if (!st.picks[ev.id]) throw new PickError('not_found', 'No pick for this match', 404);
  if (isLocked(ev)) throw new PickError('locked', 'Picks for this match locked at kick-off', 409);
  delete st.picks[ev.id];
  await save();
}

/** Settle pending picks from fresh results. Idempotent; corrected scores are re-settled. */
export async function settle(events: SEvent[]): Promise<number> {
  const st = await loadGame();
  let n = 0;
  for (const ev of events) {
    const p = st.picks[ev.id];
    if (!p) continue;
    const kickoffChanged = p.status === 'pending' && ev.start !== p.kickoff;
    if (kickoffChanged) p.kickoff = ev.start; // rescheduled: the pick stays open
    if (ev.status === 'cancelled' && p.status !== 'void') {
      Object.assign(p, { status: 'void', points: 0, result_correct: null, exact_score: false, settled_at: new Date().toISOString() });
      n++;
    } else if (ev.status === 'finished' && ev.homeScore !== null && ev.awayScore !== null) {
      const same = p.final_score && p.final_score[0] === ev.homeScore && p.final_score[1] === ev.awayScore;
      if (p.status !== 'pending' && same) continue;
      const r = scorePick(sportOf(ev.sport)!.scoring, p.pick, ev.homeScore, ev.awayScore, p.home_score, p.away_score);
      Object.assign(p, { status: r.status, points: r.points, result_correct: r.correct, exact_score: r.exact, final_score: [ev.homeScore, ev.awayScore], settled_at: p.settled_at ?? new Date().toISOString() });
      n++;
    }
  }
  if (n) {
    award(st);
    await save();
  }
  return n;
}

// ------------------------------------------------------------------ stats & badges
function settledInOrder(st: State): LocalPick[] {
  return Object.values(st.picks)
    .filter((p) => p.status === 'won' || p.status === 'lost')
    .sort((a, b) => (a.settled_at ?? '').localeCompare(b.settled_at ?? '') || a.kickoff.localeCompare(b.kickoff));
}

export function stats(st: State) {
  const done = settledInOrder(st);
  const results = done.map((p) => p.status === 'won');
  let cur = 0;
  for (let i = results.length - 1; i >= 0 && results[i]; i--) cur++;
  let best = 0;
  let run = 0;
  for (const r of results) {
    run = r ? run + 1 : 0;
    best = Math.max(best, run);
  }
  const correct = results.filter(Boolean).length;
  return {
    total_points: done.reduce((s, p) => s + p.points, 0),
    picks_settled: done.length,
    picks_correct: correct,
    exact_scores: done.filter((p) => p.exact_score).length,
    accuracy: done.length ? correct / done.length : null,
    current_streak: cur,
    best_streak: best,
    pending_picks: Object.values(st.picks).filter((p) => p.status === 'pending').length,
    global_rank_season: null,
  };
}

// ------------------------------------------------------------------ levels, you vs the AI, results to celebrate
/** Levels by total points: each needs a little more than the last. */
export const LEVELS = [
  { name: 'Rookie', from: 0 },
  { name: 'Amateur', from: 10 },
  { name: 'Semi-pro', from: 25 },
  { name: 'Pro', from: 50 },
  { name: 'Star', from: 90 },
  { name: 'Captain', from: 140 },
  { name: 'Legend', from: 210 },
  { name: 'Icon', from: 300 },
  { name: 'GOAT', from: 420 },
];

export function levelFor(points: number) {
  let i = 0;
  while (i + 1 < LEVELS.length && points >= LEVELS[i + 1].from) i++;
  const cur = LEVELS[i];
  const next = LEVELS[i + 1] ?? null;
  return {
    level: i + 1,
    name: cur.name,
    next: next?.name ?? null,
    points,
    from: cur.from,
    to: next?.from ?? null,
    progress: next ? (points - cur.from) / (next.from - cur.from) : 1,
  };
}

/** You against the AI on the same matches: every settled pick made when the AI had a call. */
export function vsAI(st: State) {
  const rows = Object.values(st.picks).filter((p) => p.ai_pick && p.final_score && (p.status === 'won' || p.status === 'lost'));
  const outcome = (p: LocalPick) => {
    const [h, a] = p.final_score!;
    return h > a ? 'home' : h < a ? 'away' : 'draw';
  };
  let you = 0;
  let ai = 0;
  let youOnly = 0;
  let aiOnly = 0;
  for (const p of rows) {
    const o = outcome(p);
    const y = p.pick === o;
    const m = p.ai_pick === o;
    you += +y;
    ai += +m;
    youOnly += +(y && !m);
    aiOnly += +(m && !y);
  }
  return { matches: rows.length, you, ai, you_beat_ai: youOnly, ai_beat_you: aiOnly, leader: you > ai ? 'you' : ai > you ? 'ai' : 'level' };
}

/** Settled picks the player has not seen yet (for the "results are in" celebration). */
export function unseenResults(st: State): LocalPick[] {
  const seen = st.seen ?? {};
  return Object.values(st.picks)
    .filter((p) => p.status !== 'pending' && p.settled_at && !seen[p.matchId])
    .sort((a, b) => (b.settled_at ?? '').localeCompare(a.settled_at ?? ''));
}

export async function markSeen(ids: string[]) {
  const st = await loadGame();
  st.seen = { ...(st.seen ?? {}) };
  for (const id of ids) st.seen[id] = new Date().toISOString();
  await save();
}

function award(st: State): string[] {
  const s = stats(st);
  const won = Object.values(st.picks).filter((p) => p.status === 'won');
  const checks: [string, boolean][] = [
    ['first-pick', Object.keys(st.picks).length > 0],
    ['first-win', s.picks_correct >= 1],
    ['sharpshooter', s.exact_scores >= 1],
    ['streak-3', s.best_streak >= 3],
    ['streak-5', s.best_streak >= 5],
    ['streak-10', s.best_streak >= 10],
    ['half-century', s.total_points >= 50],
    ['centurion', s.total_points >= 100],
    ['multi-sport', new Set(won.map((p) => p.sport)).size >= 2],
    ['beat-the-ai', won.some((p) => p.ai_pick && p.pick !== p.ai_pick)],
  ];
  const fresh: string[] = [];
  for (const [slug, ok] of checks) {
    if (ok && !st.badges[slug]) {
      st.badges[slug] = new Date().toISOString();
      fresh.push(slug);
    }
  }
  return fresh;
}

const isoWeek = (d: Date) => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86_400_000 + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
};
export const weekKey = isoWeek;
export const seasonKey = (d: Date) => {
  const y = d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
};

export function pointsByPeriod(st: State) {
  const weeks = new Map<string, { key: string; points: number; picks: number; correct: number; exact: number }>();
  for (const p of settledInOrder(st)) {
    const k = isoWeek(new Date(p.kickoff));
    const w = weeks.get(k) ?? { key: k, points: 0, picks: 0, correct: 0, exact: 0 };
    w.points += p.points;
    w.picks += 1;
    w.correct += p.status === 'won' ? 1 : 0;
    w.exact += p.exact_score ? 1 : 0;
    weeks.set(k, w);
  }
  const season = seasonKey(new Date());
  const seasonPicks = settledInOrder(st).filter((p) => seasonKey(new Date(p.kickoff)) === season);
  return {
    current_week: isoWeek(new Date()),
    season,
    season_points: seasonPicks.reduce((s, p) => s + p.points, 0),
    weeks: [...weeks.values()].sort((a, b) => b.key.localeCompare(a.key)),
  };
}

export async function updateProfile(patch: Partial<Profile>) {
  const st = await loadGame();
  st.profile = { ...st.profile, ...patch };
  await save();
  return st.profile;
}

export async function resetGame() {
  state = null;
  await removeKV([KEY]);
}

export function gameState() {
  return state;
}
