import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { usePrefs } from '@/state/prefs';

import { startLiveTracking } from './live';
import { anyOn, ensureChannels, liveState, NOTIFY_SUPPORTED, runAlertCheck, syncBackground } from './notifications';

const openFrom = (r: Notifications.NotificationResponse | null) => {
  const id = r?.notification.request.content.data?.matchId;
  if (typeof id === 'string' && id) {
    router.push(`/match/${id}`);
    Notifications.clearLastNotificationResponse(); // don't reopen it on the next launch
  }
};

/** Root-level: tapping an alert opens its match; checks run every minute while the app is open. */
export function useAlerts(appReady: boolean) {
  const { prefs, ready } = usePrefs();
  const on = anyOn(prefs.notify);

  useEffect(() => {
    if (!NOTIFY_SUPPORTED || !appReady) return;
    ensureChannels().catch(() => undefined);
    // emulator verification builds only (set at build time; never in a release): start live tracking now
    if (process.env.EXPO_PUBLIC_E2E_LIVE === '1') startLiveTracking().catch(() => undefined);
    // the app was opened by tapping an alert: go to that match once the navigator is up
    const t = setTimeout(() => openFrom(Notifications.getLastNotificationResponse()), 400);
    const sub = Notifications.addNotificationResponseReceivedListener(openFrom);
    return () => {
      clearTimeout(t);
      sub.remove();
    };
  }, [appReady]);

  useEffect(() => {
    if (!NOTIFY_SUPPORTED || !ready) return;
    syncBackground(on).catch(() => undefined);
    if (!on) return;
    // while the app is open: check, and start live tracking when one of your matches is on (Android only
    // allows starting it from the foreground; it then keeps running when the app is closed)
    const pass = () =>
      runAlertCheck()
        .then(() => {
          if (prefs.notify.matchAlerts && prefs.notify.liveTracking !== false && liveState().matches.length) startLiveTracking().catch(() => undefined);
        })
        .catch(() => undefined);
    // prefs are saved asynchronously; give the write a moment before the first pass
    const first = setTimeout(pass, 1500);
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') pass();
    }, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [ready, on, prefs.notify.matchAlerts, prefs.notify.reminders, prefs.notify.pickResults, prefs.notify.liveTracking, prefs.favoriteTeam?.id, prefs.followed.length]);
}
