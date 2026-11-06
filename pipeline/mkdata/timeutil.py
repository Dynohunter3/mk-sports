"""Time handling: local kick-off -> UTC, and when each kind of information first existed."""

from __future__ import annotations

import re
from datetime import date, datetime, time as dtime, timedelta, timezone
from zoneinfo import ZoneInfo

UTC = timezone.utc
LONDON = ZoneInfo("Europe/London")

# How long after kick-off a final result can be assumed known (conservative, includes stoppage/extra time).
RESULT_LAG = {
    "football": timedelta(hours=2, minutes=30),
    "basketball": timedelta(hours=3, minutes=30),
    "american-football": timedelta(hours=4),
    "hockey": timedelta(hours=3, minutes=30),
    "baseball": timedelta(hours=4, minutes=30),
}


def to_epoch(dt: datetime) -> float:
    return dt.astimezone(UTC).timestamp()


def from_epoch(t: float) -> datetime:
    return datetime.fromtimestamp(t, UTC)


def parse_dmy(s: str) -> date:
    d, m, y = (int(x) for x in s.strip().split("/"))
    return date(2000 + y if y < 100 else y, m, d)


_UTC_SUFFIX = re.compile(r"^\s*(\d{1,2}):(\d{2})(?:\s*UTC\s*([+-]\d{1,2})(?::?(\d{2}))?)?\s*$")


def local_kickoff(d: date, hhmm: str | None, tz: str | None) -> tuple[float, bool]:
    """Return (UTC epoch, exact). With no usable time or zone, returns local noon UTC and exact=False."""
    if hhmm:
        m = _UTC_SUFFIX.match(hhmm)
        if m:
            hh, mm, off_h, off_m = m.groups()
            t = dtime(int(hh), int(mm))
            if off_h is not None:
                sign = -1 if off_h.startswith("-") else 1
                off = timedelta(hours=int(off_h), minutes=sign * int(off_m or 0))
                return to_epoch(datetime.combine(d, t, tzinfo=timezone(off))), True
            if tz:
                return to_epoch(datetime.combine(d, t, tzinfo=ZoneInfo(tz))), True
    return to_epoch(datetime.combine(d, dtime(12, 0), tzinfo=UTC)), False


def result_available_at(kickoff_utc: float, exact: bool, sport: str) -> float:
    """Earliest moment a final score existed. Date-only kick-offs assume the latest plausible start."""
    lag = RESULT_LAG.get(sport, timedelta(hours=4))
    if exact:
        return kickoff_utc + lag.total_seconds()
    day_end = from_epoch(kickoff_utc).replace(hour=0, minute=0, second=0) + timedelta(days=1, hours=12)
    return to_epoch(day_end)


def fd_preclosing_collected_at(kickoff_utc: float) -> float:
    """football-data.co.uk notes: pre-closing odds are collected on Friday afternoons for weekend games
    and Tuesday afternoons for midweek games. Use 17:00 UK on the most recent Tuesday/Friday that is
    strictly before kick-off (17:00 is a deliberately late reading of 'afternoon')."""
    k = from_epoch(kickoff_utc).astimezone(LONDON)
    d = k.date()
    for back in range(0, 8):
        day = d - timedelta(days=back)
        if day.weekday() in (1, 4):  # Tue, Fri
            t = datetime.combine(day, dtime(17, 0), tzinfo=LONDON)
            if t < k:
                return to_epoch(t)
    return kickoff_utc - 3 * 86400


def season_of(d: date, style: str) -> str:
    if style == "calendar":
        return str(d.year)
    start = d.year if d.month >= 7 else d.year - 1
    return f"{start}-{str(start + 1)[2:]}"


def split_season_code(season: str) -> str:
    """'2025-26' -> '2526' (football-data.co.uk folder name)."""
    a, b = season.split("-")
    return a[2:] + b
