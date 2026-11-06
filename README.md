# MK Sports

MK Sports is a mobile-first sports app. It has:

* **Live scores** and a **live match centre**: line-ups in formation, live team stats including expected goals (xG), a shot map, the timeline, commentary and player stats.
* **League stats**: tables, fixtures, results and player leaders.
* **Trending news.**
* **A favourite-team hub.**
* **Explainable AI predictions** for every match.
* **A free-to-play pick game**: make your own calls before kick-off.

Every competition is shown in its own brand colours, and every team with its real crest.

> Predictions are for information and entertainment only and are **not betting advice**. The pick game has no real-money stakes.

**The app works on its own with real data.** The phone fetches everything from public sports feeds and computes every prediction and xG value itself. No server, account or API key is needed. An optional server mode (`backend/`) adds accounts and global leaderboards.

```
predictpro/
├── mobile/      React Native app (Expo SDK 58): on-device data layer, models, pick game, all screens
├── engine/      Reference prediction engine (Python) + scripts that fit the xG model
├── backend/     Optional server: FastAPI API, PostgreSQL schema, provider adapters, jobs (server mode)
├── db/          schema.sql for the server database
├── docs/        Architecture, API, prediction engine, roadmap
└── docker-compose.yml
```

## Install on Android (APK)

Build the release-signed APK with `mobile/scripts/build-apk.sh` (see [Building the APK](#building-the-apk)). Copy `MKSports-1.4.1.apk` to the phone, open it, and allow "install from this source" when Android asks. It runs on Android 7.0+ on 32- and 64-bit ARM phones.

Versions 1.1 and later keep the package id of the 1.0 build (`app.predictpro.mobile`) and the same signing key. They install as updates, so existing picks and points are kept.

## What's in the app

| Tab | What it does |
|---|---|
| **Home** | Your team's live, next and last match. Live matches strip. Trending headlines. Today, top predictions, coming up and latest results. League chips filter the feed and switch the screen to that competition's colours. |
| **Scores** | Any day, any sport: football, basketball, American football, ice hockey, baseball. Tennis (ATP/WTA draws with set scores), Formula 1 (race weekends with session results) and cricket (live, results, upcoming in every competition). |
| **My Team** (centre) | The favourite-team hub: next match with prediction, results, form, table position, top players, squad and team news. |
| **News** | Live matches across the top, then the latest headlines from your competitions and your team. Articles open in the in-app browser. |
| **Stats** | Pick a competition. Football: full table (P W D L GD Pts), fixtures, results and player stats (goals, assists, shots, cards, fouls, passes, saves, plus team clean sheets). US sports: standings in each sport's format, plus leaders. F1: drivers' and constructors' standings. Tennis: rankings. |
| **Match centre** | Overview and prediction, plus line-ups on a pitch. Tap any player for this match, the season and their last five games. Live stats: possession, xG, shots, shots on target, corners, fouls, passes, pass accuracy, offsides, saves, cards and tackles. Shot map, timeline, commentary and table. |

**Notifications** are switched on in Settings, or with the bell on any match page. They cover your team's matches, matches you follow and matches you've picked. Everything is generated on the phone, with no push server:

* **Kick-off reminders:** 30 minutes before. Scheduled on the phone, so they arrive on time even when the app is closed.
* **Goals, kick-off and full time:** instant while the app is open. In the background, Android runs a check about every 15 minutes (later in battery saver), so a background goal alert can arrive late. Instant background alerts would need a push server (server mode, Phase 2).
* **Pick results:** won or lost, with the points earned.

The glass design uses translucent floating tiles and a floating tab bar over a gradient in the current competition's colours. Those colours are close approximations of each competition's brand, not official assets.

## Where the data comes from

| What | Source | Notes |
|---|---|---|
| Fixtures, live scores, results, tables, match events, venues | ESPN public sports feed (`site.api.espn.com`) | Live matches refresh every 20–30 s while the screen is open |
| Line-ups, formations, per-player match stats, team match stats, timeline, commentary | ESPN match summary | Line-ups appear when the clubs announce them, usually about an hour before kick-off |
| Team crests, player photos | ESPN image service (`a.espncdn.com`) | Requested at display size and cached on the phone. Team colours and initials show while a crest loads or if it can't. |
| Player season stats, last five matches, bio | ESPN (`site.web.api.espn.com`) | |
| Player leaders | ESPN (`sports.core.api.espn.com`) | Team clean sheets, goals scored and fewest conceded are counted from this season's real results |
| News | ESPN news feeds per competition and team | |
| Tennis, F1, cricket | ESPN scoreboards, rankings and standings | |
| **xG** | **MK Sports model**, from the shot positions in ESPN's play-by-play | See [Expected goals](#expected-goals-xg) |
| Forecast: MK Sports model | Computed on the phone from real results (12 months; 24 for the NFL) | Football: Elo + Poisson. Basketball, NFL, NHL and MLB: Elo + net-rating margin model. |
| Forecast: ESPN Analytics | ESPN matchup predictor | NBA (and NFL where published) |
| Forecast: market consensus | Pre-match prices in the ESPN feed, converted to probabilities with the margin removed | Odds are never shown; switch it off in Settings |

**Competitions with live data:**
* **Football:** Premier League, EFL Championship, FA Cup, EFL Cup (Carabao Cup), LaLiga, Serie A, Bundesliga, Ligue 1, Eredivisie, Liga Portugal, Süper Lig, Saudi Pro League, MLS, UEFA Champions League, UEFA Europa League, UEFA Conference League, CAF Champions League, AFCON, FIFA World Cup, World Cup Qualifying (Africa).
* **Other team sports:** NBA, NFL, NHL, MLB.
* **Tennis, motorsport, cricket:** ATP and WTA tours, Formula 1, cricket (all competitions ESPN covers).

**Not included, and why:**
* **Zambia Super League.** ESPN's coverage stopped in September 2025. TheSportsDB's free tier is too incomplete to show (15 matches, points shown as 0). Full coverage needs a paid key through server mode.
* **Player match ratings** (the 6.6-style numbers some apps show). The free data source has no ratings, and the app doesn't make them up.
* **ClubElo and tipster sites.** ClubElo did not complete an HTTPS connection. Tipster sites forbid scraping and publish no accuracy record.

ESPN's feed is public but unofficial (undocumented, no SLA, not licensed for commercial redistribution). It suits a personal or sideloaded app. For a commercial launch, switch to a licensed provider through server mode.

**Accuracy on real results.** These are walk-forward backtests: every game is predicted only from results before it. For NFL, NHL and MLB, the settings were tuned on older games and scored on the most recent 30%, which the tuning never saw.

| | Games | Hit rate | Log loss | Hit rate by confidence (high / medium / low) |
|---|---|---|---|---|
| Football (10 competitions) | 1,805 | 50% | 1.016 | 72% / 53% / 43% |
| NBA | 1,301 | 67% | 0.607 | 81% / 69% / 57% |
| NFL (held out) | 256 | 62.1% | 0.636 | 80% / 61% / 50% |
| NHL (held out) | 512 | 58.0% | 0.669 | 76% / 61% / 52% |
| MLB (held out) | 1,383 | 57.0% | 0.682 | 66% / 60% / 54% |

How to read the table:
* **Hit rate:** football has three outcomes, so a random pick is right 33% of the time and always picking the home side about 45%. For the two-outcome sports a coin flip scores 50% (log loss 0.693), and always picking the home side scores 52–54%.
* **Confidence:** the levels mean what they say. High-confidence calls are right far more often.

## Expected goals (xG)

xG is the probability that a shot is scored, based on where it was taken from.

* **Data:** ESPN's play-by-play records the position of almost every attempt. The app fits a logistic regression on distance to goal and the angle of the goal mouth (`engine/scripts/collect_shots.py`, then `fit_xg.py`).
* **Training set:** 22,711 real non-penalty shots from 910 matches across the top five leagues, the Championship and the Champions League. Penalties use the observed conversion rate (77%).
* **Held-out matches:** 361 goals against 368.0 xG. Log loss is 0.262, against 0.278 for a constant rate, and each decile is well calibrated.
* **Limits:** it is the app's own estimate, not an official provider's figure. The feed doesn't record body part, and goal descriptions never say "header", so headers and shots from the same spot get the same value.

## How predictions are made

1. **Ratings** are rebuilt on the phone from the stored results (cross-competition for football, so Champions League games link the leagues).
2. **Every source's forecast** for the match is collected (see the table above).
3. **Blend:** a linear opinion pool. Each source's weight comes from its accuracy *on the same past matches*, measured as log loss relative to the MK Sports model: `weight ∝ prior × exp(−matches × log-loss gap / 2)`. With little evidence the priors dominate (market 2.0, ESPN Analytics 1.3, model 1.0).
4. **Evidence:** every forecast the phone saves before kick-off is scored after the final whistle. This builds each source's track record on the same matches.
5. **The predicted score is made consistent** with the blended probabilities.
6. **Confidence** drops when data is thin or the strong sources disagree.

## What's in Phase 1 (server mode)

| Area | Status |
|---|---|
| Football: Premier League, LaLiga, Serie A, Bundesliga, Ligue 1, Champions League, CAF Champions League, **Zambia Super League** (configurable local league) | ✅ mock data + adapters for football-data.org and API-Football |
| Basketball: NBA, EuroLeague | ✅ mock data + adapter for API-Basketball |
| World Cup & qualifiers, AFCON, FIBA World Cup | Configured; no fixtures in the mock data (between tournaments) |
| Fixtures, live scores and results, filterable by date, sport, league and team | ✅ |
| AI prediction per match: probabilities, score, confidence, 3–5 key factors and a step-by-step explanation | ✅ |
| Match detail: last-5 form, head-to-head, standings, injuries/suspensions, venue | ✅ |
| Pick game: picks lock at kick-off; points for result plus exact-score bonus; streaks; 10 badges | ✅ |
| Global leaderboard: weekly, season and all-time | ✅ (Redis sorted sets, SQL fallback) |
| Public model accuracy tracker (live vs backtest, by sport, league and confidence) | ✅ (pulled forward from Phase 2) |
| Personalised home feed (favourite sports, leagues and teams) | ✅ |
| Accounts: email; Google and phone via Supabase Auth; consent at sign-up; data export; account deletion | ✅ (Supabase flows are untested without a project, see below) |
| Private leagues, friends leaderboards, push notifications | Phase 2 (tables and endpoints scaffolded, screen preview) |
| Cricket, tennis, Tier 2 sports, ML model, premium tier | Phase 2/3 (sports/leagues already in the catalog, inactive) |

## Server mode: quick start (optional)

The backend adds accounts (email, Google, phone), global, friends and private leaderboards, and server-side provider keys. In development it uses a simulated data provider so it runs without keys. The mobile app talks to it when `EXPO_PUBLIC_API_URL` is set.

Requirements: Python 3.11+ and Node 20+. PostgreSQL and Redis are optional.

### 1. API (SQLite, nothing else needed)

```bash
cd backend
python3 -m venv .venv && . .venv/bin/activate
pip install -e ../engine -e ".[dev]"
cp .env.example .env
python -m app.cli migrate
python -m app.cli seed
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

`seed` loads the catalog, about 14 weeks of results, the next 14 days of fixtures, injuries, league tables and predictions. It also creates 30 demo players with pick histories, plus a demo account `demo@predictpro.app` / `demo1234`. A few fixtures are moved to kick off around *now*, so live scores, pick-locking and settlement can be watched in real time. The in-process scheduler keeps everything moving after that.

Open http://localhost:8000/docs for interactive API docs.

### 2. Mobile app

```bash
cd mobile
npm install
npx expo start          # press a (Android), i (iOS simulator) or w (web)
```

The app finds the API automatically: it uses the dev server's host on port 8000, so a phone on the same Wi-Fi works. To point it elsewhere, set `EXPO_PUBLIC_API_URL`; see `mobile/.env.example`. In Expo Go, sign in with **Use the demo account** to see a populated profile.

### 3. PostgreSQL + Redis (recommended), or Docker

With local services, set these in `backend/.env`:

```
DATABASE_URL=postgresql+psycopg://predictpro:predictpro@localhost:5432/predictpro
REDIS_URL=redis://localhost:6379/0
```

Then run `python -m app.cli migrate && python -m app.cli seed`.

With Docker (PostgreSQL, Redis, the API and one background worker):

```bash
docker compose up -d --build
docker compose run --rm api python -m app.cli seed
```

## Using real data

Provider keys live **only** in the server's environment. The app never sees them.

```bash
# backend/.env
PROVIDER_FOOTBALL=football_data      # or api_sports
FOOTBALL_DATA_API_KEY=...
PROVIDER_BASKETBALL=api_sports
API_SPORTS_KEY=...
```

Each league maps provider ids in `backend/app/data/catalog.json` (`provider_refs`). To add a competition, such as another local league, add an entry there and run `python -m app.cli catalog`, or `POST /api/v1/admin/catalog` with the `X-Admin-Token` header. No code changes are needed. Requests are rate-limited (`PROVIDER_REQUESTS_PER_MINUTE`), cached in Redis, and retried with backoff. Live polling only happens while a match is in progress or about to start.

The adapters were written against the providers' documented response shapes and are tested with sample payloads (`backend/tests/test_adapters.py`). **They have not been run against a live account yet**, so verify field mappings with your key before launch.

## Auth

* `AUTH_MODE=dev` (default): the API handles email and password itself, with scrypt hashes and JWTs. It also exposes the demo account. For local use only.
* `AUTH_MODE=supabase`: the app signs in with Supabase Auth (email, **Google**, **phone OTP**) and the API verifies Supabase JWTs (HS256 secret or JWKS). Users are provisioned on first request, and consent is captured before the first pick. Set `EXPO_PUBLIC_AUTH_MODE=supabase`, `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` in the app, plus `SUPABASE_URL` and `SUPABASE_JWT_SECRET` on the server. For Google, add `predictpro://auth-callback` to the Supabase redirect URLs. *The Supabase flows are implemented against Supabase's REST auth API but have not been exercised against a real project in this repo.*

Account deletion (`DELETE /me`) removes the user and all their data, and also deletes the Supabase identity when `SUPABASE_SERVICE_ROLE_KEY` is set. `GET /me/export` returns all stored data as JSON.

## Building the APK

```bash
cd mobile
./scripts/build-apk.sh
```

The script needs JDK 17 and Node 20+. It installs the Android SDK (platform 37.0, build-tools 37.0.0, NDK 27.1, CMake) on first run, generates the native project with `expo prebuild`, and runs `gradlew assembleRelease`. The output is `mobile/dist-apk/MKSports-<version>.apk`. To sign with your own release key, put these in `~/.gradle/gradle.properties`:

```
PREDICTPRO_UPLOAD_STORE_FILE=/path/to/predictpro-upload.keystore
PREDICTPRO_UPLOAD_STORE_PASSWORD=...
PREDICTPRO_UPLOAD_KEY_ALIAS=predictpro
PREDICTPRO_UPLOAD_KEY_PASSWORD=...
```

Keep the keystore safe: every future update must be signed with the same key. Without these settings the APK is signed with the debug key, which installs fine but can't be used to publish updates. The build settings live in `mobile/plugins/withAndroidRelease.js` (the `android/` folder is generated and not committed).

## Tests

```bash
cd engine  && python -m pytest -q      # 37 tests: Elo, Poisson, models, factors, confidence, backtests
cd backend && python -m pytest -q      # 73 tests: points system, settlement, leaderboards, API, mock + real adapters
cd mobile  && npm test && npx tsc --noEmit   # 30 tests: TS engine parity with Python, ensemble, data layer end-to-end, xG, line-ups, match stats, other sports, NFL/NHL/MLB models, match alerts
```

The backend suite seeds its own temporary SQLite world. The Redis leaderboard tests run when Redis is reachable on `localhost:6379/15`, and skip otherwise.

## Points system

| Sport | Correct result | Exact score | Close margin |
|---|---|---|---|
| Football | 3 | +2 | — |
| Basketball (no draws) | 3 | +5 | +1 if your predicted margin is within 3 points |

Rules are per sport in the catalog (`scoring_rules`). Picks lock at the scheduled kick-off. Cancelled matches void picks. A corrected result is re-settled idempotently. Leaderboards rank by points, and ties share a rank.

## Performance & data usage

On-device mode: building the ratings needs 12 months of results, downloaded once per sport when you first use it: about 2.1 MB (compressed) for all ten football competitions and 1.9 MB for the NBA. After that, updates only fetch new results. Fixtures and live scores are small, cached requests that refresh only while a screen is open; *Data saver* turns automatic refresh off. Team logos aren't downloaded (crests are coloured initials). The figures below are for server mode.


* **One request renders the home screen** (`/feed`): 3.7 KB gzipped. Under Chrome's network emulation it took **0.19 s on slow 4G** (150 ms RTT, 1.6 Mbps) and **0.40 s on 3G** (300 ms RTT, 750 kbps). On native the JS ships inside the app, so this is the network cost of the home screen.
* Offline-first cache: lists, matches and picks persist on the device and render instantly, then revalidate with `If-None-Match`. An unchanged feed or match costs an empty `304`.
* Polling only on screens that are open, while matches are live, and never in the background. *Data saver* turns it off.
* No image downloads: team crests are coloured initials. Lists are paginated and virtualised, and rows are memoised.
* Web: a repeat visit renders in about 1.1–1.5 s on those profiles. The first web visit downloads the JS bundle (1.7 MB, 294 KB gzipped), so serve the web build from a CDN with compression.

## Documentation

* [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): components, data flow, jobs, caching, scaling
* [docs/API.md](docs/API.md): endpoints (interactive docs at `/docs`)
* [docs/PREDICTION_ENGINE.md](docs/PREDICTION_ENGINE.md): models, explanations, versioning, backtests, Phase 3 ML gate
* [docs/ROADMAP.md](docs/ROADMAP.md): Phase 2 and 3 plan and what's already in place
* [db/schema.sql](db/schema.sql): full PostgreSQL schema

## Responsible use

Predictions are framed as information and entertainment throughout: onboarding, every match page, the pick screen and settings. The game is free with no stakes or prizes. No bookmaker odds are shown; `/meta` exposes `shows_odds` and `age_gate_required` flags, so adding odds later requires an 18+ gate and responsible-gambling links first. Consent to the terms and privacy policy is required before playing. Marketing is opt-in.
