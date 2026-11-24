// Mirrors backend/app/schemas.py (kept by hand; the API also serves OpenAPI at /docs).
// Device-mode additions (match centre, players, leaders, news, other sports) are served by src/data/localApi.ts.

export type Outcome = 'home' | 'draw' | 'away';
export type Confidence = 'low' | 'medium' | 'high';
export type MatchStatus = 'scheduled' | 'live' | 'finished' | 'postponed' | 'cancelled';

export type ScoringRules = {
  result_points: number;
  exact_score_bonus: number;
  margin_bonus: number;
  margin_tolerance: number;
  max_points: number;
};

export type Sport = {
  id: string;
  slug: string;
  name: string;
  color: string;
  icon: string;
  has_draws: boolean;
  score_unit: string;
  tier: number;
  is_active: boolean;
  scoring: ScoringRules;
  phase?: number | null;
  predictions?: boolean;
  max_score?: number;
  stepper?: boolean;
};

export type League = {
  id: string;
  slug: string;
  sport: string;
  name: string;
  short_name: string;
  country: string | null;
  region: string | null;
  kind: string;
  is_featured: boolean;
  is_active: boolean;
  season: string | null;
  upcoming?: number;
  live?: number;
  color?: string;
  format?: 'match' | 'tennis' | 'racing' | 'cricket';
  theme?: { primary: string; secondary: string; accent: string };
  has_leaders?: boolean;
};

export type TeamMini = { id: string; name: string; short_name: string; code: string; color: string; logo?: string | null };
export type Team = TeamMini & { sport: string; country: string | null; venue_name: string | null; venue_city: string | null; elo: number | null; form: string | null; leagues?: string[] };

export type CallTier = 'strong' | 'likely' | 'lean' | 'toss-up';
export type PredictionMini = { home: number; draw: number | null; away: number; score: [number, number]; confidence: Confidence; pick: Outcome; tier?: CallTier; safer?: string; safer_p?: number; source?: 'model' | 'device'; draw_note?: boolean };

export type MyPick = { pick: Outcome; home_score: number | null; away_score: number | null; status: 'pending' | 'won' | 'lost' | 'void'; points: number };

export type MatchCard = {
  id: string;
  sport: string;
  league: { id: string; slug: string; short_name: string };
  start_time: string;
  status: MatchStatus;
  clock: string | null;
  round: string | null;
  home: TeamMini;
  away: TeamMini;
  home_score: number | null;
  away_score: number | null;
  prediction: PredictionMini | null;
  my_pick: MyPick | null;
  locked: boolean;
  /** A published prediction listed while its fixture can't be loaded (no match page). */
  offline?: boolean;
  /** Scorers, when the source lists them on the scoreboard. */
  goals?: { side: 'home' | 'away'; player: string | null; clock: string | null; type: string }[];
};

export type MatchPage = { items: MatchCard[]; next_cursor: string | null };

export type GradedCall = {
  match_id: string; competition: string; kickoff: string; home: string; away: string; score: string; pick: Outcome; probability: number;
  correct: number; tier?: CallTier | null; safer_call?: string | null; safer_correct?: number | null; over25_correct?: number | null;
};
export type RecordWindow = { matches: { n: number; hit_rate: number | null }; safer_call: { n: number; hit_rate: number | null }; strong: { n: number; hit_rate: number | null } };
export type ModelRecord = { last_7_days: RecordWindow | null; last_30_days: RecordWindow | null; graded: number; generated_at: string | null };

export type PredictionsList = {
  days: number;
  offline: boolean;
  results: { record: ModelRecord; items: GradedCall[] };
  items: MatchCard[];
  leagues: { slug: string; short_name: string; n: number }[];
  model: { version: string; generated_at: string; source: 'none' | 'network' | 'saved' | 'bundled' } | null;
  track: {
    model: { tiers: Partial<Record<CallTier, number | null>>; draw_calls: number | null; draw_base_rate: number; safer: number; safer_strong: number; draw_note: number } | null;
    device: { tiers: Record<CallTier, number>; safer: number; draw_note: number };
  };
  unavailable: string[];
};

export type KeyFactor = { text: string; impact: number; favours: 'home' | 'away' | 'neutral'; category: string };

export type PredictionFull = {
  version: number;
  created_at: string;
  trigger: string;
  model: string;
  model_version: string;
  probabilities: Partial<Record<Outcome, number>>;
  predicted_score: [number, number];
  expected: [number, number];
  confidence: Confidence;
  key_factors: KeyFactor[];
  explanation: { method: string; summary: string; steps: { title: string; detail: string }[]; inputs: Record<string, unknown> };
  call?: {
    tier: CallTier;
    tier_label: string;
    tier_hit_rate: number | null;
    draw_call: boolean;
    safer: { label: string; pair: 'home or draw' | 'away or draw' | 'home or away'; probability: number; hit_rate: number | null };
    source: 'model' | 'device';
    made_on?: string;
    draw_note?: string;
    movement?: { from: { home: number; draw: number; away: number }; from_pick: Outcome | null; at: string; reason: string };
  };
  goals?: { over25: number; btts: number | null };
  versions: number;
  correct: boolean | null;
  /** Each independent forecast and its weight in the blend (device mode). */
  sources?: { source: string; label: string; description: string; probs: Partial<Record<Outcome, number>>; weight: number }[];
};

