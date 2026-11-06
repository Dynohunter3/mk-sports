import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { handleLocal } from '@/data/localApi';

import { ApiError, OfflineError } from './errors';

/**
 * Two data modes:
 *  - device (default): live public data fetched and modelled on the phone (src/data)
 *  - server: an MK Sports backend at EXPO_PUBLIC_API_URL (accounts, global leaderboards)
 */
export const DATA_MODE: 'device' | 'server' = process.env.EXPO_PUBLIC_API_URL ? 'server' : 'device';

function resolveBaseUrl(): string {
  const env = process.env.EXPO_PUBLIC_API_URL;
  if (env) return env.replace(/\/$/, '');
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.hostname) {
    return `${window.location.protocol}//${window.location.hostname}:8000`;
  }
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) return `http://${hostUri.split(':')[0]}:8000`;
  return Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://localhost:8000';
}

export const API_URL = resolveBaseUrl();
const PREFIX = '/api/v1';

let authToken: string | null = null;
let onUnauthorized: (() => Promise<string | null>) | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

/** Called on a 401; may refresh the session and return a new token (Supabase). */
export function setUnauthorizedHandler(fn: (() => Promise<string | null>) | null) {
  onUnauthorized = fn;
}

export function hasAuth() {
  return authToken !== null;
}

export { ApiError, OfflineError };

type Opts = { method?: string; body?: unknown; etag?: string; timeoutMs?: number; auth?: boolean };
export type RawResponse<T> = { status: number; data: T | null; etag: string | null };

async function doFetch(path: string, opts: Opts, token: string | null): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (token && opts.auth !== false) headers.Authorization = `Bearer ${token}`;
  if (opts.etag) headers['If-None-Match'] = opts.etag;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15000);
  try {
    return await fetch(`${API_URL}${PREFIX}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
  } catch {
    throw new OfflineError();
  } finally {
    clearTimeout(timer);
  }
}

/** Low-level request that exposes 304s (used by the cache). */
export async function requestRaw<T>(path: string, opts: Opts = {}): Promise<RawResponse<T>> {
  if (DATA_MODE === 'device') {
    const data = (await handleLocal(opts.method ?? 'GET', path, opts.body)) as T;
    return { status: data === null ? 204 : 200, data, etag: null };
  }
  let res = await doFetch(path, opts, authToken);
  if (res.status === 401 && authToken && onUnauthorized) {
    const fresh = await onUnauthorized();
    if (fresh) res = await doFetch(path, opts, fresh);
  }
  if (res.status === 304) return { status: 304, data: null, etag: opts.etag ?? null };
  if (res.status === 204) return { status: 204, data: null, etag: null };
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const d = body?.detail;
    const code = typeof d === 'object' && d?.code ? d.code : String(res.status);
    const msg = typeof d === 'string' ? d : typeof d === 'object' && d?.message ? d.message : Array.isArray(d) ? d.map((x: any) => x.msg).join(', ') : 'Something went wrong';
    throw new ApiError(res.status, code, msg, d);
  }
  return { status: res.status, data: body as T, etag: res.headers.get('etag') };
}

export async function api<T>(path: string, opts: Opts = {}): Promise<T> {
  return (await requestRaw<T>(path, opts)).data as T;
}

export function qs(params: Record<string, string | number | boolean | null | undefined | (string | number)[]>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(Array.isArray(v) ? v.join(',') : String(v))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}
