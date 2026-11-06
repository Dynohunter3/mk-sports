from __future__ import annotations

import logging
from datetime import datetime
from typing import Literal, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.orm import Session

from ..auth import current_user
from ..config import get_settings
from ..db import get_db, utcnow
from ..models import (
    Badge, DeviceToken, Friendship, LeaderboardEntry, League, Match, Notification, PrivateLeagueMember, Sport, Team, User, UserBadge, UserFavourite, UserPick,
)
from ..schemas import ConsentIn, Favourites, MeOut, MePatch, PickHistoryPage
from ..services.leaderboards import board_key, get_store
from ..services.periods import period_keys
from ..views import load_matches, match_cards, my_pick

log = logging.getLogger(__name__)
router = APIRouter(prefix="/me", tags=["me"])


def favourites(db: Session, user: User) -> dict:
    fav: dict[str, list[int]] = {"sports": [], "leagues": [], "teams": []}
    for kind, ref in db.execute(select(UserFavourite.kind, UserFavourite.ref_id).where(UserFavourite.user_id == user.id)):
        fav[kind + "s"].append(ref)
    return fav


def me_out(db: Session, user: User) -> dict:
    pending = db.scalar(select(func.count()).select_from(UserPick).where(UserPick.user_id == user.id, UserPick.status == "pending")) or 0
    season = period_keys(utcnow(), get_settings().season_start_month)["season"]
    rank = get_store().rank_of(db, board_key("global", 0, "season", season), user.id)
    badges = db.execute(select(Badge, UserBadge.awarded_at).outerjoin(UserBadge, and_(UserBadge.badge_id == Badge.id, UserBadge.user_id == user.id)).order_by(Badge.sort_order)).all()
    return {
        "id": user.id, "display_name": user.display_name, "email": user.email, "phone": user.phone, "country": user.country,
        "auth_provider": user.auth_provider, "consented": bool(user.terms_accepted_at and user.privacy_accepted_at),
        "marketing_opt_in": user.marketing_opt_in, "onboarded": user.onboarded_at is not None,
        "notification_prefs": {**DEFAULT_PREFS, **(user.notification_prefs or {})}, "favourites": favourites(db, user),
        "stats": {
            "total_points": user.total_points, "picks_settled": user.picks_settled, "picks_correct": user.picks_correct,
            "exact_scores": user.exact_scores, "accuracy": round(user.picks_correct / user.picks_settled, 4) if user.picks_settled else None,
            "current_streak": user.current_streak, "best_streak": user.best_streak, "pending_picks": pending,
            "global_rank_season": rank[0] if rank else None,
        },
        "badges": [{"slug": b.slug, "name": b.name, "description": b.description, "icon": b.icon, "awarded_at": at} for b, at in badges],
        "created_at": user.created_at,
    }


DEFAULT_PREFS = {"match_reminders": True, "pick_lock_warnings": True, "results": True, "leaderboard": False}


@router.get("", response_model=MeOut, summary="My profile, favourites, stats and badges")
def get_me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return me_out(db, user)


