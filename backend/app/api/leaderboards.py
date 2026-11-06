from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import optional_user
from ..config import get_settings
from ..db import get_db, utcnow
from ..models import LeaderboardEntry, User
from ..schemas import LeaderboardOut
from ..services.leaderboards import available_periods, board_key, get_store
from ..services.periods import period_keys

router = APIRouter(tags=["leaderboards"])


def _rows(db: Session, period: str, key: str, ranked: list[tuple[str, int, int]], me: Optional[User]) -> list[dict]:
    ids = [u for u, _, _ in ranked]
    if not ids:
        return []
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_(ids)))}
    entries = {
        e.user_id: e
        for e in db.scalars(
            select(LeaderboardEntry).where(
                LeaderboardEntry.scope == "global", LeaderboardEntry.scope_id == 0, LeaderboardEntry.period == period,
                LeaderboardEntry.period_key == key, LeaderboardEntry.user_id.in_(ids),
            )
        )
    }
    out = []
    for uid, pts, rank in ranked:
        u, e = users.get(uid), entries.get(uid)
        if u is None:
            continue
        out.append({
            "rank": rank, "user_id": uid, "display_name": u.display_name, "country": u.country, "points": pts,
            "picks": e.picks if e else 0, "correct": e.correct if e else 0, "exact": e.exact if e else 0, "is_me": bool(me and me.id == uid),
        })
    return out


@router.get("/leaderboards/global", response_model=LeaderboardOut, summary="Global leaderboard (weekly, season or all-time)")
def global_leaderboard(
    period: Literal["week", "season", "all"] = "week",
    key: Optional[str] = Query(None, description="e.g. 2026-W45 or 2026-27; defaults to the current period"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user: Optional[User] = Depends(optional_user),
    db: Session = Depends(get_db),
):
    key = key or period_keys(utcnow(), get_settings().season_start_month)[period]
    board = board_key("global", 0, period, key)
    store = get_store()
    items = _rows(db, period, key, store.page(db, board, offset, limit), user)
    me = None
    if user is not None:
        r = store.rank_of(db, board, user.id)
        if r is not None:
            me = _rows(db, period, key, [(user.id, r[1], r[0])], user)[0]
    return {"scope": "global", "period": period, "period_key": key, "total": store.size(db, board), "items": items, "me": me}


@router.get("/leaderboards/periods", summary="Weeks and seasons that have leaderboard data")
def leaderboard_periods(db: Session = Depends(get_db)):
    current = period_keys(utcnow(), get_settings().season_start_month)
    return {"current": current, "available": available_periods(db)}
