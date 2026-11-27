// Port of predictpro_engine/football.py, basketball.py and confidence.py (the NBA's opponent-adjusted ratings, engine/ridge.ts, are app-only)
import {
  Absence,
  absenceWeight,
  basketballMovMultiplier,
  clamp,
  Confidence,
  EloConfig,
  FinishedMatch,
  fmt0,
  footballMovMultiplier,
  KeyFactor,
  MatchInput,
  mostLikelyScore,
  normalCdf,
  outcomeProbabilities,
  pct0,
  Prediction,
  pyRound,
  RatingBook,
  scoreMatrix,
  signed,
  TeamState,
} from './core';
import { absenceFactors, dataFactor, formFactors, h2hFactor, homeAdvantageFactor, ratingFactor, selectFactors, venueFactor } from './factors';
import { RidgeStore } from './ridge';

// ------------------------------------------------------------------ confidence
const LEVELS: Confidence[] = ['low', 'medium', 'high'];

export function confidenceLevel(top: number, high: number, medium: number, minGames: number, minGamesPlayed: number, disagree: boolean): [Confidence, string[]] {
  let idx: number;
  let reasons: string[];
  if (top >= high) [idx, reasons] = [2, [`Favourite has a ${pct0(top)} chance`]];
  else if (top >= medium) [idx, reasons] = [1, [`Favourite has a ${pct0(top)} chance`]];
  else [idx, reasons] = [0, [`No outcome above ${pct0(medium)}: a close match`]];
  if (minGamesPlayed < minGames) {
    idx -= 1;
    reasons.push(`Limited data (a team has played fewer than ${minGames} recorded matches)`);
  }
  if (disagree) {
    idx -= 1;
    reasons.push('Ratings and recent scoring disagree on the favourite');
  }
  return [LEVELS[Math.max(0, idx)], reasons];
}

function merge<T extends object>(base: T, over?: Partial<T>): T {
  return { ...base, ...(over ?? {}) };
}

// ------------------------------------------------------------------ football
export type FootballParams = {
  k: number;
  homeAdvantageElo: number;
  initialElo: number;
  eloPointsPerGoal: number;
  eloWeight: number;
  strengthAlpha: number;
  leagueAvgAlpha: number;
  defaultHomeGoals: number;
  defaultAwayGoals: number;
  totalShrink: number;
  dixonColesRho: number;
  maxGoals: number;
  highConfidence: number;
  mediumConfidence: number;
  minGames: number;
};

export const FOOTBALL_DEFAULTS: FootballParams = {
  k: 20,
  homeAdvantageElo: 65,
  initialElo: 1500,
  eloPointsPerGoal: 250,
  eloWeight: 0.5,
  strengthAlpha: 0.12,
  leagueAvgAlpha: 0.02,
  defaultHomeGoals: 1.55,
  defaultAwayGoals: 1.25,
  totalShrink: 0.3,
  dixonColesRho: -0.08,
  maxGoals: 10,
  highConfidence: 0.6,
  mediumConfidence: 0.45,
  minGames: 5,
};

export class FootballBook extends RatingBook {
  sport = 'football';
  attack = new Map<string, number>();
  defence = new Map<string, number>();
  avgs = new Map<string, [number, number]>();

  constructor(public p: FootballParams) {
    super({ k: p.k, homeAdvantage: p.homeAdvantageElo, initial: p.initialElo, seasonGapDays: 60, seasonRegression: 1 / 3 } as EloConfig);
  }

  leagueAverages(c: string): [number, number] {
    return this.avgs.get(c) ?? [this.p.defaultHomeGoals, this.p.defaultAwayGoals];
  }

  protected updateStats(m: FinishedMatch) {
    const a = this.p.strengthAlpha;
    let [avgH, avgA] = this.leagueAverages(m.competition);
    if (m.neutral) avgH = avgA = (avgH + avgA) / 2;
    const attH = this.attack.get(m.home) ?? 1;
    const defH = this.defence.get(m.home) ?? 1;
    const attA = this.attack.get(m.away) ?? 1;
    const defA = this.defence.get(m.away) ?? 1;
    const obsAttH = clamp(m.homeScore / Math.max(0.2, avgH * defA), 0, 4);
    const obsDefH = clamp(m.awayScore / Math.max(0.2, avgA * attA), 0, 4);
    const obsAttA = clamp(m.awayScore / Math.max(0.2, avgA * defH), 0, 4);
    const obsDefA = clamp(m.homeScore / Math.max(0.2, avgH * attH), 0, 4);
    this.attack.set(m.home, (1 - a) * attH + a * obsAttH);
    this.defence.set(m.home, (1 - a) * defH + a * obsDefH);
    this.attack.set(m.away, (1 - a) * attA + a * obsAttA);
    this.defence.set(m.away, (1 - a) * defA + a * obsDefA);
    if (!m.neutral) {
      const b = this.p.leagueAvgAlpha;
      const [ch, ca] = this.leagueAverages(m.competition);
      this.avgs.set(m.competition, [(1 - b) * ch + b * m.homeScore, (1 - b) * ca + b * m.awayScore]);
    }
  }

