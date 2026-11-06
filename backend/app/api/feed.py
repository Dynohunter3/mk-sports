"""Personalised home feed: one request renders the whole home screen."""

from __future__ import annotations

from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..auth import optional_user
from ..db import get_db, utcnow
from ..models import League, Match, Prediction, Sport, User, UserFavourite, UserPick
from ..views import load_matches, match_cards
from .matches import _tz, day_bounds

router = APIRouter(tags=["feed"])


def _ids(raw: Optional[str]) -> list[int]:
    return [int(x) for x in (raw or "").split(",") if x.strip().isdigit()]


def favourites_for(db: Session, user: Optional[User], sports: str, leagues: str, teams: str) -> dict[str, list[int]]:
    """Signed-in users: saved favourites. Guests: favourites passed as query params."""
    fav = {"sport": _ids(sports), "league": _ids(leagues), "team": _ids(teams)}
    if user is not None:
        rows = db.execute(select(UserFavourite.kind, UserFavourite.ref_id).where(UserFavourite.user_id == user.id)).all()
        if rows:
            fav = {"sport": [], "league": [], "team": []}
            for kind, ref in rows:
                fav[kind].append(ref)
    return fav


@router.get("/feed", summary="Home feed driven by favourite sports, leagues and teams")
def feed(
    sports: str = Query("", description="Comma-separated sport ids (guests only)"),
    leagues: str = Query("", description="Comma-separated league ids (guests only)"),
    teams: str = Query("", description="Comma-separated team ids (guests only)"),
    tz: Optional[str] = Query(None, description="IANA time zone used for 'Today'"),
    user: Optional[User] = Depends(optional_user),
    db: Session = Depends(get_db),
):
    now = utcnow()
    zone = _tz(tz)
    fav = favourites_for(db, user, sports, leagues, teams)

    # scope = what the user follows at sport level; interest = leagues/teams they care about
    scope = [Match.league_id.in_(select(League.id).join(Sport).where(League.is_active.is_(True), Sport.is_active.is_(True)))]
    if fav["sport"]:
        scope.append(Match.sport_id.in_(fav["sport"]))
    team_clause = or_(Match.home_team_id.in_(fav["team"]), Match.away_team_id.in_(fav["team"])) if fav["team"] else None
    if fav["league"] or fav["team"]:
        parts = ([Match.league_id.in_(fav["league"])] if fav["league"] else []) + ([team_clause] if team_clause is not None else [])
        interest = or_(*parts)
    else:
        interest = Match.league_id.in_(select(League.id).where(League.is_featured.is_(True)))

    seen: set[int] = set()
    sections = []

    def add(key: str, title: str, matches: list[Match], limit: int) -> None:
        fresh = [m for m in matches if m.id not in seen][:limit]
        seen.update(m.id for m in fresh)
        if fresh:
            sections.append({"key": key, "title": title, "items": match_cards(db, fresh, user)})

    live = load_matches(db, scope + [Match.status == "live"], limit=40)
    fav_teams, fav_leagues = set(fav["team"]), set(fav["league"])
    live.sort(key=lambda m: (not (m.home_team_id in fav_teams or m.away_team_id in fav_teams), m.league_id not in fav_leagues, m.start_time))
    add("live", "Live now", live, 12)

    if team_clause is not None:
        window = Match.start_time.between(now - timedelta(hours=3), now + timedelta(days=7))
        add("my_teams", "Your teams", load_matches(db, scope + [team_clause, window, Match.status.in_(("scheduled", "live"))], limit=10), 8)

    lo, hi = day_bounds(now.astimezone(zone).date(), zone)
    today = [Match.start_time >= lo, Match.start_time < hi, Match.status.in_(("scheduled", "live"))]
    add("today", "Today", load_matches(db, scope + [interest] + today, limit=40), 20)

    greatest = func.max if db.bind.dialect.name == "sqlite" else func.greatest
    top_ids = list(
        db.scalars(
            select(Match.id)
            .join(Prediction, (Prediction.match_id == Match.id) & Prediction.is_current.is_(True))
            .where(*scope, Match.status == "scheduled", Match.start_time.between(now, now + timedelta(hours=48)))
            .order_by(greatest(Prediction.prob_home, Prediction.prob_away).desc())
            .limit(12)
        )
    )
    top = {m.id: m for m in load_matches(db, [Match.id.in_(top_ids)])} if top_ids else {}
    add("top_predictions", "Most confident AI predictions", [top[i] for i in top_ids if i in top], 5)

    add("upcoming", "Coming up", load_matches(db, scope + [interest, Match.status == "scheduled", Match.start_time.between(hi, hi + timedelta(days=3))], limit=30), 15)
    add("results", "Latest results", load_matches(db, scope + [interest, Match.status == "finished", Match.start_time >= now - timedelta(days=2)], order=(Match.start_time.desc(),), limit=20), 10)

    open_picks = 0
    if user is not None:
        open_picks = db.scalar(select(func.count()).select_from(UserPick).where(UserPick.user_id == user.id, UserPick.status == "pending")) or 0
    # no timestamps in the body: identical data -> identical ETag -> cheap 304 on refresh
    return {"personalised": bool(fav["sport"] or fav["league"] or fav["team"]), "open_picks": open_picks, "sections": sections}
