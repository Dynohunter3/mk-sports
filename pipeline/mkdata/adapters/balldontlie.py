"""BALLDONTLIE NBA API (free tier: 5 requests/minute; key in $BALLDONTLIE_API_KEY, sent as Authorization)."""

from __future__ import annotations

from datetime import date, datetime

from ..timeutil import result_available_at
from .base import Adapter, FetchResult, Unsupported

API = "https://api.balldontlie.io/v1"


class BallDontLie(Adapter):
    name = "balldontlie"

    def fetch_season(self, comp_id: str, season: str, *, max_age: float | None = 6 * 3600) -> FetchResult:
        if comp_id != "nba":
            raise Unsupported(comp_id)
        key = self.spec.key() or ""
        start = season.split("-")[0]
        out, cursor = FetchResult(), None
        while True:
            url = f"{API}/games?seasons[]={start}&per_page=100" + (f"&cursor={cursor}" if cursor else "")
            r = self._get(url, headers={"Authorization": key}, secrets=[key], check_robots=False, max_age=max_age)
            doc = r.json()
            out.extend(self.parse(season, doc.get("data", []), r.fetched_at))
            cursor = (doc.get("meta") or {}).get("next_cursor")
            if not cursor:
                return out

    def parse(self, season: str, games: list[dict], fetched_at: float) -> FetchResult:
        out = FetchResult()
        for g in games:
            dt = g.get("datetime")
            if dt:
                kick, exact = datetime.fromisoformat(dt.replace("Z", "+00:00")).timestamp(), True
            else:
                d = date.fromisoformat(g["date"][:10])
                kick, exact = datetime(d.year, d.month, d.day, 12).timestamp(), False
            final = str(g.get("status", "")).lower() == "final"
            out.matches.append({
                "source": self.name, "source_key": str(g["id"]), "competition_id": "nba", "season": season,
                "kickoff_utc": kick, "kickoff_exact": int(exact), "local_date": g["date"][:10],
                "home_raw": g["home_team"]["full_name"], "away_raw": g["visitor_team"]["full_name"],
                "status": "final" if final else "scheduled",
                "home_score": g.get("home_team_score") if final else None,
                "away_score": g.get("visitor_team_score") if final else None,
                "fetched_at": fetched_at, "available_at": result_available_at(kick, exact, "basketball") if final else fetched_at,
            })
        return out
