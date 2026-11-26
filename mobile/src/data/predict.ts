/**
 * Predictions on the device.
 *
 *  1. Ratings: a rating book per sport, replayed from the stored real results.
 *  2. Sources: the MK Sports model, plus whatever independent forecasts exist for the
 *     match: market consensus (prices -> probabilities), ClubElo, ESPN Analytics.
 *  3. Blend: weights lean towards the sources that have been more accurate on the same
 *     matches (walk-forward backtest on history + forecasts this device saw before kick-off).
 *  4. Every pre-kick-off forecast is snapshotted and scored once the result is in.
 */
import {
  argmax,
  basketballScoreFor,
  blend,
  brier,
  Confidence,
  FinishedMatch,
  footballScoreFor,
  getModel,
  isCorrect,
  KeyFactor,
  logLoss,
  Outcome,
  outcomeOf,
  Prediction,
  probabilities,
  Probs,
  SOURCE_INFO,
  SourceForecast,
  SourceId,
  SourceStats,
  sourceWeights,
  SportModel,
} from '@/engine';

import { clubEloFor } from './clubelo';
import type { Injury, SEvent, TeamInfo } from './espn';
import { historyVersion, sportMatches } from './history';
import { readKV, writeKV } from './kv';
import { MATCH_LEAGUES, SportSlug, sportOf } from './leagues';
import { remoteAccuracy, remoteFile, remoteFor, RemoteMatch, remoteSource } from './remote';
import { DEVICE_TRACK, drawNoteText, MODEL_DRAW_NOTE, saferCall, tierOf, TIER_LABEL as TIER_LABELS } from '../engine/calls';

const MODEL_VERSION = '2.1.0';
export const PREDICTED_SPORTS: SportSlug[] = ['football', 'basketball', 'american-football', 'ice-hockey', 'baseball'];
const hasDrawsOf = (sport: string) => !!sportOf(sport)?.hasDraws;
const names = new Map<string, string>();
const disabled = new Set<SourceId>();

/** Settings: e.g. leave the betting-market consensus out of forecasts. */
export function setDisabledSources(list: SourceId[]) {
  disabled.clear();
  list.forEach((s) => disabled.add(s));
  books.clear();
}

export function registerTeams(teams: TeamInfo[]) {
  for (const t of teams) names.set(t.id, t.short);
}

function modelFor(sport: SportSlug): SportModel {
  const lp: Record<string, Record<string, number>> = {};
  for (const l of MATCH_LEAGUES) if (l.sport === sport && l.modelParams) lp[l.slug] = l.modelParams;
  return getModel(sport, {}, lp);
}

function toFinished(sport: SportSlug, ms: ReturnType<typeof sportMatches>): FinishedMatch[] {
  return ms.map((m) => ({ id: `${m.league}~${m.espnId}`, date: m.date, home: `${sport}:${m.home}`, away: `${sport}:${m.away}`, homeScore: m.homeScore, awayScore: m.awayScore, competition: m.league, neutral: m.neutral }));
}

type BookEntry = { version: number; before: number | null; model: SportModel; book: ReturnType<SportModel['newBook']> };
const books = new Map<string, BookEntry>();

/** The rating book for a sport (optionally as it stood before a given kick-off). */
export function bookFor(sport: SportSlug, before?: number): BookEntry | null {
  const v = historyVersion();
  const key = `${sport}|${before ?? ''}`;
  const hit = books.get(key);
  if (hit && hit.version === v) return hit;
  const ms = sportMatches(sport, before);
  if (!ms.length) return null;
  const model = modelFor(sport);
  const book = model.newBook();
  book.updateMany(toFinished(sport, ms));
  const entry = { version: v, before: before ?? null, model, book };
  if (before !== undefined) for (const k of [...books.keys()]) if (k.startsWith(`${sport}|`) && k !== `${sport}|`) books.delete(k);
  books.set(key, entry);
  return entry;
}

// ------------------------------------------------------------------ source accuracy
type EvalRecord = { id: string; sport: SportSlug; league: string; kickoff: number; home: string; away: string; score: string; outcome: Outcome; sources: Partial<Record<SourceId, Probs>>; blended: Probs; confidence: Confidence };
type Snapshot = Omit<EvalRecord, 'outcome' | 'score'> & { at: number };

