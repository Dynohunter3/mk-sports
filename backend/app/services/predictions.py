"""Run the prediction engine against the database.

* Ratings are rebuilt by replaying every finished match for the sport (cheap at MVP scale;
  swap for incremental updates when history grows large) and saved to `team_ratings`.
* Every upcoming match within the horizon gets a prediction. A new *version* is stored only
  when something meaningful changed (probabilities moved >= 1 point, predicted score or
  confidence changed, or team news changed), so history stays readable.
* Predictions freeze at kick-off. After the result, the last pre-kick-off version is scored
  for the public accuracy tracker.
"""

from __future__ import annotations

import hashlib
import json
import logging
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional

from predictpro_engine import Absence, FinishedMatch, UnsupportedSport, get_model, walk_forward
from predictpro_engine.evaluation import brier as brier_score
from predictpro_engine.evaluation import is_correct, log_loss
from predictpro_engine.factors import form_string
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..db import utcnow
from ..models import League, Match, Player, Prediction, Sport, Team, TeamRating

log = logging.getLogger(__name__)

PROB_CHANGE = 0.01


def model_for(db: Session, sport: Sport):
    leagues = db.scalars(select(League).where(League.sport_id == sport.id)).all()
    return get_model(sport.slug, sport.model_params or {}, {lg.slug: lg.model_params for lg in leagues if lg.model_params})


def finished_history(db: Session, sport_id: int, before: Optional[datetime] = None) -> list[FinishedMatch]:
    q = (
        select(Match.id, Match.start_time, Match.home_team_id, Match.away_team_id, Match.home_score, Match.away_score, League.slug, Match.neutral)
        .join(League, League.id == Match.league_id)
        .where(Match.sport_id == sport_id, Match.status == "finished", Match.home_score.is_not(None))
        .order_by(Match.start_time, Match.id)
    )
    if before is not None:
        q = q.where(Match.start_time < before)
    return [FinishedMatch(str(r[0]), r[1], str(r[2]), str(r[3]), r[4], r[5], r[6], r[7]) for r in db.execute(q)]


def team_names(db: Session, sport_id: int) -> dict[str, str]:
    return {str(i): n for i, n in db.execute(select(Team.id, Team.short_name).where(Team.sport_id == sport_id))}


def absences(db: Session, team_ids: set[int]) -> dict[int, list[Absence]]:
    out: dict[int, list[Absence]] = defaultdict(list)
    if not team_ids:
        return out
    q = select(Player).where(Player.team_id.in_(team_ids), Player.status != "available").order_by(Player.importance.desc())
    for p in db.scalars(q):
        out[p.team_id].append(Absence(p.name, p.position, p.importance, p.status, p.tag))
    return out


