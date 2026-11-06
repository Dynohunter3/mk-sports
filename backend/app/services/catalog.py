"""Upsert sports, leagues and badges from catalog.json (or an admin API payload)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Badge, League, Sport

CATALOG_PATH = Path(__file__).resolve().parent.parent / "data" / "catalog.json"

SPORT_FIELDS = ("name", "color", "icon", "has_draws", "score_unit", "tier", "is_active", "sort_order", "model_params", "scoring_rules", "config")
LEAGUE_FIELDS = ("name", "short_name", "country", "region", "kind", "tier", "is_active", "is_featured", "sort_order", "model_params", "provider_refs", "config")


def load_catalog_file(path: Path = CATALOG_PATH) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def upsert_sport(db: Session, data: dict) -> Sport:
    sport = db.scalar(select(Sport).where(Sport.slug == data["slug"]))
    if sport is None:
        sport = Sport(slug=data["slug"], name=data["name"], color=data.get("color", "#64748B"), icon=data.get("icon", "trophy"))
        db.add(sport)
    for f in SPORT_FIELDS:
        if f in data:
            setattr(sport, f, data[f])
    return sport


def upsert_league(db: Session, data: dict) -> League:
    sport = db.scalar(select(Sport).where(Sport.slug == data["sport"]))
    if sport is None:
        raise ValueError(f"unknown sport '{data['sport']}' for league '{data['slug']}'")
    league = db.scalar(select(League).where(League.slug == data["slug"]))
    if league is None:
        league = League(slug=data["slug"], sport_id=sport.id, name=data["name"], short_name=data.get("short_name") or data["name"])
        db.add(league)
    league.sport_id = sport.id
    for f in LEAGUE_FIELDS:
        if f in data:
            setattr(league, f, data[f])
    return league


def apply_catalog(db: Session, catalog: dict[str, Any]) -> dict[str, int]:
    for s in catalog.get("sports", []):
        upsert_sport(db, s)
    db.flush()
    for lg in catalog.get("leagues", []):
        upsert_league(db, lg)
    for b in catalog.get("badges", []):
        badge = db.scalar(select(Badge).where(Badge.slug == b["slug"]))
        if badge is None:
            badge = Badge(slug=b["slug"])
            db.add(badge)
        badge.name, badge.description, badge.icon, badge.sort_order = b["name"], b["description"], b["icon"], b.get("sort_order", 100)
    db.flush()
    return {"sports": len(catalog.get("sports", [])), "leagues": len(catalog.get("leagues", [])), "badges": len(catalog.get("badges", []))}
