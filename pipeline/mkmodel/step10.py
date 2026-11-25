"""Step 10: should the published model cover nine more leagues?

Candidates (football-data.co.uk has results, shots and odds for all of them, and ESPN has live scores):
League One, League Two, Scottish Premiership, 2. Bundesliga, Serie B, LaLiga 2, Ligue 2, Belgian Pro League,
Greek Super League. Six of them already feed the ratings; Scotland, Belgium and Greece were added for this step.

Protocol (written before any result was seen):
  * Two runs of the deployed model (the Step 8 production rule: odds ensemble once odds are out; before that the
    market-history ensemble for league matches where both teams have market history, otherwise the Step 6 no-odds
    ensemble), with the same features (k = 0.35), monthly walk-forward refits and monthly blend fits:
      - "current": competitions as deployed today (APP_LEAGUES, with the lower divisions feeding ratings only);
      - "extended": APP_LEAGUES + the nine leagues, all treated as app competitions.
  * Scored at kick-off (what the official record grades) and days ahead (league matches before odds are out),
    2024-25 = selection season, 2025-26 = test season, both reported.
  * Benchmarks on the same matches: the on-device engine (the app's prediction for leagues the pipeline does not
    cover; replayed on the same permitted data by mobile/scripts/audit/engine-on-permitted.ts), league base rates,
    bookmaker pre-closing and closing odds.
  * Decision, per new league: publish if, on both seasons together, the extended model's at-kick-off log loss is
    lower than the on-device engine's on the same matches. Overall gate: the existing leagues' at-kick-off log loss
    in the extended run may not be worse than in the current run by more than 0.002 (both seasons together);
    if it is, nothing is published.

    python -m mkmodel.step10 export        (writes the permitted results of the nine leagues for the engine replay)
    python -m mkmodel.step10               (both runs; writes audit/results/step10.json)
"""

from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timezone

import numpy as np

from . import experiment as ex
from . import step8 as s8
from .data import APP_LEAGUES_STEP9 as APP_LEAGUES, EU, EVAL, LOWER_STEP9 as LOWER, STEP10_LEAGUES, load
from .features import FEATURES, Config, EloParams, build

NEW = STEP10_LEAGUES
OUT = ex.RESULTS / "step10.json"
CACHE = ex.ROOT / "pipeline" / "var" / "step10_preds.npz"
POOL = ex.ROOT / "audit" / "data" / "permitted" / "football_new_leagues.json"
ENGINE = ex.RESULTS / "engine_v2_new_leagues.preds.json"
NO_PRE_ODDS = {"usa.1", "uefa.champions"}
PRE_START = datetime(2023, 7, 1, tzinfo=timezone.utc).timestamp()


def window(comp: str) -> tuple[float, float]:
    return EVAL.get(comp, EU)


def rps(P: np.ndarray, y: np.ndarray) -> float:
    """Ranked probability score for ordered outcomes home < draw < away (lower is better)."""
    oh = np.eye(3)[y]
    c = np.cumsum(P, 1)[:, :2] - np.cumsum(oh, 1)[:, :2]
    return float(np.mean(np.sum(c ** 2, 1) / 2))


def score(P: np.ndarray, y: np.ndarray) -> dict:
    r = ex.metrics(P, y)
    r["rps"] = rps(np.clip(P, 1e-12, 1) / np.clip(P, 1e-12, 1).sum(1, keepdims=True), y)
    return r


