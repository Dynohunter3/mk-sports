/**
 * Tiny offline-first data layer (instead of a heavier query library):
 *  - stale-while-revalidate: cached data renders instantly, then refreshes in the background
 *  - responses persist in AsyncStorage, so fixtures and picks are readable offline
 *  - revalidation sends If-None-Match; unchanged data costs a ~200-byte 304
 *  - polling pauses when the app is backgrounded or the screen isn't focused
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { allKeys, readJSON, removeKeys, writeJSON } from '@/lib/storage';

import { onLocalDataChange } from '@/data/localApi';

import { DATA_MODE, hasAuth, OfflineError, requestRaw } from './client';

type Entry = { data?: unknown; etag?: string | null; ts: number; error?: string; offline?: boolean; loading?: boolean };

const mem = new Map<string, Entry>();
const subs = new Map<string, Set<() => void>>();
const inflight = new Map<string, Promise<void>>();
const PREFIX = 'q:';
const MAX_PERSISTED = 80;
const EMPTY: Entry = { ts: 0 };

function emit(key: string) {
  subs.get(key)?.forEach((fn) => fn());
}

function set(key: string, patch: Partial<Entry>) {
  mem.set(key, { ...(mem.get(key) ?? { ts: 0 }), ...patch });
  emit(key);
}

let pruneScheduled = false;
async function prune() {
  if (pruneScheduled) return;
  pruneScheduled = true;
  setTimeout(async () => {
    pruneScheduled = false;
    const keys = (await allKeys()).filter((k) => k.startsWith(PREFIX));
    if (keys.length <= MAX_PERSISTED) return;
    const stamped = await Promise.all(keys.map(async (k) => [k, (await readJSON<Entry>(k))?.ts ?? 0] as const));
    stamped.sort((a, b) => a[1] - b[1]);
    await removeKeys(stamped.slice(0, keys.length - MAX_PERSISTED).map(([k]) => k));
  }, 2000);
}

export async function revalidate(key: string, path: string, persist: boolean): Promise<void> {
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    const cur = mem.get(key);
    set(key, { loading: true });
    try {
      const res = await requestRaw<unknown>(path, { etag: cur?.data !== undefined ? cur?.etag ?? undefined : undefined });
      if (res.status === 304) {
        set(key, { ts: Date.now(), error: undefined, offline: false, loading: false });
      } else {
        set(key, { data: res.data, etag: res.etag, ts: Date.now(), error: undefined, offline: false, loading: false });
      }
      const e = mem.get(key)!;
      if (persist) {
        writeJSON(PREFIX + key, { data: e.data, etag: e.etag, ts: e.ts });
        prune();
      }
    } catch (err) {
      set(key, { error: err instanceof Error ? err.message : 'Error', offline: err instanceof OfflineError, loading: false });
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/** Drop cached entries (e.g. after a pick, or on sign-out for user-specific data). */
export function invalidate(match: (key: string) => boolean = () => true) {
  for (const key of Array.from(mem.keys())) {
    if (match(key)) {
      mem.set(key, { ...(mem.get(key) as Entry), ts: 0 });
      emit(key);
    }
  }
}

// New results / finished history loads on the device refresh whatever is on screen.
if (DATA_MODE === 'device') onLocalDataChange(() => invalidate());

export async function clearUserCache() {
  for (const key of Array.from(mem.keys())) if (key.endsWith('#u')) mem.delete(key);
  const keys = (await allKeys()).filter((k) => k.startsWith(PREFIX) && k.endsWith('#u'));
  await removeKeys(keys);
}

export type UseApiOptions = {
  /** Seconds before cached data is considered stale. */
  maxAge?: number;
  /** Poll every N seconds while focused and in the foreground (0 = off). */
  poll?: number;
  persist?: boolean;
};

export function useApi<T>(path: string | null, { maxAge = 60, poll = 0, persist = true }: UseApiOptions = {}) {
  // user-specific responses are cached separately so accounts never see each other's data
  const key = path ? path + (hasAuth() ? '#u' : '') : '';
  const subscribe = useCallback(
    (fn: () => void) => {
      if (!key) return () => undefined;
      if (!subs.has(key)) subs.set(key, new Set());
      subs.get(key)!.add(fn);
      return () => subs.get(key)?.delete(fn);
    },
    [key],
  );
  const entry = useSyncExternalStore(subscribe, () => (key ? mem.get(key) ?? EMPTY : EMPTY), () => EMPTY);
  const hydrated = useRef<string | null>(null);

  useEffect(() => {
    if (!key || !path) return;
    let cancelled = false;
    (async () => {
      if (!mem.has(key) && persist && hydrated.current !== key) {
        hydrated.current = key;
        const saved = await readJSON<Entry>(PREFIX + key);
        if (saved && !mem.has(key)) set(key, { data: saved.data, etag: saved.etag, ts: saved.ts });
      }
      if (cancelled) return;
      const e = mem.get(key);
      if (!e || e.data === undefined || Date.now() - e.ts > maxAge * 1000) revalidate(key, path, persist);
    })();
    return () => {
      cancelled = true;
    };
  }, [key, path, maxAge, persist, entry.ts]);

  useFocusEffect(
    useCallback(() => {
      if (!poll || !key || !path) return undefined;
      const id = setInterval(() => {
        if (AppState.currentState === 'active') revalidate(key, path, persist);
      }, poll * 1000);
      return () => clearInterval(id);
    }, [poll, key, path, persist]),
  );

  const refresh = useCallback(() => (key && path ? revalidate(key, path, persist) : Promise.resolve()), [key, path, persist]);
  return {
    data: entry.data as T | undefined,
    error: entry.error,
    offline: !!entry.offline,
    loading: entry.data === undefined && (entry.loading ?? !!path),
    refreshing: !!entry.loading && entry.data !== undefined,
    updatedAt: entry.ts,
    refresh,
  };
}
