"""Deterministic mock provider: a never-ending simulated sports world.

* Fixtures come from round-robin schedules anchored at `anchor` (a Monday a few weeks
  before the database was seeded). When a cycle ends, a new "season" starts.
* Results are generated from hidden team strengths with a per-match seeded RNG, so the
  same match always produces the same result, events and scorers.
* Matches go live in real time: polling during a match returns the current minute and
  only the goals scored so far. Results appear when the simulated final whistle blows.
* Squad availability (injuries/suspensions) changes weekly, which exercises the
  "re-predict on team news" path.
* `overrides` can move individual kickoffs (used by `cli demo-live` so there is always
  something live to look at).
"""

from __future__ import annotations

import hashlib
import json
import math
import random
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import cached_property
from pathlib import Path
from typing import Callable, Optional

from .base import LeagueRef, ProviderEvent, ProviderMatch, ProviderPlayer, ProviderTeam, SportsDataProvider

WORLD_PATH = Path(__file__).resolve().parent.parent / "data" / "mock_world.json"

FOOTBALL_REAL_MINUTES = 112  # 45 + 2 stoppage + 15 break + 45 + 5 stoppage
BASKETBALL_REAL_MINUTES = 140
# Basketball real-time windows (minutes after tip-off) for each quarter: (start, end)
BB_QUARTERS = [(0, 30), (33, 63), (80, 110), (113, 140)]

FOOTBALL_SQUAD = [  # (position, importance, tag)
    ("GK", 0.55, None),
    ("DEF", 0.45, None),
    ("DEF", 0.40, None),
    ("MID", 0.65, "captain"),
    ("MID", 0.50, None),
    ("FWD", 1.00, "top_scorer"),
    ("FWD", 0.60, None),
]
BASKETBALL_SQUAD = [("F", 1.0, "star"), ("G", 0.7, None), ("C", 0.5, None), ("G", 0.4, None), ("F", 0.35, None)]
INJURIES = ["Hamstring", "Knee", "Ankle", "Groin", "Calf", "Illness", "Back", "Shoulder"]
SCORER_WEIGHTS = {"FWD": 6, "MID": 2.5, "DEF": 0.8, "GK": 0.0}


def stable_rng(*parts) -> random.Random:
    digest = hashlib.sha256("|".join(map(str, parts)).encode()).hexdigest()
    return random.Random(int(digest[:16], 16))


def poisson(rng: random.Random, lam: float) -> int:
    l, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rng.random()
        if p <= l:
            return k
        k += 1