def run(app_comps: list[str], feed: list[str]) -> dict:
    t0 = time.time()
    col = {f: i for i, f in enumerate(FEATURES)}
    cols = lambda groups: [col[f] for g in groups for f in ex.GROUPS[g]]
    ms_all = load(comps=app_comps + feed)
    X, ms = build(ms_all, Config(elo=EloParams(), start=ex.FEATURE_START, mr_k=0.35))
    y = np.array([m.outcome if m.outcome is not None else -1 for m in ms])
    comps = np.array([m.comp for m in ms])
    kick = np.array([m.t for m in ms])
    app = np.isin(comps, app_comps)
    known = y >= 0
    mask = app & known & np.array([window(m.comp)[0] <= m.t < window(m.comp)[1] for m in ms])
    ext = mask | (app & known & (kick >= PRE_START))
    M: dict[str, np.ndarray] = {}
    M["pre"] = X[:, [col["mk_h"], col["mk_d"], col["mk_a"]]]
    M["close"] = np.array([m.close if m.close is not None else (np.nan,) * 3 for m in ms], float)
    M["elo (ordered logit)"] = ex.walk_forward(X, y, ms, ext, ex.ordered_logit)
    M["dixon-coles"] = X[:, [col["dc_h"], col["dc_d"], col["dc_a"]]]
    M["dixon-coles xg-proxy"] = X[:, [col["dcx_h"], col["dcx_d"], col["dcx_a"]]]
    M["market history (ordered logit)"] = ex.walk_forward(X, y, ms, ext, s8.mr_logit(col["mr_diff"]))
    print(f"  ratings models done ({time.time() - t0:.0f}s)", flush=True)
    M["gbm base"] = ex.walk_forward(X, y, ms, ext, ex.gbm_factory(cols(s8.BASE)))
    M["gbm base + odds"] = ex.walk_forward(X, y, ms, ext, ex.gbm_factory(cols(s8.BASE + ["market_pre"])))
    M["gbm new"] = ex.walk_forward(X, y, ms, ext, ex.gbm_factory(cols(s8.BASE + ["market_hist"])))
    print(f"  boosted trees done ({time.time() - t0:.0f}s)", flush=True)
    fb = {"market history (ordered logit)": ["elo (ordered logit)"]}
    no_old = ex.calibrate_and_blend(M, y, ms, ext, ["elo (ordered logit)", "dixon-coles", "dixon-coles xg-proxy", "gbm base"], True, fb)
    no_mh = ex.calibrate_and_blend(M, y, ms, ext, ["elo (ordered logit)", "dixon-coles", "dixon-coles xg-proxy", "market history (ordered logit)", "gbm new"], True, fb)
    M["bookmaker pre-closing (Tue/Fri)"] = M["pre"]
    odds = ex.calibrate_and_blend(M, y, ms, ext, ["elo (ordered logit)", "dixon-coles", "dixon-coles xg-proxy", "gbm base", "bookmaker pre-closing (Tue/Fri)", "gbm base + odds"],
                                  False, {**fb, "bookmaker pre-closing (Tue/Fri)": ["gbm base"]})
    use = np.all(np.isfinite(M["market history (ordered logit)"]), 1) & ~np.isin(comps, list(NO_PRE_ODDS))
    days_ahead = np.where(use[:, None], no_mh, no_old)
    has = np.all(np.isfinite(M["pre"]), 1)
    at_ko = np.where(has[:, None], odds, days_ahead)
    print(f"  run done ({time.time() - t0:.0f}s)", flush=True)
    return {"ids": np.array([m.id for m in ms]), "comps": comps, "seasons": np.array([ex.split_of(m) for m in ms]), "y": y, "mask": mask,
            "has_odds": has, "at_ko": at_ko, "days_ahead": days_ahead, "pre": M["pre"], "close": M["close"]}


def pick_calibration(P: np.ndarray, y: np.ndarray, edges=(0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1.0001)) -> list[dict]:
    """How often the called outcome happened, by the probability the model gave it (the accuracy page's chart)."""
    p = P.max(1)
    hit = P.argmax(1) == y
    out = []
    for lo, hi in zip((0.0,) + edges[:-1], edges):
        s = (p >= lo) & (p < hi)
        if s.sum() >= 30:
            out.append({"lo": round(lo, 2), "hi": round(min(hi, 1.0), 2), "n": int(s.sum()), "mean_p": float(p[s].mean()), "hit_rate": float(hit[s].mean())})
    return out


