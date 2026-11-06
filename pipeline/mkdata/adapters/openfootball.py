"""openfootball football.json / worldcup.json (public domain): fixtures and results."""

from __future__ import annotations

from datetime import date

from ..timeutil import local_kickoff, result_available_at
from .base import Adapter, FetchResult, Unsupported

RAW = "https://raw.githubusercontent.com/openfootball"


def _score(m: dict) -> tuple[int, int] | None:
    s = m.get("score")
    if isinstance(s, dict):
        ft = s.get("ft")
    elif isinstance(s, list):
        ft = s
    else:
        ft = None
    if isinstance(ft, list) and len(ft) == 2 and all(isinstance(v, int) for v in ft):
        return ft[0], ft[1]
    return None


class OpenFootball(Adapter):
    name = "openfootball"

    def code(self, comp_id: str) -> str | None:
        c = self.comps.get(comp_id, {})
        return c.get("openfootball") or (("worldcup:" + c["openfootball_worldcup"]) if c.get("openfootball_worldcup") else None)

    def _url(self, comp_id: str, season: str) -> str:
        c = self.comps[comp_id]
        if c.get("openfootball_worldcup"):
            return f"{RAW}/worldcup.json/master/{season}/worldcup.json"
        if not c.get("openfootball"):
            raise Unsupported(comp_id)
        return f"{RAW}/football.json/master/{season}/{c['openfootball']}.json"

    def fetch_season(self, comp_id: str, season: str, *, max_age: float | None = 6 * 3600) -> FetchResult:
        if not self.covers(comp_id):
            raise Unsupported(comp_id)
        r = self._get(self._url(comp_id, season), max_age=max_age, check_robots=False)  # raw file host, not a website
        return self.parse(comp_id, season, r.json(), r.fetched_at)

    def parse(self, comp_id: str, season: str, doc: dict, fetched_at: float) -> FetchResult:
        comp = self.comps[comp_id]
        out = FetchResult()
        matches = doc.get("matches") or [m for rnd in doc.get("rounds", []) for m in rnd.get("matches", [])]
        for m in matches:
            t1, t2, ds = m.get("team1"), m.get("team2"), m.get("date")
            if isinstance(t1, dict):
                t1 = t1.get("name")
            if isinstance(t2, dict):
                t2 = t2.get("name")
            if not (t1 and t2 and ds):
                continue
            d = date.fromisoformat(ds)
            kick, exact = local_kickoff(d, m.get("time"), comp.get("tz"))
            sc = _score(m)
            out.matches.append({
                "source": self.name, "source_key": f"{self.code(comp_id)}:{season}:{ds}:{t1}:{t2}", "competition_id": comp_id,
                "season": season, "kickoff_utc": kick, "kickoff_exact": int(exact), "local_date": ds,
                "home_raw": t1, "away_raw": t2, "status": "final" if sc else "scheduled",
                "home_score": sc[0] if sc else None, "away_score": sc[1] if sc else None,
                "fetched_at": fetched_at,
                "available_at": result_available_at(kick, exact, comp["sport"]) if sc else fetched_at,
            })
        return out

    def fetch_upcoming(self, comp_ids: list[str]) -> FetchResult:
        raise Unsupported("openfootball: upcoming fixtures come with the season file")
