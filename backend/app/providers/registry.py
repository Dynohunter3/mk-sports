"""Chooses the data provider for each league from configuration."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.orm import Session

from ..config import Settings
from ..models import AppState, League
from .base import LeagueRef, SportsDataProvider

log = logging.getLogger(__name__)
_singletons: dict[str, SportsDataProvider] = {}  # keep rate-limit buckets alive across job runs

MOCK_STATE_KEY = "mock_provider"


def monday(dt: datetime) -> datetime:
    d = dt.astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    return d - timedelta(days=d.weekday())


def mock_state(db: Session, settings: Settings, now: Optional[datetime] = None) -> AppState:
    """The mock world's anchor is fixed the first time it is used, so data stays consistent."""
    st = db.get(AppState, MOCK_STATE_KEY)
    if st is None:
        now = now or datetime.now(timezone.utc)
        anchor = monday(now - timedelta(weeks=settings.mock_history_weeks))
        st = AppState(key=MOCK_STATE_KEY, value={"anchor": anchor.isoformat(), "seed": settings.mock_seed, "overrides": {}})
        db.add(st)
        db.flush()
    return st


def build_provider(name: str, db: Session, settings: Settings, clock=None) -> Optional[SportsDataProvider]:
    if name == "mock":
        from .mock import MockProvider

        st = mock_state(db, settings).value
        kwargs = {"clock": clock} if clock else {}
        return MockProvider(datetime.fromisoformat(st["anchor"]), st.get("seed", settings.mock_seed), st.get("overrides") or {}, **kwargs)
    if name in _singletons:
        return _singletons[name]
    if name == "football_data":
        if not settings.football_data_api_key:
            log.warning("football_data selected but FOOTBALL_DATA_API_KEY is not set")
            return None
        from .football_data import FootballDataProvider

        prov: SportsDataProvider = FootballDataProvider(settings.football_data_api_key, settings.provider_requests_per_minute)
    elif name == "api_sports":
        if not settings.api_sports_key:
            log.warning("api_sports selected but API_SPORTS_KEY is not set")
            return None
        from .api_sports import ApiSportsProvider

        prov = ApiSportsProvider(settings.api_sports_key, settings.provider_requests_per_minute)
    else:
        log.warning("unknown provider %s", name)
        return None
    _singletons[name] = prov
    return prov


def league_ref(league: League, provider_name: str) -> Optional[LeagueRef]:
    ref = (league.provider_refs or {}).get(provider_name)
    if ref in (None, "", {}):
        return None
    return LeagueRef(sport=league.sport.slug, slug=league.slug, ref=ref, config=league.config or {})


def providers_for_leagues(db: Session, settings: Settings, leagues: list[League], clock=None) -> list[tuple[SportsDataProvider, list[LeagueRef]]]:
    """Group leagues by the provider configured for their sport (skipping unsupported ones)."""
    groups: dict[str, list[LeagueRef]] = {}
    for lg in leagues:
        name = settings.provider_for_sport(lg.sport.slug)
        ref = league_ref(lg, name)
        if ref is not None:
            groups.setdefault(name, []).append(ref)
    out = []
    for name, refs in groups.items():
        prov = build_provider(name, db, settings, clock)
        if prov is not None:
            out.append((prov, [r for r in refs if prov.supports(r)]))
    return out
