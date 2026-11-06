"""Basketball: Elo + net-rating model with home court and rest days.

expected margin = w * (Elo gap / Elo-points-per-point) + (1 - w) * (net rating gap)
                  + home court + rest adjustment - key absences
P(home win)     = Phi(margin / sigma)       (no draws: overtime decides)
expected total  = average of each side's points for and the opponent's points against
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Mapping, Optional

from .book import RatingBook
from .confidence import ConfidenceThresholds, confidence_level
from .elo import EloConfig, basketball_mov_multiplier
from .factors import absence_factors, data_factor, form_factors, h2h_factor, home_advantage_factor, rating_factor, select_factors, venue_factor
from .params import merge_params
from .stats import normal_cdf
from .types import Absence, FinishedMatch, KeyFactor, MatchInput, Prediction, TeamState


@dataclass(frozen=True)
class BasketballParams:
    k: float = 20.0
    home_advantage_elo: float = 70.0
    initial_elo: float = 1500.0
    elo_points_per_point: float = 28.0  # Elo gap equivalent to one point of margin
    elo_weight: float = 0.5
    net_shrink: float = 0.8  # regress the raw net rating gap (small samples overstate it)
    points_alpha: float = 0.1
    league_avg_alpha: float = 0.02
    default_points: float = 114.0  # per team per game
    home_court_pts: float = 2.5
    sigma: float = 12.0  # std-dev of final margin around the expectation
    back_to_back_pts: float = -2.0
    rested_bonus_pts: float = 0.5  # per extra rest day beyond one, capped at two days
    star_absence_pts: float = 4.5  # margin lost when a player with importance 1.0 is out
    max_absence_pts: float = 12.0
    high_confidence: float = 0.75
    medium_confidence: float = 0.60
    min_games: int = 5


class BasketballBook(RatingBook):
    sport = "basketball"

    def __init__(self, params: BasketballParams, initial_ratings: Optional[dict[str, float]] = None):
        super().__init__(
            EloConfig(k=params.k, home_advantage=params.home_advantage_elo, initial=params.initial_elo, season_regression=0.25),
            initial_ratings=initial_ratings,
        )
        self.p = params
        self.pf: dict[str, float] = {}
        self.pa: dict[str, float] = {}
        self.avg: dict[str, float] = {}

    def _avg(self, competition: str) -> float:
        return self.avg.get(competition, self.p.default_points)

    def _league_averages(self, competition: str) -> tuple[float, float]:
        a = self._avg(competition)
        return a, a

    def _update_stats(self, m: FinishedMatch) -> None:
        a = self.p.points_alpha
        base = self._avg(m.competition)
        for team, scored, conceded in ((m.home, m.home_score, m.away_score), (m.away, m.away_score, m.home_score)):
            self.pf[team] = (1 - a) * self.pf.get(team, base) + a * scored
            self.pa[team] = (1 - a) * self.pa.get(team, base) + a * conceded
        b = self.p.league_avg_alpha
        self.avg[m.competition] = (1 - b) * base + b * (m.home_score + m.away_score) / 2

    def _regress_stats(self, team: str) -> None:
        for d in (self.pf, self.pa):
            if team in d:
                d[team] = d[team] + (self.p.default_points - d[team]) / 4

    def _mov_multiplier(self, m: FinishedMatch, elo_diff_home: float) -> float:
        winner_diff = elo_diff_home if m.home_score > m.away_score else -elo_diff_home
        return basketball_mov_multiplier(m.home_score - m.away_score, winner_diff)

    def team_state(self, team: str, name: Optional[str] = None) -> TeamState:
        st = super().team_state(team, name)
        st.points_for = self.pf.get(team)
        st.points_against = self.pa.get(team)
        return st


def rest_days(last_played: Optional[datetime], tipoff: datetime) -> Optional[int]:
    """Full days of rest before tip-off (0 = second night of a back-to-back)."""
    if last_played is None:
        return None
    hours = (tipoff - last_played).total_seconds() / 3600
    return max(0, round(hours / 24) - 1)


def _absence_points(absences: tuple[Absence, ...], p: BasketballParams) -> float:
    return min(p.max_absence_pts, sum(p.star_absence_pts * a.weight for a in absences))


class BasketballModel:
    sport = "basketball"
    name = "basketball-elo-netrating"
    version = "1.0.0"
    has_draws = False

    def __init__(self, params: Optional[Mapping] = None, league_params: Optional[Mapping[str, Mapping]] = None):
        self.params = merge_params(BasketballParams(), params)
        self.league_params = {k: merge_params(self.params, v) for k, v in (league_params or {}).items()}

    def params_for(self, competition: str) -> BasketballParams:
        return self.league_params.get(competition, self.params)

    def new_book(self, initial_ratings: Optional[dict[str, float]] = None) -> BasketballBook:
        return BasketballBook(self.params, initial_ratings)

    def _rest_effect(self, days: Optional[int], p: BasketballParams) -> float:
        if days is None:
            return 0.0
        if days == 0:
            return p.back_to_back_pts
        return p.rested_bonus_pts * min(2, days - 1)

    def predict(self, inp: MatchInput) -> Prediction:
        p = self.params_for(inp.competition)
        home, away = inp.home, inp.away
        avg = inp.league_avg_home or p.default_points
        pf_h = home.points_for if home.points_for is not None else avg
        pa_h = home.points_against if home.points_against is not None else avg
        pf_a = away.points_for if away.points_for is not None else avg
        pa_a = away.points_against if away.points_against is not None else avg

        elo_margin = (home.elo - away.elo) / p.elo_points_per_point
        net_margin = ((pf_h - pa_h) - (pf_a - pa_a)) * p.net_shrink
        base = p.elo_weight * elo_margin + (1 - p.elo_weight) * net_margin
        hca = 0.0 if inp.neutral else p.home_court_pts
        rest_h, rest_a = rest_days(home.last_played, inp.kickoff), rest_days(away.last_played, inp.kickoff)
        rest_adj = self._rest_effect(rest_h, p) - self._rest_effect(rest_a, p)
        abs_h, abs_a = _absence_points(inp.home_absences, p), _absence_points(inp.away_absences, p)
        margin = base + hca + rest_adj - abs_h + abs_a

        total = (pf_h + pa_a) / 2 + (pf_a + pa_h) / 2 - 0.3 * (abs_h + abs_a)
        p_home = normal_cdf(margin / p.sigma)
        p_away = 1.0 - p_home
        ph, pa_ = round((total + margin) / 2), round((total - margin) / 2)
        if ph == pa_:  # basketball has no draws: break the tie toward the favourite
            if margin >= 0:
                ph += 1
            else:
                pa_ += 1
        elif (ph > pa_) != (p_home >= 0.5):  # rounding can't flip the winner, but be safe
            ph, pa_ = (max(ph, pa_), min(ph, pa_)) if p_home >= 0.5 else (min(ph, pa_), max(ph, pa_))

        disagree = abs(elo_margin) > 1.5 and abs(net_margin) > 1.5 and (elo_margin > 0) != (net_margin > 0)
        conf, conf_reasons = confidence_level(
            max(p_home, p_away), ConfidenceThresholds(p.high_confidence, p.medium_confidence, p.min_games), min(home.games, away.games), disagree
        )
        factors = self._factors(inp, p, rest_h, rest_a, pf_h, pa_h, pf_a, pa_a)
        fav = "home" if p_home >= 0.5 else "away"
        steps = [
            {"title": "Team strength (Elo)", "detail": f"{home.name} {home.elo:.0f} vs {away.name} {away.elo:.0f} -> {elo_margin:+.1f} pts"},
            {"title": "Net rating (points scored minus allowed, recent games weighted)",
             "detail": f"{home.name} {pf_h - pa_h:+.1f}, {away.name} {pf_a - pa_a:+.1f} -> {net_margin:+.1f} pts"},
            {"title": "Adjustments",
             "detail": ("neutral court" if inp.neutral else f"home court +{hca:.1f}")
             + f"; rest {rest_adj:+.1f} ({_rest_text(rest_h)} vs {_rest_text(rest_a)})"
             + (f"; absences {abs_a - abs_h:+.1f}" if abs_h or abs_a else "")},
            {"title": "Projected margin & total", "detail": f"{home.name} by {margin:+.1f}, total {total:.0f} -> {ph}-{pa_}"},
            {"title": "Win probability", "detail": f"Normal model (sd {p.sigma:.0f} pts): {home.name} {p_home:.0%}, {away.name} {p_away:.0%}"},
            {"title": "Confidence", "detail": "; ".join(conf_reasons)},
        ]
        top = max(p_home, p_away)
        fav_name = home.name if fav == "home" else away.name
        reason = next((f.text for f in factors if f.favours == fav), None)
        head = f"{fav_name} favoured ({top:.0%})" if top >= p.medium_confidence else f"Close game, {fav_name} slight favourites ({top:.0%})"
        summary = head + (f". {reason}." if reason else ".") + f" Projected score {ph}-{pa_}."
        return Prediction(
            sport=self.sport,
            model=self.name,
            model_version=self.version,
            prob_home=round(p_home, 4),
            prob_draw=None,
            prob_away=round(p_away, 4),
            predicted_home=int(ph),
            predicted_away=int(pa_),
            expected_home=round((total + margin) / 2, 1),
            expected_away=round((total - margin) / 2, 1),
            confidence=conf,
            key_factors=factors,
            explanation={
                "method": "Elo ratings + net rating (margin model)",
                "summary": summary,
                "steps": steps,
                "inputs": {
                    "elo_home": round(home.elo, 1),
                    "elo_away": round(away.elo, 1),
                    "net_home": round(pf_h - pa_h, 2),
                    "net_away": round(pf_a - pa_a, 2),
                    "points_for_home": round(pf_h, 1),
                    "points_for_away": round(pf_a, 1),
                    "rest_days_home": rest_h,
                    "rest_days_away": rest_a,
                    "home_court_pts": hca,
                    "expected_margin": round(margin, 2),
                    "expected_total": round(total, 1),
                    "games_home": home.games,
                    "games_away": away.games,
                    "absences_home": [a.player for a in inp.home_absences],
                    "absences_away": [a.player for a in inp.away_absences],
                },
            },
        )

    def _factors(self, inp: MatchInput, p: BasketballParams, rest_h, rest_a, pf_h, pa_h, pf_a, pa_a) -> list[KeyFactor]:
        home, away = inp.home, inp.away
        elo_diff = home.elo - away.elo
        cands: list[Optional[KeyFactor]] = [rating_factor(home, away, elo_diff, inp.neutral)]
        cands += form_factors(home, "home", False) + form_factors(away, "away", False)
        if not inp.neutral:
            cands.append(venue_factor(home, "home", True, False))
            cands.append(venue_factor(away, "away", False, False))
        cands += absence_factors(home, "home", inp.home_absences) + absence_factors(away, "away", inp.away_absences)
        cands.append(h2h_factor(inp.h2h, home, away))
        for team, side, days in ((home, "home", rest_h), (away, "away", rest_a)):
            other = "away" if side == "home" else "home"
            if days == 0:
                cands.append(KeyFactor(f"{team.name} on the second night of a back-to-back", 0.5, other, "rest"))
            elif days is not None and days >= 3:
                cands.append(KeyFactor(f"{team.name} have had {days} days' rest", 0.25, side, "rest"))
        net_h, net_a = pf_h - pa_h, pf_a - pa_a
        if abs(net_h - net_a) >= 6 and min(home.games, away.games) >= 5:
            better, worse, bside = (home, away, "home") if net_h > net_a else (away, home, "away")
            bn, wn = max(net_h, net_a), min(net_h, net_a)
            cands.append(KeyFactor(f"{better.name} outscoring opponents by {bn:+.1f} a game ({worse.name} {wn:+.1f})", min(1.0, 0.3 + abs(net_h - net_a) / 30), bside, "attack"))
        cands.append(data_factor(home, away, p.min_games))
        fillers = [rating_factor(home, away, elo_diff, inp.neutral), home_advantage_factor(home, inp.neutral, f"about {p.home_court_pts:.1f} points"),
                   KeyFactor(f"Scoring: {home.name} {pf_h:.0f} pts/game, {away.name} {pf_a:.0f} pts/game", 0.1, "neutral", "attack")]
        return select_factors(cands, fillers)


def _rest_text(days: Optional[int]) -> str:
    if days is None:
        return "season opener"
    if days == 0:
        return "back-to-back"
    return f"{days} day{'s' if days != 1 else ''} rest"
