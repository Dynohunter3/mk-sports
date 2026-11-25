"""Goal markets: over/under 2.5 goals and both teams to score.

Candidates, compared walk-forward on the same matches as the 1X2 experiment:
  base     league base rate over the previous 365 days
  dc       Dixon-Coles goals model
  dcx      Dixon-Coles on the shots-based xG proxy (falls back to dc)
  mix      average of dc and dcx in logit space
  gbm      boosted trees on every non-market feature, refitted monthly
The candidate with the lowest SELECTION-season log loss is adopted (mkmodel.goals.CHOSEN); the test
season is only reported.

    MK_RUN=step6 python -m mkmodel.goals_experiment      (writes audit/results/<run>_goals.json)
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

import lightgbm as lgb
import numpy as np

from .data import APP_LEAGUES_STEP9 as APP_LEAGUES, in_eval, load
from .experiment import FEATURE_START, FEED, RESULTS, RUN, TRAIN_FROM, month_key, split_of
from .features import FEATURES, Config, EloParams, build
from .learners import SEED

COL = {f: i for i, f in enumerate(FEATURES)}
NON_MARKET = [i for f, i in COL.items() if not f.startswith("mk_")]
EPS = 1e-9


def logit(p):
    p = np.clip(p, EPS, 1 - EPS)
    return np.log(p / (1 - p))


def bmetrics(p, y) -> dict:
    p = np.clip(p, EPS, 1 - EPS)
    conf = np.maximum(p, 1 - p)
    hit = (p >= 0.5) == (y == 1)
    strong = conf >= 0.60
    return {"n": int(len(y)), "accuracy": float(hit.mean()), "log_loss": float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p))),
            "brier": float(np.mean((p - y) ** 2)), "base_rate": float(y.mean()),
            "confident_share": float(strong.mean()), "confident_accuracy": float(hit[strong].mean()) if strong.any() else None}


def fit_gbm_binary(Xtr, ytr, ttr, cutoff):
    w = np.exp(-(cutoff - ttr) / 86400 * 0.0008)
    clf = lgb.LGBMClassifier(objective="binary", n_estimators=250, learning_rate=0.03, num_leaves=15, min_child_samples=80, subsample=0.8,
                             subsample_freq=1, colsample_bytree=0.8, reg_lambda=2.0, random_state=SEED, deterministic=True,
                             force_row_wise=True, n_jobs=4, verbose=-1)
    clf.fit(Xtr[:, NON_MARKET], ytr, sample_weight=w)
    return clf


def main() -> None:
    ms_all = load(comps=APP_LEAGUES + FEED)
    X, ms = build(ms_all, Config(elo=EloParams(), start=FEATURE_START))
    kick = np.array([m.t for m in ms])
    res_at = np.array([m.result_at if m.result_at is not None else np.inf for m in ms])
    played = np.array([m.outcome is not None for m in ms])
    goals = np.array([(m.hs + m.as_) if m.outcome is not None else -1 for m in ms])
    targets = {"over25": (goals >= 3).astype(float), "btts": np.array([float(m.outcome is not None and m.hs > 0 and m.as_ > 0) for m in ms])}
    mask = np.array([in_eval(m) for m in ms])
    split = np.array([split_of(m) for m in ms])
    comps = np.array([m.comp for m in ms])
    out = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "run": RUN, "markets": {}}
    for name, y in targets.items():
        dc = X[:, COL["dc_o25" if name == "over25" else "dc_btts"]]
        dcx = X[:, COL["dcx_o25" if name == "over25" else "dcx_btts"]]
        dcx = np.where(np.isfinite(dcx), dcx, dc)
        mix = 1 / (1 + np.exp(-(logit(dc) + logit(dcx)) / 2))
        # league base rate (previous 365 days, known results only) and monthly GBM
        base, gbm = np.full(len(ms), np.nan), np.full(len(ms), np.nan)
        for yy, mm in sorted({month_key(m.t) for m, p in zip(ms, mask) if p}):
            start = datetime(yy, mm, 1, tzinfo=timezone.utc).timestamp()
            end = datetime(yy + (mm == 12), mm % 12 + 1, 1, tzinfo=timezone.utc).timestamp()
            te = mask & (kick >= start) & (kick < end)
            tr = played & (res_at < start) & (kick >= TRAIN_FROM)
            if not te.any():
                continue
            for c in set(comps[te]):
                h = played & (comps == c) & (res_at < start) & (kick >= start - 365 * 86400)
                base[te & (comps == c)] = y[h].mean() if h.sum() >= 30 else y[tr].mean()
            clf = fit_gbm_binary(X[tr], y[tr], kick[tr], start)
            gbm[te] = clf.predict_proba(X[te][:, NON_MARKET])[:, 1]
        cands = {"base": base, "dc": dc, "dcx": dcx, "mix": mix, "gbm": gbm,
                 "gbm+mix": 1 / (1 + np.exp(-(logit(gbm) + logit(np.where(np.isfinite(mix), mix, gbm))) / 2))}
        ok = mask & np.all([np.isfinite(v) for v in cands.values()], 0)
        res = {}
        for cn, p in cands.items():
            res[cn] = {s: bmetrics(p[ok & (split == s)], y[ok & (split == s)]) for s in ("selection", "test")}
            res[cn]["both"] = bmetrics(p[ok], y[ok])
        chosen = min((c for c in cands if c != "base"), key=lambda c: res[c]["selection"]["log_loss"])
        out["markets"][name] = {"chosen": chosen, "candidates": res, "evaluated": int(ok.sum()), "of": int(mask.sum())}
        print(name, "chosen:", chosen)
        for cn in cands:
            r = res[cn]
            print(f"   {cn:8s} sel LL {r['selection']['log_loss']:.4f} acc {r['selection']['accuracy']:.3f} | test LL {r['test']['log_loss']:.4f} "
                  f"acc {r['test']['accuracy']:.3f} | confident (>=60%): share {r['test']['confident_share']:.2f} acc {r['test']['confident_accuracy'] or 0:.3f}")
    (RESULTS / f"{RUN}_goals.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
