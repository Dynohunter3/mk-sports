"""Settlement, leaderboards, prediction versioning and the live job (service level)."""

import os
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.config import get_settings
from app.db import utcnow
from app.jobs import matches_needing_live_poll, sync_live
from app.models import LeaderboardEntry, Match, Player, Prediction, Sport, User, UserBadge, UserPick
from app.services import predictions as pred_svc
from app.services.leaderboards import RedisLeaderboard, SqlLeaderboard, board_key, refresh_user_entries
from app.services.periods import period_keys, season_key, week_key
from app.services.settlement import settle_match


def _user(db, name):
    u = User(auth_provider="dev", auth_subject=name, email=f"{name}@example.com", display_name=name, terms_accepted_at=utcnow(), privacy_accepted_at=utcnow())
    db.add(u)
    db.flush()
    return u


def _pick(db, user, m, pick, h=None, a=None):
    p = UserPick(user_id=user.id, match_id=m.id, pick=pick, home_score=h, away_score=a, week_key=week_key(m.start_time), season_key=season_key(m.start_time))
    db.add(p)
    db.flush()
    return p


def _entry(db, user, period, m):
    key = period_keys(m.start_time, get_settings().season_start_month)[period]
    return db.scalar(select(LeaderboardEntry).where(LeaderboardEntry.user_id == user.id, LeaderboardEntry.period == period, LeaderboardEntry.period_key == key))


def _upcoming(db, sport="football"):
    sid = db.scalar(select(Sport.id).where(Sport.slug == sport))
    return db.scalars(select(Match).where(Match.sport_id == sid, Match.status == "scheduled", Match.start_time > utcnow() + timedelta(days=2)).order_by(Match.start_time)).first()


def test_settlement_awards_points_and_is_idempotent(db):
    m = _upcoming(db)
    alice, bob, cara = _user(db, "alice-s"), _user(db, "bob-s"), _user(db, "cara-s")
    _pick(db, alice, m, "home", 2, 1)  # exact
    _pick(db, bob, m, "home")  # result only
    _pick(db, cara, m, "away", 0, 1)  # wrong
    m.status, m.home_score, m.away_score = "finished", 2, 1
    settle_match(db, m)
    pts = {u.display_name: u.total_points for u in (alice, bob, cara)}
    assert pts == {"alice-s": 5, "bob-s": 3, "cara-s": 0}
    assert _entry(db, alice, "week", m).points == 5 and _entry(db, alice, "season", m).exact == 1
    assert _entry(db, cara, "all", m).picks == 1 and _entry(db, cara, "all", m).correct == 0
    assert alice.current_streak == 1 and cara.current_streak == 0
    badges = {b.badge.slug for b in db.scalars(select(UserBadge).where(UserBadge.user_id == alice.id))}
    assert {"first-win", "sharpshooter"} <= badges
    # settling twice changes nothing
    settle_match(db, m)
    assert alice.total_points == 5 and _entry(db, alice, "week", m).points == 5
    # the provider corrects the score to 1-1: everything is recomputed
    m.home_score = 1
    settle_match(db, m)
    assert (alice.total_points, bob.total_points, cara.total_points) == (0, 0, 0)
    assert _entry(db, alice, "week", m).points == 0
    db.rollback()


def test_cancelled_match_voids_picks(db):
    m = _upcoming(db)
    dan = _user(db, "dan-v")
    p = _pick(db, dan, m, "home", 1, 0)
    m.status = "cancelled"
    settle_match(db, m)
    assert p.status == "void" and p.points == 0 and dan.picks_settled == 0
    assert _entry(db, dan, "week", m) is None  # void picks don't create leaderboard rows
    db.rollback()


def test_basketball_margin_bonus_via_catalog_rules(db):
    m = _upcoming(db, "basketball")
    eve = _user(db, "eve-b")
    _pick(db, eve, m, "home", 112, 104)  # +8
    m.status, m.home_score, m.away_score = "finished", 110, 101  # +9
    settle_match(db, m)
    assert eve.total_points == 4  # 3 for the winner + 1 margin bonus (within 3 points)
    db.rollback()


def test_streaks_follow_kickoff_order(db):
    sid = db.scalar(select(Sport.id).where(Sport.slug == "football"))
    ms = db.scalars(select(Match).where(Match.sport_id == sid, Match.status == "scheduled", Match.start_time > utcnow() + timedelta(days=2)).order_by(Match.start_time).limit(4)).all()
    fay = _user(db, "fay-streak")
    for m in ms:
        _pick(db, fay, m, "home")
    for m in ms[:3]:
        m.status, m.home_score, m.away_score = "finished", 1, 0
        settle_match(db, m)
    assert fay.current_streak == 3 and fay.best_streak == 3
    assert "streak-3" in {b.badge.slug for b in db.scalars(select(UserBadge).where(UserBadge.user_id == fay.id))}
    ms[3].status, ms[3].home_score, ms[3].away_score = "finished", 0, 2
    settle_match(db, ms[3])
    assert fay.current_streak == 0 and fay.best_streak == 3
    db.rollback()


def _check_ranking(store, db):
    board = board_key("global", 0, "week", "2099-W01")
    users = [_user(db, f"rank-{i}") for i in range(4)]
    for u, pts in zip(users, (10, 7, 7, 3)):
        db.add(LeaderboardEntry(scope="global", scope_id=0, period="week", period_key="2099-W01", user_id=u.id, points=pts, picks=4))
        store.set(board, u.id, pts)
    db.flush()
    page = store.page(db, board, 0, 10)
    assert [(p, r) for _, p, r in page] == [(10, 1), (7, 2), (7, 2), (3, 4)]  # ties share a rank
    assert store.rank_of(db, board, users[3].id) == (4, 3)
    assert store.page(db, board, 2, 2)[0][2] == 2  # rank survives pagination
    assert store.size(db, board) == 4


