"""Load canonical football data from the mkdata store in kick-off order, with point-in-time fields."""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from mkdata.resolve import devig

STORE = Path(__file__).resolve().parents[1] / "var" / "mkdata.sqlite"
APP_LEAGUES = ["eng.1", "eng.2", "esp.1", "ita.1", "ger.1", "fra.1", "ned.1", "por.1", "tur.1", "usa.1", "uefa.champions"]
LOWER = ["eng.3", "eng.4"]
DAY = 86400.0
# Same evaluation windows as Step 1 ([from, to) UTC)
EU = (datetime(2024, 7, 1, tzinfo=timezone.utc).timestamp(), datetime(2026, 7, 1, tzinfo=timezone.utc).timestamp())
EVAL = {c: EU for c in APP_LEAGUES if c != "usa.1"}
EVAL["usa.1"] = (datetime(2024, 2, 1, tzinfo=timezone.utc).timestamp(), datetime(2026, 1, 1, tzinfo=timezone.utc).timestamp())


@dataclass
class M:
    id: str
    comp: str
    season: str
    t: float  # kick-off UTC
    h: str
    a: str
    hs: int | None
    as_: int | None
    result_at: float | None
    agreement: float
    stats: dict = field(default_factory=dict)  # side -> {shots, shots_on_target, ...}, available after result_at
    pre: tuple | None = None  # de-vigged pre-closing market probs (available before kick-off)
    pre_at: float | None = None
    close: tuple | None = None  # de-vigged closing probs: benchmark only, never a feature
    close_src: str | None = None

    @property
    def outcome(self) -> int | None:
        if self.hs is None:
            return None
        return 0 if self.hs > self.as_ else 1 if self.hs == self.as_ else 2


def load(path: Path = STORE, comps: list[str] | None = None) -> list[M]:
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    comps = comps or APP_LEAGUES + LOWER
    marks = ",".join("?" * len(comps))
    out: dict[str, M] = {}
    for r in db.execute(
        f"""SELECT match_id, competition_id, season, kickoff_utc, home_id, away_id, home_score, away_score, status,
                   result_available_at, agreement FROM matches WHERE sport='football' AND competition_id IN ({marks})
            ORDER BY kickoff_utc, match_id""", comps):
        final = r["status"] == "final"
        out[r["match_id"]] = M(r["match_id"], r["competition_id"], r["season"], r["kickoff_utc"], r["home_id"], r["away_id"],
                               r["home_score"] if final else None, r["away_score"] if final else None,
                               r["result_available_at"] if final else None, r["agreement"])
    for r in db.execute("""SELECT sm.match_id, t.side, t.stats, t.available_at FROM team_stats t JOIN source_matches sm ON sm.mkey=t.match_key
                           WHERE sm.match_id IS NOT NULL"""):
        m = out.get(r["match_id"])
        if m:
            m.stats[r["side"]] = json.loads(r["stats"])
    best: dict[tuple, tuple] = {}
    rank = {"pinnacle": 0, "market_avg": 1, "bet365": 2}
    for r in db.execute("""SELECT sm.match_id, o.bookmaker, o.kind, o.home, o.draw, o.away, o.available_at FROM odds o
                           JOIN source_matches sm ON sm.mkey=o.match_key WHERE sm.match_id IS NOT NULL AND o.kind IN ('pre','closing')
                           AND o.bookmaker IN ('pinnacle','market_avg','bet365') AND o.draw IS NOT NULL"""):
        k = (r["match_id"], r["kind"])
        cand = (rank[r["bookmaker"]], devig(r["home"], r["draw"], r["away"]), r["available_at"], r["bookmaker"])
        if k not in best or cand[0] < best[k][0]:
            best[k] = cand
    for (mid, kind), (_, p, at, book) in best.items():
        m = out.get(mid)
        if not m:
            continue
        if kind == "pre" and at < m.t:
            m.pre, m.pre_at = p, at
        elif kind == "closing":
            m.close, m.close_src = p, book
    return sorted(out.values(), key=lambda m: (m.t, m.id))


def in_eval(m: M) -> bool:
    w = EVAL.get(m.comp)
    return bool(w) and w[0] <= m.t < w[1] and m.outcome is not None
