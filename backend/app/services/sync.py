"""Write provider data into the database (teams, matches, events, players)."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import utcnow
from ..models import ExternalRef, League, Match, MatchEvent, Player, Season, Team
from ..providers.base import ProviderMatch, ProviderPlayer, ProviderTeam

log = logging.getLogger(__name__)


@dataclass
class MatchChange:
    match: Match
    created: bool = False
    changed: set[str] = field(default_factory=set)  # status | score | kickoff | clock

    @property
    def became_final(self) -> bool:
        return "status" in self.changed and self.match.status in ("finished", "cancelled")

    @property
    def result_corrected(self) -> bool:
        return self.match.status == "finished" and "score" in self.changed and self.match.settled_at is not None


def _initials(name: str) -> str:
    parts = [p for p in name.replace(".", " ").split() if p[0].isalnum()]
    return ("".join(p[0] for p in parts[:3]) if len(parts) > 1 else name[:3]).upper()


class Syncer:
    """Caches lookups for one sync run (one provider)."""

    def __init__(self, db: Session, provider: str):
        self.db = db
        self.provider = provider
        self._teams: dict[tuple[int, str], Team] = {}
        self._seasons: dict[tuple[int, str], Season] = {}

    # ----------------------------------------------------------------- teams
    def team(self, sport_id: int, pt: ProviderTeam) -> Team:
        key = (sport_id, pt.ref)
        if key in self._teams:
            return self._teams[key]
        ref = self.db.scalar(select(ExternalRef).where(ExternalRef.provider == self.provider, ExternalRef.entity == "team", ExternalRef.external_id == f"{sport_id}:{pt.ref}"))
        team = self.db.get(Team, ref.internal_id) if ref else None
        if team is None:
            team = Team(
                sport_id=sport_id,
                name=pt.name,
                short_name=pt.short_name or pt.name,
                code=(pt.code or _initials(pt.name))[:6],
                country=pt.country,
                color=pt.color or "#64748B",
                logo_url=pt.logo_url,
                venue_name=pt.venue_name,
                venue_city=pt.venue_city,
            )
            self.db.add(team)
            self.db.flush()
            self.db.add(ExternalRef(provider=self.provider, entity="team", external_id=f"{sport_id}:{pt.ref}", internal_id=team.id))
        else:
            # Keep provider-sourced fields fresh, but don't overwrite with blanks
            for attr, val in (("logo_url", pt.logo_url), ("venue_name", pt.venue_name), ("venue_city", pt.venue_city)):
                if val and getattr(team, attr) != val:
                    setattr(team, attr, val)
        self._teams[key] = team
        return team

    def season(self, league: League, name: Optional[str], start: datetime) -> Optional[Season]:
        if not name:
            return None
        key = (league.id, name)
        if key in self._seasons:
            return self._seasons[key]
        s = self.db.scalar(select(Season).where(Season.league_id == league.id, Season.name == name))
        if s is None:
            s = Season(league_id=league.id, name=name, start_date=start, is_current=True)
            self.db.add(s)
            self.db.flush()
            # a new season becomes current; older ones are archived
            for old in self.db.scalars(select(Season).where(Season.league_id == league.id, Season.id != s.id, Season.is_current.is_(True))):
                if old.start_date and old.start_date < start:
                    old.is_current = False
        elif s.start_date is None or start < s.start_date:
            s.start_date = start
        self._seasons[key] = s
        return s

    # --------------------------------------------------------------- matches
    def match(self, league: League, pm: ProviderMatch) -> MatchChange:
        m = self.db.scalar(select(Match).where(Match.provider == self.provider, Match.provider_ref == pm.ref))
        home = self.team(league.sport_id, pm.home)
        away = self.team(league.sport_id, pm.away)
        season = self.season(league, pm.season, pm.start_time)
        change = MatchChange(match=m)  # type: ignore[arg-type]
        if m is None:
            m = Match(
                sport_id=league.sport_id,
                league_id=league.id,
                season_id=season.id if season else None,
                home_team_id=home.id,
                away_team_id=away.id,
                start_time=pm.start_time,
                status=pm.status,
                clock=pm.clock,
                home_score=pm.home_score,
                away_score=pm.away_score,
                score_detail=pm.score_detail or {},
                round=pm.round,
                venue=pm.venue or home.venue_name,
                neutral=pm.neutral or bool((league.config or {}).get("neutral_venues")),
                provider=self.provider,
                provider_ref=pm.ref,
                finished_at=utcnow() if pm.status == "finished" else None,
            )
            self.db.add(m)
            self.db.flush()
            change = MatchChange(match=m, created=True, changed={"status"} if pm.status != "scheduled" else set())
        else:
            change.match = m
            if m.status != pm.status:
                # never move a final result back to live/scheduled because of a flaky feed
                if not (m.status == "finished" and pm.status in ("live", "scheduled")):
                    change.changed.add("status")
                    m.status = pm.status
                    if pm.status == "finished":
                        m.finished_at = utcnow()
            if (m.home_score, m.away_score) != (pm.home_score, pm.away_score) and pm.home_score is not None:
                change.changed.add("score")
                m.home_score, m.away_score = pm.home_score, pm.away_score
            if m.start_time != pm.start_time:
                change.changed.add("kickoff")
                m.start_time = pm.start_time
            if m.clock != pm.clock:
                change.changed.add("clock")
                m.clock = pm.clock
            if pm.score_detail and m.score_detail != pm.score_detail:
                m.score_detail = pm.score_detail
            if season and m.season_id != season.id:
                m.season_id = season.id
            m.round = pm.round or m.round
        if pm.events is not None:
            self.events(m, pm, home, away)
        return change

    def events(self, m: Match, pm: ProviderMatch, home: Team, away: Team) -> None:
        existing = {e.ext_id for e in self.db.scalars(select(MatchEvent).where(MatchEvent.match_id == m.id))}
        for e in pm.events or []:
            if e.ext_id in existing:
                continue
            self.db.add(
                MatchEvent(
                    match_id=m.id,
                    ext_id=e.ext_id,
                    type=e.type,
                    minute=e.minute,
                    clock=e.clock,
                    team_id=home.id if e.side == "home" else away.id,
                    player_name=e.player_name,
                    detail=e.detail or {},
                )
            )

    # --------------------------------------------------------------- players
    def players(self, sport_id: int, players: list[ProviderPlayer]) -> set[int]:
        """Upsert players; return ids of teams whose availability changed."""
        changed_teams: set[int] = set()
        for pp in players:
            team_ref = self.db.scalar(
                select(ExternalRef).where(ExternalRef.provider == self.provider, ExternalRef.entity == "team", ExternalRef.external_id == f"{sport_id}:{pp.team_ref}")
            )
            if team_ref is None:
                continue
            ref = self.db.scalar(select(ExternalRef).where(ExternalRef.provider == self.provider, ExternalRef.entity == "player", ExternalRef.external_id == pp.ref))
            player = self.db.get(Player, ref.internal_id) if ref else None
            if player is None:
                player = Player(team_id=team_ref.internal_id, name=pp.name, position=pp.position, shirt_number=pp.shirt_number, importance=pp.importance, tag=pp.tag)
                self.db.add(player)
                self.db.flush()
                self.db.add(ExternalRef(provider=self.provider, entity="player", external_id=pp.ref, internal_id=player.id))
                if pp.status != "available":
                    changed_teams.add(player.team_id)
            if player.status != pp.status or player.status_detail != pp.status_detail:
                if player.status != pp.status:
                    changed_teams.add(player.team_id)
                player.status, player.status_detail, player.status_updated_at = pp.status, pp.status_detail, utcnow()
        return changed_teams
