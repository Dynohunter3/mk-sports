"""Leaderboard periods: ISO weeks and game seasons."""

from __future__ import annotations

from datetime import datetime, timezone


def week_key(dt: datetime) -> str:
    """ISO week of the match, e.g. '2026-W45'. Weeks run Monday-Sunday (UTC)."""
    y, w, _ = dt.astimezone(timezone.utc).isocalendar()
    return f"{y}-W{w:02d}"


def season_key(dt: datetime, start_month: int = 7) -> str:
    """Game season, e.g. '2026-27' for anything from July 2026 to June 2027."""
    d = dt.astimezone(timezone.utc)
    y = d.year if d.month >= start_month else d.year - 1
    return f"{y}-{(y + 1) % 100:02d}"


def period_keys(dt: datetime, start_month: int = 7) -> dict[str, str]:
    return {"week": week_key(dt), "season": season_key(dt, start_month), "all": "all"}
