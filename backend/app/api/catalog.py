from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload

from ..cache import cached, data_version
from ..db import get_db, utcnow
from ..models import League, Match, Sport, Team, TeamRating
from ..schemas import LeagueOut, SportOut, StandingRow, TeamOut
from ..services.standings import current_season
from ..views import league_out, sport_out, standings_rows

router = APIRouter(tags=["catalog"])

DISCLAIMER = (
    "Predictions are for information and entertainment only and are not betting advice. "
    "PredictPro's pick game is free to play: there are no real-money stakes or prizes."
)


@router.get("/meta", summary="App configuration and responsible-use text")
def meta():
    return {
        "app": "PredictPro",
        "api_version": "1",
        "server_time": utcnow(),
        "disclaimer": DISCLAIMER,
        "free_to_play": True,
        "shows_odds": False,  # if bookmaker odds are ever added: age gate + responsible-gambling links
        "age_gate_required": False,
        "responsible_gambling_links": [],
        "min_app_version": "0.1.0",
    }


@router.get("/sports", response_model=list[SportOut], summary="Sports (active by default)")
def list_sports(include_inactive: bool = False, db: Session = Depends(get_db)):
    def build():
        q = select(Sport).order_by(Sport.sort_order)
        if not include_inactive:
            q = q.where(Sport.is_active.is_(True))
        return [sport_out(s) for s in db.scalars(q)]

    return cached(f"sports:{include_inactive}", 300, build)


@router.get("/leagues", response_model=list[LeagueOut], summary="Competitions, optionally for one sport")
def list_leagues(sport: Optional[str] = None, include_inactive: bool = False, db: Session = Depends(get_db)):
    def build():
        q = select(League).join(Sport).options(joinedload(League.sport)).order_by(Sport.sort_order, League.sort_order)
        if sport:
            q = q.where(Sport.slug == sport)
        if not include_inactive:
            q = q.where(League.is_active.is_(True), Sport.is_active.is_(True))
        out = []
        for lg in db.scalars(q):
            s = current_season(db, lg.id)
            out.append(league_out(lg, s.name if s else None))
        return out

    return cached(f"leagues:{sport}:{include_inactive}:{data_version()}", 300, build)


@router.get("/leagues/{league_id}", summary="One competition with fixture counts")
def get_league(league_id: int, db: Session = Depends(get_db)):
    lg = db.get(League, league_id)
    if lg is None:
        raise HTTPException(404, "League not found")
    s = current_season(db, lg.id)
    now = utcnow()
    upcoming = db.scalar(select(func.count()).select_from(Match).where(Match.league_id == lg.id, Match.status == "scheduled", Match.start_time > now)) or 0
    live = db.scalar(select(func.count()).select_from(Match).where(Match.league_id == lg.id, Match.status == "live")) or 0
    return {**league_out(lg, s.name if s else None), "upcoming": upcoming, "live": live, "color": lg.sport.color}


@router.get("/leagues/{league_id}/standings", response_model=list[StandingRow], summary="League table")
def league_standings(league_id: int, db: Session = Depends(get_db)):
    if db.get(League, league_id) is None:
        raise HTTPException(404, "League not found")
    return cached(f"standings:{league_id}:{data_version()}", 300, lambda: standings_rows(db, league_id))


def _team_out(t: Team, r: Optional[TeamRating], sport_slug: str) -> dict:
    return {
        "id": t.id, "name": t.name, "short_name": t.short_name, "code": t.code, "color": t.color, "sport": sport_slug, "country": t.country,
        "venue_name": t.venue_name, "venue_city": t.venue_city, "elo": round(r.elo) if r else None, "form": r.form if r else None,
    }


@router.get("/teams", response_model=list[TeamOut], summary="Search teams")
def list_teams(
    search: Optional[str] = Query(None, min_length=2),
    sport: Optional[str] = None,
    league_id: Optional[int] = None,
    limit: int = Query(30, le=100),
    db: Session = Depends(get_db),
):
    q = select(Team, TeamRating, Sport.slug).join(Sport, Sport.id == Team.sport_id).outerjoin(TeamRating, TeamRating.team_id == Team.id)
    if search:
        like = f"%{search.lower()}%"
        q = q.where(or_(func.lower(Team.name).like(like), func.lower(Team.short_name).like(like), func.lower(Team.code) == search.lower()))
    if sport:
        q = q.where(Sport.slug == sport)
    if league_id:
        ids = select(Match.home_team_id).where(Match.league_id == league_id).union(select(Match.away_team_id).where(Match.league_id == league_id))
        q = q.where(Team.id.in_(ids))
    q = q.order_by(Team.name).limit(limit)
    return [_team_out(t, r, slug) for t, r, slug in db.execute(q)]


@router.get("/teams/{team_id}", response_model=TeamOut)
def get_team(team_id: int, db: Session = Depends(get_db)):
    t = db.get(Team, team_id)
    if t is None:
        raise HTTPException(404, "Team not found")
    return _team_out(t, db.get(TeamRating, t.id), db.get(Sport, t.sport_id).slug)
