/**
 * Metrics, walk-forward backtest (port of evaluation.py) and the multi-source ensemble.
 *
 * Ensemble = linear opinion pool. Each source's weight is its prior times
 * exp(-n * (its mean log loss - the best source's) / T): tempered Bayesian model averaging.
 * Sources that have predicted more matches more accurately get more say; with little
 * evidence the priors dominate. T=2 keeps it from collapsing onto one source too quickly.
 */
import { argmax, clamp, FinishedMatch, normalInv, Outcome, outcomeProbabilities, mostLikelyScore, Prediction, probabilities, scoreMatrix } from './core';
import type { SportModel } from './models';

export type Probs = Partial<Record<Outcome, number>>;
const EPS = 1e-12;

export const logLoss = (p: Probs, o: Outcome) => -Math.log(Math.max(EPS, p[o] ?? 0));
export const brier = (p: Probs, o: Outcome) => (Object.keys(p) as Outcome[]).reduce((s, k) => s + ((p[k] as number) - (k === o ? 1 : 0)) ** 2, 0);
export const isCorrect = (p: Probs, o: Outcome) => argmax(p) === o;

export type Metrics = { n: number; logLoss: number; brier: number; accuracy: number };

export function evaluate(pairs: [Probs, Outcome][]): Metrics {
  if (!pairs.length) return { n: 0, logLoss: 0, brier: 0, accuracy: 0 };
  let ll = 0;
  let br = 0;
  let acc = 0;
  for (const [p, o] of pairs) {
    ll += logLoss(p, o);
    br += brier(p, o);
    acc += isCorrect(p, o) ? 1 : 0;
  }
  const n = pairs.length;
  return { n, logLoss: ll / n, brier: br / n, accuracy: acc / n };
}

/** Predict each match from earlier results only, then learn from it. */
export function walkForward(model: SportModel, matches: FinishedMatch[], onPrediction?: (m: FinishedMatch, p: Prediction) => void, names: Record<string, string> = {}) {
  const book = model.newBook();
  const sorted = [...matches].sort((x, y) => x.date.getTime() - y.date.getTime() || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  for (const m of sorted) {
    if (onPrediction) {
      const inp = book.buildInput({ home: m.home, away: m.away, kickoff: m.date, competition: m.competition, neutral: m.neutral, homeName: names[m.home], awayName: names[m.away] });
      onPrediction(m, model.predict(inp));
    }
    book.update(m);
  }
  return book;
}

// ------------------------------------------------------------------ sources
export type SourceId = 'model' | 'market' | 'clubelo' | 'espn';

export const SOURCE_INFO: Record<SourceId, { label: string; prior: number; description: string }> = {
  model: { label: 'MK Sports model', prior: 1.0, description: 'Elo + Poisson / net-rating model trained on the last 12 months of results' },
  market: { label: 'Market consensus', prior: 2.0, description: 'Probabilities implied by betting-market prices, margin removed (odds are never shown)' },
  clubelo: { label: 'ClubElo', prior: 1.3, description: 'Independent Elo ratings for European clubs (clubelo.com)' },
  espn: { label: 'ESPN Analytics', prior: 1.3, description: "ESPN's matchup predictor" },
};

export type SourceForecast = { source: SourceId; probs: Probs };
/** Per source: n matches it forecast, and its mean log loss minus the model's on those same
 * matches (delta < 0 = more accurate than the model). The model itself has delta 0. */
export type SourceStats = Partial<Record<SourceId, { n: number; delta: number }>>;

const MIN_EVIDENCE = 20;
const MAX_EVIDENCE = 300;

export function sourceWeights(sources: SourceId[], stats: SourceStats, temperature = 2): Record<string, number> {
  const withEvidence = sources.filter((s) => s === 'model' || (stats[s]?.n ?? 0) >= MIN_EVIDENCE);
  const ref = Math.min(0, ...withEvidence.map((s) => (s === 'model' ? 0 : stats[s]!.delta)));
  const raw: Record<string, number> = {};
  for (const s of sources) {
    let w = SOURCE_INFO[s].prior;
    const st = s === 'model' ? { n: Math.max(...withEvidence.map((x) => (x === 'model' ? 0 : stats[x]!.n)), 0), delta: 0 } : stats[s];
    if (st && withEvidence.length > 1 && withEvidence.includes(s)) w *= Math.exp(-(Math.min(st.n, MAX_EVIDENCE) * (st.delta - ref)) / temperature);
    raw[s] = w;
  }
  const total = Object.values(raw).reduce((a, b) => a + b, 0) || 1;
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v / total]));
}

