# Source registry

Generated from `pipeline/mkdata/sources.py` (`python -m mkdata registry-doc`). Terms and robots.txt read on 2026-11-06.
A source is fetched only if its terms permit our use **and** any key it needs is in the server-side environment.
Keys are never stored in the app, the repository or logs.

| Source | Provides | Sports | Cost | Rate limit | Terms | Reliability prior | Status |
|---|---|---|---|---|---|---|---|
| football-data.co.uk CSV files | fixtures_results, advanced_stats, odds_historical, odds_current, schedule_context | football | free, no sign-up | none published; we wait 2 s between files and cache them | Permitted | 0.90 | On |
| openfootball football.json (GitHub) | fixtures_results, schedule_context | football | free, no sign-up | GitHub raw file hosting; we wait 1 s between files and cache them | Permitted | 0.75 | On |
| football-data.org API v4 (free tier) | fixtures_results, standings, schedule_context | football | free tier (12 competitions, delayed scores); paid from EUR 12/month | 10 calls/minute on the free tier | Permitted (attribution required) | 0.95 | Off until `FOOTBALL_DATA_ORG_KEY` is set |
| The Odds API v4 (free Starter plan) | odds_current, fixtures_results | football, basketball, american-football, hockey, baseball | free Starter plan: 500 credits/month; paid from USD 30/month (historical odds are paid) | credit-based quota; we stop when the remaining-credits header falls below a reserve | Permitted | 0.90 | Off until `THE_ODDS_API_KEY` is set |
| BALLDONTLIE NBA API (free tier) | fixtures_results, schedule_context | basketball | free: 5 requests/minute, basic data; box scores/advanced stats from USD 9.99/month | 5 requests/minute on the free tier | Permitted | 0.85 | Off until `BALLDONTLIE_API_KEY` is set |
| Our own Elo ratings (computed in mkdata.ratings) | ratings | football, basketball, american-football, hockey, baseball | free (computed from permitted results) | n/a | Permitted | 0.80 | On |
| ClubElo API | ratings | football | free, no sign-up | none published | Unverified: not used | 0.85 | Off |
| ESPN site/core/web APIs (undocumented) | fixtures_results, standings, advanced_stats, lineups_injuries, odds_historical, odds_current | football, basketball, american-football, hockey, baseball | free, undocumented | none published | Restricted: not used | 0.80 | Off |
| Wikidata (query service) | player_photos | football | free, no key | 1 query a minute at times (outage rule, Nov 2026); robot policy | Permitted | 0.70 | On |
| Wikimedia Commons (photos) | player_photos | football | free, no key | robot policy: Action API 1 at a time, under 5/s; media 2 at a time, 25 Mbps, standard thumbnail sizes | Permitted (attribution required) | 0.70 | On |
| NBA.com stats and injury report | advanced_stats, lineups_injuries | basketball | free, undocumented | n/a | Restricted: not used | 0.95 | Off |
| Understat (football xG) | advanced_stats | football | free website | n/a | Excluded | 0.00 | Off |
| FBref | advanced_stats | football | free website | n/a | Excluded | 0.00 | Off |
| API-Football (api-sports.io) | fixtures_results, lineups_injuries, advanced_stats, odds_current | football | free tier advertised (100 requests/day); not confirmed | not confirmed | Unverified: not used | 0.00 | Off |

## What the terms say (as read)

### football-data.co.uk CSV files