def track_record_of(P: np.ndarray, y: np.ndarray, close: np.ndarray) -> dict:
    """The app's track record (production.track_record format) for these predictions, with the deployed call rules."""
    from .picks import PAIRS, TIERS, double_chance, picks, tier_of

    k = picks(P)
    pk = P[np.arange(len(P)), k]
    hit = k == y
    tiers = np.array([tier_of(float(v)) for v in pk])
    dc_i, _ = double_chance(P, k)
    dc_hit = np.array([y[i] in PAIRS[dc_i[i]][1] for i in range(len(y))])
    wc = np.all(np.isfinite(close), 1)
    strong = tiers == "strong"
    return {
        "tiers": {t: {"n": int((tiers == t).sum()), "hit_rate": float(hit[tiers == t].mean()), "share": float((tiers == t).mean())} for t, _ in TIERS if (tiers == t).any()},
        "draw_calls": {"n": int((k == 1).sum()), "hit_rate": float(hit[k == 1].mean()) if (k == 1).any() else None, "share": float((k == 1).mean()), "base_rate": float((y == 1).mean())},
        "all_matches": {"n": int(len(y)), "hit_rate": float(hit.mean())},
        "bookmaker": {"n": int(wc.sum()), "hit_rate": float((close[wc].argmax(1) == y[wc]).mean())},
        "double_chance": {"n": int(len(y)), "hit_rate": float(dc_hit.mean()), "strong": {"n": int(strong.sum()), "hit_rate": float(dc_hit[strong].mean()), "share": float(strong.mean())}},
    }


def deployed_quality(run_: dict) -> dict:
    """Probability quality of the model now deployed (the extended run), at kick-off, both seasons."""
    sel = run_["mask"] & np.all(np.isfinite(run_["at_ko"]), 1)
    P, y = run_["at_ko"][sel], run_["y"][sel]
    close = run_["close"][sel]
    wc = np.all(np.isfinite(close), 1)
    comps = run_["comps"][sel]
    return {
        "period": "2024-25 and 2025-26 seasons (MLS 2024 and 2025), every match predicted only from earlier data, graded at kick-off",
        "all": score(P, y),
        "bookmaker_closing_same_matches": {"model": score(P[wc], y[wc]), "bookmaker": score(close[wc], y[wc])},
        "pick_calibration": pick_calibration(P, y),
        "outcome_calibration": ex.calib_table(P, y),
        "competitions": {c: score(P[comps == c], y[comps == c]) for c in sorted(set(comps))},
        "track_record": track_record_of(P, y, close),
    }


def export() -> None:
    """The nine leagues' results in the format of audit/data/permitted/football_app_leagues.json, for the engine replay."""
    rows = []
    for m in load(comps=NEW):
        if m.outcome is None:
            continue
        rows.append({"id": m.id, "t": int(m.t * 1000), "h": m.h, "a": m.a, "hs": m.hs, "as": m.as_, "n": 0, "league": m.comp})
    POOL.parent.mkdir(parents=True, exist_ok=True)
    POOL.write_text(json.dumps(rows))
    print(f"{len(rows)} results -> {POOL}")


