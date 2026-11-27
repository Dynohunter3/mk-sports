/** Competitions the on-device app covers, with their ids at each data source and their colours. */

/** Head-to-head team sports: fixtures with a home and an away side, predictions and the pick game. */
export type TeamSport = 'football' | 'basketball' | 'american-football' | 'ice-hockey' | 'baseball';
/** Sports shown with scores, schedules and standings (no head-to-head team model). */
export type OtherSport = 'tennis' | 'formula1' | 'cricket';
export type SportSlug = TeamSport;
export type AnySport = TeamSport | OtherSport;

/** Brand-inspired colours for a competition (approximations of each competition's identity). */
export type LeagueTheme = { primary: string; secondary: string; accent: string };

export type LeagueDef = {
  slug: string; // our id (== ESPN league slug)
  sport: AnySport;
  espnSport: 'soccer' | 'basketball' | 'football' | 'hockey' | 'baseball' | 'tennis' | 'racing' | 'cricket';
  /** 'match' = team v team fixtures through the full pipeline; the others have their own views. */
  format: 'match' | 'tennis' | 'racing' | 'cricket';
  name: string;
  shortName: string;
  country: string | null;
  region: string;
  kind: 'league' | 'cup' | 'tournament' | 'tour' | 'series';
  featured: boolean;
  theme: LeagueTheme;
  neutral?: boolean; // tournaments played at neutral venues
  clubelo?: string; // ClubElo country code for its fixture probabilities
  modelParams?: Record<string, number>;
  /** Days of results kept for ratings (default 365). */
  historyDays?: number;
  /** ESPN year pages hold up to 1000 events: whole-year requests are cheaper when a season fits. */
  yearly?: boolean;
  /** Whether ESPN publishes per-player season leaders for this competition. */
  leaders?: boolean;
};

const T = (primary: string, secondary: string, accent: string): LeagueTheme => ({ primary, secondary, accent });

