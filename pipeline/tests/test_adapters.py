from datetime import datetime, timezone

import pytest

from conftest import FakeClock, FakeTransport
from mkdata.adapters import FootballDataUK, OpenFootball, TheOddsAPI, Unsupported
from mkdata.http import Blocked, HttpClient
from mkdata.timeutil import fd_preclosing_collected_at

CSV = (
    "﻿Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,FTR,Referee,HS,AS,HST,AST,HC,AC,PSH,PSD,PSA,PSCH,PSCD,PSCA,AvgH,AvgD,AvgA,AvgCH,AvgCD,AvgCA\n"
    "E0,16/08/2025,15:00,Man United,Arsenal,0,1,A,M Oliver,22,9,7,3,6,4,2.9,3.6,2.4,3.1,3.7,2.25,2.85,3.5,2.4,3.0,3.6,2.3\n"
    "E0,13/12/2025,15:00,Wolves,Chelsea,,,,,,,,,,,,,,,,,,,,,,\n"
)


def utc(*a):
    return datetime(*a, tzinfo=timezone.utc).timestamp()


def test_footballdata_parses_results_stats_and_odds(comps):
    a = FootballDataUK(HttpClient(), comps)
    rows = list(__import__("mkdata.adapters.footballdata_uk", fromlist=["parse_csv"]).parse_csv(CSV))
    res = a.parse_rows("eng.1", rows, fetched_at=utc(2026, 1, 1))
    m0, m1 = res.matches
    # 15:00 UK in August is BST (UTC+1); in December it is GMT
    assert m0["kickoff_utc"] == utc(2025, 8, 16, 14, 0) and m0["kickoff_exact"] == 1
    assert m1["kickoff_utc"] == utc(2025, 12, 13, 15, 0)
    assert (m0["status"], m0["home_score"], m0["away_score"]) == ("final", 0, 1)
    assert m1["status"] == "scheduled" and m1["home_score"] is None
    assert m0["season"] == "2025-26"
    # result known only after the match
    assert m0["available_at"] > m0["kickoff_utc"] + 2 * 3600
    kinds = {(o["bookmaker"], o["kind"]): o for o in res.odds}
    assert set(kinds) == {("pinnacle", "pre"), ("pinnacle", "closing"), ("market_avg", "pre"), ("market_avg", "closing")}
    assert kinds[("pinnacle", "closing")]["available_at"] == m0["kickoff_utc"]
    pre = kinds[("pinnacle", "pre")]["available_at"]
    assert pre < m0["kickoff_utc"]
    assert datetime.fromtimestamp(pre, timezone.utc).weekday() == 4  # collected on the Friday
    home = next(s for s in res.stats if s["side"] == "home")
    assert home["stats"]["shots"] == 22 and home["stats"]["shots_on_target"] == 7 and home["stats"]["referee"] == "M Oliver"


def test_preclosing_collection_rule_midweek():
    # Wednesday 19:45 UK kick-off -> collected Tuesday afternoon
    k = utc(2025, 10, 22, 18, 45)
    t = datetime.fromtimestamp(fd_preclosing_collected_at(k), timezone.utc)
    assert t.weekday() == 1 and t < datetime.fromtimestamp(k, timezone.utc)


def test_live_fixtures_never_label_unplayed_odds_closing(comps):
    a = FootballDataUK(HttpClient(), comps)
    from mkdata.adapters.footballdata_uk import parse_csv

    rows = parse_csv("Div,Date,Time,HomeTeam,AwayTeam,PSH,PSD,PSA,PSCH,PSCD,PSCA\nE0,07/11/2026,15:00,Leeds,Fulham,2.1,3.4,3.6,2.0,3.5,3.7\n")
    res = a.parse_rows("eng.1", rows, fetched_at=utc(2026, 11, 6), live=True)
    assert {o["kind"] for o in res.odds} == {"current"}
    assert all(o["available_at"] == utc(2026, 11, 6) for o in res.odds)


