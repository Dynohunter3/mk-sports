# Step 6: draws, hit rate, more data

Branch `engine-v3`. Results: `audit/results/step6.json` (seed 42, prediction hash `0f2e6d1142341db2`), `step6_picks.json`, `step6_goals.json`, `step6_confidence.json`, tables in `step6_tables.md`.
Everything below was measured on 10 Nov 2026 with the same walk-forward protocol as Steps 3–5: 7,740 league matches over two seasons, with 2024-25 used for every decision and 2025-26 held back as the test.

## Summary

- **Draws are now called.** The model used to pick a draw in 0.2% of matches. It now calls a draw in about 5% of matches, and those calls are right **33.5%** of the time in both seasons; 25.4% of all matches are draws.
- **A draw call is right about one time in three, and that is close to the limit.** Draws are the hardest result in football to predict, and bookmakers' own odds make a draw the top outcome in only 0.2% of matches.
- **The all-match hit rate cannot be raised massively, by anyone.** On these matches bookmakers' closing odds pick the winner **52.8%** of the time. Our model is at **52.5%**. The previous engine was at 49.9%.
- **What the app now does instead: it says how strong each call is, with a measured track record.**

  | Call | Share of matches | Right (two seasons) | Right (test season only) |
  |---|---|---|---|
  | **Strong call** (65%+ chance) | 16% | **75.9%** | 75.6% |
  | Likely (50–65%) | 31% | 56.2% | 55.1% |
  | Lean (40–50%) | 33% | 46.1% | 45.9% |
  | Toss-up (under 40%) | 20% | 37.8% | 38.9% |
  | **Safer call** (two outcomes, e.g. "Arsenal or draw") | 100% | **79.0%** | 78.4% |
  | Safer call, strongest fifth | 18% | **91.4%** | 91.0% |
  | Over/under 2.5 goals | 100% | 57.2% | 56.4% |
  | Over/under, when 60%+ sure | 30% | 64.1% | 63.0% |

- **The model itself improved a little** with twice the history: log loss 0.9826 → 0.9819. It now beats the previous engine in the Champions League too, which makes **10 of 11 competitions in every season**; MLS 2024 is still 0.002 behind.
- **A bug that would have hit the daily job is fixed.** A lagging fixtures file could erase final scores. I found it while grading the first live weekend.
- **First live results:** 76 matches from 6–9 November, each predicted before kick-off: 56.6% right, log loss 0.933. One weekend is a small sample.

## 1. More data and features

**Data.** I backfilled five more seasons (2014-15 to 2018-19) and four second divisions (2. Bundesliga, Serie B, LaLiga 2, Ligue 2). The second divisions only feed ratings, so that promoted and relegated teams arrive with a history; they are not predicted or evaluated.
- The database now holds 80,990 matches across 13 seasons (2014-15 to the current one).
- The live model trains on 65,518 matches (was 31,195).
- Two clubs were mislinked by the automatic name matching and are fixed with a reviewed override file (`pipeline/registry/manual_aliases.csv`):
  - "Leonesa" and "Cultural Leonesa" are the same club;
  - Gazişehir Gaziantep was linked to the older Gaziantepspor.
- After the fix every competition-season has the right number of teams.

**Feature groups, added one at a time** (boosted model, selection-season log loss; a group stays only if it improves):

