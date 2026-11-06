from .balldontlie import BallDontLie
from .base import Adapter, FetchResult, Unsupported, load_competitions
from .clubelo import ClubElo
from .football_data_org import FootballDataOrg
from .footballdata_uk import FootballDataUK
from .openfootball import OpenFootball
from .the_odds_api import TheOddsAPI

ADAPTERS: dict[str, type[Adapter]] = {
    a.name: a for a in (FootballDataOrg, FootballDataUK, OpenFootball, TheOddsAPI, BallDontLie, ClubElo)
}

__all__ = ["ADAPTERS", "Adapter", "FetchResult", "Unsupported", "load_competitions"]
