"""ORM -> API payloads. Batches queries so a page of N matches costs a constant number of
round trips (matches+teams, predictions, my picks), not N."""

from __future__ import annotations

from datetime import datetime
from typing import Iterable, Optional

from sqlalchemy import or_, select
from sqlalchemy.orm import Session, joinedload

from .db import utcnow
from .models import League, Match, MatchEvent, Player, Prediction, Sport, Standing, Team, TeamRating, User, UserPick
from .services.scoring import ScoringRules, is_locked


def team_mini(t: Team) -> dict:
    return {"id": t.id, "name": t.name, "short_name": t.short_name, "code": t.code, "color": t.color}


def sport_out(s: Sport) -> dict:
    return {
        "id": s.id, "slug": s.slug, "name": s.name, "color": s.color, "icon": s.icon, "has_draws": s.has_draws,
        "score_unit": s.score_unit, "tier": s.tier, "is_active": s.is_active,
        "scoring": ScoringRules.from_dict(s.scoring_rules).to_dict(), "phase": (s.config or {}).get("phase"),
    }


def league_out(lg: League, season: Optional[str] = None) -> dict:
    return {
        "id": lg.id, "slug": lg.slug, "sport": lg.sport.slug, "name": lg.name, "short_name": lg.short_name, "country": lg.country,
        "region": lg.region, "kind": lg.kind, "is_featured": lg.is_featured, "is_active": lg.is_active, "season": season,
    }


def prediction_mini(p: Optional[Prediction]) -> Optional[dict]:
    if p is None:
        return None
    probs = {"home": p.prob_home, "away": p.prob_away, **({"draw": p.prob_draw} if p.prob_draw is not None else {})}
    return {
        "home": round(p.prob_home, 3), "draw": round(p.prob_draw, 3) if p.prob_draw is not None else None, "away": round(p.prob_away, 3),
        "score": (p.predicted_home, p.predicted_away), "confidence": p.confidence, "pick": max(probs, key=probs.get),
    }


def my_pick(p: Optional[UserPick]) -> Optional[dict]:
    if p is None:
        return None
    return {"pick": p.pick, "home_score": p.home_score, "away_score": p.away_score, "status": p.status, "points": p.points}


def load_matches(db: Session, where: Iterable, order=None, limit: Optional[int] = None) -> list[Match]:
    q = select(Match).options(joinedload(Match.home_team), joinedload(Match.away_team), joinedload(Match.league), joinedload(Match.sport)).where(*where)
    q = q.order_by(*(order or (Match.start_time, Match.id)))
    if limit:
        q = q.limit(limit)
    return list(db.scalars(q).unique())


def current_predictions(db: Session, match_ids: list[int]) -> dict[int, Prediction]:
    """The prediction to show: the current one, or for started matches the last pre-kick-off one."""
    if not match_ids:
        return {}
    return {p.match_id: p for p in db.scalars(select(Prediction).where(Prediction.match_id.in_(match_ids), Prediction.is_current.is_(True)))}


def user_picks(db: Session, user: Optional[User], match_ids: list[int]) -> dict[int, UserPick]:
    if user is None or not match_ids:
        return {}
    return {p.match_id: p for p in db.scalars(select(UserPick).where(UserPick.user_id == user.id, UserPick.match_id.in_(match_ids)))}


def match_card(m: Match, pred: Optional[Prediction], pick: Optional[UserPick], now: Optional[datetime] = None) -> dict:
    now = now or utcnow()
    return {
        "id": m.id,
        "sport": m.sport.slug,
        "league": {"id": m.league.id, "slug": m.league.slug, "short_name": m.league.short_name},
        "start_time": m.start_time,
        "status": m.status,
        "clock": m.clock,
        "round": m.round,
        "home": team_mini(m.home_team),
        "away": team_mini(m.away_team),
        "home_score": m.home_score,
        "away_score": m.away_score,
        "prediction": prediction_mini(pred),
        "my_pick": my_pick(pick),
        "locked": is_locked(m.status, m.start_time, now),
    }


def match_cards(db: Session, matches: list[Match], user: Optional[User] = None) -> list[dict]:
    ids = [m.id for m in matches]
    preds = current_predictions(db, ids)
    picks = user_picks(db, user, ids)
    now = utcnow()
    return [match_card(m, preds.get(m.id), picks.get(m.id), now) for m in matches]


