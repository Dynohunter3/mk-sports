"""Plain data types shared by every sport model.

The engine never touches a database: callers (the API, the scheduler, the backtester)
convert their own rows into these types. Team identifiers are opaque strings.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Literal, Optional

Outcome = Literal["home", "draw", "away"]
Confidence = Literal["low", "medium", "high"]
Favours = Literal["home", "away", "neutral"]


def outcome_of(home_score: int, away_score: int) -> Outcome:
    if home_score > away_score:
        return "home"
    if home_score < away_score:
        return "away"
    return "draw"


@dataclass(frozen=True)
class FinishedMatch:
    """A completed match, used to build ratings and form."""

    id: str
    date: datetime
    home: str
    away: str
    home_score: int
    away_score: int
    competition: str = "default"
    neutral: bool = False

    @property
    def outcome(self) -> Outcome:
        return outcome_of(self.home_score, self.away_score)


@dataclass(frozen=True)
class GameRecord:
    """A finished match seen from one team's perspective."""

    date: datetime
    opponent: str
    is_home: bool
    scored: int
    conceded: int
    competition: str = "default"

    @property
    def result(self) -> Literal["W", "D", "L"]:
        if self.scored > self.conceded:
            return "W"
        if self.scored < self.conceded:
            return "L"
        return "D"


@dataclass(frozen=True)
class Absence:
    """A player who is out (or doubtful) for the match."""

    player: str
    position: str = ""  # football: GK/DEF/MID/FWD, basketball: G/F/C
    importance: float = 0.5  # 0 = fringe player, 1 = the team's most important player
    reason: str = "injured"  # injured | suspended | doubtful | other
    tag: Optional[str] = None  # e.g. "top_scorer", "captain", "star"

    @property
    def weight(self) -> float:
        """How much of the player's impact to remove (doubtful players count half)."""
        w = max(0.0, min(1.0, self.importance))
        return w * (0.5 if self.reason == "doubtful" else 1.0)


@dataclass
class TeamState:
    """Everything the models know about a team just before a match."""

    team: str
    name: str
    elo: float
    games: int = 0
    # Football: attack/defence strength relative to the competition average (1.0 = average).
    # defence > 1 means the team concedes MORE than average.
    attack: float = 1.0
    defence: float = 1.0
    # Basketball: exponentially weighted points scored / allowed per game.
    points_for: Optional[float] = None
    points_against: Optional[float] = None
    recent: tuple[GameRecord, ...] = ()  # most recent first
    last_played: Optional[datetime] = None
    # Current runs, not capped by the size of `recent`: win, loss, unbeaten, winless
    streaks: dict[str, int] = field(default_factory=dict)

    @property
    def net(self) -> float:
        if self.points_for is None or self.points_against is None:
            return 0.0
        return self.points_for - self.points_against


@dataclass
class MatchInput:
    """The full, explicit input to a prediction. Stored alongside predictions for audit."""

    sport: str
    competition: str
    kickoff: datetime
    home: TeamState
    away: TeamState
    neutral: bool = False
    home_absences: tuple[Absence, ...] = ()
    away_absences: tuple[Absence, ...] = ()
    h2h: tuple[FinishedMatch, ...] = ()  # most recent first
    league_avg_home: Optional[float] = None  # goals/points per game for the home side
    league_avg_away: Optional[float] = None


@dataclass(frozen=True)
class KeyFactor:
    text: str
    impact: float  # 0..1, used for ranking factors
    favours: Favours
    category: str  # rating | form | venue | absences | h2h | attack | defence | rest | data

    def to_dict(self) -> dict:
        return {"text": self.text, "impact": round(self.impact, 3), "favours": self.favours, "category": self.category}


@dataclass
class Prediction:
    sport: str
    model: str
    model_version: str
    prob_home: float
    prob_draw: Optional[float]
    prob_away: float
    predicted_home: int
    predicted_away: int
    expected_home: float
    expected_away: float
    confidence: Confidence
    key_factors: list[KeyFactor] = field(default_factory=list)
    explanation: dict = field(default_factory=dict)

    def probabilities(self) -> dict[str, float]:
        probs = {"home": self.prob_home, "away": self.prob_away}
        if self.prob_draw is not None:
            probs["draw"] = self.prob_draw
        return probs

    def most_likely(self) -> Outcome:
        probs = self.probabilities()
        return max(probs, key=probs.get)  # type: ignore[return-value]

    def to_dict(self) -> dict:
        data = asdict(self)
        data["key_factors"] = [f.to_dict() for f in self.key_factors]
        return data
