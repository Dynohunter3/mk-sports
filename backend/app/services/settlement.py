"""Settle picks when a match becomes final, then refresh stats, leaderboards and badges.

Idempotent: re-running for the same match (e.g. after a corrected score) recomputes
points from scratch and rewrites absolute totals.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import utcnow
from ..models import Badge, Match, Prediction, Sport, User, UserBadge, UserPick
from .leaderboards import LeaderboardStore, get_store, refresh_user_entries
from .periods import period_keys
from .predictions import evaluate_match
from .scoring import ScoringRules, best_streak, score_pick, streak_from

STREAK_BADGES = ((3, "streak-3"), (5, "streak-5"), (10, "streak-10"))
POINT_BADGES = ((50, "half-century"), (100, "centurion"))


def settle_match(db: Session, match: Match, now: Optional[datetime] = None, store: Optional[LeaderboardStore] = None) -> dict:
    now = now or utcnow()
    store = store or get_store()
    sport = match.sport or db.get(Sport, match.sport_id)
    picks = db.scalars(select(UserPick).where(UserPick.match_id == match.id)).all()
    ai_pick: Optional[str] = None
    if match.status == "finished" and match.home_score is not None and match.away_score is not None:
        rules = ScoringRules.from_dict(sport.scoring_rules)
        pred = evaluate_match(db, match)
        if pred is not None:
            probs = {"home": pred.prob_home, "away": pred.prob_away, **({"draw": pred.prob_draw} if pred.prob_draw is not None else {})}
            ai_pick = max(probs, key=probs.get)
        for p in picks:
            s = score_pick(rules, p.pick, match.home_score, match.away_score, p.home_score, p.away_score)
            p.status, p.points, p.result_correct, p.exact_score, p.settled_at = s.status, s.points, s.result_correct, s.exact_score, now
    elif match.status == "cancelled":
        for p in picks:
            p.status, p.points, p.result_correct, p.exact_score, p.settled_at = "void", 0, None, False, now
    else:
        return {"match_id": match.id, "settled": 0}
    match.settled_at = now
    db.flush()

    keys = period_keys(match.start_time, get_settings().season_start_month)
    for uid in {p.user_id for p in picks}:
        refresh_user_entries(db, uid, keys, store)
        refresh_user_stats(db, uid)
    beat_ai = {p.user_id for p in picks if ai_pick and p.status == "won" and p.pick != ai_pick}
    for uid in {p.user_id for p in picks}:
        award_badges(db, uid, beat_ai=uid in beat_ai)
    db.flush()
    return {"match_id": match.id, "settled": len(picks), "status": match.status}


def refresh_user_stats(db: Session, user_id: str) -> Optional[User]:
    user = db.get(User, user_id)
    if user is None:
        return None
    rows = db.execute(
        select(UserPick.result_correct, UserPick.points, UserPick.exact_score)
        .join(Match, Match.id == UserPick.match_id)
        .where(UserPick.user_id == user_id, UserPick.status.in_(("won", "lost")))
        # results in the order they came in (then kick-off): a streak is never inflated by
        # an earlier match whose result isn't in yet
        .order_by(UserPick.settled_at, Match.start_time, Match.id)
    ).all()
    results = [bool(r[0]) for r in rows]
    user.picks_settled = len(rows)
    user.picks_correct = sum(results)
    user.total_points = sum(r[1] for r in rows)
    user.exact_scores = sum(1 for r in rows if r[2])
    user.current_streak = streak_from(list(reversed(results)))
    user.best_streak = best_streak(results)
    return user


def _award(db: Session, user_id: str, slug: str, badges: dict[str, Badge], have: set[int]) -> bool:
    b = badges.get(slug)
    if b is None or b.id in have:
        return False
    db.add(UserBadge(user_id=user_id, badge_id=b.id, awarded_at=utcnow()))
    have.add(b.id)
    return True


def award_badges(db: Session, user_id: str, beat_ai: bool = False, made_pick: bool = False) -> list[str]:
    user = db.get(User, user_id)
    if user is None:
        return []
    badges = {b.slug: b for b in db.scalars(select(Badge))}
    have = set(db.scalars(select(UserBadge.badge_id).where(UserBadge.user_id == user_id)))
    new: list[str] = []
    checks = [
        ("first-pick", made_pick or user.picks_settled > 0),
        ("first-win", user.picks_correct >= 1),
        ("sharpshooter", user.exact_scores >= 1),
        ("beat-the-ai", beat_ai),
    ]
    checks += [(slug, user.best_streak >= n) for n, slug in STREAK_BADGES]
    checks += [(slug, user.total_points >= n) for n, slug in POINT_BADGES]
    if user.picks_correct >= 2 and "multi-sport" in badges and badges["multi-sport"].id not in have:
        sports = db.scalar(
            select(func.count(func.distinct(Match.sport_id))).join(UserPick, UserPick.match_id == Match.id).where(UserPick.user_id == user_id, UserPick.status == "won")
        )
        checks.append(("multi-sport", (sports or 0) >= 2))
    for slug, ok in checks:
        if ok and _award(db, user_id, slug, badges, have):
            new.append(slug)
    return new
