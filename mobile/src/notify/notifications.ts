/**
 * Notifications, all generated on the phone (no push server):
 *  - Kick-off reminders: scheduled locally 30 minutes before your team's matches, matches you
 *    follow and matches you've picked. They fire on time even if the app is closed.
 *  - Kick-off: scheduled for the exact kick-off time (an exact alarm), like the reminders.
 *  - Goals and full time: found by checking the live data. While one of your matches is on, live
 *    tracking (live.ts, a foreground service with a live-score notification) checks every 30 seconds;
 *    otherwise every minute while the app is open and about every 15 minutes in the background
 *    (Android decides that timing and may wait longer in battery saver).
 *  - Pick results: when a pick is settled (won / lost, with points).
 */
import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import * as espn from '@/data/espn';
import * as game from '@/data/game';
import { LEAGUE_BY_SLUG } from '@/data/leagues';
import { readJSON, writeJSON } from '@/lib/storage';
import type { Prefs } from '@/state/prefs';

import { diffMatches, reminders, Seen } from './alerts';

export const ALERT_TASK = 'mk-sports-alerts';
export const NOTIFY_SUPPORTED = Platform.OS === 'android' || Platform.OS === 'ios';
const DAY = 86_400_000;
const SEEN_KEY = 'notify:seen:v1';
const SENT_KEY = 'notify:sent:v1';
const PICKS_KEY = 'notify:picks:v1';

export type NotifyPrefs = { matchAlerts: boolean; reminders: boolean; pickResults: boolean; liveTracking?: boolean };

/** Watched matches that are live or about to start (for live tracking), from the latest check. */
export type LiveMatch = { id: string; home: string; away: string; hs: number | null; as: number | null; clock: string | null; status: string };
let live: { matches: LiveMatch[]; at: number } = { matches: [], at: 0 };
export const liveState = () => live;
export const anyOn = (n?: Partial<NotifyPrefs> | null) => !!(n && (n.matchAlerts || n.reminders || n.pickResults));

if (NOTIFY_SUPPORTED) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

export async function ensureChannels() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('match', { name: 'Goals & results', importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 200, 120, 200], lightColor: '#2CF59A' });
  await Notifications.setNotificationChannelAsync('reminders', { name: 'Kick-off reminders', importance: Notifications.AndroidImportance.DEFAULT });
  await Notifications.setNotificationChannelAsync('picks', { name: 'Pick results', importance: Notifications.AndroidImportance.DEFAULT });
}

