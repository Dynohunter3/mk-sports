"""Season simulator: play out every remaining league fixture many times with the model's probabilities.

For each league whose season is a plain double round robin (every team plays every other team home and away,
and the final table decides the title, promotion and relegation), the fixtures still to play are every
(home, away) pairing not played yet. Each one gets a home/draw/away probability:

  - the published prediction (the last one made before the simulation time) where there is one: these use
    the bookmakers' odds when they are out;
  - otherwise the production model's no-odds blend, with features as they stand at the simulation time
    (team ratings, Dixon-Coles strengths, form) and a neutral schedule (7 days' rest).

Each simulation draws a score for every fixture from the Dixon-Coles score grid of the model's expected goals,
re-weighted so that home win, draw and away win have exactly the model's probabilities. Tables are ranked on
points, then goal difference, then goals scored, then at random. Probabilities stay fixed through a simulated
season (team strengths are not updated by simulated results), which makes long-range outcomes slightly too
certain; the backtest in docs/audit/STEP11_SEASON_SIMULATOR.md measures how well the probabilities hold up.

Not modelled: point deductions, head-to-head tie-breakers, play-off matches (only the places that lead to them).

    python -m mkmodel.simulate            # writes var/publish/simulations.json and a snapshot in the store
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from .data import APP_LEAGUES, LOWER, STORE, M, load
from .features import FEATURES, Config, EloParams, _tau_matrix, build

DAY = 86400.0
COL = {f: i for i, f in enumerate(FEATURES)}
SIMS = 10_000
RHO = -0.08  # low-score correction for the sampled grids; outcome totals are re-weighted to the model anyway

# Zones are league places as the 2026-27 rules set them (checked 26 Nov 2026). "Europe" is the places that
# normally qualify through the league table; cup winners can move them.
Z = lambda key, a, b: {"key": key, "from": a, "to": b}  # noqa: E731
LEAGUES: dict[str, dict] = {
    "eng.1": {"teams": 20, "zones": [Z("title", 1, 1), Z("top4", 1, 4), Z("europe", 1, 6), Z("relegation", 18, 20)]},
    "esp.1": {"teams": 20, "zones": [Z("title", 1, 1), Z("top4", 1, 4), Z("europe", 1, 6), Z("relegation", 18, 20)]},
    "ita.1": {"teams": 20, "zones": [Z("title", 1, 1), Z("top4", 1, 4), Z("europe", 1, 6), Z("relegation", 18, 20)]},
    "ger.1": {"teams": 18, "zones": [Z("title", 1, 1), Z("top4", 1, 4), Z("europe", 1, 6), Z("relegation", 17, 18)]},
    "fra.1": {"teams": 18, "zones": [Z("title", 1, 1), Z("top4", 1, 4), Z("europe", 1, 6), Z("relegation", 17, 18)]},
    "ned.1": {"teams": 18, "zones": [Z("title", 1, 1), Z("top4", 1, 4), Z("relegation", 17, 18)]},
    "por.1": {"teams": 18, "zones": [Z("title", 1, 1), Z("top4", 1, 4), Z("relegation", 17, 18)]},
    "tur.1": {"teams": 18, "zones": [Z("title", 1, 1), Z("top4", 1, 4), Z("relegation", 16, 18)]},
    "eng.2": {"teams": 24, "zones": [Z("title", 1, 1), Z("promotion", 1, 2), Z("playoffs", 3, 6), Z("relegation", 22, 24)]},
    "eng.3": {"teams": 24, "zones": [Z("title", 1, 1), Z("promotion", 1, 2), Z("playoffs", 3, 6), Z("relegation", 21, 24)]},
    "eng.4": {"teams": 24, "zones": [Z("title", 1, 1), Z("promotion", 1, 3), Z("playoffs", 4, 7), Z("relegation", 23, 24)]},
    "ger.2": {"teams": 18, "zones": [Z("title", 1, 1), Z("promotion", 1, 2), Z("playoffs", 3, 3), Z("relegation", 17, 18)]},
    "ita.2": {"teams": 20, "zones": [Z("title", 1, 1), Z("promotion", 1, 2), Z("playoffs", 3, 8), Z("relegation", 18, 20)]},
    "esp.2": {"teams": 22, "zones": [Z("title", 1, 1), Z("promotion", 1, 2), Z("playoffs", 3, 6), Z("relegation", 19, 22)]},
    "fra.2": {"teams": 18, "zones": [Z("title", 1, 1), Z("promotion", 1, 2), Z("playoffs", 3, 5), Z("relegation", 17, 18)]},
}
# Published competitions that are not simulated, and why (shown in the file so the app can say so).
NOT_SIMULATED = {
    "sco.1": "the league splits in two after 33 rounds, so the remaining fixtures are not known in advance",
    "bel.1": "the title and relegation are decided in play-offs after the regular season",
    "gre.1": "the title and relegation are decided in play-offs after the regular season",
    "usa.1": "conferences, an unbalanced schedule and play-offs",
    "uefa.champions": "a knockout competition",
}
LABELS = {"title": "Title", "top4": "Top four", "europe": "Top six (Europe)", "promotion": "Automatic promotion",
          "playoffs": "Play-off places", "relegation": "Relegation"}


@dataclass
class LeagueState:
    comp: str
    season: str
    teams: list[str]
    table: dict[str, dict]  # team -> played, won, drawn, lost, gf, ga, pts
    remaining: list[tuple[str, str]]  # (home, away) pairings still to play
    problem: str | None = None


def league_state(ms: list[M], comp: str, as_of: float, n_teams: int) -> LeagueState | None:
    """The table and the fixtures still to play in the season under way at ``as_of``.
    ``ms`` must come from ``load(as_of=...)`` so results known later are blank."""
    own = [m for m in ms if m.comp == comp and m.t <= as_of + 30 * DAY]
    if not own:
        return None
    season = max(own, key=lambda m: m.t).season
    rows = [m for m in ms if m.comp == comp and m.season == season]
    teams = sorted({m.h for m in rows} | {m.a for m in rows})
    table = {t: dict(played=0, won=0, drawn=0, lost=0, gf=0, ga=0, pts=0) for t in teams}
    played: dict[tuple[str, str], int] = {}
    for m in rows:
        if m.outcome is None:
            continue
        played[(m.h, m.a)] = played.get((m.h, m.a), 0) + 1
        for team, f, a in ((m.h, m.hs, m.as_), (m.a, m.as_, m.hs)):
            r = table[team]
            r["played"] += 1
            r["gf"] += f
            r["ga"] += a
            r["won" if f > a else "drawn" if f == a else "lost"] += 1
            r["pts"] += 3 if f > a else 1 if f == a else 0
    st = LeagueState(comp, season, teams, table, [(h, a) for h in teams for a in teams if h != a and (h, a) not in played])
    if len(teams) != n_teams:
        st.problem = f"{len(teams)} teams in the data, {n_teams} expected"
    elif any(v > 1 for v in played.values()):
        st.problem = "a pairing has two results"
    elif not st.remaining:
        st.problem = "season finished"
    elif not any(r["played"] for r in table.values()):
        st.problem = "season not started"
    return st


def _neutral_schedule(X: np.ndarray) -> None:
    """Synthetic fixtures have no real date: a week's rest and one match in the past fortnight for everyone."""
    X[:, COL["rest_h"]] = X[:, COL["rest_a"]] = 7.0
    X[:, COL["busy_h"]] = X[:, COL["busy_a"]] = 1.0