  protected regressStats(team: string) {
    for (const d of [this.attack, this.defence]) if (d.has(team)) d.set(team, d.get(team)! + (1 - d.get(team)!) / 3);
  }

  protected movMultiplier(m: FinishedMatch): number {
    return footballMovMultiplier(m.homeScore - m.awayScore);
  }

  teamState(team: string, name?: string): TeamState {
    const st = super.teamState(team, name);
    st.attack = this.attack.get(team) ?? 1;
    st.defence = this.defence.get(team) ?? 1;
    return st;
  }
}

function absencePenalties(abs: Absence[]): [number, number, string[]] {
  let att = 0;
  let dfn = 0;
  const notes: string[] = [];
  for (const a of abs) {
    const pos = (a.position ?? '').toUpperCase();
    const w = absenceWeight(a);
    if (['FWD', 'FW', 'ST', 'F'].includes(pos)) att += 0.1 * w;
    else if (['MID', 'MF', 'M'].includes(pos)) {
      att += 0.05 * w;
      dfn += 0.03 * w;
    } else if (['DEF', 'DF', 'D'].includes(pos)) dfn += 0.07 * w;
    else if (['GK', 'G'].includes(pos)) dfn += 0.08 * w;
    else {
      att += 0.04 * w;
      dfn += 0.03 * w;
    }
    if (w > 0) notes.push(a.player);
  }
  return [Math.min(att, 0.3), Math.min(dfn, 0.3), notes];
}

export class FootballModel {
  sport = 'football';
  name = 'football-elo-poisson';
  version = '1.0.0';
  hasDraws = true;
  params: FootballParams;
  leagueParams: Record<string, FootballParams>;

  constructor(params?: Partial<FootballParams>, leagueParams?: Record<string, Partial<FootballParams>>) {
    this.params = merge(FOOTBALL_DEFAULTS, params);
    this.leagueParams = Object.fromEntries(Object.entries(leagueParams ?? {}).map(([k, v]) => [k, merge(this.params, v)]));
  }

  paramsFor(c: string): FootballParams {
    return this.leagueParams[c] ?? this.params;
  }

  newBook(): FootballBook {
    return new FootballBook(this.params);
  }

