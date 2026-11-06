import pytest

from mkdata import monitor, validate
from mkdata.adapters.base import Adapter, FetchResult
from mkdata.fallback import BREAKER_FAILURES, run_chain
from mkdata.resolve import consensus_odds, devig
from mkdata.sources import REGISTRY, RESTRICTED, UNVERIFIED, EXCLUDED, usable_sources
from mkdata.store import LeakageError

from test_linker import GAMES, T0, DAY, league
from mkdata.linker import Linker


# -- point-in-time ---------------------------------------------------------------------------
def linked(store, ids, comps):
    league(store)
    Linker(store, ids, comps, now=T0 + 400 * DAY).run()


def test_results_only_visible_after_they_happened(store, ids, comps):
    linked(store, ids, comps)
    before = store.at(T0 + 1 * 3600).results("football")  # during the first matchday
    after = store.at(T0 + 3 * 3600).results("football")
    assert before == [] and len(after) == 2
    assert len(store.at(T0 + 25 * DAY).results("football")) == 8
    assert len(store.at(T0 + 300 * DAY).results("football")) == len(GAMES)


def test_closing_odds_invisible_until_kickoff(store, ids, comps):
    linked(store, ids, comps)
    mid = store.q("SELECT match_id, kickoff_utc FROM matches ORDER BY kickoff_utc, match_id LIMIT 1")[0]
    sm = store.q("SELECT mkey FROM source_matches WHERE match_id=? AND source='footballdata_uk'", mid["match_id"])[0]["mkey"]
    k = mid["kickoff_utc"]
    store.add_odds([
        {"match_key": sm, "source": "footballdata_uk", "bookmaker": "pinnacle", "kind": "pre", "home": 2.0, "draw": 3.5, "away": 4.0, "available_at": k - 86400, "fetched_at": k + 9e5},
        {"match_key": sm, "source": "footballdata_uk", "bookmaker": "pinnacle", "kind": "closing", "home": 1.9, "draw": 3.6, "away": 4.4, "available_at": k, "fetched_at": k + 9e5},
    ])
    seen = store.at(k - 60).odds(mid["match_id"])
    assert [r["kind"] for r in seen] == ["pre"]
    assert {r["kind"] for r in store.at(k + 1).odds(mid["match_id"])} == {"pre", "closing"}


def test_leakage_guard_raises(store):
    pit = store.at(100.0)
    with pytest.raises(LeakageError):
        pit._check([{"available_at": 100.0}])


# -- conflict rules for odds -----------------------------------------------------------------
def test_devig_and_consensus_prefers_pinnacle_and_flags_spread():
    p = devig(2.0, 3.5, 4.0)
    assert abs(sum(p) - 1) < 1e-12
    rows = [{"source": "s", "bookmaker": "pinnacle", "home": 2.0, "draw": 3.5, "away": 4.0},
            {"source": "s", "bookmaker": "bet365", "home": 1.6, "draw": 4.0, "away": 6.0}]
    probs, basis, sev, spread = consensus_odds(rows)
    assert basis == "pinnacle" and probs == p
    assert sev == "major" and spread > 0.08


# -- fallback ---------------------------------------------------------------------------------
class Fake(Adapter):
    def __init__(self, name, behaviour, usable=True):
        self.name, self.behaviour, self._usable = name, behaviour, usable

    def usable(self):
        return (True, "ok") if self._usable else (False, "no key")

    def fetch_season(self, comp_id, season):
        if isinstance(self.behaviour, Exception):
            raise self.behaviour
        return self.behaviour


def ok_result():
    r = FetchResult()
    r.matches.append({"x": 1})
    return r


def test_first_success_falls_back_and_logs(store):
    a = Fake("the_odds_api", RuntimeError("timeout"))
    b = Fake("footballdata_uk", ok_result())
    res = run_chain(store, "odds_current", "eng.1", [a, b], lambda x: x.fetch_season("eng.1", "2025-26"), mode="first_success")
    assert res.used == ["footballdata_uk"] and "the_odds_api" in res.failed and not res.degraded
    ev = store.q("SELECT failed_source, used_source FROM fallback_events")[0]
    assert (ev["failed_source"], ev["used_source"]) == ("the_odds_api", "footballdata_uk")


