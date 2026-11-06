# Step 1 audit: the current prediction engine (v2.1, app 1.4.1)

Branch `engine-v3`. No model code has been changed. Everything below was measured on real data and is reproducible:

```
cd mobile
node --import tsx scripts/audit/fetch-results.ts   # ESPN results, mid-2023 to now
node --import tsx scripts/audit/fetch-odds.ts      # ESPN closing lines (non-football-data leagues)
# football-data.co.uk CSVs into audit/data/fd/ (E0 E1 SP1 I1 D1 F1 N1 P1 T1, seasons 2324-2526; new/USA.csv)
node --import tsx scripts/audit/backtest.ts        # writes audit/results/step1.json
python3 audit/render_report.py audit/results/step1.json   # full tables: audit/results/step1_tables.md
```

## 1. Headline findings

* **Football is the weak spot.** On 10,208 matches across 20 competitions, the engine scores log loss 1.008, the same as a textbook Elo model (1.010). The advanced parts (attack/defence ratings, Dixon–Coles) add almost nothing.
  * The gap to bookmaker closing odds is 0.050 log loss. Hit rate is 50.8% against the bookmakers' 54.5%.
  * In cups and international football the gap is very large: FA Cup 0.139, EFL Cup 0.112, AFCON 0.108, World Cup qualifying 0.199, World Cup 0.243.
* **US sports are close to the market.** Log-loss gaps: NBA 0.024, NFL 0.022, NHL 0.010, MLB 0.004. The engine beats simple Elo in all four.
* **Calibration is good in aggregate** (football calibration error 0.009, the same as the bookmakers). It is poor in a few places:
  * NFL: 0.030, overconfident at the extremes (games the model gave 80–90% won 78% of the time).
  * Europa League: 0.050.
  * CAF competitions: 0.050–0.054.
  * WC qualifying (Africa): 0.087.
  * Eredivisie (0.032) and the Championship (0.024): about three to four times the bookmakers' error.
* **The engine itself is deterministic.** Two full runs gave byte-identical predictions (hash `69eecdefb137c36f`); there is no randomness and no seed to fix. The inconsistency users see comes from the app around the engine (section 6, causes C1–C4).
* **What explains a "4/10" rating.** The headline pick is right 50.8% of the time in football. 42% of football predictions are close calls (top probability under 45%), and those picks are right only 42% of the time. The engine almost never picks a draw (0.6% of matches) although 24% of matches are draws. The draw probabilities themselves are well calibrated (25.5% predicted vs 24.3% actual); the problem is how the pick is presented, not the probabilities.

## 2. Method

* **Data:** every finished match from July 2023 to 6 November 2026 for all 24 head-to-head competitions in the app (37,119 matches) from ESPN, the app's only results source.
* **Evaluation windows:** the last two full seasons of each competition.

  | Competitions | Seasons evaluated |
  |---|---|
  | European leagues, Saudi Pro League, UEFA competitions, English cups, CAF Champions League | 2024-25 and 2025-26 |
  | MLS | 2024 and 2025 |
  | NBA, NHL | 2024-25 and 2025-26 |
  | NFL | 2024 and 2025, incl. playoffs |
  | MLB | 2025 and 2026 |
  | AFCON | 2023 (played early 2024) and 2025 |
  | World Cup | 2026 only (one tournament) |

  Earlier data is warm-up only. 21,176 predictions were scored.
* **Production-faithful walk-forward:** for each match day, the rating book is rebuilt from the finished matches of the previous 365 days (730 for the NFL). That is exactly the app's on-device history window. Nothing from the match day or later is visible.
  * Every match is scored, including teams with no history, because users see those predictions too.
  * The one NFL tie is excluded, as in the app.
* **Metrics:** accuracy (most likely outcome), log loss (natural log), Brier score (multi-class sum of squares), and reliability tables (all outcome probabilities, 10 bins) with expected calibration error (ECE).
* **Benchmarks, on the same matches:**
  * **(a) Always home.** Accuracy of always picking the home side. For log loss and Brier, its probabilistic twin uses the league's home/draw/away rates over the previous 365 days.
  * **(b) Simple Elo.** K=20, fixed home advantage, one-third regression between seasons, no margin of victory. The football draw probability is the league's recent draw rate.
  * **(c) Bookmaker closing odds**, margin removed proportionally:
    * Pinnacle closing from football-data.co.uk for Premier League, Championship, LaLiga, Serie A, Bundesliga, Ligue 1, Eredivisie, Liga Portugal, Süper Lig and MLS. 99.9% of rows (11,569 of 11,575) were matched to ESPN matches by date and score.
    * Everything else: the closing line ESPN's core API keeps for finished games (DraftKings, ESPN BET or Bet365). Coverage is 87–100%, except CAF Champions League at 60%.