  predict(inp: MatchInput): Prediction {
    const p = this.paramsFor(inp.competition);
    const { home, away } = inp;
    const ha = inp.neutral ? 0 : p.homeAdvantageElo;
    const eloDiff = home.elo + ha - away.elo;
    let avgH = inp.leagueAvgHome || p.defaultHomeGoals;
    let avgA = inp.leagueAvgAway || p.defaultAwayGoals;
    if (inp.neutral) avgH = avgA = (avgH + avgA) / 2;
    const lamHAd = avgH * home.attack * away.defence;
    const lamAAd = avgA * away.attack * home.defence;
    const total = (1 - p.totalShrink) * (lamHAd + lamAAd) + p.totalShrink * (avgH + avgA);
    const supAd = lamHAd - lamAAd;
    const supElo = eloDiff / p.eloPointsPerGoal;
    const sup = p.eloWeight * supElo + (1 - p.eloWeight) * supAd;
    let lamH = Math.max(0.15, (total + sup) / 2);
    let lamA = Math.max(0.15, (total - sup) / 2);
    const [baseH, baseA] = [lamH, lamA];
    const [hAtt, hDef, hNotes] = absencePenalties(inp.homeAbsences);
    const [aAtt, aDef, aNotes] = absencePenalties(inp.awayAbsences);
    lamH *= (1 - hAtt) * (1 + aDef);
    lamA *= (1 - aAtt) * (1 + hDef);

    const grid = scoreMatrix(lamH, lamA, p.maxGoals, p.dixonColesRho);
    const [ph, pd, pa] = outcomeProbabilities(grid);
    const probs = { home: ph, draw: pd, away: pa };
    const fav = (Object.keys(probs) as (keyof typeof probs)[]).reduce((b, k) => (probs[k] > probs[b] ? k : b), 'home' as keyof typeof probs);
    const score = mostLikelyScore(grid, fav);
    const disagree = Math.abs(supElo) > 0.15 && Math.abs(supAd) > 0.15 && supElo > 0 !== supAd > 0;
    const [conf, confReasons] = confidenceLevel(probs[fav], p.highConfidence, p.mediumConfidence, p.minGames, Math.min(home.games, away.games), disagree);
    const factors = this.factors(inp, p, eloDiff);

    const steps = [
      {
        title: 'Team strength (Elo)',
        detail: `${home.name} ${fmt0(home.elo)} vs ${away.name} ${fmt0(away.elo)}` + (inp.neutral ? '; neutral venue' : `; +${fmt0(ha)} home advantage`) + ` -> ${eloDiff >= 0 ? '+' : ''}${fmt0(eloDiff)} for ${home.name}`,
      },
      {
        title: 'Attack & defence (recent matches, weighted)',
        detail: `${home.name} attack ${home.attack.toFixed(2)}x / defence ${home.defence.toFixed(2)}x league average; ${away.name} attack ${away.attack.toFixed(2)}x / defence ${away.defence.toFixed(2)}x (defence below 1 = concedes less)`,
      },
      { title: 'Expected goals', detail: `Attack/defence alone: ${lamHAd.toFixed(2)}-${lamAAd.toFixed(2)}. Blended with Elo (${pct0(p.eloWeight)} weight): ${baseH.toFixed(2)}-${baseA.toFixed(2)}` },
    ];
    const news: string[] = [];
    for (const [team, att, dfn, notes] of [
      [home, hAtt, hDef, hNotes],
      [away, aAtt, aDef, aNotes],
    ] as const) {
      if (notes.length) {
        const parts = [...(att >= 0.005 ? [`attack -${pct0(att)}`] : []), ...(dfn >= 0.005 ? [`defence weaker by ${pct0(dfn)}`] : [])];
        news.push(`${team.name}: ${parts.join(', ') || 'minor impact'} (${notes.slice(0, 3).join(', ')} out)`);
      }
    }
    if (news.length) steps.push({ title: 'Team news', detail: `${news.join('; ')}. Adjusted expected goals: ${lamH.toFixed(2)}-${lamA.toFixed(2)}` });
    steps.push({
      title: 'Outcome probabilities',
      detail: `Poisson score grid -> ${home.name} ${pct0(ph)}, draw ${pct0(pd)}, ${away.name} ${pct0(pa)}. Most likely ${fav} score: ${score[0]}-${score[1]}`,
    });
    steps.push({ title: 'Confidence', detail: confReasons.join('; ') });

    return {
      sport: this.sport,
      model: this.name,
      modelVersion: this.version,
      probHome: pyRound(ph, 4),
      probDraw: pyRound(pd, 4),
      probAway: pyRound(pa, 4),
      predictedHome: score[0],
      predictedAway: score[1],
      expectedHome: pyRound(lamH, 2),
      expectedAway: pyRound(lamA, 2),
      confidence: conf,
      keyFactors: factors,
      explanation: {
        method: 'Elo ratings + Poisson goal model',
        summary: summaryText(home.name, away.name, probs, fav, score, factors, p.mediumConfidence),
        steps,
        inputs: {
          elo_home: pyRound(home.elo, 1),
          elo_away: pyRound(away.elo, 1),
          attack_home: pyRound(home.attack, 3),
          defence_home: pyRound(home.defence, 3),
          attack_away: pyRound(away.attack, 3),
          defence_away: pyRound(away.defence, 3),
          expected_goals_home: pyRound(lamH, 3),
          expected_goals_away: pyRound(lamA, 3),
          total_goals: total,
          games_home: home.games,
          games_away: away.games,
          absences_home: inp.homeAbsences.map((a) => a.player),
          absences_away: inp.awayAbsences.map((a) => a.player),
        },
      },
    };
  }

