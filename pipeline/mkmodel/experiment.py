"""Step 3 experiment: walk-forward training and evaluation of the new football models.

Protocol (fixed before looking at results):
  * features: mkmodel.features (leak-free by construction)
  * every learned model is refitted at the start of each calendar month on rows whose result was
    known before that moment, and predicts that month's matches
  * selection season = 2024-25 (decisions: which feature groups / steps to keep)
  * test season      = 2025-26 (never used for a decision; MLS: 2024 = selection, 2025 = test)
  * benchmarks on the same matches: current engine v2 (unchanged, fed the same permitted data),
    league base rates, bookmaker pre-closing (Tue/Fri) and closing odds (Pinnacle where present)

    python -m mkmodel.experiment            (writes audit/results/step3.json)
"""

from __future__ import annotations

import hashlib
import json
import os
import math
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from .data import APP_LEAGUES, LOWER, LOWER_LEGACY, in_eval, load
from .features import FEATURES, Config, EloParams, build
from .learners import SEED, blend_probs, fit_blend, fit_gbm, fit_ordered_logit, predict_gbm, predict_ordered_logit, to_log

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "audit" / "results"
EPS = 1e-12
RUN = os.environ.get("MK_RUN", "step3")  # which experiment: step3, step5 (MLS fix) or step6 (more data + features)
CACHE = ROOT / "pipeline" / "var" / f"{RUN}_preds.npz"


GROUPS = {
    "elo+context": ["elo_diff", "elo_h", "elo_a", "rest_h", "rest_a", "busy_h", "busy_a", "games_h", "games_a", "lg_home", "lg_draw", "lg_goals"],
    "dc": ["dc_h", "dc_d", "dc_a", "dc_lh", "dc_la"],
    "xg_proxy": ["dcx_h", "dcx_d", "dcx_a", "dcx_lh", "dcx_la"],
    "pi": ["pi_h", "pi_a", "pi_gd"],
    "form": ["form_pts_h", "form_pts_a", "form_gd_h", "form_gd_a", "form_xgd_h", "form_xgd_a"],
    "draw": ["abs_elo_diff", "dc_total", "dc_absdiff", "draw_rate_h", "draw_rate_a", "tier"],
    "market_pre": ["mk_h", "mk_d", "mk_a"],
}
# Step 3/5 runs used the first three groups + market and data from 2020; step6 adds history from 2015
LEGACY = RUN in ("step3", "step5")
FEED = LOWER_LEGACY if LEGACY else LOWER
STEP_GROUPS = ["elo+context", "dc", "xg_proxy", "market_pre"] if LEGACY else list(GROUPS)
FEATURE_START = datetime(2020 if LEGACY else 2015, 7, 1, tzinfo=timezone.utc).timestamp()
TRAIN_FROM = datetime(2020 if LEGACY else 2016, 8, 1, tzinfo=timezone.utc).timestamp()


def split_of(m) -> str:
    if m.comp == "usa.1":
        return "selection" if m.season == "2024" else "test"
    return "selection" if m.season == "2024-25" else "test"


# ----------------------------------------------------------------------------------- metrics
def metrics(P: np.ndarray, y: np.ndarray) -> dict:
    P = np.clip(P, EPS, 1)
    P = P / P.sum(1, keepdims=True)
    oh = np.eye(3)[y]
    ll = float(-np.mean(np.log(P[np.arange(len(y)), y])))
    br = float(np.mean(np.sum((P - oh) ** 2, 1)))
    acc = float(np.mean(P.argmax(1) == y))
    # expected calibration error over all three outcome probabilities, 10 bins
    p, o = P.ravel(), oh.ravel()
    bins = np.minimum((p * 10).astype(int), 9)
    ece = float(sum(abs(p[bins == b].mean() - o[bins == b].mean()) * (bins == b).sum() for b in range(10) if (bins == b).any()) / len(p))
    return {"n": int(len(y)), "accuracy": acc, "log_loss": ll, "brier": br, "ece": ece}


