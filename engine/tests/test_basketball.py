from datetime import timedelta

import pytest

from predictpro_engine import Absence, BasketballModel
from predictpro_engine.basketball import rest_days

from .helpers import T0, simulate_basketball_league


@pytest.fixture(scope="module")
def trained():
    model = BasketballModel()
    book = model.new_book()
    matches, strength = simulate_basketball_league()
    book.update_many(matches)
    return model, book, strength


def _predict(model, book, h, a, hours=48, **kw):
    return model.predict(book.build_input(h, a, book.last_date + timedelta(hours=hours), "SIMB", home_name=h, away_name=a, **kw))


def test_no_draws_and_valid_probabilities(trained):
    model, book, _ = trained
    p = _predict(model, book, "B00", "B01")
    assert p.prob_draw is None
    assert p.prob_home + p.prob_away == pytest.approx(1.0, abs=1e-6)
    assert "draw" not in p.probabilities()
    assert p.predicted_home != p.predicted_away


def test_predicted_score_matches_favourite(trained):
    model, book, strength = trained
    best, worst = max(strength, key=strength.get), min(strength, key=strength.get)
    p = _predict(model, book, worst, best)
    assert p.prob_away > 0.5
    assert p.predicted_away > p.predicted_home
    assert 150 < p.predicted_home + p.predicted_away < 300


def test_home_court_matters(trained):
    model, book, _ = trained
    a = _predict(model, book, "B02", "B03")
    neutral = _predict(model, book, "B02", "B03", neutral=True)
    assert a.prob_home > neutral.prob_home


def test_back_to_back_penalty(trained):
    model, book, _ = trained
    home = "B04"
    rested = _predict(model, book, home, "B05", hours=72)
    # Pretend the home side played 24h before tip-off
    inp = book.build_input(home, "B05", book.last_date + timedelta(hours=72), "SIMB", home_name=home, away_name="B05")
    inp.home.last_played = inp.kickoff - timedelta(hours=24)
    b2b = model.predict(inp)
    assert b2b.prob_home < rested.prob_home
    assert any("back-to-back" in f.text for f in b2b.key_factors)


def test_star_absence(trained):
    model, book, _ = trained
    base = _predict(model, book, "B06", "B07")
    hurt = _predict(model, book, "B06", "B07", home_absences=[Absence("A. Star", "F", 1.0, "injured", "star")])
    assert hurt.prob_home < base.prob_home
    assert any("A. Star" in f.text for f in hurt.key_factors)


def test_rest_days():
    assert rest_days(None, T0) is None
    assert rest_days(T0, T0 + timedelta(hours=24)) == 0
    assert rest_days(T0, T0 + timedelta(hours=48)) == 1
    assert rest_days(T0, T0 + timedelta(hours=75)) == 2


def test_key_factors_and_confidence(trained):
    model, book, _ = trained
    p = _predict(model, book, "B08", "B09")
    assert 3 <= len(p.key_factors) <= 5
    assert p.confidence in ("low", "medium", "high")
    assert p.explanation["method"].startswith("Elo")
