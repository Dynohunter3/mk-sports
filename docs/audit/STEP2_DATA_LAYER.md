# Step 2: multi-source data layer

Branch `engine-v3`. Code is in `pipeline/` (Python standard library only), and the daily job is `.github/workflows/data-pipeline.yml`.
Measured outputs: `audit/results/step2_crosscheck.json` and `docs/SOURCE_REGISTRY.md`. Everything below was measured on 6 Nov 2026 unless marked otherwise.

## 1. The most important finding: ESPN's terms forbid how we use it

Before adding sources I read the terms and robots.txt of every candidate source, including the one we already use. ESPN is covered by the Disney Terms of Use (disneytermsofuse.com, section B). Without written permission, these terms prohibit:

- **B.viii:** "commercial or business-related use or build a business utilizing the Disney Products … whether or not for profit".
- **B.x:** "access, monitor, copy or extract the Disney Products using a robot, spider, script, or other automated means, including … data mining or web scraping or otherwise compiling, building, creating or contributing to any collection of data, data set or database".

What this means:

- **App 1.4.1:** every phone reads ESPN's undocumented APIs directly. That is the app's current design, and it falls under B.x.
- **Step 1 audit:** I downloaded 37,119 ESPN results plus ESPN odds with a script before I had checked these terms. That download falls under B.x too.
  - The files are only in this workspace (`audit/data/`, git-ignored). They were never committed or published.
  - I have stopped downloading from ESPN.
- **The new pipeline:** it does not fetch ESPN at all. ESPN is in the registry as *restricted*, and the code will not switch it on.

Your rule was "never scrape sites that forbid it". Whether the app keeps ESPN, licenses it or replaces it is your decision; options are in section 7.

## 2. What was built

```
pipeline/mkdata/
  sources.py      registry: what each source provides, cost, limits, terms as read, reliability, key variable
  http.py         polite client: robots.txt check, per-host rate limit, retry/backoff, cache, key redaction;
                  never retries 401/403, honours one Retry-After on 429 and then stops
  adapters/       one interface (fetch_season / fetch_upcoming / health) per provider:
                  footballdata_uk, openfootball            (on: free, no key)
                  football_data_org, the_odds_api, balldontlie (written and tested; off until a key exists)
                  clubelo                                   (written and tested; off: terms unverified, host unreachable)
  validate.py     rows that fail checks (date outside its season, same team twice, impossible score) are quarantined
  ids.py          one internal ID per team/competition (players: same mechanism, no player source yet)
  linker.py       names -> IDs (alias, normalised name, fixture anchoring, adopt-provisional), one canonical match
                  per real match, conflict log, per-competition source demotion
  resolve.py      the written conflict rules R1-R4 (status, score, kick-off, odds)
  store.py        SQLite point-in-time store; every row has available_at and fetched_at; PointInTime view
                  refuses anything not known before the prediction time
  fallback.py     collect_all / first_success chains, circuit breaker, fallback log, degraded mode
  monitor.py      failed/silent sources, stale results, unresolved IDs, conflicts, rolling accuracy vs baseline
  ratings.py      our own Elo from canonical results (second ratings source next to ClubElo)
  cli.py          sync, upcoming, link, elo, crosscheck, snapshot, health, registry-doc
```

**Where it runs.** It runs as a daily GitHub Actions job (free minutes), not on a paid server.
- **Keys:** they live in the repository's Actions secrets and reach the job only as environment variables. Nothing goes to the app.
- **Health check:** when it finds a critical problem it fails the job, and GitHub emails you. An optional `MK_ALERT_WEBHOOK` secret sends the same alerts to Slack, Discord or similar.
- **Remote needed:** the repository has no git remote yet, so the workflow cannot run until it is pushed to GitHub.

**Tests.** 39 pipeline tests pass, covering adapters, HTTP politeness, IDs and linking, conflict rules, point-in-time and leakage, fallback, registry rules, validation and monitoring. The existing suites still pass: engine 37, mobile 0 failures.

## 3. Sources: terms as read

The full registry, with what each source provides, cost, rate limits and the terms text, is in `docs/SOURCE_REGISTRY.md`.