export async function requestPermission(): Promise<boolean> {
  if (!NOTIFY_SUPPORTED) return false;
  await ensureChannels();
  const cur = await Notifications.getPermissionsAsync();
  if (cur.granted) return true;
  if (!cur.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

async function show(id: string, title: string, body: string, matchId: string | null, channel: 'match' | 'picks') {
  await Notifications.scheduleNotificationAsync({
    identifier: id,
    content: { title, body, data: matchId ? { matchId } : {}, sound: 'default' },
    trigger: Platform.OS === 'android' ? { channelId: channel } : null,
  });
}

let running: Promise<number> | null = null;

/** One pass: deliver new alerts, refresh the scheduled ones. Returns how many alerts were sent.
 * `fresh`: live tracking (data at most ~15 s old instead of a minute). */
export function runAlertCheck(fresh = false): Promise<number> {
  if (!running) running = check(fresh).finally(() => (running = null));
  return running;
}

/** Keep the scheduled notifications with this prefix exactly matching `want` (exact alarms). */
async function syncScheduled(prefix: string, want: { id: string; matchId: string; at: number; title: string; body: string }[], channel: 'match' | 'reminders') {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const have = new Map(scheduled.filter((x) => x.identifier.startsWith(prefix)).map((x) => [x.identifier, x]));
  for (const r of want) {
    const prev = have.get(r.id);
    have.delete(r.id);
    const prevAt = (prev?.content.data as { at?: number } | undefined)?.at;
    if (prev && prevAt === r.at && prev.content.body === r.body) continue; // already right
    if (prev) await Notifications.cancelScheduledNotificationAsync(r.id);
    await Notifications.scheduleNotificationAsync({
      identifier: r.id,
      content: { title: r.title, body: r.body, data: { matchId: r.matchId, at: r.at }, sound: 'default' },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(r.at), ...(Platform.OS === 'android' ? { channelId: channel } : {}) },
    });
  }
  for (const id of have.keys()) await Notifications.cancelScheduledNotificationAsync(id); // no longer wanted
}

async function check(fresh = false): Promise<number> {
  if (!NOTIFY_SUPPORTED) return 0;
  const prefs = await readJSON<Prefs>('prefs:v2');
  const n = prefs?.notify;
  if (!anyOn(n)) return 0;
  const perm = await Notifications.getPermissionsAsync();
  if (!perm.granted) return 0;
  const fav = prefs!.favoriteTeam;
  const followed = prefs!.followed ?? [];
  const st = await game.loadGame();
  const picks = Object.values(st.picks);
  const leagues = new Set<string>([...(fav?.leagues ?? []), ...followed.map((id) => id.split('~')[0]), ...picks.filter((p) => p.status === 'pending').map((p) => p.league)]);
  const now = Date.now();
  const res = await Promise.allSettled([...leagues].filter((l) => LEAGUE_BY_SLUG[l]?.format === 'match').map((slug) => espn.scoreboard(slug, new Date(now - 1.5 * DAY), new Date(now + 8 * DAY), fresh ? 15 : 60)));
  const events = [...new Map(res.flatMap((r) => (r.status === 'fulfilled' ? r.value.events : [])).map((e) => [e.id, e])).values()];
  const watched = (ev: espn.SEvent) => (!!fav && (ev.home.id === fav.id || ev.away.id === fav.id)) || followed.includes(ev.id) || !!st.picks[ev.id];
  const sent = new Set((await readJSON<string[]>(SENT_KEY)) ?? []);
  let count = 0;
  // what live tracking follows: watched matches that are live, or kick off within 15 minutes
  if (res.some((r) => r.status === 'fulfilled')) {
    live = {
      at: now,
      matches: events
        .filter((ev) => watched(ev) && (ev.status === 'live' || (ev.status === 'scheduled' && Date.parse(ev.start) - now < 15 * 60_000 && now - Date.parse(ev.start) < 3 * 3600_000)))
        .map((ev) => ({ id: ev.id, home: ev.home.short, away: ev.away.short, hs: ev.homeScore, as: ev.awayScore, clock: ev.clock, status: ev.status })),
    };
  }

  if (n!.matchAlerts) {
    // kick-off alerts are scheduled for the exact kick-off time (an exact alarm), so they never wait
    // for a background check; the checked kick-off alert is then skipped as already sent
    const kick = events
      .filter((ev) => ev.status === 'scheduled' && watched(ev) && Date.parse(ev.start) > now + 60_000 && Date.parse(ev.start) < now + 8 * DAY)
      .map((ev) => {
        const p = st.picks[ev.id];
        const yours = p ? (p.pick === 'draw' ? 'Draw' : p.pick === 'home' ? p.homeName : p.awayName) : null;
        return {
          id: `ko:${ev.id}`,
          matchId: ev.id,
          at: Date.parse(ev.start),
          title: `Kick-off: ${ev.home.short} v ${ev.away.short}`,
          body: `${LEAGUE_BY_SLUG[ev.league]?.shortName ?? ev.league} · ${yours ? `your pick: ${yours} · ` : ''}open for live tracking`,
        };
      });
    await syncScheduled('ko:', kick, 'match');
    for (const k of kick) sent.add(`${k.matchId}:ko`);
  } else {
    await syncScheduled('ko:', [], 'match');
  }

  if (n!.matchAlerts) {
    const seen = (await readJSON<Record<string, Seen>>(SEEN_KEY)) ?? {};
    const { alerts, next } = diffMatches(seen, events, watched, now);
    await writeJSON(SEEN_KEY, next);
    for (const a of alerts) {
      if (sent.has(a.id)) continue;
      await show(a.id, a.title, a.body, a.matchId, 'match');
      sent.add(a.id);
      count += 1;
    }
  }

  if (n!.pickResults) {
    await game.settle(events); // settles picks whose matches finished (idempotent)
    const last = (await readJSON<Record<string, string>>(PICKS_KEY)) ?? {};
    const nowStatus: Record<string, string> = {};
    for (const p of Object.values(game.gameState()?.picks ?? st.picks)) {
      nowStatus[p.matchId] = p.status;
      const before = last[p.matchId];
      if (before === 'pending' && (p.status === 'won' || p.status === 'lost')) {
        const id = `${p.matchId}:pick`;
        if (sent.has(id)) continue;
        const score = p.final_score ? ` ${p.homeName} ${p.final_score[0]}-${p.final_score[1]} ${p.awayName}` : '';
        await show(id, p.status === 'won' ? `Your pick won · +${p.points} points` : 'Your pick lost this time', `${score.trim()}${score ? ' · ' : ''}see My points for your streak`, p.matchId, 'picks');
        sent.add(id);
        count += 1;
      }
    }
    await writeJSON(PICKS_KEY, nowStatus);
  }

  if (n!.reminders) {
    const pickFor = (id: string) => {
      const p = st.picks[id];
      if (!p) return null;
      return p.pick === 'draw' ? 'Draw' : `${p.pick === 'home' ? p.homeName : p.awayName}${p.home_score !== null && p.away_score !== null ? ` ${p.home_score}-${p.away_score}` : ''}`;
    };
    await syncScheduled('kick:', reminders(events, watched, pickFor, 30, now), 'reminders');
  } else {
    await syncScheduled('kick:', [], 'reminders');
  }
  await writeJSON(SENT_KEY, [...sent].slice(-300));
  return count;
}

/** Background check about every 15 minutes while any alert type is on. */
export async function syncBackground(on: boolean) {
  if (!NOTIFY_SUPPORTED) return;
  try {
    const registered = await TaskManager.isTaskRegisteredAsync(ALERT_TASK);
    if (on && !registered) await BackgroundTask.registerTaskAsync(ALERT_TASK, { minimumInterval: 15 });
    if (!on && registered) await BackgroundTask.unregisterTaskAsync(ALERT_TASK);
  } catch {
    /* background work restricted on this device: in-app checks still run */
  }
}

/** Settings > Test my alerts: one now, and one exact-scheduled a minute ahead. */
export async function sendTestAlerts(): Promise<boolean> {
  if (!(await requestPermission())) return false;
  await show(`test:${Date.now()}`, 'MK Sports alerts are working ✅', 'A second test arrives in one minute: if it is on time, kick-off alerts will be too.', null, 'match');
  await Notifications.scheduleNotificationAsync({
    identifier: `test-later:${Date.now()}`,
    content: { title: 'Right on time ⏱️', body: 'This alert was scheduled a minute ago. Kick-off reminders use the same exact timing.', sound: 'default' },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(Date.now() + 60_000), ...(Platform.OS === 'android' ? { channelId: 'match' } : {}) },
  });
  return true;
}

export async function cancelAll() {
  if (!NOTIFY_SUPPORTED) return;
  await Notifications.cancelAllScheduledNotificationsAsync();
}
