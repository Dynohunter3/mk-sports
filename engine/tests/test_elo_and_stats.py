import math

import pytest

from predictpro_engine.elo import (
    basketball_mov_multiplier,
    elo_update,
    expected_score,
    football_mov_multiplier,
)
from predictpro_engine.stats import most_likely_score, normal_cdf, outcome_probabilities, poisson_pmf, score_matrix


def test_expected_score_is_symmetric_and_bounded():
    assert expected_score(1500, 1500) == pytest.approx(0.5)
    assert expected_score(1600, 1500) + expected_score(1500, 1600) == pytest.approx(1.0)
    assert 0 < expected_score(1000, 2000) < 0.01


def test_home_advantage_raises_expectation():
    assert expected_score(1500, 1500, advantage_a=65) > 0.5


def test_elo_update_is_zero_sum_and_directional():
    h, a = elo_update(1500, 1500, actual_home=1.0, k=20, home_advantage=0)
    assert h + a == pytest.approx(3000)
    assert h == pytest.approx(1510)
    # An upset moves ratings more than an expected win
    h_fav, _ = elo_update(1700, 1400, 1.0, 20, 0)
    _, a_upset = elo_update(1700, 1400, 0.0, 20, 0)
    assert (h_fav - 1700) < (a_upset - 1400)


def test_mov_multipliers():
    assert football_mov_multiplier(0) == 1.0
    assert football_mov_multiplier(1) == 1.0
    assert football_mov_multiplier(2) == 1.5
    assert football_mov_multiplier(-4) == pytest.approx(15 / 8)
    # bigger wins count more, but a favourite's blowout is damped
    assert basketball_mov_multiplier(20, 0) > basketball_mov_multiplier(5, 0)
    assert basketball_mov_multiplier(20, 300) < basketball_mov_multiplier(20, 0)


def test_poisson_pmf_sums_to_one():
    assert sum(poisson_pmf(k, 1.7) for k in range(30)) == pytest.approx(1.0)
    assert poisson_pmf(0, 0) == 1.0
    assert poisson_pmf(-1, 1.0) == 0.0


def test_score_matrix_and_outcomes():
    grid = score_matrix(1.6, 1.1, rho=-0.08)
    assert sum(map(sum, grid)) == pytest.approx(1.0)
    h, d, a = outcome_probabilities(grid)
    assert h + d + a == pytest.approx(1.0)
    assert h > a
    # rho = 0 is plain independent Poisson
    plain = score_matrix(1.2, 1.2, max_goals=12, rho=0.0)
    assert plain[1][1] == pytest.approx(poisson_pmf(1, 1.2) ** 2, rel=1e-3)
    # negative rho (Dixon-Coles) inflates low-scoring draws
    dc = score_matrix(1.2, 1.2, max_goals=12, rho=-0.1)
    assert dc[0][0] > plain[0][0] and dc[1][1] > plain[1][1]


def test_most_likely_score_respects_outcome():
    grid = score_matrix(1.4, 1.3)
    assert most_likely_score(grid, "home")[0] > most_likely_score(grid, "home")[1]
    assert most_likely_score(grid, "away")[0] < most_likely_score(grid, "away")[1]
    i, j = most_likely_score(grid, "draw")
    assert i == j


def test_normal_cdf():
    assert normal_cdf(0) == pytest.approx(0.5)
    assert normal_cdf(1.96) == pytest.approx(0.975, abs=1e-3)
    assert math.isclose(normal_cdf(-1) + normal_cdf(1), 1.0)
