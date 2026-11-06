"""Database schema.

Required entities: Sport, League, Season, Team, Player, Match, MatchEvent, Prediction,
UserPick, User, LeaderboardEntry, PrivateLeague, Notification. Supporting tables:
ExternalRef (provider id mapping), TeamRating, Standing, UserFavourite, Badge/UserBadge,
PrivateLeagueMember, Friendship, DeviceToken, AppState, JobRun.

Sports and leagues are rows, not code: adding a competition is a catalog/config change.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base, utcnow

# ----------------------------------------------------------------------------- catalog


class Sport(Base):
    __tablename__ = "sports"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(String(80))
    color: Mapped[str] = mapped_column(String(9))  # UI colour coding
    icon: Mapped[str] = mapped_column(String(40))
    has_draws: Mapped[bool] = mapped_column(Boolean, default=True)
    score_unit: Mapped[str] = mapped_column(String(20), default="goals")  # goals|points|runs|sets|positions
    tier: Mapped[int] = mapped_column(Integer, default=1)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=100)
    model_params: Mapped[dict] = mapped_column(default=dict)  # prediction model overrides
    scoring_rules: Mapped[dict] = mapped_column(default=dict)  # points system for the pick game
    config: Mapped[dict] = mapped_column(default=dict)  # e.g. match duration, live poll interval

    leagues: Mapped[list["League"]] = relationship(back_populates="sport", order_by="League.sort_order")


class League(Base):
    __tablename__ = "leagues"

    id: Mapped[int] = mapped_column(primary_key=True)
    sport_id: Mapped[int] = mapped_column(ForeignKey("sports.id"), index=True)
    slug: Mapped[str] = mapped_column(String(60), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    short_name: Mapped[str] = mapped_column(String(40))
    country: Mapped[Optional[str]] = mapped_column(String(60))
    region: Mapped[Optional[str]] = mapped_column(String(40))  # Europe, Africa, World...
    kind: Mapped[str] = mapped_column(String(20), default="league")  # league|cup|tournament
    tier: Mapped[int] = mapped_column(Integer, default=1)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_featured: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=100)
    model_params: Mapped[dict] = mapped_column(default=dict)
    provider_refs: Mapped[dict] = mapped_column(default=dict)  # {"football_data": "PL", "api_sports": 39, "mock": "eng-pl"}
    config: Mapped[dict] = mapped_column(default=dict)

    sport: Mapped[Sport] = relationship(back_populates="leagues")


class Season(Base):
    __tablename__ = "seasons"
    __table_args__ = (UniqueConstraint("league_id", "name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    league_id: Mapped[int] = mapped_column(ForeignKey("leagues.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(20))  # "2026/27"
    start_date: Mapped[Optional[datetime]]
    end_date: Mapped[Optional[datetime]]
    is_current: Mapped[bool] = mapped_column(Boolean, default=True)


class Team(Base):
    __tablename__ = "teams"
    __table_args__ = (Index("ix_teams_sport_name", "sport_id", "name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    sport_id: Mapped[int] = mapped_column(ForeignKey("sports.id"))
    name: Mapped[str] = mapped_column(String(120))
    short_name: Mapped[str] = mapped_column(String(40))
    code: Mapped[str] = mapped_column(String(6))
    country: Mapped[Optional[str]] = mapped_column(String(60))
    color: Mapped[str] = mapped_column(String(9), default="#64748B")
    logo_url: Mapped[Optional[str]] = mapped_column(String(300))
    venue_name: Mapped[Optional[str]] = mapped_column(String(120))
    venue_city: Mapped[Optional[str]] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class ExternalRef(Base):
    """Maps a provider's id for a team/player to ours, so providers can be swapped."""

    __tablename__ = "external_refs"
    __table_args__ = (UniqueConstraint("provider", "entity", "external_id"), Index("ix_extref_internal", "entity", "internal_id"))

    id: Mapped[int] = mapped_column(primary_key=True)
    provider: Mapped[str] = mapped_column(String(30))
    entity: Mapped[str] = mapped_column(String(20))  # team | player
    external_id: Mapped[str] = mapped_column(String(80))
    internal_id: Mapped[int] = mapped_column(Integer)