def test_sql_leaderboard_ranking(db):
    _check_ranking(SqlLeaderboard(), db)
    db.rollback()


def test_redis_leaderboard_ranking(db):
    url = os.environ.get("TEST_REDIS_URL", "redis://localhost:6379/15")
    try:
        store = RedisLeaderboard(url)
        store.r.ping()
    except Exception:
        pytest.skip("Redis not available")
    store.r.flushdb()
    board = board_key("global", 0, "week", "2099-W01")
    store.r.set(f"{board}:built", 1)
    _check_ranking(store, db)
    store.r.flushdb()
    db.rollback()


def test_redis_board_rebuilds_from_db(db):
    try:
        store = RedisLeaderboard(os.environ.get("TEST_REDIS_URL", "redis://localhost:6379/15"))
        store.r.ping()
    except Exception:
        pytest.skip("Redis not available")
    store.r.flushdb()
    key = period_keys(utcnow())["season"]
    board = board_key("global", 0, "season", key)
    sql_top = SqlLeaderboard().page(db, board, 0, 5)
    assert store.page(db, board, 0, 5) and [p for _, p, _ in store.page(db, board, 0, 5)] == [p for _, p, _ in sql_top]
    store.r.flushdb()


def test_refresh_entries_removes_empty_rows(db):
    m = _upcoming(db)
    gus = _user(db, "gus-empty")
    keys = period_keys(m.start_time)
    db.add(LeaderboardEntry(scope="global", scope_id=0, period="week", period_key=keys["week"], user_id=gus.id, points=9))
    db.flush()
    refresh_user_entries(db, gus.id, keys, SqlLeaderboard())
    db.flush()
    assert _entry(db, gus, "week", m) is None
    db.rollback()


def test_prediction_versions_only_on_meaningful_change(db):
    sport = db.scalar(select(Sport).where(Sport.slug == "football"))
    m = _upcoming(db)
    before = db.scalars(select(Prediction).where(Prediction.match_id == m.id)).all()
    assert before
    out = pred_svc.run_predictions(db, sport, match_ids={m.id})
    assert out["new_versions"] == 0  # nothing changed -> no new version
    star = db.scalars(select(Player).where(Player.team_id == m.home_team_id).order_by(Player.importance.desc())).first()
    star.status = "available" if star.status != "available" else "injured"
    db.flush()
    out = pred_svc.run_predictions(db, sport, match_ids={m.id})
    assert out["new_versions"] == 1
    versions = db.scalars(select(Prediction).where(Prediction.match_id == m.id).order_by(Prediction.version)).all()
    assert versions[-1].trigger == "team_news" and versions[-1].is_current
    assert sum(v.is_current for v in versions) == 1 and versions[-1].version == len(versions)
    db.rollback()


def test_predictions_freeze_at_kickoff_and_get_evaluated(db):
    sport = db.scalar(select(Sport).where(Sport.slug == "football"))
    m = _upcoming(db)
    latest = db.scalars(select(Prediction).where(Prediction.match_id == m.id).order_by(Prediction.version.desc())).first()
    m.start_time = latest.created_at + timedelta(seconds=1)  # kicked off just after the last prediction
    db.flush()
    # after kick-off the job no longer touches the match, even if inputs change
    star = db.scalars(select(Player).where(Player.team_id == m.home_team_id).order_by(Player.importance.desc())).first()
    star.status = "injured" if star.status == "available" else "available"
    db.flush()
    assert pred_svc.run_predictions(db, sport, match_ids={m.id}).get("new_versions", 0) == 0
    m.status, m.home_score, m.away_score = "finished", 3, 0
    p = pred_svc.evaluate_match(db, m)
    assert p is not None and p.id == latest.id  # the last pre-kick-off version is the one scored
    assert p.outcome_correct is not None and p.brier is not None and p.log_loss > 0
    db.rollback()


def test_live_job_only_polls_when_needed(db):
    settings = get_settings()
    live_now = matches_needing_live_poll(db, utcnow())
    assert live_now  # demo-live put matches in progress
    assert sync_live(db, settings)["polled"] == len(live_now)
    # with nothing in progress or about to start, the job makes no provider calls at all
    for m in db.scalars(select(Match).where(Match.status == "live")):
        m.status = "finished"
    db.flush()
    quiet = utcnow() + timedelta(days=400)
    assert matches_needing_live_poll(db, quiet) == []
    assert sync_live(db, settings, quiet) == {"skipped": "no live matches"}
    db.rollback()


def test_out_of_order_results_never_inflate_streaks(db):
    """W ? W W: the badge for 3 in a row must not be awarded before the '?' is known."""
    sid = db.scalar(select(Sport.id).where(Sport.slug == "football"))
    ms = db.scalars(select(Match).where(Match.sport_id == sid, Match.status == "scheduled", Match.start_time > utcnow() + timedelta(days=2)).order_by(Match.start_time).limit(4)).all()
    hal = _user(db, "hal-order")
    for m in ms:
        _pick(db, hal, m, "home")
    for m in (ms[0], ms[2], ms[3]):  # the second match is still being played
        m.status, m.home_score, m.away_score = "finished", 1, 0
        settle_match(db, m)
    assert hal.current_streak == 3  # three results have come in, all correct
    ms[1].status, ms[1].home_score, ms[1].away_score = "finished", 0, 1
    settle_match(db, ms[1])
    assert hal.current_streak == 0 and hal.best_streak == 3
    db.rollback()