export type FormGame = { match_id: string; date: string; opponent: string; home: boolean; score: string; result: 'W' | 'D' | 'L' };
export type Injury = { player: string; position: string; status: string; detail: string | null; importance: number };
export type StandingRow = {
  position: number;
  group?: string | null;
  team: TeamMini;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  points_for: number;
  points_against: number;
  points: number;
  form: string;
  ot_losses?: number | null;
  win_pct?: number | null;
  games_behind?: string | null;
  streak?: string | null;
  note?: string | null;
};

export type MatchDetail = MatchCard & {
  venue: string | null;
  neutral: boolean;
  score_detail: { half_time?: [number, number]; quarters?: [number, number][] };
  events: { type: string; minute: number | null; clock: string | null; side: 'home' | 'away'; player: string | null }[];
  prediction_full: PredictionFull | null;
  form: { home: FormGame[]; away: FormGame[] };
  head_to_head: FormGame[];
  standings: StandingRow[];
  injuries: { home: Injury[]; away: Injury[] };
  /** false when the source publishes no team news for this match (absence of data, not of injuries) */
  injuries_available?: boolean;
  league_name?: string;
  attendance?: number | null;
  ratings: { home: Record<string, number | string | null> | null; away: Record<string, number | string | null> | null };
  scoring: ScoringRules;
  has_draws: boolean;
  score_unit: string;
};

export type FeedSection = { key: string; title: string; items: MatchCard[] };
export type Feed = { personalised: boolean; open_picks: number; sections: FeedSection[]; predictions_loading?: boolean; unavailable?: string[] };

export type LeaderboardRow = {
  rank: number;
  user_id: string;
  display_name: string;
  country: string | null;
  points: number;
  picks: number;
  correct: number;
  exact: number;
  is_me: boolean;
};
export type Leaderboard = { scope: string; period: 'week' | 'season' | 'all'; period_key: string; total: number; items: LeaderboardRow[]; me: LeaderboardRow | null };

export type Badge = { slug: string; name: string; description: string; icon: string; awarded_at: string | null };

export type Me = {
  id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  country: string | null;
  auth_provider: string;
  consented: boolean;
  marketing_opt_in: boolean;
  onboarded: boolean;
  notification_prefs: Record<string, boolean>;
  favourites: { sports: string[]; leagues: string[]; teams: string[] };
  stats: {
    total_points: number;
    picks_settled: number;
    picks_correct: number;
    exact_scores: number;
    accuracy: number | null;
    current_streak: number;
    best_streak: number;
    pending_picks: number;
    global_rank_season: number | null;
  };
  badges: Badge[];
  created_at: string;
};

export type PickResult = {
  match_id: string;
  pick: Outcome;
  home_score: number | null;
  away_score: number | null;
  status: string;
  points: number;
  locks_at: string;
  new_badges: string[];
};

export type PickHistory = { items: { match: MatchCard; pick: MyPick; created_at: string }[]; next_cursor: string | null };

export type AccuracyRow = {
  key: string;
  name: string;
  sport: string;
  n: number;
  correct: number;
  hit_rate: number | null;
  brier: number | null;
  log_loss: number | null;
  by_confidence: Partial<Record<Confidence, { n: number; hit_rate: number }>>;
};
export type Accuracy = {
  source: string;
  updated_at: string;
  overall: AccuracyRow;
  sports: AccuracyRow[];
  leagues: AccuracyRow[];
  recent: { match_id: string; home: string; away: string; score: string; predicted: Outcome; probability: number; correct: boolean; confidence: Confidence }[];
  baseline_note: string;
  by_source?: { source: string; kind: string; label: string; n: number; hit_rate: number; brier: number; log_loss: number }[];
  football_backtest?: { key: string; name: string; n: number; new_log_loss: number; previous_log_loss: number | null; bookmaker_log_loss: number | null }[];
  football_note?: string | null;
  football_track?: {
    tiers: Partial<Record<CallTier, { n: number; hit_rate: number; share: number }>>;
    draw_calls: { n: number; hit_rate: number; share: number; base_rate: number };
    all_matches: { n: number; hit_rate: number };
    bookmaker: { n: number; hit_rate: number };
    double_chance: { n: number; hit_rate: number; strong: { n: number; hit_rate: number; share: number } };
    draw_note?: { min_draw: number; n: number; share: number; ended_level: number };
    over25?: { n: number; hit_rate: number; confident: { n: number; hit_rate: number; share: number } };
    btts?: { n: number; hit_rate: number; confident: { n: number; hit_rate: number; share: number } };
  } | null;
  source_evidence?: Record<string, Record<string, { n: number; delta: number }>>;
};

export type LocalPoints = { current_week: string; season: string; season_points: number; weeks: { key: string; points: number; picks: number; correct: number; exact: number }[] };

