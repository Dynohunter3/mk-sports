/** Runs the on-device data layer against the live public sources and prints what it gets. */
import { ensureSport, sportMatches } from '../src/data/history';
import { memoryKV, setKV } from '../src/data/kv';
import { handleLocal } from '../src/data/localApi';

setKV(memoryKV());
const t0 = Date.now();
const ms = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

(async () => {
  for (const sp of ['football', 'basketball'] as const) {
    await ensureSport(sp);
    const m = sportMatches(sp);
    console.log(`[${ms()}] ${sp}: ${m.length} real finished matches loaded, ${m[0]?.date.toISOString().slice(0, 10)} -> ${m[m.length - 1]?.date.toISOString().slice(0, 10)}`);
  }
  const feed: any = await handleLocal('GET', '/feed', null);
  console.log(`[${ms()}] feed sections:`, feed.sections.map((s: any) => `${s.key}(${s.items.length})`).join(' '), '| unavailable:', feed.unavailable);
  const cards = feed.sections.flatMap((s: any) => s.items);
  for (const c of cards.slice(0, 6)) console.log('   ', c.league.short_name, '|', c.home.name, c.home_score ?? '', '-', c.away_score ?? '', c.away.name, '|', c.status, c.clock ?? new Date(c.start_time).toISOString().slice(0, 16), '| pred', c.prediction ? `${c.prediction.pick} ${Math.round(Math.max(c.prediction.home, c.prediction.away, c.prediction.draw ?? 0) * 100)}% ${c.prediction.score.join('-')} ${c.prediction.confidence}` : '-');
  const up = await handleLocal('GET', '/matches?sport=football&status=scheduled&limit=3', null) as any;
  const nbaUp = await handleLocal('GET', '/matches?sport=basketball&status=scheduled&limit=3', null) as any;
  for (const c of [up.items[0], nbaUp.items[0]].filter(Boolean)) {
    const d: any = await handleLocal('GET', `/matches/${c.id}`, null);
    const p = d.prediction_full;
    console.log(`[${ms()}] DETAIL ${d.league.short_name}: ${d.home.name} v ${d.away.name} @ ${d.venue} (${d.start_time})`);
    console.log('   summary:', p?.explanation.summary);
    console.log('   sources:', p?.sources.map((s: any) => `${s.label} ${Math.round(s.weight * 100)}% [${['home', 'draw', 'away'].filter((k) => s.probs[k] !== undefined).map((k) => Math.round(s.probs[k] * 100)).join('/')}]`).join(' | '));
    console.log('   factors:', p?.key_factors.map((f: any) => f.text).join(' · '));
    console.log('   form:', d.form.home.map((g: any) => g.result).join(''), 'vs', d.form.away.map((g: any) => g.result).join(''), '| h2h:', d.head_to_head.length, '| table rows:', d.standings.length, '| team news available:', d.injuries_available, d.injuries_available ? `(${d.injuries.home.length}+${d.injuries.away.length} listed)` : '');
  }
  const t: any = await handleLocal('GET', '/leagues/eng.1/standings', null);
  console.log(`[${ms()}] PL table top 4:`, t.slice(0, 4).map((r: any) => `${r.position}.${r.team.short_name} ${r.points}pts (${r.played}gp) ${r.form}`).join(' | '));
  const nbaT: any = await handleLocal('GET', '/leagues/nba/standings', null);
  console.log('   NBA groups:', [...new Set(nbaT.map((r: any) => r.group))], 'rows', nbaT.length, 'first', nbaT[0]?.team.short_name, `${nbaT[0]?.won}-${nbaT[0]?.lost}`);
  const teams: any = await handleLocal('GET', '/teams?search=arsenal', null);
  console.log('   team search arsenal:', teams.map((x: any) => `${x.name} elo=${x.elo} form=${x.form}`));
  const acc: any = await handleLocal('GET', '/accuracy?source=backtest', null);
  console.log(`[${ms()}] BACKTEST on real results:`, acc.sports.map((s: any) => `${s.name}: n=${s.n} hit=${(s.hit_rate * 100).toFixed(1)}% brier=${s.brier.toFixed(3)} logloss=${s.log_loss.toFixed(3)} conf=${JSON.stringify(Object.fromEntries(Object.entries(s.by_confidence).map(([k, v]: any) => [k, `${(v.hit_rate * 100).toFixed(0)}%/${v.n}`])))}`).join('\n    '));
  for (const l of acc.leagues) console.log(`    ${l.name}: n=${l.n} hit=${(l.hit_rate * 100).toFixed(1)}% logloss=${l.log_loss.toFixed(3)}`);
  process.exit(0);
})().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
