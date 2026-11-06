/** Team-name normalisation and similarity, shared by the app and the audit scripts. */

const STOP = new Set(['fc', 'cf', 'afc', 'sc', 'ac', 'as', 'cd', 'ud', 'rc', 'rcd', 'sd', 'club', 'calcio', 'fk', 'sk', 'bk', 'sv', 'vfb', 'vfl', 'tsg', 'de', 'la', 'the', 'and', 'ssc', 'us', 'ca', 'ogc', 'stade', 'real', 'sporting', 'cp', 'sl', 'krc', 'bsc']);
// short forms used by data sources -> the word that appears in full names (mirrors pipeline/mkdata/names.py)
const EXPAND: Record<string, string> = {
  man: 'manchester', utd: 'united', nottm: 'nottingham', wolves: 'wolverhampton', spurs: 'tottenham', qpr: 'queens',
  sp: 'sporting', st: 'saint', int: 'internazionale', inter: 'internazionale', ein: 'eintracht', mgladbach: 'monchengladbach',
  gladbach: 'monchengladbach', psg: 'paris', sheff: 'sheffield', wed: 'wednesday', munich: 'munchen',
};

export function normName(s: string): string[] {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/'/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .map((w) => EXPAND[w] ?? w)
    .filter((w) => w && !STOP.has(w) && !/^\d+$/.test(w));
}

/** Token overlap in [0, 1]; a 4-letter prefix counts as a match. */
export function nameSim(a: string, b: string): number {
  const x = normName(a);
  const y = normName(b);
  if (!x.length || !y.length) return 0;
  if (x.join('') === y.join('')) return 1;
  let hits = 0;
  for (const w of x) if (y.some((v) => v === w || (w.length >= 4 && v.startsWith(w.slice(0, 4))) || (v.length >= 4 && w.startsWith(v.slice(0, 4))))) hits++;
  return hits / Math.max(x.length, y.length);
}

/** Best similarity of any of `names` against any of `aliases`. */
export function bestSim(names: string[], aliases: string[]): number {
  let best = 0;
  for (const n of names) for (const a of aliases) best = Math.max(best, nameSim(n, a));
  return best;
}
