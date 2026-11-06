"""Confidence levels: how sure the model is AND how much we trust its inputs."""

from __future__ import annotations

from dataclasses import dataclass

from .types import Confidence

LEVELS: tuple[Confidence, ...] = ("low", "medium", "high")


@dataclass(frozen=True)
class ConfidenceThresholds:
    high: float  # top outcome probability needed for "high"
    medium: float  # ... and for "medium"
    min_games: int = 5  # fewer games than this for either team -> one level lower


def confidence_level(
    top_probability: float,
    thresholds: ConfidenceThresholds,
    min_games_played: int,
    components_disagree: bool = False,
) -> tuple[Confidence, list[str]]:
    """Return (level, reasons). Reasons are shown in the 'how this was made' section."""
    if top_probability >= thresholds.high:
        idx, reasons = 2, [f"Favourite has a {top_probability:.0%} chance"]
    elif top_probability >= thresholds.medium:
        idx, reasons = 1, [f"Favourite has a {top_probability:.0%} chance"]
    else:
        idx, reasons = 0, [f"No outcome above {thresholds.medium:.0%}: a close match"]
    if min_games_played < thresholds.min_games:
        idx -= 1
        reasons.append(f"Limited data (a team has played fewer than {thresholds.min_games} recorded matches)")
    if components_disagree:
        idx -= 1
        reasons.append("Ratings and recent scoring disagree on the favourite")
    return LEVELS[max(0, idx)], reasons