  private factors(inp: MatchInput, p: FootballParams, _eloDiff: number): KeyFactor[] {
    const { home, away } = inp;
    const c: (KeyFactor | null)[] = [ratingFactor(home, away)];
    c.push(...formFactors(home, 'home', true), ...formFactors(away, 'away', true));
    if (!inp.neutral) c.push(venueFactor(home, 'home', true, true), venueFactor(away, 'away', false, true));
    c.push(...absenceFactors(home, 'home', inp.homeAbsences), ...absenceFactors(away, 'away', inp.awayAbsences));
    c.push(h2hFactor(inp.h2h, home, away));
    c.push(...scoringFactors(home, 'home'), ...scoringFactors(away, 'away'));
    c.push(dataFactor(home, away, p.minGames));
    const haGoals = p.homeAdvantageElo / p.eloPointsPerGoal;
    const better = home.attack >= away.attack ? home : away;
    const worse = better === home ? away : home;
    const fillers = [
      ratingFactor(home, away),
      homeAdvantageFactor(home, inp.neutral, `worth about ${haGoals.toFixed(1)} goals`),
      { text: `${better.name} carry the stronger attack (${better.attack.toFixed(2)}x vs ${worse.attack.toFixed(2)}x league average)`, impact: 0.12, favours: (better === home ? 'home' : 'away') as 'home' | 'away', category: 'attack' },
    ];
    return selectFactors(c, fillers);
  }
}

function scoringFactors(team: TeamState, side: 'home' | 'away'): KeyFactor[] {
  const last = team.recent.slice(0, 5);
  if (last.length < 5) return [];
  const oth = side === 'home' ? 'away' : 'home';
  const gf = last.reduce((s, r) => s + r.scored, 0) / last.length;
  const ga = last.reduce((s, r) => s + r.conceded, 0) / last.length;
  const clean = last.filter((r) => r.conceded === 0).length;
  const out: KeyFactor[] = [];
  if (gf >= 2.2) out.push({ text: `${team.name} averaging ${gf.toFixed(1)} goals in their last 5`, impact: 0.3 + Math.min(0.3, (gf - 2.2) / 4), favours: side, category: 'attack' });
  else if (gf <= 0.6) out.push({ text: `${team.name} have scored just ${last.reduce((s, r) => s + r.scored, 0)} in their last 5`, impact: 0.35, favours: oth, category: 'attack' });
  if (clean >= 3) out.push({ text: `${team.name} kept ${clean} clean sheets in their last 5`, impact: 0.3 + 0.05 * clean, favours: side, category: 'defence' });
  else if (ga >= 2.2) out.push({ text: `${team.name} conceding ${ga.toFixed(1)} goals per game lately`, impact: 0.3, favours: oth, category: 'defence' });
  return out;
}

function summaryText(home: string, away: string, probs: Record<string, number>, fav: string, score: [number, number], factors: KeyFactor[], medium: number): string {
  const top = probs[fav];
  let head: string;
  if (fav === 'draw') head = `A draw is the single most likely result (${pct0(top)})`;
  else if (top < medium) head = `Too close to call, with ${fav === 'home' ? home : away} marginally favoured (${pct0(top)})`;
  else head = `${fav === 'home' ? home : away} are favourites (${pct0(top)})`;
  const reason = factors.find((f) => f.favours === fav)?.text;
  return head + (reason ? `. ${reason}.` : '.') + ` Most likely score ${score[0]}-${score[1]}.`;
}

// ------------------------------------------------------------------ basketball
export type BasketballParams = {
  k: number;
  homeAdvantageElo: number;
  initialElo: number;
  eloPointsPerPoint: number;
  eloWeight: number;
  netShrink: number;
  pointsAlpha: number;
  leagueAvgAlpha: number;
  defaultPoints: number;
  homeCourtPts: number;
  sigma: number;
  backToBackPts: number;
  restedBonusPts: number;
  starAbsencePts: number;
  maxAbsencePts: number;
  highConfidence: number;
  mediumConfidence: number;
  minGames: number;
  /** Share of the margin from opponent-adjusted ratings (engine/ridge.ts); 0 = the original model only. */
  ridgeWeight: number;
  ridgeHalfLife: number;
  ridgeLambda: number;
  ridgeCap: number;
  ridgePrevSeason: number;
  /** 1 = learn the back-to-back effect inside the ratings */
  ridgeBackToBack: number;
};

export const BASKETBALL_DEFAULTS: BasketballParams = {
  k: 20,
  homeAdvantageElo: 70,
  initialElo: 1500,
  eloPointsPerPoint: 28,
  eloWeight: 0.5,
  netShrink: 0.8,
  pointsAlpha: 0.1,
  leagueAvgAlpha: 0.02,
  defaultPoints: 114,
  homeCourtPts: 2.5,
  sigma: 12,
  backToBackPts: -2,
  restedBonusPts: 0.5,
  starAbsencePts: 4.5,
  maxAbsencePts: 12,
  highConfidence: 0.75,
  mediumConfidence: 0.6,
  minGames: 5,
  ridgeWeight: 0,
  ridgeHalfLife: 60,
  ridgeLambda: 2,
  ridgeCap: 20,
  ridgePrevSeason: 1,
  ridgeBackToBack: 1,
};

