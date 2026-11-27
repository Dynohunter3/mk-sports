/**
 * Player photos from Wikimedia Commons, published by the data pipeline (pipeline/mkdata/photos.py) to
 * GitHub Pages:
 * - face crops: photos/i/<wikidata id>.jpg
 * - indexes: by birth month (photos/d/<yyyy-mm>.json) and by ESPN ID (photos/espn.json)
 * - credits: each photo's author and licence
 *
 * A player is matched by ESPN ID where Wikidata has one, otherwise by date of birth and name. The date of
 * birth comes from the team's ESPN squad, which the app already loads. A player with no match keeps the
 * ESPN photo, then the shirt number. Only football players are looked up.
 */
import { useEffect, useState } from 'react';

import { get } from './http';
import { LEAGUE_BY_SLUG } from './leagues';
import { squad } from './more';
import { SITE } from './pleagues';

export const PHOTO_BASE = `${SITE}/photos`;
export const PHOTO_CREDITS_URL = `${SITE}/photo-credits.html`;

/** [wikidata id, name, espn id, version, author, licence, year taken] */
export type PhotoRow = [string, string, string, string, string, string, number | null];
type Meta = { v: 1; updated: string; players: number; months: string[] };
export type Photo = { qid: string; uri: string; artist: string; licence: string; year: number | null };
/** id: ESPN athlete id; team: ESPN team id (or the app's "sport:espnId"); league: app league slug. */
export type Who = { id?: string | null; name: string; dob?: string | null; team?: string | null; league?: string | null };