def main() -> None:
    t0 = time.time()
    if CACHE.exists() and "--fresh" not in sys.argv:
        d = dict(np.load(CACHE, allow_pickle=True))
        cur = {k[4:]: v for k, v in d.items() if k.startswith("cur_")}
        new = {k[4:]: v for k, v in d.items() if k.startswith("new_")}
    else:
        feed_now = LOWER  # today: lower divisions feed ratings only; Scotland, Belgium and Greece are not loaded
        print("current run", flush=True)
        cur = run(APP_LEAGUES, feed_now)
        print("extended run", flush=True)
        new = run(APP_LEAGUES + NEW, [c for c in LOWER if c not in NEW])
        np.savez_compressed(CACHE, **{f"cur_{k}": v for k, v in cur.items()}, **{f"new_{k}": v for k, v in new.items()})

    engine = {r["id"]: r["p"] for r in json.loads(ENGINE.read_text())} if ENGINE.exists() else {}
    res: dict = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "protocol": __doc__}

    # 1. the gate: existing leagues, current vs extended, on the same matches
    idx_new = {i: k for k, i in enumerate(new["ids"])}
    rows = [(k, idx_new[i]) for k, i in enumerate(cur["ids"]) if cur["mask"][k] and i in idx_new and new["mask"][idx_new[i]]]
    a = np.array([r[0] for r in rows])
    b = np.array([r[1] for r in rows])
    ok = np.all(np.isfinite(cur["at_ko"][a]), 1) & np.all(np.isfinite(new["at_ko"][b]), 1)
    a, b = a[ok], b[ok]
    gate = {}
    for sp in ("selection", "test", "both"):
        s = (cur["seasons"][a] == sp) if sp != "both" else np.ones(len(a), bool)
        yc = cur["y"][a][s]
        gate[sp] = {"current": score(cur["at_ko"][a][s], yc), "extended": score(new["at_ko"][b][s], yc)}
        da = cur["has_odds"][a][s]
        gate[sp]["days_ahead_current"] = score(cur["days_ahead"][a][s][da], yc[da])
        gate[sp]["days_ahead_extended"] = score(new["days_ahead"][b][s][da], yc[da])
    worse = gate["both"]["extended"]["log_loss"] - gate["both"]["current"]["log_loss"]
    res["existing_leagues"] = gate
    res["gate_passed"] = bool(worse <= 0.002)
    res["gate_log_loss_change"] = worse

    # 2. the new leagues: extended model vs the on-device engine, bookmakers and base rates
    comps = new["comps"]
    per = {}
    for c in NEW:
        sel = new["mask"] & (comps == c) & np.all(np.isfinite(new["at_ko"]), 1)
        if not sel.any():
            per[c] = {"n": 0}
            continue
        ids = new["ids"][sel]
        eng = np.array([engine.get(i, (np.nan,) * 3) for i in ids], float)
        y = new["y"][sel]
        entry = {}
        for sp in ("selection", "test", "both"):
            s = (new["seasons"][sel] == sp) if sp != "both" else np.ones(int(sel.sum()), bool)
            if not s.any():
                continue
            e = {"model_at_kickoff": score(new["at_ko"][sel][s], y[s])}
            both = s & np.all(np.isfinite(eng), 1)
            if both.any():
                e["engine_same_matches"] = score(eng[both], y[both])
                e["model_same_matches"] = score(new["at_ko"][sel][both], y[both])
            cl = s & np.all(np.isfinite(new["close"][sel]), 1)
            if cl.any():
                e["closing_odds"] = score(new["close"][sel][cl], y[cl])
                e["model_with_closing"] = score(new["at_ko"][sel][cl], y[cl])
            prior = np.bincount(y[s], minlength=3) / s.sum()
            e["base_rate"] = score(np.tile(prior, (int(s.sum()), 1)), y[s])  # in-sample shares: a generous naive benchmark
            entry[sp] = e
        b = entry.get("both", {})
        entry["publish"] = bool(res["gate_passed"] and "engine_same_matches" in b and b["model_same_matches"]["log_loss"] < b["engine_same_matches"]["log_loss"])
        per[c] = entry
    res["new_leagues"] = per
    res["publish"] = [c for c in NEW if per.get(c, {}).get("publish")]
    res["deployed"] = deployed_quality(new)
    res["runtime_s"] = round(time.time() - t0)
    OUT.write_text(json.dumps(res, indent=1, default=float))
    g = gate["both"]
    print(f"existing leagues at kick-off: current LL {g['current']['log_loss']:.4f} acc {g['current']['accuracy']:.4f} | "
          f"extended LL {g['extended']['log_loss']:.4f} acc {g['extended']['accuracy']:.4f} -> gate {'passed' if res['gate_passed'] else 'FAILED'}")
    for c in NEW:
        b = per[c].get("both", {})
        if not b:
            print(c, "no matches")
            continue
        m, e = b.get("model_same_matches"), b.get("engine_same_matches")
        print(f"{c:6s} n={b['model_at_kickoff']['n']:4d} model acc {b['model_at_kickoff']['accuracy']:.3f} LL {b['model_at_kickoff']['log_loss']:.4f}"
              + (f" | same matches: model {m['log_loss']:.4f} vs engine {e['log_loss']:.4f} (acc {m['accuracy']:.3f} vs {e['accuracy']:.3f})" if e else " | no engine replay")
              + (f" | closing odds LL {b['closing_odds']['log_loss']:.4f}" if "closing_odds" in b else "")
              + f" -> {'publish' if per[c]['publish'] else 'keep on device'}")


if __name__ == "__main__":
    export() if "export" in sys.argv else main()