def test_all_sources_down_degrades_without_stopping(store):
    a = Fake("footballdata_uk", RuntimeError("down"))
    b = Fake("openfootball", FetchResult())  # empty counts as failure
    c = Fake("football_data_org", ok_result(), usable=False)
    res = run_chain(store, "fixtures_results", "eng.1/2026-27", [a, b, c], lambda x: x.fetch_season("eng.1", "2026-27"))
    assert res.degraded and res.used == [] and res.skipped == {"football_data_org": "no key"}
    assert store.q("SELECT severity FROM alerts WHERE kind='source_failure'")[0]["severity"] == "critical"


def test_circuit_breaker_skips_a_source_that_keeps_failing(store):
    a = Fake("footballdata_uk", RuntimeError("down"))
    b = Fake("openfootball", ok_result())
    for _ in range(BREAKER_FAILURES):
        run_chain(store, "r", "s", [a, b], lambda x: x.fetch_season("eng.1", "x"))
    res = run_chain(store, "r", "s", [a, b], lambda x: x.fetch_season("eng.1", "x"))
    assert res.skipped["footballdata_uk"].startswith("circuit open") and res.used == ["openfootball"]


# -- registry rules ---------------------------------------------------------------------------
def test_sources_with_forbidding_or_unread_terms_are_never_used(monkeypatch):
    for s in REGISTRY.values():
        if s.key_env:
            monkeypatch.setenv(s.key_env, "dummy")
    for s in REGISTRY.values():
        if s.terms_status in (RESTRICTED, UNVERIFIED, EXCLUDED):
            assert not s.usable()[0], s.name
    assert not REGISTRY["espn"].usable()[0] and not REGISTRY["nba_com"].usable()[0]
    names = [s.name for s in usable_sources("fixtures_results", "football")]
    assert names[0] == "football_data_org" and "espn" not in names


def test_keyed_sources_stay_off_without_keys(monkeypatch):
    monkeypatch.delenv("FOOTBALL_DATA_ORG_KEY", raising=False)
    assert REGISTRY["football_data_org"].usable() == (False, "no key in $FOOTBALL_DATA_ORG_KEY")


# -- validation -------------------------------------------------------------------------------
def test_rows_outside_their_season_are_quarantined(comps):
    good = {"source": "openfootball", "competition_id": "eng.3", "season": "2025-26", "local_date": "2026-01-01",
            "home_raw": "A", "away_raw": "B", "status": "final", "home_score": 1, "away_score": 0}
    bad = {**good, "local_date": "2025-01-01"}  # the openfootball League One wrong-year bug
    kept, dropped = validate.split([good, bad], comps)
    assert kept == [good] and sum(dropped.values()) == 1


# -- monitoring -------------------------------------------------------------------------------
def test_monitor_flags_stale_results_and_failing_sources(store, ids, comps, monkeypatch):
    monkeypatch.setenv("FOOTBALL_DATA_ORG_KEY", "dummy")
    league(store)
    # a next-season game that kicked off two days ago and still has no result anywhere
    store.upsert_source_matches([__import__("test_linker").row("footballdata_uk", 90, "Arsenal", "Wolves", season="2026-27")])
    Linker(store, ids, comps, now=T0 + 92 * DAY).run()
    for _ in range(3):
        store.log_run("football_data_org", "r", 0.0, False, 0, "HTTP 500")
    rep = monitor.check(store, now=T0 + 92 * DAY)
    kinds = {(a["kind"], a["subject"]) for a in rep["alerts"]}
    assert ("stale_data", "eng.1") in kinds and ("source_failure", "football_data_org") in kinds


def test_monitor_detects_accuracy_drop(store, ids, comps):
    linked(store, ids, comps)
    mids = [r["match_id"] for r in store.q("SELECT match_id FROM matches")]
    rows = [(f"p{i}", mids[i % len(mids)], "v1", 0.0, 0.4, 0.3, 0.3, "h", "test", "H", 1.20 + 0.01 * (i % 3), 0.6, float(i)) for i in range(120)]
    store.db.executemany("INSERT INTO predictions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
    out, alerts = monitor.accuracy_drop(store, {"eng.1": 1.00})
    assert out["eng.1"]["n"] == 120 and alerts and alerts[0].kind == "accuracy_drop"
    _, none = monitor.accuracy_drop(store, {"eng.1": 1.20})
    assert none == []