// ------------------------------------------------------------------ names (mirror of pipeline/mkdata/photos.py)
export function personTokens(s: string): string[] {
  return (s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .split(' ')
    .filter(Boolean);
}

/** 1 for the same name; for a partial match the surnames must agree; otherwise 0. */
export function personSim(a: string, b: string): number {
  const x = personTokens(a);
  const y = personTokens(b);
  if (!x.length || !y.length) return 0;
  if (x.join('') === y.join('')) return 1;
  const sx = new Set(x);
  const sy = new Set(y);
  let shared = 0;
  for (const w of sx) if (sy.has(w)) shared++;
  const s = shared / Math.min(sx.size, sy.size);
  if (s >= 0.999) return 1;
  return x[x.length - 1] === y[y.length - 1] ? s : 0;
}

/** The single best match scoring at least 0.5, or null if two different players tie or nothing is close. */
export function pickPlayer(name: string, rows: PhotoRow[]): PhotoRow | null {
  const scored = rows.map((r) => ({ r, s: personSim(name, r[1]) })).sort((a, b) => b.s - a.s);
  if (!scored.length || scored[0].s < 0.5) return null;
  if (scored.length > 1 && scored[1].s === scored[0].s && scored[1].r[0] !== scored[0].r[0]) return null;
  return scored[0].r;
}

// ------------------------------------------------------------------ published files
const TTL = 12 * 3600;
const RETRY_MS = 5 * 60 * 1000;
let downUntil = 0; // after a failure, don't ask again for a few minutes (a line-up asks for 20+ players at once)

async function fetchJson<T>(path: string): Promise<T | null> {
  if (Date.now() < downUntil) return null;
  try {
    return await get<T>(`${PHOTO_BASE}/${path}`, { ttl: TTL, retries: 1, timeoutMs: 10000 });
  } catch {
    if (path === 'meta.json') downUntil = Date.now() + RETRY_MS;
    return null;
  }
}

async function meta(): Promise<Meta | null> {
  const m = await fetchJson<Meta>('meta.json');
  return m && m.v === 1 && Array.isArray(m.months) ? m : null;
}

const url = (qid: string, ver: string) => `${PHOTO_BASE}/i/${qid}.jpg?v=${ver}`;
const toPhoto = (r: PhotoRow): Photo => ({ qid: r[0], uri: url(r[0], r[3]), artist: r[4], licence: r[5], year: r[6] });

const espnId = (team: string) => team.split(':').pop() ?? team;
const dobs = new Map<string, Promise<Map<string, string>>>();
function squadDobs(league: string, team: string): Promise<Map<string, string>> {
  const key = `${league}|${espnId(team)}`;
  let p = dobs.get(key);
  if (!p) {
    p = squad(league, espnId(team))
      .then((list) => new Map(list.filter((x) => x.id && x.dob).map((x) => [x.id, x.dob!.slice(0, 10)] as [string, string])))
      .catch(() => new Map<string, string>());
    dobs.set(key, p);
  }
  return p;
}

export async function findPhoto(w: Who): Promise<Photo | null> {
  if (!w.name) return null;
  if (w.league && LEAGUE_BY_SLUG[w.league] && LEAGUE_BY_SLUG[w.league].sport !== 'football') return null;
  const m = await meta();
  if (!m) return null;
  let dob = w.dob?.slice(0, 10) ?? null;
  if (!dob && w.id && w.team && w.league) dob = (await squadDobs(w.league, w.team)).get(w.id) ?? null;
  if (dob && /^\d{4}-\d{2}-\d{2}$/.test(dob) && m.months.includes(dob.slice(0, 7))) {
    const shard = await fetchJson<{ v: 1; p: Record<string, PhotoRow[]> }>(`d/${dob.slice(0, 7)}.json`);
    const rows = shard?.p?.[dob] ?? [];
    const row = (w.id ? rows.find((r) => r[2] === w.id) : undefined) ?? pickPlayer(w.name, rows);
    if (row) return toPhoto(row);
  }
  if (w.id) {
    const map = await fetchJson<{ v: 1; p: Record<string, [string, string, string, string, number | null]> }>('espn.json');
    const e = map?.p?.[w.id];
    if (e) return { qid: e[0], uri: url(e[0], e[1]), artist: e[2], licence: e[3], year: e[4] };
  }
  return null;
}

// ------------------------------------------------------------------ React
const found = new Map<string, Photo | null>();
const keyOf = (w: Who) => `${w.league ?? ''}|${w.team ?? ''}|${w.id ?? ''}|${w.dob ?? ''}|${w.name}`;

/** undefined while looking, null if there is no photo. */
export function usePlayerPhoto(w?: Who | null): Photo | null | undefined {
  const key = w ? keyOf(w) : '';
  const [photo, setPhoto] = useState<Photo | null | undefined>(() => (w ? found.get(key) : null));
  useEffect(() => {
    if (!w) {
      setPhoto(null);
      return;
    }
    if (found.has(key)) {
      setPhoto(found.get(key));
      return;
    }
    let alive = true;
    setPhoto(undefined);
    findPhoto(w)
      .catch(() => null)
      .then((p) => {
        found.set(key, p);
        if (alive) setPhoto(p);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return photo;
}

export function creditLine(p: Photo): string {
  return `Photo: ${p.artist || 'Unknown author'}${p.year ? `, ${p.year}` : ''} · ${p.licence} · Wikimedia Commons`;
}

/** For tests. */
export function resetPhotos() {
  found.clear();
  dobs.clear();
  downUntil = 0;
}

// ------------------------------------------------------------------ facts from Wikidata (pipeline/mkdata/wikifacts.py)
/** [club, first year, last year (null = still there, "?" = unknown), 1 = on loan] */
export type CareerSpell = [string, number, number | null | '?', 0 | 1];
export type PlayerFacts = { v: 1; src: string; h: number | null; born: string | null; clubs: CareerSpell[]; nt: [string, number] | null };
const factsCache = new Map<string, PlayerFacts | null>();

/** Height, place of birth and career from Wikidata, for players the photo index has identified. */
export function usePlayerFacts(w?: Who | null): PlayerFacts | null | undefined {
  const photo = usePlayerPhoto(w);
  const qid = photo?.qid ?? null;
  const [facts, setFacts] = useState<PlayerFacts | null | undefined>(() => (qid ? factsCache.get(qid) : undefined));
  useEffect(() => {
    if (photo === undefined) return setFacts(undefined);
    if (!qid) return setFacts(null);
    if (factsCache.has(qid)) return setFacts(factsCache.get(qid) ?? null);
    let alive = true;
    get<PlayerFacts>(`${PHOTO_BASE}/f/${qid}.json`, { ttl: 24 * 3600, timeoutMs: 12000, retries: 1 })
      .then((f) => (f && f.v === 1 ? f : null))
      .catch(() => null)
      .then((f) => {
        factsCache.set(qid, f);
        if (alive) setFacts(f);
      });
    return () => {
      alive = false;
    };
  }, [qid, photo]);
  return facts;
}

/** "2023–", "2019–21", "2020–?" */
export function spellYears(s: CareerSpell): string {
  const [, a, b] = s;
  if (b === null) return `${a}–`;
  if (b === '?') return `${a}–?`;
  if (b === a) return String(a);
  return `${a}–${String(b).slice(Math.floor(a / 100) === Math.floor(b / 100) ? 2 : 0)}`;
}
