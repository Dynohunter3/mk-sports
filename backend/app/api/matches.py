from __future__ import annotations

import base64
from datetime import date, datetime, time, timedelta, timezone
from typing import Literal, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from ..auth import optional_user
from ..cache import cached, data_version
from ..db import get_db, utcnow
from ..models import League, Match, Prediction, Sport, User
from ..schemas import MatchCard, MatchDetail, MatchPage, PredictionVersionOut
from ..views import attach_picks, load_matches, match_cards, match_detail

router = APIRouter(tags=["matches"])


def _tz(name: Optional[str]):
    if not name:
        return timezone.utc
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(422, f"Unknown time zone '{name}'")


def day_bounds(day: date, tz) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time.min, tzinfo=tz).astimezone(timezone.utc)
    return start, start + timedelta(days=1)


def _encode_cursor(m: dict) -> str:
    return base64.urlsafe_b64encode(f"{m['start_time'].isoformat()}|{m['id']}".encode()).decode()


def _decode_cursor(c: str) -> tuple[datetime, int]:
    try:
        ts, mid = base64.urlsafe_b64decode(c.encode()).decode().split("|")
        return datetime.fromisoformat(ts), int(mid)
    except Exception:
        raise HTTPException(422, "Invalid cursor")


@router.get("/matches", response_model=MatchPage, summary="Fixtures, live and finished matches with filters")
def list_matches(
    day: Optional[date] = Query(None, alias="date", description="Local calendar day (see tz)"),
    tz: Optional[str] = Query(None, description="IANA time zone for `date`, e.g. Africa/Lusaka"),
    date_from: Optional[datetime] = Query(None, alias="from"),
    date_to: Optional[datetime] = Query(None, alias="to"),
    sport: Optional[str] = None,
    league_id: Optional[int] = None,
    team_id: Optional[int] = None,
    status: Optional[Literal["scheduled", "live", "finished", "postponed", "cancelled"]] = None,
    order: Literal["asc", "desc"] = "asc",
    limit: int = Query(30, ge=1, le=100),
    cursor: Optional[str] = None,
    user: Optional[User] = Depends(optional_user),
    db: Session = Depends(get_db),
):
    where = []
    if day is not None:
        lo, hi = day_bounds(day, _tz(tz))
        where += [Match.start_time >= lo, Match.start_time < hi]
    if date_from is not None:
        where.append(Match.start_time >= date_from)
    if date_to is not None:
        where.append(Match.start_time <= date_to)
    if sport:
        where.append(Match.sport_id == select(Sport.id).where(Sport.slug == sport).scalar_subquery())
    if league_id:
        where.append(Match.league_id == league_id)
    if team_id:
        where.append(or_(Match.home_team_id == team_id, Match.away_team_id == team_id))
    if status:
        where.append(Match.status == status)
    where.append(Match.league_id.in_(select(League.id).where(League.is_active.is_(True))))
    if cursor:
        ts, mid = _decode_cursor(cursor)
        if order == "asc":
            where.append(or_(Match.start_time > ts, and_(Match.start_time == ts, Match.id > mid)))
        else:
            where.append(or_(Match.start_time < ts, and_(Match.start_time == ts, Match.id < mid)))
    ordering = (Match.start_time, Match.id) if order == "asc" else (Match.start_time.desc(), Match.id.desc())
    key = f"matches:{day}:{tz}:{date_from}:{date_to}:{sport}:{league_id}:{team_id}:{status}:{order}:{limit}:{cursor}:{data_version()}"

    def build():
        return match_cards(db, load_matches(db, where, order=ordering, limit=limit + 1))

    cards = cached(key, 20 if status in (None, "live") else 120, build)
    cards = [dict(c) for c in cards]
    for c in cards:  # cached payloads come back with ISO strings
        if isinstance(c["start_time"], str):
            c["start_time"] = datetime.fromisoformat(c["start_time"])
    more = len(cards) > limit
    cards = attach_picks(db, cards[:limit], user)
    return {"items": cards, "next_cursor": _encode_cursor(cards[-1]) if more and cards else None}


@router.get("/matches/live", response_model=list[MatchCard], summary="Everything in progress right now")
def live_matches(sport: Optional[str] = None, user: Optional[User] = Depends(optional_user), db: Session = Depends(get_db)):
    where = [Match.status == "live"]
    if sport:
        where.append(Match.sport_id == select(Sport.id).where(Sport.slug == sport).scalar_subquery())
    return match_cards(db, load_matches(db, where), user)


@router.get("/matches/{match_id}", response_model=MatchDetail, summary="Match detail: prediction, form, H2H, table, injuries")
def get_match(match_id: int, user: Optional[User] = Depends(optional_user), db: Session = Depends(get_db)):
    found = load_matches(db, [Match.id == match_id])
    if not found:
        raise HTTPException(404, "Match not found")
    return match_detail(db, found[0], user)


@router.get("/matches/{match_id}/predictions", response_model=list[PredictionVersionOut], summary="Every stored prediction version")
def prediction_history(match_id: int, db: Session = Depends(get_db)):
    preds = db.scalars(select(Prediction).where(Prediction.match_id == match_id).order_by(Prediction.version)).all()
    return [
        {
            "version": p.version, "created_at": p.created_at, "trigger": p.trigger,
            "probabilities": {"home": p.prob_home, "away": p.prob_away, **({"draw": p.prob_draw} if p.prob_draw is not None else {})},
            "predicted_score": (p.predicted_home, p.predicted_away), "confidence": p.confidence,
        }
        for p in preds
    ]
