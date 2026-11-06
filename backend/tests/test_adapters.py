"""Real-provider adapters, tested against payloads shaped like the providers' documented responses."""

import json

import httpx

from app.cache import MemoryCache, reset_cache
from app.providers.api_sports import ApiSportsProvider, map_basketball_game, map_football_fixture, season_param
from app.providers.base import LeagueRef
from app.providers.football_data import FootballDataProvider, map_match

FD_MATCH = {
    "id": 537000, "utcDate": "2026-11-08T15:00:00Z", "status": "IN_PLAY", "minute": 67, "matchday": 11, "stage": "REGULAR_SEASON",
    "season": {"startDate": "2026-08-15", "endDate": "2027-05-23"},
    "homeTeam": {"id": 57, "name": "Arsenal FC", "shortName": "Arsenal", "tla": "ARS", "crest": "https://crests.football-data.org/57.png"},
    "awayTeam": {"id": 61, "name": "Chelsea FC", "shortName": "Chelsea", "tla": "CHE", "crest": "https://crests.football-data.org/61.png"},
    "score": {"winner": None, "fullTime": {"home": 2, "away": 1}, "halfTime": {"home": 1, "away": 0}},
}

AS_FIXTURE = {
    "fixture": {"id": 1208000, "date": "2026-11-08T15:00:00+00:00", "venue": {"name": "Emirates Stadium", "city": "London"}, "status": {"short": "2H", "elapsed": 67, "extra": None}},
    "league": {"id": 39, "season": 2026, "round": "Regular Season - 11"},
    "teams": {"home": {"id": 42, "name": "Arsenal", "logo": "x"}, "away": {"id": 49, "name": "Chelsea", "logo": "y"}},
    "goals": {"home": 2, "away": 1},
    "score": {"halftime": {"home": 1, "away": 0}},
    "events": [
        {"time": {"elapsed": 12, "extra": None}, "team": {"id": 42}, "player": {"name": "B. Saka"}, "type": "Goal", "detail": "Normal Goal"},
        {"time": {"elapsed": 50, "extra": None}, "team": {"id": 42}, "player": {"name": "W. Saliba"}, "type": "Goal", "detail": "Own Goal"},
        {"time": {"elapsed": 60, "extra": None}, "team": {"id": 49}, "player": {"name": "C. Palmer"}, "type": "Card", "detail": "Yellow Card"},
        {"time": {"elapsed": 61, "extra": None}, "team": {"id": 49}, "player": {"name": "C. Palmer"}, "type": "Goal", "detail": "Missed Penalty"},
    ],
}

AS_GAME = {
    "id": 400100, "date": "2026-11-08T00:30:00+00:00", "status": {"short": "FT", "timer": None},
    "league": {"id": 12, "season": "2026-2027"},
    "teams": {"home": {"id": 133, "name": "Boston Celtics"}, "away": {"id": 145, "name": "Los Angeles Lakers"}},
    "scores": {"home": {"quarter_1": 30, "quarter_2": 25, "quarter_3": 28, "quarter_4": 27, "over_time": None, "total": 110},
               "away": {"quarter_1": 22, "quarter_2": 31, "quarter_3": 24, "quarter_4": 25, "over_time": None, "total": 102}},
}


def test_football_data_mapping():
    m = map_match(FD_MATCH, "premier-league")
    assert (m.status, m.clock, m.home_score, m.away_score) == ("live", "67'", 2, 1)
    assert m.home.ref == "57" and m.home.code == "ARS" and m.season == "2026/27" and m.round == "Matchday 11"
    scheduled = map_match({**FD_MATCH, "status": "TIMED", "score": {"fullTime": {"home": None, "away": None}}}, "premier-league")
    assert scheduled.status == "scheduled" and scheduled.home_score is None
    assert map_match({**FD_MATCH, "status": "PAUSED"}, "x").clock == "HT"


def test_api_football_mapping_and_events():
    m = map_football_fixture(AS_FIXTURE, "premier-league")
    assert (m.status, m.clock, m.home_score, m.away_score, m.round) == ("live", "67'", 2, 1, "Round 11")
    kinds = [(e.type, e.side) for e in m.events]
    # own goal by a home player is credited to the away side; missed penalties are ignored
    assert kinds == [("goal", "home"), ("own_goal", "away"), ("yellow_card", "away")]


def test_api_basketball_mapping():
    m = map_basketball_game(AS_GAME, "nba")
    assert (m.status, m.home_score, m.away_score, m.clock) == ("finished", 110, 102, "FT")
    assert m.score_detail["quarters"][0] == [30, 22]


def test_season_params():
    from datetime import datetime, timezone

    nov = datetime(2026, 11, 3, tzinfo=timezone.utc)
    assert season_param("football", nov) == "2026"
    assert season_param("basketball", nov) == "2026-2027"
    assert season_param("football", datetime(2027, 3, 1, tzinfo=timezone.utc)) == "2026"
    assert season_param("football", nov, "calendar") == "2026"


def test_http_layer_sends_key_caches_and_retries():
    reset_cache(MemoryCache())
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if len(calls) == 1:
            return httpx.Response(429, headers={"Retry-After": "0"})
        return httpx.Response(200, json={"matches": [FD_MATCH]})

    prov = FootballDataProvider("secret-key", per_minute=600, transport=httpx.MockTransport(handler))
    lg = LeagueRef("football", "premier-league", "PL")
    from datetime import datetime, timezone

    lo, hi = datetime(2026, 11, 1, tzinfo=timezone.utc), datetime(2026, 11, 10, tzinfo=timezone.utc)
    first = prov.fetch_fixtures(lg, lo, hi)
    again = prov.fetch_fixtures(lg, lo, hi)  # served from cache
    assert len(first) == len(again) == 1
    assert len(calls) == 2  # one 429 retry + one success, then cached
    assert calls[-1].headers["X-Auth-Token"] == "secret-key"
    assert calls[-1].url.params["dateFrom"] == "2026-11-01"
    reset_cache(None)


def test_api_sports_live_uses_one_bulk_request():
    reset_cache(MemoryCache())
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(200, json={"response": [AS_FIXTURE]})

    prov = ApiSportsProvider("k", per_minute=600, transport=httpx.MockTransport(handler))
    out = prov.fetch_live([LeagueRef("football", "premier-league", {"league": 39}), LeagueRef("football", "la-liga", {"league": 140})], ["1208000"])
    assert len(out) == 1 and out[0].league_slug == "premier-league"
    assert len(seen) == 1 and "live=39-140" in seen[0]
    reset_cache(None)
    json.dumps(AS_GAME)  # payload fixtures stay JSON-serialisable