@router.patch("", response_model=MeOut)
def patch_me(body: MePatch, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if body.display_name is not None:
        user.display_name = body.display_name.strip()
    if body.country is not None:
        user.country = body.country.upper()
    if body.notification_prefs is not None:
        user.notification_prefs = {**(user.notification_prefs or {}), **{k: bool(v) for k, v in body.notification_prefs.items() if k in DEFAULT_PREFS}}
    if body.marketing_opt_in is not None:
        user.marketing_opt_in = body.marketing_opt_in
    db.commit()
    return me_out(db, user)


@router.post("/consent", response_model=MeOut, summary="Accept terms & privacy policy (required before making picks)")
def consent(body: ConsentIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not (body.terms and body.privacy):
        raise HTTPException(422, "Both the terms and the privacy policy must be accepted")
    now = utcnow()
    user.terms_accepted_at = user.terms_accepted_at or now
    user.privacy_accepted_at = user.privacy_accepted_at or now
    user.marketing_opt_in = body.marketing
    db.commit()
    return me_out(db, user)


@router.put("/favourites", response_model=MeOut, summary="Replace favourite sports, leagues and teams (drives the home feed)")
def put_favourites(body: Favourites, user: User = Depends(current_user), db: Session = Depends(get_db)):
    valid = {
        "sport": set(db.scalars(select(Sport.id).where(Sport.id.in_(body.sports)))),
        "league": set(db.scalars(select(League.id).where(League.id.in_(body.leagues)))),
        "team": set(db.scalars(select(Team.id).where(Team.id.in_(body.teams[:50])))),
    }
    db.execute(delete(UserFavourite).where(UserFavourite.user_id == user.id))
    for kind, ids in valid.items():
        for ref in ids:
            db.add(UserFavourite(user_id=user.id, kind=kind, ref_id=ref))
    user.onboarded_at = user.onboarded_at or utcnow()
    db.commit()
    return me_out(db, user)


@router.get("/picks", response_model=PickHistoryPage, summary="My pick history")
def pick_history(
    status: Literal["all", "pending", "settled"] = "all",
    limit: int = Query(20, ge=1, le=50),
    cursor: Optional[str] = Query(None, description="Opaque cursor from the previous page"),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    q = select(UserPick, Match.start_time).join(Match).where(UserPick.user_id == user.id)
    if status == "pending":
        q = q.where(UserPick.status == "pending")
    elif status == "settled":
        q = q.where(UserPick.status != "pending")
    if cursor:
        ts, pid = cursor.split("_")
        t = datetime.fromisoformat(ts)
        q = q.where(or_(Match.start_time < t, and_(Match.start_time == t, UserPick.id < int(pid))))
    rows = db.execute(q.order_by(Match.start_time.desc(), UserPick.id.desc()).limit(limit + 1)).all()
    more = len(rows) > limit
    rows = rows[:limit]
    matches = {m.id: m for m in load_matches(db, [Match.id.in_([p.match_id for p, _ in rows])])}
    cards = {c["id"]: c for c in match_cards(db, list(matches.values()), user)}
    items = [{"match": cards[p.match_id], "pick": my_pick(p), "created_at": p.created_at} for p, _ in rows if p.match_id in cards]
    nxt = f"{rows[-1][1].isoformat()}_{rows[-1][0].id}" if more and rows else None
    return {"items": items, "next_cursor": nxt}


class DeviceIn(BaseModel):
    token: str = Field(min_length=10, max_length=300)
    platform: Literal["android", "ios", "web"]


@router.post("/devices", status_code=204, summary="Register a push token (FCM). Delivery ships in Phase 2")
def register_device(body: DeviceIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    existing = db.scalar(select(DeviceToken).where(DeviceToken.token == body.token))
    if existing:
        existing.user_id, existing.platform = user.id, body.platform
    else:
        db.add(DeviceToken(user_id=user.id, token=body.token, platform=body.platform))
    db.commit()
    return Response(status_code=204)


@router.get("/export", summary="Download all data we hold about me (privacy)")
def export_me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    picks = db.execute(select(UserPick, Match).join(Match).where(UserPick.user_id == user.id).order_by(Match.start_time)).all()
    return {
        "profile": {k: getattr(user, k) for k in ("id", "email", "phone", "display_name", "country", "created_at", "terms_accepted_at", "privacy_accepted_at", "marketing_opt_in", "notification_prefs")},
        "favourites": favourites(db, user),
        "picks": [{"match_id": m.id, "kickoff": m.start_time, "pick": p.pick, "home_score": p.home_score, "away_score": p.away_score, "status": p.status, "points": p.points} for p, m in picks],
        "badges": [b.slug for b in db.scalars(select(Badge).join(UserBadge).where(UserBadge.user_id == user.id))],
        "exported_at": utcnow(),
    }


@router.delete("", status_code=204, summary="Delete my account and all my data (irreversible)")
def delete_me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    store = get_store()
    for e in db.scalars(select(LeaderboardEntry).where(LeaderboardEntry.user_id == user.id)):
        store.remove(board_key(e.scope, e.scope_id, e.period, e.period_key), user.id)
    for model in (UserPick, UserFavourite, UserBadge, LeaderboardEntry, Notification, DeviceToken, PrivateLeagueMember):
        db.execute(delete(model).where(model.user_id == user.id))
    db.execute(delete(Friendship).where(or_(Friendship.user_id == user.id, Friendship.friend_id == user.id)))
    provider, subject = user.auth_provider, user.auth_subject
    db.delete(user)
    db.commit()
    settings = get_settings()
    if provider == "supabase" and settings.supabase_url and settings.supabase_service_role_key:
        try:  # also remove the identity from Supabase Auth
            httpx.delete(
                f"{settings.supabase_url.rstrip('/')}/auth/v1/admin/users/{subject}",
                headers={"apikey": settings.supabase_service_role_key, "Authorization": f"Bearer {settings.supabase_service_role_key}"},
                timeout=10,
            )
        except httpx.HTTPError:
            log.exception("failed to delete Supabase auth user %s", subject)
    return Response(status_code=204)
