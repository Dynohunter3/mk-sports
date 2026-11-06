from __future__ import annotations

import math
import random
from datetime import datetime, timedelta, timezone

from predictpro_engine.types import FinishedMatch

T0 = datetime(2026, 8, 1, 15, 0, tzinfo=timezone.utc)


def fm(i: int, home: str, away: str, hs: int, as_: int, days: float = 0, comp: str = "L1", neutral: bool = False) -> FinishedMatch:
    return FinishedMatch(str(i), T0 + timedelta(days=days if days else i), home, away, hs, as_, comp, neutral)


def _poisson(rng: random.Random, lam: float) -> int:
    # Knuth's algorithm (fine for small lambda)
    l, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rng.random()
        if p <= l:
            return k
        k += 1


def round_robin(teams: list[str]) -> list[list[tuple[str, str]]]:
    t = list(teams)
    if len(t) % 2:
        t.append("BYE")
    n = len(t)
    rounds = []
    for r in range(n - 1):
        pairs = []
        for i in range(n // 2):
            a, b = t[i], t[n - 1 - i]
            if "BYE" not in (a, b):
                pairs.append((a, b) if r % 2 == 0 else (b, a))
        rounds.append(pairs)
        t = [t[0]] + [t[-1]] + t[1:-1]
    return rounds


def simulate_football_league(n_teams: int = 16, seasons: int = 2, seed: int = 7) -> tuple[list[FinishedMatch], dict[str, float]]:
    """Simulated league where team strength is known; good models must recover it."""
    rng = random.Random(seed)
    teams = [f"T{i:02d}" for i in range(n_teams)]
    strength = {t: rng.gauss(0, 0.35) for t in teams}
    rounds = round_robin(teams)
    rounds = rounds + [[(b, a) for a, b in r] for r in rounds]
    out, day, i = [], 0, 0
    for _ in range(seasons):
        for r in rounds:
            for h, a in r:
                lam_h = math.exp(0.35 + strength[h] - strength[a] + 0.15)
                lam_a = math.exp(0.15 + strength[a] - strength[h])
                out.append(FinishedMatch(str(i), T0 + timedelta(days=day), h, a, _poisson(rng, lam_h), _poisson(rng, lam_a), "SIM"))
                i += 1
            day += 7
    return out, strength


def simulate_basketball_league(n_teams: int = 14, cycles: int = 4, seed: int = 11) -> tuple[list[FinishedMatch], dict[str, float]]:
    rng = random.Random(seed)
    teams = [f"B{i:02d}" for i in range(n_teams)]
    strength = {t: rng.gauss(0, 5) for t in teams}
    rounds = round_robin(teams)
    out, day, i = [], 0, 0
    for c in range(cycles):
        for r in rounds:
            for h, a in r:
                if c % 2:
                    h, a = a, h
                margin = strength[h] - strength[a] + 2.5 + rng.gauss(0, 11)
                total = 225 + rng.gauss(0, 15)
                hs, as_ = round((total + margin) / 2), round((total - margin) / 2)
                if hs == as_:
                    hs += 1
                out.append(FinishedMatch(str(i), T0 + timedelta(days=day), h, a, hs, as_, "SIMB"))
                i += 1
            day += 2
    return out, strength