* **Caveats:**
  * The NFL, NHL and MLB settings were tuned last week on data that overlaps these seasons, so those three baselines are slightly flattering.
  * DraftKings and ESPN BET are softer than Pinnacle, so the gap to "the market" is understated outside the ten football-data leagues.

## 3. Results by sport

| | Matches | Engine acc | Engine log loss | Engine Brier | Always-home acc | Home-rate log loss | Simple Elo acc / log loss | Bookmaker acc / log loss / Brier | Log-loss gap to bookmaker |
|---|---|---|---|---|---|---|---|---|---|
| Football (20 competitions) | 10,208 | 50.8% | 1.008 | 0.603 | 44.5% | 1.074 | 50.8% / 1.010 | 54.5% / 0.959 / 0.570 | **+0.050** |
| NBA | 2,650 | 67.4% | 0.605 | 0.418 | 55.1% | 0.688 | 64.8% / 0.626 | 68.7% / 0.581 / 0.398 | +0.024 |
| NFL | 571 | 65.7% | 0.621 | 0.431 | 54.1% | 0.693 | 63.2% / 0.643 | 68.0% / 0.599 / 0.413 | +0.022 |
| NHL | 2,799 | 56.4% | 0.679 | 0.486 | 54.1% | 0.690 | 56.6% / 0.684 | 58.3% / 0.669 / 0.476 | +0.010 |
| MLB | 4,948 | 56.2% | 0.682 | 0.489 | 53.6% | 0.691 | 54.8% / 0.690 | 57.0% / 0.678 / 0.485 | +0.004 |

## 4. Results by competition: engine vs bookmaker closing odds (same matches)

| | Matches | Engine acc | Bookmaker acc | Engine log loss | Bookmaker log loss | Gap | Engine Brier | Bookmaker Brier | Engine ECE | Bookmaker ECE |
|---|---|---|---|---|---|---|---|---|---|---|
| Premier League | 760 | 49.5% | 52.0% | 1.022 | 0.990 | 0.031 | 0.613 | 0.592 | 0.016 | 0.018 |
| Championship | 1,104 | 44.9% | 47.1% | 1.057 | 1.033 | 0.024 | 0.639 | 0.622 | 0.024 | 0.006 |
| LaLiga | 760 | 52.0% | 55.4% | 0.998 | 0.956 | 0.043 | 0.595 | 0.565 | 0.024 | 0.021 |
| Serie A | 760 | 51.6% | 54.2% | 1.001 | 0.965 | 0.036 | 0.599 | 0.575 | 0.014 | 0.015 |
| Bundesliga | 610 | 51.3% | 54.6% | 1.014 | 0.969 | 0.045 | 0.605 | 0.576 | 0.018 | 0.008 |
| Ligue 1 | 611 | 52.0% | 54.5% | 0.995 | 0.966 | 0.030 | 0.594 | 0.573 | 0.012 | 0.010 |
| Eredivisie | 612 | 51.0% | 54.2% | 0.996 | 0.958 | 0.039 | 0.594 | 0.569 | 0.032 | 0.012 |
| Liga Portugal | 612 | 55.6% | 56.5% | 0.966 | 0.913 | 0.053 | 0.574 | 0.540 | 0.022 | 0.016 |
| Süper Lig | 648 | 52.9% | 58.2% | 0.987 | 0.940 | 0.047 | 0.587 | 0.556 | 0.026 | 0.029 |
| Saudi Pro League | 606 | 54.0% | 59.6% | 0.945 | 0.887 | 0.058 | 0.560 | 0.520 | 0.025 | 0.031 |
| MLS | 1,061 | 47.3% | 48.1% | 1.052 | 1.027 | 0.025 | 0.633 | 0.616 | 0.015 | 0.021 |
| Champions League | 378 | 58.2% | 60.6% | 0.940 | 0.891 | 0.049 | 0.553 | 0.521 | 0.035 | 0.026 |
| Europa League | 378 | 52.4% | 57.9% | 1.011 | 0.953 | 0.058 | 0.604 | 0.562 | 0.050 | 0.035 |
| Conference League | 301 | 50.8% | 58.8% | 1.028 | 0.945 | 0.083 | 0.617 | 0.557 | 0.029 | 0.027 |
| FA Cup | 215 | 50.2% | 62.8% | 1.018 | 0.878 | **0.139** | 0.610 | 0.510 | 0.045 | 0.046 |
| EFL Cup | 185 | 46.5% | 58.9% | 1.018 | 0.906 | **0.112** | 0.611 | 0.534 | 0.028 | 0.029 |
| CAF Champions League | 75 | 45.3% | 42.7% | 1.056 | 0.994 | 0.063 | 0.637 | 0.598 | 0.050 | 0.046 |
| AFCON | 104 | 51.0% | 56.7% | 1.018 | 0.910 | **0.108** | 0.609 | 0.542 | 0.054 | 0.066 |
| WC qualifying (Africa) | 194 | 54.1% | 61.3% | 1.005 | 0.806 | **0.199** | 0.600 | 0.469 | 0.087 | 0.045 |
| World Cup 2026 | 104 | 51.0% | 68.3% | 1.045 | 0.802 | **0.243** | 0.630 | 0.467 | 0.044 | 0.071 |
| NBA | 2,645 | 67.4% | 68.7% | 0.605 | 0.581 | 0.024 | 0.417 | 0.398 | 0.013 | 0.010 |
| NFL | 568 | 65.5% | 68.0% | 0.621 | 0.599 | 0.022 | 0.432 | 0.413 | 0.030 | 0.020 |
| NHL | 2,799 | 56.4% | 58.3% | 0.679 | 0.669 | 0.010 | 0.486 | 0.476 | 0.011 | 0.013 |
| MLB | 4,948 | 56.2% | 57.0% | 0.682 | 0.678 | 0.004 | 0.489 | 0.485 | 0.008 | 0.008 |

