/**
 * Live win probability for football, worked out on the phone from data the match page already has:
 *
 * 1. The pre-match expected goals for each team (the prediction's expected goals).
 * 2. Scaled to the minutes left: a match is treated as 95 minutes of playing time, stoppage included,
 *    with goals equally likely in every minute.
 * 3. Adjusted for red cards. After each red card, the team with ten players scores at 0.70 times its rate
 *    and its opponent at 1.25 times. These are rough figures, in line with the effects football research
 *    reports; the exact size varies between studies.
 * 4. Started from the current score: the remaining goals for each side follow a Poisson score grid with
 *    the Dixon-Coles low-score adjustment (the same family as the predictions). Adding them to the score
 *    gives the chance that each side ends up ahead, or level.
 *
 * Not modelled: tactics (a side protecting a lead), injuries, substitutions, or goals coming more often
 * late in matches. It is a transparent estimate, not a betting model.
 */

export const MATCH_MINUTES = 95;
export const RED_OWN = 0.7;
export const RED_OPP = 1.25;
const MAX = 10;

export type Probs3 = { home: number; draw: number; away: number };
export type WPEvent = { minute: number; side: 'home' | 'away'; kind: 'goal' | 'red' };
export type WPPoint = Probs3 & { minute: number };

function poisson(l: number): number[] {
  const lam = Math.max(0, l);
  const out = [Math.exp(-lam)];
  for (let k = 1; k <= MAX; k++) out.push((out[k - 1] * lam) / k);
  return out;
}

/** Distribution of the goals still to come: P[h][a], Dixon-Coles adjusted, normalised. */
export function remainingGrid(lh: number, la: number, rho = -0.08): number[][] {
  const ph = poisson(lh);
  const pa = poisson(la);
  const tau = (h: number, a: number) =>
    h === 0 && a === 0 ? 1 - lh * la * rho : h === 0 && a === 1 ? 1 + lh * rho : h === 1 && a === 0 ? 1 + la * rho : h === 1 && a === 1 ? 1 - rho : 1;
  const g = ph.map((x, h) => pa.map((y, a) => Math.max(0, x * y * tau(h, a))));
  const total = g.flat().reduce((s, v) => s + v, 0) || 1;
  return g.map((row) => row.map((v) => v / total));
}

/** Scoring rates (per match) after red cards: each red multiplies its team by RED_OWN and the opponent by RED_OPP. */
export function redCardRates(lh: number, la: number, redsHome: number, redsAway: number): [number, number] {
  return [lh * RED_OWN ** redsHome * RED_OPP ** redsAway, la * RED_OWN ** redsAway * RED_OPP ** redsHome];
}

/** Win probability at `minute` (match clock) given the score and red cards so far. */
export function winProbability(lh: number, la: number, minute: number, goalsHome: number, goalsAway: number, redsHome = 0, redsAway = 0): Probs3 {
  const left = Math.max(0, MATCH_MINUTES - Math.max(0, minute)) / MATCH_MINUTES;
  const [rh, ra] = redCardRates(lh, la, redsHome, redsAway);
  const g = remainingGrid(rh * left, ra * left);
  let home = 0;
  let draw = 0;
  let away = 0;
  g.forEach((row, h) =>
    row.forEach((p, a) => {
      const d = goalsHome + h - (goalsAway + a);
      if (d > 0) home += p;
      else if (d < 0) away += p;
      else draw += p;
    }),
  );
  return { home, draw, away };
}

/**
 * The probability through the match, minute by minute from kick-off to `upTo`, replaying goals and red cards
 * at their minutes. A finished match ends on the result.
 */
export function winProbabilityPath(lh: number, la: number, events: WPEvent[], upTo: number, finished = false, final?: [number, number]): WPPoint[] {
  const ev = [...events].sort((a, b) => a.minute - b.minute);
  const out: WPPoint[] = [];
  const end = Math.max(0, Math.min(Math.round(upTo), MATCH_MINUTES + 10));
  let gh = 0;
  let ga = 0;
  let rh = 0;
  let ra = 0;
  let i = 0;
  for (let t = 0; t <= end; t++) {
    while (i < ev.length && ev[i].minute <= t) {
      const e = ev[i++];
      if (e.kind === 'goal') e.side === 'home' ? gh++ : ga++;
      else e.side === 'home' ? rh++ : ra++;
    }
    out.push({ minute: t, ...winProbability(lh, la, t, gh, ga, rh, ra) });
  }
  if (finished) {
    const [fh, fa] = final ?? [gh, ga];
    out.push({ minute: Math.max(end, MATCH_MINUTES), home: fh > fa ? 1 : 0, draw: fh === fa ? 1 : 0, away: fh < fa ? 1 : 0 });
  }
  return out;
}

/** "63'", "45'+2'", "90'+4'" -> minute on the match clock (stoppage added on); "HT" -> 45; null if unknown. */
export function clockMinute(clock: string | null | undefined, status?: string): number | null {
  if (status === 'finished') return 90;
  if (!clock) return null;
  if (/^HT$/i.test(clock.trim()) || /half/i.test(clock)) return 45;
  const m = /(\d+)\s*'?\s*(?:\+\s*(\d+))?/.exec(clock);
  if (!m) return null;
  return Number(m[1]) + (m[2] ? Number(m[2]) : 0);
}

/**
 * Turn the match's event list into goals and red cards. ESPN credits an own goal to one side or the other
 * depending on the feed, so the goals are checked against the score and own goals flipped if that is what
 * makes them add up.
 */
export function eventsFromDetail(
  events: { type: string; minute: number | null; side: 'home' | 'away' }[],
  score: [number | null, number | null],
): WPEvent[] {
  const goals = events.filter((e) => e.minute !== null && (e.type === 'goal' || e.type === 'penalty_goal' || e.type === 'own_goal'));
  const reds = events.filter((e) => e.minute !== null && e.type === 'red_card');
  const count = (flip: boolean) => {
    let h = 0;
    let a = 0;
    for (const g of goals) {
      const side = flip && g.type === 'own_goal' ? (g.side === 'home' ? 'away' : 'home') : g.side;
      side === 'home' ? h++ : a++;
    }
    return [h, a];
  };
  const [sh, sa] = score;
  const asIs = count(false);
  const flipped = count(true);
  const flip = sh !== null && sa !== null && !(asIs[0] === sh && asIs[1] === sa) && flipped[0] === sh && flipped[1] === sa;
  return [
    ...goals.map((g) => ({ minute: g.minute!, side: (flip && g.type === 'own_goal' ? (g.side === 'home' ? 'away' : 'home') : g.side) as 'home' | 'away', kind: 'goal' as const })),
    ...reds.map((r) => ({ minute: r.minute!, side: r.side, kind: 'red' as const })),
  ];
}
