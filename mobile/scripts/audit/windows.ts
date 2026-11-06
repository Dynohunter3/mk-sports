/** Evaluation windows: the last two full seasons per competition (UTC ms, [from, to)). */
const d = (y: number, m: number, day = 1) => Date.UTC(y, m - 1, day);
const EU: [number, number] = [d(2024, 7), d(2026, 7)]; // 2024-25 and 2025-26
export const EVAL_WINDOWS: Record<string, [number, number]> = {
  'eng.1': EU, 'eng.2': EU, 'esp.1': EU, 'ita.1': EU, 'ger.1': EU, 'fra.1': EU, 'ned.1': EU, 'por.1': EU, 'tur.1': EU, 'ksa.1': EU,
  'uefa.champions': EU, 'uefa.europa': EU, 'uefa.europa.conf': EU, 'eng.fa': EU, 'eng.league_cup': EU, 'caf.champions': EU,
  'usa.1': [d(2024, 2), d(2026, 1)], // MLS 2024 and 2025
  'caf.nations': [d(2024, 1), d(2026, 2)], // AFCON 2023 (played Jan-Feb 2024) and AFCON 2025
  'fifa.worldq.caf': [d(2024, 1), d(2026, 1)],
  'fifa.world': [d(2026, 6), d(2026, 8)], // one tournament only (2026)
  nba: [d(2024, 10), d(2026, 7)], // 2024-25 and 2025-26
  nhl: [d(2024, 10), d(2026, 7)],
  nfl: [d(2024, 9), d(2026, 3)], // 2024 and 2025 seasons incl. playoffs
  mlb: [d(2025, 3), d(2026, 11)], // 2025 and 2026 seasons
};