- **Terms status:** Permitted ([source](https://www.football-data.co.uk/disclaimer.php))
- **What we read:** Free CSV downloads offered for users. The disclaimer only limits liability and gambling advice; it places no restriction on using the data. robots.txt allows all agents except named AI-training crawlers (GPTBot, anthropic-ai, Google-Extended, ...).
- **Notes:** Results, half-time, referee, shots, shots on target, corners, cards; pre-match odds (collected Friday/Tuesday afternoon) and closing odds (Pinnacle, market average, Bet365). fixtures.csv has odds for the next round. Main + lower divisions of 11 countries, MLS in new/USA.csv. Kick-off times are UK local time.

### openfootball football.json (GitHub)

- **Terms status:** Permitted ([source](https://github.com/openfootball/football.json#license))
- **What we read:** Dedicated to the public domain: 'Use as you please with no restrictions whatsoever.'
- **Notes:** Community-maintained fixtures and results with full club names. Top 9 European leagues, English League One/Two, MLS, Champions League (2024-25), World Cup 2026. Kick-off times are local; no odds or stats. Fully independent of football-data.co.uk. Measured (Step 2): 100% score agreement with football-data.co.uk in the top divisions, but its 2025-26 League One/Two files are faulty (276 wrong-year dates, 11-12% scores disagree, times 1 h off) and it lags: 31-50% of current-season results older than 3 days are missing.

### football-data.org API v4 (free tier)

- **Terms status:** Permitted (attribution required) ([source](https://www.football-data.org/about))
- **What we read:** Terms and Conditions (about page): one API key per application, fair use, keys must not be committed to open-source repositories, and the app must show the attribution 'Football data provided by the Football-Data.org API'. No ban on apps or commercial use found.
- **Required attribution:** "Football data provided by the Football-Data.org API"
- **Key:** server-side environment variable `FOOTBALL_DATA_ORG_KEY`
- **Notes:** UTC kick-off times and official match status. Needs a free sign-up (you).

### The Odds API v4 (free Starter plan)

- **Terms status:** Permitted ([source](https://the-odds-api.com/terms-and-conditions.html))
- **What we read:** Explicitly allows storing the data indefinitely, showing it in a mobile app (including commercially), deriving values from it, and training statistical/ML models. Forbids reselling or redistributing it as a raw data feed or API.
- **Key:** server-side environment variable `THE_ODDS_API_KEY`
- **Notes:** Current pre-match odds for every sport we cover, multiple bookmakers. The key travels in the query string, so it is only ever used server-side. Needs a free sign-up (you).

### BALLDONTLIE NBA API (free tier)

- **Terms status:** Permitted ([source](https://www.balldontlie.io/terms))
- **What we read:** Allows any lawful personal or commercial use, including paid apps and analytics, with no credit required. Forbids offering a substitute sports-data API, evading rate limits, and using the data to accept, grade or settle wagers without verification.
- **Key:** server-side environment variable `BALLDONTLIE_API_KEY`
- **Notes:** Second independent NBA results/schedule source. Needs a free sign-up (you).

### Our own Elo ratings (computed in mkdata.ratings)

- **Terms status:** Permitted
- **What we read:** Derived from permitted sources only.

### ClubElo API

- **Terms status:** Unverified: not used ([source](http://clubelo.com/))
- **What we read:** Not verified: clubelo.com and api.clubelo.com could not be reached from this environment (connection reset at the network edge, 6 Nov 2026), so neither the site nor its terms could be read.
- **Notes:** Adapter is written and tested offline; it stays off until the terms are read and the host answers.

### ESPN site/core/web APIs (undocumented)

- **Terms status:** Restricted: not used ([source](https://disneytermsofuse.com/english/))
- **What we read:** Disney Terms of Use (which cover ESPN) forbid, without written permission: commercial or business use or building a business on Disney products (B.viii) and accessing, copying or extracting them 'using a robot, spider, script, or other automated means', including for data mining or 'compiling, building, creating or contributing to any collection of data, data set or database' (B.x). www.espn.com/robots.txt also blocks AI crawlers outright.
- **Notes:** The current app (1.4.1) reads ESPN directly on each phone, and the Step 1 audit downloaded ESPN history. The pipeline does not fetch ESPN. Keeping, licensing or replacing ESPN in the app is the owner's decision.

### Wikidata (query service)

- **Terms status:** Permitted ([source](https://wikitech.wikimedia.org/wiki/Robot_policy))
- **What we read:** Structured data is CC0 (public domain). Wikimedia's robot policy asks bots for a User-Agent with contact details, to honour Retry-After on a 429, and to keep request rates low; the query service currently limits clients to one request a minute.
- **Notes:** Player photos only (mkdata/photos.py): footballers' dates of birth, photos (P18) and ESPN FC IDs (P3681). Club memberships are often out of date, so they are not used for matching.

### Wikimedia Commons (photos)

- **Terms status:** Permitted (attribution required) ([source](https://wikitech.wikimedia.org/wiki/Robot_policy))
- **What we read:** Every file carries its own licence. The job reads each photo's licence, author and licence URL from the Commons API and uses only CC0, public domain, CC BY and CC BY-SA files. The author, licence and source are credited in the app and on photo-credits.html. Crops of CC BY-SA photos are shared under the same licence. Access follows Wikimedia's robot policy.
- **Required attribution:** "Photo: <author>, <licence>, via Wikimedia Commons"
- **Notes:** Face crops (160 px) are re-hosted on GitHub Pages so phones never hit Wikimedia's servers.

### NBA.com stats and injury report

- **Terms status:** Restricted: not used ([source](https://www.nba.com/termsofuse))
- **What we read:** NBA.com Terms of Use, 'NBA Statistics': only for news reporting or private non-commercial use; not 'in connection with any gambling activity', 'any fantasy game or other commercial product or service', or a regularly updated statistics database. robots.txt disallows /api/*.
- **Notes:** A prediction app with a pick game falls inside the prohibited uses. Not used.

### Understat (football xG)

- **Terms status:** Excluded ([source](https://understat.com/))
- **What we read:** Site offline when checked ('We will come back soon'); no robots.txt or terms available.
- **Notes:** Not live. Re-check later; it has no official API.

### FBref

- **Terms status:** Excluded
- **What we read:** Excluded by the brief: FBref no longer carries Opta advanced stats, so it is not used for xG.

### API-Football (api-sports.io)

- **Terms status:** Unverified: not used ([source](https://www.api-football.com/terms))
- **What we read:** Not verified: the terms and pricing pages returned HTTP 403 (bot protection) from this environment.
- **Notes:** The only candidate found for free football lineups/injuries. Needs a manual terms check before any sign-up.

## Measured reliability (cross-check of the two free football sources)

From `../audit/results/step2_crosscheck.json` (2026-11-06T09:53:29+00:00).

| Competition | Canonical matches | In both sources | Both final | Score agreement | Kick-off within 15 min |
|---|---|---|---|---|---|
| eng.1 | 1,520 | 1,230 | 1,190 | 100.00% | 99.9% |
| eng.2 | 2,224 | 1,824 | 1,751 | 100.00% | 100.0% |
| eng.3 | 1,826 | 816 | 813 | 89.30% | 67.7% |
| eng.4 | 1,822 | 1,102 | 826 | 88.38% | 50.1% |
| esp.1 | 1,520 | 1,249 | 1,199 | 100.00% | 100.0% |
| fifa.world | 104 | 0 | 0 | – | – |
| fra.1 | 1,224 | 999 | 962 | 100.00% | 99.3% |
| ger.1 | 1,224 | 990 | 954 | 100.00% | 99.9% |
| ita.1 | 1,520 | 1,240 | 1,180 | 100.00% | 99.8% |
| ned.1 | 1,224 | 1,017 | 980 | 99.90% | 99.8% |
| por.1 | 1,224 | 1,008 | 980 | 99.80% | 99.9% |
| tur.1 | 1,118 | 648 | 437 | 100.00% | 70.4% |
| uefa.champions | 189 | 0 | 0 | – | – |
| usa.1 | 2,078 | 510 | 164 | 100.00% | – |