let snapshots: Record<string, Snapshot> | null = null;
let evals: EvalRecord[] | null = null;
const SNAP_KEY = 'pred:snap:v1';
const EVAL_KEY = 'pred:eval:v1';

async function loadStores() {
  if (!snapshots) snapshots = (await readKV<Record<string, Snapshot>>(SNAP_KEY)) ?? {};
  if (!evals) evals = (await readKV<EvalRecord[]>(EVAL_KEY)) ?? [];
  for (const sp of PREDICTED_SPORTS) {
    if (!backtests.has(sp)) {
      const saved = await readKV<Backtest>(BT_KEY(sp));
      if (saved?.records) backtests.set(sp, saved);
    }
  }
}
export const storesReady = loadStores;

type Backtest = { at: number; count: number; records: { league: string; kickoff: number; outcome: Outcome; model: Probs; market: Probs | null; confidence: Confidence }[] };
const backtests = new Map<SportSlug, Backtest>();
const BT_KEY = (s: SportSlug) => `pred:bt:v1:${s}`;
const changeListeners = new Set<() => void>();
export function onPredictionDataChange(fn: () => void) {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

export const getBacktest = (sport: SportSlug) => backtests.get(sport) ?? null;

const pendingBt = new Set<SportSlug>();
/** Recompute in the background when stale (6h) or the history grew by 5%+; never blocks a screen. */
export function scheduleBacktest(sport: SportSlug) {
  if (pendingBt.has(sport)) return;
  const cur = backtests.get(sport);
  const count = sportMatches(sport).length;
  if (!count) return;
  if (cur && Date.now() - cur.at < 6 * 3600_000 && count < cur.count * 1.05) return;
  pendingBt.add(sport);
  setTimeout(() => {
    try {
      backtest(sport);
      changeListeners.forEach((f) => f());
    } finally {
      pendingBt.delete(sport);
    }
  }, 300);
}

/** Walk-forward: every past match predicted from earlier results only (cold starts skipped). */
export function backtest(sport: SportSlug): Backtest {
  const ms = sportMatches(sport);
  const fin = toFinished(sport, ms);
  const model = modelFor(sport);
  const book = model.newBook();
  const records: Backtest['records'] = [];
  fin.forEach((m, i) => {
    const inp = book.buildInput({ home: m.home, away: m.away, kickoff: m.date, competition: m.competition, neutral: m.neutral });
    if (Math.min(inp.home.games, inp.away.games) >= 3) {
      const p = model.predict(inp);
      const o = outcomeOf(m.homeScore, m.awayScore);
      if (!(o === 'draw' && !hasDrawsOf(sport))) records.push({ league: m.competition, kickoff: m.date.getTime(), outcome: o, model: probabilities(p), market: ms[i].market, confidence: p.confidence });
    }
    book.update(m);
  });
  const bt = { at: Date.now(), count: ms.length, records };
  backtests.set(sport, bt);
  writeKV(BT_KEY(sport), bt);
  return bt;
}

/** Like-for-like evidence per source: mean log-loss gap to the model on shared matches. */
export function sourceStats(sport: SportSlug): SourceStats {
  const acc: Partial<Record<SourceId, { n: number; sum: number }>> = {};
  const add = (s: SourceId, p: Probs, model: Probs, o: Outcome) => {
    const a = (acc[s] ??= { n: 0, sum: 0 });
    a.n += 1;
    a.sum += logLoss(p, o) - logLoss(model, o);
  };
  const bt = backtests.get(sport);
  for (const r of bt?.records ?? []) if (r.market) add('market', r.market, r.model, r.outcome);
  for (const e of evals ?? []) {
    if (e.sport !== sport || !e.sources.model) continue;
    for (const s of Object.keys(e.sources) as SourceId[]) if (s !== 'model' && !(s === 'market' && bt)) add(s, e.sources[s]!, e.sources.model, e.outcome);
  }
  return Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, { n: v!.n, delta: v!.sum / v!.n }])) as SourceStats;
}

