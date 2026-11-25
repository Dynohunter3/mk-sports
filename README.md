# MK Sports

**Live scores, AI football predictions that show their working, and a free game where your calls take on the AI.**

MK Sports is an Android app for football fans, with basketball, American football, ice hockey, baseball, tennis, Formula 1 and cricket as well. It has:
- live scores and a full match centre;
- league tables, stats and news;
- AI predictions with a measured track record;
- a free pick game with levels, badges and private leagues for friends.

Every competition appears in its own colours and every team with its real crest.

> **Responsible use.** Predictions are for information and entertainment only and are **not betting advice**. No outcome is guaranteed.
> - The game is free to play: no real-money stakes, entry fees or prizes.
> - MK Sports never shows bookmaker odds.
> - If gambling is affecting you or someone you know, seek support from a local responsible-gambling organisation.

| | |
|---|---|
| **Download page** | https://dynohunter3.github.io/mk-sports/ |
| **Current version** | 2.1.0 (Android 7.0 or newer, about 54 MB) |
| **Player photo credits** | https://dynohunter3.github.io/mk-sports/photo-credits.html |
| **Contact** | [Mksportz26@gmail.com](mailto:Mksportz26@gmail.com) · call +260 97 322 0276 · WhatsApp +260 76 050 8803 |

---

## Contents