def calib_table(P: np.ndarray, y: np.ndarray) -> list[dict]:
    p, o = P.ravel(), np.eye(3)[y].ravel()
    out = []
    for b in range(10):
        sel = (p >= b / 10) & (p < (b + 1) / 10 if b < 9 else p <= 1)
        if sel.any():
            out.append({"bin": f"{b * 10}-{b * 10 + 10}%", "n": int(sel.sum()), "predicted": float(p[sel].mean()), "observed": float(o[sel].mean())})
    return out


# ----------------------------------------------------------------------------------- learners
def month_key(t: float) -> tuple[int, int]:
    d = datetime.fromtimestamp(t, timezone.utc)
    return d.year, d.month


def month_start(t: float) -> float:
    d = datetime.fromtimestamp(t, timezone.utc)
    return datetime(d.year, d.month, 1, tzinfo=timezone.utc).timestamp()


def walk_forward(X, y, ms, pred_mask, fit_predict, min_train=2000):
    """Monthly refits. fit_predict(Xtr, ytr, Xte) -> probs. Training rows: result known before month start."""
    P = np.full((len(ms), 3), np.nan)
    res_at = np.array([m.result_at or np.inf for m in ms])
    kick = np.array([m.t for m in ms])
    months = sorted({month_key(m.t) for m, p in zip(ms, pred_mask) if p})
    for yy, mm in months:
        start = datetime(yy, mm, 1, tzinfo=timezone.utc).timestamp()
        end = datetime(yy + (mm == 12), mm % 12 + 1, 1, tzinfo=timezone.utc).timestamp()
        tr = (res_at < start) & (kick >= TRAIN_FROM) & (y >= 0)
        te = pred_mask & (kick >= start) & (kick < end)
        if tr.sum() < min_train or not te.any():
            continue
        P[te] = fit_predict(X[tr], y[tr], X[te], kick[tr], start)
    return P


def ordered_logit(Xtr, ytr, Xte, ttr, start):
    return predict_ordered_logit(fit_ordered_logit(Xtr, ytr, ttr, start), Xte)


def gbm_factory(cols: list[int]):
    def fp(Xtr, ytr, Xte, ttr, start):
        return predict_gbm(fit_gbm(cols, Xtr, ytr, ttr, start), cols, Xte)

    return fp


FALLBACK = {  # written rule: a missing input is replaced by the next model in its list (per match)
    "dixon-coles xg-proxy": ["dixon-coles", "elo (ordered logit)"],
    "dixon-coles": ["elo (ordered logit)"],
}


def with_fallback(base: dict[str, np.ndarray], name: str, extra: dict[str, list[str]] | None = None) -> np.ndarray:
    P = base[name].copy()
    for fb in {**FALLBACK, **(extra or {})}.get(name, []):
        miss = ~np.all(np.isfinite(P), 1)
        if not miss.any():
            break
        P[miss] = base[fb][miss]
    return P


def calibrate_and_blend(base: dict[str, np.ndarray], y, ms, pred_mask, names: list[str], calibrate: bool, extra_fb=None):
    """Monthly: weights (simplex, on log-probs) and optional vector scaling, fitted on the previous 12 months
    of out-of-sample predictions only. Missing inputs use the FALLBACK rule."""
    kick = np.array([m.t for m in ms])
    res_at = np.array([m.result_at or np.inf for m in ms])
    out = np.full((len(ms), 3), np.nan)
    L = np.stack([to_log(with_fallback(base, n, extra_fb)) for n in names], 0)  # k x n x 3
    avail = np.all(np.isfinite(L), axis=(0, 2))
    for yy, mm in sorted({month_key(m.t) for m, p in zip(ms, pred_mask) if p}):
        start = datetime(yy, mm, 1, tzinfo=timezone.utc).timestamp()
        end = datetime(yy + (mm == 12), mm % 12 + 1, 1, tzinfo=timezone.utc).timestamp()
        tr = avail & (res_at < start) & (kick >= start - 365 * 86400) & (y >= 0)
        te = pred_mask & avail & (kick >= start) & (kick < end)
        if not te.any():
            continue
        theta = fit_blend(L[:, tr], y[tr], calibrate)
        out[te] = blend_probs(theta, L[:, te], calibrate)
    return out


