/**
 * Network layer for public data sources: timeouts, in-flight de-duplication, short-lived
 * in-memory caching, and retry with backoff. Everything is plain fetch (gzip is automatic).
 */

export class SourceError extends Error {
  constructor(
    public source: string,
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Entry = { at: number; ttl: number; value: unknown };
const mem = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();
const MAX_ENTRIES = 300;

let fetchImpl: typeof fetch = (...a) => fetch(...a);
/** Tests inject a fake fetch. */
export function setFetch(f: typeof fetch) {
  fetchImpl = f;
  mem.clear();
  inflight.clear();
}

export function clearMemoryCache() {
  mem.clear();
}

async function once(url: string, kind: 'json' | 'text', timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { headers: { Accept: kind === 'json' ? 'application/json' : 'text/plain, text/csv, */*' }, signal: ctrl.signal });
    if (!res.ok) throw new SourceError(new URL(url).host, res.status, `HTTP ${res.status} from ${new URL(url).host}`);
    return kind === 'json' ? await res.json() : await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function get<T>(url: string, opts: { ttl: number; kind?: 'json' | 'text'; timeoutMs?: number; retries?: number } = { ttl: 60 }): Promise<T> {
  const kind = opts.kind ?? 'json';
  const hit = mem.get(url);
  if (hit && Date.now() - hit.at < hit.ttl * 1000) return hit.value as T;
  if (inflight.has(url)) return inflight.get(url) as Promise<T>;
  const p = (async () => {
    let delay = 800;
    const retries = opts.retries ?? 2;
    for (let attempt = 0; ; attempt++) {
      try {
        const value = await once(url, kind, opts.timeoutMs ?? 15000);
        if (mem.size >= MAX_ENTRIES) mem.delete(mem.keys().next().value as string);
        mem.set(url, { at: Date.now(), ttl: opts.ttl, value });
        return value;
      } catch (e) {
        const status = e instanceof SourceError ? e.status : 0;
        if (attempt >= retries || (status >= 400 && status < 500 && status !== 429)) {
          if (hit) return hit.value; // stale beats nothing
          throw e;
        }
        await new Promise((r) => setTimeout(r, delay));
        delay *= 2;
      }
    }
  })();
  inflight.set(url, p);
  try {
    return (await p) as T;
  } finally {
    inflight.delete(url);
  }
}
