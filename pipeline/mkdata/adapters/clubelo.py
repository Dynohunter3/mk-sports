"""ClubElo daily ratings CSV (http://api.clubelo.com/YYYY-MM-DD). Off until its terms are verified."""

from __future__ import annotations

from datetime import date, datetime, timezone

from .base import Adapter, FetchResult
from .footballdata_uk import parse_csv

API = "http://api.clubelo.com"
COUNTRY = {"ENG": "eng", "ESP": "esp", "ITA": "ita", "GER": "ger", "FRA": "fra", "NED": "ned", "POR": "por", "TUR": "tur"}


class ClubElo(Adapter):
    name = "clubelo"

    def covers(self, comp_id: str) -> bool:
        return self.comps.get(comp_id, {}).get("sport") == "football"

    def fetch_day(self, d: date) -> FetchResult:
        r = self._get(f"{API}/{d.isoformat()}", check_robots=False, max_age=None)
        return self.parse(d, r.text(), r.fetched_at)

    def parse(self, d: date, text: str, fetched_at: float) -> FetchResult:
        out = FetchResult()
        # A rating dated D reflects matches up to the day before: available from 00:00 UTC on D.
        avail = datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp()
        for r in parse_csv(text):
            try:
                elo = float(r["Elo"])
            except (KeyError, ValueError):
                continue
            out.ratings.append({"raw": r["Club"], "country": COUNTRY.get(r.get("Country", ""), (r.get("Country") or "").lower()),
                                "source": self.name, "as_of": d.isoformat(), "value": elo,
                                "available_at": avail, "fetched_at": fetched_at})
        return out
