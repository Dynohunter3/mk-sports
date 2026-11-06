/**
 * Audit step 1a: download every finished match for each competition the app covers, for the
 * warm-up season plus the last two full seasons, from ESPN (the app's only results source).
 * Output: audit/data/espn/<league>.json (compact rows). Re-runnable; nothing is estimated.
 *
 *   NODE_USE_ENV_PROXY=1 node --import tsx scripts/audit/fetch-results.ts [league ...]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { scoreboard, scoreboardYear, SEvent } from '../../src/data/espn';
import { LEAGUE_BY_SLUG, MATCH_LEAGUES } from '../../src/data/leagues';

export const OUT = join(__dirname, '../../../audit/data/espn');
// warm-up from mid-2023; evaluation seasons end before the current 2026-27 season (Nov 2026)
const FROM = Date.UTC(2023, 6, 1);
const TO = Date.UTC(2026, 10, 6);

export type Row = { id: string; t: number; h: string; a: string; hn: string; an: string; hs: number; as: number; n: 0 | 1; pre: 0 | 1 };

async function fetchLeague(slug: string): Promise<Row[]> {
  const lg = LEAGUE_BY_SLUG[slug];
  const evs: SEvent[] = [];
  for (let y = 2023; y <= 2026; y++) {
    if (lg.yearly) evs.push(...(await scoreboardYear(slug, y, 86400)).events);
    else {
      for (let m = 0; m < 12; m++) {
        const a = Date.UTC(y, m, 1);
        if (a < FROM - 31 * 864e5 || a > TO) continue;
        evs.push(...(await scoreboard(slug, new Date(a), new Date(Date.UTC(y, m + 1, 1) - 1), 86400)).events);
      }
    }
  }
  const seen = new Set<string>();
  return evs
    .filter((e) => e.status === 'finished' && e.homeScore !== null && e.awayScore !== null && !seen.has(e.id) && seen.add(e.id))
    .filter((e) => Date.parse(e.start) >= FROM && Date.parse(e.start) <= TO)
    .map((e) => ({ id: e.espnId, t: Date.parse(e.start), h: e.home.espnId, a: e.away.espnId, hn: e.home.name, an: e.away.name, hs: e.homeScore!, as: e.awayScore!, n: e.neutral ? 1 : 0, pre: e.preseason ? 1 : 0 }) as Row)
    .sort((x, y) => x.t - y.t);
}

(async () => {
  mkdirSync(OUT, { recursive: true });
  const which = process.argv.slice(2).length ? process.argv.slice(2) : MATCH_LEAGUES.map((l) => l.slug);
  for (const slug of which) {
    try {
      const rows = await fetchLeague(slug);
      writeFileSync(join(OUT, `${slug}.json`), JSON.stringify(rows));
      console.log(`${slug}: ${rows.length} finished matches ${rows.length ? new Date(rows[0].t).toISOString().slice(0, 10) + ' -> ' + new Date(rows[rows.length - 1].t).toISOString().slice(0, 10) : ''}`);
    } catch (e) {
      console.log(`${slug}: FAILED ${(e as Error).message}`);
    }
  }
  process.exit(0);
})();
