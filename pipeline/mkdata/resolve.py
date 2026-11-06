"""Written rules for when sources disagree. Every disagreement is logged; large ones are flagged.

Field rules (applied per canonical match):
  status   R1 the most advanced status wins (final > live > postponed > scheduled), because a
              'scheduled' row for a match that kicked off hours ago is stale, not a disagreement.
  score    R2 among sources reporting it final, the most reliable source wins (priority below);
              any other final score that differs is a MAJOR conflict (flagged + alert).
  kickoff  R3 exact times beat date-only; among exact times the most reliable source wins.
              Exact times > 15 min apart: MINOR up to 3 h, MAJOR beyond (likely rescheduled).
              Dates more than 1 day apart: MAJOR.
  odds     R4 consensus = Pinnacle if present, else the market average, else the median of
              bookmakers (after removing the margin). P(home) spread > 8 points across
              sources/bookmakers: MAJOR.
Reliability = order below, then the registry prior; a tie goes to the fresher fetch.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass

from .sources import REGISTRY

PRIORITY = {
    "score": ["football_data_org", "footballdata_uk", "balldontlie", "openfootball", "the_odds_api"],
    "kickoff": ["football_data_org", "the_odds_api", "balldontlie", "footballdata_uk", "openfootball"],
}
STATUS_RANK = {"final": 3, "live": 2, "postponed": 1, "scheduled": 0}
KICKOFF_MINOR_S = 15 * 60
KICKOFF_MAJOR_S = 3 * 3600
ODDS_MAJOR_SPREAD = 0.08


def _rank(field: str, source: str) -> tuple[int, float]:
    order = PRIORITY.get(field, [])
    return (order.index(source) if source in order else len(order), -REGISTRY[source].reliability if source in REGISTRY else 0.0)


@dataclass
class Decision:
    field: str
    value: object
    source: str
    severity: str | None  # None = all agree, 'minor', 'major'
    rule: str
    candidates: dict


def pick_status(rows: list[dict]) -> Decision:
    best = max(rows, key=lambda r: (STATUS_RANK.get(r["status"], 0), -_rank("score", r["source"])[0], r["fetched_at"]))
    vals = {r["source"]: r["status"] for r in rows}
    sev = None
    if len(set(vals.values())) > 1:
        # 'scheduled' vs 'final' after kick-off is staleness (minor); final vs postponed is a real clash
        sev = "major" if {"final", "postponed"} <= set(vals.values()) else "minor"
    return Decision("status", best["status"], best["source"], sev, "R1 most advanced status", vals)


def pick_score(rows: list[dict]) -> Decision | None:
    finals = [r for r in rows if r["status"] == "final" and r["home_score"] is not None]
    if not finals:
        return None
    finals.sort(key=lambda r: (_rank("score", r["source"]), -r["fetched_at"]))
    best = finals[0]
    vals = {r["source"]: [r["home_score"], r["away_score"]] for r in finals}
    sev = "major" if len({tuple(v) for v in vals.values()}) > 1 else None
    return Decision("score", [best["home_score"], best["away_score"]], best["source"], sev, "R2 most reliable final score", vals)


def pick_kickoff(rows: list[dict]) -> Decision:
    exact = [r for r in rows if r["kickoff_exact"]]
    pool = exact or rows
    pool = sorted(pool, key=lambda r: (_rank("kickoff", r["source"]), -r["fetched_at"]))
    best = pool[0]
    vals = {r["source"]: r["kickoff_utc"] for r in rows}
    sev = None
    exact_vals = [r["kickoff_utc"] for r in exact]
    if len(exact_vals) > 1:
        spread = max(exact_vals) - min(exact_vals)
        if spread > KICKOFF_MAJOR_S:
            sev = "major"
        elif spread > KICKOFF_MINOR_S:
            sev = "minor"
    dates = sorted({r["local_date"] for r in rows})
    if len(dates) > 1:
        from datetime import date

        if (date.fromisoformat(dates[-1]) - date.fromisoformat(dates[0])).days > 1:
            sev = "major"
    return Decision("kickoff", best["kickoff_utc"], best["source"], sev, "R3 exact time from most reliable source", vals)


def devig(h: float, d: float | None, a: float) -> tuple[float, float, float]:
    inv = [1 / h, (1 / d) if d else 0.0, 1 / a]
    s = sum(inv)
    return inv[0] / s, inv[1] / s, inv[2] / s


def consensus_odds(rows: list[dict]) -> tuple[tuple[float, float, float], str, str | None, float]:
    """rows: odds rows of one kind for one match. Returns (probs, basis, severity, spread)."""
    probs = {(r["source"], r["bookmaker"]): devig(r["home"], r["draw"], r["away"]) for r in rows}
    if not probs:
        raise ValueError("no odds")
    pin = [p for (s, b), p in probs.items() if b == "pinnacle"]
    avg = [p for (s, b), p in probs.items() if b == "market_avg"]
    if pin:
        p, basis = pin[0], "pinnacle"
    elif avg:
        p, basis = avg[0], "market_avg"
    else:
        cols = list(zip(*probs.values()))
        med = [statistics.median(c) for c in cols]
        s = sum(med)
        p, basis = (med[0] / s, med[1] / s, med[2] / s), "median"
    homes = [v[0] for (s, b), v in probs.items() if b != "market_max"]
    spread = (max(homes) - min(homes)) if homes else 0.0
    return p, basis, ("major" if spread > ODDS_MAJOR_SPREAD else None), spread
