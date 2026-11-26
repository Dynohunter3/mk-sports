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
  /** the week's banker: points doubled (one per ISO week of kick-off) */
  banker?: boolean;
  /** probability mode: the player's own home/draw/away chances (fractions adding up to 1) */
  probs?: Probs3;
  /** the AI's probabilities when the pick was saved (the same moment, so the comparison is fair) */
  ai_probs?: Probs3 | null;
};
export type Probs3 = { home: number; draw: number; away: number };

/** F1: the podium for a race. Tennis: the winner and the number of sets. Settled from ESPN results. */
export type SpecialPick =
  | (SpecialBase & { kind: 'f1'; podium: [string, string, string]; result: [string, string, string] | null })
  | (SpecialBase & { kind: 'tennis'; tour: 'atp' | 'wta'; players: [string, string]; winner: 0 | 1; sets: number; bestOf: 3 | 5; result: { winner: 0 | 1; sets: number } | null });
type SpecialBase = { id: string; name: string; start: string; status: 'pending' | 'won' | 'lost' | 'void'; points: number; created_at: string; settled_at: string | null };

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
export type State = { profile: Profile; picks: Record<string, LocalPick>; badges: Record<string, string>; seen?: Record<string, string>; specials?: Record<string, SpecialPick> };

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
/** A probability pick: three chances that add up to 100%. Returns them as fractions, and the call they make. */
export function validateProbs(hasDraws: boolean, probs: Partial<Probs3> | null | undefined): { probs: Probs3; pick: Outcome } {
  const v = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : NaN);
  const p = { home: v(probs?.home), draw: hasDraws ? v(probs?.draw) : 0, away: v(probs?.away) };
  if ([p.home, p.draw, p.away].some((x) => !(x >= 0 && x <= 1))) throw new PickError('invalid_probs', 'Each chance must be between 0% and 100%');
  if (Math.abs(p.home + p.draw + p.away - 1) > 0.011) throw new PickError('probs_sum', 'The three chances must add up to 100%');
  const total = p.home + p.draw + p.away;
  const probsN = { home: p.home / total, draw: p.draw / total, away: p.away / total };
  const pick: Outcome = probsN.home >= probsN.draw && probsN.home >= probsN.away ? 'home' : probsN.away >= probsN.draw ? 'away' : 'draw';
  return { probs: probsN, pick };
}

/** The Brier score of home/draw/away chances: 0 is perfect, 2 is as wrong as possible; always guessing a third each scores 0.67. */
export function brier(p: Probs3, outcome: Outcome): number {
  return (p.home - (outcome === 'home' ? 1 : 0)) ** 2 + (p.draw - (outcome === 'draw' ? 1 : 0)) ** 2 + (p.away - (outcome === 'away' ? 1 : 0)) ** 2;
}

export async function makePick(
  ev: SEvent,
  body: { pick?: Outcome | null; home_score?: number | null; away_score?: number | null; banker?: boolean; probs?: Partial<Probs3> | null },
  aiPick: Outcome | null,
  aiProbs: Probs3 | null = null,
): Promise<{ pick: LocalPick; newBadges: string[] }> {
  const st = await loadGame();
  if (!st.profile.consented_at) throw new PickError('consent_required', 'Please accept the terms first', 403);
  if (isLocked(ev)) throw new PickError('locked', 'Picks for this match locked at kick-off', 409);
  const sport = sportOf(ev.sport)!;
  if (!sport.predictions) throw new PickError('not_supported', 'The pick game is not available for this sport', 400);
  const prob = body.probs ? validateProbs(sport.hasDraws, body.probs) : null;
  const outcome = validatePick(sport.hasDraws, prob ? prob.pick : body.pick, prob ? null : body.home_score, prob ? null : body.away_score, sport.maxScore);
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
    home_score: prob ? null : body.home_score ?? null,
    away_score: prob ? null : body.away_score ?? null,
    ai_pick: aiPick,
    ai_probs: aiProbs,
    ...(prob ? { probs: prob.probs } : {}),
    status: 'pending',
    points: 0,
    result_correct: null,
    exact_score: false,
    final_score: null,
    created_at: prev?.created_at ?? now,
    updated_at: now,
    settled_at: null,
    banker: prev?.banker ?? false,
  };
  if (body.banker !== undefined) applyBanker(st, p, body.banker);
  st.picks[ev.id] = p;
  const newBadges = prev ? [] : award(st);
  await save();
  return { pick: p, newBadges };
}

