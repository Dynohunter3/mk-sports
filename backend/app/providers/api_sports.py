"""API-Sports adapter: API-Football v3 and API-Basketball v1 (one key for both).

league.provider_refs.api_sports = {"league": <id>, "season_mode": "split"|"calendar"}.
Free tier: 100 requests/day per API, so responses are cached aggressively.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from .base import LeagueRef, ProviderEvent, ProviderMatch, ProviderPlayer, ProviderStanding, ProviderTeam, SportsDataProvider
from .http import ProviderHttp

FOOTBALL_STATUS = {
    "TBD": "scheduled", "NS": "scheduled",
    "1H": "live", "HT": "live", "2H": "live", "ET": "live", "BT": "live", "P": "live", "SUSP": "live", "INT": "live", "LIVE": "live",
    "FT": "finished", "AET": "finished", "PEN": "finished", "AWD": "finished", "WO": "finished",
    "PST": "postponed",
    "CANC": "cancelled", "ABD": "cancelled",
}
BASKETBALL_STATUS = {
    "NS": "scheduled",
    "Q1": "live", "Q2": "live", "Q3": "live", "Q4": "live", "OT": "live", "BT": "live", "HT": "live",
    "FT": "finished", "AOT": "finished",
    "POST": "postponed",
    "CANC": "cancelled", "SUSP": "cancelled", "AWD": "finished", "ABD": "cancelled",
}


def _dt(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc)


def season_param(sport: str, when: datetime, mode: str = "split") -> str:
    if mode == "calendar":
        return str(when.year)
    y = when.year if when.month >= 7 else when.year - 1
    return str(y) if sport == "football" else f"{y}-{y + 1}"


def _team(t: dict) -> ProviderTeam:
    return ProviderTeam(ref=str(t["id"]), name=t.get("name") or str(t["id"]), logo_url=t.get("logo"))


def map_football_fixture(item: dict, league_slug: str) -> ProviderMatch:
    fx, teams, goals = item["fixture"], item["teams"], item.get("goals") or {}
    st = fx.get("status") or {}
    status = FOOTBALL_STATUS.get(st.get("short", "NS"), "scheduled")
    clock = None
    if status == "live":
        clock = "HT" if st.get("short") == "HT" else (f"{st['elapsed']}+{st['extra']}'" if st.get("extra") else f"{st.get('elapsed') or 0}'")
    elif status == "finished":
        clock = st.get("short") if st.get("short") in ("AET", "PEN") else "FT"
    events = None
    if "events" in item and item["events"] is not None:
        events = []
        home_id = teams["home"]["id"]
        for i, e in enumerate(item["events"]):
            etype, detail = (e.get("type") or "").lower(), e.get("detail") or ""
            if etype == "goal" and detail != "Missed Penalty":
                kind = {"Own Goal": "own_goal", "Penalty": "penalty_goal"}.get(detail, "goal")
            elif etype == "card":
                kind = "red_card" if "Red" in detail else "yellow_card"
            else:
                continue
            scoring_team_is_home = (e.get("team") or {}).get("id") == home_id
            side = "home" if scoring_team_is_home else "away"
            if kind == "own_goal":  # API reports the team of the player who scored; credit the other side
                side = "away" if scoring_team_is_home else "home"
            t = e.get("time") or {}
            minute = t.get("elapsed")
            events.append(ProviderEvent(f"{i}-{kind}-{minute}", kind, side, minute, f"{minute}+{t['extra']}'" if t.get("extra") else f"{minute}'", (e.get("player") or {}).get("name")))
    ht = (item.get("score") or {}).get("halftime") or {}
    venue = fx.get("venue") or {}
    rnd = (item.get("league") or {}).get("round")
    return ProviderMatch(
        ref=str(fx["id"]),
        league_slug=league_slug,
        start_time=_dt(fx["date"]),
        status=status,
        home=_team(teams["home"]),
        away=_team(teams["away"]),
        home_score=goals.get("home") if status in ("live", "finished") else None,
        away_score=goals.get("away") if status in ("live", "finished") else None,
        clock=clock,
        score_detail={"half_time": [ht.get("home"), ht.get("away")]} if ht.get("home") is not None else {},
        season=str((item.get("league") or {}).get("season") or "") or None,
        round=rnd.replace("Regular Season - ", "Round ") if rnd else None,
        venue=venue.get("name"),
        events=events,
    )


def map_basketball_game(g: dict, league_slug: str) -> ProviderMatch:
    st = g.get("status") or {}
    short = st.get("short", "NS")
    status = BASKETBALL_STATUS.get(short, "scheduled")
    sh, sa = (g.get("scores") or {}).get("home") or {}, (g.get("scores") or {}).get("away") or {}
    quarters = [[sh.get(f"quarter_{i}"), sa.get(f"quarter_{i}")] for i in range(1, 5) if sh.get(f"quarter_{i}") is not None]
    clock = None
    if status == "live":
        clock = short if short in ("HT", "BT") else f"{short} {st.get('timer') or ''}".strip()
    elif status == "finished":
        clock = "FT" if short == "FT" else "FT/OT"
    venue = g.get("venue")
    return ProviderMatch(
        ref=str(g["id"]),
        league_slug=league_slug,
        start_time=_dt(g["date"]),
        status=status,
        home=_team(g["teams"]["home"]),
        away=_team(g["teams"]["away"]),
        home_score=sh.get("total") if status in ("live", "finished") else None,
        away_score=sa.get("total") if status in ("live", "finished") else None,
        clock=clock,
        score_detail={"quarters": quarters, **({"overtime": [sh.get("over_time"), sa.get("over_time")]} if sh.get("over_time") is not None else {})},
        season=str((g.get("league") or {}).get("season") or "") or None,
        venue=venue if isinstance(venue, str) else (venue or {}).get("name"),
        events=[],
    )


class ApiSportsProvider(SportsDataProvider):
    name = "api_sports"
    sports = ("football", "basketball")
    BASES = {"football": "https://v3.football.api-sports.io", "basketball": "https://v1.basketball.api-sports.io"}

    def __init__(self, api_key: str, per_minute: int = 10, transport=None):
        self.http = {s: ProviderHttp(f"{self.name}_{s}", base, {"x-apisports-key": api_key}, per_minute, transport=transport) for s, base in self.BASES.items()}

    @staticmethod
    def _ref(league: LeagueRef) -> tuple[int, str]:
        ref = league.ref if isinstance(league.ref, dict) else {"league": league.ref}
        return int(ref["league"]), ref.get("season_mode", "split")

    def fetch_fixtures(self, league: LeagueRef, date_from: datetime, date_to: datetime) -> list[ProviderMatch]:
        lid, mode = self._ref(league)
        season = season_param(league.sport, date_from, mode)
        if league.sport == "football":
            data: Any = self.http["football"].get(
                "/fixtures", {"league": lid, "season": season, "from": date_from.date().isoformat(), "to": date_to.date().isoformat(), "timezone": "UTC"}, ttl=1800
            )
            return [map_football_fixture(i, league.slug) for i in data.get("response", [])]
        out: list[ProviderMatch] = []
        day = date_from.date()
        today = datetime.now(timezone.utc).date()
        while day <= date_to.date():  # basketball API is per-day
            ttl = 60 if day == today else 6 * 3600
            data = self.http["basketball"].get("/games", {"league": lid, "season": season, "date": day.isoformat(), "timezone": "UTC"}, ttl=ttl)
            out += [map_basketball_game(g, league.slug) for g in data.get("response", [])]
            day += timedelta(days=1)
        return [m for m in out if date_from <= m.start_time <= date_to]

    def fetch_live(self, leagues: list[LeagueRef], refs: list[str]) -> list[ProviderMatch]:
        out: list[ProviderMatch] = []
        fb = {self._ref(lg)[0]: lg.slug for lg in leagues if lg.sport == "football"}
        if fb:
            data: Any = self.http["football"].get("/fixtures", {"live": "-".join(map(str, fb)), "timezone": "UTC"}, ttl=20)
            out += [map_football_fixture(i, fb.get(i["league"]["id"], "")) for i in data.get("response", [])]
            missing = [r for r in refs if r not in {m.ref for m in out}]
            for chunk in (missing[i : i + 20] for i in range(0, len(missing), 20)):  # just-finished matches
                data = self.http["football"].get("/fixtures", {"ids": "-".join(chunk), "timezone": "UTC"}, ttl=20)
                out += [map_football_fixture(i, fb.get(i["league"]["id"], "")) for i in data.get("response", [])]
        for lg in (lg for lg in leagues if lg.sport == "basketball"):
            now = datetime.now(timezone.utc)
            out += [m for m in self.fetch_fixtures(lg, now - timedelta(hours=6), now + timedelta(hours=1)) if m.ref in refs or m.status == "live"]
        return [m for m in out if m.league_slug]

    def fetch_squads(self, league: LeagueRef, team_refs: list[str]) -> list[ProviderPlayer]:
        if league.sport != "football":
            return []
        lid, mode = self._ref(league)
        now = datetime.now(timezone.utc)
        data: Any = self.http["football"].get("/injuries", {"league": lid, "season": season_param("football", now, mode), "date": now.date().isoformat()}, ttl=3 * 3600)
        out = []
        for item in data.get("response", []):
            p, t = item.get("player") or {}, item.get("team") or {}
            if str(t.get("id")) not in team_refs:
                continue
            status = "doubtful" if p.get("type") == "Questionable" else ("suspended" if "Suspend" in (p.get("reason") or "") else "injured")
            out.append(ProviderPlayer(str(p.get("id")), str(t.get("id")), p.get("name") or "Unknown", "", None, 0.5, None, status, p.get("reason")))
        return out

    def fetch_standings(self, league: LeagueRef) -> Optional[list[ProviderStanding]]:
        if league.sport != "football":
            return None
        lid, mode = self._ref(league)
        data: Any = self.http["football"].get("/standings", {"league": lid, "season": season_param("football", datetime.now(timezone.utc), mode)}, ttl=3600)
        resp = data.get("response") or []
        groups = resp[0]["league"]["standings"] if resp else []
        if len(groups) != 1:
            return None
        rows = []
        for r in groups[0]:
            a = r.get("all") or {}
            g = a.get("goals") or {}
            rows.append(ProviderStanding(_team(r["team"]), r["rank"], a.get("played", 0), a.get("win", 0), a.get("draw", 0), a.get("lose", 0),
                                         g.get("for", 0), g.get("against", 0), r.get("points", 0), (r.get("form") or "")[::-1][:5]))
        return rows
