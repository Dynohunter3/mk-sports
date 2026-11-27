/**
 * Step 12 check: the app's engine with the shipped NBA settings (src/data/leagues.ts) reproduces the experiment's
 * chosen blend. Same walk-forward as scripts/audit/us-sports.ts.   node --import tsx scripts/audit/us-sports-check.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getModel, probabilities } from '../../src/engine';
import { LEAGUE_BY_SLUG } from '../../src/data/leagues';

const DAY = 86_400_000;
const d = (y: number, m: number, day = 1) => Date.UTC(y, m - 1, day);
type Row = { id: string; t: number; h: string; a: string; hs: number; as: number; n: 0 | 1; pre: 0 | 1 };
const rows = (JSON.parse(readFileSync(join(__dirname, '../../../audit/data/espn/nba.json'), 'utf8')) as Row[]).filter((r) => !r.pre && r.hs !== r.as).sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
const model = getModel('basketball', {}, { nba: LEAGUE_BY_SLUG.nba.modelParams! });
const parts: Record<string, [number, number]> = { selection: [d(2024, 10), d(2025, 7)], test: [d(2025, 10), d(2026, 7)], fresh: [d(2026, 10), d(2026, 11, 7)] };
const out: Record<string, { n: number; ll: number; hit: number }> = {};
for (const [name, [a, b]] of Object.entries(parts)) {
  const days = [...new Set(rows.filter((r) => r.t >= a && r.t < b).map((r) => Math.floor(r.t / DAY)))].sort((x, y) => x - y);
  let ll = 0;
  let hit = 0;
  let n = 0;
  for (const day of days) {
    const book = model.newBook();
    for (const r of rows) {
      if (r.t >= day * DAY) break;
      if (r.t >= day * DAY - 365 * DAY) book.update({ id: r.id, date: new Date(r.t), home: `basketball:${r.h}`, away: `basketball:${r.a}`, homeScore: r.hs, awayScore: r.as, competition: 'nba', neutral: !!r.n });
    }
    for (const r of rows.filter((x) => Math.floor(x.t / DAY) === day)) {
      const p = probabilities(model.predict(book.buildInput({ home: `basketball:${r.h}`, away: `basketball:${r.a}`, kickoff: new Date(r.t), competition: 'nba', neutral: !!r.n }))).home ?? 0.5;
      const y = r.hs > r.as ? 1 : 0;
      ll -= Math.log(Math.max(1e-12, y ? p : 1 - p));
      hit += (p >= 0.5 ? 1 : 0) === y ? 1 : 0;
      n++;
    }
  }
  out[name] = { n, ll: Math.round((ll / n) * 1e4) / 1e4, hit: Math.round((hit / n) * 1e4) / 1e4 };
}
console.log(JSON.stringify(out));
