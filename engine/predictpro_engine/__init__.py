"""PredictPro prediction engine: explainable baseline models for match outcomes."""

from .basketball import BasketballModel, BasketballParams
from .evaluation import BacktestResult, Metrics, backtest, brier, evaluate, log_loss, should_promote, walk_forward
from .features import match_features
from .football import FootballModel, FootballParams
from .registry import UnsupportedSport, get_model, supported_sports
from .types import Absence, FinishedMatch, GameRecord, KeyFactor, MatchInput, Prediction, TeamState, outcome_of

__version__ = "1.0.0"

__all__ = [
    "Absence",
    "BacktestResult",
    "BasketballModel",
    "BasketballParams",
    "FinishedMatch",
    "FootballModel",
    "FootballParams",
    "GameRecord",
    "KeyFactor",
    "MatchInput",
    "Metrics",
    "Prediction",
    "TeamState",
    "UnsupportedSport",
    "backtest",
    "brier",
    "evaluate",
    "get_model",
    "log_loss",
    "match_features",
    "outcome_of",
    "should_promote",
    "supported_sports",
    "walk_forward",
]