Engine vs the always-home and simple-Elo benchmarks for every competition, plus full reliability tables: [`audit/results/step1_tables.md`](../../audit/results/step1_tables.md).

Notable:
* In the FA Cup, the engine's log loss (1.026) is worse than just using the home/draw/away base rates (1.020).
* In the World Cup and AFCON, the engine beats simple Elo, but both are far from the market.

## 5. Calibration (engine, all outcome probabilities)

| Engine said | Football: happened (n) | NBA | NFL | NHL | MLB |
|---|---|---|---|---|---|
| 0–10% | 6.9% (346) | 9.3% (54) | 12.5% (16) | – | – |
| 10–20% | 16.5% (3,225) | 16.6% | 21.7% | – | – |
| 20–30% | 24.5% (12,202) | 22.8% | 28.8% | 22.8% (79) | 16.7% (18) |
| 30–40% | 33.9% (6,646) | 34.6% | 31.2% | 36.9% | 35.7% |
| 40–50% | 46.4% (4,137) | 43.6% | 46.0% | 46.5% | 45.2% |
| 50–60% | 55.5% (2,437) | 56.4% | 54.0% | 53.5% | 54.8% |
| 60–70% | 66.8% (1,110) | 65.4% | 68.6% | 63.0% | 64.1% |
| 70–80% | 74.7% (442) | 77.2% | 71.4% | 77.5% (80) | 83.3% (18) |
| 80–90% | 84.2% (76) | 83.4% | 78.3% (69) | – | – |
| ECE (bookmaker) | 0.009 (0.009) | 0.013 (0.010) | 0.030 (0.020) | 0.011 (0.013) | 0.008 (0.008) |

Confidence labels (thresholds as shipped) do separate good calls from weak ones:

| | High | Medium | Low |
|---|---|---|---|
| Football | 70% of 1,631 | 53% of 4,268 | 42% of 4,309 |
| NBA | 82% of 613 | 68% of 1,115 | 56% of 922 |
| NFL | 78% of 135 | 69% of 234 | 54% of 202 |
| NHL | 69% of 284 | 59% of 1,128 | 52% of 1,387 |
| MLB | 69% of 392 | 58% of 1,888 | 53% of 2,668 |

## 6. Root causes, ranked by measured impact

**Data problems**

| # | Cause | Evidence |
|---|---|---|
| D1 | **Unrated teams start as "average".** Teams the engine has never seen start at Elo 1500, which is average, whether they are League Two sides in the FA Cup or national teams. The app only loads the competitions it displays: no lower English divisions, no international history beyond AFCON and African qualifying. | Share of predictions where a team has fewer than 5 games: World Cup 92%, WCQ Africa 81%, FA Cup 59%, CAF CL 53%, EFL Cup 50%, Conference League 44%. These are exactly the competitions with the largest gaps to the market (0.08–0.24 log loss). |
| D2 | **Football ratings use goals only.** Goals are a noisy signal. The app already shows xG from ESPN shot positions, but the model doesn't use it. | Engine = simple Elo in football (1.008 vs 1.010). The attack/defence component adds nothing measurable. |
| D3 | **No injuries, suspensions or lineups in football; NBA injuries only on the match page.** ESPN publishes no football team news. NBA injuries are current-only, so they can't be backtested and aren't used on list cards. | US gaps are smallest where talent is spread over many players (MLB 0.004, NHL 0.010) and larger where one absence matters (NBA 0.024, NFL 0.022). |
| D4 | **The market signal isn't used historically.** ESPN removes odds from its scoreboard after kick-off, so the app's source weights never learn and stay at their priors (market 2/3, model 1/3). | Blending at those priors already brings football log loss from 1.008 to 0.968 and NBA from 0.605 to 0.584 on matches with odds. The signal is valuable but not learned. |
| D5 | **A single source with no cross-check.** ESPN results matched football-data.co.uk on 11,569 of 11,575 matches (99.9%) by date and score in the ten leagues compared; the six unmatched rows are in the Bundesliga (4), Ligue 1 (1) and MLS (1). Results data quality is therefore not a cause of error, but there is no fallback if ESPN fails or changes its feed. | |