| Source | Terms as read | Status |
|---|---|---|
| football-data.co.uk | Free CSV downloads, no use restriction; robots.txt allows all agents except named AI-training crawlers | **On** |
| openfootball (GitHub) | Public domain: "use as you please with no restrictions" | **On** |
| football-data.org (free tier) | Allowed with attribution ("Football data provided by the Football-Data.org API"), one key per app | Off until you add a free key |
| The Odds API (free, 500 credits/month) | Explicitly allows storing, showing in an app (including commercially) and training ML models; no reselling as a raw feed | Off until you add a free key |
| BALLDONTLIE (free NBA tier, 5 requests/min) | Allows commercial use, no credit needed; no substitute API, no settling wagers | Off until you add a free key |
| ClubElo | Not verified: site and API unreachable from here (connection reset) | Off |
| API-Football | Not verified: terms page returned 403 (bot protection) | Not built; check by hand first |
| ESPN | **Forbids** automated access, data compilation and commercial use (section 1) | Not used by the pipeline |
| NBA.com stats / injury report | **Forbids** use with gambling, fantasy or commercial products, or a regularly updated stats database; robots.txt blocks `/api/` | Not used |
| Understat | Site offline ("We will come back soon") | Not used |
| FBref | Excluded by your brief (no Opta xG any more) | Not used |

## 4. Measured: what the two free football sources give us

The pipeline backfilled four seasons (2023-24 to 2026-27) for 14 competitions:
- 9 top divisions, plus the Championship, League One and League Two (the lower divisions help with cup cold starts);
- MLS, the Champions League and the World Cup 2026.

| | Count |
|---|---|
| Canonical matches | 18,817 (16,692 finished) |
| Teams with internal IDs | 366, 0 unresolved |
| Odds rows (point-in-time) | 113,651: 60,000 closing, 53,603 pre-closing, 48 current |
| Team match-stat rows (shots, shots on target, corners, fouls, cards, referee) | 28,612 |

### Cross-source agreement (finished matches present in both sources)

| Competition | In both sources | Both final | Score agreement | Kick-off within 15 min |
|---|---|---|---|---|
| Premier League | 1,230 | 1,190 | **100%** | 99.9% |
| Championship | 1,824 | 1,751 | **100%** | 100% |
| LaLiga | 1,249 | 1,199 | **100%** | 100% |
| Serie A | 1,240 | 1,180 | **100%** | 99.8% |
| Bundesliga | 990 | 954 | **100%** | 99.9% |
| Ligue 1 | 999 | 962 | **100%** | 99.3% |
| Eredivisie | 1,017 | 980 | 99.90% (1 disagreement) | 99.8% |
| Liga Portugal | 1,008 | 980 | 99.80% (2) | 99.9% |
| Süper Lig | 648 | 437 | **100%** | 70.4% (see below) |
| MLS | 510 | 164 | **100%** | – (openfootball MLS has no time zone) |
| League One | 816 | 813 | 89.30% (87) | 67.7% |
| League Two | 1,102 | 826 | 88.38% (96) | 50.1% |
| Champions League 2024-25, World Cup 2026 | 0 | – | single source only | – |

**How names were matched.** 116 football-data.co.uk names were matched to openfootball's full names by fixture evidence alone: same date ±1 day, same side, same final score and a consistent opponent. Examples: "Ath Bilbao" → Athletic Club, "Sp Lisbon" → Sporting CP, "Buyuksehyr" → İstanbul Başakşehir.
- **Checks on the result:** I checked every learned match. Teams per competition-season come out exactly right: 20 in the Premier League, 24 in League One and League Two, 20/19/18/18 in the Süper Lig and 29–30 in MLS. Champions League clubs reuse their domestic IDs (25 merged).
- **Duplicates:** two duplicate IDs appeared during development (Cheltenham and Carlisle) and were fixed with a new evidence rule, which has its own test.

### Data-quality problems found by cross-checking

These problems are why a single source is risky.

1. **openfootball League One 2025-26:** 276 matches are dated a year early (January–May 2025 instead of 2026). The validation rule quarantined them, and an alert was raised.
2. **openfootball League One and League Two 2025-26:**
   - 87/261 and 96/274 final scores disagree with football-data.co.uk;
   - kick-offs are typically 1 hour early;
   - and in the Süper Lig 2025-26 file, kick-offs are 1 hour off and results stop after early November 2025.
   With only two sources I cannot prove which side is wrong. However, the same openfootball files contain the date bug above, and the sources agree perfectly elsewhere. By rule, openfootball is **demoted** for those two competition-seasons: football-data.co.uk's values are used, every disagreement is logged, and matches only openfootball has there get agreement 0, which means low confidence.
3. **Freshness:**
   - openfootball is weeks behind in the current season: 31–50% of 2026-27 matches played more than 3 days ago still have no result there.
   - football-data.co.uk updates about twice a week. Today the monitor raises a **critical** alert because 12 Championship matches that kicked off more than 36 hours ago have no result in either source.
   - So, with no-key sources only, results can arrive 2–4 days late. ESPN is real-time, and football-data.org's free tier ("scores delayed") is the permitted fix to measure.
4. **Bookmaker consistency:** Pinnacle closing and market-average closing differ by a median 0.8 points of P(home) (90th percentile 1.8; over 8 points in 0.09% of 16,386 matches). Closing odds are consistent enough to use as a benchmark and a feature.

### Leakage audit on the real data

