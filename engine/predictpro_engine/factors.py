"""Plain-language key factors.

Every model produces candidate factors with an impact score in [0, 1]; `select_factors`
picks the 3-5 most informative ones with per-category caps so the list stays varied.
"""

from __future__ import annotations

from typing import Iterable, Optional, Sequence

from .types import Absence, FinishedMatch, Favours, GameRecord, KeyFactor, TeamState

MIN_FACTORS = 3
MAX_FACTORS = 5
MAX_PER_CATEGORY = 2


def _plural(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


def poss(name: str) -> str:
    """English possessive: Arsenal's, Pistons'."""
    return f"{name}'" if name.endswith('s') else f"{name}'s"


def run_length(records: Sequence[GameRecord], predicate) -> int:
    """How many of the most recent games (newest first) satisfy `predicate`."""
    n = 0
    for r in records:
        if not predicate(r):
            break
        n += 1
    return n


def form_string(records: Sequence[GameRecord], n: int = 5) -> str:
    """e.g. 'WWDLW' (newest first)."""
    return "".join(r.result for r in records[:n])


def form_factors(team: TeamState, side: Favours, has_draws: bool) -> list[KeyFactor]:
    rec = team.recent
    out: list[KeyFactor] = []
    if not rec:
        return out
    st = team.streaks
    wins = st.get("win", run_length(rec, lambda r: r.result == "W"))
    losses = st.get("loss", run_length(rec, lambda r: r.result == "L"))
    other: Favours = "away" if side == "home" else "home"
    if wins >= 3:
        out.append(KeyFactor(f"{team.name} have won {wins} in a row", min(1.0, 0.25 + 0.08 * wins), side, "form"))
    elif has_draws:
        unbeaten = st.get("unbeaten", run_length(rec, lambda r: r.result != "L"))
        if unbeaten >= 4:
            out.append(KeyFactor(f"{team.name} unbeaten in {unbeaten}", min(1.0, 0.2 + 0.06 * unbeaten), side, "form"))
    if losses >= 3:
        out.append(KeyFactor(f"{team.name} have lost {losses} in a row", min(1.0, 0.25 + 0.08 * losses), other, "form"))
    elif has_draws:
        winless = st.get("winless", run_length(rec, lambda r: r.result != "W"))
        if winless >= 5:
            out.append(KeyFactor(f"{team.name} without a win in {winless}", min(1.0, 0.2 + 0.05 * winless), other, "form"))

    last = rec[:10] if not has_draws else rec[:5]
    if len(last) >= 5 and not out:
        w = sum(1 for r in last if r.result == "W")
        if has_draws:
            pts = sum(3 if r.result == "W" else 1 if r.result == "D" else 0 for r in last)
            if pts >= 11:
                out.append(KeyFactor(f"{team.name} took {pts} of {3 * len(last)} points from their last {len(last)}", 0.35, side, "form"))
            elif pts <= 4:
                out.append(KeyFactor(f"{team.name} took just {pts} of {3 * len(last)} points from their last {len(last)}", 0.35, other, "form"))
        else:
            if w >= 0.7 * len(last):
                out.append(KeyFactor(f"{team.name} have won {w} of their last {len(last)}", 0.35, side, "form"))
            elif w <= 0.3 * len(last):
                out.append(KeyFactor(f"{team.name} have won only {w} of their last {len(last)}", 0.35, other, "form"))
    return out


def venue_factor(team: TeamState, side: Favours, at_home: bool, has_draws: bool) -> Optional[KeyFactor]:
    games = [r for r in team.recent if r.is_home == at_home][:8]
    if len(games) < 4:
        return None
    w = sum(1 for r in games if r.result == "W")
    lost = sum(1 for r in games if r.result == "L")
    where = "at home" if at_home else "away"
    other: Favours = "away" if side == "home" else "home"
    if w / len(games) >= 0.7:
        return KeyFactor(f"{team.name} have won {w} of their last {len(games)} {where}", 0.3 + 0.2 * (w / len(games) - 0.7) / 0.3, side, "venue")
    if lost / len(games) >= 0.6:
        return KeyFactor(f"{team.name} have lost {lost} of their last {len(games)} {where}", 0.3, other, "venue")
    if has_draws and at_home and lost == 0 and len(games) >= 5:
        return KeyFactor(f"{team.name} unbeaten in their last {len(games)} at home", 0.3, side, "venue")
    return None


def h2h_factor(h2h: Sequence[FinishedMatch], home: TeamState, away: TeamState) -> Optional[KeyFactor]:
    if len(h2h) < 3:
        return None
    hw = sum(1 for m in h2h if (m.home == home.team and m.home_score > m.away_score) or (m.away == home.team and m.away_score > m.home_score))
    aw = sum(1 for m in h2h if (m.home == away.team and m.home_score > m.away_score) or (m.away == away.team and m.away_score > m.home_score))
    n = len(h2h)
    if hw >= 0.6 * n:
        return KeyFactor(f"{home.name} won {hw} of the last {n} meetings", 0.25 + 0.15 * hw / n, "home", "h2h")
    if aw >= 0.6 * n:
        return KeyFactor(f"{away.name} won {aw} of the last {n} meetings", 0.25 + 0.15 * aw / n, "away", "h2h")
    return None


def absence_factors(team: TeamState, side: Favours, absences: Iterable[Absence]) -> list[KeyFactor]:
    absences = [a for a in absences if a.importance >= 0.3]
    if not absences:
        return []
    other: Favours = "away" if side == "home" else "home"
    out: list[KeyFactor] = []
    absences.sort(key=lambda a: a.weight, reverse=True)
    top = absences[0]
    reason = {"injured": "is injured", "suspended": "is suspended", "doubtful": "is a doubt"}.get(top.reason, "is unavailable")
    if top.tag == "top_scorer":
        text = f"{poss(team.name)} top scorer {top.player} {reason}"
    elif top.tag in ("star", "captain"):
        label = "captain" if top.tag == "captain" else "star player"
        text = f"{team.name} {label} {top.player} {reason}"
    else:
        text = f"{poss(team.name)} {top.player} {reason}"
    out.append(KeyFactor(text, min(1.0, 0.3 + 0.6 * top.weight), other, "absences"))
    serious = [a for a in absences if a.reason != "doubtful"]
    if len(serious) >= 3:
        out.append(KeyFactor(f"{team.name} missing {_plural(len(serious), 'key player')}", min(1.0, 0.25 + 0.1 * len(serious)), other, "absences"))
    return out


def rating_factor(home: TeamState, away: TeamState, diff_incl_home: float, neutral: bool) -> KeyFactor:
    gap = home.elo - away.elo
    if abs(gap) < 40:
        return KeyFactor(f"Evenly matched on ratings (Elo {home.elo:.0f} vs {away.elo:.0f})", 0.2, "neutral", "rating")
    fav, dog = (home, away) if gap > 0 else (away, home)
    side: Favours = "home" if gap > 0 else "away"
    strength = "much stronger" if abs(gap) >= 150 else "stronger"
    return KeyFactor(f"{fav.name} rated {strength} (Elo {fav.elo:.0f} vs {dog.elo:.0f})", min(1.0, 0.25 + abs(gap) / 400), side, "rating")


def home_advantage_factor(home: TeamState, neutral: bool, detail: str) -> KeyFactor:
    if neutral:
        return KeyFactor("Neutral venue: no home advantage applied", 0.15, "neutral", "venue")
    return KeyFactor(f"Home advantage for {home.name} ({detail})", 0.15, "home", "venue")


def data_factor(home: TeamState, away: TeamState, min_games: int = 5) -> Optional[KeyFactor]:
    few = [t for t in (home, away) if t.games < min_games]
    if not few:
        return None
    t = min(few, key=lambda x: x.games)
    return KeyFactor(f"Limited data: {t.name} have only {_plural(t.games, 'recorded match')}", 0.3, "neutral", "data")


def select_factors(candidates: Iterable[Optional[KeyFactor]], fillers: Iterable[Optional[KeyFactor]] = ()) -> list[KeyFactor]:
    """Pick 3-5 factors: highest impact first, at most 2 per category, no duplicate text."""
    pool = sorted((c for c in candidates if c is not None), key=lambda f: f.impact, reverse=True)
    chosen: list[KeyFactor] = []
    per_cat: dict[str, int] = {}
    for f in pool:
        if len(chosen) >= MAX_FACTORS:
            break
        if per_cat.get(f.category, 0) >= MAX_PER_CATEGORY or any(c.text == f.text for c in chosen):
            continue
        chosen.append(f)
        per_cat[f.category] = per_cat.get(f.category, 0) + 1
    for f in fillers:
        if len(chosen) >= MIN_FACTORS:
            break
        if f is not None and all(c.text != f.text for c in chosen):
            chosen.append(f)
    return chosen
