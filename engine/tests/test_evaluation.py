import math

import pytest

from predictpro_engine import BasketballModel, FootballModel, Metrics, backtest, brier, evaluate, log_loss, match_features, should_promote
from predictpro_engine.backtest import main as backtest_main
from predictpro_engine.confidence import ConfidenceThresholds, confidence_level
from predictpro_engine.factors import select_factors
from predictpro_engine.types import KeyFactor

from .helpers import simulate_basketball_league, simulate_football_league


def test_metric_values():
    probs = {"home": 0.5, "draw": 0.3, "away": 0.2}
    assert log_loss(probs, "home") == pytest.approx(-math.log(0.5))
    assert brier(probs, "home") == pytest.approx(0.25 + 0.09 + 0.04)
    assert brier({"home": 1.0, "draw": 0.0, "away": 0.0}, "home") == 0
    m = evaluate([(probs, "home"), (probs, "away")])
    assert m.n == 2 and m.accuracy == 0.5


def test_football_model_beats_base_rate():
    matches, _ = simulate_football_league(n_teams=16, seasons=2)
    res = backtest(FootballModel(), matches, warmup=120)
    assert res.model.n == len(matches) - 120
    assert res.model.log_loss < res.baseline.log_loss
    assert res.model.brier < res.baseline.brier
    assert res.model.accuracy > res.baseline.accuracy


def test_basketball_model_beats_base_rate():
    matches, _ = simulate_basketball_league(cycles=6)
    res = backtest(BasketballModel(), matches, warmup=100)
    assert res.model.log_loss < res.baseline.log_loss
    assert res.model.accuracy > res.baseline.accuracy


def test_promotion_gate_requires_all_three_metrics():
    base = Metrics(500, 1.00, 0.60, 0.48)
    ok, _ = should_promote(Metrics(500, 0.98, 0.59, 0.50), base)
    assert ok
    ok, reasons = should_promote(Metrics(500, 0.98, 0.59, 0.47), base)
    assert not ok and any("accuracy" in r for r in reasons)
    ok, reasons = should_promote(Metrics(50, 0.90, 0.50, 0.60), base)
    assert not ok and any("not enough" in r for r in reasons)


def test_confidence_levels():
    t = ConfidenceThresholds(high=0.6, medium=0.45, min_games=5)
    assert confidence_level(0.65, t, 10)[0] == "high"
    assert confidence_level(0.50, t, 10)[0] == "medium"
    assert confidence_level(0.40, t, 10)[0] == "low"
    assert confidence_level(0.65, t, 2)[0] == "medium"  # limited data lowers it
    assert confidence_level(0.65, t, 2, components_disagree=True)[0] == "low"


def test_select_factors_caps_and_fills():
    many = [KeyFactor(f"form {i}", 0.9 - i / 10, "home", "form") for i in range(5)]
    chosen = select_factors(many + [KeyFactor("rating", 0.1, "home", "rating")])
    assert sum(1 for f in chosen if f.category == "form") == 2
    filled = select_factors([], [KeyFactor("a", 0.1, "neutral", "x"), KeyFactor("b", 0.1, "neutral", "y"), KeyFactor("c", 0.1, "neutral", "z")])
    assert len(filled) == 3


def test_features_are_numeric():
    matches, _ = simulate_football_league(n_teams=6, seasons=1)
    model = FootballModel()
    book = model.new_book()
    book.update_many(matches)
    feats = match_features(book.build_input("T00", "T01", matches[-1].date))
    assert all(isinstance(v, float) for v in feats.values())
    assert "elo_diff" in feats


def test_backtest_cli(tmp_path, capsys):
    matches, _ = simulate_football_league(n_teams=8, seasons=1)
    path = tmp_path / "m.csv"
    lines = ["date,home,away,home_score,away_score"] + [f"{m.date.isoformat()},{m.home},{m.away},{m.home_score},{m.away_score}" for m in matches]
    path.write_text("\n".join(lines))
    assert backtest_main([str(path), "--sport", "football", "--warmup", "10"]) == 0
    assert '"model"' in capsys.readouterr().out
