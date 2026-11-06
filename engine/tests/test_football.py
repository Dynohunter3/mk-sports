from datetime import timedelta

import pytest

from predictpro_engine import Absence, FootballModel, get_model
from predictpro_engine.book import RatingBook
from predictpro_engine.factors import h2h_factor

from .helpers import T0, fm, simulate_football_league


@pytest.fixture
def trained():
    model = FootballModel()
    book = model.new_book()
    matches, strength = simulate_football_league(n_teams=16, seasons=2)
    book.update_many(matches)
    return model, book, strength, matches


def _predict(model, book, home, away, **kw):
    kickoff = book.last_date + timedelta(days=3)
    return model.predict(book.build_input(home, away, kickoff, "SIM", home_name=f"Team {home}", away_name=f"Team {away}", **kw))


def test_probabilities_are_valid(trained):
    model, book, *_ = trained
    p = _predict(model, book, "T00", "T01")
    assert p.prob_home + p.prob_draw + p.prob_away == pytest.approx(1.0, abs=1e-3)
    assert all(0 < x < 1 for x in (p.prob_home, p.prob_draw, p.prob_away))
    assert p.model == "football-elo-poisson"


def test_stronger_team_is_favoured(trained):
    model, book, strength, _ = trained
    best = max(strength, key=strength.get)
    worst = min(strength, key=strength.get)
    p = _predict(model, book, best, worst)
    assert p.prob_home > 0.6
    assert p.most_likely() == "home"
    assert p.predicted_home > p.predicted_away


def test_ratings_recover_true_strength(trained):
    _, book, strength, _ = trained
    elo = dict(book.ratings_table())
    teams = sorted(strength)
    # Spearman rank correlation between learned Elo and the hidden true strength
    def ranks(values):
        order = sorted(teams, key=values.get)
        return {t: i for i, t in enumerate(order)}
    re_, rs = ranks(elo), ranks(strength)
    n = len(teams)
    rho = 1 - 6 * sum((re_[t] - rs[t]) ** 2 for t in teams) / (n * (n * n - 1))
    assert rho > 0.7
    # the strongest team must finish in the Elo top 3
    assert max(strength, key=strength.get) in [t for t, _ in book.ratings_table()[:3]]


def test_home_advantage_and_neutral_venue(trained):
    model, book, *_ = trained
    home = _predict(model, book, "T03", "T04")
    swapped = _predict(model, book, "T04", "T03")
    # Each side does better at home than away
    assert home.prob_home > swapped.prob_away
    neutral_ab = _predict(model, book, "T03", "T04", neutral=True)
    neutral_ba = _predict(model, book, "T04", "T03", neutral=True)
    assert neutral_ab.prob_home == pytest.approx(neutral_ba.prob_away, abs=0.02)


def test_absences_lower_win_probability(trained):
    model, book, *_ = trained
    base = _predict(model, book, "T05", "T06")
    hurt = _predict(
        model,
        book,
        "T05",
        "T06",
        home_absences=[Absence("K. Mensah", "FWD", 1.0, "injured", "top_scorer"), Absence("J. Silva", "GK", 0.6, "suspended")],
    )
    assert hurt.prob_home < base.prob_home
    assert hurt.expected_home < base.expected_home
    texts = " ".join(f.text for f in hurt.key_factors)
    assert "top scorer K. Mensah is injured" in texts
    assert any(s["title"] == "Team news" for s in hurt.explanation["steps"])


def test_doubtful_counts_half():
    assert Absence("x", "FWD", 0.8, "doubtful").weight == pytest.approx(0.4)
    assert Absence("x", "FWD", 0.8, "injured").weight == pytest.approx(0.8)


def test_key_factors_count_and_shape(trained):
    model, book, strength, _ = trained
    for h, a in [("T00", "T01"), ("T02", "T07"), ("T08", "T09")]:
        p = _predict(model, book, h, a)
        assert 3 <= len(p.key_factors) <= 5
        assert all(f.favours in ("home", "away", "neutral") for f in p.key_factors)
        assert len({f.text for f in p.key_factors}) == len(p.key_factors)


def test_explanation_and_serialisation(trained):
    model, book, *_ = trained
    p = _predict(model, book, "T00", "T01")
    d = p.to_dict()
    assert d["explanation"]["method"].startswith("Elo")
    assert d["explanation"]["summary"]
    assert {"elo_home", "expected_goals_home"} <= set(d["explanation"]["inputs"])
    assert isinstance(d["key_factors"][0]["text"], str)


def test_confidence_is_low_with_no_history():
    model = FootballModel()
    book = model.new_book()
    p = model.predict(book.build_input("A", "B", T0, home_name="A", away_name="B"))
    assert p.confidence == "low"
    assert any("Limited data" in f.text for f in p.key_factors)


def test_predictions_are_deterministic(trained):
    model, book, *_ = trained
    assert _predict(model, book, "T00", "T01").to_dict() == _predict(model, book, "T00", "T01").to_dict()


def test_league_param_overrides():
    model = get_model("football", league_params={"BIG": {"home_advantage_elo": 120}})
    assert model.params_for("BIG").home_advantage_elo == 120
    assert model.params_for("OTHER").home_advantage_elo == 65
    with pytest.raises(ValueError):
        get_model("football", params={"home_advantge_elo": 1})  # typo is rejected


def test_book_requires_chronological_order():
    book = FootballModel().new_book()
    book.update(fm(2, "A", "B", 1, 0))
    with pytest.raises(ValueError):
        book.update(fm(1, "A", "B", 1, 0))


def test_form_and_h2h_tracking():
    book: RatingBook = FootballModel().new_book()
    for i in range(1, 9):
        book.update(fm(i, "A", f"X{i}", 2, 0))  # A wins 8 in a row
    for i in range(9, 13):
        book.update(fm(i, "A", "B", 1, 0) if i % 2 else fm(i, "B", "A", 0, 2))
    st = book.team_state("A", "Alpha")
    assert [r.result for r in st.recent[:5]] == ["W"] * 5
    assert len(book.head_to_head("A", "B")) == 4
    assert book.head_to_head("A", "B")[0].id == "12"  # newest first
    p = FootballModel().predict(book.build_input("A", "B", T0 + timedelta(days=20), home_name="Alpha", away_name="Beta"))
    texts = [f.text for f in p.key_factors]
    assert "Alpha have won 12 in a row" in texts  # streaks are not capped by the 10-game window
    h2h = h2h_factor(book.head_to_head("A", "B"), book.team_state("A", "Alpha"), book.team_state("B", "Beta"))
    assert h2h is not None and h2h.text == "Alpha won 4 of the last 4 meetings" and h2h.favours == "home"


def test_season_gap_regresses_ratings():
    book = FootballModel().new_book()
    for i in range(1, 15):
        book.update(fm(i, "A", "B", 3, 0))
    before = book.rating("A")
    book.update(fm(200, "A", "C", 1, 1, days=200))
    assert book.rating("A") < before  # regressed toward 1500 after a 186-day break