export class BasketballBook extends RatingBook {
  sport = 'basketball';
  pf = new Map<string, number>();
  pa = new Map<string, number>();
  avg = new Map<string, number>();
  ridge = new RidgeStore();

  constructor(public p: BasketballParams) {
    super({ k: p.k, homeAdvantage: p.homeAdvantageElo, initial: p.initialElo, seasonGapDays: 60, seasonRegression: 0.25 });
  }

  private avgFor(c: string) {
    return this.avg.get(c) ?? this.p.defaultPoints;
  }

  leagueAverages(c: string): [number, number] {
    const a = this.avgFor(c);
    return [a, a];
  }

  protected updateStats(m: FinishedMatch) {
    // every game also goes into the opponent-adjusted ratings (rest from the previous game, before this one is recorded)
    const b2b = (team: string) => (restDays(this.lastPlayed.get(team) ?? null, m.date) === 0 ? 1 : 0);
    this.ridge.add(m.date.getTime(), m.home, m.away, m.homeScore - m.awayScore, m.neutral, b2b(m.home) - b2b(m.away), m.competition);
    const a = this.p.pointsAlpha;
    const base = this.avgFor(m.competition);
    for (const [team, scored, conceded] of [
      [m.home, m.homeScore, m.awayScore],
      [m.away, m.awayScore, m.homeScore],
    ] as const) {
      this.pf.set(team, (1 - a) * (this.pf.get(team) ?? base) + a * scored);
      this.pa.set(team, (1 - a) * (this.pa.get(team) ?? base) + a * conceded);
    }
    const b = this.p.leagueAvgAlpha;
    this.avg.set(m.competition, (1 - b) * base + (b * (m.homeScore + m.awayScore)) / 2);
  }

  protected regressStats(team: string) {
    for (const d of [this.pf, this.pa]) if (d.has(team)) d.set(team, d.get(team)! + (this.p.defaultPoints - d.get(team)!) / 4);
  }

  protected movMultiplier(m: FinishedMatch, eloDiffHome: number): number {
    const winnerDiff = m.homeScore > m.awayScore ? eloDiffHome : -eloDiffHome;
    return basketballMovMultiplier(m.homeScore - m.awayScore, winnerDiff);
  }

  teamState(team: string, name?: string): TeamState {
    const st = super.teamState(team, name);
    st.pointsFor = this.pf.get(team) ?? null;
    st.pointsAgainst = this.pa.get(team) ?? null;
    return st;
  }

  buildInput(o: Parameters<RatingBook['buildInput']>[0]): MatchInput {
    return { ...super.buildInput(o), ridge: this.ridge };
  }
}

export function restDays(last: Date | null, tip: Date): number | null {
  if (!last) return null;
  const hours = (tip.getTime() - last.getTime()) / 3_600_000;
  return Math.max(0, pyRound(hours / 24) - 1);
}

const restText = (d: number | null) => (d === null ? 'season opener' : d === 0 ? 'back-to-back' : `${d} day${d !== 1 ? 's' : ''} rest`);

/** Sport-specific wording for the margin model (basketball by default). */
export type MarginOptions = { sport?: string; name?: string; unit?: string; unitShort?: string; defaults?: BasketballParams };

export class BasketballModel {
  sport = 'basketball';
  name = 'basketball-elo-netrating';
  version = '1.0.0';
  hasDraws = false;
  params: BasketballParams;
  leagueParams: Record<string, BasketballParams>;
  unit = 'points';
  unitShort = 'pts';

  constructor(params?: Partial<BasketballParams>, leagueParams?: Record<string, Partial<BasketballParams>>, opts: MarginOptions = {}) {
    if (opts.sport) this.sport = opts.sport;
    if (opts.name) this.name = opts.name;
    if (opts.unit) this.unit = opts.unit;
    if (opts.unitShort) this.unitShort = opts.unitShort;
    this.params = merge(opts.defaults ?? BASKETBALL_DEFAULTS, params);
    this.leagueParams = Object.fromEntries(Object.entries(leagueParams ?? {}).map(([k, v]) => [k, merge(this.params, v)]));
  }

  paramsFor(c: string): BasketballParams {
    return this.leagueParams[c] ?? this.params;
  }

  newBook(): BasketballBook {
    return new BasketballBook(this.params);
  }