- **Rows checked:** 60,000 closing-odds rows and 53,603 pre-closing rows.
  - No closing-odds row is visible before its own kick-off.
  - No pre-closing row is timestamped at or after kick-off. Pre-closing odds are timestamped at football-data.co.uk's documented collection time (Tuesday/Friday afternoon), on average 30 hours before kick-off.
- **Bug found and fixed:** the audit found 3 matches whose result looked "known" before the chosen kick-off. In each, one source carried the original time of a match that had been moved, for example Marseille v PSG, Sep 2025.
  - The fix: results, and closing odds in point-in-time reads, are never visible before the chosen kick-off plus match length.
  - After the fix, the count is 0, and a regression test covers it.
- **Snapshots:** the data snapshot is deterministic. Two runs gave the same data version, `b65a64a71b2d6654`.

## 5. Coverage: what permitted sources cover, and what they don't

| Area | Permitted sources now (no key) | Added by the free keys | Still missing |
|---|---|---|---|
| 9 top European leagues + Championship | 2 independent sources (results, closing odds, shots, upcoming odds) | football-data.org: timely results, UTC times, standings | xG, lineups/injuries |
| MLS | football-data.co.uk (all seasons) + openfootball (2025 only) | – | xG, lineups |
| Champions League | openfootball 2024-25 only | football-data.org | Europa League and Conference League: no permitted source found |
| World Cup 2026 | openfootball | football-data.org | WC qualifying (Africa): none found |
| FA Cup, EFL Cup, Saudi Pro League, CAF CL, AFCON | **none found** | – | all |
| NBA | **none** | BALLDONTLIE results; The Odds API current odds | historical odds, advanced stats (paid tier), injuries |
| NFL, NHL, MLB | **none** | The Odds API current odds only | results history, stats, historical odds |
| Ratings | our own Elo (33,499 point-in-time rows) | – | ClubElo (unreachable/unverified) |
| Football xG | **none permitted** (Understat offline, FBref excluded) | – | shots/shots-on-target from football-data.co.uk are the closest permitted proxy |

## 6. What didn't work, or isn't done

- **ClubElo:** both of its hosts reset the connection from this environment, so I could neither use it nor read its terms. The adapter is written and tested offline, and is off.
- **NBA.com:** its terms rule it out for this app. The brief's "basketball net rating, pace, injuries" has no permitted free source. BALLDONTLIE's box scores and advanced stats are a paid tier (from USD 9.99/month), which I have not signed up for.
- **API-Football:** the only free candidate I found for football lineups and injuries. Its terms could not be read from here, so I haven't built it.
- **No source has been "proven to help" yet.** That is Step 3's job: each source and feature is kept only if held-out log loss or Brier improves. Step 2 only proves the data is permitted, consistent, timestamped and leak-free.
- **Prediction timing in the app:** the point-in-time store and the prediction log exist, but the app does not read from the pipeline yet. That is wired up in Steps 3–4.

## 7. Decisions I need from you

1. **ESPN.** Options:
   - (a) Ask ESPN/Disney for written permission or a licence. That keeps everything, but is unlikely for a small app.
   - (b) Move the app to permitted sources: the pipeline publishes the data and predictions the app reads. Competitions with no permitted source (cups, Saudi, CAF, NFL/NHL/MLB results) would need a licensed provider, which costs money, or would have to be dropped.
   - (c) Keep ESPN in the app knowingly and accept the risk. That is your call, not mine to make, and I can't recommend it.

   My recommendation is (b), starting with football, where permitted coverage is good.
2. **The Step 1 ESPN download** (local only): delete it now, or keep it only to report the Step 1 vs Step 5 before/after numbers on the same matches?
3. **Free sign-ups**, all needing your email and nothing paid:
   - football-data.org: timely results, fixes the 2–4 day lag;
   - The Odds API: current odds for every sport;
   - BALLDONTLIE: NBA results.

   If you create them, I will ask for each key through the secure credential form; never paste keys in chat.
4. **Paid options**, only if you want the gaps closed; I will not sign up for anything:
   - BALLDONTLIE All-Star (USD 9.99/month): NBA box scores.
   - The Odds API (from USD 30/month): historical odds.
   - A licensed multi-sport feed for cups and US sports.

## How to run it

```bash
cd pipeline
python -m mkdata sync               # 4 seasons, every usable source (cached, polite)
python -m mkdata upcoming           # next fixtures + current odds (first source that works)
python -m mkdata link               # IDs, canonical matches, conflicts, source demotion
python -m mkdata elo
python -m mkdata crosscheck --out ../audit/results/step2_crosscheck.json
python -m mkdata snapshot           # versioned, hashed data snapshot
python -m mkdata health --status var/status.json   # exit code 2 on critical alerts
python -m pytest -q
```
