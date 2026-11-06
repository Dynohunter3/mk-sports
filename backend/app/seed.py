"""Seed a fully working demo from the mock provider (no API keys needed).

1. catalog (sports, leagues, badges)
2. fixtures + results from the mock world since its anchor, plus the next 14 days
3. squads/injuries, league tables
4. walk-forward "backfill" predictions for played matches (scored for the accuracy page)
   and live predictions for upcoming ones
5. ~30 demo players with pick histories (so leaderboards have life), plus a demo account:
   demo@predictpro.app / demo1234
6. optionally move a few kick-offs to "now" so live scores and pick-locking can be seen
"""

from __future__ import annotations

import logging
import random
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import hash_password
from .config import Settings
from .db import utcnow
from .jobs import run_all_predictions, settle_pending, sync_fixtures, sync_live, sync_squads
from .models import AppState, League, Match, Prediction, Sport, Team, User, UserFavourite, UserPick
from .providers.registry import MOCK_STATE_KEY, mock_state
from .services import predictions as pred_svc
from .services.catalog import apply_catalog, load_catalog_file
from .services.periods import season_key, week_key
from .services.standings import refresh_standings

log = logging.getLogger("predictpro.seed")

DEMO_PLAYERS = [
    ("Chanda M.", "ZM"), ("Thandiwe N.", "ZA"), ("Kwame A.", "GH"), ("Lucía G.", "ES"), ("Marco R.", "IT"), ("Aisha B.", "NG"),
    ("Tomás F.", "PT"), ("Priya S.", "IN"), ("Mwila K.", "ZM"), ("Jonas H.", "DE"), ("Fatima Z.", "MA"), ("Diego P.", "AR"),
    ("Sipho D.", "ZA"), ("Hannah W.", "GB"), ("Kenji T.", "JP"), ("Amara O.", "NG"), ("Luca B.", "IT"), ("Grace W.", "KE"),
    ("Youssef E.", "EG"), ("Nia M.", "KE"), ("Oliver S.", "GB"), ("Bwalya C.", "ZM"), ("Sofia L.", "FR"), ("Emeka U.", "NG"),
    ("Ingrid J.", "NO"), ("Rafael C.", "BR"), ("Zanele K.", "ZA"), ("Ahmed H.", "EG"), ("Chloé D.", "FR"), ("Musonda P.", "ZM"),
]


def _probs(p: Prediction) -> dict[str, float]:
    return {"home": p.prob_home, "away": p.prob_away, **({"draw": p.prob_draw} if p.prob_draw is not None else {})}


def make_pick(rng: random.Random, skill: float, p: Optional[Prediction], has_draws: bool, sport: str) -> tuple[str, Optional[int], Optional[int]]:
    """A plausible human pick: skilled players follow the model more often."""
    options = ["home", "draw", "away"] if has_draws else ["home", "away"]
    if p is not None and rng.random() < skill:
        probs = _probs(p)
        outcome = max(probs, key=probs.get)
    elif p is not None:
        probs = _probs(p)
        outcome = rng.choices(options, [probs[o] + 0.15 for o in options])[0]
    else:
        outcome = rng.choice(options)
    if rng.random() > 0.65:
        return outcome, None, None
    if sport == "football":
        for _ in range(20):
            h, a = rng.choice([0, 1, 1, 1, 2, 2, 2, 3, 3, 4]), rng.choice([0, 0, 1, 1, 1, 2, 2, 3])
            if ("home" if h > a else "away" if a > h else "draw") == outcome:
                return outcome, h, a
        return outcome, None, None
    base_h, base_a = (p.predicted_home, p.predicted_away) if p is not None else (110, 106)
    for _ in range(20):
        h, a = base_h + rng.randint(-12, 12), base_a + rng.randint(-12, 12)
        if (h > a) == (outcome == "home") and h != a:
            return outcome, h, a
    return outcome, None, None


def seed_users(db: Session, settings: Settings, now: datetime, rng: random.Random) -> list[User]:
    users = []
    pwd = hash_password("demo1234")
    for i, (name, country) in enumerate(DEMO_PLAYERS):
        email = f"player{i + 1}@demo.predictpro.app"
        u = db.scalar(select(User).where(User.email == email))
        if u is None:
            u = User(auth_provider="dev", auth_subject=email, email=email, password_hash=pwd, display_name=name, country=country, is_demo=True,
                     terms_accepted_at=now, privacy_accepted_at=now, onboarded_at=now, created_at=now - timedelta(days=rng.randint(30, 120)))
            db.add(u)
        users.append(u)
    demo = db.scalar(select(User).where(User.email == "demo@predictpro.app"))
    if demo is None:
        demo = User(auth_provider="dev", auth_subject="demo@predictpro.app", email="demo@predictpro.app", password_hash=pwd, display_name="You (Demo)",
                    country="ZM", is_demo=True, terms_accepted_at=now, privacy_accepted_at=now, onboarded_at=now, created_at=now - timedelta(days=60))
        db.add(demo)
    db.flush()
    sports = {s.slug: s for s in db.scalars(select(Sport))}
    leagues = {lg.slug: lg for lg in db.scalars(select(League))}
    if not db.scalar(select(UserFavourite).where(UserFavourite.user_id == demo.id)):
        favs = [("sport", sports["football"].id), ("sport", sports["basketball"].id)]
        favs += [("league", leagues[s].id) for s in ("premier-league", "champions-league", "zambia-super-league", "nba") if s in leagues]
        for name in ("Arsenal", "Power Dynamos", "Boston Celtics"):
            t = db.scalar(select(Team).where(Team.name == name))
            if t:
                favs.append(("team", t.id))
        for kind, ref in favs:
            db.add(UserFavourite(user_id=demo.id, kind=kind, ref_id=ref))
    return users + [demo]


