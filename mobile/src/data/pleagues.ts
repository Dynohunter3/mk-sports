/**
 * Private leagues without a server.
 *
 * A league lives on each member's phone. Members' score cards travel in links: sharing a league link
 * (on WhatsApp, say) sends the league and every score card the sender knows, so each link brings the
 * whole table up to date for whoever opens it, and opening it also joins the league. The newest card for
 * each member wins. Nothing is uploaded anywhere: the link carries the data (in the part after '#',
 * which browsers never send to the web server).
 *
 * Friendly leagues only: a determined person could edit a link, as with any scorecard you text a friend.
 */
import { readKV, writeKV } from './kv';

export const SITE = 'https://dynohunter3.github.io/mk-sports';
const KEY = 'pleagues:v1';
const MAX_MEMBERS = 40;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I

export type Card = {
  /** member id: random, made once per phone */
  id: string;
  name: string;
  avatar: string;
  points: number;
  /** points in the ISO week `wk` */
  week: number;
  wk: string;
  correct: number;
  settled: number;
  streak: number;
  /** when this card was made (epoch seconds) */
  at: number;
  /** points in the ISO week before `wk` (for the matchweek awards; cards from older versions lack them) */
  pw?: number;
  pwk?: string;
};
export type League = { code: string; name: string; created_at: string; members: Record<string, Card> };
type Store = { leagues: Record<string, League> };

let store: Store | null = null;
async function load(): Promise<Store> {
  if (!store) store = (await readKV<Store>(KEY)) ?? { leagues: {} };
  return store;
}
const save = () => writeKV(KEY, store);

/** Restore from a backup: replaces the private leagues on this phone. */
export async function replaceAll(list: League[]) {
  store = { leagues: Object.fromEntries(list.filter((l) => l && validCode(l.code)).map((l) => [l.code, l])) };
  await save();
}

/** Tests only. */
export function resetForTests() {
  store = null;
}

export function newCode(rand: () => number = Math.random): string {
  return Array.from({ length: 6 }, () => CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)]).join('');
}
export const normaliseCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
export const validCode = (c: string) => /^[A-Z0-9]{6}$/.test(c);

// ------------------------------------------------------------------ link payloads (UTF-8, base64url)
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function utf8(s: string): number[] {
  const out: number[] = [];
  const esc = encodeURIComponent(s);
  for (let i = 0; i < esc.length; i++) {
    if (esc[i] === '%') {
      out.push(parseInt(esc.slice(i + 1, i + 3), 16));
      i += 2;
    } else out.push(esc.charCodeAt(i));
  }
  return out;
}

export function toB64url(s: string): string {
  const b = utf8(s);
  let out = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < b.length ? B64[(n >> 6) & 63] : '') + (i + 2 < b.length ? B64[n & 63] : '');
  }
  return out;
}

export function fromB64url(s: string): string {
  const bytes: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of s) {
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error('bad link');
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buf >> bits) & 255);
    }
  }
  return decodeURIComponent(bytes.map((x) => '%' + x.toString(16).padStart(2, '0')).join(''));
}

// two fields were added at the end in 2.3 (previous week's points and its key); older versions ignore them
type Wire = { v: 1; c: string; n: string; m: [string, string, string, number, number, string, number, number, number, number, number?, string?][] };

export function encodeLeague(l: Pick<League, 'code' | 'name'>, cards: Card[]): string {
  const w: Wire = { v: 1, c: l.code, n: l.name, m: cards.slice(0, MAX_MEMBERS).map((x) => [x.id, x.name, x.avatar, x.points, x.week, x.wk, x.correct, x.settled, x.streak, x.at, x.pw ?? 0, x.pwk ?? '']) };
  return toB64url(JSON.stringify(w));
}

export function decodeLeague(d: string): { code: string; name: string; cards: Card[] } {
  const w = JSON.parse(fromB64url(d)) as Wire;
  if (w?.v !== 1 || !validCode(w.c) || !Array.isArray(w.m)) throw new Error('This is not an MK Sports league link');
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(0, Math.round(x)) : 0);
  const cards = w.m
    .filter((r) => Array.isArray(r) && typeof r[0] === 'string' && r[0].length >= 6)
    .slice(0, MAX_MEMBERS)
    .map((r) => ({
      id: r[0].slice(0, 24), name: String(r[1] ?? 'Player').slice(0, 30), avatar: String(r[2] ?? '⚽').slice(0, 4), points: num(r[3]), week: num(r[4]),
      wk: String(r[5] ?? '').slice(0, 10), correct: num(r[6]), settled: num(r[7]), streak: num(r[8]), at: num(r[9]),
      ...(r.length > 10 && r[11] ? { pw: num(r[10]), pwk: String(r[11]).slice(0, 10) } : {}),
    }));
  return { code: w.c, name: String(w.n || w.c).slice(0, 40), cards };
}

export const linkFor = (payload: string) => `${SITE}/l.html#d=${payload}`;

/** Newer cards replace older ones for the same member. */
export function mergeCards(members: Record<string, Card>, cards: Card[]): Record<string, Card> {
  const out = { ...members };
  for (const c of cards) if (!out[c.id] || c.at >= out[c.id].at) out[c.id] = c;
  return out;
}

