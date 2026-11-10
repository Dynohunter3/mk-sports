"""Step 4: versioned bundles, deterministic retrains, prediction log (recompute only on input change),
grading of the last pre-kick-off prediction, confidence."""

import json
import sqlite3

import numpy as np
import pytest

pytest.importorskip("lightgbm")

from mkdata.store import Store  # noqa: E402
from mkmodel import production as P  # noqa: E402
from mkmodel.data import load  # noqa: E402
from test_models import DAY, synthetic  # noqa: E402

COMPS = ["eng.1"]


def make_store(path, ms, upto_final: float):
    s = Store(path)
    for m in ms:
        final = m.t < upto_final
        s.db.execute("INSERT INTO matches VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                     (m.id, "football", m.comp, m.season, m.t, m.h, m.a, "final" if final else "scheduled",
                      m.hs if final else None, m.as_ if final else None, m.result_at if final else None, '["footballdata_uk"]', 1.0, 0.0))
        s.db.execute("""INSERT INTO source_matches (source, source_key, competition_id, season, kickoff_utc, kickoff_exact, local_date,
                        home_raw, away_raw, status, fetched_at, available_at, match_id, mkey) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                     ("footballdata_uk", m.id, m.comp, m.season, m.t, 1, "2020-01-01", m.h, m.a, "final", 0, 0, m.id, f"footballdata_uk:{m.id}"))
    s.db.commit()
    return s


@pytest.fixture
def world(tmp_path):
    ms = synthetic(seasons=3, seed=3)
    now = ms[-20].t - 3600  # the last 20 matches are still to play
    store_path = tmp_path / "s.sqlite"
    s = make_store(store_path, ms, now)
    s.close()
    cutoff = P.month_start(now)
    return {"ms": ms, "now": now, "store": store_path, "cutoff": cutoff, "models": tmp_path / "models", "pub": tmp_path / "pub"}


_BUNDLES = {}


def _retrain(w, fresh=False):
    """Bundles are deterministic, so tests share one per cutoff (fresh=True retrains for the determinism test)."""
    key = (w["cutoff"], fresh)
    if fresh or key not in _BUNDLES:
        _BUNDLES[key] = P.retrain(w["cutoff"], store=w["store"], out_root=w["models"], app_comps=COMPS, lower=[])
    return _BUNDLES[key]


def _predict(w, b, now=None, **kw):
    return P.predict(now or w["now"], store=w["store"], bundle=b, horizon_days=60, publish=w["pub"], app_comps=COMPS, lower=[], **kw)


def test_retrain_is_deterministic_and_versioned(world):
    b1 = _retrain(world)
    b2 = _retrain(world, fresh=True)
    assert b1.version == b2.version and b1.version.startswith("fb-")
    man = json.loads((world["models"] / b1.version / "manifest.json").read_text())
    assert man["data_version"] and man["code_hash"] and man["seed"] == 42
    assert man["cutoff"] == world["cutoff"]
    X = np.random.default_rng(0).normal(size=(5, len(P.FEATURES)))
    np.testing.assert_array_equal(b1.learn["gbm_mkt_predict"](X), b2.learn["gbm_mkt_predict"](X))


def test_predict_twice_writes_nothing_new(world):
    b = _retrain(world)
    first = _predict(world, b)
    assert first["new"] == first["considered"] > 0
    second = _predict(world, b, now=world["now"] + 60)
    assert second["new"] == 0 and second["unchanged"] == first["considered"]
    db = sqlite3.connect(world["store"])
    reasons = {r[0] for r in db.execute("SELECT reason FROM predictions")}
    assert reasons == {"first prediction"}
    doc = json.loads((world["pub"] / "football_predictions.json").read_text())
    assert doc["model_version"] == b.version and len(doc["matches"]) == first["considered"]
    assert all(abs(sum(m["p"].values()) - 1) < 1e-3 for m in doc["matches"])
    for m in doc["matches"]:
        assert m["call"]["pick"] in ("home", "draw", "away") and m["call"]["tier"] in ("strong", "likely", "lean", "toss-up")
        assert m["call"]["double_chance"]["probability"] >= max(m["p"].values())
        assert m["goals"]["over25"] is None or 0 < m["goals"]["over25"] < 1
    logged = db.execute("SELECT pick, tier, dc_call, p_over25 FROM predictions LIMIT 1").fetchone()
    assert logged[0] in ("home", "draw", "away") and logged[1] and logged[2]


def test_odds_arrival_triggers_a_logged_recompute(world):
    b = _retrain(world)
    _predict(world, b)
    target = next(m for m in world["ms"] if m.t > world["now"])
    db = sqlite3.connect(world["store"])
    db.execute("INSERT INTO odds VALUES (?,?,?,?,?,?,?,?,?)",
               (f"footballdata_uk:{target.id}", "footballdata_uk", "pinnacle", "current", 2.0, 3.5, 4.0, world["now"] + 100, world["now"] + 100))
    db.commit()
    out = _predict(world, b, now=world["now"] + 200)
    assert out["new"] == 1 and out["reasons"] == {"bookmaker odds published": 1}
    row = db.execute("SELECT variant, confidence_reasons FROM predictions WHERE match_id=? ORDER BY made_at DESC LIMIT 1", (target.id,)).fetchone()
    assert row[0] == "with odds" and "no bookmaker odds yet" not in json.loads(row[1])


def test_new_result_changes_ratings_and_is_explained(world):
    b = _retrain(world)
    _predict(world, b)
    nxt = next(m for m in world["ms"] if m.t > world["now"])
    db = sqlite3.connect(world["store"])
    db.execute("UPDATE matches SET status='final', home_score=?, away_score=?, result_available_at=? WHERE match_id=?",
               (nxt.hs, nxt.as_, nxt.result_at, nxt.id))
    db.commit()
    out = _predict(world, b, now=nxt.result_at + 60)
    assert out["new"] > 0 and any("new results updated the ratings" in r for r in out["reasons"])


def test_grade_uses_last_prediction_before_kickoff(world):
    b = _retrain(world)
    _predict(world, b)
    nxt = next(m for m in world["ms"] if m.t > world["now"])
    db = sqlite3.connect(world["store"])
    # an odds update just before kick-off creates the official (last pre-kick-off) prediction
    db.execute("INSERT INTO odds VALUES (?,?,?,?,?,?,?,?,?)",
               (f"footballdata_uk:{nxt.id}", "footballdata_uk", "pinnacle", "current", 1.8, 3.6, 4.5, nxt.t - 2700, nxt.t - 2700))
    db.commit()
    _predict(world, b, now=nxt.t - 1800)
    assert _predict(world, b, now=nxt.t + 60)["considered"] < 20  # started matches are never predicted
    db.execute("UPDATE matches SET status='final', home_score=?, away_score=?, result_available_at=? WHERE match_id=?",
               (nxt.hs, nxt.as_, nxt.result_at, nxt.id))
    db.commit()
    assert P.grade(nxt.result_at + 1, store=world["store"])["graded"] == 1
    rows = db.execute("SELECT made_at, official, log_loss FROM predictions WHERE match_id=? ORDER BY made_at", (nxt.id,)).fetchall()
    assert [r[1] for r in rows] == [0, 1] and rows[1][0] == nxt.t - 1800 and rows[1][2] > 0
    assert P.grade(nxt.result_at + 2, store=world["store"])["graded"] == 0  # idempotent


def test_confidence_drops_for_missing_odds_shots_and_disagreement():
    x = np.full(len(P.FEATURES), 1.0)
    comps = {k: np.array([[0.5, 0.3, 0.2]]) for k in ("elo", "dc", "gbm_nomkt")}
    full, why = P.confidence(x, comps, 0, {})
    assert full == 1.0 and why == [] and P.label(full) == "high"
    nomk = x.copy()
    nomk[P.COL["mk_h"]] = np.nan
    s_nomk, why_nomk = P.confidence(nomk, comps, 0, {})
    assert s_nomk == 0.8 and why_nomk == ["no bookmaker odds yet"] and P.label(s_nomk) == "medium"
    dis = dict(comps, dc=np.array([[0.85, 0.1, 0.05]]))
    s_dis, why_dis = P.confidence(nomk, dis, 0, {"source_conflict": True, "stale_league": True})
    assert s_dis < 0.6 and P.label(s_dis) == "low" and "component models disagree strongly" in why_dis
    # a small history alone is not penalised: no measurable effect in the selection season
    cold = x.copy()
    cold[P.COL["games_a"]] = 2
    assert P.confidence(cold, comps, 0, {})[0] == 1.0


def test_as_of_load_hides_later_results(world):
    ms = load(world["store"], comps=COMPS, as_of=world["now"] - 30 * DAY)
    late = [m for m in ms if m.t > world["now"] - 30 * DAY - 3 * 3600]
    assert late and all(m.outcome is None for m in late)
