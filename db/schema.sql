-- PredictPro database schema (PostgreSQL 16), generated from the Alembic migrations with
--   pg_dump --schema-only --no-owner --no-privileges
-- Source of truth: backend/app/models.py and backend/migrations/. Regenerate after schema changes.

CREATE TABLE public.alembic_version (
    version_num character varying(32) NOT NULL
);

CREATE TABLE public.app_state (
    key character varying(60) NOT NULL,
    value jsonb NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.badges (
    id integer NOT NULL,
    slug character varying(40) NOT NULL,
    name character varying(60) NOT NULL,
    description character varying(200) NOT NULL,
    icon character varying(40) NOT NULL,
    sort_order integer NOT NULL
);

CREATE SEQUENCE public.badges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.badges_id_seq OWNED BY public.badges.id;

CREATE TABLE public.device_tokens (
    id integer NOT NULL,
    user_id character varying(36) NOT NULL,
    token character varying(300) NOT NULL,
    platform character varying(10) NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE SEQUENCE public.device_tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.device_tokens_id_seq OWNED BY public.device_tokens.id;

CREATE TABLE public.external_refs (
    id integer NOT NULL,
    provider character varying(30) NOT NULL,
    entity character varying(20) NOT NULL,
    external_id character varying(80) NOT NULL,
    internal_id integer NOT NULL
);

CREATE SEQUENCE public.external_refs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.external_refs_id_seq OWNED BY public.external_refs.id;

CREATE TABLE public.friendships (
    user_id character varying(36) NOT NULL,
    friend_id character varying(36) NOT NULL,
    status character varying(10) NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.job_runs (
    id integer NOT NULL,
    name character varying(40) NOT NULL,
    started_at timestamp with time zone NOT NULL,
    finished_at timestamp with time zone,
    status character varying(10) NOT NULL,
    detail jsonb NOT NULL
);

CREATE SEQUENCE public.job_runs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.job_runs_id_seq OWNED BY public.job_runs.id;

CREATE TABLE public.leaderboard_entries (
    id integer NOT NULL,
    scope character varying(10) NOT NULL,
    scope_id integer NOT NULL,
    period character varying(10) NOT NULL,
    period_key character varying(10) NOT NULL,
    user_id character varying(36) NOT NULL,
    points integer NOT NULL,
    picks integer NOT NULL,
    correct integer NOT NULL,
    exact integer NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE SEQUENCE public.leaderboard_entries_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.leaderboard_entries_id_seq OWNED BY public.leaderboard_entries.id;

CREATE TABLE public.leagues (
    id integer NOT NULL,
    sport_id integer NOT NULL,
    slug character varying(60) NOT NULL,
    name character varying(120) NOT NULL,
    short_name character varying(40) NOT NULL,
    country character varying(60),
    region character varying(40),
    kind character varying(20) NOT NULL,
    tier integer NOT NULL,
    is_active boolean NOT NULL,
    is_featured boolean NOT NULL,
    sort_order integer NOT NULL,
    model_params jsonb NOT NULL,
    provider_refs jsonb NOT NULL,
    config jsonb NOT NULL
);

CREATE SEQUENCE public.leagues_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.leagues_id_seq OWNED BY public.leagues.id;

CREATE TABLE public.match_events (
    id integer NOT NULL,
    match_id integer NOT NULL,
    ext_id character varying(80) NOT NULL,
    type character varying(30) NOT NULL,
    minute integer,
    clock character varying(20),
    team_id integer,
    player_name character varying(120),
    detail jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE SEQUENCE public.match_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.match_events_id_seq OWNED BY public.match_events.id;

CREATE TABLE public.matches (
    id integer NOT NULL,
    sport_id integer NOT NULL,
    league_id integer NOT NULL,
    season_id integer,
    home_team_id integer NOT NULL,
    away_team_id integer NOT NULL,
    start_time timestamp with time zone NOT NULL,
    status character varying(20) NOT NULL,
    clock character varying(20),
    home_score integer,
    away_score integer,
    score_detail jsonb NOT NULL,
    round character varying(40),
    venue character varying(120),
    neutral boolean NOT NULL,
    provider character varying(30) NOT NULL,
    provider_ref character varying(120) NOT NULL,
    finished_at timestamp with time zone,
    settled_at timestamp with time zone,
    updated_at timestamp with time zone NOT NULL
);

CREATE SEQUENCE public.matches_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.matches_id_seq OWNED BY public.matches.id;

CREATE TABLE public.notifications (
    id integer NOT NULL,
    user_id character varying(36) NOT NULL,
    type character varying(30) NOT NULL,
    title character varying(120) NOT NULL,
    body text NOT NULL,
    data jsonb NOT NULL,
    dedupe_key character varying(120),
    scheduled_for timestamp with time zone,
    sent_at timestamp with time zone,
    read_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL
);

CREATE SEQUENCE public.notifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.notifications_id_seq OWNED BY public.notifications.id;

CREATE TABLE public.players (
    id integer NOT NULL,
    team_id integer NOT NULL,
    name character varying(120) NOT NULL,
    "position" character varying(10) NOT NULL,
    shirt_number integer,
    importance double precision NOT NULL,
    tag character varying(20),
    status character varying(20) NOT NULL,
    status_detail character varying(120),
    status_updated_at timestamp with time zone
);

CREATE SEQUENCE public.players_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.players_id_seq OWNED BY public.players.id;

CREATE TABLE public.predictions (
    id integer NOT NULL,
    match_id integer NOT NULL,
    version integer NOT NULL,
    is_current boolean NOT NULL,
    model_name character varying(60) NOT NULL,
    model_version character varying(20) NOT NULL,
    trigger character varying(30) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    prob_home double precision NOT NULL,
    prob_draw double precision,
    prob_away double precision NOT NULL,
    predicted_home integer NOT NULL,
    predicted_away integer NOT NULL,
    expected_home double precision NOT NULL,
    expected_away double precision NOT NULL,
    confidence character varying(10) NOT NULL,
    key_factors jsonb NOT NULL,
    explanation jsonb NOT NULL,
    input_hash character varying(40) NOT NULL,
    outcome_correct boolean,
    brier double precision,
    log_loss double precision,
    evaluated_at timestamp with time zone
);

CREATE SEQUENCE public.predictions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.predictions_id_seq OWNED BY public.predictions.id;

CREATE TABLE public.private_league_members (
    league_id integer NOT NULL,
    user_id character varying(36) NOT NULL,
    role character varying(10) NOT NULL,
    joined_at timestamp with time zone NOT NULL
);

CREATE TABLE public.private_leagues (
    id integer NOT NULL,
    name character varying(60) NOT NULL,
    invite_code character varying(12) NOT NULL,
    owner_id character varying(36) NOT NULL,
    sport_id integer,
    created_at timestamp with time zone NOT NULL
);

CREATE SEQUENCE public.private_leagues_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.private_leagues_id_seq OWNED BY public.private_leagues.id;

CREATE TABLE public.seasons (
    id integer NOT NULL,
    league_id integer NOT NULL,
    name character varying(20) NOT NULL,
    start_date timestamp with time zone,
    end_date timestamp with time zone,
    is_current boolean NOT NULL
);

CREATE SEQUENCE public.seasons_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.seasons_id_seq OWNED BY public.seasons.id;

CREATE TABLE public.sports (
    id integer NOT NULL,
    slug character varying(40) NOT NULL,
    name character varying(80) NOT NULL,
    color character varying(9) NOT NULL,
    icon character varying(40) NOT NULL,
    has_draws boolean NOT NULL,
    score_unit character varying(20) NOT NULL,
    tier integer NOT NULL,
    is_active boolean NOT NULL,
    sort_order integer NOT NULL,
    model_params jsonb NOT NULL,
    scoring_rules jsonb NOT NULL,
    config jsonb NOT NULL
);

CREATE SEQUENCE public.sports_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.sports_id_seq OWNED BY public.sports.id;

CREATE TABLE public.standings (
    id integer NOT NULL,
    league_id integer NOT NULL,
    season_id integer,
    team_id integer NOT NULL,
    "position" integer NOT NULL,
    played integer NOT NULL,
    won integer NOT NULL,
    drawn integer NOT NULL,
    lost integer NOT NULL,
    points_for integer NOT NULL,
    points_against integer NOT NULL,
    points integer NOT NULL,
    form character varying(10) NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE SEQUENCE public.standings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.standings_id_seq OWNED BY public.standings.id;

CREATE TABLE public.team_ratings (
    team_id integer NOT NULL,
    sport_id integer NOT NULL,
    elo double precision NOT NULL,
    attack double precision,
    defence double precision,
    points_for double precision,
    points_against double precision,
    games integer NOT NULL,
    form character varying(10) NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.teams (
    id integer NOT NULL,
    sport_id integer NOT NULL,
    name character varying(120) NOT NULL,
    short_name character varying(40) NOT NULL,
    code character varying(6) NOT NULL,
    country character varying(60),
    color character varying(9) NOT NULL,
    logo_url character varying(300),
    venue_name character varying(120),
    venue_city character varying(80),
    created_at timestamp with time zone NOT NULL
);

CREATE SEQUENCE public.teams_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.teams_id_seq OWNED BY public.teams.id;

CREATE TABLE public.user_badges (
    user_id character varying(36) NOT NULL,
    badge_id integer NOT NULL,
    awarded_at timestamp with time zone NOT NULL
);

CREATE TABLE public.user_favourites (
    id integer NOT NULL,
    user_id character varying(36) NOT NULL,
    kind character varying(10) NOT NULL,
    ref_id integer NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE SEQUENCE public.user_favourites_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.user_favourites_id_seq OWNED BY public.user_favourites.id;

CREATE TABLE public.user_picks (
    id integer NOT NULL,
    user_id character varying(36) NOT NULL,
    match_id integer NOT NULL,
    pick character varying(5) NOT NULL,
    home_score integer,
    away_score integer,
    status character varying(10) NOT NULL,
    points integer NOT NULL,
    result_correct boolean,
    exact_score boolean NOT NULL,
    week_key character varying(10) NOT NULL,
    season_key character varying(10) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    settled_at timestamp with time zone
);

CREATE SEQUENCE public.user_picks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.user_picks_id_seq OWNED BY public.user_picks.id;

CREATE TABLE public.users (
    id character varying(36) NOT NULL,
    auth_provider character varying(20) NOT NULL,
    auth_subject character varying(120) NOT NULL,
    email character varying(200),
    phone character varying(30),
    password_hash character varying(200),
    display_name character varying(60) NOT NULL,
    country character varying(2),
    is_admin boolean NOT NULL,
    is_demo boolean NOT NULL,
    terms_accepted_at timestamp with time zone,
    privacy_accepted_at timestamp with time zone,
    marketing_opt_in boolean NOT NULL,
    onboarded_at timestamp with time zone,
    notification_prefs jsonb NOT NULL,
    total_points integer NOT NULL,
    picks_settled integer NOT NULL,
    picks_correct integer NOT NULL,
    exact_scores integer NOT NULL,
    current_streak integer NOT NULL,
    best_streak integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

ALTER TABLE ONLY public.badges ALTER COLUMN id SET DEFAULT nextval('public.badges_id_seq'::regclass);

ALTER TABLE ONLY public.device_tokens ALTER COLUMN id SET DEFAULT nextval('public.device_tokens_id_seq'::regclass);

ALTER TABLE ONLY public.external_refs ALTER COLUMN id SET DEFAULT nextval('public.external_refs_id_seq'::regclass);

ALTER TABLE ONLY public.job_runs ALTER COLUMN id SET DEFAULT nextval('public.job_runs_id_seq'::regclass);

ALTER TABLE ONLY public.leaderboard_entries ALTER COLUMN id SET DEFAULT nextval('public.leaderboard_entries_id_seq'::regclass);

ALTER TABLE ONLY public.leagues ALTER COLUMN id SET DEFAULT nextval('public.leagues_id_seq'::regclass);

ALTER TABLE ONLY public.match_events ALTER COLUMN id SET DEFAULT nextval('public.match_events_id_seq'::regclass);

ALTER TABLE ONLY public.matches ALTER COLUMN id SET DEFAULT nextval('public.matches_id_seq'::regclass);

ALTER TABLE ONLY public.notifications ALTER COLUMN id SET DEFAULT nextval('public.notifications_id_seq'::regclass);

ALTER TABLE ONLY public.players ALTER COLUMN id SET DEFAULT nextval('public.players_id_seq'::regclass);

ALTER TABLE ONLY public.predictions ALTER COLUMN id SET DEFAULT nextval('public.predictions_id_seq'::regclass);

ALTER TABLE ONLY public.private_leagues ALTER COLUMN id SET DEFAULT nextval('public.private_leagues_id_seq'::regclass);

ALTER TABLE ONLY public.seasons ALTER COLUMN id SET DEFAULT nextval('public.seasons_id_seq'::regclass);

ALTER TABLE ONLY public.sports ALTER COLUMN id SET DEFAULT nextval('public.sports_id_seq'::regclass);

ALTER TABLE ONLY public.standings ALTER COLUMN id SET DEFAULT nextval('public.standings_id_seq'::regclass);

ALTER TABLE ONLY public.teams ALTER COLUMN id SET DEFAULT nextval('public.teams_id_seq'::regclass);

ALTER TABLE ONLY public.user_favourites ALTER COLUMN id SET DEFAULT nextval('public.user_favourites_id_seq'::regclass);

ALTER TABLE ONLY public.user_picks ALTER COLUMN id SET DEFAULT nextval('public.user_picks_id_seq'::regclass);

ALTER TABLE ONLY public.alembic_version
    ADD CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num);

ALTER TABLE ONLY public.app_state
    ADD CONSTRAINT app_state_pkey PRIMARY KEY (key);

ALTER TABLE ONLY public.badges
    ADD CONSTRAINT badges_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.badges
    ADD CONSTRAINT badges_slug_key UNIQUE (slug);

ALTER TABLE ONLY public.device_tokens
    ADD CONSTRAINT device_tokens_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.device_tokens
    ADD CONSTRAINT device_tokens_token_key UNIQUE (token);

ALTER TABLE ONLY public.external_refs
    ADD CONSTRAINT external_refs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.external_refs
    ADD CONSTRAINT external_refs_provider_entity_external_id_key UNIQUE (provider, entity, external_id);

ALTER TABLE ONLY public.friendships
    ADD CONSTRAINT friendships_pkey PRIMARY KEY (user_id, friend_id);

ALTER TABLE ONLY public.job_runs
    ADD CONSTRAINT job_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.leaderboard_entries
    ADD CONSTRAINT leaderboard_entries_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.leaderboard_entries
    ADD CONSTRAINT leaderboard_entries_scope_scope_id_period_period_key_user_i_key UNIQUE (scope, scope_id, period, period_key, user_id);

ALTER TABLE ONLY public.leagues
    ADD CONSTRAINT leagues_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.leagues
    ADD CONSTRAINT leagues_slug_key UNIQUE (slug);

ALTER TABLE ONLY public.match_events
    ADD CONSTRAINT match_events_match_id_ext_id_key UNIQUE (match_id, ext_id);

ALTER TABLE ONLY public.match_events
    ADD CONSTRAINT match_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_provider_provider_ref_key UNIQUE (provider, provider_ref);

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_dedupe_key_key UNIQUE (dedupe_key);

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.players
    ADD CONSTRAINT players_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.predictions
    ADD CONSTRAINT predictions_match_id_version_key UNIQUE (match_id, version);

ALTER TABLE ONLY public.predictions
    ADD CONSTRAINT predictions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.private_league_members
    ADD CONSTRAINT private_league_members_pkey PRIMARY KEY (league_id, user_id);

ALTER TABLE ONLY public.private_leagues
    ADD CONSTRAINT private_leagues_invite_code_key UNIQUE (invite_code);

ALTER TABLE ONLY public.private_leagues
    ADD CONSTRAINT private_leagues_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.seasons
    ADD CONSTRAINT seasons_league_id_name_key UNIQUE (league_id, name);

ALTER TABLE ONLY public.seasons
    ADD CONSTRAINT seasons_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sports
    ADD CONSTRAINT sports_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sports
    ADD CONSTRAINT sports_slug_key UNIQUE (slug);

ALTER TABLE ONLY public.standings
    ADD CONSTRAINT standings_league_id_season_id_team_id_key UNIQUE (league_id, season_id, team_id);

ALTER TABLE ONLY public.standings
    ADD CONSTRAINT standings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.team_ratings
    ADD CONSTRAINT team_ratings_pkey PRIMARY KEY (team_id);

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_badges
    ADD CONSTRAINT user_badges_pkey PRIMARY KEY (user_id, badge_id);

ALTER TABLE ONLY public.user_favourites
    ADD CONSTRAINT user_favourites_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_favourites
    ADD CONSTRAINT user_favourites_user_id_kind_ref_id_key UNIQUE (user_id, kind, ref_id);

ALTER TABLE ONLY public.user_picks
    ADD CONSTRAINT user_picks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_picks
    ADD CONSTRAINT user_picks_user_id_match_id_key UNIQUE (user_id, match_id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_auth_provider_auth_subject_key UNIQUE (auth_provider, auth_subject);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_phone_key UNIQUE (phone);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

CREATE INDEX ix_device_tokens_user_id ON public.device_tokens USING btree (user_id);

CREATE INDEX ix_extref_internal ON public.external_refs USING btree (entity, internal_id);

CREATE INDEX ix_job_runs_name_started ON public.job_runs USING btree (name, started_at);

CREATE INDEX ix_lb_board_points ON public.leaderboard_entries USING btree (scope, scope_id, period, period_key, points);

CREATE INDEX ix_leaderboard_entries_user_id ON public.leaderboard_entries USING btree (user_id);

CREATE INDEX ix_leagues_sport_id ON public.leagues USING btree (sport_id);

CREATE INDEX ix_match_events_match_id ON public.match_events USING btree (match_id);

CREATE INDEX ix_matches_away ON public.matches USING btree (away_team_id, start_time);

CREATE INDEX ix_matches_home ON public.matches USING btree (home_team_id, start_time);

CREATE INDEX ix_matches_league_start ON public.matches USING btree (league_id, start_time);

CREATE INDEX ix_matches_start ON public.matches USING btree (start_time);

CREATE INDEX ix_matches_status_start ON public.matches USING btree (status, start_time);

CREATE INDEX ix_notifications_user ON public.notifications USING btree (user_id, created_at);

CREATE INDEX ix_picks_match ON public.user_picks USING btree (match_id);

CREATE INDEX ix_picks_user_season ON public.user_picks USING btree (user_id, season_key);

CREATE INDEX ix_picks_user_status ON public.user_picks USING btree (user_id, status);

CREATE INDEX ix_picks_user_week ON public.user_picks USING btree (user_id, week_key);

CREATE INDEX ix_players_team_id ON public.players USING btree (team_id);

CREATE INDEX ix_predictions_current ON public.predictions USING btree (match_id, is_current);

CREATE INDEX ix_seasons_league_id ON public.seasons USING btree (league_id);

CREATE INDEX ix_standings_league_id ON public.standings USING btree (league_id);

CREATE INDEX ix_team_ratings_sport_id ON public.team_ratings USING btree (sport_id);

CREATE INDEX ix_teams_sport_name ON public.teams USING btree (sport_id, name);

CREATE INDEX ix_user_favourites_user_id ON public.user_favourites USING btree (user_id);

ALTER TABLE ONLY public.device_tokens
    ADD CONSTRAINT device_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.friendships
    ADD CONSTRAINT friendships_friend_id_fkey FOREIGN KEY (friend_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.friendships
    ADD CONSTRAINT friendships_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.leaderboard_entries
    ADD CONSTRAINT leaderboard_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.leagues
    ADD CONSTRAINT leagues_sport_id_fkey FOREIGN KEY (sport_id) REFERENCES public.sports(id);

ALTER TABLE ONLY public.match_events
    ADD CONSTRAINT match_events_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.matches(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.match_events
    ADD CONSTRAINT match_events_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id);

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_away_team_id_fkey FOREIGN KEY (away_team_id) REFERENCES public.teams(id);

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_home_team_id_fkey FOREIGN KEY (home_team_id) REFERENCES public.teams(id);

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id);

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id);

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_sport_id_fkey FOREIGN KEY (sport_id) REFERENCES public.sports(id);

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.players
    ADD CONSTRAINT players_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.predictions
    ADD CONSTRAINT predictions_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.matches(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.private_league_members
    ADD CONSTRAINT private_league_members_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.private_leagues(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.private_league_members
    ADD CONSTRAINT private_league_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.private_leagues
    ADD CONSTRAINT private_leagues_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.private_leagues
    ADD CONSTRAINT private_leagues_sport_id_fkey FOREIGN KEY (sport_id) REFERENCES public.sports(id);

ALTER TABLE ONLY public.seasons
    ADD CONSTRAINT seasons_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.standings
    ADD CONSTRAINT standings_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.standings
    ADD CONSTRAINT standings_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.standings
    ADD CONSTRAINT standings_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id);

ALTER TABLE ONLY public.team_ratings
    ADD CONSTRAINT team_ratings_sport_id_fkey FOREIGN KEY (sport_id) REFERENCES public.sports(id);

ALTER TABLE ONLY public.team_ratings
    ADD CONSTRAINT team_ratings_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_sport_id_fkey FOREIGN KEY (sport_id) REFERENCES public.sports(id);

ALTER TABLE ONLY public.user_badges
    ADD CONSTRAINT user_badges_badge_id_fkey FOREIGN KEY (badge_id) REFERENCES public.badges(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_badges
    ADD CONSTRAINT user_badges_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_favourites
    ADD CONSTRAINT user_favourites_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_picks
    ADD CONSTRAINT user_picks_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.matches(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_picks
    ADD CONSTRAINT user_picks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