/** The table: points first, then correct picks, then who updated most recently. */
export function table(members: Card[], weekKey: string, by: 'season' | 'week' = 'season'): (Card & { rank: number; score: number })[] {
  const score = (c: Card) => (by === 'week' ? (c.wk === weekKey ? c.week : 0) : c.points);
  const rows = [...members].sort((a, b) => score(b) - score(a) || b.correct - a.correct || b.at - a.at);
  // a shared position only for a complete tie (same points and same correct picks)
  let rank = 0;
  let prev: string | null = null;
  return rows.map((c, i) => {
    const s = score(c);
    const k = `${s}:${c.correct}`;
    if (k !== prev) rank = i + 1;
    prev = k;
    return { ...c, rank, score: s };
  });
}

// ------------------------------------------------------------------ store
export async function leagues(): Promise<League[]> {
  const s = await load();
  return Object.values(s.leagues).sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function create(name: string, me: Card): Promise<League> {
  const s = await load();
  let code = newCode();
  while (s.leagues[code]) code = newCode();
  const l: League = { code, name: name.trim().slice(0, 40) || 'My league', created_at: new Date().toISOString(), members: { [me.id]: me } };
  s.leagues[code] = l;
  await save();
  return l;
}

/** Join by code (the name arrives with the first link from a member) or by an opened link. */
export async function join(code: string, name: string | null, me: Card, cards: Card[] = []): Promise<League> {
  const s = await load();
  const c = normaliseCode(code);
  if (!validCode(c)) throw new Error('League codes have 6 letters and numbers');
  const cur = s.leagues[c];
  const l: League = cur ?? { code: c, name: name?.trim() || `League ${c}`, created_at: new Date().toISOString(), members: {} };
  if (name && (!cur || cur.name.startsWith('League '))) l.name = name.trim().slice(0, 40);
  l.members = mergeCards(mergeCards(l.members, cards), [me]);
  s.leagues[c] = l;
  await save();
  return l;
}

export async function leave(code: string) {
  const s = await load();
  delete s.leagues[normaliseCode(code)];
  await save();
}

/** Refresh my own card in every league (called before showing or sharing). */
export async function refreshMine(me: Card) {
  const s = await load();
  let changed = false;
  for (const l of Object.values(s.leagues)) {
    const cur = l.members[me.id];
    if (!cur || cur.points !== me.points || cur.week !== me.week || cur.wk !== me.wk || cur.correct !== me.correct || cur.name !== me.name || cur.avatar !== me.avatar || cur.streak !== me.streak || cur.pw !== me.pw || cur.pwk !== me.pwk) {
      l.members[me.id] = me;
      changed = true;
    }
  }
  if (changed) await save();
}

// ------------------------------------------------------------------ matchweek awards
export type Award = { key: 'sharpshooter' | 'climber' | 'streak'; emoji: string; title: string; winners: { id: string; name: string; avatar: string }[]; detail: string };

/** A member's points in ISO week `wk`, if their card says (it carries this week and the one before). */
export function pointsIn(c: Card, wk: string): number | null {
  if (c.wk === wk) return c.week;
  if (c.pwk === wk) return c.pw ?? 0;
  if (c.wk && c.wk < wk) return 0; // no picks settled since that card was made
  return null;
}

/** Total points at the end of ISO week `wk`, if the card says. */
function totalAfter(c: Card, wk: string): number | null {
  if (!c.wk || c.wk <= wk) return c.points; // nothing scored after wk as far as the card knows
  if (c.pwk === wk) return c.points - c.week;
  return null;
}

/**
 * Awards for one matchweek from the members' cards: Sharpshooter of the week (most points that week) and
 * Biggest climber (most places gained in the table during the week). Only members whose cards cover the week
 * are counted. `streakNow` adds the longest current run of correct picks (from the latest cards).
 */
export function weeklyAwards(members: Card[], wk: string, streakNow = false): Award[] {
  const out: Award[] = [];
  const who = (c: Card) => ({ id: c.id, name: c.name, avatar: c.avatar });
  const known = members.map((c) => ({ c, pts: pointsIn(c, wk), end: totalAfter(c, wk) })).filter((x) => x.pts !== null && x.end !== null) as { c: Card; pts: number; end: number }[];
  const top = Math.max(0, ...known.map((x) => x.pts));
  if (top > 0) {
    const w = known.filter((x) => x.pts === top);
    out.push({ key: 'sharpshooter', emoji: '🎯', title: 'Sharpshooter of the week', winners: w.map((x) => who(x.c)), detail: `${top} point${top === 1 ? '' : 's'}` });
  }
  if (known.length >= 3) {
    const rank = (vals: { id: string; v: number }[]) => {
      const sorted = [...vals].sort((a, b) => b.v - a.v);
      const r = new Map<string, number>();
      sorted.forEach((x, i) => r.set(x.id, i > 0 && sorted[i - 1].v === x.v ? r.get(sorted[i - 1].id)! : i + 1));
      return r;
    };
    const before = rank(known.map((x) => ({ id: x.c.id, v: x.end - x.pts })));
    const after = rank(known.map((x) => ({ id: x.c.id, v: x.end })));
    const gains = known.map((x) => ({ x, g: before.get(x.c.id)! - after.get(x.c.id)! }));
    const best = Math.max(0, ...gains.map((y) => y.g));
    if (best > 0) {
      const w = gains.filter((y) => y.g === best);
      out.push({ key: 'climber', emoji: '📈', title: 'Biggest climber', winners: w.map((y) => who(y.x.c)), detail: `up ${best} place${best === 1 ? '' : 's'}` });
    }
  }
  if (streakNow) {
    const s = Math.max(0, ...members.map((c) => c.streak));
    if (s >= 3) out.push({ key: 'streak', emoji: '🔥', title: 'On fire', winners: members.filter((c) => c.streak === s).map(who), detail: `${s} right in a row` });
  }
  return out;
}
