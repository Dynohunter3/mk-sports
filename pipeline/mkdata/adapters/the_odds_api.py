"""The Odds API v4 (free Starter plan, key in $THE_ODDS_API_KEY). Current pre-match h2h odds.

Quota: every odds call costs credits (1 per region per market). The adapter reads the
``x-requests-remaining`` header after each call and refuses further calls once the remaining
credits fall to the reserve, so the free plan is never exceeded and never "worked around".
"""

from __future__ import annotations

from ..http import Blocked
from .base import Adapter, FetchResult, Unsupported, mkey

API = "https://api.the-odds-api.com/v4"


class TheOddsAPI(Adapter):
    name = "the_odds_api"
    remaining: int | None = None

    def _budget_ok(self) -> None:
        reserve = self.spec.limits.get("credit_reserve", 50)
        if self.remaining is not None and self.remaining <= reserve:
            raise Blocked(API, None, f"credit reserve reached ({self.remaining} left)")

    def fetch_upcoming(self, comp_ids: list[str]) -> FetchResult:
        key = self.spec.key() or ""
        out = FetchResult()
        for comp_id in comp_ids:
            sk = self.code(comp_id)
            if not sk:
                continue
            self._budget_ok()
            r = self.http.get(
                f"{API}/sports/{sk}/odds?apiKey={key}&regions=eu&markets=h2h&oddsFormat=decimal&dateFormat=unix",
                secrets=[key], check_robots=False, max_age=3 * 3600, min_interval=self.spec.min_interval_s,
            )
            rem = r.headers.get("x-requests-remaining")
            if rem is not None:
                self.remaining = int(float(rem))
            out.extend(self.parse(comp_id, r.json(), r.fetched_at))
        return out

    def parse(self, comp_id: str, events: list[dict], fetched_at: float) -> FetchResult:
        from datetime import datetime, timezone

        from ..timeutil import season_of

        comp = self.comps[comp_id]
        out = FetchResult()
        for ev in events:
            kick = float(ev["commence_time"])
            d = datetime.fromtimestamp(kick, timezone.utc).date()
            skey = ev["id"]
            out.matches.append({
                "source": self.name, "source_key": skey, "competition_id": comp_id, "season": season_of(d, comp["seasons"]),
                "kickoff_utc": kick, "kickoff_exact": 1, "local_date": d.isoformat(),
                "home_raw": ev["home_team"], "away_raw": ev["away_team"], "status": "scheduled",
                "home_score": None, "away_score": None, "fetched_at": fetched_at, "available_at": fetched_at,
            })
            for b in ev.get("bookmakers", []):
                for mk in b.get("markets", []):
                    if mk.get("key") != "h2h":
                        continue
                    price = {o["name"]: float(o["price"]) for o in mk.get("outcomes", [])}
                    h, a, dr = price.get(ev["home_team"]), price.get(ev["away_team"]), price.get("Draw")
                    if h and a:
                        out.odds.append({"match_key": mkey(self.name, skey), "source": self.name, "bookmaker": b["key"],
                                         "kind": "current", "home": h, "draw": dr, "away": a,
                                         "available_at": fetched_at, "fetched_at": fetched_at})
        return out

    def fetch_season(self, comp_id: str, season: str, **_) -> FetchResult:
        raise Unsupported("historical odds are a paid feature of The Odds API")