export type Meta = { disclaimer: string; free_to_play: boolean; shows_odds: boolean; age_gate_required: boolean };

// ------------------------------------------------------------------ match centre
export type LineupPlayer = {
  id: string;
  name: string;
  short: string;
  jersey: string | null;
  position: string;
  positionName: string | null;
  place: number;
  starter: boolean;
  headshot: string | null;
  subbedIn: string | null;
  subbedOut: string | null;
  goals: number;
  assists: number;
  ownGoals: number;
  yellow: boolean;
  red: boolean;
  stats: Record<string, number>;
};
export type Lineup = { side: 'home' | 'away'; teamId: string; formation: string | null; rows: LineupPlayer[][]; bench: LineupPlayer[]; color: string | null };
export type TeamStat = { key: string; label: string; home: string; away: string; homeValue: number | null; awayValue: number | null; percent?: boolean; note?: string };
export type TimelineItem = { minute: string; type: string; side: 'home' | 'away' | null; player: string | null; detail: string | null; text: string };
export type Shot = { side: 'home' | 'away'; x: number | null; y: number | null; penalty: boolean; goal: boolean; minute: string | null; player: string | null; type: string };
export type MatchCentre = {
  match_id: string;
  sport: string;
  status: MatchStatus;
  clock: string | null;
  home: TeamMini;
  away: TeamMini;
  home_score: number | null;
  away_score: number | null;
  lineups: { home: Lineup; away: Lineup } | null;
  stats: TeamStat[];
  xg: { home: number; away: number; shots: number; located: number } | null;
  xg_model: { shots: number; matches: number };
  shots: Shot[];
  timeline: TimelineItem[];
  commentary: { minute: string; text: string }[];
  performers: { side: 'home' | 'away'; category: string; player: string; value: string; headshot: string | null; id: string | null }[];
  referee: string | null;
};

export type PlayerPage = {
  id: string;
  name: string;
  position: string | null;
  jersey: string | null;
  age: number | null;
  nationality: string | null;
  flag: string | null;
  height: string | null;
  team: { id: string; espnId: string; name: string; logo: string | null } | null;
  headshot: string | null;
  season: { competition: string; labels: string[]; names: string[]; values: string[] }[];
  summary: { label: string; value: string }[];
  recent: { eventId: string; date: string; opponent: string; opponentLogo: string | null; home: boolean; score: string; result: string | null; competition: string; stats: { label: string; value: string }[] }[];
  this_match: LineupPlayer | null;
  league: string;
};

// ------------------------------------------------------------------ stats, news, teams
export type LeaderCategory = { key: string; label: string; team_stat: boolean; rows: { rank: number; athlete_id: string | null; name: string; position: string | null; headshot: string | null; team: TeamMini | null; value: string }[] };
export type Leaders = { league: string; season: string | null; categories: LeaderCategory[] };

export type Article = { id: string; headline: string; description: string | null; published: string; image: string | null; url: string | null; byline: string | null; league: string; teamIds: string[]; type: string; my_team?: boolean };
export type NewsFeed = { items: Article[]; my_team: Article[] };

export type SquadPlayer = { id: string; name: string; jersey: string | null; position: string | null; age: number | null; nationality: string | null; headshot: string | null };
export type TeamHub = {
  team: TeamMini;
  sport: string;
  league: League;
  leagues: League[];
  standing: StandingRow | null;
  table: StandingRow[];
  upcoming: MatchCard[];
  recent: MatchCard[];
  form: string;
  elo: number | null;
  news: Article[];
  leaders: LeaderCategory[];
  squad: SquadPlayer[];
};

// ------------------------------------------------------------------ tennis, F1, cricket
export type TennisPlayer = { id: string | null; name: string; short: string; flag: string | null; seed: string | null; winner: boolean; sets: (number | null)[]; tiebreaks: (number | null)[] };
export type TennisMatch = { id: string; tournament: string; draw: string; round: string | null; start: string; state: 'pre' | 'in' | 'post'; status: string; court: string | null; players: [TennisPlayer, TennisPlayer] };
export type TennisBoard = { tournaments: { id: string; name: string; start: string; end: string | null; venue: string | null; major: boolean }[]; matches: TennisMatch[] };
export type RankRow = { rank: number; previous: number | null; points: number | null; name: string; flag: string | null; id: string | null; trend: string | null };
export type RaceWeekend = { id: string; name: string; start: string; end: string | null; circuit: string | null; city: string | null; sessions: { name: string; start: string; state: 'pre' | 'in' | 'post'; results: { pos: number; driver: string; flag: string | null; winner: boolean }[] }[] };
export type F1Board = { current: RaceWeekend[]; calendar: { name: string; start: string; end: string | null }[] };
export type F1Standing = { rank: number; name: string; flag: string | null; points: number; color: string | null };
export type CricketMatch = { id: string; competition: string; description: string | null; format: string | null; start: string; state: 'pre' | 'in' | 'post'; status: string; venue: string | null; teams: { name: string; abbr: string; logo: string | null; score: string; winner: boolean }[] };
