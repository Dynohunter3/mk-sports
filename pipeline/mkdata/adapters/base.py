"""The one interface every provider implements."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from ..http import FetchError, HttpClient
from ..sources import REGISTRY, SourceSpec

CONFIG = Path(__file__).resolve().parents[2] / "config"


def load_competitions() -> dict[str, dict]:
    raw = json.loads((CONFIG / "competitions.json").read_text())
    return {k: v for k, v in raw.items() if not k.startswith("_")}


@dataclass
class FetchResult:
    """Rows in the store's shapes. Odds and stats are keyed ``match_key = "<source>:<source_key>"``
    (the source's own row); reads join through ``source_matches.match_id`` to the canonical match."""

    matches: list[dict] = field(default_factory=list)
    odds: list[dict] = field(default_factory=list)
    stats: list[dict] = field(default_factory=list)
    ratings: list[dict] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def __len__(self) -> int:
        return len(self.matches) + len(self.odds) + len(self.stats) + len(self.ratings)

    def extend(self, other: "FetchResult") -> None:
        self.matches += other.matches
        self.odds += other.odds
        self.stats += other.stats
        self.ratings += other.ratings
        self.notes += other.notes


class Unsupported(Exception):
    """This source does not cover the requested competition/season."""


class Adapter:
    name: str = ""

    def __init__(self, http: HttpClient, competitions: dict[str, dict] | None = None):
        self.http = http
        self.comps = competitions or load_competitions()
        self.spec: SourceSpec = REGISTRY[self.name]

    def usable(self) -> tuple[bool, str]:
        return self.spec.usable()

    def covers(self, comp_id: str) -> bool:
        return self.code(comp_id) is not None

    def code(self, comp_id: str) -> str | None:
        return self.comps.get(comp_id, {}).get(self.name)

    # Implementations override what they support.
    def fetch_season(self, comp_id: str, season: str) -> FetchResult:
        raise Unsupported(f"{self.name}: no season history")

    def fetch_upcoming(self, comp_ids: list[str]) -> FetchResult:
        raise Unsupported(f"{self.name}: no upcoming data")

    def health(self) -> tuple[bool, str]:
        """Cheap liveness probe. Default: usable() only."""
        return self.usable()

    def _get(self, url: str, **kw):
        kw.setdefault("min_interval", self.spec.min_interval_s)
        try:
            return self.http.get(url, **kw)
        except FetchError as e:
            if e.status == 404:  # the source simply has no file for this season: coverage, not an outage
                raise Unsupported(f"{self.name}: not published ({e.url})") from None
            raise


def mkey(source: str, source_key: str) -> str:
    return f"{source}:{source_key}"