export const LEAGUES: LeagueDef[] = [
  // ---------------------------------------------------------------- football
  { slug: 'eng.1', sport: 'football', espnSport: 'soccer', format: 'match', name: 'Premier League', shortName: 'Premier League', country: 'England', region: 'Europe', kind: 'league', featured: true, clubelo: 'ENG', theme: T('#3D195B', '#1A0630', '#00FF85'), yearly: true, leaders: true },
  { slug: 'esp.1', sport: 'football', espnSport: 'soccer', format: 'match', name: 'LaLiga', shortName: 'LaLiga', country: 'Spain', region: 'Europe', kind: 'league', featured: true, clubelo: 'ESP', theme: T('#E8312A', '#3A0B0A', '#FF4B44'), yearly: true, leaders: true },
  { slug: 'uefa.champions', sport: 'football', espnSport: 'soccer', format: 'match', name: 'UEFA Champions League', shortName: 'Champions League', country: null, region: 'Europe', kind: 'cup', featured: true, theme: T('#0A1F6B', '#040B2E', '#5AA2FF'), yearly: true, leaders: true },
  { slug: 'uefa.europa', sport: 'football', espnSport: 'soccer', format: 'match', name: 'UEFA Europa League', shortName: 'Europa League', country: null, region: 'Europe', kind: 'cup', featured: false, theme: T('#2A1606', '#0F0802', '#FF7A00'), yearly: true, leaders: true },
  { slug: 'uefa.europa.conf', sport: 'football', espnSport: 'soccer', format: 'match', name: 'UEFA Conference League', shortName: 'Conference League', country: null, region: 'Europe', kind: 'cup', featured: false, theme: T('#06331C', '#021209', '#33E06C'), yearly: true, leaders: true },
  { slug: 'ita.1', sport: 'football', espnSport: 'soccer', format: 'match', name: 'Serie A', shortName: 'Serie A', country: 'Italy', region: 'Europe', kind: 'league', featured: false, clubelo: 'ITA', theme: T('#0B2A66', '#06142F', '#2FB5E8'), yearly: true, leaders: true },
  {
    slug: 'ger.1', sport: 'football', espnSport: 'soccer', format: 'match', name: 'Bundesliga', shortName: 'Bundesliga', country: 'Germany', region: 'Europe', kind: 'league', featured: false, clubelo: 'GER', theme: T('#C8051A', '#3B0108', '#FF3347'), yearly: true, leaders: true,
    modelParams: { defaultHomeGoals: 1.7, defaultAwayGoals: 1.35 },
  },
  { slug: 'fra.1', sport: 'football', espnSport: 'soccer', format: 'match', name: 'Ligue 1', shortName: 'Ligue 1', country: 'France', region: 'Europe', kind: 'league', featured: false, clubelo: 'FRA', theme: T('#0E1E3F', '#070F22', '#DAE025'), yearly: true, leaders: true },
  { slug: 'ned.1', sport: 'football', espnSport: 'soccer', format: 'match', name: 'Eredivisie', shortName: 'Eredivisie', country: 'Netherlands', region: 'Europe', kind: 'league', featured: false, clubelo: 'NED', theme: T('#14213D', '#070E1C', '#FF5F1F'), yearly: true, leaders: true },
  { slug: 'por.1', sport: 'football', espnSport: 'soccer', format: 'match', name: 'Liga Portugal', shortName: 'Liga Portugal', country: 'Portugal', region: 'Europe', kind: 'league', featured: false, clubelo: 'POR', theme: T('#0B3B24', '#04170E', '#F2353E'), yearly: true, leaders: true },
  { slug: 'tur.1', sport: 'football', espnSport: 'soccer', format: 'match', name: 'Süper Lig', shortName: 'Süper Lig', country: 'Türkiye', region: 'Europe', kind: 'league', featured: false, clubelo: 'TUR', theme: T('#5C0A12', '#250408', '#FF3B4E'), yearly: true, leaders: true },
  { slug: 'ksa.1', sport: 'football', espnSport: 'soccer', format: 'match', name: 'Saudi Pro League', shortName: 'Saudi Pro League', country: 'Saudi Arabia', region: 'Asia', kind: 'league', featured: false, theme: T('#0B5D3B', '#03271A', '#D4AF37'), yearly: true, leaders: true },
  { slug: 'usa.1', sport: 'football', espnSport: 'soccer', format: 'match', name: 'Major League Soccer', shortName: 'MLS', country: 'USA / Canada', region: 'North America', kind: 'league', featured: false, theme: T('#0B1F3A', '#050E1C', '#E8344E'), yearly: true, leaders: true },
  { slug: 'eng.2', sport: 'football', espnSport: 'soccer', format: 'match', name: 'EFL Championship', shortName: 'Championship', country: 'England', region: 'Europe', kind: 'league', featured: false, theme: T('#1C2C6B', '#0A1233', '#00B2E3'), yearly: true, leaders: true },
  // added in 2.2: the published model covers these (pipeline Step 10); player leaders not enabled for them
  { slug: 'eng.3', sport: 'football', espnSport: 'soccer', format: 'match', name: 'EFL League One', shortName: 'League One', country: 'England', region: 'Europe', kind: 'league', featured: false, theme: T('#1B2A5A', '#0A1029', '#E4002B'), yearly: true },
  { slug: 'eng.4', sport: 'football', espnSport: 'soccer', format: 'match', name: 'EFL League Two', shortName: 'League Two', country: 'England', region: 'Europe', kind: 'league', featured: false, theme: T('#14324A', '#07141F', '#2BB673'), yearly: true },
  { slug: 'sco.1', sport: 'football', espnSport: 'soccer', format: 'match', name: 'Scottish Premiership', shortName: 'Scottish Prem', country: 'Scotland', region: 'Europe', kind: 'league', featured: false, theme: T('#33195E', '#140826', '#A78BFA'), yearly: true },
  { slug: 'ger.2', sport: 'football', espnSport: 'soccer', format: 'match', name: '2. Bundesliga', shortName: '2. Bundesliga', country: 'Germany', region: 'Europe', kind: 'league', featured: false, theme: T('#2A2A2A', '#0E0E0E', '#FF3347'), yearly: true },
  { slug: 'ita.2', sport: 'football', espnSport: 'soccer', format: 'match', name: 'Serie B', shortName: 'Serie B', country: 'Italy', region: 'Europe', kind: 'league', featured: false, theme: T('#0D3B66', '#05182A', '#7BC043'), yearly: true },
  { slug: 'esp.2', sport: 'football', espnSport: 'soccer', format: 'match', name: 'LaLiga 2', shortName: 'LaLiga 2', country: 'Spain', region: 'Europe', kind: 'league', featured: false, theme: T('#1A1446', '#0A0820', '#00E0B8'), yearly: true },
  { slug: 'fra.2', sport: 'football', espnSport: 'soccer', format: 'match', name: 'Ligue 2', shortName: 'Ligue 2', country: 'France', region: 'Europe', kind: 'league', featured: false, theme: T('#0B2545', '#041120', '#F2A900'), yearly: true },
  { slug: 'bel.1', sport: 'football', espnSport: 'soccer', format: 'match', name: 'Belgian Pro League', shortName: 'Pro League', country: 'Belgium', region: 'Europe', kind: 'league', featured: false, theme: T('#1A1A1A', '#0A0A0A', '#FFD100'), yearly: true },
  { slug: 'gre.1', sport: 'football', espnSport: 'soccer', format: 'match', name: 'Greek Super League', shortName: 'Super League GR', country: 'Greece', region: 'Europe', kind: 'league', featured: false, theme: T('#0D3C7A', '#05193A', '#4EA8FF'), yearly: true },
  { slug: 'eng.fa', sport: 'football', espnSport: 'soccer', format: 'match', name: 'FA Cup', shortName: 'FA Cup', country: 'England', region: 'Europe', kind: 'cup', featured: false, theme: T('#0B2A5B', '#061633', '#E4002B'), yearly: true, leaders: true },
  { slug: 'eng.league_cup', sport: 'football', espnSport: 'soccer', format: 'match', name: 'EFL Cup (Carabao Cup)', shortName: 'EFL Cup', country: 'England', region: 'Europe', kind: 'cup', featured: false, theme: T('#0B4F35', '#04261A', '#35E07A'), yearly: true, leaders: true },
  { slug: 'caf.champions', sport: 'football', espnSport: 'soccer', format: 'match', name: 'CAF Champions League', shortName: 'CAF CL', country: null, region: 'Africa', kind: 'cup', featured: true, theme: T('#0B5032', '#04261A', '#F2C21B'), yearly: true },
  { slug: 'caf.nations', sport: 'football', espnSport: 'soccer', format: 'match', name: 'Africa Cup of Nations', shortName: 'AFCON', country: null, region: 'Africa', kind: 'tournament', featured: false, neutral: true, theme: T('#0D5132', '#05261A', '#F7C600'), yearly: true },
  { slug: 'fifa.world', sport: 'football', espnSport: 'soccer', format: 'match', name: 'FIFA World Cup', shortName: 'World Cup', country: null, region: 'World', kind: 'tournament', featured: false, neutral: true, theme: T('#1C1C1E', '#0A0A0B', '#E6E6E6'), yearly: true },
  { slug: 'fifa.worldq.caf', sport: 'football', espnSport: 'soccer', format: 'match', name: 'World Cup Qualifying - Africa', shortName: 'WCQ Africa', country: null, region: 'Africa', kind: 'tournament', featured: false, theme: T('#14532D', '#072615', '#FACC15'), yearly: true },
  // ---------------------------------------------------------------- US team sports
  {
    slug: 'nba', sport: 'basketball', espnSport: 'basketball', format: 'match', name: 'NBA', shortName: 'NBA', country: 'USA', region: 'North America', kind: 'league', featured: true, theme: T('#1D428A', '#0A1A3D', '#E0313F'), leaders: true,
    // Step 12: opponent-adjusted ratings blended 70/30 with Elo + net rating; spread refitted (docs/audit/STEP12_US_SPORTS.md)
    modelParams: { homeCourtPts: 2.5, sigma: 10.81, defaultPoints: 114, ridgeWeight: 0.7, ridgeHalfLife: 60, ridgeLambda: 2, ridgeCap: 20, ridgePrevSeason: 1, ridgeBackToBack: 1 },
  },
  { slug: 'nfl', sport: 'american-football', espnSport: 'football', format: 'match', name: 'NFL', shortName: 'NFL', country: 'USA', region: 'North America', kind: 'league', featured: false, theme: T('#013369', '#00142B', '#E3242B'), historyDays: 730, yearly: true, leaders: true },
  { slug: 'nhl', sport: 'ice-hockey', espnSport: 'hockey', format: 'match', name: 'NHL', shortName: 'NHL', country: 'USA / Canada', region: 'North America', kind: 'league', featured: false, theme: T('#1B1F24', '#0A0C0F', '#C9D1D9'), leaders: true },
  { slug: 'mlb', sport: 'baseball', espnSport: 'baseball', format: 'match', name: 'Major League Baseball', shortName: 'MLB', country: 'USA', region: 'North America', kind: 'league', featured: false, theme: T('#041E42', '#010B1A', '#E0284F'), leaders: true },
  // ---------------------------------------------------------------- tennis, motorsport, cricket
  { slug: 'atp', sport: 'tennis', espnSport: 'tennis', format: 'tennis', name: 'ATP Tour', shortName: 'ATP', country: null, region: 'World', kind: 'tour', featured: false, theme: T('#002D72', '#00153A', '#00AEEF') },
  { slug: 'wta', sport: 'tennis', espnSport: 'tennis', format: 'tennis', name: 'WTA Tour', shortName: 'WTA', country: null, region: 'World', kind: 'tour', featured: false, theme: T('#4B1D82', '#220B3E', '#C08CFF') },
  { slug: 'f1', sport: 'formula1', espnSport: 'racing', format: 'racing', name: 'Formula 1', shortName: 'F1', country: null, region: 'World', kind: 'series', featured: false, theme: T('#15151E', '#08080C', '#E10600') },
  { slug: 'cricket', sport: 'cricket', espnSport: 'cricket', format: 'cricket', name: 'Cricket (all competitions)', shortName: 'Cricket', country: null, region: 'World', kind: 'series', featured: false, theme: T('#0E2A47', '#061526', '#2CC5F6') },
];