def model_inputs(ms_all: list[M], fixtures: list[tuple[str, str, str, str]], bundle, as_of: float):
    """Probabilities and expected goals for (comp, season, home, away) fixtures from the production model's
    no-odds blend, with features as of ``as_of``. Returns (p [n x 3], lambdas [n x 2])."""
    from .production import FEATURE_START, base_predictions, final_probs  # local: production imports this module's users
    synth = [M(f"sim/{c}/{s}/{h}~{a}", c, s, as_of + DAY + k * 1e-3, h, a, None, None, None, 1.0)
             for k, (c, s, h, a) in enumerate(fixtures)]
    X, order = build(sorted(ms_all + synth, key=lambda m: (m.t, m.id)), Config(elo=EloParams(), start=FEATURE_START, as_of=as_of))
    pos = {m.id: i for i, m in enumerate(order)}
    Xs = X[[pos[m.id] for m in synth]]
    _neutral_schedule(Xs)
    comps = base_predictions(Xs, bundle.learn)
    comps["market"] = np.full((len(Xs), 3), np.nan)  # never odds for a fixture without a date
    _, no_odds, _, _ = final_probs(comps, bundle.manifest["blends"], [f[0] for f in fixtures])
    lam = Xs[:, [COL["dc_lh"], COL["dc_la"]]].copy()
    # a team with no Dixon-Coles strengths yet: goals that match the probabilities' favourite, 1.35 a side otherwise
    bad = ~np.all(np.isfinite(lam), 1)
    lam[bad] = 1.35
    return np.asarray(no_odds, float), lam


