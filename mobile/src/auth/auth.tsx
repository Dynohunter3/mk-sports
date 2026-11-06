import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { clearUserCache, invalidate } from '@/api/cache';
import { api, DATA_MODE, setAuthToken, setUnauthorizedHandler } from '@/api/client';
import { settlePending } from '@/data/localApi';
import type { Me } from '@/api/types';
import { secure } from '@/lib/storage';
import { usePrefs } from '@/state/prefs';

import * as sb from './supabase';

export const AUTH_MODE: 'device' | 'dev' | 'supabase' = DATA_MODE === 'device' ? 'device' : process.env.EXPO_PUBLIC_AUTH_MODE === 'supabase' ? 'supabase' : 'dev';
const TOKEN_KEY = 'auth.session';

type StoredSession = { access_token: string; refresh_token?: string; expires_at?: number };

type AuthCtx = {
  ready: boolean;
  me: Me | null;
  signedIn: boolean;
  mode: typeof AUTH_MODE;
  signInEmail: (email: string, password: string) => Promise<void>;
  register: (p: { email: string; password: string; name: string; marketing: boolean }) => Promise<'ok' | 'confirm_email'>;
  signInDemo: () => Promise<void>;
  signInGoogle: () => Promise<boolean>;
  sendOtp: (phone: string) => Promise<void>;
  verifyOtp: (phone: string, code: string) => Promise<void>;
  acceptConsent: (marketing: boolean) => Promise<void>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<Me | null>;
  deleteAccount: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const session = useRef<StoredSession | null>(null);
  const { prefs, update } = usePrefs();
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const loadMe = useCallback(async (): Promise<Me | null> => {
    try {
      const m = await api<Me>('/me');
      setMe(m);
      return m;
    } catch {
      return null;
    }
  }, []);

  /** Favourites: adopt the account's saved ones, or upload the ones chosen while a guest. */
  const syncFavourites = useCallback(
    async (m: Me) => {
      if (AUTH_MODE === 'device') return; // favourites live in local prefs
      const f = m.favourites;
      const p = prefsRef.current;
      if (f.sports.length || f.leagues.length || f.teams.length) {
        update({ sports: f.sports, leagues: f.leagues, teams: f.teams, onboarded: true });
      } else if (p.sports.length || p.leagues.length || p.teams.length) {
        const updated = await api<Me>('/me/favourites', { method: 'PUT', body: { sports: p.sports, leagues: p.leagues, teams: p.teams } }).catch(() => null);
        if (updated) setMe(updated);
      }
    },
    [update],
  );

  const adopt = useCallback(
    async (s: StoredSession) => {
      session.current = s;
      setAuthToken(s.access_token);
      await secure.set(TOKEN_KEY, JSON.stringify(s));
      invalidate();
      const m = await loadMe();
      if (m) await syncFavourites(m);
    },
    [loadMe, syncFavourites],
  );

  const clear = useCallback(async () => {
    session.current = null;
    setAuthToken(null);
    setMe(null);
    await secure.remove(TOKEN_KEY);
    await clearUserCache();
    invalidate();
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(async () => {
      const s = session.current;
      if (AUTH_MODE === 'supabase' && s?.refresh_token) {
        try {
          const fresh = await sb.refresh(s.refresh_token);
          session.current = fresh;
          setAuthToken(fresh.access_token);
          await secure.set(TOKEN_KEY, JSON.stringify(fresh));
          return fresh.access_token;
        } catch {
          // fall through to sign-out
        }
      }
      await clear();
      return null;
    });
    (async () => {
      if (AUTH_MODE === 'device') {
        // no accounts: the profile, picks and points are stored on this phone
        await loadMe();
        setReady(true);
        // settle picks on matches that finished while the app was closed
        settlePending()
          .then(() => loadMe())
          .catch(() => undefined);
        return;
      }
      const raw = await secure.get(TOKEN_KEY);
      if (raw) {
        try {
          const s = JSON.parse(raw) as StoredSession;
          session.current = s;
          setAuthToken(s.access_token);
          await loadMe();
        } catch {
          await secure.remove(TOKEN_KEY);
        }
      }
      setReady(true);
    })();
  }, [clear, loadMe]);

  const value = useMemo<AuthCtx>(
    () => ({
      ready,
      me,
      signedIn: !!me,
      mode: AUTH_MODE,
      async signInEmail(email, password) {
        if (AUTH_MODE === 'supabase') return adopt(await sb.signInWithPassword(email, password));
        const t = await api<{ access_token: string }>('/auth/login', { method: 'POST', body: { email, password }, auth: false });
        await adopt({ access_token: t.access_token });
      },
      async register({ email, password, name, marketing }) {
        if (AUTH_MODE === 'supabase') {
          const s = await sb.signUp(email, password, name);
          if (!s) return 'confirm_email';
          await adopt(s);
          await api('/me/consent', { method: 'POST', body: { terms: true, privacy: true, marketing } });
          await loadMe();
          return 'ok';
        }
        const t = await api<{ access_token: string }>('/auth/register', {
          method: 'POST',
          auth: false,
          body: { email, password, display_name: name, accept_terms: true, accept_privacy: true, marketing_opt_in: marketing },
        });
        await adopt({ access_token: t.access_token });
        return 'ok';
      },
      async signInDemo() {
        const t = await api<{ access_token: string }>('/auth/demo', { method: 'POST', auth: false });
        await adopt({ access_token: t.access_token });
      },
      async signInGoogle() {
        const s = await sb.signInWithGoogle();
        if (!s) return false;
        await adopt(s);
        return true;
      },
      sendOtp: (phone) => sb.sendPhoneOtp(phone),
      async verifyOtp(phone, code) {
        await adopt(await sb.verifyPhoneOtp(phone, code));
      },
      async acceptConsent(marketing) {
        setMe(await api<Me>('/me/consent', { method: 'POST', body: { terms: true, privacy: true, marketing } }));
      },
      signOut: clear,
      refreshMe: loadMe,
      async deleteAccount() {
        await api('/me', { method: 'DELETE' });
        if (AUTH_MODE === 'device') {
          invalidate();
          await loadMe();
          return;
        }
        await clear();
      },
    }),
    [ready, me, adopt, clear, loadMe],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
