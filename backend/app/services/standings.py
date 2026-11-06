"""League tables, computed from our own results (provider tables are used when available)."""

from __future__ import annotations

from collections import defaultdict
from typing import Optional

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..db import utcnow
from ..models import League, Match, Season, Standing
from ..providers.base import ProviderStanding


def current_season(db: Session, league_id: int) -> Optional[Season]:
    return db.scalar(select(Season).where(Season.league_id == league_id).order_by(Season.is_current.desc(), Season.start_date.desc()).limit(1))


def compute_table(db: Session, league: League, season: Optional[Season]) -> list[dict]:
    q = select(Match).where(Match.league_id == league.id, Match.status == "finished", Match.home_score.is_not(None))
    if season is not None:
        q = q.where(Match.season_id == season.id)
    has_draws = league.sport.has_draws
    rows: dict[int, dict] = defaultdict(lambda: {"played": 0, "won": 0, "drawn": 0, "lost": 0, "pf": 0, "pa": 0, "form": []})
    for m in db.scalars(q.order_by(Match.start_time)):
        for tid, gf, ga in ((m.home_team_id, m.home_score, m.away_score), (m.away_team_id, m.away_score, m.home_score)):
            r = rows[tid]
            r["played"] += 1
            r["pf"] += gf
            r["pa"] += ga
            res = "W" if gf > ga else "L" if gf < ga else "D"
            r["won" if res == "W" else "lost" if res == "L" else "drawn"] += 1
            r["form"].append(res)
    out = []
    for tid, r in rows.items():
        pts = 3 * r["won"] + r["drawn"] if has_draws else r["won"]
        out.append({"team_id": tid, **r, "points": pts, "form": "".join(reversed(r["form"][-5:]))})
    if has_draws:
        out.sort(key=lambda r: (-r["points"], -(r["pf"] - r["pa"]), -r["pf"], r["team_id"]))
    else:
        out.sort(key=lambda r: (-(r["won"] / r["played"] if r["played"] else 0), -r["won"], -(r["pf"] - r["pa"]), r["team_id"]))
    for i, r in enumerate(out):
        r["position"] = i + 1
    return out


def refresh_standings(db: Session, league: League, provider_rows: Optional[list[tuple[int, ProviderStanding]]] = None) -> int:
    """Rewrite the league's current-season table. `provider_rows` = [(team_id, row)] if the
    provider supplies an official table; form is always derived from our own results."""
    season = current_season(db, league.id)
    computed = compute_table(db, league, season)
    form = {r["team_id"]: r["form"] for r in computed}
    if provider_rows:
        table = [
            {"team_id": tid, "position": r.position, "played": r.played, "won": r.won, "drawn": r.drawn, "lost": r.lost,
             "pf": r.points_for, "pa": r.points_against, "points": r.points, "form": form.get(tid, r.form)}
            for tid, r in provider_rows
        ]
    else:
        table = computed
    season_id = season.id if season else None
    db.execute(delete(Standing).where(Standing.league_id == league.id, Standing.season_id == season_id if season_id else Standing.season_id.is_(None)))
    now = utcnow()
    for r in table:
        db.add(Standing(league_id=league.id, season_id=season_id, team_id=r["team_id"], position=r["position"], played=r["played"], won=r["won"],
                        drawn=r["drawn"], lost=r["lost"], points_for=r["pf"], points_against=r["pa"], points=r["points"], form=r["form"], updated_at=now))
    db.flush()
    return len(table)
