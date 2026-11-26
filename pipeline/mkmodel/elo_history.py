"""Team strength history: the model's own Elo rating for every team, over every season in the store.

The ratings are replayed exactly as the model's features compute them (mkmodel.features.Elo: results are applied
when they became known, with the pull toward the league average at each new season), so the latest value
matches the "elo" shown with each prediction.

Published per competition as elo/<competition>.json, for the teams in that competition's current season:
one point a month (the rating after the month's last match) for past seasons, one per match this season.

    python -m mkmodel.elo_history          # writes var/publish/elo/*.json
"""
from __future__ import annotations

import heapq
import json
import sqlite3
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from .data import APP_LEAGUES, LOWER, STORE, load
from .features import DOMESTIC, Elo, EloParams

DAY = 86400.0
# the store starts in 2013 with every team on 1500: the first seasons are a warm-up while ratings settle (the model
# itself trains from 2016-17), so the history starts there
FIRST_SEASON_SHOWN = datetime(2016, 7, 1, tzinfo=timezone.utc).timestamp()


def replay(ms, as_of: float):
    """[(t, team, comp, season, rating after the match)] in result order, plus the ratings at ``as_of``."""
    elo = Elo(EloParams())
    pending: list[tuple[float, int]] = []
    pre: dict[int, tuple[float, float]] = {}
    out = []

    def release(upto: float):
        while pending and pending[0][0] < upto:
            _, i = heapq.heappop(pending)
            m = ms[i]
            rh, ra = pre[i]
            dom = m.comp in DOMESTIC
            elo.update(m, rh, ra, dom)
            out.append((m.t, m.h, m.comp, m.season, elo.r[m.h]))
            out.append((m.t, m.a, m.comp, m.season, elo.r[m.a]))

    for i, m in enumerate(ms):
        release(min(m.t, as_of))
        if m.t > as_of:
            break
        dom = m.comp in DOMESTIC
        pre[i] = (elo.rating(m.h, m.comp, m.season, m.t, dom), elo.rating(m.a, m.comp, m.season, m.t, dom))
        if m.outcome is not None and m.result_at is not None:
            heapq.heappush(pending, (m.result_at, i))
    release(as_of)
    return out, dict(elo.r)


def build_docs(now: float, store: Path = STORE) -> dict[str, dict]:
    ms = load(store, comps=APP_LEAGUES + LOWER, as_of=now)
    events, current = replay(ms, now)
    db = sqlite3.connect(store)
    names = {r[0]: r[1] for r in db.execute("SELECT id, name FROM entities")}
    aliases: dict[str, set] = defaultdict(set)
    for eid, raw in db.execute("SELECT entity_id, raw FROM aliases"):
        aliases[eid].add(raw)
    # each published competition's current season and its teams
    season_of: dict[str, str] = {}
    teams_of: dict[str, set] = defaultdict(set)
    for m in ms:
        if m.comp in APP_LEAGUES and m.comp in DOMESTIC and m.t <= now + 30 * DAY:
            if m.season != season_of.get(m.comp):
                if season_of.get(m.comp) is None or m.season > season_of[m.comp]:
                    season_of[m.comp] = m.season
                    teams_of[m.comp] = set()
            if m.season == season_of[m.comp]:
                teams_of[m.comp] |= {m.h, m.a}
    by_team: dict[str, list] = defaultdict(list)
    for t, team, comp, season, r in events:
        if t >= FIRST_SEASON_SHOWN:
            by_team[team].append((t, comp, season, r))
    docs = {}
    iso = lambda t: datetime.fromtimestamp(t, timezone.utc).isoformat(timespec="seconds")  # noqa: E731
    for comp, teams in teams_of.items():
        season = season_of[comp]
        rows = []
        month_means: dict[str, list[float]] = defaultdict(list)
        for team in sorted(teams):
            pts, last_month = [], None
            for t, c, s, r in by_team.get(team, []):
                day = int(t // DAY)
                month = datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m")
                if c == comp:
                    month_means[month].append(r)
                if s == season and c == comp:
                    pts.append([day, round(r)])
                    last_month = None
                    continue
                if pts and month == last_month:
                    pts[-1] = [day, round(r)]  # keep the month's last rating
                else:
                    pts.append([day, round(r)])
                last_month = month
            if team in current:
                rows.append({"id": team, "name": names.get(team, team),
                             "aliases": sorted(aliases.get(team, set()) | {names.get(team, team)}),
                             "rating": round(current[team]), "points": pts})
        rows.sort(key=lambda e: -e["rating"])
        for i, e in enumerate(rows):
            e["rank"] = i + 1
        docs[comp] = {"schema": 1, "generated_at": iso(now), "competition": comp, "season": season,
                      "about": ("MK Sports' own Elo rating, the one the prediction model uses: about 1500 is an average side "
                                "across the leagues covered, and a 100-point gap makes the stronger team about a 64% "
                                "favourite on a neutral pitch. It moves after every result, more for bigger wins."),
                      "league_average": [[m, round(float(np.mean(v)))] for m, v in sorted(month_means.items()) if len(v) >= 5],
                      "teams": rows}
    return docs


def publish(now: float, store: Path = STORE, out: Path | None = None) -> dict:
    from .production import PUBLISH
    out = (out or PUBLISH) / "elo"
    out.mkdir(parents=True, exist_ok=True)
    docs = build_docs(now, store)
    for comp, d in docs.items():
        (out / f"{comp}.json").write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")))
    return {"competitions": len(docs), "teams": sum(len(d["teams"]) for d in docs.values())}


def main() -> int:
    t0 = time.time()
    s = publish(time.time())
    s["seconds"] = round(time.time() - t0, 1)
    print(json.dumps(s))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
