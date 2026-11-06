/**
 * Step 3 "before": the CURRENT production engine (unchanged), fed only permitted data
 * (football-data.co.uk + openfootball via the mkdata pipeline). Production-faithful: for each match day
 * the book is rebuilt from the previous 365 days of finished matches, as the app does on device.
 *
 *   node --import tsx scripts/audit/engine-on-permitted.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { getModel, probabilities } from '../../src/engine';
import { MATCH_LEAGUES } from '../../src/data/leagues';

type Row = { id: string; t: number; h: string; a: string; hs: number; as: number; n: 0 | 1; league: string };
const DAY = 86_400_000;
const ROOT = join(__dirname, '../../..');
const EU: [number, number] = [Date.UTC(2024, 6, 1), Date.UTC(2026, 6, 1)];
const WINDOWS: Record<string, [number, number]> = { 'usa.1': [Date.UTC(2024, 1, 1), Date.UTC(2026, 0, 1)] };
const win = (l: string) => WINDOWS[l] ?? EU;

const pool = (JSON.parse(readFileSync(join(ROOT, 'audit/data/permitted/football_app_leagues.json'), 'utf8')) as Row[]).sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
const lp: Record<string, Record<string, number>> = {};
for (const l of MATCH_LEAGUES) if (l.sport === 'football' && l.modelParams) lp[l.slug] = l.modelParams;
const model = getModel('football', {}, lp);
const days = new Map<number, Row[]>();
for (const r of pool) days.set(Math.floor(r.t / DAY), [...(days.get(Math.floor(r.t / DAY)) ?? []), r]);
const out: { id: string; p: [number, number, number]; minGames: number }[] = [];
let i0 = 0;
for (const day of [...days.keys()].sort((a, b) => a - b)) {
  const todays = days.get(day)!.filter((m) => m.t >= win(m.league)[0] && m.t < win(m.league)[1]);
  if (!todays.length) continue;
  const start = day * DAY;
  while (i0 < pool.length && pool[i0].t < start - 365 * DAY) i0++;
  const book = model.newBook();
  for (let i = i0; i < pool.length && pool[i].t < start; i++) {
    const x = pool[i];
    book.update({ id: x.id, date: new Date(x.t), home: x.h, away: x.a, homeScore: x.hs, awayScore: x.as, competition: x.league, neutral: !!x.n });
  }
  for (const m of todays) {
    const inp = book.buildInput({ home: m.h, away: m.a, kickoff: new Date(m.t), competition: m.league, neutral: !!m.n });
    const p = probabilities(model.predict(inp)) as { home: number; draw: number; away: number };
    out.push({ id: m.id, p: [p.home, p.draw ?? 0, p.away], minGames: Math.min(inp.home.games, inp.away.games) });
  }
}
writeFileSync(join(ROOT, 'audit/results/engine_v2_permitted.preds.json'), JSON.stringify(out));
console.log(`${out.length} predictions`);