**Model problems**

| # | Cause | Evidence |
|---|---|---|
| M1 | **League strength isn't calibrated.** Every league's teams start at 1500 and few cross-league games connect them. | Mean Elo at the end of the data: Premier League 1606; Bundesliga 1495, LaLiga 1489, Championship 1486, Saudi 1482, Eredivisie 1471. The Championship is effectively rated equal to LaLiga. In cross-league cup matches the engine scores log loss 0.837 vs the bookmaker's 0.659 (EFL Cup) and 0.932 vs 0.800 (FA Cup). |
| M2 | **One home advantage for every football competition** (65 Elo). | Home-win share is under-predicted in European club competitions: Champions League by 4.5 points, Europa League by 5.3, Conference League by 6.0, CAF Champions League by 5.6. The World Cup is off by 12.2 points: the side ESPN lists first is treated as a neutral team, but it won 48% of the time. |
| M3 | **The probabilities aren't recalibrated.** The NFL is overconfident at the extremes (ECE 0.030 vs 0.020). Eredivisie and Championship calibration errors are three to four times the bookmakers'. | Reliability tables, section 5. |
| M4 | **The headline pick ignores draws.** A draw is the top pick in only 0.6% of matches against 24% actual. With most football matches being close calls, the pick looks wrong often even when the probabilities are right. | Section 1. |
| M5 | **Football and basketball settings were never tuned** on the competitions added since launch (Saudi, MLS, Eredivisie, Portugal, Turkey, UEFA, cups). Only the NFL, NHL and MLB were tuned. | Defaults apply everywhere else except the Bundesliga's goal averages and NBA home court. |

**Consistency problems** (why the same match shows different numbers)

| # | Cause | Evidence |
|---|---|---|
| C1 | **The market blend switches on and off.** The app blends market odds only when ESPN's scoreboard lists them. | Right now 54% of upcoming fixtures have odds: football mostly yes, but only 9 of 74 NBA and 3 of 69 NHL games in the next 10 days. When odds appear, P(home) moves by an average of 5.9 points in football (more than 10 points in 17% of matches) and 5.4 in the NBA. The headline pick flips in 11–15% of matches across sports. |
| C2 | **Bug: list cards and the match page compute different forecasts.** List cards call the engine without injuries or ESPN's matchup predictor; the match page includes both. The match page's number can differ from the list's (most in the NBA, the only league with both). Whichever screen was opened last overwrites the saved pre-match forecast that the accuracy tracker grades. | `mobile/src/data/localApi.ts`: `predictionFor()` vs `matchDetail()` |
| C3 | **Every phone weights sources differently.** Source weights come from forecasts that phone happened to save, so two phones can show different probabilities for the same match. | `mobile/src/data/predict.ts`: `sourceStats()` |
| C4 | **No versioned prediction history on the device.** Forecasts are recomputed on every view. There is no record of why a number moved or which model and data produced it; server mode stores versions, device mode doesn't. | |

Ruled out (measured, not causes):

* **The history window.** Moving the window start by a week changes P(home) by 0.1% on average (football); favourite flips 0.7% of matches (football) and 1.9% (NHL). Using all history instead of 365 days improves football log loss by only 0.003. Older installs keeping up to 400 days drift by 0.2–0.7 points.
* **Random seeds and nondeterminism.** None in the engine (identical hashes).
* **Leakage.** None found: the walk-forward uses only earlier matches, and the app predicts upcoming matches only from finished ones.

## 7. What this means for Steps 2–5

The biggest wins, in order of expected impact on log loss, all testable one at a time:

1. **Market data as a learned input.**
   * Historical closing odds: football-data.co.uk for football, ESPN's closing lines for the rest.
   * Current odds as a feature, with blend weights learned from history instead of priors.
   * This alone should take most competitions to within 0.01 of the market.
2. **Rating every team before it plays.**
   * Load lower divisions and national-team history.
   * Seed new teams from ClubElo or league-level priors.
   * Calibrate league strength across countries.
3. **xG-based attack and defence** from shot data, plus league-specific home advantage, then the gradient-boosted model, then per-sport calibration.
4. **Fix C1–C4:**
   * one prediction pipeline for every screen;
   * predictions stored with model and data versions;
   * a scheduled recompute with a recorded reason.