  private restEffect(d: number | null, p: BasketballParams) {
    if (d === null) return 0;
    if (d === 0) return p.backToBackPts;
    return p.restedBonusPts * Math.min(2, d - 1);
  }

  predict(inp: MatchInput): Prediction {
    const p = this.paramsFor(inp.competition);
    const { home, away } = inp;
    const avg = inp.leagueAvgHome || p.defaultPoints;
    const pfH = home.pointsFor ?? avg;
    const paH = home.pointsAgainst ?? avg;
    const pfA = away.pointsFor ?? avg;
    const paA = away.pointsAgainst ?? avg;
    const eloMargin = (home.elo - away.elo) / p.eloPointsPerPoint;
    const netMargin = (pfH - paH - (pfA - paA)) * p.netShrink;
    const base = p.eloWeight * eloMargin + (1 - p.eloWeight) * netMargin;
    const hca = inp.neutral ? 0 : p.homeCourtPts;
    const restH = restDays(home.lastPlayed, inp.kickoff);
    const restA = restDays(away.lastPlayed, inp.kickoff);
    const restAdj = this.restEffect(restH, p) - this.restEffect(restA, p);
    const absH = Math.min(p.maxAbsencePts, inp.homeAbsences.reduce((s, a) => s + p.starAbsencePts * absenceWeight(a), 0));
    const absA = Math.min(p.maxAbsencePts, inp.awayAbsences.reduce((s, a) => s + p.starAbsencePts * absenceWeight(a), 0));
    const engineMargin = base + hca + restAdj;
    // opponent-adjusted ratings, blended in where the competition's settings ask for it (NBA: Step 12)
    const b2b = (d: number | null) => (d === 0 ? 1 : 0);
    const rid =
      p.ridgeWeight > 0 && inp.ridge
        ? inp.ridge.margin(
            { halfLife: p.ridgeHalfLife, lambda: p.ridgeLambda, cap: p.ridgeCap, prevSeason: p.ridgePrevSeason, backToBack: p.ridgeBackToBack > 0 },
            inp.competition,
            home.team,
            away.team,
            inp.neutral,
            b2b(restH) - b2b(restA),
            inp.kickoff.getTime(),
          )
        : null;
    const w = rid ? p.ridgeWeight : 0;
    // absences stay a full adjustment on top of the blend (they come from today's team news, not past results)
    const margin = w * (rid?.margin ?? 0) + (1 - w) * engineMargin - absH + absA;
    const total = (pfH + paA) / 2 + (pfA + paH) / 2 - 0.3 * (absH + absA);
    const pHome = normalCdf(margin / p.sigma);
    const pAway = 1 - pHome;
    let ph = pyRound((total + margin) / 2);
    let pa = pyRound((total - margin) / 2);
    if (ph === pa) {
      if (margin >= 0) ph += 1;
      else pa += 1;
    } else if (ph > pa !== pHome >= 0.5) {
      [ph, pa] = pHome >= 0.5 ? [Math.max(ph, pa), Math.min(ph, pa)] : [Math.min(ph, pa), Math.max(ph, pa)];
    }
    const disagree = Math.abs(eloMargin) > 1.5 && Math.abs(netMargin) > 1.5 && eloMargin > 0 !== netMargin > 0;
    const [conf, confReasons] = confidenceLevel(Math.max(pHome, pAway), p.highConfidence, p.mediumConfidence, p.minGames, Math.min(home.games, away.games), disagree);
    const factors = this.factors(inp, p, restH, restA, pfH, paH, pfA, paA);
    const fav = pHome >= 0.5 ? 'home' : 'away';
    const top = Math.max(pHome, pAway);
    const favName = fav === 'home' ? home.name : away.name;
    const reason = factors.find((f) => f.favours === fav)?.text;
    const head = top >= p.mediumConfidence ? `${favName} favoured (${pct0(top)})` : `Close game, ${favName} slight favourites (${pct0(top)})`;
    return {
      sport: this.sport,
      model: this.name,
      modelVersion: this.version,
      probHome: pyRound(pHome, 4),
      probDraw: null,
      probAway: pyRound(pAway, 4),
      predictedHome: ph,
      predictedAway: pa,
      expectedHome: pyRound((total + margin) / 2, 1),
      expectedAway: pyRound((total - margin) / 2, 1),
      confidence: conf,
      keyFactors: factors,
      explanation: {
        method: 'Elo ratings + net rating (margin model)',
        summary: head + (reason ? `. ${reason}.` : '.') + ` Projected score ${ph}-${pa}.`,
        steps: [
          { title: 'Team strength (Elo)', detail: `${home.name} ${fmt0(home.elo)} vs ${away.name} ${fmt0(away.elo)} -> ${signed(eloMargin)} ${this.unitShort}` },
          { title: `Net rating (${this.unit} scored minus allowed, recent games weighted)`, detail: `${home.name} ${signed(pfH - paH)}, ${away.name} ${signed(pfA - paA)} -> ${signed(netMargin)} ${this.unitShort}` },
          ...(rid
            ? [
                {
                  title: 'Opponent-adjusted ratings (who they beat counts, recent games weighted)',
                  detail: `${home.name} ${signed(rid.home)}, ${away.name} ${signed(rid.away)}${rid.homeAdvantage ? `, home ${signed(rid.homeAdvantage)}` : ''}${rid.rest ? `, rest ${signed(rid.rest)}` : ''} -> ${signed(rid.margin)} ${this.unitShort}; blended ${Math.round(w * 100)}% with the Elo + net rating view (${signed(engineMargin)})`,
                },
              ]
            : []),
          {
            title: 'Adjustments',
            detail: (inp.neutral ? (this.sport === 'basketball' ? 'neutral court' : 'neutral venue') : `home ${this.sport === 'basketball' ? 'court' : 'advantage'} +${hca.toFixed(this.unitShort === 'pts' ? 1 : 2)}`) + `; rest ${signed(restAdj)} (${restText(restH)} vs ${restText(restA)})` + (absH || absA ? `; absences ${signed(absA - absH)}` : ''),
          },
          { title: 'Projected margin & total', detail: `${home.name} by ${signed(margin)}, total ${fmt0(total)} -> ${ph}-${pa}` },
          { title: 'Win probability', detail: `Normal model (sd ${p.sigma < 10 ? p.sigma.toFixed(1) : fmt0(p.sigma)} ${this.unitShort}): ${home.name} ${pct0(pHome)}, ${away.name} ${pct0(pAway)}` },
          { title: 'Confidence', detail: confReasons.join('; ') },
        ],
        inputs: {
          elo_home: pyRound(home.elo, 1),
          elo_away: pyRound(away.elo, 1),
          net_home: pyRound(pfH - paH, 2),
          net_away: pyRound(pfA - paA, 2),
          rest_days_home: restH,
          rest_days_away: restA,
          expected_margin: pyRound(margin, 2),
          ...(rid ? { ridge_margin: pyRound(rid.margin, 2), engine_margin: pyRound(engineMargin, 2), ridge_weight: w } : {}),
          expected_total: pyRound(total, 1),
          total_points: total,
          games_home: home.games,
          games_away: away.games,
          absences_home: inp.homeAbsences.map((a) => a.player),
          absences_away: inp.awayAbsences.map((a) => a.player),
        },
      },
    };
  }

