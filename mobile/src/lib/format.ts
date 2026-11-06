// Pure formatting helpers (no React Native imports, so they run under `node --test`).

export type OutcomeKey = 'home' | 'draw' | 'away';

const pad = (n: number) => String(n).padStart(2, '0');

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Local calendar date as YYYY-MM-DD. */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

export function kickoffTime(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function dayLabel(target: Date, now: Date = new Date()): string {
  const diff = Math.round((new Date(dateKey(target)).getTime() - new Date(dateKey(now)).getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return `${DAYS[target.getDay()]} ${target.getDate()} ${MONTHS[target.getMonth()]}`;
}

/** "in 2h 14m", "in 45s", "3d ago" */
export function relative(targetMs: number, nowMs: number = Date.now()): string {
  const diff = targetMs - nowMs;
  const abs = Math.abs(diff);
  const s = Math.floor(abs / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  let text: string;
  if (d >= 1) text = `${d}d${h % 24 ? ` ${h % 24}h` : ''}`;
  else if (h >= 1) text = `${h}h${m % 60 ? ` ${m % 60}m` : ''}`;
  else if (m >= 1) text = `${m}m`;
  else text = `${s}s`;
  return diff >= 0 ? `in ${text}` : `${text} ago`;
}

export function pct(x: number | null | undefined, digits = 0): string {
  if (x === null || x === undefined || Number.isNaN(x)) return '–';
  return `${(x * 100).toFixed(digits)}%`;
}

export function outcomeLabel(o: OutcomeKey, home: string, away: string): string {
  return o === 'home' ? home : o === 'away' ? away : 'Draw';
}

/** ISO country code -> flag emoji ("ZM" -> 🇿🇲). */
export function flag(code: string | null | undefined): string {
  if (!code || code.length !== 2) return '';
  return String.fromCodePoint(...code.toUpperCase().split('').map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Points the pick would earn, shown as a hint ("3 pts, +2 for exact score"). */
export function rulesText(r: { result_points: number; exact_score_bonus: number; margin_bonus: number; margin_tolerance: number }, hasDraws: boolean): string {
  const parts = [`${r.result_points} pts for the correct ${hasDraws ? 'result' : 'winner'}`];
  if (r.exact_score_bonus) parts.push(`+${r.exact_score_bonus} for the exact score`);
  if (r.margin_bonus) parts.push(`or +${r.margin_bonus} if your margin is within ${r.margin_tolerance}`);
  return parts.join(', ');
}

export function clampScore(n: number, max: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(max, Math.round(n)));
}
