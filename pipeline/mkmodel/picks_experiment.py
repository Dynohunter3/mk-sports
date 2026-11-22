"""Tune and verify the decision layer on a finished experiment's predictions.

    MK_RUN=step6 python -m mkmodel.picks_experiment        (writes audit/results/<run>_picks.json)

Draw rule: grid over (min_draw, max_gap), chosen on the SELECTION season by a rule fixed in advance:
among settings that call a draw in at least 5% of matches, take the one with the highest overall hit
rate; ties go to the higher draw precision. The test season is only reported.
"""

from __future__ import annotations

import itertools
import json
from datetime import datetime, timezone

import numpy as np

from .data import APP_LEAGUES, load
from .experiment import CACHE, FEED, RESULTS, RUN, split_of
from .picks import PAIRS, TIERS, double_chance, picks

MIN_SHARE = 0.05
DRAW_NOTE = 0.29  # the app's "a draw is a real possibility" note on matches not called a draw


def auc(score: np.ndarray, label: np.ndarray) -> float:
    order = np.argsort(score)
    ranks = np.empty(len(score))
    ranks[order] = np.arange(1, len(score) + 1)
    pos = label.sum()
    neg = len(label) - pos
    return float((ranks[label == 1].sum() - pos * (pos + 1) / 2) / (pos * neg))


def rule_stats(P, y, rule) -> dict:
    k = picks(P, rule)
    d = k == 1
    return {"hit_rate": float(np.mean(k == y)), "draw_share": float(d.mean()),
            "draw_precision": float(np.mean(y[d] == 1)) if d.any() else None,
            "draw_recall": float(np.mean(k[y == 1] == 1)), "n": int(len(y)), "draw_calls": int(d.sum())}


def tier_table(P, y, rule) -> list[dict]:
    k = picks(P, rule)
    pk = P[np.arange(len(y)), k]
    out, hi = [], 1.01
    for name, lo in TIERS:
        s = (pk >= lo) & (pk < hi)
        if s.any():
            out.append({"tier": name, "from": lo, "share": float(s.mean()), "n": int(s.sum()), "hit_rate": float(np.mean(k[s] == y[s])),
                        "mean_probability": float(pk[s].mean())})
        hi = lo
    return out


