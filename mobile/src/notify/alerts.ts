/**
 * Match alerts, worked out by comparing what the data source says now with what this phone
 * saw last time (kick-off, each goal, full time). Pure logic: the scheduling and delivery live
 * in notifications.ts, so this part is unit-tested.
 */
import type { SEvent } from '@/data/espn';
import { LEAGUE_BY_SLUG } from '@/data/leagues';
import { weekKey } from '@/data/game';

export type Seen = { s: SEvent['status']; h: number | null; a: number | null; t: number };
export type Alert = { id: string; matchId: string; kind: 'kickoff' | 'goal' | 'fulltime'; title: string; body: string };

const title = (ev: SEvent) => `${ev.home.short} ${ev.homeScore ?? 0}-${ev.awayScore ?? 0} ${ev.away.short}`;
const comp = (ev: SEvent) => LEAGUE_BY_SLUG[ev.league]?.shortName ?? ev.league;

function scorerFor(ev: SEvent, side: 'home' | 'away'): string | null {
  const goals = ev.details.filter((d) => d.side === side && (d.type === 'goal' || d.type === 'penalty_goal' || d.type === 'own_goal'));
  const last = goals.sort((x, y) => (x.minute ?? 0) - (y.minute ?? 0)).pop();
  if (!last?.player) return null;
  return `${last.player}${last.clock ? ` ${last.clock}` : ''}${last.type === 'own_goal' ? ' (og)' : last.type === 'penalty_goal' ? ' (pen)' : ''}`;
}

/**
 * New alerts for the watched matches, and the updated memory. A match seen for the first time
 * produces no alert (so turning alerts on mid-match doesn't replay the whole game).
 */
export function diffMatches(seen: Record<string, Seen>, events: SEvent[], watched: (ev: SEvent) => boolean, now = Date.now()): { alerts: Alert[]; next: Record<string, Seen> } {
  const next: Record<string, Seen> = {};
  // keep a few days of memory so a slow background check still knows the previous state
  for (const [k, v] of Object.entries(seen)) if (now - v.t < 4 * 86_400_000) next[k] = v;
  const alerts: Alert[] = [];
  for (const ev of events) {
    if (!watched(ev)) continue;
    const prev = seen[ev.id];
    const cur: Seen = { s: ev.status, h: ev.homeScore, a: ev.awayScore, t: now };
    next[ev.id] = cur;
    if (!prev) continue;
    const started = (s: Seen['s']) => s === 'live' || s === 'finished';
    if (!started(prev.s) && ev.status === 'live') {
      alerts.push({ id: `${ev.id}:ko`, matchId: ev.id, kind: 'kickoff', title: `Kick-off: ${ev.home.short} v ${ev.away.short}`, body: `${comp(ev)} · follow it live in MK Sports` });
    }
    const ph = prev.h ?? 0;
    const pa = prev.a ?? 0;
    const h = ev.homeScore ?? 0;
    const a = ev.awayScore ?? 0;
    if (started(ev.status) && (h > ph || a > pa)) {
      const side = h > ph ? 'home' : 'away';
      const who = scorerFor(ev, side);
      alerts.push({
        id: `${ev.id}:g${h}-${a}`,
        matchId: ev.id,
        kind: 'goal',
        title: `⚽ Goal! ${title(ev)}`,
        body: [who, h > ph && a > pa ? 'both teams scored since the last update' : null, comp(ev)].filter(Boolean).join(' · '),
      });
    }
    if (prev.s !== 'finished' && ev.status === 'finished') {
      const res = h === a ? 'Draw' : `${h > a ? ev.home.short : ev.away.short} win`;
      alerts.push({ id: `${ev.id}:ft`, matchId: ev.id, kind: 'fulltime', title: `Full time: ${title(ev)}`, body: `${res} · ${comp(ev)}` });
    }
  }
  return { alerts, next };
}

/** Kick-off reminders to schedule: [id, when, title, body]. */
export function reminders(events: SEvent[], watched: (ev: SEvent) => boolean, pickFor: (id: string) => string | null, leadMinutes = 30, now = Date.now()) {
  return events
    .filter((ev) => ev.status === 'scheduled' && watched(ev))
    .map((ev) => ({ ev, at: Date.parse(ev.start) - leadMinutes * 60_000 }))
    .filter((x) => x.at > now + 60_000 && x.at < now + 8 * 86_400_000)
    .map(({ ev, at }) => {
      const pick = pickFor(ev.id);
      return {
        id: `kick:${ev.id}`,
        matchId: ev.id,
        at,
        title: `${ev.home.short} v ${ev.away.short} in ${leadMinutes} minutes`,
        body: `${comp(ev)} · ${pick ? `Your pick: ${pick}` : 'Make your pick before it locks at kick-off'}`,
      };
    });
}

/** Private-league reminder: about two and a half hours after the kick-off of your last pick this week, when it
 * should be settled. Null when there is nothing to remind about, or the time has passed. */
export const SHARE_DELAY_MS = 150 * 60 * 1000;
export function shareReminderAt(picks: { kickoff: string; status: string }[], now: number): number | null {
  const week = weekKey(new Date(now));
  const mine = picks.filter((p) => p.status !== 'void' && weekKey(new Date(p.kickoff)) === week);
  if (!mine.length) return null;
  const at = Math.max(...mine.map((p) => Date.parse(p.kickoff))) + SHARE_DELAY_MS;
  return at > now ? at : null;
}

