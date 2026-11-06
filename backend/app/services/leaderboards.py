"""Leaderboards: durable totals in `leaderboard_entries`, optional Redis sorted-set mirror.

Ranking is standard competition ranking on points (1, 2, 2, 4): ties share a rank.
"""

from __future__ import annotations

from typing import Optional, Protocol

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import LeaderboardEntry, Match, UserPick

PERIODS = ("week", "season", "all")


def board_key(scope: str, scope_id: int, period: str, period_key: str) -> str:
    return f"lb:{scope}:{scope_id}:{period}:{period_key}"


class LeaderboardStore(Protocol):
    def set(self, board: str, user_id: str, points: int) -> None: ...
    def remove(self, board: str, user_id: str) -> None: ...
    def page(self, db: Session, board: str, offset: int, limit: int) -> list[tuple[str, int, int]]: ...
    def rank_of(self, db: Session, board: str, user_id: str) -> Optional[tuple[int, int]]: ...
    def size(self, db: Session, board: str) -> int: ...


def _parse(board: str) -> tuple[str, int, str, str]:
    _, scope, scope_id, period, key = board.split(":", 4)
    return scope, int(scope_id), period, key


def _filter(board: str):
    scope, scope_id, period, key = _parse(board)
    return (
        LeaderboardEntry.scope == scope,
        LeaderboardEntry.scope_id == scope_id,
        LeaderboardEntry.period == period,
        LeaderboardEntry.period_key == key,
    )


class SqlLeaderboard:
    """Reads straight from Postgres/SQLite. Used when Redis isn't configured."""

    def set(self, board: str, user_id: str, points: int) -> None:  # rows are already written
        pass

    def remove(self, board: str, user_id: str) -> None:
        pass

    def page(self, db: Session, board: str, offset: int, limit: int) -> list[tuple[str, int, int]]:
        rank = func.rank().over(order_by=LeaderboardEntry.points.desc())
        q = (
            select(LeaderboardEntry.user_id, LeaderboardEntry.points, rank.label("rank"))
            .where(*_filter(board))
            .order_by(LeaderboardEntry.points.desc(), LeaderboardEntry.exact.desc(), LeaderboardEntry.user_id)
            .offset(offset)
            .limit(limit)
        )
        return [(u, p, int(r)) for u, p, r in db.execute(q)]

    def rank_of(self, db: Session, board: str, user_id: str) -> Optional[tuple[int, int]]:
        pts = db.scalar(select(LeaderboardEntry.points).where(*_filter(board), LeaderboardEntry.user_id == user_id))
        if pts is None:
            return None
        higher = db.scalar(select(func.count()).select_from(LeaderboardEntry).where(*_filter(board), LeaderboardEntry.points > pts)) or 0
        return higher + 1, pts

    def size(self, db: Session, board: str) -> int:
        return db.scalar(select(func.count()).select_from(LeaderboardEntry).where(*_filter(board))) or 0


class RedisLeaderboard:
    """ZSET per board. Rebuilt lazily from the database if a key is missing (e.g. after a flush)."""

    def __init__(self, url: str):
        import redis

        self.r = redis.Redis.from_url(url, decode_responses=True, socket_timeout=2)

    def _ensure(self, db: Session, board: str) -> None:
        if self.r.exists(f"{board}:built"):
            return
        rows = db.execute(select(LeaderboardEntry.user_id, LeaderboardEntry.points).where(*_filter(board))).all()
        pipe = self.r.pipeline()
        pipe.delete(board)
        if rows:
            pipe.zadd(board, {u: p for u, p in rows})
        pipe.set(f"{board}:built", 1)
        pipe.execute()

    def set(self, board: str, user_id: str, points: int) -> None:
        if self.r.exists(f"{board}:built"):  # otherwise the next read rebuilds from the DB
            self.r.zadd(board, {user_id: points})

    def remove(self, board: str, user_id: str) -> None:
        self.r.zrem(board, user_id)

    def page(self, db: Session, board: str, offset: int, limit: int) -> list[tuple[str, int, int]]:
        self._ensure(db, board)
        rows = self.r.zrevrange(board, offset, offset + limit - 1, withscores=True)
        out, prev_score, prev_rank = [], None, 0
        for i, (user, score) in enumerate(rows):
            if score != prev_score:
                prev_rank = (self.r.zcount(board, f"({score}", "+inf") + 1) if i == 0 else offset + i + 1
                prev_score = score
            out.append((user, int(score), prev_rank))
        return out

    def rank_of(self, db: Session, board: str, user_id: str) -> Optional[tuple[int, int]]:
        self._ensure(db, board)
        score = self.r.zscore(board, user_id)
        if score is None:
            return None
        return self.r.zcount(board, f"({score}", "+inf") + 1, int(score)

    def size(self, db: Session, board: str) -> int:
        self._ensure(db, board)
        return int(self.r.zcard(board))


