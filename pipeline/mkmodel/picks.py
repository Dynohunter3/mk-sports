"""The decision layer: turn probabilities into the calls the app shows.

* pick          home / draw / away. A draw is called when it is a live contender, not only when it is the
                single most likely outcome (which almost never happens: three-way probabilities rarely put
                the draw on top even when it is nearly level with the favourite).
* tier          how strong the call is, from the probability of the pick.
* double chance the safer call: the most likely pair of outcomes that contains the call.

The draw rule's two numbers are tuned on the selection season only (mkmodel.picks_experiment) and
verified on the test season; they live here so the backtest and production use the same rule.
"""

from __future__ import annotations

import numpy as np

OUTCOMES = ("home", "draw", "away")
# Tuned on 2024-25 (see audit/results/step6_picks.json): call a draw when P(draw) >= MIN_DRAW and the
# favourite's lead over the draw is at most MAX_GAP.
DRAW_RULE = {"min_draw": 0.31, "max_gap": 0.12}
TIERS = (("strong", 0.65), ("likely", 0.50), ("lean", 0.40), ("toss-up", 0.0))
PAIRS = (("home or draw", (0, 1)), ("away or draw", (1, 2)), ("home or away", (0, 2)))


def picks(P: np.ndarray, rule: dict | None = None) -> np.ndarray:
    """Index of the called outcome per row (0 home, 1 draw, 2 away)."""
    rule = rule or DRAW_RULE
    side = np.where(P[:, 0] >= P[:, 2], 0, 2)
    fav = np.maximum(P[:, 0], P[:, 2])
    draw = (P[:, 1] >= rule["min_draw"]) & (fav - P[:, 1] <= rule["max_gap"])
    return np.where(draw | (P[:, 1] > fav), 1, side)


def tier_of(p_pick: float) -> str:
    for name, lo in TIERS:
        if p_pick >= lo:
            return name
    return "toss-up"


def double_chance(P: np.ndarray, call: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray]:
    """(index into PAIRS, probability) of the safer call: the most likely pair of outcomes that contains
    the call (so a draw call is never paired with "home or away"). Without `call`: the most likely pair."""
    pp = np.stack([P[:, list(ix)].sum(1) for _, ix in PAIRS], 1)
    if call is not None:
        allowed = np.array([[k in ix for _, ix in PAIRS] for k in call])
        pp = np.where(allowed, pp, -1.0)
    return pp.argmax(1), pp.max(1)


def describe(p: np.ndarray, rule: dict | None = None) -> dict:
    """Everything the app needs for one match."""
    P = np.asarray(p, float)[None, :]
    k = int(picks(P, rule)[0])
    dc_i, dc_p = double_chance(P, np.array([k]))
    return {"pick": OUTCOMES[k], "pick_probability": round(float(P[0, k]), 4), "tier": tier_of(float(P[0, k])),
            "draw_call": bool(k == 1), "double_chance": {"call": PAIRS[int(dc_i[0])][0], "probability": round(float(dc_p[0]), 4)}}