def logged_predictions(store: Path, as_of: float) -> dict[tuple[str, str, str], tuple[float, float, float]]:
    """(comp, home, away) -> the last published prediction made before ``as_of`` for a match not kicked off by then."""
    db = sqlite3.connect(store)
    out = {}
    for comp, h, a, ph, pd, pa in db.execute(
            """SELECT m.competition_id, m.home_id, m.away_id, p.p_home, p.p_draw, p.p_away FROM predictions p
               JOIN matches m USING (match_id) WHERE p.made_at <= ? AND m.kickoff_utc > ?
               ORDER BY p.made_at, p.rowid""", (as_of, as_of)):
        out[(comp, h, a)] = (ph, pd, pa)  # later rows overwrite: the latest version wins
    return out


def score_grids(p: np.ndarray, lam: np.ndarray, maxg: int = 10) -> np.ndarray:
    """Cumulative score distributions [n x (maxg+1)^2] with outcome totals equal to p."""
    k = maxg + 1
    hi, ai = np.divmod(np.arange(k * k), k)
    region = np.where(hi > ai, 0, np.where(hi == ai, 1, 2))
    out = np.empty((len(p), k * k))
    for i in range(len(p)):
        g = _tau_matrix(float(lam[i, 0]), float(lam[i, 1]), RHO).ravel()
        tot = np.array([g[region == r].sum() for r in range(3)])
        w = np.where(tot > 1e-12, p[i] / np.maximum(tot, 1e-12), 0.0)
        g = g * w[region]
        out[i] = np.cumsum(g / g.sum())
    return out


def simulate_league(st: LeagueState, p: np.ndarray, lam: np.ndarray, sims: int, rng: np.random.Generator) -> dict:
    """Positions [team x place] counts, final points per simulation, for one league."""
    idx = {t: i for i, t in enumerate(st.teams)}
    n = len(st.teams)
    pts = np.tile(np.array([st.table[t]["pts"] for t in st.teams], float), (sims, 1))
    gd = np.tile(np.array([st.table[t]["gf"] - st.table[t]["ga"] for t in st.teams], float), (sims, 1))
    gf = np.tile(np.array([st.table[t]["gf"] for t in st.teams], float), (sims, 1))
    cum = score_grids(p, lam)
    k = int(round(np.sqrt(cum.shape[1])))
    for j, (h, a) in enumerate(st.remaining):
        cell = np.minimum(np.searchsorted(cum[j], rng.random(sims), side="right"), cum.shape[1] - 1)
        hg, ag = np.divmod(cell, k)
        ih, ia = idx[h], idx[a]
        pts[:, ih] += np.where(hg > ag, 3, np.where(hg == ag, 1, 0))
        pts[:, ia] += np.where(ag > hg, 3, np.where(hg == ag, 1, 0))
        gd[:, ih] += hg - ag
        gd[:, ia] += ag - hg
        gf[:, ih] += hg
        gf[:, ia] += ag
    key = pts * 1e7 + (gd + 1000) * 1e3 + gf + rng.random((sims, n)) * 0.5
    order = np.argsort(-key, axis=1)
    place = np.empty_like(order)
    place[np.arange(sims)[:, None], order] = np.arange(n)[None, :]
    counts = np.zeros((n, n))
    np.add.at(counts, (np.tile(np.arange(n), sims), place.ravel()), 1)
    return {"positions": counts / sims, "points": pts}


def zone_probs(positions: np.ndarray, zones: list[dict]) -> np.ndarray:
    """[team x zone] probability of finishing inside each zone (places are 1-based, inclusive)."""
    return np.stack([positions[:, z["from"] - 1:z["to"]].sum(1) for z in zones], 1)


def _seed(*parts) -> int:
    return int(hashlib.sha256("|".join(map(str, parts)).encode()).hexdigest()[:12], 16)


