# Step 5: before / after

Branch `engine-v3`. Raw results: `audit/results/step5.json` (seed 42, prediction hash `996fa49ddc92226e`). Tables: `audit/results/step5_tables.md`. Confidence check: `audit/results/step5_confidence.json`. MLS tuning: `audit/results/step5_mls_tuning.json`.
Every number was measured on 6 Nov 2026 with the same walk-forward protocol as Step 3.

## Summary

- **Football, all covered leagues, 7,740 matches over two seasons:**

  | | Previous engine (ESPN-only design, fed the same permitted data) | New model | Bookmaker closing odds |
  |---|---|---|---|
  | Log loss | 1.0129 | **0.9826** | 0.9788 |
  | Brier | 0.6064 | **0.5860** | 0.5835 |
  | Accuracy | 49.9% | **52.4%** | 52.8% |
  | Calibration error (ECE) | 0.0033 | 0.0043 | 0.0061 |

  The log-loss gap to the bookmaker shrinks from 0.036 to **0.005**.
- **Target "beat the previous model in every league":** met in **9 of 11 competitions in each season separately**. Not met in two:
  - **MLS** is better over both seasons (−0.0057) and in 2025 (−0.0154), but still slightly worse in 2024 (+0.0044, down from +0.0125 before the fix).
  - **Champions League 2024-25** is worse (+0.0094). Cross-league data is missing; see below.
- **Basketball, NFL, NHL and MLB are unchanged.** No permitted data exists for them yet without your free keys, so no new model was built. The app still uses the previous on-device engine for them, and their Step 1 numbers stand.
- **The app no longer computes football predictions for these 11 competitions.** It reads the published pipeline predictions and falls back to the on-device engine only if the file is unavailable. The Accuracy screen now grades every published prediction and shows the before/after comparison.

## 1. Before / after by league (football, both seasons)

"Before" is the current production engine, unchanged, fed the same permitted data with its 365-day on-device window. "After" is the deployed rule: the market ensemble when pre-match odds exist, otherwise the calibrated no-market ensemble. Both are scored on the same matches.

| League | Matches | Log loss before | Log loss after | Δ | Brier before | Brier after | Δ | Accuracy before → after | Bookmaker log loss | Gap to bookmaker after |
|---|---|---|---|---|---|---|---|---|---|---|
| Premier League | 760 | 1.0227 | **0.9956** | −0.0271 | 0.6143 | 0.5964 | −0.0179 | 49.5% → 51.1% | 0.9901 | +0.005 |
| Championship | 1,114 | 1.0602 | **1.0368** | −0.0234 | 0.6409 | 0.6247 | −0.0161 | 43.1% → 46.6% | 1.0335 | +0.003 |
| LaLiga | 760 | 0.9996 | **0.9584** | −0.0412 | 0.5962 | 0.5675 | −0.0287 | 52.2% → 54.9% | 0.9557 | +0.003 |
| Serie A | 760 | 1.0021 | **0.9643** | −0.0378 | 0.6000 | 0.5744 | −0.0257 | 51.1% → 53.8% | 0.9645 | −0.000 |
| Bundesliga | 612 | 1.0156 | **0.9710** | −0.0446 | 0.6066 | 0.5762 | −0.0304 | 50.0% → 54.2% | 0.9692 | +0.002 |
| Ligue 1 | 612 | 0.9999 | **0.9639** | −0.0359 | 0.5974 | 0.5722 | −0.0252 | 51.3% → 54.4% | 0.9662 | −0.002 |
| Eredivisie | 612 | 0.9936 | **0.9599** | −0.0337 | 0.5918 | 0.5707 | −0.0211 | 50.7% → 53.3% | 0.9576 | +0.002 |
| Liga Portugal | 612 | 0.9625 | **0.9211** | −0.0414 | 0.5714 | 0.5455 | −0.0259 | 55.9% → 55.9% | 0.9130 | +0.008 |
| Süper Lig | 648 | 0.9836 | **0.9401** | −0.0435 | 0.5851 | 0.5570 | −0.0281 | 52.0% → 57.4% | 0.9397 | +0.000 |
| MLS | 1,062 | 1.0527 | **1.0470** | −0.0057 | 0.6340 | 0.6291 | −0.0049 | 47.1% → 48.1% | 1.0273 | +0.020 |
| Champions League (2024-25) | 188 | 0.9288 | 0.9382 | **+0.0094** | 0.5443 | 0.5528 | **+0.0085** | 59.6% → 57.4% | – | – |
| **All** | **7,740** | **1.0129** | **0.9826** | **−0.0303** | **0.6064** | **0.5860** | **−0.0203** | **49.9% → 52.4%** | 0.9788 | **+0.005** |

**Each season separately (log loss, before → after):**

| | 2024-25 (selection; MLS 2024) | 2025-26 (test; MLS 2025) |
|---|---|---|
| 9 European leagues | better in all 9 (−0.021 to −0.051) | better in all 9 (−0.022 to −0.046) |
| MLS | 1.0459 → 1.0503 (**+0.0044**) | 1.0592 → 1.0438 (−0.0154) |
| Champions League | 0.9288 → 0.9382 (**+0.0094**) | no permitted data for 2025-26 |
| All | 1.0035 → 0.9750 | 1.0229 → 0.9907 |

Bookmaker "gap" uses closing odds, which are known only at kick-off. The model's own odds input is the earlier Tuesday/Friday price, so a gap of about zero means the model matches the closing line.

## 2. The MLS fix (from Step 3)

