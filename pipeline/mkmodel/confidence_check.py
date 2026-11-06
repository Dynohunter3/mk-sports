"""Does the confidence score mean anything? Score every Step 3 evaluation match with the production
confidence rules (using only what was known before kick-off), then measure the real error per band.

    python -m mkmodel.confidence_check      (writes audit/results/step4_confidence.json)
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

import numpy as np

from .data import APP_LEAGUES, LOWER, load
from .experiment import CACHE, RESULTS, RUN, metrics
from .features import Config, EloParams, build
from .production import COL, FEATURE_START, confidence, label


def main() -> None:
    d = np.load(CACHE, allow_pickle=True)
    ms_all = load(comps=APP_LEAGUES + LOWER)
    X, ms = build(ms_all, Config(elo=EloParams(), start=FEATURE_START))
    pos = {m.id: i for i, m in enumerate(ms)}
    ids, y, mask = d["ids"], d["y"], d["mask"]
    assert all(pos[i] == k for k, i in enumerate(ids)), "feature rows must line up with the Step 3 cache"
    final = np.where(np.all(np.isfinite(d["bookmaker pre-closing (Tue/Fri)"]), 1)[:, None], d["ensemble + market"], d["ensemble (no market) + calibration"])
    comps = {"elo": d["elo (ordered logit)"], "dc": X[:, [COL["dc_h"], COL["dc_d"], COL["dc_a"]]], "gbm_nomkt": d["gbm[elo+context+dc+xg_proxy]"]}
    # source-disagreement context, point in time: a team's last 10 results known before kick-off
    history: dict[str, list[tuple[float, float]]] = {}
    for m in ms:
        if m.result_at is not None:
            for t in (m.h, m.a):
                history.setdefault(t, []).append((m.result_at, m.agreement))
    scores, labels, reasons = np.full(len(ms), np.nan), np.array([""] * len(ms), dtype=object), {}
    for i in np.where(mask)[0]:
        m = ms[i]
        rec = sum(1 for t in (m.h, m.a) for a in [a for (ra, a) in history.get(t, []) if ra < m.t][-10:] if a < 1.0)
        s, why = confidence(X[i], comps, i, {"source_conflict": m.agreement < 1.0, "recent_disputed": rec})
        scores[i], labels[i] = s, label(s)
        for w in why:
            key = w.split(" (")[0]
            reasons[key] = reasons.get(key, 0) + 1
    close = d["bookmaker closing"]
    P = np.clip(final, 1e-12, 1)
    ll = -np.log(P[np.arange(len(y)), np.maximum(y, 0)])
    entropy = -np.sum(P * np.log(P), 1)
    ll_close = np.where(np.all(np.isfinite(close), 1), -np.log(np.clip(np.nan_to_num(close)[np.arange(len(y)), np.maximum(y, 0)], 1e-12, 1)), np.nan)
    season = np.array([(m.season == "2024" if m.comp == "usa.1" else m.season == "2024-25") for m in ms])
    out = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "matches": int(mask.sum()), "bands": {}, "reasons": reasons,
           "note": "excess = actual log loss minus the model's own expected log loss (entropy); gap = log loss minus closing odds log loss"}
    for split, smask in (("selection 2024-25", season), ("test 2025-26", ~season)):
        out["bands"][split] = {}
        for lab in ("high", "medium", "low"):
            sel = mask & smask & (labels == lab)
            if not sel.any():
                continue
            wc = sel & np.isfinite(ll_close)
            out["bands"][split][lab] = {"share": float(sel.sum() / (mask & smask).sum()), "n": int(sel.sum()),
                                        "log_loss": float(ll[sel].mean()), "excess_loss": float((ll - entropy)[sel].mean()),
                                        "gap_to_closing": float((ll - ll_close)[wc].mean()) if wc.any() else None,
                                        "accuracy": metrics(final[sel], y[sel])["accuracy"]}
    name = "step4_confidence.json" if RUN == "step3" else f"{RUN}_confidence.json"
    (RESULTS / name).write_text(json.dumps(out, indent=1))
    for split, bands in out["bands"].items():
        for lab, v in bands.items():
            g = "–" if v["gap_to_closing"] is None else f"{v['gap_to_closing']:+.4f}"
            print(f"{split:18s} {lab:6s} {100 * v['share']:5.1f}% n={v['n']:5d}  LL {v['log_loss']:.4f}  excess {v['excess_loss']:+.4f}  gap {g}")
    print(sorted(reasons.items(), key=lambda x: -x[1]))


if __name__ == "__main__":
    main()
