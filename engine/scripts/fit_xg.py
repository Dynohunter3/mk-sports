"""Fit the expected-goals (xG) model used by the app's live match centre.

    python engine/scripts/fit_xg.py shots.jsonl        # shots from collect_shots.py

Inputs per attempt: where it was taken from (distance to goal, angle subtended by the goal
mouth) and whether it was a penalty. ESPN's commentary text is NOT used beyond that: goals are
always written up as "footed shot" (never "header"), so text tags would leak the outcome.

ESPN uses two coordinate systems: older matches give x as a fraction of HALF the pitch measured
from the goal line (0..~0.6), newer ones give x on 0..100 with the target goal at 100. Both give
y as 0..1 or 0..100 across the pitch. Validated on the penalty spot (both read ~12 m) and on the
"six yard box" / "outside the box" descriptions.

Matches are split 80/20 by match id; the held-out log loss, calibration and goal totals are
printed, then the coefficients for mobile/src/engine/xg.ts.
"""

from __future__ import annotations

import json
import math
import random
import sys

import numpy as np

PITCH_L, PITCH_W, GOAL_W = 105.0, 68.0, 7.32
GOAL_TYPES = {"goal", "penalty---scored"}


def geometry(x: float, y: float) -> tuple[float, float]:
    """(distance m, goal-mouth angle rad) from ESPN's field position, either scale."""
    if x <= 1 and y <= 1:
        dx, yf = x * PITCH_L / 2, y
    else:
        dx, yf = (100 - x) / 100 * PITCH_L, y / 100
    dy = (yf - 0.5) * PITCH_W
    dist = math.hypot(dx, dy)
    a = math.atan2(GOAL_W * dx, dx * dx + dy * dy - (GOAL_W / 2) ** 2)
    if a < 0:
        a += math.pi
    return dist, a


def features(dist: float, angle: float) -> list[float]:
    return [1.0, dist, angle, math.log(dist + 1), dist * angle]


FEATURE_NAMES = ["intercept", "dist", "angle", "log(dist+1)", "dist*angle"]


def fit(X: np.ndarray, y: np.ndarray, l2: float = 1e-3) -> np.ndarray:
    w = np.zeros(X.shape[1])
    for _ in range(50):
        p = 1 / (1 + np.exp(-(X @ w)))
        g = X.T @ (p - y) + l2 * w
        H = (X * (p * (1 - p))[:, None]).T @ X + l2 * np.eye(X.shape[1])
        step = np.linalg.solve(H, g)
        w -= step
        if np.abs(step).max() < 1e-9:
            break
    return w


def logloss(p: np.ndarray, y: np.ndarray) -> float:
    p = np.clip(p, 1e-9, 1 - 1e-9)
    return float(-(y * np.log(p) + (1 - y) * np.log(1 - p)).mean())


def main(path: str):
    rows = [json.loads(l) for l in open(path)]
    shots, pens = [], []
    for r in rows:
        if r["x"] is None or r["y"] is None:
            continue
        goal = 1.0 if r["type"] in GOAL_TYPES else 0.0
        if r["type"].startswith("penalty"):
            pens.append((r["event"], goal))
            continue
        d, a = geometry(r["x"], r["y"])
        shots.append((r["event"], features(d, a), goal, d))
    events = sorted({s[0] for s in shots})
    random.Random(11).shuffle(events)
    test_ev = set(events[: len(events) // 5])
    tr = [s for s in shots if s[0] not in test_ev]
    te = [s for s in shots if s[0] in test_ev]
    Xtr, ytr = np.array([s[1] for s in tr]), np.array([s[2] for s in tr])
    Xte, yte = np.array([s[1] for s in te]), np.array([s[2] for s in te])
    w = fit(Xtr, ytr)
    pte = 1 / (1 + np.exp(-(Xte @ w)))
    base = np.full_like(yte, ytr.mean())
    print(f"non-penalty shots: train {len(tr)}, test {len(te)} ({len(test_ev)} held-out matches)")
    print(f"test log loss: model {logloss(pte, yte):.4f} vs base rate {logloss(base, yte):.4f}")
    print(f"test goals {int(yte.sum())}, sum of xG {pte.sum():.1f}")
    order = np.argsort(pte)
    print("calibration by decile (mean xG -> goal rate):")
    for chunk in np.array_split(order, 10):
        print(f"  {pte[chunk].mean():.3f} -> {yte[chunk].mean():.3f}  (n={len(chunk)})")
    # distance sanity table
    for dist in (6, 11, 16, 20, 25, 30):
        a = geometry(100 - dist / PITCH_L * 100, 50)[1]
        print(f"  central shot from {dist} m: xG {1 / (1 + math.exp(-(np.array(features(dist, a)) @ w))):.3f}")
    # final fit on everything
    Xall, yall = np.array([s[1] for s in shots]), np.array([s[2] for s in shots])
    w = fit(Xall, yall)
    pen_rate = sum(g for _, g in pens) / max(1, len(pens))
    out = {"features": FEATURE_NAMES, "coef": [round(float(v), 6) for v in w], "penalty": round(pen_rate, 3), "shots": len(shots), "penalties": len(pens), "matches": len({s[0] for s in shots})}
    print(json.dumps(out))


if __name__ == "__main__":
    main(sys.argv[1])
