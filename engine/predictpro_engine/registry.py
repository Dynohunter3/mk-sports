"""Sport -> model lookup. New sports register here; leagues configure them via params."""

from __future__ import annotations

from typing import Mapping, Optional

from .basketball import BasketballModel
from .football import FootballModel

MODELS = {
    FootballModel.sport: FootballModel,
    BasketballModel.sport: BasketballModel,
    # Phase 2: "cricket": CricketModel (format-specific ratings, toss & venue),
    #          "tennis": TennisModel (surface-specific Elo)
    # Phase 3: "formula1": F1Model (driver + constructor ratings), etc.
}


class UnsupportedSport(KeyError):
    pass


def supported_sports() -> list[str]:
    return sorted(MODELS)


def get_model(sport: str, params: Optional[Mapping] = None, league_params: Optional[Mapping[str, Mapping]] = None):
    try:
        cls = MODELS[sport]
    except KeyError as exc:
        raise UnsupportedSport(f"no prediction model for sport '{sport}' (supported: {supported_sports()})") from exc
    return cls(params=params, league_params=league_params)
