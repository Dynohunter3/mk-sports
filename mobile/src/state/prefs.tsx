import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { setDisabledSources } from '@/data/predict';
import { readJSON, writeJSON } from '@/lib/storage';

/** The user's one favourite team: prioritised on Home and in its own tab. */
export type FavouriteTeam = { id: string; name: string; short_name: string; code: string; color: string; logo: string | null; sport: string; leagues: string[] };

export type Prefs = {
  onboarded: boolean;
  favoriteTeam: FavouriteTeam | null;
  /** League chip selected on Home (null = all of the user's competitions). */
  homeLeague: string | null;
  sports: string[];
  leagues: string[];
  teams: string[];
  theme: 'dark' | 'light' | 'system';
  /** vibration feedback on taps, picks and celebrations */
  haptics: boolean;
  /** animations (off = calmer, also follows the system's reduce-motion setting) */
  motion: boolean;
  /** Pauses automatic refreshing to save mobile data. */
  dataSaver: boolean;
  showAiOnPickScreen: boolean;
  /** Include betting-market consensus in forecasts (prices are never shown). */
  useMarket: boolean;
  /** Notification types (all off until the user turns them on and grants permission). */
  notify: { matchAlerts: boolean; reminders: boolean; pickResults: boolean };
  /** Matches with the bell on (alerts even when it's not your team). */
  followed: string[];
};

const DEFAULTS: Prefs = {
  onboarded: false,
  favoriteTeam: null,
  homeLeague: null,
  sports: [],
  leagues: [],
  teams: [],
  theme: 'dark',
  haptics: true,
  motion: true,
  dataSaver: false,
  showAiOnPickScreen: true,
  useMarket: true,
  notify: { matchAlerts: false, reminders: false, pickResults: false },
  followed: [],
};

const KEY = 'prefs:v2';

type Ctx = { prefs: Prefs; ready: boolean; update: (patch: Partial<Prefs>) => void };
const PrefsCtx = createContext<Ctx>({ prefs: DEFAULTS, ready: false, update: () => undefined });

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    readJSON<Partial<Prefs>>(KEY).then((saved) => {
      if (saved) setPrefs({ ...DEFAULTS, ...saved, notify: { ...DEFAULTS.notify, ...(saved.notify ?? {}) } });
      setReady(true);
    });
  }, []);

  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((cur) => {
      const next = { ...cur, ...patch };
      writeJSON(KEY, next);
      return next;
    });
  }, []);

  useEffect(() => setDisabledSources(prefs.useMarket ? [] : ['market']), [prefs.useMarket]);

  const value = useMemo(() => ({ prefs, ready, update }), [prefs, ready, update]);
  return <PrefsCtx.Provider value={value}>{children}</PrefsCtx.Provider>;
}

export const usePrefs = () => useContext(PrefsCtx);
