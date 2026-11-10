"""Step 4: versioned models, a fixed retrain schedule, a prediction log, grading and confidence.

Retrain schedule: one model bundle per calendar month, trained at 00:00 UTC on the 1st on everything
known before that moment. This is exactly the monthly refit the Step 3 backtest evaluated.

A bundle is identified by ``fb-YYYY-MM-<hash>``. The hash covers the code, the configuration and the
training data, so the same inputs always produce the same version and the same predictions.

Predictions: the daily job predicts every scheduled match in the next ``horizon`` days. A new row is
written to the log only when the inputs hash changes (model version, ratings or results, odds,
kick-off time), and the row records which inputs changed. The prediction graded for a match is the
last one made before kick-off.

    python -m mkmodel.production retrain [--cutoff 2026-11-01] [--if-due]
    python -m mkmodel.production predict [--now ...] [--horizon 10]
    python -m mkmodel.production grade
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sqlite3
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from . import learners as L
from .data import APP_LEAGUES, LOWER, STORE, M, load
from .experiment import GROUPS
from .goals_experiment import NON_MARKET, fit_gbm_binary, logit
from .picks import DRAW_RULE, describe
from .features import FEATURES, Config, EloParams, build

PIPE = Path(__file__).resolve().parents[1]
MODELS = PIPE / "var" / "models"
PUBLISH = PIPE / "var" / "publish"
# Same as the Step 6 backtest (audit/results/step6.json): history from 2015, training rows from 2016
FEATURE_START = datetime(2015, 7, 1, tzinfo=timezone.utc).timestamp()
TRAIN_FROM = datetime(2016, 8, 1, tzinfo=timezone.utc).timestamp()
# feature groups kept by the Step 6 selection (pi-ratings were tried and dropped)
KEPT_GROUPS = ("elo+context", "dc", "xg_proxy", "form", "draw")
COL = {f: i for i, f in enumerate(FEATURES)}
# same column order as the evaluated models (feature groups in the order they were added)
GBM_NOMKT = [COL[f] for g in KEPT_GROUPS for f in GROUPS[g]]
GBM_MKT = GBM_NOMKT + [COL[f] for f in GROUPS["market_pre"]]
ATTRIBUTION = "Data: football-data.co.uk, openfootball (public domain)."
DAY = 86400.0


def month_start(t: float) -> float:
    d = datetime.fromtimestamp(t, timezone.utc)
    return datetime(d.year, d.month, 1, tzinfo=timezone.utc).timestamp()


def add_months(t: float, k: int) -> float:
    d = datetime.fromtimestamp(t, timezone.utc)
    m = d.month - 1 + k
    return datetime(d.year + m // 12, m % 12 + 1, 1, tzinfo=timezone.utc).timestamp()


def code_hash() -> str:
    h = hashlib.sha256()
    for f in sorted((PIPE / "mkmodel").glob("*.py")):
        if f.name not in ("experiment.py", "report.py", "export_ts.py", "confidence_check.py"):
            h.update(f.name.encode() + f.read_bytes())
    return h.hexdigest()[:12]


def data_fingerprint(ms: list[M], cutoff: float) -> tuple[str, int]:
    h, n = hashlib.sha256(), 0
    for m in ms:
        if m.result_at is not None and m.result_at < cutoff:
            n += 1
            h.update(json.dumps([m.id, m.comp, m.t, m.h, m.a, m.hs, m.as_, m.result_at, m.pre, m.pre_at,
                                 m.stats.get("home"), m.stats.get("away")], sort_keys=True, default=str).encode())
    return h.hexdigest()[:12], n


# ----------------------------------------------------------------------------------- shared prediction core
def base_predictions(X: np.ndarray, learn: dict) -> dict[str, np.ndarray]:
    """The component models for rows of X, using fitted learners."""
    P = {
        "elo": L.predict_ordered_logit(learn["elo_ol"], X),
        "dc": X[:, [COL["dc_h"], COL["dc_d"], COL["dc_a"]]],
        "dcx": X[:, [COL["dcx_h"], COL["dcx_d"], COL["dcx_a"]]],
        "gbm_nomkt": learn["gbm_nomkt_predict"](X),
        "gbm_mkt": learn["gbm_mkt_predict"](X),
        "market": X[:, [COL["mk_h"], COL["mk_d"], COL["mk_a"]]],
    }
    return P


def _fallback(P: dict[str, np.ndarray], name: str, chain: list[str]) -> np.ndarray:
    out = P[name].copy()
    for fb in chain:
        miss = ~np.all(np.isfinite(out), 1)
        if not miss.any():
            break
        out[miss] = P[fb][miss]
    return out


INPUTS_A = [("elo", []), ("dc", ["elo"]), ("dcx", ["dc", "elo"]), ("gbm_nomkt", [])]
INPUTS_B = INPUTS_A + [("market", ["gbm_nomkt"]), ("gbm_mkt", [])]


def logs(P: dict[str, np.ndarray], spec) -> np.ndarray:
    # the "dc" fallback for "dcx" must itself already be filled from "elo"
    filled = dict(P)
    filled["dc"] = _fallback(P, "dc", ["elo"])
    return np.stack([L.to_log(_fallback(filled, n, chain)) for n, chain in spec], 0)


def final_probs(P: dict[str, np.ndarray], blends: dict) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    A = L.blend_probs(blends["A"], logs(P, INPUTS_A), calibrate=True)
    B = L.blend_probs(blends["B"], logs(P, INPUTS_B), calibrate=False)
    has_odds = np.all(np.isfinite(P["market"]), 1)
    return np.where(has_odds[:, None], B, A), A, B, has_odds


# ----------------------------------------------------------------------------------- retrain
@dataclass
class Bundle:
    version: str
    manifest: dict
    learn: dict

    @classmethod
    def load(cls, folder: Path) -> "Bundle":
        man = json.loads((folder / "manifest.json").read_text())
        b_no = L.gbm_from_string((folder / "gbm_nomkt.txt").read_text())
        b_mk = L.gbm_from_string((folder / "gbm_mkt.txt").read_text())
        b_ou = L.gbm_from_string((folder / "gbm_over25.txt").read_text())
        learn = {"elo_ol": man["elo_ol"],
                 "gbm_nomkt_predict": lambda X, b=b_no: L.predict_booster(b, GBM_NOMKT, X),
                 "gbm_mkt_predict": lambda X, b=b_mk: L.predict_booster(b, GBM_MKT, X),
                 "over25_predict": lambda X, b=b_ou: b.predict(X[:, NON_MARKET])}
        return cls(man["version"], man, learn)


def _fit_learners(X, y, kick, res_at, cutoff):
    tr = (res_at < cutoff) & (kick >= TRAIN_FROM) & (y >= 0)
    ol = L.fit_ordered_logit(X[tr], y[tr], kick[tr], cutoff)
    g0 = L.fit_gbm(GBM_NOMKT, X[tr], y[tr], kick[tr], cutoff)
    g1 = L.fit_gbm(GBM_MKT, X[tr], y[tr], kick[tr], cutoff)
    learn = {"elo_ol": ol, "gbm_nomkt_predict": lambda Z: L.predict_gbm(g0, GBM_NOMKT, Z),
             "gbm_mkt_predict": lambda Z: L.predict_gbm(g1, GBM_MKT, Z)}
    return learn, g0, g1, int(tr.sum())


def over25_probs(X: np.ndarray, gbm_p: np.ndarray) -> np.ndarray:
    """Over 2.5 goals: boosted trees averaged (in logit space) with the two goals models. Chosen on the
    selection season in mkmodel.goals_experiment ('gbm+mix')."""
    dc = X[:, COL["dc_o25"]]
    dcx = np.where(np.isfinite(X[:, COL["dcx_o25"]]), X[:, COL["dcx_o25"]], dc)
    mix = 1 / (1 + np.exp(-(logit(dc) + logit(dcx)) / 2))
    mix = np.where(np.isfinite(mix), mix, gbm_p)
    return 1 / (1 + np.exp(-(logit(gbm_p) + logit(mix)) / 2))


def retrain(cutoff: float, store: Path = STORE, out_root: Path = MODELS, app_comps=None, lower=None) -> Bundle:
    t0 = time.time()
    app_comps = app_comps or APP_LEAGUES
    ms_all = load(store, comps=app_comps + (lower if lower is not None else LOWER), as_of=cutoff)
    X, ms = build(ms_all, Config(elo=EloParams(), start=FEATURE_START, as_of=cutoff))
    y = np.array([m.outcome if m.outcome is not None else -1 for m in ms])
    kick = np.array([m.t for m in ms])
    res_at = np.array([m.result_at if m.result_at is not None else np.inf for m in ms])
    app = np.array([m.comp in app_comps for m in ms])
    # out-of-sample predictions for the previous 12 months, each month from learners refitted at its start
    P_oos = {k: np.full((len(ms), 3), np.nan) for k in ("elo", "dc", "dcx", "gbm_nomkt", "gbm_mkt", "market")}
    for k in range(12, 0, -1):
        m0, m1 = add_months(cutoff, -k), add_months(cutoff, -k + 1)
        rows = app & (kick >= m0) & (kick < m1) & (y >= 0)
        if not rows.any() or ((res_at < m0) & (kick >= TRAIN_FROM)).sum() < 300:
            continue
        lm, *_ = _fit_learners(X, y, kick, res_at, m0)
        bp = base_predictions(X[rows], lm)
        for name, v in bp.items():
            P_oos[name][rows] = v
    win = app & (y >= 0) & (res_at < cutoff) & (kick >= cutoff - 365 * DAY) & np.all(np.isfinite(P_oos["elo"]), 1)
    sub = {k: v[win] for k, v in P_oos.items()}
    blends = {"A": L.fit_blend(logs(sub, INPUTS_A), y[win], calibrate=True),
              "B": L.fit_blend(logs(sub, INPUTS_B), y[win], calibrate=False)}
    learn, g0, g1, n_train = _fit_learners(X, y, kick, res_at, cutoff)
    goals_total = np.array([(m.hs + m.as_) if m.outcome is not None else -1 for m in ms])
    tr_g = (res_at < cutoff) & (kick >= TRAIN_FROM) & (y >= 0)
    g_ou = fit_gbm_binary(X[tr_g], (goals_total[tr_g] >= 3).astype(float), kick[tr_g], cutoff)
    data_version, n_rows = data_fingerprint(ms_all, cutoff)
    cfg = {"elo": EloParams().__dict__, "xi": Config(elo=EloParams()).xi, "refit_days": 7, "feature_start": FEATURE_START,
           "train_from": TRAIN_FROM, "features": FEATURES, "gbm_params": {k: v for k, v in L.GBM_PARAMS.items()},
           "inputs_A": INPUTS_A, "inputs_B": INPUTS_B, "competitions": app_comps, "lower": lower if lower is not None else LOWER,
           "kept_groups": KEPT_GROUPS, "draw_rule": DRAW_RULE, "over25": "gbm+mix"}
    ch = code_hash()
    vh = hashlib.sha256(json.dumps([ch, cfg, data_version, cutoff], sort_keys=True, default=str).encode()).hexdigest()[:8]
    version = f"fb-{datetime.fromtimestamp(cutoff, timezone.utc):%Y-%m}-{vh}"
    folder = out_root / version
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "gbm_nomkt.txt").write_text(L.gbm_to_string(g0))
    (folder / "gbm_mkt.txt").write_text(L.gbm_to_string(g1))
    (folder / "gbm_over25.txt").write_text(L.gbm_to_string(g_ou))
    man = {"version": version, "cutoff": cutoff, "cutoff_iso": datetime.fromtimestamp(cutoff, timezone.utc).isoformat(),
           "code_hash": ch, "data_version": data_version, "training_results": n_rows, "training_rows": n_train,
           "blend_rows": int(win.sum()), "elo_ol": learn["elo_ol"], "blends": blends, "config": cfg, "seed": L.SEED,
           "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "train_seconds": round(time.time() - t0)}
    (folder / "manifest.json").write_text(json.dumps(man, indent=1, sort_keys=True, default=str))
    (out_root / "current.json").write_text(json.dumps({"version": version}))
    return Bundle.load(folder)


def current_bundle(root: Path = MODELS) -> Bundle | None:
    p = root / "current.json"
    if not p.exists():
        return None
    try:
        return Bundle.load(root / json.loads(p.read_text())["version"])
    except (FileNotFoundError, KeyError):
        return None  # a bundle from an older model layout: treated as absent, so the next retrain replaces it


# ----------------------------------------------------------------------------------- confidence
# Penalties set from the 2024-25 selection season (audit/results/step4_confidence.json): only reasons
# whose matches were measurably further from the closing odds lower the score. Measured there:
#   no odds yet: gap to closing +0.029 (all matches +0.007)    no shot data: +0.029
#   component models disagree by >25 points on P(home): +0.017, excess loss +0.064
# Not penalised (no measurable effect): milder disagreement, <15 or <5 matches played, no league model.
# Required by the brief but not measurable in the backtest: source disagreement, disputed recent
# results, unconfirmed latest results.
PENALTY = {
    "no bookmaker odds yet": 0.8,
    "no shot data for this league": 0.9,
    "component models disagree strongly": 0.75,
    "sources disagree on this fixture": 0.8,
    "recent results for a team disagree between sources": 0.9,
    "latest league results not confirmed yet": 0.85,
}


def confidence(x: np.ndarray, comps: dict[str, np.ndarray], i: int, ctx: dict) -> tuple[float, list[str]]:
    """Start at 1 and multiply by the penalty of each reason that applies."""
    why = []
    if not np.isfinite(x[COL["mk_h"]]):
        why.append("no bookmaker odds yet")
    if not np.isfinite(x[COL["dcx_h"]]):
        why.append("no shot data for this league")
    homes = [comps[k][i, 0] for k in ("elo", "dc", "gbm_nomkt") if np.isfinite(comps[k][i, 0])]
    spread = max(homes) - min(homes) if len(homes) > 1 else 0.0
    if spread > 0.25:
        why.append("component models disagree strongly")
    if ctx.get("source_conflict"):
        why.append("sources disagree on this fixture")
    if ctx.get("recent_disputed", 0) > 0:
        why.append("recent results for a team disagree between sources")
    if ctx.get("stale_league"):
        why.append("latest league results not confirmed yet")
    score = float(np.prod([PENALTY[w] for w in why])) if why else 1.0
    return score, why


def label(score: float) -> str:
    return "high" if score >= 0.85 else "medium" if score >= 0.6 else "low"


# ----------------------------------------------------------------------------------- predict / log / grade
def ensure_log_columns(db: sqlite3.Connection) -> None:
    have = {r[1] for r in db.execute("PRAGMA table_info(predictions)")}
    for col, typ in (("inputs", "TEXT"), ("confidence", "REAL"), ("confidence_label", "TEXT"), ("confidence_reasons", "TEXT"),
                     ("variant", "TEXT"), ("official", "INTEGER"), ("pick", "TEXT"), ("tier", "TEXT"), ("dc_call", "TEXT"),
                     ("p_over25", "REAL")):
        if col not in have:
            db.execute(f"ALTER TABLE predictions ADD COLUMN {col} {typ}")
    db.commit()


def _inputs(m: M, x: np.ndarray, version: str) -> dict:
    r = lambda v: None if not np.isfinite(v) else round(float(v), 6)  # noqa: E731
    return {"model": version, "kickoff": m.t, "ratings": {k: r(x[COL[k]]) for k in ("elo_h", "elo_a", "dc_lh", "dc_la", "dcx_lh", "dcx_la")},
            "form": {k: r(x[COL[k]]) for k in ("games_h", "games_a", "lg_home", "lg_draw", "lg_goals")},
            "schedule": {k: r(x[COL[k]]) for k in ("rest_h", "rest_a", "busy_h", "busy_a")},
            "odds": {k: r(x[COL[k]]) for k in ("mk_h", "mk_d", "mk_a")}}


def _reason(old: dict | None, new: dict) -> str:
    if old is None:
        return "first prediction"
    out = []
    if old["model"] != new["model"]:
        out.append(f"new model version ({old['model']} -> {new['model']})")
    if old["kickoff"] != new["kickoff"]:
        out.append("kick-off time changed")
    if old["odds"] != new["odds"]:
        out.append("bookmaker odds published" if old["odds"]["mk_h"] is None else "bookmaker odds changed")
    if old["ratings"] != new["ratings"] or old["form"] != new["form"]:
        out.append("new results updated the ratings")
    if old["schedule"] != new["schedule"]:
        out.append("schedule changed (rest days / congestion)")
    return "; ".join(out) or "inputs changed"


def predict(now: float, store: Path = STORE, bundle: Bundle | None = None, horizon_days: float = 21.0,
            publish: Path | None = PUBLISH, app_comps=None, lower=None) -> dict:
    bundle = bundle or current_bundle()
    if bundle is None:
        raise SystemExit("no model bundle: run `python -m mkmodel.production retrain` first")
    app_comps = app_comps or APP_LEAGUES
    ms_all = load(store, comps=app_comps + (lower if lower is not None else LOWER), as_of=now)
    X, ms = build(ms_all, Config(elo=EloParams(), start=FEATURE_START, as_of=now))
    idx = [i for i, m in enumerate(ms) if m.comp in app_comps and m.outcome is None and now <= m.t < now + horizon_days * DAY]
    db = sqlite3.connect(store)
    db.row_factory = sqlite3.Row
    ensure_log_columns(db)
    summary = {"model": bundle.version, "now": now, "considered": len(idx), "new": 0, "unchanged": 0, "reasons": {}}
    if not idx:
        db.commit()
        return summary
    Xu = X[idx]
    comps = base_predictions(Xu, bundle.learn)
    Fp, A, B, has_odds = final_probs(comps, bundle.manifest["blends"])
    p_over = over25_probs(Xu, bundle.learn["over25_predict"](Xu))
    # source-quality context
    agreement = {r["match_id"]: r["agreement"] for r in db.execute("SELECT match_id, agreement FROM matches")}
    stale = {r[0] for r in db.execute(
        "SELECT DISTINCT competition_id FROM matches WHERE status!='final' AND kickoff_utc < ? AND kickoff_utc > ?", (now - 36 * 3600, now - 30 * DAY))}
    recent: dict[str, list[float]] = {}
    for m in ms_all:
        if m.result_at is not None and m.result_at < now:
            for t in (m.h, m.a):
                recent.setdefault(t, []).append(agreement.get(m.id, 1.0))
    published = []
    for j, i in enumerate(idx):
        m = ms[i]
        ctx = {"source_conflict": agreement.get(m.id, 1.0) < 1.0,
               "recent_disputed": sum(1 for t in (m.h, m.a) for a in recent.get(t, [])[-10:] if a < 1.0),
               "stale_league": m.comp in stale}
        score, why = confidence(Xu[j], comps, j, ctx)
        inputs = _inputs(m, Xu[j], bundle.version)
        h = hashlib.sha256(json.dumps(inputs, sort_keys=True).encode()).hexdigest()[:16]
        last = db.execute("SELECT inputs_hash, inputs FROM predictions WHERE match_id=? ORDER BY made_at DESC, prediction_id DESC LIMIT 1", (m.id,)).fetchone()
        p = [float(v) for v in Fp[j]]
        call = describe(Fp[j])
        over = float(p_over[j]) if np.isfinite(p_over[j]) else None
        variant = "with odds" if has_odds[j] else "no odds yet"
        if last is not None and last["inputs_hash"] == h:
            summary["unchanged"] += 1
        else:
            reason = _reason(json.loads(last["inputs"]) if last is not None and last["inputs"] else None, inputs)
            pid = f"{m.id}@{int(now)}:{h[:8]}"
            db.execute("""INSERT INTO predictions (prediction_id, match_id, model_version, made_at, p_home, p_draw, p_away, inputs_hash, reason,
                          inputs, confidence, confidence_label, confidence_reasons, variant, official, pick, tier, dc_call, p_over25)
                          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?)""",
                       (pid, m.id, bundle.version, now, p[0], p[1], p[2], h, reason, json.dumps(inputs, sort_keys=True),
                        round(score, 4), label(score), json.dumps(why), variant, call["pick"], call["tier"],
                        call["double_chance"]["call"], over))
            summary["new"] += 1
            summary["reasons"][reason] = summary["reasons"].get(reason, 0) + 1
        rnd = lambda v: None if not np.isfinite(v) else round(float(v), 4)  # noqa: E731
        published.append({"match_id": m.id, "competition": m.comp, "kickoff": datetime.fromtimestamp(m.t, timezone.utc).isoformat(),
                          "home_id": m.h, "away_id": m.a, "p": {"home": round(p[0], 4), "draw": round(p[1], 4), "away": round(p[2], 4)},
                          "expected_goals": [rnd(Xu[j, COL["dc_lh"]]), rnd(Xu[j, COL["dc_la"]])],
                          "elo": [rnd(Xu[j, COL["elo_h"]]), rnd(Xu[j, COL["elo_a"]])],
                          "components": {k: [rnd(v) for v in comps[k][j]] for k in ("elo", "dc", "dcx", "gbm_nomkt", "market")},
                          "call": call, "goals": {"over25": None if over is None else round(over, 4), "btts": None},
                          "variant": variant, "confidence": round(score, 3), "confidence_label": label(score), "confidence_reasons": why})
    db.commit()
    # names and aliases (every source's spelling) so clients can match their own fixture lists
    names = {r["id"]: r["name"] for r in db.execute("SELECT id, name FROM entities")}
    aliases: dict[str, set] = {}
    for r in db.execute("SELECT entity_id, raw FROM aliases"):
        aliases.setdefault(r["entity_id"], set()).add(r["raw"])
    for e in published:
        hist = db.execute("SELECT made_at, reason FROM predictions WHERE match_id=? ORDER BY made_at DESC, rowid DESC", (e["match_id"],)).fetchall()
        e["made_at"] = datetime.fromtimestamp(hist[0]["made_at"], timezone.utc).isoformat(timespec="seconds")
        e["last_change"] = hist[0]["reason"]
        e["versions"] = len(hist)
        for side in ("home", "away"):
            tid = e[f"{side}_id"]
            e[side] = {"id": tid, "name": names.get(tid, tid), "aliases": sorted(aliases.get(tid, set()) | {names.get(tid, tid)})}
    # the last pre-kick-off prediction for matches started in the past 7 days (graded once results are in)
    recent = []
    for r in db.execute("""SELECT p.*, m.competition_id, m.kickoff_utc, m.home_id, m.away_id, m.status, m.home_score, m.away_score
                           FROM predictions p JOIN matches m USING (match_id)
                           WHERE m.kickoff_utc < ? AND m.kickoff_utc >= ? AND p.prediction_id = (
                             SELECT q.prediction_id FROM predictions q WHERE q.match_id=p.match_id AND q.made_at < m.kickoff_utc
                             ORDER BY q.made_at DESC, q.rowid DESC LIMIT 1)""", (now, now - 7 * DAY)):
        e = {"match_id": r["match_id"], "competition": r["competition_id"], "kickoff": datetime.fromtimestamp(r["kickoff_utc"], timezone.utc).isoformat(),
             "home_id": r["home_id"], "away_id": r["away_id"], "p": {"home": round(r["p_home"], 4), "draw": round(r["p_draw"], 4), "away": round(r["p_away"], 4)},
             "variant": r["variant"], "confidence": r["confidence"], "confidence_label": r["confidence_label"],
             "confidence_reasons": json.loads(r["confidence_reasons"] or "[]"), "model_version": r["model_version"],
             "made_at": datetime.fromtimestamp(r["made_at"], timezone.utc).isoformat(timespec="seconds"), "last_change": r["reason"],
             "result": [r["home_score"], r["away_score"]] if r["status"] == "final" else None, "log_loss": r["log_loss"]}
        for side in ("home", "away"):
            tid = e[f"{side}_id"]
            e[side] = {"id": tid, "name": names.get(tid, tid), "aliases": sorted(aliases.get(tid, set()) | {names.get(tid, tid)})}
        recent.append(e)
    if publish is not None:
        publish.mkdir(parents=True, exist_ok=True)
        doc = {"schema": 1, "generated_at": datetime.fromtimestamp(now, timezone.utc).isoformat(timespec="seconds"), "model_version": bundle.version,
               "data_version": bundle.manifest["data_version"], "attribution": ATTRIBUTION, "horizon_days": horizon_days,
               "competitions": sorted(app_comps),
               "notice": "Predictions are for information and entertainment only, not betting advice.", "matches": published,
               "recent": recent}
        (publish / "football_predictions.json").write_text(json.dumps(doc, indent=1, ensure_ascii=False))
    return summary


def grade(now: float, store: Path = STORE) -> dict:
    """Grade the last prediction made before kick-off for every finished match."""
    db = sqlite3.connect(store)
    db.row_factory = sqlite3.Row
    ensure_log_columns(db)
    rows = db.execute("""SELECT p.prediction_id, p.p_home, p.p_draw, p.p_away, m.home_score, m.away_score
                         FROM predictions p JOIN matches m USING (match_id)
                         WHERE m.status='final' AND m.result_available_at <= ? AND p.graded_at IS NULL
                           AND p.prediction_id = (SELECT q.prediction_id FROM predictions q WHERE q.match_id=p.match_id
                                                  AND q.made_at < m.kickoff_utc ORDER BY q.made_at DESC, q.rowid DESC LIMIT 1)
                           AND NOT EXISTS (SELECT 1 FROM predictions g WHERE g.match_id=p.match_id AND g.official=1)""",
                      (now,)).fetchall()
    for r in rows:
        o = 0 if r["home_score"] > r["away_score"] else 1 if r["home_score"] == r["away_score"] else 2
        P = np.clip(np.array([r["p_home"], r["p_draw"], r["p_away"]]), 1e-12, 1)
        ll = float(-math.log(P[o]))
        br = float(np.sum((P - np.eye(3)[o]) ** 2))
        db.execute("UPDATE predictions SET outcome=?, log_loss=?, brier=?, graded_at=?, official=1 WHERE prediction_id=?",
                   (["home", "draw", "away"][o], ll, br, now, r["prediction_id"]))
    db.commit()
    return {"graded": len(rows)}


def _ts(s: str | None) -> float:
    """ISO date or date-time; naive values are UTC. None -> now."""
    if not s:
        return time.time()
    d = datetime.fromisoformat(s)
    return (d if d.tzinfo else d.replace(tzinfo=timezone.utc)).timestamp()


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="mkmodel.production")
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("retrain")
    r.add_argument("--cutoff", help="UTC date; default: the 1st of the current month")
    r.add_argument("--if-due", action="store_true", help="skip if this month's bundle already exists")
    q = sub.add_parser("predict")
    q.add_argument("--now")
    q.add_argument("--horizon", type=float, default=21.0)
    g = sub.add_parser("grade")
    g.add_argument("--now")
    a = p.parse_args(argv)
    if a.cmd == "retrain":
        cutoff = _ts(a.cutoff) if a.cutoff else month_start(time.time())
        cur = current_bundle()
        if a.if_due and cur and cur.manifest["cutoff"] == cutoff:
            print(json.dumps({"retrain": "not due", "current": cur.version}))
            return 0
        b = retrain(cutoff)
        print(json.dumps({k: b.manifest[k] for k in ("version", "cutoff_iso", "code_hash", "data_version", "training_rows", "blend_rows", "train_seconds")}, indent=1))
    elif a.cmd == "predict":
        print(json.dumps(predict(_ts(a.now), horizon_days=a.horizon), indent=1))
    else:
        out = grade(_ts(a.now))
        out["accuracy_file"] = publish_accuracy(now=_ts(a.now))
        print(json.dumps(out, indent=1))
    return 0



# ----------------------------------------------------------------------------------- accuracy (in-app tracker)
AUDIT = PIPE.parent / "audit" / "results"


def _agg(rows: list[dict]) -> dict:
    n = len(rows)
    out = {"n": n, "correct": sum(r["correct"] for r in rows)}
    out["hit_rate"] = out["correct"] / n if n else None
    out["log_loss"] = sum(r["log_loss"] for r in rows) / n if n else None
    out["brier"] = sum(r["brier"] for r in rows) / n if n else None
    out["by_confidence"] = {}
    for c in ("high", "medium", "low"):
        sub = [r for r in rows if r["confidence_label"] == c]
        if sub:
            out["by_confidence"][c] = {"n": len(sub), "hit_rate": sum(r["correct"] for r in sub) / len(sub)}
    return out


def track_record() -> dict | None:
    """Backtest hit rates of each kind of call (two seasons), from the Step 6 picks and goals experiments."""
    fp, fg = AUDIT / "step6_picks.json", AUDIT / "step6_goals.json"
    if not fp.exists():
        return None
    both = json.loads(fp.read_text())["splits"]["both"]
    rule, top = both["with_draw_rule"], both["double_chance"]["tiers"][0]
    out = {"tiers": {t["tier"]: {"n": t["n"], "hit_rate": t["hit_rate"], "share": t["share"]} for t in both["tiers"]},
           "draw_calls": {"n": rule["draw_calls"], "hit_rate": rule["draw_precision"], "share": rule["draw_share"],
                          "base_rate": json.loads(fp.read_text())["draw_base_rate"]["selection"] / 2 + json.loads(fp.read_text())["draw_base_rate"]["test"] / 2},
           "all_matches": {"n": rule["n"], "hit_rate": rule["hit_rate"]},
           "bookmaker": {"n": both["bookmaker_closing_most_likely"]["n"], "hit_rate": both["bookmaker_closing_most_likely"]["hit_rate"]},
           "double_chance": {"n": rule["n"], "hit_rate": both["double_chance"]["hit_rate"],
                             "strong": {"n": top["n"], "hit_rate": top["hit_rate"], "share": top["share"]}}}
    if fg.exists():
        g = json.loads(fg.read_text())["markets"]["over25"]
        r = g["candidates"][g["chosen"]]["both"]
        out["over25"] = {"n": r["n"], "hit_rate": r["accuracy"],
                         "confident": {"n": round(r["n"] * r["confident_share"]), "hit_rate": r["confident_accuracy"], "share": r["confident_share"]}}
    return out


def publish_accuracy(store: Path = STORE, publish: Path = PUBLISH, now: float | None = None) -> dict:
    """Every graded (official) prediction, plus the backtest before/after, for the app's accuracy screen."""
    db = sqlite3.connect(store)
    db.row_factory = sqlite3.Row
    ensure_log_columns(db)
    names = {r["id"]: r["name"] for r in db.execute("SELECT id, name FROM entities")}
    graded = []
    for r in db.execute("""SELECT p.*, m.competition_id, m.kickoff_utc, m.home_id, m.away_id, m.home_score, m.away_score
                           FROM predictions p JOIN matches m USING (match_id) WHERE p.official=1 ORDER BY m.kickoff_utc DESC"""):
        probs = {"home": r["p_home"], "draw": r["p_draw"], "away": r["p_away"]}
        pick = r["pick"] or max(probs, key=probs.get)  # the call that was shown (draw rule included)
        total = r["home_score"] + r["away_score"]
        graded.append({"match_id": r["match_id"], "competition": r["competition_id"], "kickoff": datetime.fromtimestamp(r["kickoff_utc"], timezone.utc).isoformat(),
                       "home": names.get(r["home_id"], r["home_id"]), "away": names.get(r["away_id"], r["away_id"]),
                       "score": f"{r['home_score']}-{r['away_score']}", "pick": pick, "probability": round(probs[pick], 4),
                       "correct": int(pick == r["outcome"]), "log_loss": r["log_loss"], "brier": r["brier"],
                       "confidence_label": r["confidence_label"], "model_version": r["model_version"], "tier": r["tier"],
                       "safer_call": r["dc_call"],
                       "safer_correct": None if not r["dc_call"] else int(r["outcome"] in r["dc_call"].replace(" or ", "|").split("|")),
                       "over25_correct": None if r["p_over25"] is None else int((r["p_over25"] >= 0.5) == (total >= 3))})
    comps = sorted({g["competition"] for g in graded})
    def rate(key, rows):
        xs = [g[key] for g in rows if g.get(key) is not None]
        return {"n": len(xs), "hit_rate": (sum(xs) / len(xs)) if xs else None}

    live = {"overall": _agg(graded), "competitions": {c: _agg([g for g in graded if g["competition"] == c]) for c in comps},
            "tiers": {t: rate("correct", [g for g in graded if g["tier"] == t]) for t in ("strong", "likely", "lean", "toss-up")},
            "draw_calls": rate("correct", [g for g in graded if g["pick"] == "draw"]),
            "safer_call": rate("safer_correct", graded), "over25": rate("over25_correct", graded),
            "recent": [{k: g[k] for k in ("match_id", "competition", "kickoff", "home", "away", "score", "pick", "probability", "correct", "confidence_label")}
                       for g in graded[:30]]}
    backtest = None
    for name in ("step6.json", "step5.json", "step3.json"):
        f = AUDIT / name
        if f.exists():
            r = json.loads(f.read_text())
            res, final = r["results"], r["final_rule"]
            both = lambda model: res[model]["both"]  # noqa: E731
            backtest = {"source": name, "period": "2024-25 and 2025-26 seasons (MLS 2024 and 2025), every match predicted only from earlier data",
                        "competitions": {}}
            for lg, v in both(final).items():
                old = both("current engine v2").get(lg)
                close = both("bookmaker closing").get(lg)
                backtest["competitions"][lg] = {
                    "n": v["n"], "new": {k: v[k] for k in ("accuracy", "log_loss", "brier")},
                    "previous": {k: old[k] for k in ("accuracy", "log_loss", "brier")} if old else None,
                    "bookmaker": {k: close[k] for k in ("accuracy", "log_loss", "brier")} if close else None}
            break
    doc = {"schema": 1, "generated_at": datetime.fromtimestamp(now or time.time(), timezone.utc).isoformat(timespec="seconds"),
           "model_version": (current_bundle().version if current_bundle() else None), "live": live, "backtest": backtest,
           "track_record": track_record(),
           "note": "Live = every prediction this service published, graded on its last version before kick-off. "
                   "Backtest = the same model replayed on two past seasons. Hit rate = share where the most likely outcome happened; "
                   "log loss and Brier score measure probability quality (lower is better)."}
    publish.mkdir(parents=True, exist_ok=True)
    (publish / "accuracy.json").write_text(json.dumps(doc, indent=1, ensure_ascii=False))
    return {"graded": len(graded), "backtest": backtest["source"] if backtest else None}


if __name__ == "__main__":
    raise SystemExit(main())
