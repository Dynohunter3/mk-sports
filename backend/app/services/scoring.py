"""The pick-game points system (pure functions, no I/O).

Default rules (configurable per sport in the catalog, `scoring_rules`):
  football:   3 pts for the correct result, +2 for the exact score       (max 5)
  basketball: 3 pts for the correct winner, +5 for the exact score, or
              +1 if the predicted margin is within 3 points              (max 8)
Picks lock at kick-off. Cancelled/abandoned matches void picks (0 pts, no effect on streaks).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Mapping, Optional

Outcome = Literal["home", "draw", "away"]
OUTCOMES = ("home", "draw", "away")


@dataclass(frozen=True)
class ScoringRules:
    result_points: int = 3
    exact_score_bonus: int = 2
    margin_bonus: int = 0  # awarded when the result is right, the score isn't exact,
    margin_tolerance: int = 0  # and |predicted margin - actual margin| <= tolerance

    @classmethod
    def from_dict(cls, d: Optional[Mapping]) -> "ScoringRules":
        d = dict(d or {})
        return cls(**{k: int(v) for k, v in d.items() if k in cls.__dataclass_fields__})

    @property
    def max_points(self) -> int:
        return self.result_points + max(self.exact_score_bonus, self.margin_bonus)

    def to_dict(self) -> dict:
        return {
            "result_points": self.result_points,
            "exact_score_bonus": self.exact_score_bonus,
            "margin_bonus": self.margin_bonus,
            "margin_tolerance": self.margin_tolerance,
            "max_points": self.max_points,
        }


@dataclass(frozen=True)
class PickScore:
    points: int
    status: Literal["won", "lost"]
    result_correct: bool
    exact_score: bool
    margin_bonus: bool


class PickError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def outcome_of(home: int, away: int) -> Outcome:
    return "home" if home > away else "away" if away > home else "draw"


def score_pick(
    rules: ScoringRules,
    pick: str,
    actual_home: int,
    actual_away: int,
    pick_home: Optional[int] = None,
    pick_away: Optional[int] = None,
) -> PickScore:
    actual = outcome_of(actual_home, actual_away)
    correct = pick == actual
    has_score = pick_home is not None and pick_away is not None
    exact = correct and has_score and pick_home == actual_home and pick_away == actual_away
    margin = False
    points = 0
    if correct:
        points += rules.result_points
        if exact:
            points += rules.exact_score_bonus
        elif has_score and rules.margin_bonus > 0:
            if abs((pick_home - pick_away) - (actual_home - actual_away)) <= rules.margin_tolerance:  # type: ignore[operator]
                margin = True
                points += rules.margin_bonus
    return PickScore(points, "won" if correct else "lost", correct, exact, margin)


def validate_pick(has_draws: bool, pick: Optional[str], home: Optional[int], away: Optional[int], max_score: int = 200) -> Outcome:
    """Normalise a pick. A score alone implies the outcome; a score must agree with the outcome."""
    if (home is None) != (away is None):
        raise PickError("incomplete_score", "Give both scores or neither")
    if home is not None and away is not None:
        if not (0 <= home <= max_score and 0 <= away <= max_score):
            raise PickError("invalid_score", f"Scores must be between 0 and {max_score}")
        implied = outcome_of(home, away)
        if pick is None:
            pick = implied
        elif pick != implied:
            raise PickError("score_mismatch", f"A {home}-{away} score doesn't match a '{pick}' pick")
    if pick not in OUTCOMES:
        raise PickError("invalid_pick", "Pick must be home, draw or away")
    if pick == "draw" and not has_draws:
        raise PickError("no_draws", "This sport has no draws")
    return pick  # type: ignore[return-value]


def is_locked(status: str, start_time: datetime, now: datetime) -> bool:
    """Picks lock at the scheduled start time (or as soon as the match is no longer scheduled)."""
    return status != "scheduled" or now >= start_time


def streak_from(results_newest_first: list[bool]) -> int:
    n = 0
    for ok in results_newest_first:
        if not ok:
            break
        n += 1
    return n


def best_streak(results_oldest_first: list[bool]) -> int:
    best = cur = 0
    for ok in results_oldest_first:
        cur = cur + 1 if ok else 0
        best = max(best, cur)
    return best
