"""Provider adapter interface.

Every sports-data source (mock, football-data.org, API-Sports, TheSportsDB, ...) is
translated into these neutral dataclasses. Sync jobs only ever see these types, so a
provider can be swapped per sport (or per league) via configuration.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Optional


@dataclass
class LeagueRef:
    sport: str  # our sport slug
    slug: str  # our league slug
    ref: Any  # the provider's id for this competition (str, int or dict)
    config: dict = field(default_factory=dict)


@dataclass
class ProviderTeam:
    ref: str
    name: str
    short_name: Optional[str] = None
    code: Optional[str] = None
    country: Optional[str] = None
    color: Optional[str] = None
    logo_url: Optional[str] = None
    venue_name: Optional[str] = None
    venue_city: Optional[str] = None


@dataclass
class ProviderEvent:
    ext_id: str
    type: str  # goal | own_goal | penalty_goal | yellow_card | red_card | period_end
    side: str  # home | away
    minute: Optional[int] = None
    clock: Optional[str] = None
    player_name: Optional[str] = None
    detail: dict = field(default_factory=dict)


@dataclass
class ProviderMatch:
    ref: str
    league_slug: str
    start_time: datetime
    status: str  # scheduled | live | finished | postponed | cancelled
    home: ProviderTeam
    away: ProviderTeam
    home_score: Optional[int] = None
    away_score: Optional[int] = None
    clock: Optional[str] = None
    score_detail: dict = field(default_factory=dict)
    season: Optional[str] = None
    round: Optional[str] = None
    venue: Optional[str] = None
    neutral: bool = False
    events: Optional[list[ProviderEvent]] = None  # None = provider didn't send events


@dataclass
class ProviderPlayer:
    ref: str
    team_ref: str
    name: str
    position: str = ""
    shirt_number: Optional[int] = None
    importance: float = 0.3
    tag: Optional[str] = None
    status: str = "available"  # available | injured | suspended | doubtful
    status_detail: Optional[str] = None


@dataclass
class ProviderStanding:
    team: ProviderTeam
    position: int
    played: int
    won: int
    drawn: int
    lost: int
    points_for: int
    points_against: int
    points: int
    form: str = ""


class ProviderError(RuntimeError):
    pass


class SportsDataProvider(ABC):
    name: str = "base"
    sports: tuple[str, ...] = ()

    def supports(self, league: LeagueRef) -> bool:
        return league.sport in self.sports and league.ref not in (None, "", {})

    @abstractmethod
    def fetch_fixtures(self, league: LeagueRef, date_from: datetime, date_to: datetime) -> list[ProviderMatch]:
        """All matches (any status) kicking off within [date_from, date_to]."""

    @abstractmethod
    def fetch_live(self, leagues: list[LeagueRef], refs: list[str]) -> list[ProviderMatch]:
        """Current state of in-progress / just-started matches. `refs` are the matches we
        believe are live; bulk 'live' endpoints may ignore them (one request instead of N)."""

    def fetch_squads(self, league: LeagueRef, team_refs: list[str]) -> list[ProviderPlayer]:
        """Key players and their availability. Optional: many free tiers don't include it."""
        return []

    def fetch_standings(self, league: LeagueRef) -> Optional[list[ProviderStanding]]:
        """League table if the provider has one; None means 'compute it from results'."""
        return None
