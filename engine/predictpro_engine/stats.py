"""Small numeric helpers (pure Python, no numpy needed at these sizes)."""

from __future__ import annotations

import math


def poisson_pmf(k: int, lam: float) -> float:
    if k < 0:
        return 0.0
    if lam <= 0:
        return 1.0 if k == 0 else 0.0
    return math.exp(k * math.log(lam) - lam - math.lgamma(k + 1))


def dixon_coles_tau(i: int, j: int, lam_h: float, lam_a: float, rho: float) -> float:
    """Dixon & Coles (1997) correction for the dependence between low scores."""
    if i == 0 and j == 0:
        return 1.0 - lam_h * lam_a * rho
    if i == 0 and j == 1:
        return 1.0 + lam_h * rho
    if i == 1 and j == 0:
        return 1.0 + lam_a * rho
    if i == 1 and j == 1:
        return 1.0 - rho
    return 1.0


def score_matrix(lam_h: float, lam_a: float, max_goals: int = 10, rho: float = 0.0) -> list[list[float]]:
    """P(home scores i, away scores j), normalised so the grid sums to 1."""
    ph = [poisson_pmf(i, lam_h) for i in range(max_goals + 1)]
    pa = [poisson_pmf(j, lam_a) for j in range(max_goals + 1)]
    grid = [[max(0.0, ph[i] * pa[j] * dixon_coles_tau(i, j, lam_h, lam_a, rho)) for j in range(max_goals + 1)] for i in range(max_goals + 1)]
    total = sum(sum(row) for row in grid)
    return [[p / total for p in row] for row in grid]


def outcome_probabilities(grid: list[list[float]]) -> tuple[float, float, float]:
    home = draw = away = 0.0
    for i, row in enumerate(grid):
        for j, p in enumerate(row):
            if i > j:
                home += p
            elif i == j:
                draw += p
            else:
                away += p
    return home, draw, away


def most_likely_score(grid: list[list[float]], outcome: str) -> tuple[int, int]:
    """Most probable scoreline *within* the given outcome, so the score agrees with the pick."""
    best, best_p = (0, 0), -1.0
    for i, row in enumerate(grid):
        for j, p in enumerate(row):
            ok = (outcome == "home" and i > j) or (outcome == "away" and i < j) or (outcome == "draw" and i == j)
            if ok and p > best_p:
                best, best_p = (i, j), p
    return best


def normal_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))