// ------------------------------------------------------------------ prediction
export type SourceRow = { source: SourceId; label: string; description: string; probs: Probs; weight: number };
export type FullPrediction = {
  version: number;
  created_at: string;
  trigger: string;
  model: string;
  model_version: string;
  probabilities: Probs;
  predicted_score: [number, number];
  expected: [number, number];
  confidence: Confidence;
  key_factors: KeyFactor[];
  explanation: { method: string; summary: string; steps: { title: string; detail: string }[]; inputs: Record<string, unknown> };
  versions: number;
  correct: boolean | null;
  sources: SourceRow[];
  /** The called outcome when it differs from the plain most-likely one (e.g. a draw call). */
  pick?: Outcome;
  call?: {
    tier: 'strong' | 'likely' | 'lean' | 'toss-up';
    tier_label: string;
    tier_hit_rate: number | null;
    draw_call: boolean;
    safer: { label: string; pair: 'home or draw' | 'away or draw' | 'home or away'; probability: number; hit_rate: number | null };
    /** 'model' = the published MK Sports model; 'device' = the on-device engine (fallback) */
    source: 'model' | 'device';
    /** when the published prediction was made (built-in snapshot or download) */
    made_on?: string;
    draw_note?: string;
    /** how the published prediction moved since its previous version */
    movement?: { from: { home: number; draw: number; away: number }; from_pick: 'home' | 'draw' | 'away' | null; at: string; reason: string };
    /** the published version's identity, for its entry in the public record (proof.json) */
    published?: { match_id: string; made_at: string };
  };
  goals?: { over25: number; btts: number | null };
};
export type MiniPrediction = { home: number; draw: number | null; away: number; score: [number, number]; confidence: Confidence; pick: Outcome; tier?: 'strong' | 'likely' | 'lean' | 'toss-up'; safer?: string; safer_p?: number; source?: 'model' | 'device'; draw_note?: boolean };

const pct = (x: number | undefined) => `${Math.round((x ?? 0) * 100)}%`;
const LEVELS: Confidence[] = ['low', 'medium', 'high'];

function toAbsences(list: Injury[] | undefined) {
  return (list ?? []).filter((i) => i.status !== 'available').map((i) => ({ player: i.player, position: i.position, importance: i.importance, reason: i.status, tag: i.importance >= 1 ? 'star' : null }));
}

export type PredictOptions = { injuries?: { home: Injury[]; away: Injury[] } | null; espnPredictor?: Probs | null; before?: number };

