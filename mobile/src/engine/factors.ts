// Port of predictpro_engine/factors.py
import { Absence, absenceWeight, FinishedMatch, Favours, fmt0, GameRecord, KeyFactor, TeamState } from './core';

export const MIN_FACTORS = 3;
export const MAX_FACTORS = 5;
const MAX_PER_CATEGORY = 2;

/** English possessive: Arsenal's, Pistons'. */
export const poss = (name: string) => (name.endsWith('s') ? `${name}'` : `${name}'s`);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const other = (s: Favours): Favours => (s === 'home' ? 'away' : 'home');

export function runLength(recs: GameRecord[], pred: (r: GameRecord) => boolean): number {
  let n = 0;
  for (const r of recs) {
    if (!pred(r)) break;
    n += 1;
  }
  return n;
}

export function formString(recs: GameRecord[], n = 5): string {
  return recs
    .slice(0, n)
    .map((r) => r.result)
    .join('');
}

export function formFactors(team: TeamState, side: Favours, hasDraws: boolean): KeyFactor[] {
  const rec = team.recent;
  const out: KeyFactor[] = [];
  if (!rec.length) return out;
  const st = team.streaks;
  const wins = st.win ?? runLength(rec, (r) => r.result === 'W');
  const losses = st.loss ?? runLength(rec, (r) => r.result === 'L');
  if (wins >= 3) out.push({ text: `${team.name} have won ${wins} in a row`, impact: Math.min(1, 0.25 + 0.08 * wins), favours: side, category: 'form' });
  else if (hasDraws) {
    const unbeaten = st.unbeaten ?? runLength(rec, (r) => r.result !== 'L');
    if (unbeaten >= 4) out.push({ text: `${team.name} unbeaten in ${unbeaten}`, impact: Math.min(1, 0.2 + 0.06 * unbeaten), favours: side, category: 'form' });
  }
  if (losses >= 3) out.push({ text: `${team.name} have lost ${losses} in a row`, impact: Math.min(1, 0.25 + 0.08 * losses), favours: other(side), category: 'form' });
  else if (hasDraws) {
    const winless = st.winless ?? runLength(rec, (r) => r.result !== 'W');
    if (winless >= 5) out.push({ text: `${team.name} without a win in ${winless}`, impact: Math.min(1, 0.2 + 0.05 * winless), favours: other(side), category: 'form' });
  }
  const last = hasDraws ? rec.slice(0, 5) : rec.slice(0, 10);
  if (last.length >= 5 && !out.length) {
    const w = last.filter((r) => r.result === 'W').length;
    if (hasDraws) {
      const pts = last.reduce((s, r) => s + (r.result === 'W' ? 3 : r.result === 'D' ? 1 : 0), 0);
      if (pts >= 11) out.push({ text: `${team.name} took ${pts} of ${3 * last.length} points from their last ${last.length}`, impact: 0.35, favours: side, category: 'form' });
      else if (pts <= 4) out.push({ text: `${team.name} took just ${pts} of ${3 * last.length} points from their last ${last.length}`, impact: 0.35, favours: other(side), category: 'form' });
    } else if (w >= 0.7 * last.length) out.push({ text: `${team.name} have won ${w} of their last ${last.length}`, impact: 0.35, favours: side, category: 'form' });
    else if (w <= 0.3 * last.length) out.push({ text: `${team.name} have won only ${w} of their last ${last.length}`, impact: 0.35, favours: other(side), category: 'form' });
  }
  return out;
}

export function venueFactor(team: TeamState, side: Favours, atHome: boolean, hasDraws: boolean): KeyFactor | null {
  const games = team.recent.filter((r) => r.isHome === atHome).slice(0, 8);
  if (games.length < 4) return null;
  const w = games.filter((r) => r.result === 'W').length;
  const lost = games.filter((r) => r.result === 'L').length;
  const where = atHome ? 'at home' : 'away';
  if (w / games.length >= 0.7)
    return { text: `${team.name} have won ${w} of their last ${games.length} ${where}`, impact: 0.3 + (0.2 * (w / games.length - 0.7)) / 0.3, favours: side, category: 'venue' };
  if (lost / games.length >= 0.6) return { text: `${team.name} have lost ${lost} of their last ${games.length} ${where}`, impact: 0.3, favours: other(side), category: 'venue' };
  if (hasDraws && atHome && lost === 0 && games.length >= 5) return { text: `${team.name} unbeaten in their last ${games.length} at home`, impact: 0.3, favours: side, category: 'venue' };
  return null;
}

