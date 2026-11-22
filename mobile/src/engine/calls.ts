/**
 * Call strength and the safer call, shared by both prediction paths (mirrors pipeline/mkmodel/picks.py).
 * The track records below were measured on two past seasons (7,740 league matches, each predicted only
 * from earlier data): audit/results/step6_picks.json (splits.both for the new model, device_engine for the
 * on-device engine, replayed on the same matches).
 */
import type { Outcome } from './core';

export type Probs = Partial<Record<Outcome, number | null>>;

export type Tier = 'strong' | 'likely' | 'lean' | 'toss-up';
export const TIER_LABEL: Record<Tier, string> = { strong: 'Strong call', likely: 'Likely', lean: 'Lean', 'toss-up': 'Toss-up' };
export type SaferPair = 'home or draw' | 'away or draw' | 'home or away';

export function tierOf(p: number): Tier {
  return p >= 0.65 ? 'strong' : p >= 0.5 ? 'likely' : p >= 0.4 ? 'lean' : 'toss-up';
}

/** The most likely pair of outcomes that contains the call (a draw call is never paired with "home or away"). */
export function saferCall(p: Probs, call: Outcome): { pair: SaferPair; probability: number } {
  const h = p.home ?? 0;
  const d = p.draw ?? 0;
  const a = p.away ?? 0;
  const pairs: [SaferPair, Outcome[], number][] = [
    ['home or draw', ['home', 'draw'], h + d],
    ['away or draw', ['away', 'draw'], a + d],
    ['home or away', ['home', 'away'], h + a],
  ];
  const ok = pairs.filter(([, members]) => members.includes(call)).sort((x, y) => y[2] - x[2])[0];
  return { pair: ok[0], probability: ok[2] };
}

export const saferHit = (pair: SaferPair, o: Outcome) => pair.split(' or ').includes(o);

/** The on-device engine (used when a match is not in the published file): measured track record. */
export const DEVICE_TRACK = {
  tiers: { strong: 0.741, likely: 0.564, lean: 0.446, 'toss-up': 0.375 } as Record<Tier, number>,
  safer: 0.771,
  // matches this engine rates 29%+ draw ended level 29% of the time (20% of all matches); its draw
  // calls had no skill on the test season, so it never calls a draw
  drawNote: { min: 0.29, drawn: 0.29 },
};

/** The published model: matches it rates 29%+ draw without calling one (14% of matches) ended level 28.8% of
 * the time (audit/results/step6_picks.json, draw_note); used when the downloaded track record lacks it. */
export const MODEL_DRAW_NOTE = { min: 0.29, drawn: 0.288 };

export const drawNoteText = (pDraw: number, drawn: number) => `A draw is a real possibility (${Math.round(pDraw * 100)}%): ${Math.round(drawn * 100)}% of matches rated like this ended level`;
