"""Step 8: market history. Does team strength implied by the odds of matches already played improve the
predictions, above all the ones made before a match's own odds are out (most of what the app shows)?

Protocol (fixed before any result was seen):
  * same walk-forward as Step 6 (monthly refits, same matches, same seed), same data
  * step size k of the market ratings: chosen on the SELECTION season (2024-25) only, by the log loss of the
    no-odds boosted model, from k in (0.1, 0.2, 0.35)
  * adopted only if, on the selection season, it lowers the log loss of BOTH the deployed rule and the
    no-odds ensemble; the test season (2025-26) is reported, never used for a decision
  * also scored: the no-odds ensemble on matches that later had odds (what the app shows days ahead)

    python -m mkmodel.step8            (writes audit/results/step8.json; ~45 min)
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone

import numpy as np

from . import experiment as ex
from .data import APP_LEAGUES, LOWER, in_eval, load
from .features import FEATURES, Config, EloParams, build
from .learners import fit_ordered_logit, predict_ordered_logit

BASE = ["elo+context", "dc", "xg_proxy", "form", "draw"]  # Step 6's kept groups (no odds)
K_GRID = (0.1, 0.2, 0.35)
OUT = ex.RESULTS / "step8.json"
CACHE = ex.ROOT / "pipeline" / "var" / "step8_preds.npz"


def mr_logit(c: int):
    """Ordered logit on the market-history supremacy alone (rows without it are skipped / left NaN)."""
    def fp(Xtr, ytr, Xte, ttr, start):
        ok = np.isfinite(Xtr[:, c])
        th = fit_ordered_logit(Xtr[ok][:, [c]] * 100, ytr[ok], ttr[ok], start)
        P = np.full((len(Xte), 3), np.nan)
        te = np.isfinite(Xte[:, c])
        P[te] = predict_ordered_logit(th, Xte[te][:, [c]] * 100)
        return P
    return fp


def main() -> None:
    t0 = time.time()
    col = {f: i for i, f in enumerate(FEATURES)}
    cols = lambda groups: [col[f] for g in groups for f in ex.GROUPS[g]]
    ms_all = load(comps=APP_LEAGUES + LOWER)
    v2 = {r["id"] for r in json.loads((ex.RESULTS / "engine_v2_permitted.preds.json").read_text())}
    pre_start = datetime(2023, 7, 1, tzinfo=timezone.utc).timestamp()

    # 1. step size, chosen on the selection season
    grid, built = [], {}
    for k in K_GRID:
        X, ms = build(ms_all, Config(elo=EloParams(), start=ex.FEATURE_START, mr_k=k))
        y = np.array([m.outcome if m.outcome is not None else -1 for m in ms])
        mask = np.array([in_eval(m) and m.id in v2 for m in ms])
        ext = mask | np.array([m.comp in APP_LEAGUES and m.t >= pre_start and m.outcome is not None for m in ms])
        sel = mask & np.array([ex.split_of(m) == "selection" for m in ms])
        P = ex.walk_forward(X, y, ms, ext, ex.gbm_factory(cols(BASE + ["market_hist"])))
        ok = sel & np.all(np.isfinite(P), 1)
        r = ex.metrics(P[ok], y[ok])
        grid.append({"k": k, "selection_log_loss": r["log_loss"], "selection_accuracy": r["accuracy"],
                     "mr_coverage": float(np.mean(np.isfinite(X[mask, col["mr_diff"]])))})
        built[k] = (X, ms, y, mask, ext, P)
        print(f"k={k}: no-odds gbm selection LL {r['log_loss']:.4f} acc {r['accuracy']:.4f} ({time.time() - t0:.0f}s)", flush=True)
    k = min(grid, key=lambda g: g["selection_log_loss"])["k"]
    X, ms, y, mask, ext, gbm_new = built[k]
    built.clear()

    # 2. every model, with and without market history, on the same matches
    M: dict[str, np.ndarray] = {}
    M["bookmaker pre-closing (Tue/Fri)"] = X[:, [col["mk_h"], col["mk_d"], col["mk_a"]]]
    M["bookmaker closing"] = np.array([m.close if m.close is not None else (np.nan,) * 3 for m in ms], float)
    M["elo (ordered logit)"] = ex.walk_forward(X, y, ms, ext, ex.ordered_logit)
    M["dixon-coles"] = X[:, [col["dc_h"], col["dc_d"], col["dc_a"]]]
    M["dixon-coles xg-proxy"] = X[:, [col["dcx_h"], col["dcx_d"], col["dcx_a"]]]
    M["market history (ordered logit)"] = ex.walk_forward(X, y, ms, ext, mr_logit(col["mr_diff"]))
    M["gbm base"] = ex.walk_forward(X, y, ms, ext, ex.gbm_factory(cols(BASE)))
    M["gbm base + odds"] = ex.walk_forward(X, y, ms, ext, ex.gbm_factory(cols(BASE + ["market_pre"])))
    M["gbm new"] = gbm_new
    M["gbm new + odds"] = ex.walk_forward(X, y, ms, ext, ex.gbm_factory(cols(BASE + ["market_hist", "market_pre"])))
    print(f"models done ({time.time() - t0:.0f}s)", flush=True)
    fb = {"market history (ordered logit)": ["elo (ordered logit)"]}
    variants = {
        "before (Step 6)": (["elo (ordered logit)", "dixon-coles", "dixon-coles xg-proxy", "gbm base"], "gbm base + odds"),
        "with market history": (["elo (ordered logit)", "dixon-coles", "dixon-coles xg-proxy", "market history (ordered logit)", "gbm new"], "gbm new + odds"),
    }
    has_odds = np.all(np.isfinite(M["bookmaker pre-closing (Tue/Fri)"]), 1)
    final = {}
    for name, (no_mkt, gbm_mkt) in variants.items():
        f_no = {**fb, **{"bookmaker pre-closing (Tue/Fri)": [no_mkt[-1]]}}
        M[f"{name}: no-odds ensemble"] = ex.calibrate_and_blend(M, y, ms, ext, no_mkt, True, fb)
        M[f"{name}: odds ensemble"] = ex.calibrate_and_blend(M, y, ms, ext, no_mkt + ["bookmaker pre-closing (Tue/Fri)", gbm_mkt], False, f_no)
        final[name] = np.where(has_odds[:, None], M[f"{name}: odds ensemble"], M[f"{name}: no-odds ensemble"])
        M[f"{name}: deployed rule"] = final[name]

    # 3. score on one common set of matches
    common = mask & np.all([np.all(np.isfinite(final[v]), 1) for v in final], 0)
    split = np.array([ex.split_of(m) for m in ms])
    comps = np.array([m.comp for m in ms])
    rows = {}
    for name, P in M.items():
        r = {}
        for sp in ("selection", "test", "both"):
            s = common & ((split == sp) if sp != "both" else True) & np.all(np.isfinite(P), 1)
            if not s.any():
                continue
            r[sp] = ex.metrics(P[s], y[s])
            so = s & has_odds  # matches whose odds came out later: what the app shows before that
            if so.any():
                r[sp + " (matches with odds)"] = ex.metrics(P[so], y[so])
            r[sp + " by league"] = {c: ex.metrics(P[s & (comps == c)], y[s & (comps == c)])["accuracy"] for c in sorted(set(comps[s]))}
        rows[name] = r
    sel_ll = {v: rows[f"{v}: deployed rule"]["selection"]["log_loss"] for v in variants}
    sel_no = {v: rows[f"{v}: no-odds ensemble"]["selection"]["log_loss"] for v in variants}
    adopt = sel_ll["with market history"] < sel_ll["before (Step 6)"] and sel_no["with market history"] < sel_no["before (Step 6)"]
    out = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "protocol": __doc__, "k_grid": grid, "k": k,
           "adopted": adopt, "common_matches": int(common.sum()), "results": rows, "runtime_s": round(time.time() - t0)}
    OUT.write_text(json.dumps(out, indent=1))
    np.savez_compressed(CACHE, ids=np.array([m.id for m in ms]), y=y, mask=mask, common=common, **M)
    for v in variants:
        for kind in ("deployed rule", "no-odds ensemble"):
            r = rows[f"{v}: {kind}"]
            print(f"{v:22s} {kind:17s} " + " | ".join(f"{sp} acc {r[sp]['accuracy']:.4f} LL {r[sp]['log_loss']:.4f}" for sp in ("selection", "test", "both")))
        r = rows[f"{v}: no-odds ensemble"]
        print(f"{'':22s} no-odds on matches with odds: " + " | ".join(f"{sp} acc {r[sp + ' (matches with odds)']['accuracy']:.4f}" for sp in ("selection", "test", "both")))
    print("adopted:", adopt, f"(k={k}, {out['runtime_s']}s)")


def production_rule() -> dict:
    """The rule deployed from the run (decided on selection-season numbers; the pre-registered all-or-nothing
    rule said "not adopted"): before a league match's odds are out, use the market-history ensemble when both
    teams are rated; MLS and the Champions League keep the Step 6 no-odds ensemble; with odds, Step 6's odds
    ensemble. Scored from the cache: python -m mkmodel.step8 --rule"""
    d = np.load(CACHE, allow_pickle=True)
    byid = {m.id: m for m in load(comps=APP_LEAGUES + LOWER)}
    ms = [byid[i] for i in d["ids"]]
    y, common = d["y"], d["common"]
    has = np.all(np.isfinite(d["bookmaker pre-closing (Tue/Fri)"]), 1)
    comps = np.array([m.comp for m in ms])
    use = np.all(np.isfinite(d["market history (ordered logit)"]), 1) & ~np.isin(comps, ["usa.1", "uefa.champions"])
    old_no, new_no = d["before (Step 6): no-odds ensemble"], d["with market history: no-odds ensemble"]
    rule_no = np.where(use[:, None], new_no, old_no)
    old_ko = np.where(has[:, None], d["before (Step 6): odds ensemble"], old_no)
    new_ko = np.where(has[:, None], d["before (Step 6): odds ensemble"], rule_no)
    pre = d["bookmaker pre-closing (Tue/Fri)"]
    split = np.array([ex.split_of(m) for m in ms])
    out = {}
    for sp in ("selection", "test", "both"):
        s = common & ((split == sp) if sp != "both" else True)
        ah = s & has  # leagues whose odds come out later: the prediction shown days ahead
        out[sp] = {"days_ahead_before": ex.metrics(old_no[ah], y[ah]), "days_ahead_after": ex.metrics(rule_no[ah], y[ah]),
                   "bookmaker_pre_closing_same_matches": ex.metrics(pre[ah], y[ah]),
                   "at_kickoff_before": ex.metrics(old_ko[s], y[s]), "at_kickoff_after": ex.metrics(new_ko[s], y[s])}
        o = out[sp]
        print(f"{sp:9s} days ahead {o['days_ahead_before']['accuracy']:.4f} -> {o['days_ahead_after']['accuracy']:.4f} "
              f"(LL {o['days_ahead_before']['log_loss']:.4f} -> {o['days_ahead_after']['log_loss']:.4f}; bookmaker pre-closing "
              f"{o['bookmaker_pre_closing_same_matches']['accuracy']:.4f}) | at kick-off {o['at_kickoff_before']['accuracy']:.4f} -> "
              f"{o['at_kickoff_after']['accuracy']:.4f} (LL {o['at_kickoff_before']['log_loss']:.4f} -> {o['at_kickoff_after']['log_loss']:.4f})")
    # follow-up check (rule written before it was run): the blend without the single-rating ordered logit, which
    # caps P(draw) near 0.30 when it dominates. Pick by selection log loss on days-ahead matches; within 0.001,
    # prefer the draw-call rate closer to the at-kick-off rate.
    from .picks import picks
    from datetime import datetime as _dt, timezone as _tz
    M = {k: d[k] for k in d.files}
    pre_start = _dt(2023, 7, 1, tzinfo=_tz.utc).timestamp()
    ext = d["mask"] | np.array([m.comp in APP_LEAGUES and m.t >= pre_start and m.outcome is not None for m in ms])
    no_logit = ex.calibrate_and_blend(M, y, ms, ext, ["elo (ordered logit)", "dixon-coles", "dixon-coles xg-proxy", "gbm new"], True)
    alt_no = np.where(use[:, None], no_logit, old_no)
    check = {}
    for sp in ("selection", "test", "both"):
        s = common & has & ((split == sp) if sp != "both" else True)
        check[sp] = {}
        for name, P in (("before", old_no), ("with single-rating logit", rule_no), ("without single-rating logit", alt_no)):
            k = picks(P[s])
            check[sp][name] = {**ex.metrics(P[s], y[s]), "draw_call_share": float(np.mean(k == 1)),
                               "draw_call_precision": float(np.mean(y[s][k == 1] == 1)) if (k == 1).any() else None}
    a, b = check["selection"]["with single-rating logit"]["log_loss"], check["selection"]["without single-rating logit"]["log_loss"]
    check["decision"] = "with single-rating logit" if a <= b - 0.001 else ("without single-rating logit" if b <= a - 0.001 else "tie: draw-rate rule")
    print("logit check:", check["decision"], {sp: {n: (round(v["accuracy"], 4), round(v["log_loss"], 4), round(v["draw_call_share"], 3))
                                                   for n, v in check[sp].items()} for sp in ("selection", "test")})
    r = json.loads(OUT.read_text())
    r["production_rule"] = {"doc": production_rule.__doc__, "results": out, "single_rating_logit_check": check}
    r.pop("hybrid_decision", None)
    OUT.write_text(json.dumps(r, indent=1))
    return out


if __name__ == "__main__":
    import sys

    production_rule() if "--rule" in sys.argv else main()