- **Hypothesis:** the new model remembers too much history for a league with high roster turnover.
- **Tuning:** Elo season regression and Dixon-Coles time decay, tuned for MLS only on the 2022 and 2023 seasons, before evaluation. The grid had 16 settings (`step5_mls_tuning.json`). The best, regression 0.7 and decay 0.003, improved the tuning seasons only slightly (1.0504 → 1.0494). It was adopted by the pre-agreed rule.
- **Effect on the untouched evaluation seasons:**
  - MLS 2024: 1.0583 → 1.0503, now +0.0044 behind the previous engine instead of +0.0125;
  - MLS 2025: 1.0440 → 1.0438;
  - other leagues: changes of 0.001 or less.
- **Verdict:** an improvement, but MLS 2024 is still slightly behind. The remaining gap fits the missing data: the permitted MLS file has closing odds but no pre-match odds and no shot counts. The MLS gap to bookmaker (0.020) is four times the average.

## 3. Calibration

Pooled over all outcome probabilities, both seasons:

| Predicted | Matches×outcomes | New model: mean predicted | New model: observed | Previous engine: predicted / observed | Bookmaker: predicted / observed |
|---|---|---|---|---|---|
| 0-10% | 742 | 7.4% | 5.4% | 7.8% / 7.4% | 7.5% / 5.1% |
| 10-20% | 3,190 | 16.0% | 15.6% | 16.3% / 16.9% | 15.9% / 14.4% |
| 20-30% | 8,688 | 25.7% | 25.8% | 25.3% / 25.1% | 25.6% / 25.9% |
| 30-40% | 4,264 | 34.1% | 33.8% | 34.3% / 34.0% | 34.1% / 34.0% |
| 40-50% | 2,713 | 44.7% | 45.2% | 44.6% / 44.6% | 44.6% / 45.0% |
| 50-60% | 1,778 | 55.0% | 55.3% | 54.5% / 55.0% | 54.7% / 54.5% |
| 60-70% | 968 | 64.1% | 63.2% | 64.2% / 65.6% | 64.6% / 65.1% |
| 70-80% | 647 | 74.4% | 77.3% | 74.0% / 74.6% | 74.4% / 78.5% |
| 80-90% | 220 | 84.1% | 85.9% | 83.0% / 81.9% | 83.8% / 88.2% |
| 90-100% | 10 | 91.4% | 90.0% | 90.4% / 100.0% | 91.3% / 100.0% |

The full reliability tables for the previous engine, the no-odds model, the deployed model and the bookmaker are in `audit/results/step5_tables.md`.

Overall expected calibration error:

| Model | ECE |
|---|---|
| Previous engine | 0.0033 |
| New model | 0.0043 |
| Bookmaker | 0.0061 |

All three are well calibrated. The improvement comes from sharper, correct probabilities, not from better calibration. Per-league ECE values (0.01–0.036) mostly reflect small samples per bin.

## 4. Confidence (re-checked on the Step 5 model)

Test season 2025-26, untouched:

| Band | Share | Gap to closing | Excess loss |
|---|---|---|---|
| High | 84.3% | +0.0007 | −0.007 |
| Medium | 15.6% | +0.018 | +0.013 |
| Low | 0.2% | +0.079 | +0.252 |

## 5. The app now reads published predictions

- **Hosting.**
  - The daily job (`.github/workflows/data-pipeline.yml`) publishes `football_predictions.json` and `accuracy.json` to GitHub Pages, at https://dynohunter3.github.io/mk-sports/.
  - It force-pushes the same files to the repository's `predictions` branch as a mirror, served via raw.githubusercontent.com.
  - Runs: daily at 04:17 UTC, plus Tuesday and Friday at 18:17 UTC, after football-data.co.uk collects odds.
- **App (`mobile/src/data/remote.ts`).**
  - It downloads the file every 15 minutes (Pages, then the mirror) and keeps the last good copy on the phone.
  - It ignores files older than 3 days.
  - It matches each fixture by competition, kick-off (±36 h) and team names. Every source's spelling is published, and both teams must match.
  - For the 11 covered competitions, `predictEvent` returns the published prediction (probabilities, most likely score, confidence with reasons, components, when and why it last changed, model version). The on-device engine is used only if no published prediction exists.
- **In-app accuracy tracker.** For football, the Accuracy screen shows:
  - **Live:** every published prediction graded on its last version before kick-off, by competition and confidence, plus the latest results. This starts empty: publishing began today.
  - **Backtest:** the table above, with "before", "now" and "bookmaker" columns.
  - Other sports keep the previous on-device tracker.
- **Settings → Data sources** now says which sources feed which part of the app.

## 6. What didn't work, or isn't done

- **The Champions League stays worse than the previous engine** (+0.0094). The permitted data has one Champions League season and no other cross-league matches, so league strengths can't be compared. The free football-data.org key would add Champions League history and current fixtures; it is also the only permitted source for 2025-26 onward.
- **MLS 2024 is still slightly behind** (section 2).
- **No new basketball, NFL, NHL or MLB models.** There is no permitted data (Step 2). Those sports, plus the FA Cup, EFL Cup, Europa League, Conference League, Saudi Pro League and CAF competitions, still use the on-device engine on ESPN data.
- **The rest of the app still uses ESPN:** fixtures, live scores, line-ups, stats, news, crests and other sports. Option (b) for those needs permitted replacements that I haven't found, or licensed data.
- **Live grading starts today.** The tracker's live numbers will be thin for the first weeks. The October replay in Step 4 (466 graded matches, log loss 0.961 vs 0.954 for closing odds) shows what to expect.
