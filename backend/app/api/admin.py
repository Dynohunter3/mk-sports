"""Operator endpoints (X-Admin-Token header). Add competitions without code changes."""

from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import require_admin
from ..cache import bump_data_version
from ..db import get_db
from ..jobs import JOBS, run_job
from ..models import JobRun
from ..services.catalog import apply_catalog

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


@router.post("/jobs/{name}", summary="Run a background job now")
def trigger_job(name: str):
    if name not in JOBS:
        raise HTTPException(404, f"Unknown job; choose one of {sorted(JOBS)}")
    return run_job(name)


@router.get("/jobs", summary="Recent job runs")
def recent_jobs(db: Session = Depends(get_db)):
    rows = db.scalars(select(JobRun).order_by(JobRun.id.desc()).limit(50)).all()
    return [{"name": r.name, "status": r.status, "started_at": r.started_at, "finished_at": r.finished_at, "detail": r.detail} for r in rows]


@router.post("/catalog", summary="Upsert sports/leagues/badges (same shape as data/catalog.json)")
def upsert_catalog(payload: dict = Body(..., examples=[{"leagues": [{"slug": "zambia-super-league", "sport": "football", "name": "Zambia Super League", "provider_refs": {"api_sports": {"league": 0}}}]}]), db: Session = Depends(get_db)):
    try:
        result = apply_catalog(db, payload)
    except (KeyError, ValueError) as exc:
        db.rollback()
        raise HTTPException(422, str(exc))
    db.commit()
    bump_data_version()
    return result