  private factors(inp: MatchInput, p: BasketballParams, restH: number | null, restA: number | null, pfH: number, paH: number, pfA: number, paA: number): KeyFactor[] {
    const { home, away } = inp;
    const c: (KeyFactor | null)[] = [ratingFactor(home, away)];
    c.push(...formFactors(home, 'home', false), ...formFactors(away, 'away', false));
    if (!inp.neutral) c.push(venueFactor(home, 'home', true, false), venueFactor(away, 'away', false, false));
    c.push(...absenceFactors(home, 'home', inp.homeAbsences), ...absenceFactors(away, 'away', inp.awayAbsences));
    c.push(h2hFactor(inp.h2h, home, away));
    for (const [team, side, days] of [
      [home, 'home', restH],
      [away, 'away', restA],
    ] as const) {
      const oth = side === 'home' ? 'away' : 'home';
      if (days === 0 && p.backToBackPts !== 0) c.push({ text: `${team.name} on the second night of a back-to-back`, impact: 0.5, favours: oth, category: 'rest' });
      else if (days !== null && days >= 3 && p.restedBonusPts !== 0) c.push({ text: `${team.name} have had ${days} days' rest`, impact: 0.25, favours: side, category: 'rest' });
    }
    const netH = pfH - paH;
    const netA = pfA - paA;
    const scale = this.sport === 'basketball' ? 1 : p.sigma / 12; // basketball wording/thresholds unchanged
    if (Math.abs(netH - netA) >= 6 * scale && Math.min(home.games, away.games) >= 5) {
      const [better, worse, bside] = netH > netA ? [home, away, 'home' as const] : [away, home, 'away' as const];
      c.push({
        text: `${better.name} outscoring opponents by ${signed(Math.max(netH, netA))} a game (${worse.name} ${signed(Math.min(netH, netA))})`,
        impact: Math.min(1, 0.3 + Math.abs(netH - netA) / (30 * scale)),
        favours: bside,
        category: 'attack',
      });
    }
    c.push(dataFactor(home, away, p.minGames));
    const fillers = [
      ratingFactor(home, away),
      homeAdvantageFactor(home, inp.neutral, `about ${p.homeCourtPts.toFixed(p.homeCourtPts < 1 ? 2 : 1)} ${this.unit}`),
      { text: `Scoring: ${home.name} ${p.defaultPoints < 10 ? pfH.toFixed(1) : fmt0(pfH)} ${this.unitShort}/game, ${away.name} ${p.defaultPoints < 10 ? pfA.toFixed(1) : fmt0(pfA)} ${this.unitShort}/game`, impact: 0.1, favours: 'neutral' as const, category: 'attack' },
    ];
    return selectFactors(c, fillers);
  }
}

