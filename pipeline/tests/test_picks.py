"""Decision layer: draw calls, call strength, double chance, pi-ratings, goal markets."""

import numpy as np

from mkmodel.features import PiRatings, goal_markets, outcome_probs
from mkmodel.picks import DRAW_RULE, describe, double_chance, picks, tier_of


def test_draw_is_called_when_it_is_a_live_contender():
    P = np.array([
        [0.36, 0.32, 0.32],  # level game, draw within the gap -> draw
        [0.50, 0.31, 0.19],  # clear favourite -> home
        [0.30, 0.30, 0.40],  # draw below the minimum -> away
        [0.20, 0.25, 0.55],
        [0.33, 0.36, 0.31],  # draw is the single most likely outcome -> draw
    ])
    assert picks(P).tolist() == [1, 0, 2, 2, 1]
    # with the rule switched off only an outright most-likely draw is called
    assert picks(P, {"min_draw": 2.0, "max_gap": 0.0}).tolist() == [0, 0, 2, 2, 1]
    assert 0.25 < DRAW_RULE["min_draw"] < 0.4 and 0 < DRAW_RULE["max_gap"] < 0.25


def test_tiers_and_double_chance():
    assert [tier_of(p) for p in (0.8, 0.65, 0.55, 0.45, 0.35)] == ["strong", "strong", "likely", "lean", "toss-up"]
    i, p = double_chance(np.array([[0.5, 0.3, 0.2], [0.2, 0.25, 0.55], [0.45, 0.15, 0.40]]))
    assert i.tolist() == [0, 1, 2]  # home or draw, away or draw, home or away
    np.testing.assert_allclose(p, [0.8, 0.8, 0.85])


def test_describe_is_consistent():
    d = describe([0.36, 0.32, 0.32])
    assert d["pick"] == "draw" and d["draw_call"] and d["tier"] == "toss-up"
    assert d["double_chance"] == {"call": "home or draw", "probability": 0.68}
    d = describe([0.72, 0.18, 0.10])
    assert d["pick"] == "home" and not d["draw_call"] and d["tier"] == "strong" and d["pick_probability"] == 0.72


def test_pi_ratings_move_toward_results_and_are_zero_sum_per_venue():
    pi = PiRatings()
    for _ in range(30):
        pi.update("strong", "weak", 3, 0)
    assert pi.H["strong"] > 0.5 and pi.A["weak"] < -0.5
    assert pi.A["strong"] > 0 and pi.H["weak"] < 0  # cross-venue carry-over (gamma)
    assert pi.expected_gd("strong", "weak") > 1.0
    before = pi.H["strong"]
    pi.update("strong", "weak", 0, 4)  # a shock result pulls it back, with diminishing weight for the margin
    assert before - 0.2 < pi.H["strong"] < before


def test_goal_market_probabilities_match_the_score_matrix():
    over, btts = goal_markets(1.6, 1.1, -0.05)
    assert 0.45 < over < 0.6 and 0.45 < btts < 0.6
    low_over, _ = goal_markets(0.8, 0.6, -0.05)
    assert low_over < 0.2
    ph, pd, pa = outcome_probs(1.6, 1.1, -0.05)
    assert abs(ph + pd + pa - 1) < 1e-9