def test_openfootball_score_shapes_and_time_zones(comps):
    a = OpenFootball(HttpClient(), comps)
    doc = {"matches": [
        {"date": "2025-08-15", "time": "19:00", "team1": "Girona FC", "team2": "Rayo Vallecano", "score": {"ft": [1, 3]}},
        {"date": "2025-08-16", "time": "21:30", "team1": "Villarreal CF", "team2": "Real Oviedo", "score": [2, 0]},
        {"date": "2026-05-24", "time": "18:00 UTC+2", "team1": "A", "team2": "B"},
    ]}
    res = a.parse("esp.1", "2025-26", doc, fetched_at=utc(2026, 1, 1))
    m = res.matches
    assert m[0]["kickoff_utc"] == utc(2025, 8, 15, 17, 0)  # Madrid CEST
    assert (m[1]["home_score"], m[1]["away_score"]) == (2, 0)
    assert m[2]["status"] == "scheduled" and m[2]["kickoff_utc"] == utc(2026, 5, 24, 16, 0)


def test_openfootball_without_zone_is_date_only(comps):
    a = OpenFootball(HttpClient(), comps)
    res = a.parse("usa.1", "2025", {"matches": [{"date": "2025-02-22", "time": "16:45", "team1": "LAFC", "team2": "Minnesota", "score": {"ft": [1, 0]}}]}, 0.0)
    assert res.matches[0]["kickoff_exact"] == 0


def test_missing_season_file_is_coverage_not_outage(comps):
    t = FakeTransport({"https://raw.githubusercontent.com": [(404, "404: Not Found", {})]})
    a = OpenFootball(HttpClient(transport=t), comps)
    with pytest.raises(Unsupported):
        a.fetch_season("eng.1", "1999-00", max_age=None)


def test_odds_api_stops_at_credit_reserve(comps, monkeypatch):
    monkeypatch.setenv("THE_ODDS_API_KEY", "secret-key-123")
    body = '[{"id":"e1","commence_time":1793990000,"home_team":"Leeds United","away_team":"Fulham","bookmakers":[{"key":"pinnacle","markets":[{"key":"h2h","outcomes":[{"name":"Leeds United","price":2.1},{"name":"Fulham","price":3.6},{"name":"Draw","price":3.4}]}]}]}]'
    t = FakeTransport({"https://api.the-odds-api.com": [(200, body, {"x-requests-remaining": "40"})]})
    clock = FakeClock()
    a = TheOddsAPI(HttpClient(transport=t, clock=clock, sleep=clock.sleep), comps)
    res = a.fetch_upcoming(["eng.1"])
    assert res.odds[0]["bookmaker"] == "pinnacle" and res.odds[0]["draw"] == 3.4
    with pytest.raises(Blocked):
        a.fetch_upcoming(["esp.1"])  # 40 left <= reserve of 50
    assert len(t.calls) == 1
    assert "secret-key-123" not in res.matches[0]["source_key"]


def test_stale_fixture_list_cannot_erase_a_final_result(comps):
    """Regression: fixtures.csv kept last weekend's games and overwrote their final scores with 'scheduled'."""
    from mkdata.adapters.footballdata_uk import parse_csv
    from mkdata.store import Store

    a = FootballDataUK(HttpClient(), comps)
    season = parse_csv("Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,FTR\nE0,06/11/2026,20:00,Everton,Coventry,3,1,H\n")
    fixtures = parse_csv("Div,Date,Time,HomeTeam,AwayTeam,PSH,PSD,PSA\nE0,06/11/2026,20:00,Everton,Coventry,1.6,4.1,5.5\n"
                         "E0,14/11/2026,15:00,Leeds,Fulham,2.1,3.4,3.6\n")
    now = utc(2026, 11, 10, 19)
    s = Store(":memory:")
    s.upsert_source_matches(a.parse_rows("eng.1", season, now, season="2026-27").matches)
    live = a.parse_rows("eng.1", fixtures, now, live=True)
    assert [m["home_raw"] for m in live.matches] == ["Leeds"]  # the played match is not an upcoming fixture
    # even if a non-final row for it arrives (another path, an older client), the final score stays
    stale = dict(a.parse_rows("eng.1", season, now, season="2026-27").matches[0], status="scheduled", home_score=None, away_score=None)
    s.upsert_source_matches([stale])
    r = s.q("SELECT status, home_score, away_score FROM source_matches")[0]
    assert (r["status"], r["home_score"], r["away_score"]) == ("final", 3, 1)
