"""Row validation before anything is stored. Rows that fail are quarantined (not stored) and counted
in a data-quality alert, so one source's bad file cannot corrupt the canonical data."""

from __future__ import annotations

from collections import Counter
from datetime import date, timedelta


def season_window(season: str, style: str) -> tuple[date, date]:
    if style == "calendar":
        y = int(season)
        return date(y, 1, 1), date(y, 12, 31)
    y = int(season[:4])
    return date(y, 6, 1), date(y + 1, 7, 31)


def problems(row: dict, comps: dict[str, dict]) -> str | None:
    comp = comps.get(row["competition_id"])
    if comp is None:
        return "unknown competition"
    d = date.fromisoformat(row["local_date"])
    lo, hi = season_window(row["season"], comp["seasons"])
    if not (lo - timedelta(days=1) <= d <= hi + timedelta(days=1)):
        return f"date outside season {row['season']}"
    if row["home_raw"] == row["away_raw"]:
        return "same team on both sides"
    if row["status"] == "final":
        if row["home_score"] is None or row["away_score"] is None or min(row["home_score"], row["away_score"]) < 0:
            return "final without a valid score"
        if comp["sport"] == "football" and max(row["home_score"], row["away_score"]) > 15:
            return "implausible football score"
    return None


def split(rows: list[dict], comps: dict[str, dict]) -> tuple[list[dict], Counter]:
    good, bad = [], Counter()
    for r in rows:
        p = problems(r, comps)
        if p:
            bad[(r["source"], r["competition_id"], r["season"], p)] += 1
        else:
            good.append(r)
    return good, bad
