"""football-data.org API v4 (free tier, key in $FOOTBALL_DATA_ORG_KEY, sent as X-Auth-Token)."""

from __future__ import annotations

from datetime import datetime

from ..timeutil import result_available_at
from .base import Adapter, FetchResult, Unsupported

API = "https://api.football-data.org/v4"
FINAL = {"FINISHED", "AWARDED"}
DROP = {"CANCELLED"}
STATUS = {"POSTPONED": "postponed", "SUSPENDED": "postponed", "IN_PLAY": "live", "PAUSED": "live"}


class FootballDataOrg(Adapter):
    name = "football_data_org"

    def _headers(self) -> dict[str, str]:
        return {"X-Auth-Token": self.spec.key() or ""}

    def fetch_season(self, comp_id: str, season: str, *, max_age: float | None = 3600) -> FetchResult:
        code = self.code(comp_id)
        if not code:
            raise Unsupported(comp_id)
        start = season.split("-")[0]
        key = self.spec.key() or ""
        r = self._get(f"{API}/competitions/{code}/matches?season={start}", headers=self._headers(), secrets=[key],
                      check_robots=False, max_age=max_age)
        return self.parse(comp_id, season, r.json(), r.fetched_at)

    def parse(self, comp_id: str, season: str, doc: dict, fetched_at: float) -> FetchResult:
        sport = self.comps[comp_id]["sport"]
        out = FetchResult()
        for m in doc.get("matches", []):
            st = m.get("status", "")
            if st in DROP:
                continue
            kick = datetime.fromisoformat(m["utcDate"].replace("Z", "+00:00")).timestamp()
            score = m.get("score") or {}
            ft = score.get("regularTime") or score.get("fullTime") or {}
            final = st in FINAL and ft.get("home") is not None
            out.matches.append({
                "source": self.name, "source_key": str(m["id"]), "competition_id": comp_id, "season": season,
                "kickoff_utc": kick, "kickoff_exact": 1, "local_date": m["utcDate"][:10],
                "home_raw": m["homeTeam"]["name"], "away_raw": m["awayTeam"]["name"],
                "status": "final" if final else STATUS.get(st, "scheduled"),
                "home_score": ft.get("home") if final else None, "away_score": ft.get("away") if final else None,
                "fetched_at": fetched_at, "available_at": result_available_at(kick, True, sport) if final else fetched_at,
            })
        return out

    def fetch_upcoming(self, comp_ids: list[str]) -> FetchResult:
        raise Unsupported("use fetch_season for the current season")
