"""Football: Elo ratings + Poisson goal model.

1. Elo gives a long-run strength for each team (cross-competition, so Champions League
   games link the domestic leagues).
2. An online Maher-style model tracks attack/defence strength relative to the
   competition average, updated after every match with exponential weighting.
3. Expected goals = competition average x attack x opponent defence. Elo's view of the
   goal supremacy is blended in, then key absences adjust the expected goals.
4. A Poisson score grid (with a Dixon-Coles low-score correction) gives the result
   probabilities and the most likely scoreline.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Optional

from .book import RatingBook
from .confidence import ConfidenceThresholds, confidence_level
from .elo import EloConfig, football_mov_multiplier
from .factors import (
    absence_factors,
    data_factor,
    form_factors,
    h2h_factor,
    home_advantage_factor,
    rating_factor,
    select_factors,
    venue_factor,
)
from .params import merge_params
from .stats import clamp, most_likely_score, outcome_probabilities, score_matrix
from .types import Absence, FinishedMatch, KeyFactor, MatchInput, Prediction


@dataclass(frozen=True)
class FootballParams:
    k: float = 20.0
    home_advantage_elo: float = 65.0
    initial_elo: float = 1500.0
    elo_points_per_goal: float = 250.0  # Elo gap that corresponds to one goal of supremacy
    elo_weight: float = 0.5  # weight of Elo vs attack/defence when setting goal supremacy
    strength_alpha: float = 0.12  # EWMA weight of the latest match for attack/defence (~8 game memory)
    league_avg_alpha: float = 0.02
    default_home_goals: float = 1.55
    default_away_goals: float = 1.25
    total_shrink: float = 0.3  # pull expected total goals toward the league average
    dixon_coles_rho: float = -0.08
    max_goals: int = 10
    high_confidence: float = 0.60
    medium_confidence: float = 0.45
    min_games: int = 5


class FootballBook(RatingBook):
    sport = "football"

    def __init__(self, params: FootballParams, initial_ratings: Optional[dict[str, float]] = None):
        super().__init__(
            EloConfig(k=params.k, home_advantage=params.home_advantage_elo, initial=params.initial_elo),
            initial_ratings=initial_ratings,
        )
        self.p = params
        self.attack: dict[str, float] = {}
        self.defence: dict[str, float] = {}
        self.avgs: dict[str, tuple[float, float]] = {}

    def _league_averages(self, competition: str) -> tuple[float, float]:
        return self.avgs.get(competition, (self.p.default_home_goals, self.p.default_away_goals))

    def _update_stats(self, m: FinishedMatch) -> None:
        a = self.p.strength_alpha
        avg_h, avg_a = self._league_averages(m.competition)
        if m.neutral:
            avg_h = avg_a = (avg_h + avg_a) / 2
        att_h, def_h = self.attack.get(m.home, 1.0), self.defence.get(m.home, 1.0)
        att_a, def_a = self.attack.get(m.away, 1.0), self.defence.get(m.away, 1.0)
        # Each observation is opponent-adjusted: 2 goals against a strong defence count for more.
        obs_att_h = clamp(m.home_score / max(0.2, avg_h * def_a), 0.0, 4.0)
        obs_def_h = clamp(m.away_score / max(0.2, avg_a * att_a), 0.0, 4.0)
        obs_att_a = clamp(m.away_score / max(0.2, avg_a * def_h), 0.0, 4.0)
        obs_def_a = clamp(m.home_score / max(0.2, avg_h * att_h), 0.0, 4.0)
        self.attack[m.home] = (1 - a) * att_h + a * obs_att_h
        self.defence[m.home] = (1 - a) * def_h + a * obs_def_h
        self.attack[m.away] = (1 - a) * att_a + a * obs_att_a
        self.defence[m.away] = (1 - a) * def_a + a * obs_def_a
        if not m.neutral:
            b = self.p.league_avg_alpha
            cur_h, cur_a = self._league_averages(m.competition)
            self.avgs[m.competition] = ((1 - b) * cur_h + b * m.home_score, (1 - b) * cur_a + b * m.away_score)

    def _regress_stats(self, team: str) -> None:
        for d in (self.attack, self.defence):
            if team in d:
                d[team] = d[team] + (1.0 - d[team]) / 3

    def _mov_multiplier(self, m: FinishedMatch, elo_diff_home: float) -> float:
        return football_mov_multiplier(m.home_score - m.away_score)

    def team_state(self, team: str, name: Optional[str] = None):
        st = super().team_state(team, name)
        st.attack = self.attack.get(team, 1.0)
        st.defence = self.defence.get(team, 1.0)
        return st


def _absence_penalties(absences: tuple[Absence, ...]) -> tuple[float, float, list[str]]:
    """(attack reduction, defence weakening, notes). Both capped at 30%."""
    att = dfn = 0.0
    notes: list[str] = []
    for a in absences:
        pos = a.position.upper()
        w = a.weight
        if pos in ("FWD", "FW", "ST", "F"):
            att += 0.10 * w
        elif pos in ("MID", "MF", "M"):
            att += 0.05 * w
            dfn += 0.03 * w
        elif pos in ("DEF", "DF", "D"):
            dfn += 0.07 * w
        elif pos in ("GK", "G"):
            dfn += 0.08 * w
        else:
            att += 0.04 * w
            dfn += 0.03 * w
        if w > 0:
            notes.append(a.player)
    return min(att, 0.3), min(dfn, 0.3), notes


class FootballModel:
    sport = "football"
    name = "football-elo-poisson"
    version = "1.0.0"
    has_draws = True

    def __init__(self, params: Optional[Mapping] = None, league_params: Optional[Mapping[str, Mapping]] = None):
        self.params = merge_params(FootballParams(), params)
        self.league_params = {k: merge_params(self.params, v) for k, v in (league_params or {}).items()}

    def params_for(self, competition: str) -> FootballParams:
        return self.league_params.get(competition, self.params)

    def new_book(self, initial_ratings: Optional[dict[str, float]] = None) -> FootballBook:
        return FootballBook(self.params, initial_ratings)

    def predict(self, inp: MatchInput) -> Prediction:
        p = self.params_for(inp.competition)
        home, away = inp.home, inp.away
        ha = 0.0 if inp.neutral else p.home_advantage_elo
        elo_diff = home.elo + ha - away.elo

        avg_h = inp.league_avg_home or p.default_home_goals
        avg_a = inp.league_avg_away or p.default_away_goals
        if inp.neutral:
            avg_h = avg_a = (avg_h + avg_a) / 2

        # Attack/defence view of expected goals
        lam_h_ad = avg_h * home.attack * away.defence
        lam_a_ad = avg_a * away.attack * home.defence
        total = (1 - p.total_shrink) * (lam_h_ad + lam_a_ad) + p.total_shrink * (avg_h + avg_a)
        sup_ad = lam_h_ad - lam_a_ad
        sup_elo = elo_diff / p.elo_points_per_goal
        sup = p.elo_weight * sup_elo + (1 - p.elo_weight) * sup_ad
        lam_h = max(0.15, (total + sup) / 2)
        lam_a = max(0.15, (total - sup) / 2)
        base_lam_h, base_lam_a = lam_h, lam_a

        # Team news
        h_att, h_def, h_notes = _absence_penalties(inp.home_absences)
        a_att, a_def, a_notes = _absence_penalties(inp.away_absences)
        lam_h *= (1 - h_att) * (1 + a_def)
        lam_a *= (1 - a_att) * (1 + h_def)

        grid = score_matrix(lam_h, lam_a, p.max_goals, p.dixon_coles_rho)
        ph, pd, pa = outcome_probabilities(grid)
        probs = {"home": ph, "draw": pd, "away": pa}
        fav = max(probs, key=probs.get)
        score = most_likely_score(grid, fav)

        disagree = abs(sup_elo) > 0.15 and abs(sup_ad) > 0.15 and (sup_elo > 0) != (sup_ad > 0)
        conf, conf_reasons = confidence_level(
            probs[fav],
            ConfidenceThresholds(p.high_confidence, p.medium_confidence, p.min_games),
            min(home.games, away.games),
            disagree,
        )

        factors = self._factors(inp, p, elo_diff)
        explanation = self._explain(inp, p, ha, elo_diff, lam_h_ad, lam_a_ad, base_lam_h, base_lam_a, lam_h, lam_a,
                                    (h_att, h_def, h_notes), (a_att, a_def, a_notes), probs, score, fav, conf_reasons, factors)
        return Prediction(
            sport=self.sport,
            model=self.name,
            model_version=self.version,
            prob_home=round(ph, 4),
            prob_draw=round(pd, 4),
            prob_away=round(pa, 4),
            predicted_home=score[0],
            predicted_away=score[1],
            expected_home=round(lam_h, 2),
            expected_away=round(lam_a, 2),
            confidence=conf,
            key_factors=factors,
            explanation=explanation,
        )

    # ----------------------------------------------------------------- factors
    def _factors(self, inp: MatchInput, p: FootballParams, elo_diff: float) -> list[KeyFactor]:
        home, away = inp.home, inp.away
        cands: list[Optional[KeyFactor]] = [rating_factor(home, away, elo_diff, inp.neutral)]
        cands += form_factors(home, "home", True) + form_factors(away, "away", True)
        if not inp.neutral:
            cands.append(venue_factor(home, "home", True, True))
            cands.append(venue_factor(away, "away", False, True))
        cands += absence_factors(home, "home", inp.home_absences) + absence_factors(away, "away", inp.away_absences)
        cands.append(h2h_factor(inp.h2h, home, away))
        cands += _scoring_factors(home, "home") + _scoring_factors(away, "away")
        cands.append(data_factor(home, away, p.min_games))
        ha_goals = p.home_advantage_elo / p.elo_points_per_goal
        fillers = [rating_factor(home, away, elo_diff, inp.neutral), home_advantage_factor(home, inp.neutral, f"worth about {ha_goals:.1f} goals"),
                   _attack_compare(home, away)]
        return select_factors(cands, fillers)

    # ------------------------------------------------------------- explanation
    def _explain(self, inp, p, ha, elo_diff, lam_h_ad, lam_a_ad, base_h, base_a, lam_h, lam_a, h_abs, a_abs, probs, score, fav, conf_reasons, factors) -> dict:
        home, away = inp.home, inp.away
        steps = [
            {
                "title": "Team strength (Elo)",
                "detail": f"{home.name} {home.elo:.0f} vs {away.name} {away.elo:.0f}"
                + ("; neutral venue" if inp.neutral else f"; +{ha:.0f} home advantage")
                + f" -> {'+' if elo_diff >= 0 else ''}{elo_diff:.0f} for {home.name}",
            },
            {
                "title": "Attack & defence (recent matches, weighted)",
                "detail": f"{home.name} attack {home.attack:.2f}x / defence {home.defence:.2f}x league average; "
                f"{away.name} attack {away.attack:.2f}x / defence {away.defence:.2f}x (defence below 1 = concedes less)",
            },
            {
                "title": "Expected goals",
                "detail": f"Attack/defence alone: {lam_h_ad:.2f}-{lam_a_ad:.2f}. Blended with Elo ({p.elo_weight:.0%} weight): {base_h:.2f}-{base_a:.2f}",
            },
        ]
        news = []
        for team, (att, dfn, notes) in ((home, h_abs), (away, a_abs)):
            if notes:
                parts = ([f"attack -{att:.0%}"] if att >= 0.005 else []) + ([f"defence weaker by {dfn:.0%}"] if dfn >= 0.005 else [])
                news.append(f"{team.name}: {', '.join(parts) or 'minor impact'} ({', '.join(notes[:3])} out)")
        if news:
            steps.append({"title": "Team news", "detail": "; ".join(news) + f". Adjusted expected goals: {lam_h:.2f}-{lam_a:.2f}"})
        steps.append(
            {
                "title": "Outcome probabilities",
                "detail": f"Poisson score grid -> {home.name} {probs['home']:.0%}, draw {probs['draw']:.0%}, {away.name} {probs['away']:.0%}. "
                f"Most likely {fav} score: {score[0]}-{score[1]}",
            }
        )
        steps.append({"title": "Confidence", "detail": "; ".join(conf_reasons)})
        return {
            "method": "Elo ratings + Poisson goal model",
            "summary": _summary(home.name, away.name, probs, fav, score, factors, p.medium_confidence),
            "steps": steps,
            "inputs": {
                "elo_home": round(home.elo, 1),
                "elo_away": round(away.elo, 1),
                "home_advantage_elo": ha,
                "attack_home": round(home.attack, 3),
                "defence_home": round(home.defence, 3),
                "attack_away": round(away.attack, 3),
                "defence_away": round(away.defence, 3),
                "league_avg_home_goals": round(inp.league_avg_home or p.default_home_goals, 3),
                "league_avg_away_goals": round(inp.league_avg_away or p.default_away_goals, 3),
                "expected_goals_home": round(lam_h, 3),
                "expected_goals_away": round(lam_a, 3),
                "games_home": home.games,
                "games_away": away.games,
                "absences_home": [a.player for a in inp.home_absences],
                "absences_away": [a.player for a in inp.away_absences],
            },
        }


def _scoring_factors(team, side) -> list[KeyFactor]:
    last = team.recent[:5]
    if len(last) < 5:
        return []
    other = "away" if side == "home" else "home"
    gf = sum(r.scored for r in last) / len(last)
    ga = sum(r.conceded for r in last) / len(last)
    clean = sum(1 for r in last if r.conceded == 0)
    out = []
    if gf >= 2.2:
        out.append(KeyFactor(f"{team.name} averaging {gf:.1f} goals in their last 5", 0.3 + min(0.3, (gf - 2.2) / 4), side, "attack"))
    elif gf <= 0.6:
        out.append(KeyFactor(f"{team.name} have scored just {sum(r.scored for r in last)} in their last 5", 0.35, other, "attack"))
    if clean >= 3:
        out.append(KeyFactor(f"{team.name} kept {clean} clean sheets in their last 5", 0.3 + 0.05 * clean, side, "defence"))
    elif ga >= 2.2:
        out.append(KeyFactor(f"{team.name} conceding {ga:.1f} goals per game lately", 0.3, other, "defence"))
    return out


def _attack_compare(home, away) -> KeyFactor:
    better, worse = (home, away) if home.attack >= away.attack else (away, home)
    side = "home" if better is home else "away"
    return KeyFactor(f"{better.name} carry the stronger attack ({better.attack:.2f}x vs {worse.attack:.2f}x league average)", 0.12, side, "attack")


def _summary(home: str, away: str, probs: dict, fav: str, score: tuple[int, int], factors: list[KeyFactor], medium: float) -> str:
    top = probs[fav]
    if fav == "draw":
        head = f"A draw is the single most likely result ({top:.0%})"
    elif top < medium:
        head = f"Too close to call, with {home if fav == 'home' else away} marginally favoured ({top:.0%})"
    else:
        head = f"{home if fav == 'home' else away} are favourites ({top:.0%})"
    reason = next((f.text for f in factors if f.favours == fav), None)
    tail = f" Most likely score {score[0]}-{score[1]}."
    return head + (f". {reason}." if reason else ".") + tail