# ----------------------------------------------------------------------------------- run
def report(models: dict[str, np.ndarray], y, ms, mask, keys=("selection", "test", "both")) -> dict:
    out = {}
    split = np.array([split_of(m) for m in ms])
    comps = np.array([m.comp for m in ms])
    close = np.array([m.close if m.close is not None else (np.nan,) * 3 for m in ms], float)
    for name, P in models.items():
        ok = mask & np.all(np.isfinite(P), 1)
        r = {}
        for k in keys:
            sel = ok & ((split == k) if k != "both" else True)
            if not sel.any():
                continue
            entry = {"all": metrics(P[sel], y[sel])}
            for c in sorted(set(comps[sel])):
                s2 = sel & (comps == c)
                entry[c] = metrics(P[s2], y[s2])
                withc = s2 & np.all(np.isfinite(close), 1)
                if withc.any():
                    entry[c]["ll_gap_to_closing"] = metrics(P[withc], y[withc])["log_loss"] - metrics(close[withc], y[withc])["log_loss"]
                    entry[c]["n_with_closing"] = int(withc.sum())
            withc = sel & np.all(np.isfinite(close), 1)
            if withc.any():
                entry["all"]["ll_gap_to_closing"] = metrics(P[withc], y[withc])["log_loss"] - metrics(close[withc], y[withc])["log_loss"]
                entry["all"]["n_with_closing"] = int(withc.sum())
            r[k] = entry
        out[name] = r
    return out


def main() -> None:
    t0 = time.time()
    ms_all = load(comps=APP_LEAGUES + FEED)
    cfg = Config(elo=EloParams(), start=FEATURE_START)
    X, ms = build(ms_all, cfg)
    y = np.array([m.outcome if m.outcome is not None else -1 for m in ms])
    print(f"features: {X.shape} in {time.time() - t0:.0f}s")
    v2 = {r["id"]: r["p"] for r in json.loads((RESULTS / "engine_v2_permitted.preds.json").read_text())}
    mask = np.array([in_eval(m) and m.id in v2 for m in ms])
    # learned models also predict the year before evaluation, so blending/calibration has out-of-sample history
    pre_start = datetime(2023, 7, 1, tzinfo=timezone.utc).timestamp()
    ext = mask | np.array([m.comp in APP_LEAGUES and m.t >= pre_start and m.outcome is not None for m in ms])
    col = {f: i for i, f in enumerate(FEATURES)}

    models: dict[str, np.ndarray] = {}
    models["current engine v2"] = np.array([v2.get(m.id, (np.nan,) * 3) for m in ms], float)
    models["league base rate"] = np.stack([X[:, col["lg_home"]], X[:, col["lg_draw"]], 1 - X[:, col["lg_home"]] - X[:, col["lg_draw"]]], 1)
    models["bookmaker pre-closing (Tue/Fri)"] = X[:, [col["mk_h"], col["mk_d"], col["mk_a"]]]
    models["bookmaker closing"] = np.array([m.close if m.close is not None else (np.nan,) * 3 for m in ms], float)

    models["elo (ordered logit)"] = walk_forward(X, y, ms, ext, ordered_logit)
    models["dixon-coles"] = X[:, [col["dc_h"], col["dc_d"], col["dc_a"]]]
    models["dixon-coles xg-proxy"] = X[:, [col["dcx_h"], col["dcx_d"], col["dcx_a"]]]

    # feature groups added one at a time to the boosted model; keep a group only if selection log loss improves
    sel_mask = mask & np.array([split_of(m) == "selection" for m in ms])
    kept: list[str] = []
    steps = []
    best_ll = None
    for g in STEP_GROUPS:
        trial = kept + [g]
        cols = [col[f] for grp in trial for f in GROUPS[grp]]
        P = walk_forward(X, y, ms, ext, gbm_factory(cols))
        ok = sel_mask & np.all(np.isfinite(P), 1)
        ll = metrics(P[ok], y[ok])["log_loss"]
        br = metrics(P[ok], y[ok])["brier"]
        keep = best_ll is None or ll < best_ll
        steps.append({"added": g, "selection_log_loss": ll, "selection_brier": br, "kept": keep, "n": int(ok.sum())})
        print(f"gbm +{g}: selection LL {ll:.4f} Brier {br:.4f} -> {'keep' if keep else 'drop'}")
        name = "gbm[" + "+".join(trial) + "]"
        models[name] = P
        if keep:
            kept, best_ll = trial, ll
    gbm_name = "gbm[" + "+".join(kept) + "]"

    # ensembles: with and without the market, with and without calibration (decided on selection)
    no_mkt = ["elo (ordered logit)", "dixon-coles", "dixon-coles xg-proxy"]
    gbm_no_mkt = "gbm[" + "+".join(g for g in kept if g != "market_pre") + "]"
    if gbm_no_mkt in models:
        no_mkt.append(gbm_no_mkt)
    mk_fb = {"bookmaker pre-closing (Tue/Fri)": [gbm_no_mkt]}  # no odds published yet -> the no-market model
    for cal in (False, True):
        models[f"ensemble (no market){' + calibration' if cal else ''}"] = calibrate_and_blend(models, y, ms, ext, no_mkt, cal)
        mk_names = no_mkt + ["bookmaker pre-closing (Tue/Fri)"] + ([gbm_name] if gbm_name != gbm_no_mkt else [])
        models[f"ensemble + market{' + calibration' if cal else ''}"] = calibrate_and_blend(models, y, ms, ext, mk_names, cal, mk_fb)

    np.savez_compressed(CACHE, ids=np.array([m.id for m in ms]), y=y, mask=mask, **{n: models[n] for n in models})
    meta = {"gbm_steps": steps, "gbm_kept": kept, "ensemble_inputs_no_market": no_mkt, "runtime_s": round(time.time() - t0)}
    (CACHE.with_suffix(".meta.json")).write_text(json.dumps(meta))
    finalize()