/** A published MK Sports pipeline prediction as the app's prediction object (no on-device computation). */
export function fromRemote(ev: SEvent, r: RemoteMatch): FullPrediction {
  const probs: Probs = { home: r.p.home, draw: r.p.draw, away: r.p.away };
  // graded entries in the file's `recent` list carry only the probabilities, the call and the result
  const [lh, la] = r.expected_goals ?? [null, null];
  const total = lh !== null && la !== null ? lh + la : 2.6;
  const call = r.call;
  const fav: Outcome = call?.pick ?? argmax(probs);
  const sc = footballScoreFor(probs, total, undefined, fav);
  const name = (o: Outcome) => (o === 'home' ? ev.home.short : o === 'away' ? ev.away.short : 'a draw');
  const factors: KeyFactor[] = [];
  const [eh, ea] = r.elo ?? [null, null];
  if (eh !== null && ea !== null && Math.abs(eh - ea) >= 25)
    factors.push({ text: `${eh > ea ? ev.home.short : ev.away.short} rated higher (Elo ${Math.round(Math.max(eh, ea))} vs ${Math.round(Math.min(eh, ea))})`, impact: Math.min(1, Math.abs(eh - ea) / 200), favours: eh > ea ? 'home' : 'away', category: 'form' });
  if (lh !== null && la !== null)
    factors.push({ text: `Goals model expects ${lh.toFixed(1)}-${la.toFixed(1)}`, impact: Math.min(1, Math.abs(lh - la)), favours: Math.abs(lh - la) < 0.15 ? 'neutral' : lh > la ? 'home' : 'away', category: 'attack' });
  const mk = r.components?.market ?? [null, null, null];
  if (r.variant === 'with odds' && mk[0] != null) {
    const mo: Outcome = mk[0]! >= mk[2]! && mk[0]! >= mk[1]! ? 'home' : mk[2]! >= mk[1]! ? 'away' : 'draw';
    factors.push({ text: `The betting market also leans ${mo === fav ? 'the same way' : `towards ${name(mo)}`}`, impact: 0.5, favours: mo === 'draw' ? 'neutral' : mo, category: 'sources' });
  } else factors.push({ text: 'Bookmaker odds not published yet: this forecast will update when they are', impact: 0.2, favours: 'neutral', category: 'sources' });
  const top = probs[fav] ?? 0;
  const rec = remoteAccuracy()?.track_record;
  const tierRec = call ? rec?.tiers?.[call.tier] : undefined;
  const head =
    fav === 'draw'
      ? `Draw called (${pct(top)}): evenly matched, neither side clearly ahead`
      : call?.tier === 'toss-up'
        ? `Too close to call, ${name(fav)} marginally ahead (${pct(top)})`
        : `${name(fav)} are favourites (${pct(top)})`;
  const dcName = (c: string) => (c === 'home or draw' ? `${ev.home.short} or draw` : c === 'away or draw' ? `${ev.away.short} or draw` : `${ev.home.short} or ${ev.away.short} (no draw)`);
  if (fav === 'draw') factors.unshift({ text: `Draw called: draw ${pct(probs.draw)} vs ${ev.home.short} ${pct(probs.home)} and ${ev.away.short} ${pct(probs.away)}`, impact: 0.7, favours: 'neutral', category: 'draw' });
  const comp = (k: keyof RemoteMatch['components'], label: string) => {
    const v = r.components?.[k];
    return !v || v[0] == null ? null : `${label}: ${ev.home.short} ${pct(v[0]!)} · draw ${pct(v[1]!)} · ${ev.away.short} ${pct(v[2]!)}`;
  };
  const fileInfo = remoteFile();
  return {
    version: r.versions ?? 1,
    created_at: r.made_at,
    trigger: r.last_change,
    model: 'mksports-pipeline',
    model_version: r.model_version ?? fileInfo?.model_version ?? 'unknown',
    probabilities: probs,
    predicted_score: sc.score,
    expected: [Math.round((lh ?? sc.lambdas[0]) * 100) / 100, Math.round((la ?? sc.lambdas[1]) * 100) / 100],
    confidence: r.confidence_label,
    key_factors: factors.slice(0, 5),
    explanation: {
      method: 'MK Sports model: Elo + Dixon-Coles (goals and shots) + boosted trees, blended and calibrated; bookmaker odds included once published',
      summary: `${head}. Most likely score ${sc.score[0]}-${sc.score[1]}.`,
      steps: [
        ...[comp('elo', 'Elo ratings'), comp('dc', 'Goals model'), comp('dcx', 'Shots model'), comp('gbm_nomkt', 'Boosted trees'), comp('market', 'Betting market')]
          .filter((x): x is string => !!x)
          .map((d) => ({ title: d.split(':')[0], detail: d.split(': ')[1] })),
        { title: 'Final forecast', detail: `${ev.home.short} ${pct(probs.home)} · draw ${pct(probs.draw)} · ${ev.away.short} ${pct(probs.away)}` },
        ...(call ? [{ title: 'Call strength', detail: `${TIER_LABEL[call.tier]}${tierRec ? `: calls this strong were right ${pct(tierRec.hit_rate)} of the time in ${tierRec.n.toLocaleString()} backtested matches` : ''}` }] : []),
        ...(call ? [{ title: 'Safer call', detail: `${dcName(call.double_chance.call)} (${pct(call.double_chance.probability)})` }] : []),
        { title: 'Confidence', detail: `${r.confidence_label}${r.confidence_reasons?.length ? `: ${r.confidence_reasons.join('; ')}` : ''}` },
        { title: 'Last update', detail: `${new Date(r.made_at).toUTCString()} (${r.last_change})${remoteSource() === 'bundled' ? '. Built into this version of the app; the app downloads newer predictions when they are published.' : ''}` },
        { title: 'Data', detail: fileInfo?.attribution ?? 'football-data.co.uk, openfootball' },
      ],
      inputs: { model_version: r.model_version ?? fileInfo?.model_version, data_version: fileInfo?.data_version, variant: r.variant, confidence_score: r.confidence },
    },
    versions: r.versions ?? 1,
    correct: null,
    sources: [{ source: 'model', label: 'MK Sports model', description: 'Published daily by the MK Sports data pipeline', probs, weight: 1 }],
    pick: fav,
    call: call
      ? {
          tier: call.tier,
          tier_label: TIER_LABEL[call.tier],
          tier_hit_rate: tierRec?.hit_rate ?? null,
          draw_call: call.draw_call,
          safer: { label: dcName(call.double_chance.call), pair: call.double_chance.call, probability: call.double_chance.probability, hit_rate: rec?.double_chance?.hit_rate ?? null },
          source: 'model',
          made_on: r.made_at,
          published: { match_id: r.match_id, made_at: r.made_at },
          movement: r.previous ? { from: r.previous.p, from_pick: r.previous.pick, at: r.previous.made_at, reason: r.last_change } : undefined,
          draw_note: (() => {
            const dn = rec?.draw_note ? { min: rec.draw_note.min_draw, drawn: rec.draw_note.ended_level } : MODEL_DRAW_NOTE;
            return !call.draw_call && r.p.draw >= dn.min ? drawNoteText(r.p.draw, dn.drawn) : undefined;
          })(),
        }
      : undefined,
    goals: r.goals && r.goals.over25 !== null ? { over25: r.goals.over25, btts: r.goals.btts } : undefined,
  };
}
const TIER_LABEL = TIER_LABELS;

