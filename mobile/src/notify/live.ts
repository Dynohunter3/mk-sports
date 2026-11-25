/**
 * Live tracking (Android): while one of your matches is live or about to start, a foreground service
 * shows a live-score notification and checks for goals and full time every 30 seconds, so those alerts
 * no longer depend on Android's 15-minute background schedule (which battery savers delay or skip).
 * It stops by itself a few minutes after your last match ends. Android only lets an app start this while
 * it is open, so it starts when you open MK Sports (e.g. from the kick-off alert) during a match.
 */
import { Platform } from 'react-native';
import BackgroundService from 'react-native-background-actions';

import { type LiveMatch, liveState, runAlertCheck } from './notifications';

export const LIVE_SUPPORTED = Platform.OS === 'android';
const EVERY_MS = 30_000;
const MAX_MS = 5 * 3600_000; // a safety stop
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let starting = false;

const line = (m: LiveMatch) => (m.status === 'live' ? `${m.home} ${m.hs ?? 0}–${m.as ?? 0} ${m.away}${m.clock ? ` (${m.clock})` : ''}` : `${m.home} v ${m.away} · kicks off soon`);

function texts(ms: LiveMatch[]) {
  if (!ms.length) return { taskTitle: 'MK Sports live', taskDesc: 'Watching for kick-off, goals and full time' };
  const first = ms.find((m) => m.status === 'live') ?? ms[0];
  return { taskTitle: first.status === 'live' ? `LIVE · ${line(first)}` : line(first), taskDesc: ms.length > 1 ? ms.filter((m) => m !== first).map(line).join(' · ') : 'Goal and full-time alerts within about 30 seconds' };
}

async function loop() {
  const t0 = Date.now();
  let idle = 0;
  while (BackgroundService.isRunning() && Date.now() - t0 < MAX_MS) {
    try {
      await runAlertCheck(true);
    } catch {
      // keep going: a failed check is retried on the next pass
    }
    const ms = liveState().matches;
    idle = ms.length ? 0 : idle + 1;
    if (idle >= 4) break; // two minutes with nothing live: done
    await BackgroundService.updateNotification(texts(ms)).catch(() => undefined);
    // keep the "My team" home-screen widget's score current while a match is on
    await import('@/widget/handler').then((w) => w.updateMyTeamWidget()).catch(() => undefined);
    await sleep(EVERY_MS);
  }
  await BackgroundService.stop().catch(() => undefined);
}

export const liveTrackingRunning = () => LIVE_SUPPORTED && BackgroundService.isRunning();

export async function startLiveTracking(): Promise<boolean> {
  if (!LIVE_SUPPORTED || starting || BackgroundService.isRunning()) return BackgroundService.isRunning();
  starting = true;
  try {
    await BackgroundService.start(loop, {
      taskName: 'MKSportsLive',
      ...texts(liveState().matches),
      taskIcon: { name: 'notification_icon', type: 'drawable' },
      color: '#2CF59A',
      linkingURI: 'mksports://',
      foregroundServiceType: ['dataSync'],
    });
    return true;
  } catch {
    return false; // not allowed right now (e.g. the app is in the background): alerts fall back to checks
  } finally {
    starting = false;
  }
}

export async function stopLiveTracking() {
  if (LIVE_SUPPORTED && BackgroundService.isRunning()) await BackgroundService.stop().catch(() => undefined);
}
