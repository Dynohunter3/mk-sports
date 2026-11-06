/**
 * football-data.co.uk CSVs -> closing-odds probabilities, matched to ESPN matches.
 * Matching key: date (±1 day, the CSVs use UK dates) + the final score, with team-name
 * similarity as the tie-breaker. Pinnacle closing (PSC*) preferred, then the market average
 * closing (AvgC*), then Bet365 closing. Margin removed proportionally.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Probs } from '../../src/engine';

const DAY = 86_400_000;
export const FD_CODES: Record<string, string> = { 'eng.1': 'E0', 'eng.2': 'E1', 'esp.1': 'SP1', 'ita.1': 'I1', 'ger.1': 'D1', 'fra.1': 'F1', 'ned.1': 'N1', 'por.1': 'P1', 'tur.1': 'T1' };
export type FdRow = { t: number; home: string; away: string; hg: number; ag: number; odds: { src: string; h: number; d: number; a: number } | null };

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const head = lines[0].split(',');
  return lines.slice(1).map((l) => {
    const c = l.split(',');
    return Object.fromEntries(head.map((h, i) => [h, c[i] ?? '']));
  });
}
const num = (s: string | undefined) => {
  const n = Number(s);
  return Number.isFinite(n) && n > 1 ? n : null;
};
function date(s: string): number {
  const [d, m, y] = s.split('/').map(Number);
  return Date.UTC(y < 100 ? 2000 + y : y, m - 1, d);
}
function odds(r: Record<string, string>): FdRow['odds'] {
  for (const [src, k] of [
    ['Pinnacle closing (football-data.co.uk)', 'PSC'],
    ['market average closing (football-data.co.uk)', 'AvgC'],
    ['Bet365 closing (football-data.co.uk)', 'B365C'],
  ] as const) {
    const h = num(r[`${k}H`]);
    const d = num(r[`${k}D`]);
    const a = num(r[`${k}A`]);
    if (h && d && a) return { src, h, d, a };
  }
  return null;
}

export function readFootballData(dir: string): Record<string, FdRow[]> {
  const out: Record<string, FdRow[]> = {};
  for (const [slug, code] of Object.entries(FD_CODES)) {
    out[slug] = [];
    for (const f of readdirSync(dir).filter((x) => x.startsWith(`${code}_`) && x.endsWith('.csv'))) {
      for (const r of parseCsv(readFileSync(join(dir, f), 'utf8'))) {
        if (!r.HomeTeam || r.FTHG === '') continue;
        out[slug].push({ t: date(r.Date), home: r.HomeTeam, away: r.AwayTeam, hg: Number(r.FTHG), ag: Number(r.FTAG), odds: odds(r) });
      }
    }
  }
  out['usa.1'] = parseCsv(readFileSync(join(dir, 'USA.csv'), 'utf8'))
    .filter((r) => r.League === 'MLS' && r.HG !== '')
    .map((r) => ({ t: date(r.Date), home: r.Home, away: r.Away, hg: Number(r.HG), ag: Number(r.AG), odds: odds(r) }));
  return out;
}

const STOP = new Set(['fc', 'cf', 'afc', 'sc', 'ac', 'as', 'cd', 'ud', 'rc', 'rcd', 'sd', 'club', 'calcio', 'fk', 'sk', 'bk', 'sv', 'vfb', 'vfl', 'tsg', 'de', 'la', 'the', 'and', 'ssc', 'us', 'ca', 'ogc', 'stade', 'real', 'sporting', 'cp', 'sl', 'krc', 'bsc']);
export function normName(s: string): string[] {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w) && !/^\d+$/.test(w));
}
export function nameSim(a: string, b: string): number {
  const x = normName(a);
  const y = normName(b);
  if (!x.length || !y.length) return 0;
  let hits = 0;
  for (const w of x) if (y.some((v) => v === w || (w.length >= 4 && v.startsWith(w.slice(0, 4))) || (v.length >= 4 && w.startsWith(v.slice(0, 4))))) hits++;
  return hits / Math.max(x.length, y.length);
}

type EspnRow = { id: string; t: number; hn: string; an: string; hs: number; as: number };
export type FdMatch = { p: Probs; src: string };

export function matchFootballData(espn: EspnRow[], fd: FdRow[]): Map<string, FdMatch> & { conflicts?: number } {
  const byDay = new Map<number, EspnRow[]>();
  for (const e of espn) {
    const d = Math.floor(e.t / DAY);
    byDay.set(d, [...(byDay.get(d) ?? []), e]);
  }
  const out = new Map<string, FdMatch>();
  const used = new Set<string>();
  for (const r of fd) {
    if (!r.odds) continue;
    const day = Math.floor(r.t / DAY);
    const cands = [day - 1, day, day + 1].flatMap((d) => byDay.get(d) ?? []).filter((e) => !used.has(e.id));
    let best: EspnRow | null = null;
    let bestScore = 0;
    for (const e of cands) {
      const sim = nameSim(r.home, e.hn) + nameSim(r.away, e.an);
      const sameScore = e.hs === r.hg && e.as === r.ag;
      const s = sim + (sameScore ? 1 : 0);
      if (s > bestScore) {
        best = e;
        bestScore = s;
      }
    }
    // require the same score plus some name evidence, or very strong names
    if (best && (bestScore >= 1.5 || (bestScore >= 1.2 && best.hs === r.hg && best.as === r.ag))) {
      used.add(best.id);
      const inv = { home: 1 / r.odds.h, draw: 1 / r.odds.d, away: 1 / r.odds.a };
      const s = inv.home + inv.draw + inv.away;
      out.set(best.id, { p: { home: inv.home / s, draw: inv.draw / s, away: inv.away / s }, src: r.odds.src });
    }
  }
  return out;
}
