"""Source registry: what each source provides, what it costs, its limits, and what its terms allow.

This file is the single source of truth; ``docs/SOURCE_REGISTRY.md`` is generated from it
(``python -m mkdata registry-doc``). ``terms`` records what was actually read on ``terms_checked``;
nothing here is assumed. A source is only fetched when ``usable()`` is true: terms permit it, it
is not excluded, and any key it needs is present in the server-side environment.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

# Data categories (STEP 2 of the brief)
RESULTS = "fixtures_results"
STANDINGS = "standings"
ADV_STATS = "advanced_stats"
RATINGS = "ratings"
LINEUPS = "lineups_injuries"
SCHEDULE = "schedule_context"
ODDS_HIST = "odds_historical"
ODDS_LIVE = "odds_current"

# Terms status
PERMITTED = "permitted"  # terms read; our use is allowed
PERMITTED_ATTRIBUTION = "permitted_with_attribution"
RESTRICTED = "restricted"  # terms read; they forbid our use -> never fetched by the pipeline
UNVERIFIED = "unverified"  # terms could not be read from here -> not fetched until checked
EXCLUDED = "excluded"  # rejected for another reason (offline, brief says no, no official access)


@dataclass(frozen=True)
class SourceSpec:
    name: str
    title: str
    provides: tuple[str, ...]
    sports: tuple[str, ...]
    cost: str
    rate_limit: str
    terms: str
    terms_status: str
    terms_url: str
    terms_checked: str  # ISO date the terms/robots were read
    reliability: float  # prior weight used by conflict rules, 0..1 (higher wins ties)
    key_env: str | None = None  # server-side environment variable holding the key
    min_interval_s: float = 1.0  # politeness / published rate limit, per host
    attribution: str | None = None
    notes: str = ""
    homepage: str = ""
    implemented: bool = False
    limits: dict = field(default_factory=dict)

    def key(self) -> str | None:
        return os.environ.get(self.key_env) if self.key_env else None

    def usable(self) -> tuple[bool, str]:
        if not self.implemented:
            return False, "no adapter"
        if self.terms_status in (RESTRICTED, UNVERIFIED, EXCLUDED):
            return False, f"terms: {self.terms_status}"
        if self.key_env and not self.key():
            return False, f"no key in ${self.key_env}"
        return True, "ok"


CHECKED = "2026-11-06"

REGISTRY: dict[str, SourceSpec] = {
    s.name: s
    for s in [
        SourceSpec(
            name="footballdata_uk",
            title="football-data.co.uk CSV files",
            homepage="https://www.football-data.co.uk/data.php",
            provides=(RESULTS, ADV_STATS, ODDS_HIST, ODDS_LIVE, SCHEDULE),
            sports=("football",),
            cost="free, no sign-up",
            rate_limit="none published; we wait 2 s between files and cache them",
            min_interval_s=2.0,
            terms=(
                "Free CSV downloads offered for users. The disclaimer only limits liability and "
                "gambling advice; it places no restriction on using the data. robots.txt allows all "
                "agents except named AI-training crawlers (GPTBot, anthropic-ai, Google-Extended, ...)."
            ),
            terms_status=PERMITTED,
            terms_url="https://www.football-data.co.uk/disclaimer.php",
            terms_checked=CHECKED,
            reliability=0.9,
            notes=(
                "Results, half-time, referee, shots, shots on target, corners, cards; pre-match odds "
                "(collected Friday/Tuesday afternoon) and closing odds (Pinnacle, market average, Bet365). "
                "fixtures.csv has odds for the next round. Main + lower divisions of 11 countries, MLS in new/USA.csv. "
                "Kick-off times are UK local time."
            ),
            implemented=True,
        ),
        SourceSpec(
            name="openfootball",
            title="openfootball football.json (GitHub)",
            homepage="https://github.com/openfootball/football.json",
            provides=(RESULTS, SCHEDULE),
            sports=("football",),
            cost="free, no sign-up",
            rate_limit="GitHub raw file hosting; we wait 1 s between files and cache them",
            terms="Dedicated to the public domain: 'Use as you please with no restrictions whatsoever.'",
            terms_status=PERMITTED,
            terms_url="https://github.com/openfootball/football.json#license",
            terms_checked=CHECKED,
            reliability=0.75,
            notes=(
                "Community-maintained fixtures and results with full club names. Top 9 European leagues, "
                "English League One/Two, MLS, Champions League (2024-25), World Cup 2026. "
                "Kick-off times are local; no odds or stats. Fully independent of football-data.co.uk. "
                "Measured (Step 2): 100% score agreement with football-data.co.uk in the top divisions, but its "
                "2025-26 League One/Two files are faulty (276 wrong-year dates, 11-12% scores disagree, times 1 h off) "
                "and it lags: 31-50% of current-season results older than 3 days are missing."
            ),
            implemented=True,
        ),
        SourceSpec(
            name="football_data_org",
            title="football-data.org API v4 (free tier)",
            homepage="https://www.football-data.org/",
            provides=(RESULTS, STANDINGS, SCHEDULE),
            sports=("football",),
            cost="free tier (12 competitions, delayed scores); paid from EUR 12/month",
            rate_limit="10 calls/minute on the free tier",
            min_interval_s=6.5,
            terms=(
                "Terms and Conditions (about page): one API key per application, fair use, keys must "
                "not be committed to open-source repositories, and the app must show the attribution "
                "'Football data provided by the Football-Data.org API'. No ban on apps or commercial use found."
            ),
            terms_status=PERMITTED_ATTRIBUTION,
            terms_url="https://www.football-data.org/about",
            terms_checked=CHECKED,
            reliability=0.95,
            key_env="FOOTBALL_DATA_ORG_KEY",
            attribution="Football data provided by the Football-Data.org API",
            notes="UTC kick-off times and official match status. Needs a free sign-up (you).",
            implemented=True,
        ),
        SourceSpec(
            name="the_odds_api",
            title="The Odds API v4 (free Starter plan)",
            homepage="https://the-odds-api.com/",
            provides=(ODDS_LIVE, RESULTS),
            sports=("football", "basketball", "american-football", "hockey", "baseball"),
            cost="free Starter plan: 500 credits/month; paid from USD 30/month (historical odds are paid)",
            rate_limit="credit-based quota; we stop when the remaining-credits header falls below a reserve",
            min_interval_s=1.0,
            terms=(
                "Explicitly allows storing the data indefinitely, showing it in a mobile app (including "
                "commercially), deriving values from it, and training statistical/ML models. Forbids "
                "reselling or redistributing it as a raw data feed or API."
            ),
            terms_status=PERMITTED,
            terms_url="https://the-odds-api.com/terms-and-conditions.html",
            terms_checked=CHECKED,
            reliability=0.9,
            key_env="THE_ODDS_API_KEY",
            notes=(
                "Current pre-match odds for every sport we cover, multiple bookmakers. The key travels in "
                "the query string, so it is only ever used server-side. Needs a free sign-up (you)."
            ),
            implemented=True,
            limits={"credit_reserve": 50},
        ),
        SourceSpec(
            name="balldontlie",
            title="BALLDONTLIE NBA API (free tier)",
            homepage="https://www.balldontlie.io/",
            provides=(RESULTS, SCHEDULE),
            sports=("basketball",),
            cost="free: 5 requests/minute, basic data; box scores/advanced stats from USD 9.99/month",
            rate_limit="5 requests/minute on the free tier",
            min_interval_s=12.5,
            terms=(
                "Allows any lawful personal or commercial use, including paid apps and analytics, with no "
                "credit required. Forbids offering a substitute sports-data API, evading rate limits, and "
                "using the data to accept, grade or settle wagers without verification."
            ),
            terms_status=PERMITTED,
            terms_url="https://www.balldontlie.io/terms",
            terms_checked=CHECKED,
            reliability=0.85,
            key_env="BALLDONTLIE_API_KEY",
            notes="Second independent NBA results/schedule source. Needs a free sign-up (you).",
            implemented=True,
        ),
        SourceSpec(
            name="internal_elo",
            title="Our own Elo ratings (computed in mkdata.ratings)",
            homepage="",
            provides=(RATINGS,),
            sports=("football", "basketball", "american-football", "hockey", "baseball"),
            cost="free (computed from permitted results)",
            rate_limit="n/a",
            terms="Derived from permitted sources only.",
            terms_status=PERMITTED,
            terms_url="",
            terms_checked=CHECKED,
            reliability=0.8,
            implemented=True,
        ),
        SourceSpec(
            name="clubelo",
            title="ClubElo API",
            homepage="http://clubelo.com/API",
            provides=(RATINGS,),
            sports=("football",),
            cost="free, no sign-up",
            rate_limit="none published",
            min_interval_s=2.0,
            terms=(
                "Not verified: clubelo.com and api.clubelo.com could not be reached from this environment "
                "(connection reset at the network edge, 6 Nov 2026), so neither the site nor its terms "
                "could be read."
            ),
            terms_status=UNVERIFIED,
            terms_url="http://clubelo.com/",
            terms_checked=CHECKED,
            reliability=0.85,
            notes="Adapter is written and tested offline; it stays off until the terms are read and the host answers.",
            implemented=True,
        ),
        SourceSpec(
            name="espn",
            title="ESPN site/core/web APIs (undocumented)",
            homepage="https://www.espn.com/",
            provides=(RESULTS, STANDINGS, ADV_STATS, LINEUPS, ODDS_HIST, ODDS_LIVE),
            sports=("football", "basketball", "american-football", "hockey", "baseball"),
            cost="free, undocumented",
            rate_limit="none published",
            terms=(
                "Disney Terms of Use (which cover ESPN) forbid, without written permission: commercial or "
                "business use or building a business on Disney products (B.viii) and accessing, copying or "
                "extracting them 'using a robot, spider, script, or other automated means', including for "
                "data mining or 'compiling, building, creating or contributing to any collection of data, "
                "data set or database' (B.x). www.espn.com/robots.txt also blocks AI crawlers outright."
            ),
            terms_status=RESTRICTED,
            terms_url="https://disneytermsofuse.com/english/",
            terms_checked=CHECKED,
            reliability=0.8,
            notes=(
                "The current app (1.4.1) reads ESPN directly on each phone, and the Step 1 audit downloaded "
                "ESPN history. The pipeline does not fetch ESPN. Keeping, licensing or replacing ESPN in the "
                "app is the owner's decision."
            ),
            implemented=False,
        ),
        SourceSpec(
            name="nba_com",
            title="NBA.com stats and injury report",
            homepage="https://www.nba.com/stats",
            provides=(ADV_STATS, LINEUPS),
            sports=("basketball",),
            cost="free, undocumented",
            rate_limit="n/a",
            terms=(
                "NBA.com Terms of Use, 'NBA Statistics': only for news reporting or private non-commercial "
                "use; not 'in connection with any gambling activity', 'any fantasy game or other commercial "
                "product or service', or a regularly updated statistics database. robots.txt disallows /api/*."
            ),
            terms_status=RESTRICTED,
            terms_url="https://www.nba.com/termsofuse",
            terms_checked=CHECKED,
            reliability=0.95,
            notes="A prediction app with a pick game falls inside the prohibited uses. Not used.",
        ),
        SourceSpec(
            name="understat",
            title="Understat (football xG)",
            homepage="https://understat.com/",
            provides=(ADV_STATS,),
            sports=("football",),
            cost="free website",
            rate_limit="n/a",
            terms="Site offline when checked ('We will come back soon'); no robots.txt or terms available.",
            terms_status=EXCLUDED,
            terms_url="https://understat.com/",
            terms_checked=CHECKED,
            reliability=0.0,
            notes="Not live. Re-check later; it has no official API.",
        ),
        SourceSpec(
            name="fbref",
            title="FBref",
            homepage="https://fbref.com/",
            provides=(ADV_STATS,),
            sports=("football",),
            cost="free website",
            rate_limit="n/a",
            terms="Excluded by the brief: FBref no longer carries Opta advanced stats, so it is not used for xG.",
            terms_status=EXCLUDED,
            terms_url="",
            terms_checked=CHECKED,
            reliability=0.0,
        ),
        SourceSpec(
            name="api_football",
            title="API-Football (api-sports.io)",
            homepage="https://www.api-football.com/",
            provides=(RESULTS, LINEUPS, ADV_STATS, ODDS_LIVE),
            sports=("football",),
            cost="free tier advertised (100 requests/day); not confirmed",
            rate_limit="not confirmed",
            terms="Not verified: the terms and pricing pages returned HTTP 403 (bot protection) from this environment.",
            terms_status=UNVERIFIED,
            terms_url="https://www.api-football.com/terms",
            terms_checked=CHECKED,
            reliability=0.0,
            notes="The only candidate found for free football lineups/injuries. Needs a manual terms check before any sign-up.",
        ),
    ]
}


def usable_sources(category: str, sport: str) -> list[SourceSpec]:
    """Sources for a category/sport in conflict-rule priority order (most reliable first)."""
    out = [s for s in REGISTRY.values() if category in s.provides and sport in s.sports and s.usable()[0]]
    return sorted(out, key=lambda s: -s.reliability)