export function predictEvent(ev: SEvent, opts: PredictOptions = {}): FullPrediction | null {
  // covered football competitions: the published pipeline prediction (falls back below only if missing)
  if (ev.sport === 'football') {
    const r = remoteFor(ev);
    if (r) return fromRemote(ev, r);
  }
  const entry = bookFor(ev.sport, opts.before);
  if (!entry) return null;
  const { model, book } = entry;
  const sport = ev.sport;
  const inp = book.buildInput({
    home: ev.home.id,
    away: ev.away.id,
    kickoff: new Date(ev.start),
    competition: ev.league,
    neutral: ev.neutral,
    homeAbsences: toAbsences(opts.injuries?.home),
    awayAbsences: toAbsences(opts.injuries?.away),
    homeName: ev.home.short,
    awayName: ev.away.short,
  });
  const base: Prediction = model.predict(inp);
  const hasDraws = hasDrawsOf(sport);
  scheduleBacktest(sport);

  const forecasts: SourceForecast[] = [{ source: 'model', probs: probabilities(base) }];
  if (ev.market && !disabled.has('market')) forecasts.push({ source: 'market', probs: ev.market });
  const elo = disabled.has('clubelo') ? null : clubEloFor(ev);
  if (elo) forecasts.push({ source: 'clubelo', probs: elo });
  if (opts.espnPredictor && !disabled.has('espn')) forecasts.push({ source: 'espn', probs: opts.espnPredictor });
  const weights = sourceWeights(
    forecasts.map((f) => f.source),
    sourceStats(sport),
  );
  const blended = blend(forecasts, weights, hasDraws);
  const fav = argmax(blended);

  let score: [number, number];
  let expected: [number, number];
  if (sport === 'football') {
    const r = footballScoreFor(blended, Number(base.explanation.inputs.total_goals ?? base.expectedHome + base.expectedAway));
    score = r.score;
    expected = [Math.round(r.lambdas[0] * 100) / 100, Math.round(r.lambdas[1] * 100) / 100];
  } else {
    const sigma = (model as { paramsFor: (c: string) => { sigma: number } }).paramsFor(ev.league).sigma;
    const r = basketballScoreFor(blended, Number(base.explanation.inputs.total_points ?? base.expectedHome + base.expectedAway), sigma);
    score = r.score;
    expected = [Math.round(((score[0] + score[1] + r.margin) / 2) * 10) / 10, Math.round(((score[0] + score[1] - r.margin) / 2) * 10) / 10];
  }

  // confidence on the blended view
  const top = blended[fav] ?? 0;
  const mp = sport === 'football' ? null : (model as { paramsFor: (c: string) => { highConfidence: number; mediumConfidence: number } }).paramsFor(ev.league);
  const [hi, mid] = sport === 'football' ? [0.6, 0.45] : [mp!.highConfidence, mp!.mediumConfidence];
  let level = top >= hi ? 2 : top >= mid ? 1 : 0;
  const reasons = [top >= mid ? `Favourite has a ${pct(top)} chance` : `No outcome above ${pct(mid)}: a close match`];
  if (Math.min(inp.home.games, inp.away.games) < 5) {
    level -= 1;
    reasons.push('Limited recent data for one of the teams');
  }
  const strong = forecasts.filter((f) => (weights[f.source] ?? 0) >= 0.15);
  if (strong.some((f) => argmax(f.probs) !== fav)) {
    level -= 1;
    reasons.push('The sources disagree on the favourite');
  }
  const confidence = LEVELS[Math.max(0, level)];

  // key factors: one line on what the independent sources say, then the model's reasons
  const ext = forecasts.filter((f) => f.source !== 'model');
  const teamName = (o: Outcome) => (o === 'home' ? ev.home.short : o === 'away' ? ev.away.short : 'a draw');
  const factors: KeyFactor[] = [];
  if (ext.length) {
    const agree = ext.filter((f) => argmax(f.probs) === fav);
    const label = (f: SourceForecast) => (f.source === 'market' ? 'the betting market' : SOURCE_INFO[f.source].label);
    if (agree.length) {
      const who = agree.map(label).join(' and ');
      const p = agree[0].probs[fav];
      factors.push({ text: `${who[0].toUpperCase()}${who.slice(1)} also ${agree.length > 1 ? 'favour' : 'favours'} ${teamName(fav)}${agree.length === 1 && p !== undefined ? ` (${pct(p)})` : ''}`, impact: 0.6, favours: fav === 'draw' ? 'neutral' : fav, category: 'sources' });
    } else {
      const f = ext[0];
      const o = argmax(f.probs);
      factors.push({ text: `${label(f)[0].toUpperCase()}${label(f).slice(1)} favours ${teamName(o)} (${pct(f.probs[o])})`, impact: 0.6, favours: o === 'draw' ? 'neutral' : o, category: 'sources' });
    }
  }
  for (const f of base.keyFactors) if (factors.length < 5) factors.push(f);

  const favName = teamName(fav);
  const head =
    fav === 'draw' ? `A draw is the single most likely result (${pct(top)})` : top < mid ? `Too close to call, with ${favName} marginally favoured (${pct(top)})` : `${favName} ${sport === 'football' ? 'are favourites' : 'favoured'} (${pct(top)})`;
  const reason = factors.find((f) => f.favours === fav)?.text;
  const summary = `${head}${reason ? `. ${reason}.` : '.'} ${sport === 'football' ? 'Most likely score' : 'Projected score'} ${score[0]}-${score[1]}.`;

  const fmt = (p: Probs) => (hasDraws ? `${ev.home.short} ${pct(p.home)} · draw ${pct(p.draw)} · ${ev.away.short} ${pct(p.away)}` : `${ev.home.short} ${pct(p.home)} · ${ev.away.short} ${pct(p.away)}`);
  const steps = [
    ...base.explanation.steps.filter((s) => s.title !== 'Confidence').map((s) => ({ title: `Model: ${s.title}`, detail: s.detail })),
    {
      title: 'Combining sources',
      detail:
        forecasts.map((f) => `${SOURCE_INFO[f.source].label} (weight ${pct(weights[f.source])}): ${fmt(f.probs)}`).join('. ') +
        '. Weights favour the sources that have been more accurate on the same past matches.',
    },
    { title: 'Final forecast', detail: `${fmt(blended)}; ${sport === 'football' ? 'most likely score' : 'projected score'} ${score[0]}-${score[1]}` },
    { title: 'Confidence', detail: reasons.join('; ') },
  ];

  // call strength, safer call and the draw note (football): the device engine never calls a draw
  let call: FullPrediction['call'];
  if (sport === 'football') {
    const tier = tierOf(top);
    const safe = saferCall(blended, fav);
    const pairLabel = safe.pair === 'home or draw' ? `${ev.home.short} or draw` : safe.pair === 'away or draw' ? `${ev.away.short} or draw` : `${ev.home.short} or ${ev.away.short}`;
    const dn = (blended.draw ?? 0) >= DEVICE_TRACK.drawNote.min ? drawNoteText(blended.draw ?? 0, DEVICE_TRACK.drawNote.drawn) : undefined;
    call = { tier, tier_label: TIER_LABELS[tier], tier_hit_rate: DEVICE_TRACK.tiers[tier], draw_call: false, safer: { label: pairLabel, pair: safe.pair, probability: safe.probability, hit_rate: DEVICE_TRACK.safer }, source: 'device', draw_note: dn };
  }

  return {
    call,
    pick: fav,
    version: 1,
    created_at: new Date().toISOString(),
    trigger: opts.before !== undefined ? 'pre-match' : 'live',
    model: 'mksports-ensemble',
    model_version: MODEL_VERSION,
    probabilities: blended,
    predicted_score: score,
    expected,
    confidence,
    key_factors: factors,
    explanation: { method: `MK Sports model + ${ext.length ? ext.map((f) => SOURCE_INFO[f.source].label).join(' + ') : 'no external sources available'}`, summary, steps, inputs: base.explanation.inputs },
    versions: 1,
    correct: null,
    sources: forecasts.map((f) => ({ source: f.source, label: SOURCE_INFO[f.source].label, description: SOURCE_INFO[f.source].description, probs: f.probs, weight: weights[f.source] ?? 0 })),
  };
}