# Decided on the selection season: calibration helps the no-market ensemble (LL 0.9900 -> 0.9897) and hurts
# the market ensemble (0.9772 -> 0.9775), so the deployable rule uses the calibrated no-market ensemble and
# the uncalibrated market ensemble.
FINAL = "final (market ensemble when pre-match odds exist, else calibrated no-market ensemble)"


def finalize() -> None:
    """Add the deployable rule, score everything on one common match set, write step3.json (from the cache)."""
    d = np.load(CACHE, allow_pickle=True)
    meta = json.loads(CACHE.with_suffix(".meta.json").read_text())
    byid = {m.id: m for m in load(comps=APP_LEAGUES + FEED)}
    ms = [byid[i] for i in d["ids"]]
    y, mask = d["y"], d["mask"]
    skip = {"ids", "y", "mask", "common"}
    models = {k: d[k] for k in d.files if k not in skip}
    has_odds = np.all(np.isfinite(models["bookmaker pre-closing (Tue/Fri)"]), 1)
    models[FINAL] = np.where(has_odds[:, None], models["ensemble + market"], models["ensemble (no market) + calibration"])
    headline = ["current engine v2", "ensemble (no market) + calibration", FINAL]
    common = mask & np.all([np.all(np.isfinite(models[n]), 1) for n in headline], 0)
    print(f"common evaluation set: {int(common.sum())} of {int(mask.sum())} matches")
    rep = report(models, y, ms, common)
    calib = {}
    for name in ("current engine v2", "ensemble (no market) + calibration", FINAL, "bookmaker closing"):
        ok = common & np.all(np.isfinite(models[name]), 1)
        calib[name] = calib_table(models[name][ok], y[ok])
    h = hashlib.sha256()
    for name in sorted(models):
        h.update(np.nan_to_num(np.round(models[name][mask], 10)).tobytes())
    out = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "seed": SEED, "features": FEATURES, **meta,
           "final_rule": FINAL, "results": rep, "calibration": calib, "prediction_hash": h.hexdigest()[:16],
           "eval_matches": int(mask.sum()), "common_matches": int(common.sum())}
    (RESULTS / f"{RUN}.json").write_text(json.dumps(out, indent=1))
    print("hash", out["prediction_hash"])


if __name__ == "__main__":
    import sys

    finalize() if "--from-cache" in sys.argv else main()