| Step | Added | Selection log loss | Kept |
|---|---|---|---|
| 1 | Elo + match context | 0.9938 (was 1.0038 with the shorter history) | yes |
| 2 | Dixon-Coles goals model | 0.9929 | yes |
| 3 | Shots-based xG proxy | 0.9895 | yes |
| 4 | Pi-ratings (separate home and away ratings in goal units) | 0.9898 | **no** |
| 5 | Recent form (last 6: points, goal difference, xG difference) | 0.9893 | yes |
| 6 | Draw signals (how evenly matched, how low-scoring, each team's draw rate, division) | 0.9889 | yes |
| 7 | Pre-match bookmaker odds | 0.9778 (was 0.9815) | yes |

Most of the gain came from the longer history, not from the new features.

## 2. Model results (same 7,740 matches)

| | Previous engine | Step 5 model | **Step 6 model** | Bookmaker closing odds |
|---|---|---|---|---|
| Log loss | 1.0129 | 0.9826 | **0.9819** | 0.9788 |
| Brier | 0.6064 | 0.5860 | **0.5854** | 0.5835 |
| Hit rate (most likely outcome) | 49.9% | 52.4% | **52.5%** | 52.8% |

By league, both seasons (log loss; lower is better):

| League | Matches | Previous engine | Step 5 | **Step 6** | Δ vs previous | Hit rate before → now | Bookmaker |
|---|---|---|---|---|---|---|---|
| Premier League | 760 | 1.0227 | 0.9956 | **0.9951** | −0.0276 | 49.5% → 51.7% | 0.9901 |
| Championship | 1,114 | 1.0602 | 1.0368 | **1.0362** | −0.0240 | 43.1% → 46.5% | 1.0335 |
| LaLiga | 760 | 0.9996 | 0.9584 | 0.9591 | −0.0405 | 52.2% → 54.2% | 0.9557 |
| Serie A | 760 | 1.0021 | 0.9643 | 0.9651 | −0.0370 | 51.1% → 53.7% | 0.9645 |
| Bundesliga | 612 | 1.0156 | 0.9710 | **0.9709** | −0.0447 | 50.0% → 54.4% | 0.9692 |
| Ligue 1 | 612 | 0.9999 | 0.9639 | 0.9653 | −0.0346 | 51.3% → 54.4% | 0.9662 |
| Eredivisie | 612 | 0.9936 | 0.9599 | 0.9611 | −0.0325 | 50.7% → 53.1% | 0.9576 |
| Liga Portugal | 612 | 0.9625 | 0.9211 | 0.9216 | −0.0409 | 55.9% → 56.7% | 0.9130 |
| Süper Lig | 648 | 0.9836 | 0.9401 | **0.9397** | −0.0438 | 52.0% → 57.4% | 0.9397 |
| MLS | 1,062 | 1.0527 | 1.0470 | **1.0457** | −0.0070 | 47.1% → 47.9% | 1.0273 |
| Champions League (2024-25) | 188 | 0.9288 | 0.9382 | **0.9085** | **−0.0203** | 59.6% → 60.1% | – |
| **All** | **7,740** | **1.0129** | 0.9826 | **0.9819** | **−0.0310** | **49.9% → 52.5%** | 0.9788 |

- **Champions League:** now better than the previous engine (it was worse in Steps 3–5), thanks to the longer rating history.
- **Each season separately:** better than the previous engine everywhere except MLS 2024 (1.0459 → 1.0475, +0.0017). MLS 2025 is better by 0.0154.
- **Step 6 vs Step 5:** better in 6 competitions and marginally worse in 5 (by 0.0014 or less). On the test season alone the two are level (0.9907 vs 0.9908). The honest reading is a small gain overall and a clear gain in the Champions League (0.9382 → 0.9085).
- **Before odds are published,** the no-odds model improved from 0.9949 to 0.9932.

## 3. Draws

**Why the model never picked draws.** A draw is rarely the single most likely result. A typical even match is 36% home, 31% draw, 33% away, so "pick the most likely outcome" says home. The probabilities themselves were fine: when the model says 30% draw, about 30% are drawn.

**How predictable draws are.** I measured how well the draw probability separates draws from non-draws (AUC, where 0.5 is random and 1.0 is perfect): **0.571** on the selection season and 0.558 on the test season. The draw-specific inputs barely moved it (it was 0.570 / 0.561 before). Draws are close to unpredictable from public data.

**The rule.** Call a draw when P(draw) is at least 31% and the favourite leads the draw by at most 12 points. It was chosen on the selection season by a criterion fixed in advance: among rules calling a draw in at least 5% of matches, the highest overall hit rate.

| | Draw calls | Draw calls right | Overall hit rate with the rule | Without it |
|---|---|---|---|---|
| Selection 2024-25 | 6.8% of matches | 33.5% | 53.03% | 53.01% |
| Test 2025-26 | 4.1% of matches | 33.5% | 51.84% | 51.95% |
| Both | 5.5% (427 calls) | 33.5% | 52.45% | 52.49% |

Calling more draws costs accuracy. On the selection season, calling draws in 11% of matches gives 33% right and an overall hit rate of 52.7%; calling them in 19% gives 29% right and 51.3%.

When a draw is called, the app shows a drawn predicted score and the reason ("Draw called: evenly matched").

## 4. Calls, strength and the track record

The decision layer is in `pipeline/mkmodel/picks.py`, shared by the backtest and production. Every published prediction now carries:
- **the call** (home, draw or away) with its probability;
- **its strength** (strong, likely, lean or toss-up; the table in the summary);
- **a safer call**: the most likely pair of outcomes;
- **over/under 2.5 goals.**

**Over/under 2.5 goals.** Five candidate models were compared; the one with the best selection-season log loss (boosted trees averaged with the two goals models) was adopted.

| | Selection | Test | Base rate (always "over") on test |
|---|---|---|---|
| Hit rate | 58.0% | 56.4% | 54.7% |
| Log loss | 0.6749 | 0.6792 | 0.6868 |

When the model is at least 60% sure it was right 63.0% on the test season (28% of matches) and 64.1% over both seasons. These figures cover the 7,614 matches that have a league goals model.

**Both teams to score: dropped.** The best candidate looked useful on the selection season (56.2% vs 54.2%), but on the test season it was no better than always saying "yes" (55.8% vs 56.3%; the same log loss). It is not in the app.

**Data-quality confidence (from Step 4) still holds on the new model.** On the test season:

| Band | Share | Gap to closing odds |
|---|---|---|
| High | 84.7% | +0.0008 |
| Medium | 15.1% | +0.018 |
| Low | 0.2% (6 matches) | +0.099 |

Confidence and call strength are different things: confidence says how complete the data behind a prediction is; strength says how big the favourite's chance is.

## 5. Production and the app

- **Production equals the backtest.** A production bundle retrained as of 1 Oct 2025 reproduces the Step 6 backtest for all 341 October 2025 matches with zero difference.
- **Live bundle:** `fb-2026-11-c251e044`, trained as of 1 Nov 2026 on 65,518 matches. A retrain now takes about 3 minutes.
- **Published files:** each match in `football_predictions.json` has `call` and `goals`. `accuracy.json` has `track_record` (the table in the summary) and live results by call strength.
- **Grading** now scores the call that was shown, draw calls included, and tracks strength, safer calls and over/under.
- **App 1.6.0:**
  - match cards and the match page show draw calls;
  - the match page shows call strength with its backtest hit rate, the safer call, and over/under 2.5 goals;
  - the home screen has a "Strongest calls" strip;
  - the Accuracy screen has a "how often each call is right" card.

## 6. Bugs found and fixed

1. **Final scores erased by a lagging fixtures file.** football-data.co.uk's "upcoming fixtures" file still listed last weekend's matches on Tuesday. Loading it after the results turned those matches back into "scheduled", so nothing could be graded.
   - Fix: a final result is never downgraded by a later non-final row, and fixtures that have already kicked off are skipped. A regression test covers it.
   - It also explains part of the "12 Championship matches without a result" alert in Step 2.
2. **An empty fixtures list counted as a source failure.** Three in a row would have paused that source's results too. An empty list between rounds is now treated as normal.
3. **Old model bundles** from before this change are treated as absent, so the next run retrains instead of crashing.

## 7. First live results

Predictions made on 6 November before kick-off, by the Step 5 model without odds, for matches on 6–9 November:

| | Matches | Hit rate | Log loss | Brier |
|---|---|---|---|---|
| All | 76 | 56.6% | 0.933 | 0.551 |

By league the hit rate ranged from 40% (LaLiga, 10 matches) to 89% (Bundesliga, 9). One weekend is too few matches to read anything into; the Accuracy screen will fill in as rounds are played.

## 8. What didn't work, and limits

- **Pi-ratings** did not improve the model and were dropped.
- **Both teams to score** did not beat the base rate on the test season and was dropped.
- **Draw prediction stays weak** (AUC 0.56–0.57). The draw rule makes the model commit to draws at a fair hit rate; it does not make draws predictable.
- **All-match hit rate stays near 52.5%.** Closing the 0.3-point gap to bookmakers would need information the permitted sources don't have: confirmed line-ups, injuries, real xG.
- **Design.** I added the call-strength elements above. I did not redesign the app; I couldn't open comparable apps' sites from this environment, only search summaries.
- **Still on ESPN:** fixtures, live scores, line-ups, news and other sports.
- **GitHub hosting** is still blocked (see the summary message); until then the app uses its on-device engine for football.