def _hash(pred) -> str:
    payload = {
        "p": [round(pred.prob_home, 3), round(pred.prob_draw or 0, 3), round(pred.prob_away, 3)],
        "s": [pred.predicted_home, pred.predicted_away],
        "c": pred.confidence,
        "a": [pred.explanation["inputs"].get("absences_home"), pred.explanation["inputs"].get("absences_away")],
    }
    return hashlib.sha1(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def _meaningful(cur: Prediction, pred) -> tuple[bool, str]:
    inputs = cur.explanation.get("inputs", {})
    if inputs.get("absences_home") != pred.explanation["inputs"].get("absences_home") or inputs.get("absences_away") != pred.explanation["inputs"].get("absences_away"):
        return True, "team_news"
    moved = max(abs(cur.prob_home - pred.prob_home), abs((cur.prob_draw or 0) - (pred.prob_draw or 0)), abs(cur.prob_away - pred.prob_away))
    if moved >= PROB_CHANGE or (cur.predicted_home, cur.predicted_away) != (pred.predicted_home, pred.predicted_away) or cur.confidence != pred.confidence:
        return True, "scheduled"
    return False, ""


def _row(match_id: int, version: int, trigger: str, pred, created_at: datetime) -> Prediction:
    return Prediction(
        match_id=match_id,
        version=version,
        is_current=True,
        model_name=pred.model,
        model_version=pred.model_version,
        trigger=trigger,
        created_at=created_at,
        prob_home=pred.prob_home,
        prob_draw=pred.prob_draw,
        prob_away=pred.prob_away,
        predicted_home=pred.predicted_home,
        predicted_away=pred.predicted_away,
        expected_home=pred.expected_home,
        expected_away=pred.expected_away,
        confidence=pred.confidence,
        key_factors=[f.to_dict() for f in pred.key_factors],
        explanation=pred.explanation,
        input_hash=_hash(pred),
    )


def save_ratings(db: Session, sport: Sport, book) -> int:
    existing = {r.team_id: r for r in db.scalars(select(TeamRating).where(TeamRating.sport_id == sport.id))}
    now = utcnow()
    for key, elo in book.elo.items():
        tid = int(key)
        st = book.team_state(key)
        row = existing.get(tid) or TeamRating(team_id=tid, sport_id=sport.id)
        row.elo = round(elo, 2)
        row.attack = round(st.attack, 4) if sport.slug == "football" else None
        row.defence = round(st.defence, 4) if sport.slug == "football" else None
        row.points_for = round(st.points_for, 2) if st.points_for is not None else None
        row.points_against = round(st.points_against, 2) if st.points_against is not None else None
        row.games = st.games
        row.form = form_string(st.recent)
        row.updated_at = now
        if tid not in existing:
            db.add(row)
    return len(book.elo)


def run_predictions(
    db: Session,
    sport: Sport,
    now: Optional[datetime] = None,
    horizon_days: int = 10,
    match_ids: Optional[set[int]] = None,
    force_trigger: Optional[str] = None,
) -> dict:
    now = now or utcnow()
    try:
        model = model_for(db, sport)
    except UnsupportedSport:
        return {"sport": sport.slug, "skipped": "no model"}
    book = model.new_book()
    book.update_many(finished_history(db, sport.id))
    save_ratings(db, sport, book)
    names = team_names(db, sport.id)

    q = select(Match).where(Match.sport_id == sport.id, Match.status == "scheduled", Match.start_time > now, Match.start_time <= now + timedelta(days=horizon_days))
    if match_ids is not None:
        q = q.where(Match.id.in_(match_ids))
    upcoming = db.scalars(q.order_by(Match.start_time)).all()
    if not upcoming:
        return {"sport": sport.slug, "matches": 0, "new_versions": 0}
    team_ids = {m.home_team_id for m in upcoming} | {m.away_team_id for m in upcoming}
    abs_map = absences(db, team_ids)
    current = {p.match_id: p for p in db.scalars(select(Prediction).where(Prediction.match_id.in_([m.id for m in upcoming]), Prediction.is_current.is_(True)))}
    leagues = {lg.id: lg for lg in db.scalars(select(League).where(League.sport_id == sport.id))}
    created = 0
    for m in upcoming:
        inp = book.build_input(
            str(m.home_team_id), str(m.away_team_id), m.start_time, leagues[m.league_id].slug, m.neutral,
            abs_map.get(m.home_team_id, ()), abs_map.get(m.away_team_id, ()), names.get(str(m.home_team_id)), names.get(str(m.away_team_id)),
        )
        pred = model.predict(inp)
        cur = current.get(m.id)
        if cur is None:
            trigger = force_trigger or "initial"
        else:
            if cur.input_hash == _hash(pred) and not force_trigger:
                continue
            changed, trigger = _meaningful(cur, pred)
            if not changed and not force_trigger:
                continue
            trigger = force_trigger or trigger
            cur.is_current = False
        db.add(_row(m.id, (cur.version + 1) if cur else 1, trigger, pred, now))
        created += 1
    db.flush()
    return {"sport": sport.slug, "matches": len(upcoming), "new_versions": created}


BACKFILL_MIN_GAMES = 3  # cold-start predictions (no history yet) are training-only, not published


def backfill_predictions(db: Session, sport: Sport, min_games: int = BACKFILL_MIN_GAMES) -> int:
    """Walk-forward predictions for finished matches that have none (e.g. history loaded at
    seed time). Each is made only from results before that match - an honest backtest -
    and stored with trigger='backfill' so the accuracy tracker can separate it from live."""
    try:
        model = model_for(db, sport)
    except UnsupportedSport:
        return 0
    history = finished_history(db, sport.id)
    have = set(db.scalars(select(Prediction.match_id).join(Match).where(Match.sport_id == sport.id)))
    names = team_names(db, sport.id)
    rows: list[Prediction] = []

    def on_pred(fm: FinishedMatch, pred) -> None:
        mid = int(fm.id)
        inputs = pred.explanation.get("inputs", {})
        if min(inputs.get("games_home", 0), inputs.get("games_away", 0)) < min_games:
            return
        if mid not in have:
            rows.append(_row(mid, 1, "backfill", pred, fm.date - timedelta(hours=2)))

    walk_forward(model, history, on_pred, names)
    db.add_all(rows)
    db.flush()
    matches = {m.id: m for m in db.scalars(select(Match).where(Match.id.in_([p.match_id for p in rows])))} if rows else {}
    for p in rows:
        _score_prediction(p, matches[p.match_id])
    db.flush()
    return len(rows)


def _score_prediction(p: Prediction, m: Match) -> None:
    outcome = "home" if m.home_score > m.away_score else "away" if m.away_score > m.home_score else "draw"
    probs = {"home": p.prob_home, "away": p.prob_away}
    if p.prob_draw is not None:
        probs["draw"] = p.prob_draw
    elif outcome == "draw":
        return  # no-draw sport with a drawn result: nothing to score
    p.outcome_correct = is_correct(probs, outcome)
    p.brier = round(brier_score(probs, outcome), 5)
    p.log_loss = round(log_loss(probs, outcome), 5)
    p.evaluated_at = utcnow()


def evaluate_match(db: Session, match: Match) -> Optional[Prediction]:
    """Score the final pre-kick-off prediction of a finished match."""
    if match.status != "finished" or match.home_score is None:
        return None
    p = db.scalar(
        select(Prediction).where(Prediction.match_id == match.id, Prediction.created_at <= match.start_time).order_by(Prediction.version.desc()).limit(1)
    )
    if p is None:
        return None
    _score_prediction(p, match)
    return p


def current_prediction(db: Session, match_id: int) -> Optional[Prediction]:
    return db.scalar(select(Prediction).where(Prediction.match_id == match_id, Prediction.is_current.is_(True)))


def clear_current_flags(db: Session, match_id: int) -> None:
    db.execute(update(Prediction).where(Prediction.match_id == match_id).values(is_current=False))
