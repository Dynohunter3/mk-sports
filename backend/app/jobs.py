"""Scheduled jobs.

  live         every 30s, but returns immediately (no provider calls) unless a match is
               live or kicks off within 2 minutes -> polls only while matches are in progress
  fixtures     every 30 min: fixtures, results and kick-off changes for -2..+14 days
  squads       every 30 min: injuries/suspensions; changed teams trigger re-predictions
  predictions  every 15 min: (re)compute predictions; new version only on meaningful change
  standings    hourly (and after each final whistle for that league)
  settle       every 5 min: safety net for any final match that wasn't settled

Run them in-process (RUN_SCHEDULER=true, dev) or in a separate worker:
`python -m app.cli worker` (production; run exactly one worker).
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta
from typing import Callable, Optional

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .cache import bump_data_version
from .config import Settings, get_settings
from .db import SessionLocal, utcnow
from .models import ExternalRef, JobRun, League, Match, Sport
from .providers.base import LeagueRef, ProviderError, SportsDataProvider
from .providers.registry import providers_for_leagues
from .services import predictions as pred_svc
from .services.settlement import settle_match
from .services.standings import refresh_standings
from .services.sync import MatchChange, Syncer

log = logging.getLogger("predictpro.jobs")


def active_leagues(db: Session) -> list[League]:
    return list(db.scalars(select(League).join(Sport).where(League.is_active.is_(True), Sport.is_active.is_(True)).order_by(League.id)))


def _league_map(db: Session) -> dict[str, League]:
    return {lg.slug: lg for lg in active_leagues(db)}


def process_changes(db: Session, changes: list[MatchChange], now: datetime) -> dict:
    settled = 0
    leagues_to_refresh: set[int] = set()
    for ch in sorted(changes, key=lambda c: (c.match.start_time, c.match.id)):
        m = ch.match
        # settle on the final whistle, on a corrected result, or if it was missed earlier
        if m.status in ("finished", "cancelled") and (m.settled_at is None or ch.became_final or ch.result_corrected):
            settle_match(db, m, now)
            settled += 1
            leagues_to_refresh.add(m.league_id)
    for lid in leagues_to_refresh:
        refresh_standings(db, db.get(League, lid))
    if any(ch.created or ch.changed for ch in changes):
        bump_data_version()
    return {"settled": settled, "tables": len(leagues_to_refresh)}


def sync_fixtures(db: Session, settings: Settings, now: Optional[datetime] = None, start: Optional[datetime] = None, end: Optional[datetime] = None, clock=None) -> dict:
    now = now or utcnow()
    start = start or now - timedelta(days=2)
    end = end or now + timedelta(days=settings.fixture_window_days)
    leagues = _league_map(db)
    changes: list[MatchChange] = []
    errors = []
    for prov, refs in providers_for_leagues(db, settings, list(leagues.values()), clock):
        syncer = Syncer(db, prov.name)
        for ref in refs:
            try:
                for pm in prov.fetch_fixtures(ref, start, end):
                    changes.append(syncer.match(leagues[ref.slug], pm))
            except ProviderError as exc:
                errors.append(f"{ref.slug}: {exc}")
                log.warning("fixtures %s failed: %s", ref.slug, exc)
        db.flush()
    stats = process_changes(db, changes, now)
    return {"matches": len(changes), "created": sum(c.created for c in changes), **stats, "errors": errors}


def matches_needing_live_poll(db: Session, now: datetime) -> list[Match]:
    return list(
        db.scalars(
            select(Match).where(
                or_(
                    Match.status == "live",
                    (Match.status == "scheduled") & (Match.start_time <= now + timedelta(minutes=2)) & (Match.start_time >= now - timedelta(hours=6)),
                )
            )
        )
    )


def sync_live(db: Session, settings: Settings, now: Optional[datetime] = None, clock=None) -> dict:
    now = now or utcnow()
    candidates = matches_needing_live_poll(db, now)
    if not candidates:
        return {"skipped": "no live matches"}  # no provider calls at all
    by_league: dict[int, list[Match]] = {}
    for m in candidates:
        by_league.setdefault(m.league_id, []).append(m)
    leagues = [db.get(League, lid) for lid in by_league]
    changes: list[MatchChange] = []
    for prov, refs in providers_for_leagues(db, settings, leagues, clock):
        slugs = {r.slug for r in refs}
        match_refs = [m.provider_ref for lg in leagues if lg.slug in slugs for m in by_league[lg.id] if m.provider == prov.name]
        try:
            updates = prov.fetch_live(refs, match_refs)
        except ProviderError as exc:
            log.warning("live poll via %s failed: %s", prov.name, exc)
            continue
        syncer = Syncer(db, prov.name)
        league_by_slug = {lg.slug: lg for lg in leagues}
        for pm in updates:
            lg = league_by_slug.get(pm.league_slug)
            if lg is not None:
                changes.append(syncer.match(lg, pm))
        db.flush()
    stats = process_changes(db, changes, now)
    return {"polled": len(candidates), "updated": sum(1 for c in changes if c.changed), **stats}


def sync_squads(db: Session, settings: Settings, now: Optional[datetime] = None, clock=None) -> dict:
    now = now or utcnow()
    leagues = active_leagues(db)
    changed_teams: set[int] = set()
    for prov, refs in providers_for_leagues(db, settings, leagues, clock):
        syncer = Syncer(db, prov.name)
        league_by_slug = {lg.slug: lg for lg in leagues}
        for ref in refs:
            lg = league_by_slug[ref.slug]
            upcoming = db.execute(
                select(Match.home_team_id, Match.away_team_id).where(Match.league_id == lg.id, Match.status == "scheduled", Match.start_time.between(now, now + timedelta(days=10)))
            ).all()
            team_ids = {t for row in upcoming for t in row}
            if not team_ids:
                continue
            ext = db.scalars(select(ExternalRef).where(ExternalRef.provider == prov.name, ExternalRef.entity == "team", ExternalRef.internal_id.in_(team_ids))).all()
            team_refs = [e.external_id.split(":", 1)[1] for e in ext]
            try:
                players = prov.fetch_squads(ref, team_refs)
            except ProviderError as exc:
                log.warning("squads %s failed: %s", ref.slug, exc)
                continue
            changed_teams |= syncer.players(lg.sport_id, players)
        db.flush()
    repredicted = 0
    if changed_teams:
        affected = db.scalars(
            select(Match).where(Match.status == "scheduled", Match.start_time > now, or_(Match.home_team_id.in_(changed_teams), Match.away_team_id.in_(changed_teams)))
        ).all()
        by_sport: dict[int, set[int]] = {}
        for m in affected:
            by_sport.setdefault(m.sport_id, set()).add(m.id)
        for sid, ids in by_sport.items():
            repredicted += pred_svc.run_predictions(db, db.get(Sport, sid), now, match_ids=ids).get("new_versions", 0)
        bump_data_version()
    return {"teams_changed": len(changed_teams), "repredicted": repredicted}


def run_all_predictions(db: Session, settings: Settings, now: Optional[datetime] = None) -> dict:
    now = now or utcnow()
    out = {}
    for sport in db.scalars(select(Sport).where(Sport.is_active.is_(True))):
        out[sport.slug] = pred_svc.run_predictions(db, sport, now)
    bump_data_version()
    return out


def refresh_all_standings(db: Session, settings: Settings) -> dict:
    n = 0
    for lg in active_leagues(db):
        n += refresh_standings(db, lg)
    return {"rows": n}


def settle_pending(db: Session, settings: Settings, now: Optional[datetime] = None) -> dict:
    now = now or utcnow()
    # kick-off order, so streaks/badges never see a later result before an earlier one
    todo = db.scalars(select(Match).where(Match.status.in_(("finished", "cancelled")), Match.settled_at.is_(None)).order_by(Match.start_time, Match.id)).all()
    for m in todo:
        settle_match(db, m, now)
    if todo:
        bump_data_version()
    return {"settled": len(todo)}


JOBS: dict[str, Callable[..., dict]] = {
    "fixtures": sync_fixtures,
    "live": sync_live,
    "squads": sync_squads,
    "predictions": run_all_predictions,
    "standings": refresh_all_standings,
    "settle": settle_pending,
}


def run_job(name: str, record: bool = True, **kwargs) -> dict:
    """Run one job in its own session/transaction, recording it in job_runs."""
    settings = get_settings()
    db = SessionLocal()
    run = None
    started = time.monotonic()
    try:
        if record and name != "live":
            run = JobRun(name=name, started_at=utcnow())
            db.add(run)
            db.flush()
        result = JOBS[name](db, settings, **kwargs)
        if run:
            run.status, run.finished_at, run.detail = "ok", utcnow(), {**result, "seconds": round(time.monotonic() - started, 2)}
        db.commit()
        return result
    except Exception as exc:
        db.rollback()
        log.exception("job %s failed", name)
        if record:
            with SessionLocal() as db2:
                db2.add(JobRun(name=name, status="error", finished_at=utcnow(), detail={"error": str(exc)[:500]}))
                db2.commit()
        raise
    finally:
        db.close()


def start_scheduler(settings: Optional[Settings] = None):
    from apscheduler.schedulers.background import BackgroundScheduler

    settings = settings or get_settings()
    sched = BackgroundScheduler(timezone="UTC", job_defaults={"coalesce": True, "max_instances": 1, "misfire_grace_time": 60})

    def safe(name: str):
        def _run():
            try:
                run_job(name)
            except Exception:  # already logged; keep the scheduler alive
                pass

        return _run

    now = datetime.now().astimezone()
    sched.add_job(safe("live"), "interval", seconds=settings.live_poll_seconds, id="live", next_run_time=now + timedelta(seconds=5))
    sched.add_job(safe("fixtures"), "interval", minutes=settings.fixtures_sync_minutes, id="fixtures", next_run_time=now + timedelta(seconds=20))
    sched.add_job(safe("squads"), "interval", minutes=settings.fixtures_sync_minutes, id="squads", next_run_time=now + timedelta(seconds=40))
    sched.add_job(safe("predictions"), "interval", minutes=settings.predictions_minutes, id="predictions", next_run_time=now + timedelta(seconds=60))
    sched.add_job(safe("standings"), "interval", hours=1, id="standings")
    sched.add_job(safe("settle"), "interval", minutes=5, id="settle")
    sched.start()
    log.info("scheduler started")
    return sched
