"""Step 11: does the season simulator's probability hold up? An honest backtest on finished seasons.

Protocol (fixed before any result was seen):
  - Simulation dates: 1 December and 1 March of 2024-25 and 2025-26 (about a third and two-thirds of a season).
  - At each date the production model is retrained on data available before that date only (same code, same
    settings), and the simulator runs exactly as in production, with ``as_of`` set to the date. No published
    predictions existed then, so every fixture uses the model's no-odds blend (production uses the published
    prediction, with odds, for the next few days' fixtures: a small difference).
  - Leagues: every league the app simulates; a league-season whose data is not a complete double round robin
    (for example the 19-team Süper Lig of 2024-25) is skipped automatically.
  - Outcome: the final table computed from the results (points, goal difference, goals scored).
  - Scores: the Brier score of each zone probability (title, top four, top six, promotion, play-offs,
    relegation) against two baselines: "the table as it stands" (probability 1 for teams currently inside the
    zone) and the zone's base rate (its size over the number of teams). Also the ranked probability score of
    each team's whole finishing-position distribution against "stays where it is", and a calibration table.

    python -m mkmodel.sim_backtest            # writes audit/results/step11.json (about 30 minutes)
"""
from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from . import simulate as S
from .data import APP_LEAGUES, LOWER, STORE, load

DATES = ["2024-12-01", "2025-03-01", "2025-12-01", "2026-03-01"]
OUT = Path(__file__).resolve().parents[2] / "audit" / "results" / "step11.json"
WORK = Path(__file__).resolve().parents[1] / "var" / "step11_models"


def ts(day: str) -> float:
    return datetime.fromisoformat(day).replace(tzinfo=timezone.utc).timestamp()


def final_places(st_end: S.LeagueState) -> dict[str, int]:
    rows = sorted(st_end.teams, key=lambda t: (-st_end.table[t]["pts"], -(st_end.table[t]["gf"] - st_end.table[t]["ga"]),
                                                -st_end.table[t]["gf"], t))
    return {t: i for i, t in enumerate(rows)}  # 0-based


def current_places(st: S.LeagueState) -> dict[str, int]:
    return final_places(st)


def rps_positions(dist: np.ndarray, actual: int) -> float:
    n = len(dist)
    o = np.zeros(n)
    o[actual] = 1
    return float(np.sum((np.cumsum(dist) - np.cumsum(o))[:-1] ** 2) / (n - 1))


def run_date(day: str, store: Path, sims: int) -> list[dict]:
    from .production import retrain
    t = ts(day)
    t0 = time.time()
    bundle = retrain(t, store=store, out_root=WORK)
    print(f"{day}: retrained {bundle.version} in {time.time() - t0:.0f}s", file=sys.stderr, flush=True)
    res = S.run(t, store, bundle, sims, use_log=False)
    end = load(store, comps=APP_LEAGUES + LOWER)  # everything known now: the finished seasons
    rows = []
    for c, r in res.items():
        if "state" not in r:
            rows.append({"date": day, "competition": c, "skipped": r.get("problem")})
            continue
        st: S.LeagueState = r["state"]
        st_end = S.league_state([m for m in end if m.season == st.season], c, 1e12, S.LEAGUES[c]["teams"])
        if st_end is None or st_end.remaining or set(st_end.teams) != set(st.teams):
            rows.append({"date": day, "competition": c, "skipped": "season not complete in the data"})
            continue
        fin = final_places(st_end)
        now = current_places(st)
        n = len(st.teams)
        zones = r["zones"]
        zp = S.zone_probs(r["positions"], zones)
        for i, team in enumerate(st.teams):
            for j, z in enumerate(zones):
                inside = lambda place: z["from"] - 1 <= place <= z["to"] - 1  # noqa: E731
                rows.append({"date": day, "competition": c, "season": st.season, "team": team, "zone": z["key"],
                             "p": float(zp[i, j]), "now": float(inside(now[team])), "base": (z["to"] - z["from"] + 1) / n,
                             "y": float(inside(fin[team]))})
            rows.append({"date": day, "competition": c, "season": st.season, "team": team, "zone": "_positions",
                         "rps": rps_positions(r["positions"][i], fin[team]),
                         "rps_now": rps_positions(np.eye(n)[now[team]], fin[team])})
    return rows


def summarise(rows: list[dict]) -> dict:
    zr = [r for r in rows if "y" in r]
    pr = [r for r in rows if r.get("zone") == "_positions"]
    by_zone = {}
    for z in sorted({r["zone"] for r in zr}):
        q = [r for r in zr if r["zone"] == z]
        y = np.array([r["y"] for r in q])
        b = lambda k: float(np.mean((np.array([r[k] for r in q]) - y) ** 2))  # noqa: E731
        by_zone[z] = {"n": len(q), "events": int(y.sum()), "brier": round(b("p"), 4), "brier_table_now": round(b("now"), 4),
                      "brier_base_rate": round(b("base"), 4)}
    p = np.array([r["p"] for r in zr])
    y = np.array([r["y"] for r in zr])
    bins = [0, 0.02, 0.1, 0.25, 0.5, 0.75, 0.9, 0.98, 1.0001]
    cal = []
    for lo, hi in zip(bins[:-1], bins[1:]):
        k = (p >= lo) & (p < hi)
        if k.sum():
            cal.append({"from": lo, "to": min(hi, 1.0), "n": int(k.sum()), "mean_p": round(float(p[k].mean()), 4),
                        "happened": round(float(y[k].mean()), 4)})
    by_date = {}
    for d in DATES:
        q = [r for r in zr if r["date"] == d]
        if q:
            yy = np.array([r["y"] for r in q])
            by_date[d] = {"n": len(q), "brier": round(float(np.mean((np.array([r["p"] for r in q]) - yy) ** 2)), 4),
                          "brier_table_now": round(float(np.mean((np.array([r["now"] for r in q]) - yy) ** 2)), 4)}
    return {"zones": by_zone, "by_date": by_date, "calibration": cal,
            "positions": {"teams": len(pr), "rps": round(float(np.mean([r["rps"] for r in pr])), 4),
                          "rps_stays_where_it_is": round(float(np.mean([r["rps_now"] for r in pr])), 4)},
            "league_seasons": sorted({(r["competition"], r["date"]) for r in zr}),
            "skipped": sorted({(r["competition"], r["date"], r["skipped"]) for r in rows if "skipped" in r})}


def main(argv=None) -> int:
    sims = 10_000
    rows = []
    for d in DATES:
        rows += run_date(d, STORE, sims)
    summary = summarise(rows)
    out = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "dates": DATES, "simulations": sims,
           "summary": summary, "league_season_dates": len(summary["league_seasons"]),
           "rows_file": "pipeline/var/step11_rows.json (not committed; python -m mkmodel.sim_backtest rebuilds it)"}
    OUT.write_text(json.dumps(out, indent=1, default=list))
    (Path(__file__).resolve().parents[1] / "var" / "step11_rows.json").write_text(json.dumps(rows, default=list))
    print(json.dumps(out["summary"], indent=1, default=list))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