export function blend(forecasts: SourceForecast[], weights: Record<string, number>, hasDraws: boolean): Probs {
  const keys: Outcome[] = hasDraws ? ['home', 'draw', 'away'] : ['home', 'away'];
  const usable = forecasts.filter((f) => keys.every((k) => typeof f.probs[k] === 'number'));
  const wsum = usable.reduce((s, f) => s + (weights[f.source] ?? 0), 0) || 1;
  const out: Probs = {};
  for (const k of keys) out[k] = usable.reduce((s, f) => s + (weights[f.source] ?? 0) * (f.probs[k] as number), 0) / wsum;
  const z = keys.reduce((s, k) => s + (out[k] as number), 0);
  for (const k of keys) out[k] = (out[k] as number) / z;
  return out;
}

/** Bookmaker prices -> probabilities with the margin removed (proportional method). */
export function impliedFromDecimal(prices: Partial<Record<Outcome, number>>): Probs | null {
  const keys = (Object.keys(prices) as Outcome[]).filter((k) => (prices[k] ?? 0) > 1);
  if (keys.length < 2) return null;
  const inv = keys.map((k) => 1 / (prices[k] as number));
  const z = inv.reduce((a, b) => a + b, 0);
  return Object.fromEntries(keys.map((k, i) => [k, inv[i] / z])) as Probs;
}

export function americanToDecimal(ml: number | string | null | undefined): number | null {
  if (ml === null || ml === undefined || ml === '') return null;
  const s = String(ml).trim().toUpperCase();
  if (s === 'EVEN' || s === 'EV') return 2;
  const v = Number(s);
  if (!Number.isFinite(v) || v === 0) return null;
  return v > 0 ? 1 + v / 100 : 1 + 100 / Math.abs(v);
}

/**
 * Make the model's scoreline agree with the blended probabilities: keep the model's expected
 * total goals, find the goal supremacy whose Poisson grid reproduces P(home) - P(away), and
 * take the most likely score inside the blended favourite.
 */
export function footballScoreFor(blended: Probs, totalGoals: number, rho = -0.08): { score: [number, number]; lambdas: [number, number] } {
  const target = (blended.home ?? 0) - (blended.away ?? 0);
  const total = clamp(totalGoals, 1, 5);
  let lo = -total + 0.3;
  let hi = total - 0.3;
  let grid = scoreMatrix(total / 2, total / 2, 10, rho);
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    grid = scoreMatrix((total + mid) / 2, (total - mid) / 2, 10, rho);
    const [h, , a] = outcomeProbabilities(grid);
    if (h - a < target) lo = mid;
    else hi = mid;
  }
  const sup = (lo + hi) / 2;
  return { score: mostLikelyScore(grid, argmax(blended)), lambdas: [(total + sup) / 2, (total - sup) / 2] };
}

export function basketballScoreFor(blended: Probs, totalPoints: number, sigma: number): { score: [number, number]; margin: number } {
  const pHome = clamp(blended.home ?? 0.5, 0.01, 0.99);
  const margin = sigma * normalInv(pHome);
  let h = Math.round((totalPoints + margin) / 2);
  let a = Math.round((totalPoints - margin) / 2);
  if (h === a) {
    if (pHome >= 0.5) h += 1;
    else a += 1;
  }
  if (h > a !== pHome >= 0.5) [h, a] = [a, h];
  return { score: [h, a], margin };
}

export const modelProbs = (p: Prediction): Probs => probabilities(p);
