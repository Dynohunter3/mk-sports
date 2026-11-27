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
| **Current version** | 2.3.2 (Android 7.0 or newer, about 55 MB) |
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
2. Create a tag such as `v2.3.2` and add the release notes.
3. Attach the APK, named exactly `MKSports.apk`, and click **Publish**.

No release has been published yet; until one is, the download button returns "not found".

---

## 2. What's in the app

### The five tabs

| Tab | What it does |
|---|---|
| **Home** | Search (teams, players, competitions). Your team's live, next and last match. Quick Picks, with shortcuts to **My game** and **Private leagues**. The model's record. "Results are in" celebrations. The live strip, trending headlines, top predictions, coming up and latest results. League chips filter the feed and switch the screen to that competition's colours. |
| **Scores** | Any day, any sport: football, basketball, American football, ice hockey and baseball. Tennis (ATP and WTA draws with set scores), Formula 1 (race weekends with session results) and cricket (live, results and upcoming). |
| **My Team** | The favourite-team hub: next match with prediction, results, form, table position, top players, squad and team news. |
| **News** | Live matches across the top, then the latest headlines from your competitions and your team. Articles open in the in-app browser. |
| **Stats** | Pick a competition. **Football:** full table, **Forecast** (the season simulator: title, top four, promotion and relegation chances), **xG table** (who deserved what), fixtures, results and player stats (goals, assists, shots, cards, fouls, passes, saves, plus team clean sheets). **US sports:** standings and leaders. **F1:** drivers' and constructors' standings. **Tennis:** rankings. |

### Match centre