def seed_picks(db: Session, settings: Settings, users: list[User], now: datetime, rng: random.Random) -> int:
    window_start = now - timedelta(days=28)
    matches = db.scalars(select(Match).where(Match.start_time >= window_start, Match.start_time <= now + timedelta(days=5), Match.status.in_(("scheduled", "finished")))).all()
    preds = {p.match_id: p for p in db.scalars(select(Prediction).where(Prediction.match_id.in_([m.id for m in matches]), Prediction.is_current.is_(True)))}
    sports = {s.id: s for s in db.scalars(select(Sport))}
    existing = {(u, m) for u, m in db.execute(select(UserPick.user_id, UserPick.match_id))}
    n = 0
    for idx, u in enumerate(users):
        urng = random.Random(f"{settings.mock_seed}-{u.email}")
        skill = 0.35 + 0.5 * urng.random()
        activity = 0.04 + 0.12 * urng.random() if not u.email.startswith("demo@") else 0.10
        for m in matches:
            if (u.id, m.id) in existing or urng.random() > activity:
                continue
            sport = sports[m.sport_id]
            pick, h, a = make_pick(urng, skill, preds.get(m.id), sport.has_draws, sport.slug)
            made = min(m.start_time - timedelta(minutes=urng.randint(10, 48 * 60)), now)
            db.add(UserPick(user_id=u.id, match_id=m.id, pick=pick, home_score=h, away_score=a, created_at=made, updated_at=made,
                            week_key=week_key(m.start_time), season_key=season_key(m.start_time, settings.season_start_month)))
            n += 1
    db.flush()
    return n


def demo_live(db: Session, settings: Settings, now: Optional[datetime] = None, clock=None) -> list[int]:
    """Move a few upcoming mock fixtures so they are in progress (or about to start) now."""
    now = now or utcnow()
    st = mock_state(db, settings, now)
    overrides = dict(st.value.get("overrides") or {})
    plan = {"football": [-80, -30, 6, 25], "basketball": [-45, 12]}  # minutes relative to now
    moved = []
    for slug, offsets in plan.items():
        sport = db.scalar(select(Sport).where(Sport.slug == slug))
        if sport is None:
            continue
        candidates = db.scalars(
            select(Match).join(League).where(Match.sport_id == sport.id, Match.status == "scheduled", Match.provider == "mock",
                                             Match.start_time > now + timedelta(hours=1), Match.start_time < now + timedelta(days=7), League.is_featured.is_(True))
            .order_by(Match.start_time).limit(len(offsets))
        ).all()
        for m, off in zip(candidates, offsets):
            new_time = (now + timedelta(minutes=off)).replace(second=0, microsecond=0)
            overrides[m.provider_ref] = new_time.isoformat()
            m.start_time = new_time
            for p in db.scalars(select(UserPick).where(UserPick.match_id == m.id)):  # picks follow the new kick-off week
                p.week_key, p.season_key = week_key(new_time), season_key(new_time, settings.season_start_month)
            moved.append(m.id)
    st.value = {**st.value, "overrides": overrides}
    db.flush()
    sync_live(db, settings, now, clock)
    return moved


def seed_all(db: Session, settings: Settings, users: bool = True, live: bool = True, now: Optional[datetime] = None, clock=None) -> dict:
    now = now or utcnow()
    rng = random.Random(settings.mock_seed)
    report: dict = {"catalog": apply_catalog(db, load_catalog_file())}
    st = mock_state(db, settings, now)
    anchor = datetime.fromisoformat(st.value["anchor"])
    report["fixtures"] = sync_fixtures(db, settings, now, start=anchor, end=now + timedelta(days=settings.fixture_window_days), clock=clock)
    report["squads"] = sync_squads(db, settings, now, clock)
    report["backfill"] = {s.slug: pred_svc.backfill_predictions(db, s) for s in db.scalars(select(Sport).where(Sport.is_active.is_(True)))}
    report["predictions"] = run_all_predictions(db, settings, now)
    if users:
        people = seed_users(db, settings, now, rng)
        report["picks"] = seed_picks(db, settings, people, now, rng)
        # re-settle everything so the demo picks score
        for m in db.scalars(select(Match).where(Match.status.in_(("finished", "cancelled")))):
            m.settled_at = None
        report["settled"] = settle_pending(db, settings, now)
    for lg in db.scalars(select(League).where(League.is_active.is_(True))):
        refresh_standings(db, lg)
    if live:
        report["demo_live"] = demo_live(db, settings, now, clock)
    db.flush()
    return report


def reset_mock_state(db: Session) -> None:
    st = db.get(AppState, MOCK_STATE_KEY)
    if st is not None:
        db.delete(st)