export type SportModel = FootballModel | BasketballModel;

/**
 * Margin-model settings for the other head-to-head team sports. Tuned by walk-forward backtests
 * on real ESPN results (mobile/scripts/calibrate-margin.ts): tuned on older games, scored on the
 * most recent 30% it never saw. Held-out hit rate / log loss: NFL 62.1% / 0.636 (256 games),
 * NHL 58.0% / 0.669 (512), MLB 57.0% / 0.682 (1,383). Coin flip = 0.693.
 */
export const MARGIN_SPORTS: Record<string, { name: string; unit: string; unitShort: string; params: Partial<BasketballParams> }> = {
  'american-football': {
    name: 'nfl-elo-netrating',
    unit: 'points',
    unitShort: 'pts',
    params: { k: 40, homeAdvantageElo: 75, eloPointsPerPoint: 15, eloWeight: 0.6, netShrink: 0.5, pointsAlpha: 0.2, leagueAvgAlpha: 0.02, defaultPoints: 22.5, homeCourtPts: 2.2, sigma: 13.5, backToBackPts: 0, restedBonusPts: 0, starAbsencePts: 3, maxAbsencePts: 8, highConfidence: 0.75, mediumConfidence: 0.6, minGames: 3 },
  },
  'ice-hockey': {
    name: 'nhl-elo-netrating',
    unit: 'goals',
    unitShort: 'goals',
    params: { k: 20, homeAdvantageElo: 0, eloPointsPerPoint: 90, eloWeight: 0.85, netShrink: 0.3, pointsAlpha: 0.02, leagueAvgAlpha: 0.02, defaultPoints: 3.05, homeCourtPts: 0.1, sigma: 2.4, backToBackPts: -0.2, restedBonusPts: 0, starAbsencePts: 0.25, maxAbsencePts: 0.6, highConfidence: 0.65, mediumConfidence: 0.56, minGames: 5 },
  },
  baseball: {
    name: 'mlb-elo-netrating',
    unit: 'runs',
    unitShort: 'runs',
    params: { k: 6, homeAdvantageElo: 0, eloPointsPerPoint: 60, eloWeight: 0.45, netShrink: 0.5, pointsAlpha: 0.02, leagueAvgAlpha: 0.01, defaultPoints: 4.5, homeCourtPts: 0.3, sigma: 3.6, backToBackPts: 0, restedBonusPts: 0, starAbsencePts: 0.3, maxAbsencePts: 0.8, highConfidence: 0.62, mediumConfidence: 0.55, minGames: 8 },
  },
};

export function getModel(sport: string, params?: Record<string, unknown>, leagueParams?: Record<string, Record<string, unknown>>): SportModel {
  if (sport === 'football') return new FootballModel(params as Partial<FootballParams>, leagueParams as Record<string, Partial<FootballParams>>);
  if (sport === 'basketball') return new BasketballModel(params as Partial<BasketballParams>, leagueParams as Record<string, Partial<BasketballParams>>);
  const m = MARGIN_SPORTS[sport];
  if (m) {
    return new BasketballModel(params as Partial<BasketballParams>, leagueParams as Record<string, Partial<BasketballParams>>, {
      sport,
      name: m.name,
      unit: m.unit,
      unitShort: m.unitShort,
      defaults: merge(BASKETBALL_DEFAULTS, m.params),
    });
  }
  throw new Error(`no prediction model for sport '${sport}'`);
}