export function h2hFactor(h2h: FinishedMatch[], home: TeamState, away: TeamState): KeyFactor | null {
  if (h2h.length < 3) return null;
  const won = (t: string) => h2h.filter((m) => (m.home === t && m.homeScore > m.awayScore) || (m.away === t && m.awayScore > m.homeScore)).length;
  const hw = won(home.team);
  const aw = won(away.team);
  const n = h2h.length;
  if (hw >= 0.6 * n) return { text: `${home.name} won ${hw} of the last ${n} meetings`, impact: 0.25 + (0.15 * hw) / n, favours: 'home', category: 'h2h' };
  if (aw >= 0.6 * n) return { text: `${away.name} won ${aw} of the last ${n} meetings`, impact: 0.25 + (0.15 * aw) / n, favours: 'away', category: 'h2h' };
  return null;
}

export function absenceFactors(team: TeamState, side: Favours, absences: Absence[]): KeyFactor[] {
  const list = absences.filter((a) => a.importance >= 0.3).sort((a, b) => absenceWeight(b) - absenceWeight(a));
  if (!list.length) return [];
  const top = list[0];
  const reason = ({ injured: 'is injured', suspended: 'is suspended', doubtful: 'is a doubt' } as Record<string, string>)[top.reason] ?? 'is unavailable';
  let text: string;
  if (top.tag === 'top_scorer') text = `${poss(team.name)} top scorer ${top.player} ${reason}`;
  else if (top.tag === 'star' || top.tag === 'captain') text = `${team.name} ${top.tag === 'captain' ? 'captain' : 'star player'} ${top.player} ${reason}`;
  else text = `${poss(team.name)} ${top.player} ${reason}`;
  const out: KeyFactor[] = [{ text, impact: Math.min(1, 0.3 + 0.6 * absenceWeight(top)), favours: other(side), category: 'absences' }];
  const serious = list.filter((a) => a.reason !== 'doubtful');
  if (serious.length >= 3)
    out.push({ text: `${team.name} missing ${plural(serious.length, 'key player')}`, impact: Math.min(1, 0.25 + 0.1 * serious.length), favours: other(side), category: 'absences' });
  return out;
}

export function ratingFactor(home: TeamState, away: TeamState): KeyFactor {
  const gap = home.elo - away.elo;
  if (Math.abs(gap) < 40) return { text: `Evenly matched on ratings (Elo ${fmt0(home.elo)} vs ${fmt0(away.elo)})`, impact: 0.2, favours: 'neutral', category: 'rating' };
  const [fav, dog] = gap > 0 ? [home, away] : [away, home];
  const strength = Math.abs(gap) >= 150 ? 'much stronger' : 'stronger';
  return { text: `${fav.name} rated ${strength} (Elo ${fmt0(fav.elo)} vs ${fmt0(dog.elo)})`, impact: Math.min(1, 0.25 + Math.abs(gap) / 400), favours: gap > 0 ? 'home' : 'away', category: 'rating' };
}

export function homeAdvantageFactor(home: TeamState, neutral: boolean, detail: string): KeyFactor {
  if (neutral) return { text: 'Neutral venue: no home advantage applied', impact: 0.15, favours: 'neutral', category: 'venue' };
  return { text: `Home advantage for ${home.name} (${detail})`, impact: 0.15, favours: 'home', category: 'venue' };
}

export function dataFactor(home: TeamState, away: TeamState, minGames = 5): KeyFactor | null {
  const few = [home, away].filter((t) => t.games < minGames);
  if (!few.length) return null;
  const t = few.reduce((a, b) => (b.games < a.games ? b : a));
  return { text: `Limited data: ${t.name} have only ${plural(t.games, 'recorded match')}`, impact: 0.3, favours: 'neutral', category: 'data' };
}

export function selectFactors(candidates: (KeyFactor | null)[], fillers: (KeyFactor | null)[] = []): KeyFactor[] {
  const pool = candidates.filter((c): c is KeyFactor => !!c).sort((a, b) => b.impact - a.impact);
  const chosen: KeyFactor[] = [];
  const perCat: Record<string, number> = {};
  for (const f of pool) {
    if (chosen.length >= MAX_FACTORS) break;
    if ((perCat[f.category] ?? 0) >= MAX_PER_CATEGORY || chosen.some((c) => c.text === f.text)) continue;
    chosen.push(f);
    perCat[f.category] = (perCat[f.category] ?? 0) + 1;
  }
  for (const f of fillers) {
    if (chosen.length >= MIN_FACTORS) break;
    if (f && chosen.every((c) => c.text !== f.text)) chosen.push(f);
  }
  return chosen;
}
