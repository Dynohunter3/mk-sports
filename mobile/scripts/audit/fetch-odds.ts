/**
 * Audit step 1b: bookmaker opening/closing moneylines for finished matches from ESPN's core API
 * (DraftKings / ESPN BET / Bet365, as ESPN lists them; in-play "Live Odds" feeds excluded).
 * Only for the evaluation windows and only for competitions football-data.co.uk doesn't cover.
 * Resumable: audit/data/odds/<league>.json maps eventId -> odds (or null when none).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { LEAGUE_BY_SLUG } from '../../src/data/leagues';
import { EVAL_WINDOWS } from './windows';

const DATA = join(__dirname, '../../../audit/data');
const CORE = 'https://sports.core.api.espn.com/v2/sports';
const FD_COVERED = new Set(['eng.1', 'eng.2', 'esp.1', 'ita.1', 'ger.1', 'fra.1', 'ned.1', 'por.1', 'tur.1', 'usa.1']);

const am2dec = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace('+', ''));
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? 1 + n / 100 : 1 + 100 / -n;
};
const pick = (s: any, when: 'close' | 'open') => am2dec(s?.[when]?.moneyLine?.american ?? s?.[when]?.moneyLine?.alternateDisplayValue) ?? (when === 'close' ? am2dec(s?.moneyLine) : null);

export type Odds = { provider: string; close: { h: number | null; d: number | null; a: number | null }; open: { h: number | null; d: number | null; a: number | null } };

async function getJson(url: string, tries = 4): Promise<any> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      if (r.status === 404) return null;
      if (r.ok) return await r.json();
      if (r.status === 429) await new Promise((res) => setTimeout(res, 5000 * (i + 1)));
    } catch {
      /* retry */
    }
    await new Promise((res) => setTimeout(res, 800 * 2 ** i));
  }
  throw new Error(`failed ${url}`);
}

function extract(data: any): Odds | null {
  const items: any[] = (data?.items ?? []).filter((i: any) => !/live/i.test(i?.provider?.name ?? ''));
  for (const i of items) {
    const close = { h: pick(i.homeTeamOdds, 'close'), d: am2dec(i?.drawOdds?.close?.moneyLine?.american ?? i?.drawOdds?.moneyLine), a: pick(i.awayTeamOdds, 'close') };
    const open = { h: pick(i.homeTeamOdds, 'open'), d: am2dec(i?.drawOdds?.open?.moneyLine?.american), a: pick(i.awayTeamOdds, 'open') };
    if (close.h && close.a) return { provider: i.provider?.name ?? '?', close, open };
  }
  return null;
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); }));
}

(async () => {
  const which = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(EVAL_WINDOWS).filter((s) => !FD_COVERED.has(s));
  for (const slug of which) {
    const lg = LEAGUE_BY_SLUG[slug];
    const [from, to] = EVAL_WINDOWS[slug];
    const rows: { id: string; t: number }[] = JSON.parse(readFileSync(join(DATA, 'espn', `${slug}.json`), 'utf8'));
    const file = join(DATA, 'odds', `${slug}.json`);
    const have: Record<string, Odds | null> = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
    const todo = rows.filter((r) => r.t >= from && r.t < to && !(r.id in have));
    let done = 0;
    await pool(todo, 6, async (r) => {
      try {
        const d = await getJson(`${CORE}/${lg.espnSport}/leagues/${slug}/events/${r.id}/competitions/${r.id}/odds`);
        have[r.id] = d ? extract(d) : null;
      } catch {
        /* leave missing; a rerun retries */
      }
      if (++done % 250 === 0) {
        writeFileSync(file, JSON.stringify(have));
        console.log(`${slug}: ${done}/${todo.length}`);
      }
    });
    writeFileSync(file, JSON.stringify(have));
    const vals = Object.values(have);
    console.log(`${slug}: ${vals.filter(Boolean).length} with closing odds of ${vals.length} in window`);
  }
  process.exit(0);
})();
