"""Elo rating maths shared by all head-to-head sports."""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class EloConfig:
    k: float = 20.0
    home_advantage: float = 65.0  # rating points added to the home side when computing expectation
    initial: float = 1500.0
    # A gap this long between a team's games is treated as an off-season: ratings are pulled
    # back toward the mean because squads change.
    season_gap_days: int = 60
    season_regression: float = 1 / 3


def expected_score(rating_a: float, rating_b: float, advantage_a: float = 0.0) -> float:
    """Probability-like expectation that A beats B (a draw counts as half a win)."""
    return 1.0 / (1.0 + 10 ** (-(rating_a + advantage_a - rating_b) / 400.0))


def football_mov_multiplier(goal_diff: int) -> float:
    """Goal-difference multiplier used by the World Football Elo Ratings."""
    gd = abs(goal_diff)
    if gd <= 1:
        return 1.0
    if gd == 2:
        return 1.5
    return (11.0 + gd) / 8.0


def basketball_mov_multiplier(point_diff: int, winner_elo_diff: float) -> float:
    """FiveThirtyEight-style margin-of-victory multiplier with autocorrelation damping."""
    mov = abs(point_diff)
    return ((mov + 3.0) ** 0.8) / (7.5 + 0.006 * winner_elo_diff)


def elo_update(
    rating_home: float,
    rating_away: float,
    actual_home: float,
    k: float,
    home_advantage: float,
    multiplier: float = 1.0,
) -> tuple[float, float]:
    """Return new (home, away) ratings. Zero-sum: what one side gains the other loses."""
    exp_home = expected_score(rating_home, rating_away, home_advantage)
    delta = k * multiplier * (actual_home - exp_home)
    return rating_home + delta, rating_away - delta


def regress_to_mean(rating: float, mean: float, fraction: float) -> float:
    return rating + (mean - rating) * fraction


def elo_to_win_prob(diff: float) -> float:
    return 1.0 / (1.0 + math.pow(10, -diff / 400.0))