- **Header:** the score in a split of both teams' colours, with expected goals (xG) for football. The score always fits, even with large text sizes.
- **Overview:**
  - the AI prediction and its call (see [section 7](#7-ai-predictions)), the goals outlook, form, head-to-head and the table;
  - a link to the prediction's entry in the public record on GitHub;
  - a share button that makes a 9:16 card of the prediction.
- **Deserved result** (football with shot positions), for example "Arsenal won the xG 2.1–0.7 but lost 0–1":
  - Each shot is a chance to score with probability equal to its xG, which gives the chance of each result on the shots both sides had.
  - After a missed call the review says whether the chances favoured the call or the result.
- **Win probability** (football, live and finished matches): home / draw / away through the match, with goal and red-card markers and the biggest swing.
  - Worked out on the phone from the model's pre-match expected goals, scaled to the minutes left, adjusted for red cards (×0.70 for the side down to ten players, ×1.25 for its opponent) and started from the score.
  - It is a transparent estimate: tactics and injuries are not modelled.
- **Line-ups:**
  - Both teams on one pitch, home attacking down and away attacking up, with each side's formation at the halfway line.
  - Each player card shows the photo, or a shirt in the colours actually worn in that match, with the shirt number, goals, assists, cards and the substitution minute.
  - Below the name: the goalkeeper's saves, and the player's own xG from his shots.
  - Substitutes for both sides, with who each one replaced, and the referee.
  - Tap any player for their match, season and last five games.
  - There are no 0-10 player ratings: the free data has none, and the app doesn't invent them.
- **Stats:** possession, xG, shots, shots on target, corners, fouls, passes, pass accuracy, offsides, saves, cards and tackles. Also a shot map.
- **Timeline and commentary.**

### Other screens

| Screen | What it does |
|---|---|
| **Team page** (and My Team) | Next match, last result, the table, the **season forecast** ("Arsenal: 79% title chance, ▲2 since last week", every finishing place's chance, projected points) and **team strength**: the model's own rating since 2016-17 against the league average. |
| **Player page** | Photo (with its credit), position, number, age, nationality, club, season stats, recent matches and, for football, **season xG**: xG, non-penalty xG, xG per 90 and goals minus xG (MK Sports' own estimate). |
| **Search** | Teams, players and competitions; opens their pages. |
| **Predictions** | Every published football prediction for the coming days, with its call, strength and safer call. Filters for draw calls, strong calls, the safest calls and recent results. It works offline from the last saved copy. |
| **How accurate is the model?** | The live record against the tested range; RPS and a calibration chart; the backtested record by call strength, competition and confidence. |
| **Quick Picks** | A swipeable deck of upcoming matches (see [section 3](#3-the-game-quick-picks-points-levels-and-badges)). |
| **My game** | Level ring, you vs the AI, share my week, probability picks (Brier score against the AI), the season recap, this week's banker, F1 and tennis picks, streak, accuracy, exact scores, the badge cabinet, recent results, points by week and the season archive. |
| **Season recap** | Best pick, longest streak, the team you call best, and your season against the AI, with a share card. |
| **F1 podium / tennis pick** | Pick the top three for a race, or a tennis winner and the number of sets. |
| **Private leagues** | Create, join and share leagues with friends (see [section 4](#4-private-leagues)). |
| **Settings** | Profile (name and avatar), favourite team, sports and competitions; notifications; dark or light theme; animations and vibration; data saver; data sources; player photo credits; the My team widget; contact us; privacy (back up, restore or delete your data). |
| **Home-screen widget** | "My team": your team's live score, or its next match and last result. Updated every 30 minutes, and every 30 seconds while live tracking runs during your matches. |

### Design

The 2.0 "Matchday" design:
- **Type:** Barlow Condensed for titles and scores.
- **Colours:** each team's own colours on match cards and headers, with bold gradients for big moments.
- **Motion:** cards dip and spring back with a light haptic tap; lists rise into place; skeleton loaders instead of spinners; confetti for wins.
- **League tables:** your team's row pulses in its own colours.
- **Accessibility:**
  - Settings has **Animations** and **Vibration** switches, and the phone's reduce-motion setting is respected.
  - Text on team colours is black or white by WCAG contrast ratio, so yellow and light kits get dark text, and white headlines sit on colours darkened just enough to stay readable.
  - Quick Picks works with TalkBack: labelled buttons, a described card and the AI's call read out.

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

**Banker:** once a week (by kick-off date) make one pick your banker for **double points**. Switch it on from the pick screen; it can move to another match until its current match kicks off.

**Season archive:** My game lists every season (July to June) with points, accuracy, exact scores, best streak and bankers won.

**Probability picks:** on any match, switch the pick screen to **Probability pick** and give your own home, draw and away chances.
- **How you set them:** in 5-point steps; they always add up to 100%, and you can start from the AI's numbers.
- **Points:** your most likely outcome is your call and earns the usual points.
- **The Brier score:** each probability pick is also scored against the AI's chances from the same moment, on the same matches.
  - 0 is perfect, and a third on each result always scores 0.67; lower is better.
  - My game shows your average against the AI's, and how many matches each of you scored better on.
- **Quick Picks** stays the simple mode.

**F1 and tennis:**
- **F1:** predict the podium during a race weekend (Scores > Formula 1, or My game). 5 points for each driver in the right place, 2 for a driver on the podium in another place, 5 more for all three (up to 20).
- **Tennis:** tap an upcoming match in Scores > Tennis and pick the winner (3 points) and the number of sets (2 more). Men's Grand Slam singles are best of five sets.
- **Settling:** from ESPN's results. A pick still unresolved 10 days after the start is void.
- **Points:** they count towards your level. There are no AI predictions for these sports, so they are not part of you vs the AI.

**Season recap:** best pick (the least likely call that came off, by the AI's own numbers when you picked), longest streak, the team you call best (most right on its matches, from at least three picks), and your season against the AI.

**Share cards:** 9:16 images (1080 × 1920) for WhatsApp Status, each with the download QR code:
- your week against the AI (My game);
- a match prediction (match page);
- a private league table;
- the season recap.

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

**Matchweek awards:** worked out from members' cards each week:
- **Sharpshooter of the week:** most points;
- **Biggest climber:** most places gained;
- **On fire:** the longest current run of correct picks.

From 2.3, cards also carry the previous week's points, so last week's awards still work after members share again. Links from older versions still open.

**Share the table as an image** with the picture button next to Share & update.

**Reminder:** with "Pick results" alerts on, league members get a reminder to Share & update about two and a half hours after the kick-off of their last pick of the week.

**Limits:**
- **Tables update only when members share,** so tap **Share & update** after each matchday.
- **A determined person could edit a link.** It's meant for friendly leagues with no prizes.
- **Automatic live tables** (no sharing step) would need a small server, for example a free Supabase project in the owner's account. The plan is in [docs/RELEASE_2_2.md](docs/RELEASE_2_2.md).

Code: `mobile/src/data/pleagues.ts` (with tests), `mobile/src/app/private-leagues.tsx`, `mobile/src/app/pl.tsx`.

---

## 5. Your profile and your data

- **Profile:** each phone has its own name, avatar (12 to choose from), picks, points, badges and leagues. No account is needed.
- **Storage:** everything is kept on the phone.
- **Private leagues:** a score card leaves the phone only when you share a league link yourself.
- **Settings > Privacy:**
  - **Back up my data:** saves a file with your profile, picks, points, badges, private leagues and settings, anywhere you like (Drive, email, a chat).
  - **Restore from a backup:** loads that file on a new phone or after reinstalling. Files exported by 2.1 also work.
  - **Delete my data.**
- **Android Auto Backup:** includes the app's data from 2.2. Tested on an Android 10 emulator: back up, wipe and restore brought the database back intact. In 2.1 the rules left the data out, so a restore brought back nothing.
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

- **The MK Sports data pipeline** ([section 11](#11-the-data-pipeline)) publishes the football predictions for 20 competitions:
  - Premier League, Championship, League One, League Two;
  - LaLiga, LaLiga 2, Serie A, Serie B, Bundesliga, 2. Bundesliga, Ligue 1, Ligue 2;
  - Eredivisie, Liga Portugal, Süper Lig, Scottish Premiership, Belgian Pro League, Greek Super League;
  - MLS and the Champions League.

  The nine added in 2.2 each beat the on-device engine on the same matches in two test seasons ([Step 10](docs/audit/STEP10_MORE_LEAGUES.md)). Their fixtures arrive only 2–4 days ahead, so further out the app shows its on-device estimate for them.

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

### Proof: a public record before kick-off

- **The record:** every pipeline run adds a commit to the repository's [`predictions` branch](https://github.com/Dynohunter3/mk-sports/commits/predictions) with that run's `football_predictions.json`.
  - From 26 Nov 2026 the branch is added to and never force-pushed, so every published version stays in its history.
  - Before that, each run replaced the last one, so earlier predictions have no commit.
- **The proof index:** `proof.json` records the first commit that published each version of each prediction.
- **In the app:** the match page links each published prediction to that commit ("In the public record since 25 Nov, 14:25, before kick-off").
- **The public track record page** (`record.html` on the site) grades every prediction against the result, with the same links.
- **What it proves:**
  - A commit's own date is written by whoever makes it. The stronger evidence is the GitHub Actions run linked from each entry, whose time GitHub records.
  - The repository owner could still rewrite the branch. A rule that blocks force pushes to `predictions` (Settings > Rules) closes that gap; it is not switched on yet.

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

- **Period:** the 2024-25 and 2025-26 seasons (MLS 2024 and 2025), all 20 published competitions.
- **Method:** every match predicted only from earlier data, graded on the last prediction before kick-off.
- **Source:** `audit/results/step10.json`, shown in the app.

| | Matches | Right |
|---|---|---|
| **All calls** | 14,423 | **50.4%** |
| Bookmakers' favourite, for comparison | 14,205 | 51.0% |
| **Strong** calls (12% of matches) | 1,687 | **75.6%** |
| Likely (29%) | 4,236 | 57.8% |
| Lean (36%) | 5,237 | 44.6% |
| Toss-up (23%) | 3,263 | 37.1% |
| **Safer calls** (two outcomes) | 14,423 | **78.2%** |
| Draw calls (7.4% of matches; draws happen 26.0% of the time) | 1,074 | 33.1% |
| Over/under 2.5 goals (11 competitions, Step 6) | 7,614 | 57.2% |

The hit rate is lower than the 52.5% published for the original 11 competitions because lower leagues are harder to call, not because the model got worse: on those 11 it is unchanged.

**How good the probabilities are:**
- **Ranked probability score (RPS):** 0.2035, against 0.2023 for the bookmakers' closing odds on the same matches (lower is better).
- **Calibration:** calls given 70–80% won 76.5% of the time (average given 74.4%); calls given 80% or more won 85.7% (average given 83.9%).

### Published football model: live record

Every prediction published since the pipeline went live, graded on its last version before kick-off: **28 matches** as of 25 Nov 2026.
- calls 60.7% right (17 of 28);
- safer calls 82.1%;
- over/under 2.5 goals 71.4%;
- live RPS 0.188.

That is far too few matches to judge.
- **The band:** the app draws the 95% range chance allows around the tested hit rate, about ±19 points at 28 matches.
- **Too early under 100 matches:** until then it says it is too early to judge.
- **From 100 matches:** a record outside the range is flagged in the app and raised as a warning in the pipeline's health check.

### Season forecasts (the simulator)

- **The backtest:** run from 1 December and 1 March of 2024-25 and 2025-26, with the model retrained each time on earlier data only. It covered 52 league tables and 1,036 team forecasts ([Step 11](docs/audit/STEP11_SEASON_SIMULATOR.md)).
- **Result:** the simulator's chances beat "the table as it stands" for every zone (Brier score, lower is better):
  - title 0.018 against 0.031;
  - top four 0.041 against 0.071;
  - relegation 0.051 against 0.100;
  - play-off places 0.095 against 0.182.
- **Calibration:** close. Chances given 10–25% happened 16.4% of the time (average given 16.5%); 75–90% happened 82.6% (82.5%).
- **Slightly too sure:** long shots (2–10%) happened a little more often than given, the expected effect of keeping each fixture's chances fixed. So the app never shows 0% or 100%, only "<1%" and ">99%".

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

**Step 12 (2.3.1), NBA, NHL and NFL** ([report](docs/audit/STEP12_US_SPORTS.md)): settings chosen on 2024-25 and tested on 2025-26.
- **NBA:** a new model blends opponent-adjusted ratings (who you beat counts, recent games weighted) 70/30 with the old one. On 1,326 test games, log loss went from 0.602 to 0.598 and the hit rate from 67.9% to 68.5%.
- **NHL and NFL:** none of the candidates beat the current models on the test season, so they are unchanged.
- **Bookmaker lines:** when ESPN lists one, the app now puts 90% of the weight on it for these three sports instead of two-thirds. That was better on both seasons.
- **Still behind the bookmakers:** test-season log loss NBA 0.598 against 0.577, NHL 0.686 against 0.681, NFL 0.626 against 0.609.

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
- **xG table:** Stats > xG table ranks a league by expected points, so you can see who has been lucky and who is due to improve.
  - Expected points come from each match's shots: the exact chance of each result if every shot scores with probability equal to its xG.
  - It is worked out on the phone; each finished match is downloaded once and kept.
  - With data saver on, the app asks before downloading.
  - Matches without shot positions are left out for both teams, and the table says how many.
- **Player xG:** the player page adds up each player's shots over their team's league matches this season. Minutes come from the line-ups. Matches without shot positions are left out, and the page says how many.
- **Free-kick goals:** since 2.2 they count as shots; they come as subtypes such as `goal---free-kick`, which were skipped before. The model itself was fitted on the narrower list (a small effect).
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
- **Leagues:** Premier League, EFL Championship, League One, League Two, LaLiga, LaLiga 2, Serie A, Serie B, Bundesliga, 2. Bundesliga, Ligue 1, Ligue 2, Eredivisie, Liga Portugal, Süper Lig, Scottish Premiership, Belgian Pro League, Greek Super League, Saudi Pro League, MLS.
- **English cups:** FA Cup, EFL Cup (Carabao Cup).
- **Club competitions:** UEFA Champions League, Europa League, Conference League, CAF Champions League.
- **International:** Africa Cup of Nations, FIFA World Cup, World Cup Qualifying (Africa).
- **Published pipeline predictions** cover 20 of these (listed in [section 7](#7-ai-predictions)); the others are predicted on the phone.

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
2. **Fetch:** the current season from every permitted source, plus upcoming fixtures and current odds. Full history is fetched once for any competition added since the store was built (`sync --backfill --missing`), and skipped after that.
3. **Link:** give every team and match one internal ID, cross-check sources and log every disagreement.
4. **Ratings:** MK Sports' own Elo.
5. **Retrain** the model on the 1st of the month, or when the model code changes.
6. **Predict** the next 21 days. Only predictions whose inputs changed are rewritten, and each keeps its history.
7. **Grade** finished matches.
8. **Season simulator:** every remaining league fixture, 10,000 times, published as `simulations.json` ([Step 11](docs/audit/STEP11_SEASON_SIMULATOR.md)).
9. **Team strength history:** each team's rating over the seasons, published as `elo/<competition>.json`.
10. **Player photos:** the incremental Wikidata and Wikimedia step ([section 9](#player-photos)). It follows Wikimedia's robot policy: a User-Agent with contact details, one request at a time, standard thumbnail sizes, and Retry-After honoured. A failure in this step never fails the job.
11. **Publish to GitHub Pages:**
   - `football_predictions.json`, `accuracy.json`, `simulations.json`, `elo/` and `model.json`;
   - the player photos;
   - the download page (`pages/index.html`), the public track record (`pages/record.html`), the league-link page (`pages/l.html`) and the photo credits page (`pages/photo-credits.html`).

   The `predictions` branch keeps the same files, without photos, so the app always has a second source.
   - **One commit per run:** each run's files are added on top of the last, never force-pushed, so the branch is the public record of every prediction.
   - **The proof index:** a second commit adds `proof.json`, mapping each prediction to the commit that first published it.
12. **Health check:** a critical problem, such as stale results or failing sources, fails the job, and GitHub emails the repository owner.

**Keys:** optional keys (`FOOTBALL_DATA_ORG_KEY`, `THE_ODDS_API_KEY`, `BALLDONTLIE_API_KEY`) live only in the repository's Actions secrets and reach the job as environment variables. A source without its key is skipped automatically, and none are set at present.

Run it locally from `pipeline/`:

```bash
python -m pip install -r requirements-model.txt -r requirements-photos.txt pytest
python -m mkdata sync --current && python -m mkdata upcoming && python -m mkdata link && python -m mkdata elo
python -m mkmodel.production predict
python -m mkmodel.simulate && python -m mkmodel.elo_history
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
cd mobile   && npm test && npx tsc --noEmit   # 104 tests
cd pipeline && python -m pytest -q            # 77 tests
cd engine   && python -m pytest -q            # 37 tests
cd backend  && python -m pytest -q            # 71 passed, 2 skipped (Redis tests skip without a local Redis)
```

- **App tests:** engine parity with Python, the data layer, the game (including bankers and the season archive), private leagues, player photo matching, notifications, scorelines, published predictions, win probability, player xG, search, backup and restore, colour contrast, the widget, probability picks, F1 and tennis picks, the season recap, matchweek awards, the xG table and the season forecast.
- **Pipeline tests:** adapters, the HTTP client's politeness rules, linking, models, picks, production (including RPS and the live record check), the season simulator, the Elo history and the proof index, and photos.

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
| 2.2.0 | 25 Nov 2026 | Live win probability; player xG; search; My team home-screen widget; back up and restore, and Android Auto Backup that actually includes the data; weekly banker and season archive; league share reminder; contrast-aware text and TalkBack in Quick Picks; RPS, calibration and the live record band on the accuracy page; nine more leagues on the published model |
| 2.3.2 | 27 Nov 2026 | Line-ups redesigned: both teams on one pitch with full markings; player cards with photo or kit shirt in the colours actually worn, number, goals, assists, cards, substitution minute, saves and each player's xG; substitutes side by side with who they replaced |
| 2.3.1 | 27 Nov 2026 | NBA predictions: opponent-adjusted ratings (Step 12); 90% weight on bookmaker lines when listed for NBA, NHL and NFL |
| 2.3.0 | 26 Nov 2026 | Season simulator (title, top four, promotion, relegation chances, with the weekly change); xG table and deserved results; team strength history; public record of every prediction with commit links and a track record page; probability picks (Brier score); F1 podium and tennis picks; share cards with QR code; season recap; matchweek awards in private leagues |

Release notes: [docs/RELEASE_2_3.md](docs/RELEASE_2_3.md), [docs/RELEASE_2_2.md](docs/RELEASE_2_2.md), [docs/RELEASE_2_1.md](docs/RELEASE_2_1.md), [docs/DESIGN_2_0.md](docs/DESIGN_2_0.md), and the Step reports in [docs/audit](docs/audit/).

---

## 15. Known limitations

- **No iPhone version.**
- **Not on the Play Store.** The app is installed from the download page.
- **Live data comes from ESPN's unofficial feed.** It is fine for a free app; a commercial launch needs a licensed provider.
- **Alerts:** instant alerts for matches during which the app was never opened would need a push server.
- **Private leagues** update when members share a link, not automatically. Automatic syncing needs a free Supabase project in the owner's account.
- **Fixtures for the nine leagues added in 2.2** reach the published model only 2–4 days ahead; further out the app uses its on-device estimate.
- **The widget** refreshes every 30 minutes, or about every 30 seconds while live tracking runs for your matches; otherwise a live score can lag.
- **Win probability** ignores tactics, injuries and substitutions, and assumes goals are equally likely in every minute.
- **Season forecasts** cover the 15 leagues decided by a plain table, not the Scottish Premiership, Belgium, Greece, MLS or the Champions League. They ignore point deductions and head-to-head tie-breakers.
- **The xG table** downloads every league match report once (cached afterwards), which is a lot of data the first time.
- **F1 and tennis picks** settle from ESPN's current scoreboards. A match that drops off the scoreboard before the app sees its result is void after 10 days.
- **The public record starts on 26 Nov 2026.** Force pushes to the `predictions` branch are not blocked by a repository rule yet.
- **Player photos:** about two-thirds coverage in the Premier League, and many photos are years old (see [section 9](#player-photos)).
- **The Zambia Super League isn't covered,** because no free source has complete data.
- **Predictions are probabilities, not certainties.** Even the strongest calls were wrong about a quarter of the time in testing.

---

## 16. Documentation

| Document | What's in it |
|---|---|
| [docs/RELEASE_2_3.md](docs/RELEASE_2_3.md) | Everything new in 2.3: season simulator, xG table, team strength, public record, probability picks, F1 and tennis, share cards, recap, awards |
| [docs/RELEASE_2_2.md](docs/RELEASE_2_2.md) | Everything new in 2.2: win probability, player xG, search, widget, backup, banker, accuracy measures, nine more leagues |
| [docs/RELEASE_2_1.md](docs/RELEASE_2_1.md) | Everything new in 2.1: sharing, leagues, notifications, line-ups, photos |
| [docs/DESIGN_2_0.md](docs/DESIGN_2_0.md) | The 2.0 design system and the game |
| [docs/SOURCE_REGISTRY.md](docs/SOURCE_REGISTRY.md) | Every data source, its terms as read, and whether it is used |
| [docs/audit/](docs/audit/) | Steps 1–12: how the prediction model was audited, rebuilt, measured and extended to 20 competitions, and how the season simulator was tested |
| [docs/PREDICTION_ENGINE.md](docs/PREDICTION_ENGINE.md) | The original prediction engine (server mode and the phone): models, explanations, versioning, backtests |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, data flow, jobs and caching (server mode) |
| [docs/API.md](docs/API.md) | Server API endpoints |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Future plans |
| [pipeline/README.md](pipeline/README.md) | Running the data pipeline |
