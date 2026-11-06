"""Flat numeric features for the Phase 3 gradient-boosted model.

The baseline models and the future ML model read the same `MatchInput`, so training
data can be generated with `walk_forward` over history (no look-ahead leakage).
"""

from __future__ import annotations

from .types import MatchInput


def _form_points(records, n: int = 5) -> float:
    last = records[:n]
    if not last:
        return 0.0
    return sum(3 if r.result == "W" else 1 if r.result == "D" else 0 for r in last) / (3 * len(last))


def match_features(inp: MatchInput) -> dict[str, float]:
    h, a = inp.home, inp.away
    rest = lambda t: ((inp.kickoff - t.last_played).total_seconds() / 86400) if t.last_played else 7.0  # noqa: E731
    h2h_home_wins = sum(
        1 for m in inp.h2h if (m.home == h.team and m.home_score > m.away_score) or (m.away == h.team and m.away_score > m.home_score)
    )
    return {
        "elo_diff": float(h.elo - a.elo),
        "neutral": 1.0 if inp.neutral else 0.0,
        "attack_home": float(h.attack),
        "attack_away": float(a.attack),
        "defence_home": float(h.defence),
        "defence_away": float(a.defence),
        "net_home": float(h.net),
        "net_away": float(a.net),
        "form_home": float(_form_points(h.recent)),
        "form_away": float(_form_points(a.recent)),
        "rest_days_home": float(min(rest(h), 14.0)),
        "rest_days_away": float(min(rest(a), 14.0)),
        "absence_weight_home": float(sum(x.weight for x in inp.home_absences)),
        "absence_weight_away": float(sum(x.weight for x in inp.away_absences)),
        "h2h_n": float(len(inp.h2h)),
        "h2h_home_win_share": float(h2h_home_wins / len(inp.h2h)) if inp.h2h else 0.5,
        "games_home": float(h.games),
        "games_away": float(a.games),
    }
