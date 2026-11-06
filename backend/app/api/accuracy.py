"""Public model accuracy tracker, updated automatically as results come in."""

from __future__ import annotations

from collections import defaultdict
from typing import Literal, Optional

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..cache import cached, data_version
from ..db import get_db, utcnow
from ..models import League, Match, Prediction, Sport, Team
from ..schemas import AccuracyOut

router = APIRouter(tags=["accuracy"])


def _row(key: str, name: str, sport: str, items: list[tuple]) -> dict:
    n = len(items)
    correct = sum(1 for it in items if it[0])
    conf: dict[str, list] = defaultdict(list)
    for it in items:
        conf[it[3]].append(it[0])
    return {
        "key": key, "name": name, "sport": sport, "n": n, "correct": correct,
        "hit_rate": round(correct / n, 4) if n else None,
        "brier": round(sum(it[1] for it in items) / n, 4) if n else None,
        "log_loss": round(sum(it[2] for it in items) / n, 4) if n else None,
        "by_confidence": {c: {"n": len(v), "hit_rate": round(sum(v) / len(v), 4)} for c, v in conf.items()},
    }


def compute_accuracy(db: Session, source: str, sport: Optional[str]) -> dict:
    q = (
        select(Prediction.outcome_correct, Prediction.brier, Prediction.log_loss, Prediction.confidence, Prediction.trigger, League.slug, League.name, Sport.slug, Match.id, Match.start_time)
        .join(Match, Match.id == Prediction.match_id)
        .join(League, League.id == Match.league_id)
        .join(Sport, Sport.id == Match.sport_id)
        .where(Prediction.outcome_correct.is_not(None))
    )
    if source == "live":
        q = q.where(Prediction.trigger != "backfill")
    elif source == "backtest":
        q = q.where(Prediction.trigger == "backfill")
    if sport:
        q = q.where(Sport.slug == sport)
    rows = db.execute(q).all()
    by_sport, by_league, names = defaultdict(list), defaultdict(list), {}
    for r in rows:
        item = (bool(r[0]), r[1], r[2], r[3])
        by_sport[r[7]].append(item)
        by_league[(r[5], r[7])].append(item)
        names[r[5]] = r[6]
    sport_names = {s.slug: s.name for s in db.scalars(select(Sport))}
    recent_q = (
        select(Match, Prediction).join(Prediction, Prediction.match_id == Match.id).where(Prediction.outcome_correct.is_not(None))
        .order_by(Match.start_time.desc()).limit(10)
    )
    if source == "live":
        recent_q = recent_q.where(Prediction.trigger != "backfill")
    recent = []
    teams = {}
    for m, p in db.execute(recent_q).all():
        for tid in (m.home_team_id, m.away_team_id):
            if tid not in teams:
                teams[tid] = db.get(Team, tid).short_name
        probs = {"home": p.prob_home, "away": p.prob_away, **({"draw": p.prob_draw} if p.prob_draw is not None else {})}
        recent.append({
            "match_id": m.id, "home": teams[m.home_team_id], "away": teams[m.away_team_id], "score": f"{m.home_score}-{m.away_score}",
            "predicted": max(probs, key=probs.get), "probability": round(max(probs.values()), 3), "correct": p.outcome_correct, "confidence": p.confidence,
        })
    return {
        "source": source,
        "updated_at": utcnow(),
        "overall": _row("all", "All sports", "all", [it for v in by_sport.values() for it in v]),
        "sports": sorted((_row(s, sport_names.get(s, s), s, v) for s, v in by_sport.items()), key=lambda r: -r["n"]),
        "leagues": sorted((_row(lg, names[lg], s, v) for (lg, s), v in by_league.items()), key=lambda r: (r["sport"], -r["n"])),
        "recent": recent,
        "baseline_note": "Hit rate = share of matches where the model's most likely outcome happened. Football has three outcomes, so "
        "always picking the home side typically scores ~45%. Brier score and log loss measure probability quality (lower is better).",
    }


@router.get("/accuracy", response_model=AccuracyOut, summary="Public model hit rate by sport and league")
def accuracy(source: Literal["all", "live", "backtest"] = "all", sport: Optional[str] = None, db: Session = Depends(get_db)):
    """`live` = predictions published before kick-off; `backtest` = walk-forward predictions for
    matches that were already played when history was imported (labelled, never mixed silently)."""
    return cached(f"accuracy:{source}:{sport}:{data_version()}", 300, lambda: compute_accuracy(db, source, sport))