export const LEAGUE_BY_SLUG: Record<string, LeagueDef> = Object.fromEntries(LEAGUES.map((l) => [l.slug, l]));
/** Competitions that go through the fixtures / history / prediction pipeline. */
export const MATCH_LEAGUES = LEAGUES.filter((l) => l.format === 'match');
export const isTeamSport = (s: string): s is TeamSport => ['football', 'basketball', 'american-football', 'ice-hockey', 'baseball'].includes(s);

type Scoring = { result_points: number; exact_score_bonus: number; margin_bonus: number; margin_tolerance: number; max_points: number };
export type SportDef = {
  slug: AnySport;
  name: string;
  color: string;
  icon: string;
  hasDraws: boolean;
  scoreUnit: string;
  /** Highest score accepted in a pick (keeps typos out). */
  maxScore: number;
  /** Score picker: steppers for low-scoring sports, typed numbers for high-scoring ones. */
  stepper: boolean;
  tier: number;
  active: boolean;
  predictions: boolean;
  scoring: Scoring;
  periodName?: string;
};

const S = (result: number, exact: number, margin: number, tol: number): Scoring => ({ result_points: result, exact_score_bonus: exact, margin_bonus: margin, margin_tolerance: tol, max_points: result + exact + margin });

export const SPORTS: SportDef[] = [
  { slug: 'football', name: 'Football', color: '#22C55E', icon: 'soccer', hasDraws: true, scoreUnit: 'goals', maxScore: 15, stepper: true, tier: 1, active: true, predictions: true, scoring: S(3, 2, 0, 0), periodName: 'Half' },
  { slug: 'basketball', name: 'Basketball', color: '#F97316', icon: 'basketball', hasDraws: false, scoreUnit: 'points', maxScore: 200, stepper: false, tier: 1, active: true, predictions: true, scoring: S(3, 5, 1, 3), periodName: 'Q' },
  { slug: 'american-football', name: 'American Football', color: '#8B5CF6', icon: 'football', hasDraws: false, scoreUnit: 'points', maxScore: 99, stepper: false, tier: 2, active: true, predictions: true, scoring: S(3, 5, 1, 3), periodName: 'Q' },
  { slug: 'ice-hockey', name: 'Ice Hockey', color: '#38BDF8', icon: 'hockey-puck', hasDraws: false, scoreUnit: 'goals', maxScore: 15, stepper: true, tier: 2, active: true, predictions: true, scoring: S(3, 2, 0, 0), periodName: 'P' },
  { slug: 'baseball', name: 'Baseball', color: '#EF4444', icon: 'baseball', hasDraws: false, scoreUnit: 'runs', maxScore: 30, stepper: true, tier: 2, active: true, predictions: true, scoring: S(3, 2, 0, 0), periodName: 'Inning' },
  { slug: 'tennis', name: 'Tennis', color: '#EAB308', icon: 'tennis', hasDraws: false, scoreUnit: 'sets', maxScore: 5, stepper: true, tier: 1, active: true, predictions: false, scoring: S(3, 2, 0, 0) },
  { slug: 'formula1', name: 'Formula 1', color: '#E11D48', icon: 'flag-checkered', hasDraws: false, scoreUnit: 'positions', maxScore: 0, stepper: false, tier: 2, active: true, predictions: false, scoring: S(0, 0, 0, 0) },
  { slug: 'cricket', name: 'Cricket', color: '#3B82F6', icon: 'cricket', hasDraws: true, scoreUnit: 'runs', maxScore: 0, stepper: false, tier: 1, active: true, predictions: false, scoring: S(0, 0, 0, 0) },
];

export const sportOf = (slug: string) => SPORTS.find((s) => s.slug === slug);
export const leaguesOf = (sport: string) => LEAGUES.filter((l) => l.sport === sport);