_store: Optional[LeaderboardStore] = None


def get_store() -> LeaderboardStore:
    global _store
    if _store is None:
        url = get_settings().redis_url
        _store = RedisLeaderboard(url) if url else SqlLeaderboard()
    return _store


def reset_store(store: Optional[LeaderboardStore] = None) -> None:
    global _store
    _store = store


def refresh_user_entries(db: Session, user_id: str, keys: dict[str, str], store: Optional[LeaderboardStore] = None) -> None:
    """Recompute this user's global totals for the given periods from their settled picks.
    Absolute (not incremental) so re-settling a corrected result is idempotent."""
    store = store or get_store()
    for period, key in keys.items():
        q = select(
            func.count(),
            func.coalesce(func.sum(UserPick.points), 0),
            func.coalesce(func.sum(case((UserPick.result_correct.is_(True), 1), else_=0)), 0),
            func.coalesce(func.sum(case((UserPick.exact_score.is_(True), 1), else_=0)), 0),
        ).where(UserPick.user_id == user_id, UserPick.status.in_(("won", "lost")))
        if period == "week":
            q = q.where(UserPick.week_key == key)
        elif period == "season":
            q = q.where(UserPick.season_key == key)
        n, pts, correct, exact = db.execute(q).one()
        entry = db.scalar(
            select(LeaderboardEntry).where(
                LeaderboardEntry.scope == "global", LeaderboardEntry.scope_id == 0, LeaderboardEntry.period == period,
                LeaderboardEntry.period_key == key, LeaderboardEntry.user_id == user_id,
            )
        )
        board = board_key("global", 0, period, key)
        if n == 0:
            if entry is not None:
                db.delete(entry)
                store.remove(board, user_id)
            continue
        if entry is None:
            entry = LeaderboardEntry(scope="global", scope_id=0, period=period, period_key=key, user_id=user_id)
            db.add(entry)
        entry.points, entry.picks, entry.correct, entry.exact = int(pts), int(n), int(correct), int(exact)
        store.set(board, user_id, int(pts))


def available_periods(db: Session) -> dict[str, list[str]]:
    rows = db.execute(
        select(LeaderboardEntry.period, LeaderboardEntry.period_key).where(LeaderboardEntry.scope == "global").distinct()
    ).all()
    out: dict[str, list[str]] = {p: [] for p in PERIODS}
    for period, key in rows:
        out.setdefault(period, []).append(key)
    for p in out:
        out[p].sort(reverse=True)
    return out


def rebuild_all(db: Session) -> int:
    """Recompute every user's entries from picks (use after bulk imports or rule changes)."""
    from .periods import period_keys  # local import to avoid a cycle

    settings = get_settings()
    rows = db.execute(select(UserPick.user_id, Match.start_time).join(Match).where(UserPick.status.in_(("won", "lost")))).all()
    todo: dict[str, dict[str, set[str]]] = {}
    for uid, start in rows:
        for period, key in period_keys(start, settings.season_start_month).items():
            todo.setdefault(uid, {}).setdefault(period, set()).add(key)
    store = get_store()
    n = 0
    for uid, periods in todo.items():
        for period, keys in periods.items():
            for key in keys:
                refresh_user_entries(db, uid, {period: key}, store)
                n += 1
    db.flush()
    return n