export function mini(p: FullPrediction): MiniPrediction {
  const pr = p.probabilities;
  return {
    home: pr.home ?? 0, draw: pr.draw ?? null, away: pr.away ?? 0, score: p.predicted_score, confidence: p.confidence, pick: p.pick ?? argmax(pr),
    tier: p.call?.tier, safer: p.call?.safer.label, safer_p: p.call?.safer.probability, source: p.call?.source, draw_note: !!p.call?.draw_note,
  };
}

// ------------------------------------------------------------------ snapshots & scoring
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function persist() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeKV(SNAP_KEY, snapshots);
    writeKV(EVAL_KEY, evals);
  }, 1500);
}

/** Remember the latest pre-kick-off forecast so it can be scored after the match. */
export function snapshot(ev: SEvent, p: FullPrediction) {
  if (!snapshots || ev.status !== 'scheduled' || Date.parse(ev.start) <= Date.now()) return;
  const prev = snapshots[ev.id];
  if (prev && Date.now() - prev.at < 10 * 60_000 && Object.keys(prev.sources).length >= p.sources.length) return;
  snapshots[ev.id] = {
    id: ev.id,
    sport: ev.sport,
    league: ev.league,
    kickoff: Date.parse(ev.start),
    home: ev.home.short,
    away: ev.away.short,
    sources: Object.fromEntries(p.sources.map((s) => [s.source, s.probs])),
    blended: p.probabilities,
    confidence: p.confidence,
    at: Date.now(),
  };
  persist();
}

