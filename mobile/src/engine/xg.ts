/**
 * Expected goals (xG) from shot locations. Logistic regression on distance to goal and the
 * angle the goal mouth subtends, fitted on 22,711 real non-penalty shots from 910 matches
 * (Premier League, LaLiga, Serie A, Bundesliga, Ligue 1, Championship, Champions League)
 * by engine/scripts/fit_xg.py. Held-out matches: 361 goals, 368.0 xG; log loss 0.262 vs
 * 0.278 for the base rate. Penalties use the observed conversion rate (201 of 262).
 *
 * This is the app's own estimate, not an official provider's xG: the data source gives shot
 * positions but not body part or assist type, so headers and open-play chances from the same
 * spot get the same value.
 */

export const XG_MODEL = {
  coef: [-15.472932, -0.277613, 4.916065, 5.803766, -0.13951] as const,
  penalty: 0.766,
  shots: 22711,
  matches: 910,
};

const PITCH_L = 105;
const PITCH_W = 68;
const GOAL_W = 7.32;

/** Distance (m) and goal-mouth angle (rad). Handles both of ESPN's coordinate systems. */
export function shotGeometry(x: number, y: number): { dist: number; angle: number } {
  let dx: number;
  let yf: number;
  if (x <= 1 && y <= 1) {
    dx = (x * PITCH_L) / 2; // older feed: fraction of half the pitch, measured from the goal line
    yf = y;
  } else {
    dx = ((100 - x) / 100) * PITCH_L; // newer feed: 0..100 towards the target goal
    yf = y / 100;
  }
  const dy = (yf - 0.5) * PITCH_W;
  const dist = Math.hypot(dx, dy);
  let angle = Math.atan2(GOAL_W * dx, dx * dx + dy * dy - (GOAL_W / 2) ** 2);
  if (angle < 0) angle += Math.PI;
  return { dist, angle };
}

export function xgFor(x: number, y: number, penalty = false): number {
  if (penalty) return XG_MODEL.penalty;
  const { dist, angle } = shotGeometry(x, y);
  const c = XG_MODEL.coef;
  const z = c[0] + c[1] * dist + c[2] * angle + c[3] * Math.log(dist + 1) + c[4] * dist * angle;
  return 1 / (1 + Math.exp(-z));
}

export type ShotEvent = { side: 'home' | 'away'; x: number | null; y: number | null; penalty: boolean; goal: boolean; minute: string | null; player: string | null; type: string; playerId?: string | null };

/** Team totals; shots without a recorded position are counted but get no xG. */
export function teamXg(shots: ShotEvent[]): { home: number; away: number; located: number; total: number } {
  let home = 0;
  let away = 0;
  let located = 0;
  for (const s of shots) {
    if (s.x === null || s.y === null) {
      if (!s.penalty) continue;
    } else located += 1;
    const v = xgFor(s.x ?? 0, s.y ?? 0, s.penalty);
    if (s.side === 'home') home += v;
    else away += v;
  }
  return { home, away, located, total: shots.length };
}
