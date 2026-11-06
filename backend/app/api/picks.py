from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..auth import consented_user, current_user
from ..config import get_settings
from ..db import get_db, utcnow
from ..models import Match, Sport, User, UserPick
from ..schemas import PickIn, PickOut
from ..services.periods import season_key, week_key
from ..services.scoring import PickError, is_locked, validate_pick
from ..services.settlement import award_badges

router = APIRouter(tags=["picks"])


def _out(p: UserPick, m: Match, new_badges: Optional[list[str]] = None) -> dict:
    return {
        "match_id": p.match_id, "pick": p.pick, "home_score": p.home_score, "away_score": p.away_score, "status": p.status,
        "points": p.points, "result_correct": p.result_correct, "exact_score": p.exact_score, "locks_at": m.start_time, "new_badges": new_badges or [],
    }


def _locked_error(m: Match) -> HTTPException:
    return HTTPException(409, detail={"code": "locked", "message": "Picks for this match locked at kick-off", "locked_at": m.start_time.isoformat()})


@router.put("/picks/{match_id}", response_model=PickOut, summary="Make or change a pick (until kick-off)")
def upsert_pick(match_id: int, body: PickIn, user: User = Depends(consented_user), db: Session = Depends(get_db)):
    m = db.get(Match, match_id)
    if m is None:
        raise HTTPException(404, "Match not found")
    sport = db.get(Sport, m.sport_id)
    now = utcnow()
    if is_locked(m.status, m.start_time, now):
        raise _locked_error(m)
    try:
        outcome = validate_pick(sport.has_draws, body.pick, body.home_score, body.away_score, (sport.config or {}).get("max_score", 200))
    except PickError as exc:
        raise HTTPException(422, detail={"code": exc.code, "message": str(exc)})
    pick = db.scalar(select(UserPick).where(UserPick.user_id == user.id, UserPick.match_id == m.id))
    first = pick is None
    if pick is None:
        settings = get_settings()
        pick = UserPick(user_id=user.id, match_id=m.id, week_key=week_key(m.start_time), season_key=season_key(m.start_time, settings.season_start_month))
        db.add(pick)
    pick.pick, pick.home_score, pick.away_score, pick.updated_at = outcome, body.home_score, body.away_score, now
    try:
        db.flush()
    except IntegrityError:  # two devices racing to create the same pick
        db.rollback()
        raise HTTPException(409, detail={"code": "conflict", "message": "Pick was just saved from another device; retry"})
    badges = award_badges(db, user.id, made_pick=True) if first else []
    db.commit()
    return _out(pick, m, badges)


@router.delete("/picks/{match_id}", status_code=204, summary="Remove a pick (until kick-off)")
def delete_pick(match_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    m = db.get(Match, match_id)
    pick = db.scalar(select(UserPick).where(UserPick.user_id == user.id, UserPick.match_id == match_id))
    if m is None or pick is None:
        raise HTTPException(404, "Pick not found")
    if is_locked(m.status, m.start_time, utcnow()):
        raise _locked_error(m)
    db.delete(pick)
    db.commit()
    return Response(status_code=204)


@router.get("/picks", response_model=list[PickOut], summary="My picks for specific matches")
def my_picks_for(match_ids: str = Query(..., description="Comma-separated match ids (max 100)"), user: User = Depends(current_user), db: Session = Depends(get_db)):
    ids = [int(x) for x in match_ids.split(",") if x.strip().isdigit()][:100]
    rows = db.execute(select(UserPick, Match).join(Match).where(UserPick.user_id == user.id, UserPick.match_id.in_(ids))).all()
    return [_out(p, m) for p, m in rows]