def main() -> None:
    d = np.load(CACHE, allow_pickle=True)
    byid = {m.id: m for m in load(comps=APP_LEAGUES + FEED)}
    ms = [byid[i] for i in d["ids"]]
    y, mask = d["y"], d["mask"]
    has_odds = np.all(np.isfinite(d["bookmaker pre-closing (Tue/Fri)"]), 1)
    F = np.where(has_odds[:, None], d["ensemble + market"], d["ensemble (no market) + calibration"])
    split = np.array([split_of(m) for m in ms])
    sel, tst = mask & (split == "selection"), mask & (split == "test")
    argmax = {"min_draw": 2.0, "max_gap": 0.0}

    grid = []
    for md, mg in itertools.product([0.27, 0.28, 0.29, 0.30, 0.31, 0.32, 0.33], [0.02, 0.04, 0.06, 0.08, 0.10, 0.12, 0.15, 0.20]):
        r = {"min_draw": md, "max_gap": mg}
        grid.append({**r, **rule_stats(F[sel], y[sel], r)})
    ok = [g for g in grid if g["draw_share"] >= MIN_SHARE]
    best = max(ok, key=lambda g: (round(g["hit_rate"], 4), g["draw_precision"] or 0))
    rule = {"min_draw": best["min_draw"], "max_gap": best["max_gap"]}

    out = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "run": RUN,
           "criterion": f"selection season; draw calls in >= {MIN_SHARE:.0%} of matches; highest overall hit rate, then draw precision",
           "chosen_rule": rule, "grid_selection": grid,
           "draw_base_rate": {"selection": float(np.mean(y[sel] == 1)), "test": float(np.mean(y[tst] == 1))},
           "draw_auc": {"selection": auc(F[sel, 1], (y[sel] == 1).astype(int)), "test": auc(F[tst, 1], (y[tst] == 1).astype(int))},
           "splits": {}}
    close = d["bookmaker closing"]
    for name, s in (("selection", sel), ("test", tst), ("both", mask)):
        wc = s & np.all(np.isfinite(close), 1)
        dc_i, dc_p = double_chance(F[s], picks(F[s], rule))
        dc_hit = np.array([y[s][i] in PAIRS[dc_i[i]][1] for i in range(int(s.sum()))])
        dc_tiers = []
        for lo, hi in ((0.85, 1.01), (0.75, 0.85), (0.0, 0.75)):
            t = (dc_p >= lo) & (dc_p < hi)
            if t.any():
                dc_tiers.append({"from": lo, "share": float(t.mean()), "n": int(t.sum()), "hit_rate": float(dc_hit[t].mean())})
        out["splits"][name] = {
            "most_likely_outcome": rule_stats(F[s], y[s], argmax),
            "with_draw_rule": rule_stats(F[s], y[s], rule),
            "bookmaker_closing_most_likely": rule_stats(close[wc], y[wc], argmax),
            "tiers": tier_table(F[s], y[s], rule),
            "double_chance": {"hit_rate": float(dc_hit.mean()), "mean_probability": float(dc_p.mean()), "tiers": dc_tiers},
            "draw_note": (lambda n: {"min_draw": DRAW_NOTE, "share": float(n.sum() / s.sum()), "n": int(n.sum()), "ended_level": float(np.mean(y[n] == 1))})(
                s & (picks(F, rule) != 1) & (F[:, 1] >= DRAW_NOTE)),
        }
    # the on-device engine (the app's fallback for matches not in the published file): its own replay on the
    # same matches. It calls the most likely outcome (no draw rule: its draw calls had no skill on the test season).
    V = d["current engine v2"]
    ok = mask & np.all(np.isfinite(V), 1)
    kv = V.argmax(1)
    pv = V[np.arange(len(y)), kv]
    dvi, dvp = double_chance(V[ok], kv[ok])
    dv_hit = np.array([y[ok][i] in PAIRS[dvi[i]][1] for i in range(int(ok.sum()))])
    note = ok & (kv != 1) & (V[:, 1] >= DRAW_NOTE)
    dv = {"n": int(ok.sum()), "hit_rate": float(np.mean(kv[ok] == y[ok])), "tiers": [], "safer": float(dv_hit.mean()),
          "safer_85": {"share": float(np.mean(dvp >= 0.85)), "hit_rate": float(dv_hit[dvp >= 0.85].mean())},
          "draw_note": {"min_draw": DRAW_NOTE, "share": float(note.sum() / ok.sum()), "n": int(note.sum()), "ended_level": float(np.mean(y[note] == 1))},
          "draw_rule_test_precision": rule_stats(V[tst & ok], y[tst & ok], rule)["draw_precision"]}
    hi = 1.01
    for name, lo in TIERS:
        t = ok & (pv >= lo) & (pv < hi)
        dv["tiers"].append({"tier": name, "share": float(t.sum() / ok.sum()), "n": int(t.sum()), "hit_rate": float(np.mean(kv[t] == y[t]))})
        hi = lo
    out["device_engine"] = dv
    (RESULTS / f"{RUN}_picks.json").write_text(json.dumps(out, indent=1))
    print("device engine:", {k: v for k, v in dv.items() if k != "tiers"}, [(t["tier"], round(t["share"], 3), round(t["hit_rate"], 3)) for t in dv["tiers"]])
    print("rule", rule, "| draw AUC", {k: round(v, 4) for k, v in out["draw_auc"].items()})
    for name, v in out["splits"].items():
        a, b = v["most_likely_outcome"], v["with_draw_rule"]
        print(f"{name:9s} argmax hit {a['hit_rate']:.4f} (draw picks {a['draw_share']:.3f}) | rule hit {b['hit_rate']:.4f} draws called "
              f"{b['draw_share']:.3f} precision {b['draw_precision']:.3f} recall {b['draw_recall']:.3f} | bookmaker {v['bookmaker_closing_most_likely']['hit_rate']:.4f}")
        print("   tiers:", [(t["tier"], round(t["share"], 3), round(t["hit_rate"], 3)) for t in v["tiers"]])
        print("   draw note:", v["draw_note"])
        print("   double chance:", round(v["double_chance"]["hit_rate"], 4), [(t["from"], round(t["share"], 3), round(t["hit_rate"], 3)) for t in v["double_chance"]["tiers"]])


if __name__ == "__main__":
    main()
