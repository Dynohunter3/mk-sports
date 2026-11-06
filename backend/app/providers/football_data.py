"""football-data.org v4 adapter (football only). Free tier: 10 requests/minute.

league.provider_refs.football_data = competition code, e.g. "PL", "CL", "WC".
The free tier has no line-ups/injuries or goal events, so those are left empty and the
model simply runs without the team-news adjustment.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from .base import LeagueRef, ProviderMatch, ProviderStanding, ProviderTeam, SportsDataProvider
from .http import ProviderHttp

STATUS = {
    "SCHEDULED": "scheduled",
    "TIMED": "scheduled",
    "IN_PLAY": "live",
    "PAUSED": "live",
    "LIVE": "live",
    "FINISHED": "finished",
    "AWARDED": "finished",
    "POSTPONED": "postponed",
    "SUSPENDED": "postponed",
    "CANCELLED": "cancelled",
}


def _dt(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def map_team(t: dict) -> ProviderTeam:
    return ProviderTeam(
        ref=str(t["id"]),
        name=t.get("name") or t.get("shortName") or str(t["id"]),
        short_name=t.get("shortName"),
        code=t.get("tla"),
        logo_url=t.get("crest"),
    )


def season_name(season: Optional[dict]) -> Optional[str]:
    if not season or not season.get("startDate"):
        return None
    start, end = season["startDate"][:4], (season.get("endDate") or season["startDate"])[:4]
    return start if start == end else f"{start}/{end[2:]}"


def map_match(m: dict, league_slug: str) -> ProviderMatch:
    status = STATUS.get(m.get("status", ""), "scheduled")
    full = (m.get("score") or {}).get("fullTime") or {}
    half = (m.get("score") or {}).get("halfTime") or {}
    clock = None
    if m.get("status") == "PAUSED":
        clock = "HT"
    elif status == "live" and m.get("minute"):
        extra = m.get("injuryTime")
        clock = f"{m['minute']}+{extra}'" if extra else f"{m['minute']}'"
    elif status == "finished":
        clock = "FT"
    stage = m.get("stage") or ""
    rnd = f"Matchday {m['matchday']}" if m.get("matchday") else stage.replace("_", " ").title() or None
    return ProviderMatch(
        ref=str(m["id"]),
        league_slug=league_slug,
        start_time=_dt(m["utcDate"]),
        status=status,
        home=map_team(m["homeTeam"]),
        away=map_team(m["awayTeam"]),
        home_score=full.get("home") if status in ("live", "finished") else None,
        away_score=full.get("away") if status in ("live", "finished") else None,
        clock=clock,
        score_detail={"half_time": [half.get("home"), half.get("away")]} if half.get("home") is not None else {},
        season=season_name(m.get("season")),
        round=rnd,
        venue=m.get("venue"),
        events=None,
    )


class FootballDataProvider(SportsDataProvider):
    name = "football_data"
    sports = ("football",)

    def __init__(self, api_key: str, per_minute: int = 10, transport=None):
        self.http = ProviderHttp(self.name, "https://api.football-data.org/v4", {"X-Auth-Token": api_key}, per_minute, transport=transport)

    def fetch_fixtures(self, league: LeagueRef, date_from: datetime, date_to: datetime) -> list[ProviderMatch]:
        data: Any = self.http.get(
            f"/competitions/{league.ref}/matches",
            {"dateFrom": date_from.date().isoformat(), "dateTo": date_to.date().isoformat()},
            ttl=600,
        )
        return [map_match(m, league.slug) for m in data.get("matches", []) if date_from <= _dt(m["utcDate"]) <= date_to]

    def fetch_live(self, leagues: list[LeagueRef], refs: list[str]) -> list[ProviderMatch]:
        codes = {str(lg.ref): lg.slug for lg in leagues if lg.ref}
        if not codes:
            return []
        data: Any = self.http.get("/matches", {"competitions": ",".join(codes), "status": "LIVE"}, ttl=20)
        out = [map_match(m, codes.get((m.get("competition") or {}).get("code", ""), "")) for m in data.get("matches", [])]
        # matches that just ended drop out of status=LIVE; fetch those individually (cheap, cached)
        seen = {m.ref for m in out}
        for ref in refs:
            if ref not in seen:
                m = self.http.get(f"/matches/{ref}", ttl=20)
                comp = (m.get("competition") or {}).get("code", "")
                out.append(map_match(m, codes.get(comp, "")))
        return [m for m in out if m.league_slug]

    def fetch_standings(self, league: LeagueRef) -> Optional[list[ProviderStanding]]:
        data: Any = self.http.get(f"/competitions/{league.ref}/standings", ttl=3600)
        tables = [s for s in data.get("standings", []) if s.get("type") == "TOTAL"]
        if len(tables) != 1:  # group stages etc.: compute from results instead
            return None
        rows = []
        for r in tables[0]["table"]:
            rows.append(
                ProviderStanding(
                    team=map_team(r["team"]),
                    position=r["position"],
                    played=r["playedGames"],
                    won=r["won"],
                    drawn=r["draw"],
                    lost=r["lost"],
                    points_for=r["goalsFor"],
                    points_against=r["goalsAgainst"],
                    points=r["points"],
                    form=(r.get("form") or "").replace(",", "")[::-1][:5],  # API is oldest->newest
                )
            )
        return rows
