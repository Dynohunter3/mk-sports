"""Step 9: a market-history component that can call draws.

Step 8's market-history component is an ordered logit on one number (market supremacy). Its draw
probability depends only on how far apart the teams are, so it never goes much above 0.30 and, when the
blend leans on it, the app makes almost no draw calls before odds are out (0.9% of matches in 2025-26).
Here: a multinomial logistic regression on market supremacy, its size, the two teams' market draw tendency
(mr_draw) and the league draw rate. Draws can then depend on how draw-prone the market thinks the teams are.

Protocol (fixed before any result was seen):
  * same matches, features (k = 0.35) and walk-forward as Step 8; only the market-history component changes
  * scored on days-ahead predictions (league matches before odds are out; the Step 8 production rule)
  * adopt if its selection-season (2024-25) log loss is lower by more than 0.001; keep Step 8 if higher by more
    than 0.001; within 0.001, prefer the one whose draw-call rate is closer to the at-kick-off rate
  * the test season (2025-26) is reported, never used for the decision

    python -m mkmodel.step9            (writes audit/results/step9.json; ~10 min)
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone

import numpy as np
from sklearn.linear_model import LogisticRegression

from . import experiment as ex
from . import step8 as s8
from .data import APP_LEAGUES_STEP9 as APP_LEAGUES, LOWER_STEP9 as LOWER, DAY, load
from .features import FEATURES, Config, EloParams, build
from .picks import picks

OUT = ex.RESULTS / "step9.json"
MNL_COLS = ["mr_diff", "mr_draw", "lg_draw"]


def mnl_design(X: np.ndarray) -> np.ndarray:
    c = {f: i for i, f in enumerate(FEATURES)}
    d = X[:, c["mr_diff"]]
    return np.column_stack([d, np.abs(d), X[:, c["mr_draw"]], X[:, c["lg_draw"]]])


def mnl_fit(X, y, kick, cutoff):
    Z = mnl_design(X)
    ok = np.all(np.isfinite(Z), 1)
    w = np.exp(-(cutoff - kick[ok]) / DAY * 0.0012)
    return LogisticRegression(C=1.0, max_iter=2000).fit(Z[ok], y[ok], sample_weight=w)


def mnl_predict(model, X):
    Z = mnl_design(X)
    out = np.full((len(X), 3), np.nan)
    ok = np.all(np.isfinite(Z), 1)
    if ok.any():
        out[ok] = model.predict_proba(Z[ok])
    return out


def main() -> None:
    t0 = time.time()
    d = np.load(s8.CACHE, allow_pickle=True)
    X, ms = build(load(comps=APP_LEAGUES + LOWER), Config(elo=EloParams(), start=ex.FEATURE_START, mr_k=0.35))
    pos = {m.id: i for i, m in enumerate(ms)}
    # line up with the Step 8 cache by match id; rows whose id no longer exists (duplicates the linker has
    # since merged, all outside the evaluation seasons) are dropped
    keep = np.array([i in pos for i in d["ids"]])
    assert keep[d["mask"]].all(), "an evaluation match is missing from the current store"
    D = {k: d[k][keep] for k in d.files}
    ix = [pos[i] for i in D["ids"]]
    X, ms = X[ix], [ms[j] for j in ix]
    y, mask, common = D["y"], D["mask"], D["common"]
    pre_start = datetime(2023, 7, 1, tzinfo=timezone.utc).timestamp()
    ext = mask | np.array([m.comp in APP_LEAGUES and m.t >= pre_start and m.outcome is not None for m in ms])
    M = dict(D)
    M["market history (multinomial)"] = ex.walk_forward(
        X, y, ms, ext, lambda Xtr, ytr, Xte, ttr, start: mnl_predict(mnl_fit(Xtr, ytr, ttr, start), Xte))
    fb = {"market history (multinomial)": ["elo (ordered logit)"], "market history (ordered logit)": ["elo (ordered logit)"]}
    base = ["elo (ordered logit)", "dixon-coles", "dixon-coles xg-proxy"]
    M["MH multinomial: no-odds ensemble"] = ex.calibrate_and_blend(M, y, ms, ext, base + ["market history (multinomial)", "gbm new"], True, fb)
    has = np.all(np.isfinite(M["bookmaker pre-closing (Tue/Fri)"]), 1)
    comps = np.array([m.comp for m in ms])
    use = np.all(np.isfinite(M["market history (ordered logit)"]), 1) & ~np.isin(comps, ["usa.1", "uefa.champions"])
    old_no = M["before (Step 6): no-odds ensemble"]
    V = {"before (Step 6)": old_no,
         "Step 8 (ordered logit)": np.where(use[:, None], M["with market history: no-odds ensemble"], old_no),
         "Step 9 (multinomial)": np.where(use[:, None], M["MH multinomial: no-odds ensemble"], old_no)}
    kick_rule = picks(M["before (Step 6): odds ensemble"][common & has])
    kick_draw_rate = float(np.mean(kick_rule == 1))
    split = np.array([ex.split_of(m) for m in ms])
    res = {}
    for sp in ("selection", "test", "both"):
        s = common & has & ((split == sp) if sp != "both" else True)
        res[sp] = {}
        for name, P in V.items():
            k = picks(P[s])
            res[sp][name] = {**ex.metrics(P[s], y[s]), "draw_call_share": float(np.mean(k == 1)),
                             "draw_call_precision": float(np.mean(y[s][k == 1] == 1)) if (k == 1).any() else None}
            r = res[sp][name]
            print(f"{sp:9s} {name:24s} acc {r['accuracy']:.4f} LL {r['log_loss']:.4f} draws {r['draw_call_share']:.3f} right {r['draw_call_precision'] or float('nan'):.3f}")
    a, b = res["selection"]["Step 8 (ordered logit)"]["log_loss"], res["selection"]["Step 9 (multinomial)"]["log_loss"]
    if b < a - 0.001:
        decision = "adopt Step 9 (lower selection log loss)"
    elif b > a + 0.001:
        decision = "keep Step 8 (higher selection log loss)"
    else:
        ds = {n: abs(res["selection"][n]["draw_call_share"] - kick_draw_rate) for n in ("Step 8 (ordered logit)", "Step 9 (multinomial)")}
        decision = "adopt Step 9 (tie; draw-call rate closer to kick-off)" if ds["Step 9 (multinomial)"] < ds["Step 8 (ordered logit)"] else "keep Step 8 (tie; draw-call rate closer to kick-off)"
    out = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "protocol": __doc__, "kickoff_draw_call_rate": kick_draw_rate,
           "results": res, "decision": decision, "runtime_s": round(time.time() - t0)}
    OUT.write_text(json.dumps(out, indent=1))
    print("decision:", decision, f"(kick-off draw-call rate {kick_draw_rate:.3f}; {out['runtime_s']}s)")


if __name__ == "__main__":
    main()
