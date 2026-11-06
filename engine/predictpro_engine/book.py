"""RatingBook: replays finished matches chronologically and keeps per-team state.

Each sport subclasses it to add its own statistics (attack/defence for football,
points for/against for basketball). The same book powers live predictions and
walk-forward backtests, so there is exactly one code path for both.
"""

from __future__ import annotations

from collections import defaultdict, deque
from datetime import datetime
from typing import Iterable, Optional

from .elo import EloConfig, elo_update, expected_score, regress_to_mean
from .types import Absence, FinishedMatch, GameRecord, MatchInput, TeamState


class RatingBook:
    sport = "generic"

    def __init__(self, elo: EloConfig, recent_n: int = 10, h2h_n: int = 6, initial_ratings: Optional[dict[str, float]] = None):
        self.elo_cfg = elo
        self.recent_n = recent_n
        self.h2h_n = h2h_n
        self._initial = dict(initial_ratings or {})
        self.elo: dict[str, float] = {}
        self.games: dict[str, int] = defaultdict(int)
        self.recent: dict[str, deque[GameRecord]] = defaultdict(lambda: deque(maxlen=self.recent_n))
        self.last_played: dict[str, datetime] = {}
        self._h2h: dict[tuple[str, str], deque[FinishedMatch]] = defaultdict(lambda: deque(maxlen=self.h2h_n))
        self.streaks: dict[str, dict[str, int]] = defaultdict(lambda: {"win": 0, "loss": 0, "unbeaten": 0, "winless": 0})
        self.last_date: Optional[datetime] = None
        self.matches_processed = 0

    # ------------------------------------------------------------------ replay
    def rating(self, team: str) -> float:
        if team not in self.elo:
            self.elo[team] = self._initial.get(team, self.elo_cfg.initial)
        return self.elo[team]

    def update_many(self, matches: Iterable[FinishedMatch]) -> None:
        for m in sorted(matches, key=lambda x: (x.date, x.id)):
            self.update(m)

    def update(self, m: FinishedMatch) -> None:
        if self.last_date is not None and m.date < self.last_date:
            raise ValueError(f"matches must be replayed in chronological order ({m.id} at {m.date} < {self.last_date})")
        for team in (m.home, m.away):
            self._maybe_new_season(team, m.date)
        home_elo, away_elo = self.rating(m.home), self.rating(m.away)

        self._update_stats(m)  # sport-specific; sees pre-match state

        ha = 0.0 if m.neutral else self.elo_cfg.home_advantage
        actual = 1.0 if m.home_score > m.away_score else 0.0 if m.home_score < m.away_score else 0.5
        mult = self._mov_multiplier(m, home_elo + ha - away_elo)
        self.elo[m.home], self.elo[m.away] = elo_update(home_elo, away_elo, actual, self.elo_cfg.k, ha, mult)

        self.recent[m.home].appendleft(GameRecord(m.date, m.away, True, m.home_score, m.away_score, m.competition))
        self.recent[m.away].appendleft(GameRecord(m.date, m.home, False, m.away_score, m.home_score, m.competition))
        self._h2h[self._pair(m.home, m.away)].appendleft(m)
        for team, scored, conceded in ((m.home, m.home_score, m.away_score), (m.away, m.away_score, m.home_score)):
            self.games[team] += 1
            self.last_played[team] = m.date
            st = self.streaks[team]
            won, lost = scored > conceded, scored < conceded
            st["win"] = st["win"] + 1 if won else 0
            st["loss"] = st["loss"] + 1 if lost else 0
            st["unbeaten"] = 0 if lost else st["unbeaten"] + 1
            st["winless"] = 0 if won else st["winless"] + 1
        self.last_date = m.date
        self.matches_processed += 1

    def _maybe_new_season(self, team: str, date: datetime) -> None:
        last = self.last_played.get(team)
        if last is not None and (date - last).days >= self.elo_cfg.season_gap_days:
            self.elo[team] = regress_to_mean(self.rating(team), self.elo_cfg.initial, self.elo_cfg.season_regression)
            self._regress_stats(team)

    # Hooks for subclasses -------------------------------------------------
    def _update_stats(self, m: FinishedMatch) -> None:  # pragma: no cover - overridden
        pass

    def _regress_stats(self, team: str) -> None:  # pragma: no cover - overridden
        pass

    def _mov_multiplier(self, m: FinishedMatch, elo_diff_home: float) -> float:
        return 1.0

    def _league_averages(self, competition: str) -> tuple[Optional[float], Optional[float]]:
        return None, None

    # ------------------------------------------------------------------ queries
    @staticmethod
    def _pair(a: str, b: str) -> tuple[str, str]:
        return (a, b) if a < b else (b, a)

    def head_to_head(self, a: str, b: str) -> tuple[FinishedMatch, ...]:
        return tuple(self._h2h.get(self._pair(a, b), ()))

    def team_state(self, team: str, name: Optional[str] = None) -> TeamState:
        return TeamState(
            team=team,
            name=name or team,
            elo=self.rating(team),
            games=self.games.get(team, 0),
            recent=tuple(self.recent.get(team, ())),
            last_played=self.last_played.get(team),
            streaks=dict(self.streaks[team]) if team in self.streaks else {},
        )

    def home_win_expectancy(self, home: str, away: str, neutral: bool = False) -> float:
        ha = 0.0 if neutral else self.elo_cfg.home_advantage
        return expected_score(self.rating(home), self.rating(away), ha)

    def build_input(
        self,
        home: str,
        away: str,
        kickoff: datetime,
        competition: str = "default",
        neutral: bool = False,
        home_absences: Iterable[Absence] = (),
        away_absences: Iterable[Absence] = (),
        home_name: Optional[str] = None,
        away_name: Optional[str] = None,
    ) -> MatchInput:
        avg_home, avg_away = self._league_averages(competition)
        return MatchInput(
            sport=self.sport,
            competition=competition,
            kickoff=kickoff,
            home=self.team_state(home, home_name),
            away=self.team_state(away, away_name),
            neutral=neutral,
            home_absences=tuple(home_absences),
            away_absences=tuple(away_absences),
            h2h=self.head_to_head(home, away),
            league_avg_home=avg_home,
            league_avg_away=avg_away,
        )

    def ratings_table(self) -> list[tuple[str, float]]:
        return sorted(self.elo.items(), key=lambda kv: kv[1], reverse=True)

    def expected_home(self, m: FinishedMatch) -> float:
        ha = 0.0 if m.neutral else self.elo_cfg.home_advantage
        return expected_score(self.rating(m.home), self.rating(m.away), ha)