/** This week's banker (by kick-off week), if any. */
export function bankerOfWeek(st: State, week: string, except?: string): LocalPick | null {
  return Object.values(st.picks).find((x) => x.banker && x.matchId !== except && isoWeek(new Date(x.kickoff)) === week) ?? null;
}

/** One banker per week, worth double points. It can move to another match until its own match kicks off. */
function applyBanker(st: State, p: LocalPick, on: boolean, now = Date.now()) {
  if (!on) {
    p.banker = false;
    return;
  }
  const other = bankerOfWeek(st, isoWeek(new Date(p.kickoff)), p.matchId);
  if (other) {
    if (other.status !== 'pending' || now >= Date.parse(other.kickoff)) {
      throw new PickError('banker_locked', `Your banker this week (${other.homeName} v ${other.awayName}) has already kicked off`, 409);
    }
    other.banker = false;
  }
  p.banker = true;
}

export async function setBanker(ev: SEvent, on: boolean) {
  const st = await loadGame();
  const p = st.picks[ev.id];
  if (!p) throw new PickError('not_found', 'Make a pick first', 404);
  if (isLocked(ev)) throw new PickError('locked', 'Picks for this match locked at kick-off', 409);
  applyBanker(st, p, on);
  await save();
  return p;
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
      Object.assign(p, { status: r.status, points: r.points * (p.banker ? 2 : 1), result_correct: r.correct, exact_score: r.exact, final_score: [ev.homeScore, ev.awayScore], settled_at: p.settled_at ?? new Date().toISOString() });
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

const settledSpecials = (st: State) => Object.values(st.specials ?? {}).filter((x) => x.status === 'won' || x.status === 'lost');

export function stats(st: State) {
  const done = settledInOrder(st);
  const specialPoints = settledSpecials(st).reduce((s, x) => s + x.points, 0);
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
    total_points: done.reduce((s, p) => s + p.points, 0) + specialPoints,
    picks_settled: done.length,
    picks_correct: correct,
    exact_scores: done.filter((p) => p.exact_score).length,
    accuracy: done.length ? correct / done.length : null,
    current_streak: cur,
    best_streak: best,
    pending_picks: Object.values(st.picks).filter((p) => p.status === 'pending').length + Object.values(st.specials ?? {}).filter((x) => x.status === 'pending').length,
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
  for (const x of settledSpecials(st)) {
    const k = isoWeek(new Date(x.start));
    const w = weeks.get(k) ?? { key: k, points: 0, picks: 0, correct: 0, exact: 0 };
    w.points += x.points;
    w.picks += 1;
    w.correct += x.status === 'won' ? 1 : 0;
    weeks.set(k, w);
  }
  const season = seasonKey(new Date());
  const seasonPicks = settledInOrder(st).filter((p) => seasonKey(new Date(p.kickoff)) === season);
  const seasonSpecials = settledSpecials(st).filter((x) => seasonKey(new Date(x.start)) === season);
  return {
    current_week: isoWeek(new Date()),
    season,
    season_points: seasonPicks.reduce((s, p) => s + p.points, 0) + seasonSpecials.reduce((s, x) => s + x.points, 0),
    weeks: [...weeks.values()].sort((a, b) => b.key.localeCompare(a.key)),
  };
}

/** Every season played (July to June), newest first: worked out from the saved picks. */
export function seasonArchive(st: State) {
  const by = new Map<string, LocalPick[]>();
  for (const p of settledInOrder(st)) {
    const k = seasonKey(new Date(p.kickoff));
    by.set(k, [...(by.get(k) ?? []), p]);
  }
  const current = seasonKey(new Date());
  return [...by.entries()]
    .map(([season, ps]) => {
      let best = 0;
      let run = 0;
      for (const p of ps) {
        run = p.status === 'won' ? run + 1 : 0;
        best = Math.max(best, run);
      }
      const correct = ps.filter((p) => p.status === 'won').length;
      const bankers = ps.filter((p) => p.banker);
      const sp = settledSpecials(st).filter((x) => seasonKey(new Date(x.start)) === season);
      return {
        season,
        current: season === current,
        points: ps.reduce((s, p) => s + p.points, 0) + sp.reduce((s, x) => s + x.points, 0),
        picks: ps.length,
        correct,
        accuracy: ps.length ? correct / ps.length : null,
        exact: ps.filter((p) => p.exact_score).length,
        best_streak: best,
        bankers: bankers.length,
        bankers_won: bankers.filter((p) => p.status === 'won').length,
      };
    })
    .sort((a, b) => b.season.localeCompare(a.season));
}

export async function updateProfile(patch: Partial<Profile>) {
  const st = await loadGame();
  st.profile = { ...st.profile, ...patch };
  await save();
  return st.profile;
}

/** Restore from a backup: replaces the game state on this phone. */
export async function replaceGame(next: State) {
  state = { profile: next.profile, picks: next.picks ?? {}, badges: next.badges ?? {}, seen: next.seen ?? {}, specials: next.specials ?? {} };
  await save();
}

export async function resetGame() {
  state = null;
  await removeKV([KEY]);
}

export function gameState() {
  return state;
}

// ------------------------------------------------------------------ probability picks: you vs the AI by Brier score
/** Settled probability picks scored against the AI's probabilities from the same moment. Lower Brier is better. */
export function probabilityRecord(st: State, season?: string) {
  const rows = Object.values(st.picks).filter(
    (p) => p.probs && p.ai_probs && p.final_score && (p.status === 'won' || p.status === 'lost') && (!season || seasonKey(new Date(p.kickoff)) === season),
  );
  let you = 0;
  let ai = 0;
  let better = 0;
  let worse = 0;
  for (const p of rows) {
    const o = outcomeOf(p.final_score![0], p.final_score![1]);
    const y = brier(p.probs!, o);
    const a = brier(p.ai_probs!, o);
    you += y;
    ai += a;
    better += +(y < a - 1e-9);
    worse += +(a < y - 1e-9);
  }
  const n = rows.length;
  return {
    matches: n,
    you: n ? you / n : null,
    ai: n ? ai / n : null,
    better,
    worse,
    leader: !n ? 'none' : Math.abs(you - ai) < 1e-9 ? 'level' : you < ai ? 'you' : 'ai',
  };
}

// ------------------------------------------------------------------ F1 and tennis picks
export const F1_POINTS = { exact: 5, onPodium: 2, perfectBonus: 5 };
export const TENNIS_POINTS = { winner: 3, sets: 2 };

/** Podium: 5 for each driver in the right place, 2 for a driver on the podium in another place, 5 more for all three right. */
export function scorePodium(pick: [string, string, string], result: [string, string, string]): number {
  const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const r = result.map(norm);
  let pts = 0;
  let exact = 0;
  pick.map(norm).forEach((d, i) => {
    if (d === r[i]) {
      pts += F1_POINTS.exact;
      exact++;
    } else if (r.includes(d)) pts += F1_POINTS.onPodium;
  });
  return pts + (exact === 3 ? F1_POINTS.perfectBonus : 0);
}

/** Tennis: 3 for the winner, 2 more for the number of sets as well. */
export function scoreTennis(winner: 0 | 1, sets: number, result: { winner: 0 | 1; sets: number }): number {
  if (winner !== result.winner) return 0;
  return TENNIS_POINTS.winner + (sets === result.sets ? TENNIS_POINTS.sets : 0);
}

type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type SpecialInput = DistOmit<SpecialPick, 'status' | 'points' | 'created_at' | 'settled_at' | 'result'>;

export async function makeSpecial(p: SpecialInput, now = Date.now()): Promise<SpecialPick> {
  const st = await loadGame();
  if (!st.profile.consented_at) throw new PickError('consent_required', 'Please accept the terms first', 403);
  if (now >= Date.parse(p.start)) throw new PickError('locked', 'Picks lock when the race or match starts', 409);
  if (p.kind === 'f1') {
    const names = p.podium.map((d) => d.trim());
    if (names.some((d) => !d) || new Set(names).size !== 3) throw new PickError('invalid_podium', 'Pick three different drivers');
  } else {
    if (p.winner !== 0 && p.winner !== 1) throw new PickError('invalid_pick', 'Pick the winner');
    const min = Math.ceil(p.bestOf / 2);
    if (!(p.sets >= min && p.sets <= p.bestOf)) throw new PickError('invalid_sets', `A best-of-${p.bestOf} match lasts ${min} to ${p.bestOf} sets`);
  }
  const prev = st.specials?.[p.id];
  const pick = { ...p, status: 'pending', points: 0, result: null, created_at: prev?.created_at ?? new Date(now).toISOString(), settled_at: null } as SpecialPick;
  st.specials = { ...(st.specials ?? {}), [p.id]: pick };
  if (!prev) award(st);
  await save();
  return pick;
}

export async function deleteSpecial(id: string, now = Date.now()) {
  const st = await loadGame();
  const p = st.specials?.[id];
  if (!p) throw new PickError('not_found', 'No pick for this event', 404);
  if (now >= Date.parse(p.start)) throw new PickError('locked', 'Picks lock when the race or match starts', 409);
  delete st.specials![id];
  await save();
}

export type SpecialResults = { f1?: Record<string, [string, string, string]>; tennis?: Record<string, { winner: 0 | 1; sets: number }> };

/** Settle F1 and tennis picks from results; anything still unresolved 10 days after the start is void. */
export async function settleSpecials(results: SpecialResults, now = Date.now()): Promise<number> {
  const st = await loadGame();
  let n = 0;
  for (const p of Object.values(st.specials ?? {})) {
    if (p.status !== 'pending') continue;
    let points: number | null = null;
    if (p.kind === 'f1' && results.f1?.[p.id]) {
      p.result = results.f1[p.id];
      points = scorePodium(p.podium, p.result);
    } else if (p.kind === 'tennis' && results.tennis?.[p.id]) {
      p.result = results.tennis[p.id];
      points = scoreTennis(p.winner, p.sets, p.result);
    }
    if (points !== null) {
      Object.assign(p, { points, status: points > 0 ? 'won' : 'lost', settled_at: new Date(now).toISOString() });
      n++;
    } else if (now - Date.parse(p.start) > 10 * 86_400_000) {
      Object.assign(p, { status: 'void', points: 0, settled_at: new Date(now).toISOString() });
      n++;
    }
  }
  if (n) {
    award(st);
    await save();
  }
  return n;
}

// ------------------------------------------------------------------ season recap
export function seasonRecap(st: State, season = seasonKey(new Date())) {
  const ps = settledInOrder(st).filter((p) => seasonKey(new Date(p.kickoff)) === season);
  const sp = settledSpecials(st).filter((x) => seasonKey(new Date(x.start)) === season);
  const won = ps.filter((p) => p.status === 'won');
  // best pick: the least likely call that came off, by the AI's own numbers when they were saved
  const aiChance = (p: LocalPick) => (p.ai_probs ? p.ai_probs[p.pick] : null);
  const withChance = won.filter((p) => aiChance(p) !== null).sort((a, b) => aiChance(a)! - aiChance(b)! || b.points - a.points);
  const against = won.filter((p) => p.ai_pick && p.ai_pick !== p.pick).sort((a, b) => b.points - a.points);
  const best = withChance[0] ?? against[0] ?? [...won].sort((a, b) => b.points - a.points)[0] ?? null;
  let longest = 0;
  let run = 0;
  for (const p of ps) {
    run = p.status === 'won' ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  // the team you called best: most correct calls on its matches (at least 3 picks), then accuracy
  const teams = new Map<string, { name: string; code: string; color: string; logo: string | null; picks: number; correct: number }>();
  for (const p of ps)
    for (const side of ['home', 'away'] as const) {
      const name = side === 'home' ? p.homeName : p.awayName;
      const t = teams.get(name) ?? { name, code: side === 'home' ? p.homeCode : p.awayCode, color: side === 'home' ? p.homeColor : p.awayColor, logo: (side === 'home' ? p.homeLogo : p.awayLogo) ?? null, picks: 0, correct: 0 };
      t.picks += 1;
      t.correct += p.status === 'won' ? 1 : 0;
      teams.set(name, t);
    }
  const team = [...teams.values()].filter((t) => t.picks >= 3).sort((a, b) => b.correct - a.correct || b.correct / b.picks - a.correct / a.picks)[0] ?? null;
  const vs = ps.filter((p) => p.ai_pick && p.final_score);
  const youRight = vs.filter((p) => p.status === 'won').length;
  const aiRight = vs.filter((p) => p.ai_pick === outcomeOf(p.final_score![0], p.final_score![1])).length;
  return {
    season,
    points: ps.reduce((s, p) => s + p.points, 0) + sp.reduce((s, x) => s + x.points, 0),
    picks: ps.length,
    correct: won.length,
    accuracy: ps.length ? won.length / ps.length : null,
    exact: ps.filter((p) => p.exact_score).length,
    longest_streak: longest,
    best_pick: best ? { pick: best, ai_chance: aiChance(best), against_ai: !!best.ai_pick && best.ai_pick !== best.pick } : null,
    best_team: team && team.correct > 0 ? team : null,
    vs_ai: { matches: vs.length, you: youRight, ai: aiRight },
    probability: probabilityRecord(st, season),
    bankers: { played: ps.filter((p) => p.banker).length, won: ps.filter((p) => p.banker && p.status === 'won').length },
    other_sports: { picks: sp.length, points: sp.reduce((s, x) => s + x.points, 0) },
  };
}

/** One week's results for the share card: this week if anything has settled, otherwise last week. */
export function weekReport(st: State, now = new Date()) {
  const build = (week: string) => {
    const ps = settledInOrder(st).filter((p) => isoWeek(new Date(p.kickoff)) === week);
    const sp = settledSpecials(st).filter((x) => isoWeek(new Date(x.start)) === week);
    const withAi = ps.filter((p) => p.ai_pick && p.final_score);
    const banker = ps.find((p) => p.banker) ?? null;
    return {
      week,
      points: ps.reduce((s, p) => s + p.points, 0) + sp.reduce((s, x) => s + x.points, 0),
      picks: ps.length + sp.length,
      correct: ps.filter((p) => p.status === 'won').length + sp.filter((x) => x.status === 'won').length,
      exact: ps.filter((p) => p.exact_score).length,
      vs_ai: { matches: withAi.length, you: withAi.filter((p) => p.status === 'won').length, ai: withAi.filter((p) => p.ai_pick === outcomeOf(p.final_score![0], p.final_score![1])).length },
      banker: banker ? { match: `${banker.homeName} v ${banker.awayName}`, won: banker.status === 'won', points: banker.points } : null,
    };
  };
  const cur = build(isoWeek(now));
  return cur.picks ? { ...cur, current: true } : { ...build(isoWeek(new Date(now.getTime() - 7 * 86_400_000))), current: false };
}
