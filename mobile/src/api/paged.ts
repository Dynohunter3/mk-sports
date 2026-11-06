import { useCallback, useEffect, useRef, useState } from 'react';

import { useApi, UseApiOptions } from './cache';
import { api } from './client';

type Page<T> = { items: T[]; next_cursor: string | null };

/** First page via the offline cache; further pages are fetched on demand (paginated lists keep payloads small). */
export function usePaged<T extends { id?: string | number }>(path: string | null, opts?: UseApiOptions) {
  const first = useApi<Page<T>>(path, opts);
  const [extra, setExtra] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const pathRef = useRef(path);

  useEffect(() => {
    pathRef.current = path;
    setExtra([]);
    setCursor(first.data?.next_cursor ?? null);
  }, [path, first.data]);

  const loadMore = useCallback(async () => {
    if (!path || !cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const sep = path.includes('?') ? '&' : '?';
      const page = await api<Page<T>>(`${path}${sep}cursor=${encodeURIComponent(cursor)}`);
      if (pathRef.current !== path) return;
      setExtra((cur) => [...cur, ...page.items]);
      setCursor(page.next_cursor);
    } catch {
      // keep what we have; the user can scroll again to retry
    } finally {
      setLoadingMore(false);
    }
  }, [path, cursor, loadingMore]);

  return { ...first, items: [...(first.data?.items ?? []), ...extra], hasMore: !!cursor, loadMore, loadingMore };
}