class Player(Base):
    __tablename__ = "players"

    id: Mapped[int] = mapped_column(primary_key=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    position: Mapped[str] = mapped_column(String(10), default="")
    shirt_number: Mapped[Optional[int]]
    importance: Mapped[float] = mapped_column(Float, default=0.3)  # 0..1, feeds the absence adjustment
    tag: Mapped[Optional[str]] = mapped_column(String(20))  # top_scorer | captain | star
    status: Mapped[str] = mapped_column(String(20), default="available")  # available|injured|suspended|doubtful
    status_detail: Mapped[Optional[str]] = mapped_column(String(120))
    status_updated_at: Mapped[Optional[datetime]]


class TeamRating(Base):
    """Latest model ratings per team (rebuilt from results by the prediction job)."""

    __tablename__ = "team_ratings"

    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"), primary_key=True)
    sport_id: Mapped[int] = mapped_column(ForeignKey("sports.id"), index=True)
    elo: Mapped[float] = mapped_column(Float)
    attack: Mapped[Optional[float]] = mapped_column(Float)
    defence: Mapped[Optional[float]] = mapped_column(Float)
    points_for: Mapped[Optional[float]] = mapped_column(Float)
    points_against: Mapped[Optional[float]] = mapped_column(Float)
    games: Mapped[int] = mapped_column(Integer, default=0)
    form: Mapped[str] = mapped_column(String(10), default="")  # newest first, e.g. "WWDLW"
    updated_at: Mapped[datetime] = mapped_column(default=utcnow)


# ----------------------------------------------------------------------------- matches

MATCH_STATUSES = ("scheduled", "live", "finished", "postponed", "cancelled")


class Match(Base):
    __tablename__ = "matches"
    __table_args__ = (
        UniqueConstraint("provider", "provider_ref"),
        Index("ix_matches_start", "start_time"),
        Index("ix_matches_league_start", "league_id", "start_time"),
        Index("ix_matches_status_start", "status", "start_time"),
        Index("ix_matches_home", "home_team_id", "start_time"),
        Index("ix_matches_away", "away_team_id", "start_time"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    sport_id: Mapped[int] = mapped_column(ForeignKey("sports.id"))
    league_id: Mapped[int] = mapped_column(ForeignKey("leagues.id"))
    season_id: Mapped[Optional[int]] = mapped_column(ForeignKey("seasons.id"))
    home_team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"))
    away_team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"))
    start_time: Mapped[datetime]
    status: Mapped[str] = mapped_column(String(20), default="scheduled")
    clock: Mapped[Optional[str]] = mapped_column(String(20))  # "67'", "HT", "Q3 05:12"
    home_score: Mapped[Optional[int]]
    away_score: Mapped[Optional[int]]
    score_detail: Mapped[dict] = mapped_column(default=dict)  # halves/quarters/sets
    round: Mapped[Optional[str]] = mapped_column(String(40))
    venue: Mapped[Optional[str]] = mapped_column(String(120))
    neutral: Mapped[bool] = mapped_column(Boolean, default=False)
    provider: Mapped[str] = mapped_column(String(30))
    provider_ref: Mapped[str] = mapped_column(String(120))
    finished_at: Mapped[Optional[datetime]]
    settled_at: Mapped[Optional[datetime]]
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)

    sport: Mapped[Sport] = relationship()
    league: Mapped[League] = relationship()
    season: Mapped[Optional[Season]] = relationship()
    home_team: Mapped[Team] = relationship(foreign_keys=[home_team_id])
    away_team: Mapped[Team] = relationship(foreign_keys=[away_team_id])


class MatchEvent(Base):
    __tablename__ = "match_events"
    __table_args__ = (UniqueConstraint("match_id", "ext_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    ext_id: Mapped[str] = mapped_column(String(80))
    type: Mapped[str] = mapped_column(String(30))  # goal|own_goal|penalty_goal|yellow_card|red_card|period_end
    minute: Mapped[Optional[int]]
    clock: Mapped[Optional[str]] = mapped_column(String(20))
    team_id: Mapped[Optional[int]] = mapped_column(ForeignKey("teams.id"))
    player_name: Mapped[Optional[str]] = mapped_column(String(120))
    detail: Mapped[dict] = mapped_column(default=dict)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class Prediction(Base):
    """Every prediction version is kept (with timestamp + trigger) for audit and accuracy."""

    __tablename__ = "predictions"
    __table_args__ = (UniqueConstraint("match_id", "version"), Index("ix_predictions_current", "match_id", "is_current"))

    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"))
    version: Mapped[int] = mapped_column(Integer)
    is_current: Mapped[bool] = mapped_column(Boolean, default=True)
    model_name: Mapped[str] = mapped_column(String(60))
    model_version: Mapped[str] = mapped_column(String(20))
    trigger: Mapped[str] = mapped_column(String(30))  # initial|scheduled|team_news|backfill|manual
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    prob_home: Mapped[float] = mapped_column(Float)
    prob_draw: Mapped[Optional[float]] = mapped_column(Float)
    prob_away: Mapped[float] = mapped_column(Float)
    predicted_home: Mapped[int] = mapped_column(Integer)
    predicted_away: Mapped[int] = mapped_column(Integer)
    expected_home: Mapped[float] = mapped_column(Float)
    expected_away: Mapped[float] = mapped_column(Float)
    confidence: Mapped[str] = mapped_column(String(10))
    key_factors: Mapped[list] = mapped_column(default=list)
    explanation: Mapped[dict] = mapped_column(default=dict)
    input_hash: Mapped[str] = mapped_column(String(40))
    # Filled in once the match is final (only for the last pre-kickoff version)
    outcome_correct: Mapped[Optional[bool]]
    brier: Mapped[Optional[float]] = mapped_column(Float)
    log_loss: Mapped[Optional[float]] = mapped_column(Float)
    evaluated_at: Mapped[Optional[datetime]]

    match: Mapped[Match] = relationship()


class Standing(Base):
    __tablename__ = "standings"
    __table_args__ = (UniqueConstraint("league_id", "season_id", "team_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    league_id: Mapped[int] = mapped_column(ForeignKey("leagues.id", ondelete="CASCADE"), index=True)
    season_id: Mapped[Optional[int]] = mapped_column(ForeignKey("seasons.id", ondelete="CASCADE"))
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"))
    position: Mapped[int] = mapped_column(Integer)
    played: Mapped[int] = mapped_column(Integer, default=0)
    won: Mapped[int] = mapped_column(Integer, default=0)
    drawn: Mapped[int] = mapped_column(Integer, default=0)
    lost: Mapped[int] = mapped_column(Integer, default=0)
    points_for: Mapped[int] = mapped_column(Integer, default=0)
    points_against: Mapped[int] = mapped_column(Integer, default=0)
    points: Mapped[int] = mapped_column(Integer, default=0)
    form: Mapped[str] = mapped_column(String(10), default="")
    updated_at: Mapped[datetime] = mapped_column(default=utcnow)

    team: Mapped[Team] = relationship()


# ----------------------------------------------------------------------------- users & game


def _uuid() -> str:
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"
    __table_args__ = (UniqueConstraint("auth_provider", "auth_subject"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    auth_provider: Mapped[str] = mapped_column(String(20))  # dev | supabase
    auth_subject: Mapped[str] = mapped_column(String(120))
    email: Mapped[Optional[str]] = mapped_column(String(200), unique=True)
    phone: Mapped[Optional[str]] = mapped_column(String(30), unique=True)
    password_hash: Mapped[Optional[str]] = mapped_column(String(200))  # dev auth only
    display_name: Mapped[str] = mapped_column(String(60))
    country: Mapped[Optional[str]] = mapped_column(String(2))
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    terms_accepted_at: Mapped[Optional[datetime]]
    privacy_accepted_at: Mapped[Optional[datetime]]
    marketing_opt_in: Mapped[bool] = mapped_column(Boolean, default=False)
    onboarded_at: Mapped[Optional[datetime]]
    notification_prefs: Mapped[dict] = mapped_column(default=dict)
    # Denormalised stats, recomputed on settlement
    total_points: Mapped[int] = mapped_column(Integer, default=0)
    picks_settled: Mapped[int] = mapped_column(Integer, default=0)
    picks_correct: Mapped[int] = mapped_column(Integer, default=0)
    exact_scores: Mapped[int] = mapped_column(Integer, default=0)
    current_streak: Mapped[int] = mapped_column(Integer, default=0)
    best_streak: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)


class UserFavourite(Base):
    __tablename__ = "user_favourites"
    __table_args__ = (UniqueConstraint("user_id", "kind", "ref_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(10))  # sport | league | team
    ref_id: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


PICK_STATUSES = ("pending", "won", "lost", "void")


class UserPick(Base):
    __tablename__ = "user_picks"
    __table_args__ = (
        UniqueConstraint("user_id", "match_id"),
        Index("ix_picks_match", "match_id"),
        Index("ix_picks_user_status", "user_id", "status"),
        Index("ix_picks_user_week", "user_id", "week_key"),
        Index("ix_picks_user_season", "user_id", "season_key"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"))
    pick: Mapped[str] = mapped_column(String(5))  # home | draw | away
    home_score: Mapped[Optional[int]]
    away_score: Mapped[Optional[int]]
    status: Mapped[str] = mapped_column(String(10), default="pending")
    points: Mapped[int] = mapped_column(Integer, default=0)
    result_correct: Mapped[Optional[bool]]
    exact_score: Mapped[bool] = mapped_column(Boolean, default=False)
    week_key: Mapped[str] = mapped_column(String(10))  # ISO week of the match, e.g. 2026-W45
    season_key: Mapped[str] = mapped_column(String(10))  # e.g. 2026-27
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)
    settled_at: Mapped[Optional[datetime]]

    match: Mapped[Match] = relationship()


class LeaderboardEntry(Base):
    """Durable leaderboard totals (Redis sorted sets are a fast, rebuildable mirror)."""

    __tablename__ = "leaderboard_entries"
    __table_args__ = (
        UniqueConstraint("scope", "scope_id", "period", "period_key", "user_id"),
        Index("ix_lb_board_points", "scope", "scope_id", "period", "period_key", "points"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    scope: Mapped[str] = mapped_column(String(10))  # global | private | friends
    scope_id: Mapped[int] = mapped_column(Integer, default=0)  # private league id (0 = n/a)
    period: Mapped[str] = mapped_column(String(10))  # week | season | all
    period_key: Mapped[str] = mapped_column(String(10))  # 2026-W45 | 2026-27 | all
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    points: Mapped[int] = mapped_column(Integer, default=0)
    picks: Mapped[int] = mapped_column(Integer, default=0)
    correct: Mapped[int] = mapped_column(Integer, default=0)
    exact: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)


class Badge(Base):
    __tablename__ = "badges"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(String(60))
    description: Mapped[str] = mapped_column(String(200))
    icon: Mapped[str] = mapped_column(String(40))
    sort_order: Mapped[int] = mapped_column(Integer, default=100)


class UserBadge(Base):
    __tablename__ = "user_badges"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    badge_id: Mapped[int] = mapped_column(ForeignKey("badges.id", ondelete="CASCADE"), primary_key=True)
    awarded_at: Mapped[datetime] = mapped_column(default=utcnow)

    badge: Mapped[Badge] = relationship()


class PrivateLeague(Base):
    __tablename__ = "private_leagues"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(60))
    invite_code: Mapped[str] = mapped_column(String(12), unique=True)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    sport_id: Mapped[Optional[int]] = mapped_column(ForeignKey("sports.id"))  # None = all sports
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class PrivateLeagueMember(Base):
    __tablename__ = "private_league_members"

    league_id: Mapped[int] = mapped_column(ForeignKey("private_leagues.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    role: Mapped[str] = mapped_column(String(10), default="member")  # owner | member
    joined_at: Mapped[datetime] = mapped_column(default=utcnow)


class Friendship(Base):
    __tablename__ = "friendships"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    friend_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    status: Mapped[str] = mapped_column(String(10), default="pending")  # pending | accepted
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notifications_user", "user_id", "created_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    type: Mapped[str] = mapped_column(String(30))  # match_reminder | pick_lock | result | leaderboard
    title: Mapped[str] = mapped_column(String(120))
    body: Mapped[str] = mapped_column(Text)
    data: Mapped[dict] = mapped_column(default=dict)
    dedupe_key: Mapped[Optional[str]] = mapped_column(String(120), unique=True)
    scheduled_for: Mapped[Optional[datetime]]
    sent_at: Mapped[Optional[datetime]]
    read_at: Mapped[Optional[datetime]]
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class DeviceToken(Base):
    __tablename__ = "device_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token: Mapped[str] = mapped_column(String(300), unique=True)
    platform: Mapped[str] = mapped_column(String(10))  # android | ios | web
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


# ----------------------------------------------------------------------------- ops


class AppState(Base):
    __tablename__ = "app_state"

    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[dict] = mapped_column(default=dict)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)


class JobRun(Base):
    __tablename__ = "job_runs"
    __table_args__ = (Index("ix_job_runs_name_started", "name", "started_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(40))
    started_at: Mapped[datetime] = mapped_column(default=utcnow)
    finished_at: Mapped[Optional[datetime]]
    status: Mapped[str] = mapped_column(String(10), default="running")  # running | ok | error | skipped
    detail: Mapped[dict] = mapped_column(default=dict)
