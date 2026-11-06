/**
 * Notifications, all generated on the phone (no push server):
 *  - Kick-off reminders: scheduled locally 30 minutes before your team's matches, matches you
 *    follow and matches you've picked. They fire on time even if the app is closed.
 *  - Goals, kick-off and full time: found by checking the live data, every minute while the
 *    app is open and about every 15 minutes in the background (Android decides the exact
 *    timing and may wait longer in battery saver), so background alerts can arrive late.
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

export type NotifyPrefs = { matchAlerts: boolean; reminders: boolean; pickResults: boolean };
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

/** One pass: deliver new alerts, refresh the reminders. Returns how many alerts were sent. */
export function runAlertCheck(): Promise<number> {
  if (!running) running = check().finally(() => (running = null));
  return running;
}

async function check(): Promise<number> {
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
  const res = await Promise.allSettled([...leagues].filter((l) => LEAGUE_BY_SLUG[l]?.format === 'match').map((slug) => espn.scoreboard(slug, new Date(now - 1.5 * DAY), new Date(now + 8 * DAY), 60)));
  const events = [...new Map(res.flatMap((r) => (r.status === 'fulfilled' ? r.value.events : [])).map((e) => [e.id, e])).values()];
  const watched = (ev: espn.SEvent) => (!!fav && (ev.home.id === fav.id || ev.away.id === fav.id)) || followed.includes(ev.id) || !!st.picks[ev.id];
  const sent = new Set((await readJSON<string[]>(SENT_KEY)) ?? []);
  let count = 0;

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
    const want = reminders(events, watched, pickFor, 30, now);
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const have = new Map(scheduled.filter((s) => s.identifier.startsWith('kick:')).map((s) => [s.identifier, s]));
    for (const r of want) {
      const prev = have.get(r.id);
      have.delete(r.id);
      const prevAt = (prev?.content.data as { at?: number } | undefined)?.at;
      if (prev && prevAt === r.at && prev.content.body === r.body) continue; // already right
      if (prev) await Notifications.cancelScheduledNotificationAsync(r.id);
      await Notifications.scheduleNotificationAsync({
        identifier: r.id,
        content: { title: r.title, body: r.body, data: { matchId: r.matchId, at: r.at }, sound: 'default' },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(r.at), ...(Platform.OS === 'android' ? { channelId: 'reminders' } : {}) },
      });
    }
    // matches no longer watched (or moved past the reminder time)
    for (const id of have.keys()) await Notifications.cancelScheduledNotificationAsync(id);
  } else {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const s of scheduled) if (s.identifier.startsWith('kick:')) await Notifications.cancelScheduledNotificationAsync(s.identifier);
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

export async function cancelAll() {
  if (!NOTIFY_SUPPORTED) return;
  await Notifications.cancelAllScheduledNotificationsAsync();
}