def circle_rounds(teams: list[str]) -> list[list[tuple[str, str]]]:
    """Circle-method round robin with Berger-style home/away assignment: home games differ by
    at most one per team, and any prefix of rounds (e.g. an 8-match league phase) stays balanced."""
    t = list(teams)
    if len(t) % 2:
        t.append("")
    n = len(t)
    rounds = []
    for r in range(n - 1):
        pairs = []
        for i in range(n // 2):
            a, b = t[i], t[n - 1 - i]
            if a and b:
                home_first = (r % 2 == 0) if i == 0 else (i % 2 == 1)
                pairs.append((a, b) if home_first else (b, a))
        rounds.append(pairs)
        t = [t[0], t[-1]] + t[1:-1]
    return rounds


def season_label(anchor: datetime, cycle: int) -> str:
    """Each schedule cycle is a new season: 2026/27, 2027/28, ..."""
    y = (anchor.year if anchor.month >= 7 else anchor.year - 1) + cycle
    return f"{y}/{(y + 1) % 100:02d}"


@dataclass
class _Comp:
    key: str
    sport: str
    teams: list[str]
    interval: int
    offset: int
    rounds_per_cycle: int
    gap: int
    slots: list[tuple[int, str]]
    round_label: str
    cfg: dict

    @property
    def cycle_days(self) -> int:
        return self.rounds_per_cycle * self.interval + self.gap


@dataclass
class _Result:
    home_score: int
    away_score: int
    events: list[tuple[float, ProviderEvent]]  # (real minutes after kickoff when it happens, event)
    quarters: Optional[list[tuple[int, int]]] = None


class MockProvider(SportsDataProvider):
    name = "mock"
    sports = ("football", "basketball")

    def __init__(
        self,
        anchor: datetime,
        seed: int = 2026,
        overrides: Optional[dict[str, str]] = None,
        clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
        world: Optional[dict] = None,
    ):
        if anchor.tzinfo is None:
            raise ValueError("anchor must be timezone-aware")
        self.anchor = anchor
        self.seed = seed
        self.overrides = {k: datetime.fromisoformat(v) for k, v in (overrides or {}).items()}
        self.clock = clock
        self.world = world or json.loads(WORLD_PATH.read_text(encoding="utf-8"))

    # ------------------------------------------------------------------ world
    @cached_property
    def teams(self) -> dict[str, dict[str, dict]]:
        out: dict[str, dict[str, dict]] = {}
        for sport, rows in self.world["teams"].items():
            out[sport] = {
                r[0]: {"ref": r[0], "name": r[1], "short": r[2], "code": r[3], "color": r[4], "strength": r[5], "venue": r[6], "city": r[7], "country": r[8]}
                for r in rows
            }
        return out

    @cached_property
    def comps(self) -> dict[str, _Comp]:
        out = {}
        for key, c in self.world["competitions"].items():
            n = len(c["teams"]) + (len(c["teams"]) % 2)
            rpc = 2 * (n - 1) if c["rounds"] == "double" else int(c["rounds"])
            out[key] = _Comp(key, c["sport"], c["teams"], c["interval_days"], c["offset_days"], rpc, c.get("gap_days", 0),
                             [tuple(s) for s in c["slots"]], c.get("round_label", "Round {n}"), c)
        return out

    def _team(self, sport: str, ref: str) -> ProviderTeam:
        t = self.teams[sport][ref]
        return ProviderTeam(ref, t["name"], t["short"], t["code"], t["country"], t["color"], None, t["venue"], t["city"])

    # --------------------------------------------------------------- schedule
    def _cycle_rounds(self, comp: _Comp, cycle: int) -> list[list[tuple[str, str]]]:
        rng = stable_rng(self.seed, comp.key, "cycle", cycle)
        order = list(comp.teams)
        rng.shuffle(order)
        first = circle_rounds(order)
        rounds = first + [[(b, a) for a, b in r] for r in first]
        return rounds[: comp.rounds_per_cycle]

    def _round_start(self, comp: _Comp, cycle: int, rnd: int) -> datetime:
        return self.anchor + timedelta(days=cycle * comp.cycle_days + comp.offset + rnd * comp.interval)

    def _matches_for_round(self, comp: _Comp, cycle: int, rnd: int) -> list[tuple[str, datetime, str, str]]:
        pairs = list(self._cycle_rounds(comp, cycle)[rnd])
        stable_rng(self.seed, comp.key, cycle, rnd, "slots").shuffle(pairs)
        base = self._round_start(comp, cycle, rnd)
        out = []
        for i, (h, a) in enumerate(pairs):
            day, hm = comp.slots[min(i, len(comp.slots) - 1)]
            hh, mm = map(int, hm.split(":"))
            kickoff = base + timedelta(days=day, hours=hh, minutes=mm)
            ref = f"{comp.key}:{cycle}:{rnd}:{h}:{a}"
            out.append((ref, self.overrides.get(ref, kickoff), h, a))
        return out

    def _iter_schedule(self, comp: _Comp, start: datetime, end: datetime):
        pad = timedelta(days=7)
        lo, hi = start - pad, end + pad
        first_cycle = max(0, int((lo - self.anchor).days // comp.cycle_days))
        cycle = first_cycle
        while True:
            cycle_start = self.anchor + timedelta(days=cycle * comp.cycle_days)
            if cycle_start > hi:
                break
            for rnd in range(comp.rounds_per_cycle):
                rs = self._round_start(comp, cycle, rnd)
                if rs + timedelta(days=4) < lo or rs > hi:
                    continue
                for ref, kickoff, h, a in self._matches_for_round(comp, cycle, rnd):
                    yield cycle, rnd, ref, kickoff, h, a
            cycle += 1
        # Overridden kickoffs may have moved into the window from elsewhere
        for ref, kickoff in self.overrides.items():
            if ref.startswith(comp.key + ":") and start <= kickoff <= end:
                _, cyc, rnd, h, a = ref.split(":")
                rs = self._round_start(comp, int(cyc), int(rnd))
                if rs + timedelta(days=4) < lo or rs > hi:
                    yield int(cyc), int(rnd), ref, kickoff, h, a

    # ---------------------------------------------------------------- results
    def _squad(self, sport: str, team_ref: str) -> list[ProviderPlayer]:
        template = FOOTBALL_SQUAD if sport == "football" else BASKETBALL_SQUAD
        names = self.world["names"]
        rng = stable_rng(self.seed, "squad", team_ref)
        used: set[str] = set()
        out = []
        for i, (pos, imp, tag) in enumerate(template):
            while True:
                name = f"{rng.choice(names['initials'])}. {rng.choice(names['surnames'])}"
                if name not in used:
                    used.add(name)
                    break
            number = (1 if pos == "GK" else rng.randint(2, 99)) if sport == "football" else rng.randint(0, 55)
            out.append(ProviderPlayer(f"{team_ref}#{i}", team_ref, name, pos, number, imp, tag))
        return out

    def _availability(self, sport: str, player: ProviderPlayer, when: datetime) -> tuple[str, Optional[str]]:
        week = (when - self.anchor).days // 7
        rng = stable_rng(self.seed, "fitness", player.ref, week)
        x = rng.random()
        if x < 0.07:
            return "injured", f"{rng.choice(INJURIES)} injury"
        if x < 0.10:
            return "doubtful", f"{rng.choice(INJURIES)} knock"
        if sport == "football" and x < 0.12:
            return "suspended", "Suspended (accumulated yellow cards)"
        return "available", None

    def _strength(self, sport: str, ref: str) -> float:
        return float(self.teams[sport][ref]["strength"])

    def _result(self, comp: _Comp, ref: str, home: str, away: str, kickoff: datetime) -> _Result:
        rng = stable_rng(self.seed, "result", ref)
        if comp.sport == "football":
            return self._football_result(comp, rng, home, away, kickoff)
        return self._basketball_result(comp, rng, home, away)

    def _football_result(self, comp: _Comp, rng: random.Random, home: str, away: str, kickoff: datetime) -> _Result:
        base_h, base_a = comp.cfg.get("avg_goals", [1.5, 1.2])
        sh, sa = self._strength("football", home), self._strength("football", away)
        # Absent key players weaken the side a little, so team news really matters
        pen = {}
        for side, team in (("home", home), ("away", away)):
            missing = sum(p.importance for p in self._squad("football", team) if self._availability("football", p, kickoff)[0] in ("injured", "suspended"))
            pen[side] = 0.06 * missing
        form = rng.gauss(0, 0.12)
        lam_h = math.exp(math.log(base_h) + sh - sa + form - pen["home"])
        lam_a = math.exp(math.log(base_a) + sa - sh - form - pen["away"])
        hs, as_ = poisson(rng, lam_h), poisson(rng, lam_a)
        events: list[tuple[float, ProviderEvent]] = []
        for side, goals, team in (("home", hs, home), ("away", as_, away)):
            squad = [p for p in self._squad("football", team) if self._availability("football", p, kickoff)[0] not in ("injured", "suspended")]
            weights = [SCORER_WEIGHTS.get(p.position, 1) * (1.5 if p.tag == "top_scorer" else 1) for p in squad]
            for g in range(goals):
                minute = rng.randint(1, 94)
                kind = "goal"
                r = rng.random()
                if r < 0.04:
                    kind, scorer = "own_goal", "Own goal"
                else:
                    scorer = rng.choices(squad, weights)[0].name if squad and sum(weights) else "Unknown"
                    if r < 0.14:
                        kind = "penalty_goal"
                events.append((self._real_minute(minute), ProviderEvent(f"g-{side}-{g}", kind, side, min(minute, 90), self._clock_label(minute), scorer)))
            for c in range(poisson(rng, 1.7)):
                minute = rng.randint(5, 93)
                player = rng.choice(squad).name if squad else "Unknown"
                events.append((self._real_minute(minute), ProviderEvent(f"y-{side}-{c}", "yellow_card", side, min(minute, 90), self._clock_label(minute), player)))
            if rng.random() < 0.04:
                minute = rng.randint(30, 92)
                events.append((self._real_minute(minute), ProviderEvent(f"r-{side}", "red_card", side, min(minute, 90), self._clock_label(minute), rng.choice(squad).name if squad else "Unknown")))
        events.sort(key=lambda e: e[0])
        return _Result(hs, as_, events)

    @staticmethod
    def _real_minute(match_minute: int) -> float:
        """Map a match minute to real minutes after kickoff (half-time break is 15 min)."""
        if match_minute <= 47:
            return match_minute - 0.5
        return match_minute + 15 - 0.5

    @staticmethod
    def _clock_label(minute: int) -> str:
        if 45 < minute <= 47:
            return f"45+{minute - 45}'"
        if minute > 90:
            return f"90+{minute - 90}'"
        return f"{minute}'"

    def _basketball_result(self, comp: _Comp, rng: random.Random, home: str, away: str) -> _Result:
        avg = comp.cfg.get("avg_points", 112)
        margin = self._strength("basketball", home) - self._strength("basketball", away) + comp.cfg.get("home_court", 2.5) + rng.gauss(0, comp.cfg.get("margin_sd", 12))
        total = 2 * avg + rng.gauss(0, avg * 0.12)
        hs, as_ = round((total + margin) / 2), round((total - margin) / 2)
        if hs == as_:
            hs += rng.choice([2, -2])  # (simulated overtime)
        quarters = []
        rem_h, rem_a = hs, as_
        for q in range(4):
            if q == 3:
                quarters.append((rem_h, rem_a))
            else:
                qh = max(10, round(hs / 4 + rng.gauss(0, 3)))
                qa = max(10, round(as_ / 4 + rng.gauss(0, 3)))
                quarters.append((qh, qa))
                rem_h -= qh
                rem_a -= qa
        if quarters[3][0] < 5 or quarters[3][1] < 5:  # keep the last quarter plausible
            quarters = [(hs // 4, as_ // 4)] * 3 + [(hs - 3 * (hs // 4), as_ - 3 * (as_ // 4))]
        return _Result(hs, as_, [], quarters)

    # ------------------------------------------------------------ live state
    def _build(self, comp: _Comp, cycle: int, rnd: int, ref: str, kickoff: datetime, h: str, a: str, now: datetime, with_events: bool) -> ProviderMatch:
        home, away = self._team(comp.sport, h), self._team(comp.sport, a)
        elapsed = (now - kickoff).total_seconds() / 60
        label = comp.round_label.replace("{n}", str(rnd + 1))
        pm = ProviderMatch(
            ref=ref,
            league_slug=comp.key,
            start_time=kickoff,
            status="scheduled",
            home=home,
            away=away,
            season=season_label(self.anchor, cycle),
            round=label,
            venue=home.venue_name,
        )
        if elapsed < 0:
            return pm
        res = self._result(comp, ref, h, a, kickoff)
        if comp.sport == "football":
            done = elapsed >= FOOTBALL_REAL_MINUTES
            shown = [e for t, e in res.events if done or t <= elapsed]
            # every *goal event carries the side that benefits (own goals included)
            pm.home_score = sum(1 for e in shown if e.type.endswith("goal") and e.side == "home")
            pm.away_score = sum(1 for e in shown if e.type.endswith("goal") and e.side == "away")
            if done:
                pm.status, pm.clock = "finished", "FT"
                pm.home_score, pm.away_score = res.home_score, res.away_score
                ht = [e for t, e in res.events if t <= 47 and e.type.endswith("goal")]
                pm.score_detail = {"half_time": [sum(1 for e in ht if e.side == "home"), sum(1 for e in ht if e.side == "away")]}
            else:
                pm.status = "live"
                if elapsed < 47:
                    pm.clock = self._clock_label(int(elapsed) + 1)
                elif elapsed < 62:
                    pm.clock = "HT"
                else:
                    pm.clock = self._clock_label(min(95, int(elapsed - 15) + 1))
            if with_events:
                pm.events = shown
            return pm
        # basketball
        done = elapsed >= BASKETBALL_REAL_MINUTES
        q = res.quarters or []
        if done:
            pm.status, pm.clock = "finished", "FT"
            pm.home_score, pm.away_score = res.home_score, res.away_score
            pm.score_detail = {"quarters": [list(x) for x in q]}
            pm.events = [] if with_events else None
            return pm
        pm.status = "live"
        sh = sa = 0
        detail = []
        pm.clock = "Q1 12:00"
        for i, (start, end) in enumerate(BB_QUARTERS):
            if elapsed >= end:
                sh, sa = sh + q[i][0], sa + q[i][1]
                detail.append(list(q[i]))
                pm.clock = "HT" if i == 1 else f"End Q{i + 1}"
            elif elapsed >= start:
                frac = (elapsed - start) / (end - start)
                ph, pa = int(q[i][0] * frac), int(q[i][1] * frac)
                sh, sa = sh + ph, sa + pa
                detail.append([ph, pa])
                secs = int(12 * 60 * (1 - frac))
                pm.clock = f"Q{i + 1} {secs // 60:02d}:{secs % 60:02d}"
                break
            else:
                break
        pm.home_score, pm.away_score = sh, sa
        pm.score_detail = {"quarters": detail}
        pm.events = [] if with_events else None
        return pm

    # ------------------------------------------------------------- interface
    def _comp_for(self, league: LeagueRef) -> Optional[_Comp]:
        return self.comps.get(league.ref) if isinstance(league.ref, str) else None

    def supports(self, league: LeagueRef) -> bool:
        return self._comp_for(league) is not None

    def fetch_fixtures(self, league: LeagueRef, date_from: datetime, date_to: datetime) -> list[ProviderMatch]:
        comp = self._comp_for(league)
        if comp is None:
            return []
        now = self.clock()
        out = []
        for cycle, rnd, ref, kickoff, h, a in self._iter_schedule(comp, date_from, date_to):
            if date_from <= kickoff <= date_to:
                pm = self._build(comp, cycle, rnd, ref, kickoff, h, a, now, with_events=True)
                pm.league_slug = league.slug
                out.append(pm)
        return out

    def fetch_live(self, leagues: list[LeagueRef], refs: list[str]) -> list[ProviderMatch]:
        now = self.clock()
        slugs = {lg.ref: lg.slug for lg in leagues if isinstance(lg.ref, str)}
        out = []
        for ref in refs:
            try:
                key, cyc, rnd, h, a = ref.split(":")
            except ValueError:
                continue
            comp = self.comps.get(key)
            if comp is None:
                continue
            kickoff = self.overrides.get(ref)
            if kickoff is None:
                kickoff = next((k for r, k, _, _ in self._matches_for_round(comp, int(cyc), int(rnd)) if r == ref), None)
            if kickoff is None:
                continue
            pm = self._build(comp, int(cyc), int(rnd), ref, kickoff, h, a, now, with_events=True)
            pm.league_slug = slugs.get(key, key)
            out.append(pm)
        return out

    def fetch_squads(self, league: LeagueRef, team_refs: list[str]) -> list[ProviderPlayer]:
        comp = self._comp_for(league)
        if comp is None:
            return []
        now = self.clock()
        out = []
        for team in team_refs:
            if team not in self.teams[comp.sport]:
                continue
            for p in self._squad(comp.sport, team):
                p.status, p.status_detail = self._availability(comp.sport, p, now)
                out.append(p)
        return out