1. [Get the app](#1-get-the-app)
2. [What's in the app](#2-whats-in-the-app)
3. [The game: Quick Picks, points, levels and badges](#3-the-game-quick-picks-points-levels-and-badges)
4. [Private leagues](#4-private-leagues)
5. [Your profile and your data](#5-your-profile-and-your-data)
6. [Notifications](#6-notifications)
7. [AI predictions](#7-ai-predictions)
8. [How accurate the predictions are](#8-how-accurate-the-predictions-are)
9. [Match data, expected goals and player photos](#9-match-data-expected-goals-and-player-photos)
10. [Competitions covered](#10-competitions-covered)
11. [The data pipeline](#11-the-data-pipeline)
12. [Data sources and their terms](#12-data-sources-and-their-terms)
13. [For developers](#13-for-developers)
14. [Version history](#14-version-history)
15. [Known limitations](#15-known-limitations)
16. [Documentation](#16-documentation)

---

## 1. Get the app

**Install:**
1. Open the [download page](https://dynohunter3.github.io/mk-sports/) on an Android phone and tap **Download for Android**.
2. Open the downloaded file. If Android asks, allow your browser to **install unknown apps**. This is how apps from outside the Play Store are installed.
3. Tap **Install**, then open MK Sports.

**Update:** install the new file over the old one. Every version since 1.0 uses the same package id (`app.predictpro.mobile`) and the same signing key, so it installs as an update: your picks, points, profile and leagues are kept.

**Requirements:**
- Android 7.0 or newer.
- A 32- or 64-bit ARM phone, which covers practically every real phone.
- There is no iPhone version.

**Sharing with friends:**
- Send them the download page. In the app, use Settings > Contact us > **Share MK Sports**.
- Each phone has its own profile, picks and leagues. No account is needed.

**Publishing a new version (owner).** The download button points to `releases/latest/download/MKSports.apk` on GitHub, so it works only once a release with that file is published:
1. On GitHub, open the repository, then **Releases** > **Draft a new release**.
2. Create a tag such as `v2.1.0` and add the release notes.
3. Attach the APK, named exactly `MKSports.apk`, and click **Publish**.

The 2.1.0 release has not been published yet; until it is, the download button returns "not found".

---

## 2. What's in the app

### The five tabs

| Tab | What it does |
|---|---|
| **Home** | Your team's live, next and last match. Quick Picks, with shortcuts to **My game** and **Private leagues**. The model's record. "Results are in" celebrations. The live strip, trending headlines, top predictions, coming up and latest results. League chips filter the feed and switch the screen to that competition's colours. |
| **Scores** | Any day, any sport: football, basketball, American football, ice hockey and baseball. Tennis (ATP and WTA draws with set scores), Formula 1 (race weekends with session results) and cricket (live, results and upcoming). |
| **My Team** | The favourite-team hub: next match with prediction, results, form, table position, top players, squad and team news. |
| **News** | Live matches across the top, then the latest headlines from your competitions and your team. Articles open in the in-app browser. |
| **Stats** | Pick a competition. **Football:** full table, fixtures, results and player stats (goals, assists, shots, cards, fouls, passes, saves, plus team clean sheets). **US sports:** standings and leaders. **F1:** drivers' and constructors' standings. **Tennis:** rankings. |

### Match centre

- **Header:** the score in a split of both teams' colours, with expected goals (xG) for football. The score always fits, even with large text sizes.
- **Overview:** the AI prediction and its call (see [section 7](#7-ai-predictions)), the goals outlook, form, head-to-head and the table.
- **Line-ups:**
  - One team at a time on a full pitch, with a team switcher showing crest, name and formation.
  - Player photos, goals, cards and substitution minutes, plus that team's substitutes and the referee.
  - Tap any player for their match, season and last five games.
- **Stats:** possession, xG, shots, shots on target, corners, fouls, passes, pass accuracy, offsides, saves, cards and tackles. Also a shot map.
- **Timeline and commentary.**

### Other screens

| Screen | What it does |
|---|---|
| **Player page** | Photo (with its credit), position, number, age, nationality, club, season stats and recent matches. |
| **Predictions** | Every published football prediction for the coming days, with its call, strength and safer call. Filters for draw calls, strong calls, the safest calls and recent results. It works offline from the last saved copy. |
| **How accurate is the model?** | The live record and the backtested record, by call strength, competition and confidence. |
| **Quick Picks** | A swipeable deck of upcoming matches (see [section 3](#3-the-game-quick-picks-points-levels-and-badges)). |
| **My game** | Level ring, you vs the AI, streak, accuracy, exact scores, the badge cabinet, recent results and points by week. |
| **Private leagues** | Create, join and share leagues with friends (see [section 4](#4-private-leagues)). |
| **Settings** | Profile (name and avatar), favourite team, sports and competitions; notifications; dark or light theme; animations and vibration; data saver; data sources; player photo credits; contact us; privacy (export or delete your data). |

### Design

The 2.0 "Matchday" design:
- **Type:** Barlow Condensed for titles and scores.
- **Colours:** each team's own colours on match cards and headers, with bold gradients for big moments.
- **Motion:** cards dip and spring back with a light haptic tap; lists rise into place; skeleton loaders instead of spinners; confetti for wins.
- **League tables:** your team's row pulses in its own colours.
- **Accessibility:** Settings has **Animations** and **Vibration** switches, and the phone's reduce-motion setting is respected.

Details: [docs/DESIGN_2_0.md](docs/DESIGN_2_0.md).

---

## 3. The game: Quick Picks, points, levels and badges

**Making picks:**
- **Quick Picks:** swipe left for the home team, right for the away team, up for a draw, down to skip; buttons do the same.
- After each call the AI's call is revealed, with a 5-second undo.
- Picks can also be made, with an optional exact score, from any match page.
- Picks lock at kick-off and are settled automatically after the final whistle. Cancelled matches void the pick.

**Points:**

| Sport | Correct result | Exact score | Close margin |
|---|---|---|---|
| Football, ice hockey, baseball | 3 | +2 | — |
| Basketball, American football (no draws) | 3 | +5 | +1 if your margin is within 3 points |

**Levels:** Rookie (0 points), Amateur (10), Semi-pro (25), Pro (50), Star (90), Captain (140), Legend (210), Icon (300), GOAT (420).

**Badges:** including Sharpshooter (an exact score), Hat-trick (3 correct results in a row), On Fire (5) and Unstoppable (10).

**You vs the AI:** for every settled pick where the AI made a call, My game counts how often each of you was right, and how often one was right when the other was wrong.

**Results are in:** settled picks you haven't seen yet are celebrated once on Home, with confetti when any were right.

It is always free: no money, no prizes.

---

## 4. Private leagues

Play against friends without any server or account.

**How it works:**
1. **Create** a league with a name. You get a 6-character code.
2. **Share & update** sends a link, for example to a WhatsApp group. The link carries:
   - the league;
   - every member's score card: name, avatar, season points, this week's points, correct picks, streak and when the card was made.
3. **Opening the link** joins the league or updates its table. The newest card for each member wins. Joining with the code alone also works; names arrive with the first link from a member.
4. **Tables:** season or this week, medals for the top three, streaks, and "updated 2h ago". Up to 40 members per league.

**Where the data lives:** in the part of the link after `#`, which browsers never send to the web server. Nothing is uploaded. The page `pages/l.html` forwards the link to the app (`mksports://pl?d=…`), or offers the download.

**Limits:**
- **Tables update only when members share,** so tap **Share & update** after each matchday.
- **A determined person could edit a link.** It's meant for friendly leagues with no prizes.
- **Automatic live tables** (no sharing step) would need a small server, for example a free Supabase or Firebase project.

Code: `mobile/src/data/pleagues.ts` (with tests), `mobile/src/app/private-leagues.tsx`, `mobile/src/app/pl.tsx`.

---

## 5. Your profile and your data

- **Profile:** each phone has its own name, avatar (12 to choose from), picks, points, badges and leagues. No account is needed.
- **Storage:** everything is kept on the phone.
- **Private leagues:** a score card leaves the phone only when you share a league link yourself.
- **Settings > Privacy:** export your data, or delete it.
- **Accounts (optional):** only in [server mode](#server-mode-optional), which adds sign-in and global leaderboards. The app runs without it.

---

## 6. Notifications

Switch them on in Settings, or with the bell on any match page. They cover your team's matches, matches you follow and matches you've picked.

| Alert | How it's delivered |
|---|---|
| **Kick-off reminder** (30 minutes before) | An exact alarm scheduled on the phone, so it arrives on time even with the app closed. |
| **Kick-off** | Scheduled for the exact kick-off time. |
| **Goals and full time** | **Live tracking:** while one of your matches is live or within 15 minutes of kick-off, a small live-score notification ("LIVE · ARS 1–0 CHE (63')") checks every 30 seconds, even after you close the app. It stops by itself after your last match. |
| **Pick results** | Won or lost, with the points earned. |

**Helpers in Settings:**
- **Test my alerts:** one alert now, and one scheduled a minute later.
- **Alerts late or missing?** Guidance and a shortcut to the app's battery settings. Choose "Unrestricted"; on Tecno, Infinix, itel and Xiaomi phones, also allow Auto-start.

**Limits:**
- Android only allows live tracking to **start while the app is open**, so open the app during or just before a match. The kick-off alert is a handy way in.
- Instant alerts for matches during which the app was never opened would need push notifications from a server, such as Firebase Cloud Messaging.

Code: `mobile/src/notify/`.

---

## 7. AI predictions

### Where they come from

- **The MK Sports data pipeline** ([section 11](#11-the-data-pipeline)) publishes the football predictions for 11 competitions:
  - Premier League, Championship, LaLiga, Serie A, Bundesliga, Ligue 1;
  - Eredivisie, Liga Portugal, Süper Lig, MLS and the Champions League.

  The app downloads them, keeps the last good copy, and ships a built-in copy so predictions show before the first download.
- **On the phone:** every other competition and sport gets its prediction computed on the phone, and the phone also stands in if the published file is unavailable.

### What a prediction tells you

- **The call:** home, draw or away, with the probabilities of each.
- **Call strength:** Strong, Likely, Lean or Toss-up, each with its measured hit rate ([section 8](#8-how-accurate-the-predictions-are)).
- **A safer call:** two outcomes, such as "Arsenal or draw", with its own track record.
- **Over/under 2.5 goals** and **both teams to score**.
- **Draw calls:** made only when the model really sees a draw. Close matches are marked "a draw is a real possibility".
- **Goals outlook:**
  - each team's expected goals;
  - the five most likely scores;
  - over/under 2.5;
  - each side's clean-sheet chance.

  It comes from a Poisson score grid with the Dixon-Coles low-score adjustment.
- **The reasons:** key factors (ratings, the goals model, the betting market) and a step-by-step breakdown of each model's view.
- **Movement:** if the prediction changed, from what, when and why (for example, when bookmaker odds were published).
- **After the match:** the result is graded, and the call is marked right or wrong.

### How the football model works

- **Models:**
  - Elo ratings;
  - a Dixon-Coles goals model;
  - a shots-based goals model;
  - gradient-boosted trees.
- **Blend:** the models are blended and calibrated. Bookmaker prices join the blend once they are published (they are never shown in the app). Before odds are out, a market-history rating fills in.
- **Testing:** every change was tested walk-forward, each match predicted only from earlier data, and adopted only if it improved results on seasons it had not seen.
- **Versions:** the model is versioned, and retrained on the 1st of each month or when its code changes. Every prediction records the version that made it.

How the model was audited, rebuilt and measured, step by step: [docs/audit](docs/audit/).

### On the phone (other competitions and sports)

1. **Ratings** are rebuilt on the phone from 12 months of results (24 for the NFL). Football uses Elo plus Poisson; basketball, NFL, NHL and MLB use Elo plus a net-rating margin model.
2. **Every source's forecast** is collected: the MK Sports model, the ESPN Analytics matchup predictor (NBA, and NFL where published) and the market consensus (prices converted to probabilities with the margin removed; never shown, and can be switched off in Settings).
3. **Blend:** the forecasts are combined, each weighted by its accuracy on the same past matches.
4. **Score and confidence:** the predicted score is made consistent with the blend. Confidence drops when data is thin or strong sources disagree.

---

## 8. How accurate the predictions are

All figures are measured, not estimated. Football's three outcomes mean a random pick is right 33% of the time, and always picking the home team about 45%.

### Published football model: backtest

- **Period:** the 2024-25 and 2025-26 seasons (MLS 2024 and 2025).
- **Method:** every match predicted only from earlier data, graded on the last prediction before kick-off.
- **Source:** the published `accuracy.json`.

| | Matches | Right |
|---|---|---|
| **All calls** | 7,740 | **52.5%** |
| Bookmakers' favourite, for comparison | 7,542 | 52.8% |
| **Strong** calls (16% of matches) | 1,263 | **75.9%** |
| Likely (31%) | 2,389 | 56.2% |
| Lean (33%) | 2,567 | 46.1% |
| Toss-up (20%) | 1,521 | 37.8% |
| **Safer calls** (two outcomes) | 7,740 | **78.9%** |
| Over/under 2.5 goals | 7,614 | 57.2% |
| Draw calls (5.5% of matches; draws happen 25.4% of the time) | 427 | 33.5% |

### Published football model: live record

Every prediction published since the pipeline went live, graded on its last version before kick-off: **28 matches** as of 25 Nov 2026.
- calls 60.7% right (17 of 28);
- safer calls 82.1%;
- over/under 71.4%.

That is far too few matches to judge: chance alone moves it by about ±18 points. The backtest is the honest expectation, and the app shows both.

### On-device models (other competitions and sports)

Earlier walk-forward backtests. NFL, NHL and MLB settings were tuned on older games and scored on the most recent 30%, which the tuning never saw.

| | Games | Hit rate | Log loss | Hit rate by confidence (high / medium / low) |
|---|---|---|---|---|
| Football (10 competitions) | 1,805 | 50% | 1.016 | 72% / 53% / 43% |
| NBA | 1,301 | 67% | 0.607 | 81% / 69% / 57% |
| NFL (held out) | 256 | 62.1% | 0.636 | 80% / 61% / 50% |
| NHL (held out) | 512 | 58.0% | 0.669 | 76% / 61% / 52% |
| MLB (held out) | 1,383 | 57.0% | 0.682 | 66% / 60% / 54% |

For the two-outcome sports a coin flip scores 50% (log loss 0.693), and always picking the home side scores 52–54%.

---

## 9. Match data, expected goals and player photos

### Live match data

The phone fetches fixtures, live scores, tables, line-ups, match stats, timelines, commentary, player stats and news from ESPN's public sports feeds:
- live matches refresh every 20–30 seconds while the screen is open;
- **Data saver** turns automatic refresh off;
- team crests are requested at display size and cached.

ESPN's feed is public but unofficial: undocumented, with no service guarantee, and not licensed for commercial redistribution. It suits a free, sideloaded app. A commercial launch should switch to a licensed provider through server mode. The data pipeline never fetches ESPN, because ESPN's terms forbid automated extraction ([section 12](#12-data-sources-and-their-terms)).

### Expected goals (xG)

xG is the probability that a shot is scored, given where it was taken from.

- **Model:** MK Sports' own logistic regression on distance to goal and the angle of the goal mouth, fitted on 22,711 real non-penalty shots from 910 matches (top five leagues, Championship and Champions League). Penalties use the observed 77% conversion rate.
- **Validation:** on held-out matches, 361 goals against 368.0 xG, log loss 0.262 (0.278 for a constant rate), and well calibrated by decile.
- **Limits:** it is the app's own estimate. The feed doesn't record the body part, so a header and a shot from the same spot get the same value.

Code: `engine/scripts/collect_shots.py`, `fit_xg.py`.

### Player photos

**Why not ESPN's:** ESPN has photos for very few current players: 38 of the 605 players in Premier League squads (6%), measured on 24 Nov 2026.

**Where they come from:** player photos come from **Wikimedia Commons**, found through **Wikidata**. Both are free to reuse with credit, and neither needs a key.

**How the photos are made:**
1. The data pipeline matches footballers by date of birth and name, or by ESPN ID where Wikidata has one.
2. It downloads each player's newest freely licensed photo and finds the face (OpenCV).
3. It saves a 160 px square crop and hosts it on GitHub Pages.
4. A second, independent face detector must confirm every crop. On the first 128 crops, checked by eye, it rejected exactly the 7 that showed grass, legs or a shirt, and kept all 121 real faces.

**How the phone uses them:**
- It matches each player with the squad data it already loads.
- If there is no photo, it shows ESPN's photo, then the shirt number.
- Each photo is credited on the player page and on the [credits page](https://dynohunter3.github.io/mk-sports/photo-credits.html).
- Only CC0, public domain, CC BY and CC BY-SA photos are used.

**Coverage (measured):**
- **Premier League squads:** 64% have a Wikimedia photo, against 6% with ESPN photos.
- **Liverpool v Manchester United squads:** 36 of 40, against 2 with ESPN photos.
- **Published so far:** 7,046 players as of 25 Nov 2026, out of 11,323 candidates. The rest are added over the next pipeline runs, apart from photos with no usable face.

**How current they are (measured on all 7,046):**
- 21% were taken in 2024 or later, and 30% in 2022 or later;
- half were taken in 2018 or earlier;
- 182 photos are undated.

Photos are only as current as Wikimedia's, so many are years old even though the newest photo of each player is always chosen. Uniform, current "face cards" for nearly every player would need a paid provider (for example TheSportsDB, $9 a month, whose free key does not allow published apps).

Code: `pipeline/mkdata/photos.py`, `mobile/src/data/photos.ts`.

---

## 10. Competitions covered

**Football:**
- **Leagues:** Premier League, EFL Championship, LaLiga, Serie A, Bundesliga, Ligue 1, Eredivisie, Liga Portugal, Süper Lig, Saudi Pro League, MLS.
- **English cups:** FA Cup, EFL Cup (Carabao Cup).
- **Club competitions:** UEFA Champions League, Europa League, Conference League, CAF Champions League.
- **International:** Africa Cup of Nations, FIFA World Cup, World Cup Qualifying (Africa).
- **Published pipeline predictions** cover 11 of these (listed in [section 7](#7-ai-predictions)); the others are predicted on the phone.

**Other sports:**
- **Team sports:** NBA, NFL, NHL, MLB.
- **Tennis:** ATP and WTA.
- **Motorsport:** Formula 1.
- **Cricket:** every competition ESPN covers.

**Not included, and why:**
- **Zambia Super League:** ESPN's coverage stopped in September 2025, and TheSportsDB's free tier is too incomplete to show. Full coverage needs a paid data provider.
- **Player match ratings** (the 6.6-style numbers some apps show): the free data has no ratings, and the app doesn't invent them.
- **Tipster sites:** they forbid scraping and publish no accuracy record.

---

## 11. The data pipeline

A GitHub Actions workflow (`.github/workflows/data-pipeline.yml`) runs **every 6 hours** (00:17, 06:17, 12:17 and 18:17 UTC), or on demand. It runs on GitHub's free minutes, so no server is needed.

1. **Install and test:** the pipeline's own test suite must pass first.
2. **Fetch:** the current season from every permitted source, plus upcoming fixtures and current odds.
3. **Link:** give every team and match one internal ID, cross-check sources and log every disagreement.
4. **Ratings:** MK Sports' own Elo.
5. **Retrain** the model on the 1st of the month, or when the model code changes.
6. **Predict** the next 21 days. Only predictions whose inputs changed are rewritten, and each keeps its history.
7. **Grade** finished matches.
8. **Player photos:** the incremental Wikidata and Wikimedia step ([section 9](#player-photos)). It follows Wikimedia's robot policy: a User-Agent with contact details, one request at a time, standard thumbnail sizes, and Retry-After honoured. A failure in this step never fails the job.
9. **Publish to GitHub Pages:**
   - `football_predictions.json`, `accuracy.json` and `model.json`;
   - the player photos;
   - the download page (`pages/index.html`), the league-link page (`pages/l.html`) and the photo credits page (`pages/photo-credits.html`).

   A mirror is kept on the `predictions` branch, without photos, so the app always has a second source.
10. **Health check:** a critical problem, such as stale results or failing sources, fails the job, and GitHub emails the repository owner.

**Keys:** optional keys (`FOOTBALL_DATA_ORG_KEY`, `THE_ODDS_API_KEY`, `BALLDONTLIE_API_KEY`) live only in the repository's Actions secrets and reach the job as environment variables. A source without its key is skipped automatically, and none are set at present.

Run it locally from `pipeline/`:

```bash
python -m pip install -r requirements-model.txt -r requirements-photos.txt pytest
python -m mkdata sync --current && python -m mkdata upcoming && python -m mkdata link && python -m mkdata elo
python -m mkmodel.production predict
python -m mkdata photos --budget 4000
python -m pytest -q
```

More in [pipeline/README.md](pipeline/README.md).

---

## 12. Data sources and their terms

The terms and robots.txt of every candidate source were read before use. A source is used only if its terms allow it. Full details: [docs/SOURCE_REGISTRY.md](docs/SOURCE_REGISTRY.md).

| Source | Used for | Status |
|---|---|---|
| football-data.co.uk | Results, shots, odds (history and current) | **On** |
| openfootball (GitHub) | Fixtures and results | **On** |
| MK Sports Elo | Ratings | **On** |
| Wikidata | Player dates of birth, photos, ESPN IDs | **On** (CC0) |
| Wikimedia Commons | Player photos | **On** (each photo's free licence, credited) |
| football-data.org (free tier) | Fixtures, results, standings | Off until a key is added |
| The Odds API (free plan) | Current odds | Off until a key is added |
| BALLDONTLIE (free tier) | NBA results | Off until a key is added |
| ESPN APIs | — | **Not used by the pipeline:** the terms forbid automated extraction. The app reads ESPN on each phone. |
| ClubElo, API-Football | — | Not used: terms could not be confirmed |
| NBA.com, Understat, FBref | — | Not used: terms forbid it, or excluded |

---

## 13. For developers

### Repository layout

```
.
├── mobile/      The app: React Native 0.88, Expo SDK 58, Expo Router; on-device data layer, game, leagues, notifications
├── pipeline/    Data pipeline: mkdata (sources, IDs, store, health, photos) and mkmodel (training, predictions, grading)
├── pages/       Public site: download page, league-link page, photo credits
├── engine/      Reference prediction engine (Python) and the xG fitting scripts
├── backend/     Optional server mode: FastAPI API, provider adapters, jobs
├── db/          schema.sql for the server database
├── audit/       Measured results of the engine audit and rebuild
├── docs/        Architecture, API, prediction engine, design, release notes, audit reports, source registry
└── docker-compose.yml
```

### Run the app

```bash
cd mobile
npm install
npx expo start                      # a: Android, w: web
npx expo export --platform web      # a web build, handy for previews at phone size
```

By default the app runs in **device mode**: no server, account or key.

### Build the Android APK

```bash
cd mobile
./scripts/build-apk.sh
```

- **Requirements:** JDK 17 and Node 20+.
- **What it does:** installs the Android SDK on first run, generates the native project with `expo prebuild`, and runs `gradlew assembleRelease`.
- **Output:** `mobile/dist-apk/MKSports-<version>.apk`.

**Signing with the release key:** put these in `~/.gradle/gradle.properties`:

```
PREDICTPRO_UPLOAD_STORE_FILE=/path/to/predictpro-upload.keystore
PREDICTPRO_UPLOAD_STORE_PASSWORD=...
PREDICTPRO_UPLOAD_KEY_ALIAS=predictpro
PREDICTPRO_UPLOAD_KEY_PASSWORD=...
```

- **Keep the keystore private and backed up.** It is not in the repository, and every future update must be signed with the same key, or phones won't accept it as an update.
- Without these settings the APK is signed with the debug key: it installs, but can't update a release-signed copy.
- Build settings live in `mobile/plugins/` (`withAndroidRelease.js`, `withLiveTracking.js`). The `android/` folder is generated and not committed.
- The version is set in `mobile/app.json`: `version`, and `android.versionCode`, which must go up with every release.

### Tests

Counts measured on 25 Nov 2026:

```bash
cd mobile   && npm test && npx tsc --noEmit   # 61 tests
cd pipeline && python -m pytest -q            # 71 tests
cd engine   && python -m pytest -q            # 37 tests
cd backend  && python -m pytest -q            # 71 passed, 2 skipped (Redis tests skip without a local Redis)
```

- **App tests:** engine parity with Python, the data layer, the game, private leagues, player photo matching, notifications, scorelines and published predictions.
- **Pipeline tests:** adapters, the HTTP client's politeness rules, linking, models, picks, production and photos.

### Server mode (optional)

The backend adds accounts (email, Google and phone through Supabase Auth), global, friends and private leaderboards, and server-side provider keys. In development it uses a simulated data provider, so it runs without keys. The app talks to it when `EXPO_PUBLIC_API_URL` is set.

```bash
cd backend
python3 -m venv .venv && . .venv/bin/activate
pip install -e ../engine -e ".[dev]"
cp .env.example .env
python -m app.cli migrate && python -m app.cli seed
uvicorn app.main:app --host 0.0.0.0 --port 8000      # API docs at http://localhost:8000/docs
```

- **Docker:** `docker compose up -d --build`, then `docker compose run --rm api python -m app.cli seed`.
- **Real data:** set `PROVIDER_FOOTBALL`, `FOOTBALL_DATA_API_KEY`, `PROVIDER_BASKETBALL` and `API_SPORTS_KEY` in `backend/.env`. Keys live only on the server.
- **Not yet proven:** the provider adapters and the Supabase sign-in flows are written against the providers' documentation and tested with sample data, but have not been run against live accounts.

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/API.md](docs/API.md).

---

## 14. Version history

| Version | Date | Highlights |
|---|---|---|
| 1.0–1.4 | before Nov 2026 | Live scores and match centre on ESPN data; on-device predictions; glass design with competition colours and real crests; Stats, News and My Team; NFL, NHL, MLB, tennis, F1 and cricket; xG model |
| 1.5.0 | 6 Nov 2026 | Football predictions from the new data pipeline (terms-checked sources, walk-forward tested models); in-app accuracy tracker |
| 1.6.0 | 10 Nov 2026 | Draw calls, call strength, safer calls, over/under, more history |
| 1.7.0 | 22 Nov 2026 | Draw calls on the phone, Predictions screen, post-match review |
| 1.8.0 | 24 Nov 2026 | Results review, prediction movement, the record on Home; pipeline every 6 hours |
| 2.0.0 "Matchday" | 24 Nov 2026 | New design; Quick Picks; you vs the AI; levels, badges, celebrations; My game |
| 2.1.0 | 24–25 Nov 2026 | Private leagues; profiles with avatars; reliable alerts (exact alarms, live tracking); line-ups on a full pitch; goals outlook; player photos from Wikimedia Commons; pulsing favourite-team row; Contact us; download page; fixes (match score cut-off, finished matches failing to open) |

Release notes: [docs/RELEASE_2_1.md](docs/RELEASE_2_1.md), [docs/DESIGN_2_0.md](docs/DESIGN_2_0.md), and the Step reports in [docs/audit](docs/audit/).

---

## 15. Known limitations

- **No iPhone version.**
- **Not on the Play Store.** The app is installed from the download page.
- **Live data comes from ESPN's unofficial feed.** It is fine for a free app; a commercial launch needs a licensed provider.
- **Alerts:** instant alerts for matches during which the app was never opened would need a push server.
- **Private leagues** update when members share a link, not automatically.
- **Player photos:** about two-thirds coverage in the Premier League, and many photos are years old (see [section 9](#player-photos)).
- **The Zambia Super League isn't covered,** because no free source has complete data.
- **Predictions are probabilities, not certainties.** Even the strongest calls were wrong about a quarter of the time in testing.

---

## 16. Documentation

| Document | What's in it |
|---|---|
| [docs/RELEASE_2_1.md](docs/RELEASE_2_1.md) | Everything new in 2.1: sharing, leagues, notifications, line-ups, photos |
| [docs/DESIGN_2_0.md](docs/DESIGN_2_0.md) | The 2.0 design system and the game |
| [docs/SOURCE_REGISTRY.md](docs/SOURCE_REGISTRY.md) | Every data source, its terms as read, and whether it is used |
| [docs/audit/](docs/audit/) | Steps 1–9: how the prediction model was audited, rebuilt and measured |
| [docs/PREDICTION_ENGINE.md](docs/PREDICTION_ENGINE.md) | The original prediction engine (server mode and the phone): models, explanations, versioning, backtests |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, data flow, jobs and caching (server mode) |
| [docs/API.md](docs/API.md) | Server API endpoints |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Future plans |
| [pipeline/README.md](pipeline/README.md) | Running the data pipeline |