def run(as_of: float, store: Path = STORE, bundle=None, sims: int = SIMS, leagues: dict | None = None,
        use_log: bool = True) -> dict[str, dict]:
    """Simulate every configured league at ``as_of``. Returns comp -> result (or {"problem": ...})."""
    from .production import current_bundle
    bundle = bundle or current_bundle()
    leagues = leagues or LEAGUES
    ms_all = load(store, comps=APP_LEAGUES + LOWER, as_of=as_of)
    states = {c: league_state(ms_all, c, as_of, cfg["teams"]) for c, cfg in leagues.items()}
    todo = [(c, st) for c, st in states.items() if st is not None and st.problem is None]
    fixtures = [(c, st.season, h, a) for c, st in todo for h, a in st.remaining]
    p_model, lam = model_inputs(ms_all, fixtures, bundle, as_of) if fixtures else (np.zeros((0, 3)), np.zeros((0, 2)))
    logged = logged_predictions(store, as_of) if use_log else {}
    out: dict[str, dict] = {}
    for c, st in states.items():
        if st is None:
            out[c] = {"problem": "no matches"}
            continue
        if st.problem:
            out[c] = {"problem": st.problem, "season": st.season}
            continue
    k = 0
    for c, st in todo:
        n = len(st.remaining)
        p = p_model[k:k + n].copy()
        lm = lam[k:k + n]
        k += n
        from_log = 0
        for j, (h, a) in enumerate(st.remaining):
            q = logged.get((c, h, a))
            if q is not None:
                p[j] = q
                from_log += 1
        p = p / p.sum(1, keepdims=True)
        rng = np.random.default_rng(_seed(c, st.season, int(as_of // 3600)))
        sim = simulate_league(st, p, lm, sims, rng)
        out[c] = {"state": st, "positions": sim["positions"], "points": sim["points"], "from_predictions": from_log,
                  "zones": leagues[c]["zones"]}
    return out


# ------------------------------------------------------------------------------------- snapshots and publishing
def ensure_tables(db: sqlite3.Connection) -> None:
    db.execute("""CREATE TABLE IF NOT EXISTS sim_snapshots (comp TEXT, season TEXT, made_at REAL, team_id TEXT, zone TEXT,
                  p REAL, backfilled INTEGER DEFAULT 0, PRIMARY KEY (comp, made_at, team_id, zone))""")


def save_snapshot(store: Path, results: dict, made_at: float, backfilled: bool = False) -> None:
    db = sqlite3.connect(store)
    ensure_tables(db)
    for c, r in results.items():
        if "state" not in r:
            continue
        zp = zone_probs(r["positions"], r["zones"])
        exp = r["points"].mean(0)
        for i, t in enumerate(r["state"].teams):
            rows = [(z["key"], float(zp[i, j])) for j, z in enumerate(r["zones"])] + [("exp_points", float(exp[i]))]
            db.executemany("INSERT OR REPLACE INTO sim_snapshots VALUES (?,?,?,?,?,?,?)",
                           [(c, r["state"].season, made_at, t, z, v, int(backfilled)) for z, v in rows])
    # keep one snapshot a day once they are more than ten days old
    db.execute("""DELETE FROM sim_snapshots WHERE made_at < ? AND made_at NOT IN (
                    SELECT MAX(made_at) FROM sim_snapshots GROUP BY comp, CAST(made_at / 86400 AS INTEGER))""", (made_at - 10 * DAY,))
    db.commit()


def snapshot_near(store: Path, comp: str, season: str, target: float, window: float = 2 * DAY):
    """The snapshot closest to ``target`` (within ``window``): (made_at, backfilled, {team: {zone: p}}) or None."""
    db = sqlite3.connect(store)
    ensure_tables(db)
    r = db.execute("""SELECT made_at, MAX(backfilled) FROM sim_snapshots WHERE comp=? AND season=? AND ABS(made_at - ?) <= ?
                      GROUP BY made_at ORDER BY ABS(made_at - ?) LIMIT 1""", (comp, season, target, window, target)).fetchone()
    if r is None:
        return None
    vals: dict[str, dict] = {}
    for t, z, p in db.execute("SELECT team_id, zone, p FROM sim_snapshots WHERE comp=? AND made_at=?", (comp, r[0])):
        vals.setdefault(t, {})[z] = p
    return r[0], bool(r[1]), vals


def document(results: dict, now: float, store: Path, bundle_version: str, sims: int) -> dict:
    db = sqlite3.connect(store)
    names = {r[0]: r[1] for r in db.execute("SELECT id, name FROM entities")}
    aliases: dict[str, set] = {}
    for eid, raw in db.execute("SELECT entity_id, raw FROM aliases"):
        aliases.setdefault(eid, set()).add(raw)
    iso = lambda t: datetime.fromtimestamp(t, timezone.utc).isoformat(timespec="seconds")  # noqa: E731
    comps = []
    for c, r in results.items():
        if "state" not in r:
            continue
        st: LeagueState = r["state"]
        zones = r["zones"]
        zp = zone_probs(r["positions"], zones)
        pts = r["points"]
        prev = snapshot_near(store, c, st.season, now - 7 * DAY)
        teams = []
        for i, t in enumerate(st.teams):
            row = st.table[t]
            e = {"id": t, "name": names.get(t, t), "aliases": sorted(aliases.get(t, set()) | {names.get(t, t)}),
                 "played": row["played"], "points": row["pts"], "gd": row["gf"] - row["ga"], "gf": row["gf"],
                 "exp_points": round(float(pts[:, i].mean()), 1),
                 "points_range": [int(np.percentile(pts[:, i], 10)), int(np.percentile(pts[:, i], 90))],
                 "positions": [round(float(v), 4) for v in r["positions"][i]],
                 "zones": {z["key"]: round(float(zp[i, j]), 4) for j, z in enumerate(zones)}}
            if prev is not None and t in prev[2]:
                e["week_ago"] = {z["key"]: round(prev[2][t][z["key"]], 4) for z in zones if z["key"] in prev[2][t]}
            teams.append(e)
        teams.sort(key=lambda e: (-e["points"], -e["gd"], -e["gf"], e["name"]))
        comps.append({"competition": c, "season": st.season, "played": sum(v["played"] for v in st.table.values()) // 2,
                      "remaining": len(st.remaining), "from_predictions": r["from_predictions"],
                      "zones": [dict(z, label=LABELS[z["key"]]) for z in zones],
                      "week_ago": None if prev is None else {"at": iso(prev[0]), "backfilled": prev[1]},
                      "teams": teams})
    skipped = {c: r["problem"] for c, r in results.items() if "problem" in r}
    skipped.update(NOT_SIMULATED)
    tested = None
    bt = Path(__file__).resolve().parents[2] / "audit" / "results" / "step11.json"
    if bt.exists():  # the backtest on finished seasons (mkmodel.sim_backtest), shown next to the forecasts
        b = json.loads(bt.read_text())["summary"]
        tested = {"source": "step11.json", "period": "1 December and 1 March of 2024-25 and 2025-26",
                  "league_seasons": len(b["league_seasons"]), "zones": b["zones"], "positions": b["positions"], "calibration": b["calibration"]}
    return {"schema": 1, "generated_at": iso(now), "model_version": bundle_version, "simulations": sims,
            "method": ("Every remaining fixture is played out with the model's home/draw/away probabilities (the published "
                       "prediction where there is one, otherwise the model without odds) and a score drawn from its expected "
                       "goals. Ranked on points, goal difference, goals scored. Point deductions and head-to-head "
                       "tie-breakers are not modelled."),
            "notice": "Probabilities, not certainties. For information and entertainment only.",
            "competitions": sorted(comps, key=lambda d: d["competition"]), "not_simulated": skipped, "tested": tested}


def publish(now: float, store: Path = STORE, publish_dir: Path | None = None, sims: int = SIMS) -> dict:
    from .production import PUBLISH, current_bundle
    bundle = current_bundle()
    if bundle is None:
        raise SystemExit("no model bundle")
    publish_dir = publish_dir or PUBLISH
    results = run(now, store, bundle, sims)
    # a week-old comparison from the first run: simulate once as the data stood seven days ago
    need_back = [c for c, r in results.items() if "state" in r and snapshot_near(store, c, r["state"].season, now - 7 * DAY) is None]
    if need_back:
        back = run(now - 7 * DAY, store, bundle, sims, leagues={c: LEAGUES[c] for c in need_back})
        save_snapshot(store, back, now - 7 * DAY, backfilled=True)
    doc = document(results, now, store, bundle.version, sims)
    save_snapshot(store, results, now)
    publish_dir.mkdir(parents=True, exist_ok=True)
    (publish_dir / "simulations.json").write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
    return {"leagues": len(doc["competitions"]), "backfilled": need_back, "skipped": doc["not_simulated"]}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m mkmodel.simulate")
    ap.add_argument("--sims", type=int, default=SIMS)
    ap.add_argument("--now", type=float, default=None, help="simulation time (UTC seconds); default: now")
    a = ap.parse_args(argv)
    t0 = time.time()
    s = publish(a.now or time.time(), sims=a.sims)
    s["seconds"] = round(time.time() - t0, 1)
    print(json.dumps(s, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