export function preMatchSnapshot(id: string): Snapshot | null {
  return snapshots?.[id] ?? null;
}

/** Score snapshots whose matches have finished. */
export function scoreFinished(events: SEvent[]) {
  if (!snapshots || !evals) return;
  let changed = false;
  for (const ev of events) {
    const s = snapshots[ev.id];
    if (!s) continue;
    if (ev.status === 'cancelled' || ev.status === 'postponed') {
      delete snapshots[ev.id];
      changed = true;
    } else if (ev.status === 'finished' && ev.homeScore !== null && ev.awayScore !== null) {
      const o = outcomeOf(ev.homeScore, ev.awayScore);
      if (!(o === 'draw' && !hasDrawsOf(ev.sport))) evals.unshift({ ...s, outcome: o, score: `${ev.homeScore}-${ev.awayScore}` });
      delete snapshots[ev.id];
      changed = true;
    }
  }
  if (changed) {
    evals.length = Math.min(evals.length, 1000);
    persist();
  }
}

export function liveEvaluations(): EvalRecord[] {
  return evals ?? [];
}

export function scorePrediction(p: Probs, homeScore: number, awayScore: number) {
  const o = outcomeOf(homeScore, awayScore);
  return { correct: isCorrect(p, o), brier: brier(p, o), logLoss: logLoss(p, o) };
}

export async function clearPredictionStores() {
  snapshots = {};
  evals = [];
  books.clear();
  backtests.clear();
  await writeKV(SNAP_KEY, {});
  await writeKV(EVAL_KEY, []);
}
