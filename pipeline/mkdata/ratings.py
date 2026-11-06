"""Our own Elo, computed only from canonical results (second ratings source next to ClubElo).

One pool per sport, so international club competitions connect the leagues. Each rating is stored
with ``available_at`` = when the result that produced it was known, so it is point-in-time safe.
Step 3 tunes K, home advantage and league offsets; this is the transparent baseline.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone

from .store import Store

K = {"football": 20.0, "basketball": 20.0}
HFA = {"football": 60.0, "basketball": 100.0}


def goal_mult(diff: int) -> float:
    d = abs(diff)
    return 1.0 if d <= 1 else 1.5 if d == 2 else (11 + d) / 8


def compute(store: Store, sport: str, fetched_at: float) -> int:
    rows = store.q(
        """SELECT match_id, kickoff_utc, home_id, away_id, home_score, away_score, result_available_at
           FROM matches WHERE sport=? AND status='final' ORDER BY kickoff_utc, match_id""",
        sport,
    )
    elo: dict[str, float] = {}
    out = []
    k, hfa = K.get(sport, 20.0), HFA.get(sport, 50.0)
    for r in rows:
        h, a = elo.get(r["home_id"], 1500.0), elo.get(r["away_id"], 1500.0)
        exp = 1 / (1 + 10 ** (-(h + hfa - a) / 400))
        diff = r["home_score"] - r["away_score"]
        score = 1.0 if diff > 0 else 0.0 if diff < 0 else 0.5
        delta = k * (goal_mult(diff) if sport == "football" else 1.0) * (score - exp)
        elo[r["home_id"]], elo[r["away_id"]] = h + delta, a - delta
        day = datetime.fromtimestamp(r["kickoff_utc"], timezone.utc).date().isoformat()
        for t in (r["home_id"], r["away_id"]):
            out.append({"team_id": t, "source": "internal_elo", "as_of": day, "value": round(elo[t], 2),
                        "available_at": r["result_available_at"], "fetched_at": fetched_at})
    store.db.execute("DELETE FROM ratings WHERE source='internal_elo' AND team_id IN (SELECT id FROM entities WHERE sport=?)", (sport,))
    return store.add_ratings(out)


def expected_home(h: float, a: float, sport: str) -> float:
    return 1 / (1 + math.pow(10, -(h + HFA.get(sport, 50.0) - a) / 400))
