/**
 * Back up and restore everything that matters on this phone: the game (profile, picks, points, badges), private
 * leagues and settings. The backup is a JSON file the player saves wherever they like (Drive, email, a chat).
 * Caches (results history, predictions, photos) are not included: they download again.
 */
import * as game from './game';
import * as pleagues from './pleagues';

export type Backup = { app: 'mk-sports'; v: 2; exported_at: string; game: game.State; leagues: pleagues.League[]; prefs: Record<string, unknown> | null };

/** `prefs`: the app's settings (the caller has them from the settings context). */
export async function makeBackup(prefs: Record<string, unknown> | null): Promise<Backup> {
  const st = await game.loadGame();
  return {
    app: 'mk-sports',
    v: 2,
    exported_at: new Date().toISOString(),
    game: JSON.parse(JSON.stringify(st)),
    leagues: await pleagues.leagues(),
    prefs: prefs ? JSON.parse(JSON.stringify(prefs)) : null,
  };
}

export class BackupError extends Error {}

/** Accepts this format and the 2.1 export ({ profile, picks: [...], badges }). Throws BackupError with a readable message. */
export function parseBackup(text: string): Backup {
  let d: any;
  try {
    d = JSON.parse(text);
  } catch {
    throw new BackupError("That file isn't an MK Sports backup (it isn't JSON).");
  }
  if (d?.app === 'mk-sports' && d?.v === 2 && d?.game?.profile && typeof d.game.picks === 'object') {
    return { app: 'mk-sports', v: 2, exported_at: String(d.exported_at ?? ''), game: d.game, leagues: Array.isArray(d.leagues) ? d.leagues : [], prefs: d.prefs && typeof d.prefs === 'object' ? d.prefs : null };
  }
  if (d?.profile && Array.isArray(d?.picks)) {
    // version 2.1 export: picks as a list, no leagues or settings
    const picks = Object.fromEntries(d.picks.filter((p: any) => p?.matchId).map((p: any) => [p.matchId, p]));
    return { app: 'mk-sports', v: 2, exported_at: String(d.exported_at ?? ''), game: { profile: d.profile, picks, badges: d.badges ?? {}, seen: {} }, leagues: [], prefs: null };
  }
  throw new BackupError("That file isn't an MK Sports backup.");
}

export function summary(b: Backup) {
  const picks = Object.values(b.game.picks ?? {});
  return { picks: picks.length, settled: picks.filter((p) => p.status === 'won' || p.status === 'lost').length, leagues: b.leagues.length, settings: !!b.prefs, date: b.exported_at };
}

/** Replace this phone's game, leagues and (if the backup has them) settings. Returns the settings to apply. */
export async function restoreBackup(b: Backup): Promise<Record<string, unknown> | null> {
  await game.replaceGame(b.game);
  await pleagues.replaceAll(b.leagues);
  return b.prefs;
}