def attach_picks(db: Session, cards: list[dict], user: Optional[User]) -> list[dict]:
    """Add the viewer's picks to (possibly cached, shared) cards."""
    picks = user_picks(db, user, [c["id"] for c in cards])
    for c in cards:
        c["my_pick"] = my_pick(picks.get(c["id"]))
    return cards


def prediction_full(p: Prediction, versions: int) -> dict:
    probs = {"home": p.prob_home, "away": p.prob_away, **({"draw": p.prob_draw} if p.prob_draw is not None else {})}
    return {
        "version": p.version, "created_at": p.created_at, "trigger": p.trigger, "model": p.model_name, "model_version": p.model_version,
        "probabilities": {k: round(v, 4) for k, v in probs.items()}, "predicted_score": (p.predicted_home, p.predicted_away),
        "expected": (p.expected_home, p.expected_away), "confidence": p.confidence, "key_factors": p.key_factors,
        "explanation": p.explanation, "versions": versions, "correct": p.outcome_correct,
    }


def _form_games(db: Session, team_id: int, before: datetime, limit: int = 5, against: Optional[int] = None) -> list[dict]:
    where = [Match.status == "finished", Match.start_time < before, or_(Match.home_team_id == team_id, Match.away_team_id == team_id)]
    if against is not None:
        where.append(or_(Match.home_team_id == against, Match.away_team_id == against))
    out = []
    for m in load_matches(db, where, order=(Match.start_time.desc(),), limit=limit):
        home = m.home_team_id == team_id
        gf, ga = (m.home_score, m.away_score) if home else (m.away_score, m.home_score)
        opp = m.away_team if home else m.home_team
        out.append({
            "match_id": m.id, "date": m.start_time, "opponent": opp.short_name, "home": home,
            "score": f"{m.home_score}-{m.away_score}", "result": "W" if gf > ga else "L" if gf < ga else "D",
        })
    return out


def standings_rows(db: Session, league_id: int) -> list[dict]:
    rows = db.scalars(select(Standing).options(joinedload(Standing.team)).where(Standing.league_id == league_id).order_by(Standing.position)).all()
    return [
        {"position": r.position, "team": team_mini(r.team), "played": r.played, "won": r.won, "drawn": r.drawn, "lost": r.lost,
         "points_for": r.points_for, "points_against": r.points_against, "points": r.points, "form": r.form}
        for r in rows
    ]


def match_detail(db: Session, m: Match, user: Optional[User]) -> dict:
    card = match_cards(db, [m], user)[0]
    preds = db.scalars(select(Prediction).where(Prediction.match_id == m.id).order_by(Prediction.version.desc())).all()
    shown = next((p for p in preds if p.is_current), preds[0] if preds else None)
    events = db.scalars(select(MatchEvent).where(MatchEvent.match_id == m.id).order_by(MatchEvent.minute, MatchEvent.id)).all()
    injuries = {}
    for side, tid in (("home", m.home_team_id), ("away", m.away_team_id)):
        players = db.scalars(select(Player).where(Player.team_id == tid, Player.status != "available").order_by(Player.importance.desc())).all()
        injuries[side] = [{"player": p.name, "position": p.position, "status": p.status, "detail": p.status_detail, "importance": p.importance} for p in players]
    ratings = {}
    for side, tid in (("home", m.home_team_id), ("away", m.away_team_id)):
        r = db.get(TeamRating, tid)
        ratings[side] = None if r is None else {
            "elo": r.elo, "attack": r.attack, "defence": r.defence, "points_for": r.points_for, "points_against": r.points_against, "games": r.games, "form": r.form,
        }
    before = m.start_time if m.status == "scheduled" else m.start_time
    return {
        **card,
        "venue": m.venue,
        "neutral": m.neutral,
        "score_detail": m.score_detail or {},
        "events": [
            {"type": e.type, "minute": e.minute, "clock": e.clock, "side": "home" if e.team_id == m.home_team_id else "away", "player": e.player_name}
            for e in events
        ],
        "prediction_full": prediction_full(shown, len(preds)) if shown else None,
        "form": {"home": _form_games(db, m.home_team_id, before), "away": _form_games(db, m.away_team_id, before)},
        "head_to_head": _form_games(db, m.home_team_id, before, limit=5, against=m.away_team_id),
        "standings": standings_rows(db, m.league_id),
        "injuries": injuries,
        "ratings": ratings,
        "scoring": ScoringRules.from_dict(m.sport.scoring_rules).to_dict(),
        "has_draws": m.sport.has_draws,
        "score_unit": m.sport.score_unit,
    }
