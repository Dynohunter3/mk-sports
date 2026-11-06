"""Request/response models. Responses are deliberately compact (low data usage)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field

Outcome = Literal["home", "draw", "away"]


class Out(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ------------------------------------------------------------------ catalog
class ScoringRulesOut(Out):
    result_points: int
    exact_score_bonus: int
    margin_bonus: int
    margin_tolerance: int
    max_points: int


class SportOut(Out):
    id: int
    slug: str
    name: str
    color: str
    icon: str
    has_draws: bool
    score_unit: str
    tier: int
    is_active: bool
    scoring: ScoringRulesOut
    phase: Optional[int] = None


class LeagueOut(Out):
    id: int
    slug: str
    sport: str
    name: str
    short_name: str
    country: Optional[str]
    region: Optional[str]
    kind: str
    is_featured: bool
    is_active: bool
    season: Optional[str] = None


class TeamMini(Out):
    id: int
    name: str
    short_name: str
    code: str
    color: str


class TeamOut(TeamMini):
    sport: str
    country: Optional[str]
    venue_name: Optional[str]
    venue_city: Optional[str]
    elo: Optional[float] = None
    form: Optional[str] = None


# -------------------------------------------------------------- predictions
class KeyFactorOut(BaseModel):
    text: str
    impact: float
    favours: Literal["home", "away", "neutral"]
    category: str


class PredictionMini(BaseModel):
    home: float
    draw: Optional[float]
    away: float
    score: tuple[int, int]
    confidence: Literal["low", "medium", "high"]
    pick: Outcome  # the model's most likely outcome


class PredictionOut(BaseModel):
    version: int
    created_at: datetime
    trigger: str
    model: str
    model_version: str
    probabilities: dict[str, float]
    predicted_score: tuple[int, int]
    expected: tuple[float, float]
    confidence: Literal["low", "medium", "high"]
    key_factors: list[KeyFactorOut]
    explanation: dict
    versions: int
    correct: Optional[bool] = None


class PredictionVersionOut(BaseModel):
    version: int
    created_at: datetime
    trigger: str
    probabilities: dict[str, float]
    predicted_score: tuple[int, int]
    confidence: str


# ------------------------------------------------------------------ matches
class MyPick(BaseModel):
    pick: Outcome
    home_score: Optional[int]
    away_score: Optional[int]
    status: str
    points: int


class MatchCard(BaseModel):
    id: int
    sport: str
    league: dict  # {id, slug, short_name}
    start_time: datetime
    status: str
    clock: Optional[str]
    round: Optional[str]
    home: TeamMini
    away: TeamMini
    home_score: Optional[int]
    away_score: Optional[int]
    prediction: Optional[PredictionMini]
    my_pick: Optional[MyPick] = None
    locked: bool


class MatchPage(BaseModel):
    items: list[MatchCard]
    next_cursor: Optional[str]


class EventOut(BaseModel):
    type: str
    minute: Optional[int]
    clock: Optional[str]
    side: Literal["home", "away"]
    player: Optional[str]


class FormGame(BaseModel):
    match_id: int
    date: datetime
    opponent: str
    home: bool
    score: str
    result: Literal["W", "D", "L"]


class InjuryOut(BaseModel):
    player: str
    position: str
    status: str
    detail: Optional[str]
    importance: float


class StandingRow(BaseModel):
    position: int
    team: TeamMini
    played: int
    won: int
    drawn: int
    lost: int
    points_for: int
    points_against: int
    points: int
    form: str


class MatchDetail(MatchCard):
    venue: Optional[str]
    neutral: bool
    score_detail: dict
    events: list[EventOut]
    prediction_full: Optional[PredictionOut]
    form: dict[str, list[FormGame]]
    head_to_head: list[FormGame]
    standings: list[StandingRow]
    injuries: dict[str, list[InjuryOut]]
    ratings: dict[str, Optional[dict]]
    scoring: ScoringRulesOut
    has_draws: bool
    score_unit: str


# ---------------------------------------------------------------- the game
class PickIn(BaseModel):
    pick: Optional[Outcome] = Field(None, description="Optional if a score is given (the score implies the result)")
    home_score: Optional[int] = Field(None, ge=0)
    away_score: Optional[int] = Field(None, ge=0)


class PickOut(BaseModel):
    match_id: int
    pick: Outcome
    home_score: Optional[int]
    away_score: Optional[int]
    status: str
    points: int
    result_correct: Optional[bool]
    exact_score: bool
    locks_at: datetime
    new_badges: list[str] = []


class PickHistoryItem(BaseModel):
    match: MatchCard
    pick: MyPick
    created_at: datetime


class PickHistoryPage(BaseModel):
    items: list[PickHistoryItem]
    next_cursor: Optional[str]


class LeaderboardRow(BaseModel):
    rank: int
    user_id: str
    display_name: str
    country: Optional[str]
    points: int
    picks: int
    correct: int
    exact: int
    is_me: bool = False


class LeaderboardOut(BaseModel):
    scope: str
    period: Literal["week", "season", "all"]
    period_key: str
    total: int
    items: list[LeaderboardRow]
    me: Optional[LeaderboardRow]


class BadgeOut(BaseModel):
    slug: str
    name: str
    description: str
    icon: str
    awarded_at: Optional[datetime] = None


# -------------------------------------------------------------------- users
class Favourites(BaseModel):
    sports: list[int] = []
    leagues: list[int] = []
    teams: list[int] = []


class StatsOut(BaseModel):
    total_points: int
    picks_settled: int
    picks_correct: int
    exact_scores: int
    accuracy: Optional[float]
    current_streak: int
    best_streak: int
    pending_picks: int
    global_rank_season: Optional[int]


class MeOut(BaseModel):
    id: str
    display_name: str
    email: Optional[str]
    phone: Optional[str]
    country: Optional[str]
    auth_provider: str
    consented: bool
    marketing_opt_in: bool
    onboarded: bool
    notification_prefs: dict
    favourites: Favourites
    stats: StatsOut
    badges: list[BadgeOut]
    created_at: datetime


class MePatch(BaseModel):
    display_name: Optional[str] = Field(None, min_length=2, max_length=40)
    country: Optional[str] = Field(None, min_length=2, max_length=2)
    notification_prefs: Optional[dict] = None
    marketing_opt_in: Optional[bool] = None


class ConsentIn(BaseModel):
    terms: bool
    privacy: bool
    marketing: bool = False


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(min_length=2, max_length=40)
    accept_terms: bool
    accept_privacy: bool
    marketing_opt_in: bool = False


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str


# ----------------------------------------------------------------- accuracy
class AccuracyRow(BaseModel):
    key: str
    name: str
    sport: str
    n: int
    correct: int
    hit_rate: Optional[float]
    brier: Optional[float]
    log_loss: Optional[float]
    by_confidence: dict[str, dict]


class AccuracyOut(BaseModel):
    source: str
    updated_at: datetime
    overall: AccuracyRow
    sports: list[AccuracyRow]
    leagues: list[AccuracyRow]
    recent: list[dict]
    baseline_note: str
