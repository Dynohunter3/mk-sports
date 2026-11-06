"""Metrics, walk-forward backtesting and the model-promotion gate."""

from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass, field
from typing import Callable, Iterable, Optional, Sequence

from .types import FinishedMatch, Outcome, Prediction

EPS = 1e-12


def log_loss(probs: dict[str, float], outcome: str) -> float:
    return -math.log(max(EPS, probs.get(outcome, 0.0)))


def brier(probs: dict[str, float], outcome: str) -> float:
    """Multi-class Brier score: sum over classes of (p - observed)^2. 0 is perfect."""
    return sum((p - (1.0 if k == outcome else 0.0)) ** 2 for k, p in probs.items())


def is_correct(probs: dict[str, float], outcome: str) -> bool:
    return max(probs, key=probs.get) == outcome


@dataclass
class Metrics:
    n: int = 0
    log_loss: float = 0.0
    brier: float = 0.0
    accuracy: float = 0.0

    def to_dict(self) -> dict:
        return {"n": self.n, "log_loss": round(self.log_loss, 4), "brier": round(self.brier, 4), "accuracy": round(self.accuracy, 4)}


def evaluate(pairs: Iterable[tuple[dict[str, float], str]]) -> Metrics:
    n = ll = br = acc = 0.0
    for probs, outcome in pairs:
        n += 1
        ll += log_loss(probs, outcome)
        br += brier(probs, outcome)
        acc += 1.0 if is_correct(probs, outcome) else 0.0
    if n == 0:
        return Metrics()
    return Metrics(int(n), ll / n, br / n, acc / n)


class BaseRateModel:
    """Naive baseline: the historical frequency of home/draw/away, learned walk-forward."""

    def __init__(self, has_draws: bool):
        self.has_draws = has_draws
        self.counts: Counter[str] = Counter({"home": 1, "away": 1, **({"draw": 1} if has_draws else {})})

    def probs(self) -> dict[str, float]:
        total = sum(self.counts.values())
        return {k: v / total for k, v in self.counts.items()}

    def update(self, outcome: str) -> None:
        self.counts[outcome] += 1


@dataclass
class BacktestResult:
    model: Metrics
    baseline: Metrics
    predictions: list[tuple[FinishedMatch, Prediction]] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"model": self.model.to_dict(), "baseline": self.baseline.to_dict()}


def walk_forward(
    model,
    matches: Sequence[FinishedMatch],
    on_prediction: Optional[Callable[[FinishedMatch, Prediction], None]] = None,
    names: Optional[dict[str, str]] = None,
    book=None,
):
    """Predict each match using only information available before it, then learn from it."""
    book = book or model.new_book()
    names = names or {}
    for m in sorted(matches, key=lambda x: (x.date, x.id)):
        inp = book.build_input(m.home, m.away, m.date, m.competition, m.neutral, home_name=names.get(m.home), away_name=names.get(m.away))
        pred = model.predict(inp)
        if on_prediction:
            on_prediction(m, pred)
        book.update(m)
    return book


def backtest(model, matches: Sequence[FinishedMatch], warmup: int = 0, keep_predictions: bool = False) -> BacktestResult:
    """Walk-forward backtest vs the base-rate baseline. The first `warmup` matches only train."""
    base = BaseRateModel(model.has_draws)
    model_pairs: list[tuple[dict[str, float], str]] = []
    base_pairs: list[tuple[dict[str, float], str]] = []
    kept: list[tuple[FinishedMatch, Prediction]] = []
    seen = 0

    def collect(m: FinishedMatch, pred: Prediction) -> None:
        nonlocal seen
        outcome: Outcome = m.outcome
        if not model.has_draws and outcome == "draw":
            seen += 1
            return
        if seen >= warmup:
            model_pairs.append((pred.probabilities(), outcome))
            base_pairs.append((base.probs(), outcome))
            if keep_predictions:
                kept.append((m, pred))
        base.update(outcome)
        seen += 1

    walk_forward(model, matches, collect)
    return BacktestResult(evaluate(model_pairs), evaluate(base_pairs), kept)


def should_promote(candidate: Metrics, baseline: Metrics, min_matches: int = 300) -> tuple[bool, list[str]]:
    """Phase 3 gate: an ML model replaces the baseline only if it wins on ALL three metrics."""
    reasons: list[str] = []
    if candidate.n < min_matches:
        reasons.append(f"not enough backtest matches ({candidate.n} < {min_matches})")
    if not candidate.log_loss < baseline.log_loss:
        reasons.append(f"log loss {candidate.log_loss:.4f} is not better than {baseline.log_loss:.4f}")
    if not candidate.brier < baseline.brier:
        reasons.append(f"Brier {candidate.brier:.4f} is not better than {baseline.brier:.4f}")
    if not candidate.accuracy > baseline.accuracy:
        reasons.append(f"accuracy {candidate.accuracy:.3f} is not better than {baseline.accuracy:.3f}")
    return (not reasons), reasons
