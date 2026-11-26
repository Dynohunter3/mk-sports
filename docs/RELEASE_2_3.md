# MK Sports 2.3

## Built on data we already have

### Season simulator

- **What it does:** every 6 hours the pipeline plays out every league fixture still to come, 10,000 times, with the model's probabilities. The results are published as `simulations.json`.
- **Covered:** 15 leagues, those decided by a plain table:
  - Premier League, Championship, League One, League Two;
  - LaLiga, LaLiga 2, Serie A, Serie B;
  - Bundesliga, 2. Bundesliga, Ligue 1, Ligue 2;
  - Eredivisie, Liga Portugal, Süper Lig.
- **Not covered, and why** (the app says so):
  - Scottish Premiership: the split after 33 rounds;
  - Belgium and Greece: play-offs;
  - MLS: conferences and play-offs;
  - Champions League: knockout.
- **Where it shows:**
  - **Stats > Forecast:** every team's chances (title, top four or promotion, relegation, and on tap the rest, every finishing place and the projected points), with arrows for the change since last week.
  - **My Team and team pages:** "Arsenal: 79% title chance, ▲2 since last week", every zone, a finishing-place chart and the points range.
- **Tested on finished seasons** ([Step 11](audit/STEP11_SEASON_SIMULATOR.md)): simulated from 1 December and 1 March of 2024-25 and 2025-26, with the model retrained each time on earlier data only.
  - The chances beat "the table as it stands" in every zone (Brier score): title 0.018 against 0.031, relegation 0.051 against 0.100.
  - They are well calibrated. Long shots came in slightly more often than given, so the app never shows 0% or 100%.
- **Noise:** weekly changes under 2 points are hidden, since simulation noise is about ±1.3 points.

### xG table and deserved results

- **Stats > xG table:** each league ranked by expected points from the chances in every match this season. A team well above its xPts has been lucky or clinical; one well below is due to improve.
  - Worked out on the phone from ESPN's shot positions with the app's xG model.
  - Each finished match is downloaded once and kept. With data saver on, the app asks first.
- **Match page:**
  - **A "deserved result" line**, for example "Arsenal won the xG 2.1–0.7 but lost 0–1."
  - **After a missed call:** the chance of each result on the shots both sides had, and whether the chances favoured the call or the result.

### Team strength history

- **Team page:** the model's own Elo rating since 2016-17 against the league average, with the current rating, rank, highest and lowest.
- **Consistent numbers:** the header shows the same rating. The rating replay matches the ratings stored with 264 recent predictions exactly.
- **Why from 2016-17:** the store starts in 2013 with every team on 1500, so the earlier seasons are a warm-up while ratings settle.

### Proof of predictions

- **The problem found:** the `predictions` branch was replaced (force-pushed) on every run, so it kept no history.
- **The fix:** it is now added to, never rewritten, one commit per run, and a second commit adds `proof.json`, mapping each prediction to the commit that first published it.
- **In the app:** each published prediction links to that commit on its match page.
- **The public track record page** (`record.html`) shows:
  - the live record and its chance band;
  - the tested record, with "Does 70% mean 70%?";
  - every graded prediction with its commit link;
  - the predictions coming up.
- **What it does and doesn't prove:** a commit's own date is written by the committer. The GitHub Actions run linked from each entry is the stronger evidence. A rule blocking force pushes to `predictions` (Settings > Rules) would stop the owner rewriting it; it is not switched on.
- **The record starts now:** predictions published before 26 Nov 2026 have no commit to link to.

## The game

- **Probability picks:** set your own home, draw and away chances (Make your pick > Probability pick).
  - Your most likely outcome is your call and earns the usual points.
  - The Brier score compares your chances with the AI's chances from the same moment, on the same matches. My game shows both averages.
  - Quick Picks stays the simple mode.
- **F1 and tennis picks:**
  - **F1 podium:** up to 20 points.
  - **Tennis:** the winner (3) and the number of sets (2 more).
  - Settled from ESPN's results; points count towards your level.
  - There are no AI predictions for these sports, so they are not part of you vs the AI.
- **Share cards** (9:16, saved at 1080 × 1920): your week against the AI, a match prediction, a private league table and the season recap. Each carries the download QR code.
- **Season recap:**
  - best pick (the least likely call that came off, by the AI's numbers when you picked);
  - longest streak;
  - the team you call best;
  - your season against the AI;
  - bankers;
  - F1 and tennis points.
- **Matchweek awards in private leagues:** Sharpshooter of the week, Biggest climber and On fire.
  - Cards now carry last week's points too, so last week's awards survive members sharing again.
  - Links from 2.2 still open.

## Release check

- **Tests:**
  - app: 100, including probability picks, Brier score, F1 and tennis scoring and settlement, the recap, the week report, matchweek awards, old-link compatibility, deserved results, the xG table and the forecast helpers;
  - pipeline: 77, including the simulator, the Elo replay and the proof index.
- **Pipeline, run locally on the current data:**
  - The simulator ran all 15 leagues in about 2 minutes, plus 2 minutes for the one-off week-ago run.
  - The Elo history covers 19 competitions and 374 teams, at about 30 KB per league.
  - The append-only mirror and the proof index were checked against a local Git remote over three runs: history kept, first commit kept per prediction, photos excluded.
- **Web previews:**
  - Stats > Forecast and xG table (110 of 110 Premier League matches this season);
  - the Arsenal team page (forecast and strength chart);
  - Liverpool 4–0 Manchester United (deserved line, chances verdict, public-record link);
  - the prediction share card;
  - My game (probability picks, recap entry, F1 and tennis, share my week);
  - the recap;
  - private leagues (awards);
  - the probability pick screen;
  - the public record page.
- **Emulator** (x86_64 build of 2.3.0, Android 10):
  - It installed over 2.2 and kept the saved data (profile and private league).
  - The matchweek awards showed in the league.
  - **Share image** produced the PNG from the league card and opened Android's share sheet (Gmail, Messages, Bluetooth). This is the native capture path that can't run on the web.
  - The emulator has no internet in this environment, so screens that need live data were checked in the web previews instead.
