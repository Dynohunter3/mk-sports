# Step 3: new football models (permitted data only)

Branch `engine-v3`. The code is in `pipeline/mkmodel/`. Full tables are in `audit/results/step3_tables.md` and the raw results in `audit/results/step3.json` (seed 42, prediction hash `ecda4f82795d172b`).
Every number below was measured on 6 Nov 2026. In line with option (b), no ESPN data was used.

## Summary

- **Overall result.** Over 7,740 league matches in the 2024-25 and 2025-26 seasons (MLS: 2024 and 2025), the new model improves on the current engine:
  - log loss: 1.0129 → **0.9832**
  - Brier: 0.6064 → **0.5864**
  - accuracy: 49.9% → **52.2%**
  - Both models were scored on the same permitted data and the same matches.
- **Gap to bookmaker closing odds.** The log-loss gap shrinks from 0.036 to **0.005**. Closing odds score 0.9788; our model scores 0.9832.
- **By league.** The new model wins in **9 of the 11 competitions in both seasons**, on both log loss and Brier. Those nine are the Premier League, Championship, LaLiga, Serie A, Bundesliga, Ligue 1, Eredivisie, Liga Portugal and the Süper Lig.
- **Not yet better:**
  - **MLS:** worse in 2024 (+0.0125 log loss) and better in 2025 (−0.0153).
  - **Champions League 2024-25:** worse (+0.0111). That is 188 matches, single-source, with no odds.
- **Your target is therefore met in 9 of 11 competitions**, not all. The causes and the planned fixes for the other two are in sections 4 and 6.

## 1. Method

- **Data.** Everything comes from the Step 2 pipeline: football-data.co.uk plus openfootball.
  - I backfilled four more seasons (2019-20 to 2022-23), so there are 38,450 canonical matches.
  - League One and League Two are included so that teams moving up and down have ratings.
- **"Before" baseline.** This is the current production engine, unchanged (`mobile/src/engine`). It is fed the same permitted data, with its book rebuilt every match day from the previous 365 days, exactly as the app works (`mobile/scripts/audit/engine-on-permitted.ts`).
- **No leakage.** A result enters the models only after its "known at" time from Step 2. Two tests check this:
  - changing every later result leaves every earlier feature identical;
  - a result that becomes known late does not affect a match played before it is known.
- **Walk-forward training.** Every learned model is refitted at the start of each month on matches whose result was known before that month. It then predicts that month's matches.
- **Selection vs test.** 2024-25 (MLS 2024) is the *selection* season: every keep/drop decision was made on it. 2025-26 (MLS 2025) is the *test* season.
  - **Disclosure:** I looked at the test-season numbers once, before making two last decisions. Those were the fallback rule for missing inputs and the switch between the with-odds and no-odds models, and both were justified on the selection season. After that look I made no further change.
- **Benchmarks on the same matches:**
  - league base rates;
  - bookmaker pre-closing odds, which football-data.co.uk collects on Tuesday/Friday afternoons, so they are available before kick-off and legitimately usable;
  - bookmaker closing odds (Pinnacle where present), with the margin removed proportionally.

### Data-layer changes since Step 2 (both found while backfilling)

- **Naming authority.** football-data.co.uk is now the source that names teams, instead of openfootball. openfootball renames clubs from season to season ("Aston Villa" vs "Aston Villa FC", "Alavés" vs "Deportivo Alavés"), which created duplicate IDs once eight seasons were loaded.
  - One club's spellings may now share an ID only if they never appear in the same season.
  - After the fix, every competition-season has the right number of teams: for example, 20 in the Premier League every season, 23 in League One 2019-20 (Bury expelled), and 21 in the Süper Lig 2020-21.
  - One openfootball name ("Gazişehir Gaziantep FK") is waiting in the review queue.
- **Season labels.** football-data.co.uk rows now take their season from the file they came from. Without this, COVID-delayed 2019-20 matches played in July 2020 were labelled 2020-21.

## 2. Models

| Component | What it is |
|---|---|
| Elo (ordered logit) | Goal-difference Elo in one pool across all competitions, with regression toward the league mean at a new season and promoted teams starting below their league mean. It is mapped to home/draw/away by an ordered logit refitted monthly. |
| Dixon-Coles | Per league, refitted weekly: time-decayed Poisson attack and defence ratings (half-life about 1 year), a league-specific home advantage, and the Dixon-Coles low-score correction (rho). |
| Dixon-Coles on xG proxy | The same model fitted on a shots-based expected-goals proxy (goals ≈ a·shots on target + b·other shots). It uses football-data.co.uk shot counts because no permitted xG source exists. |
| Boosted trees (LightGBM) | Uses the above as inputs, plus rest days, matches in the last 14 days, games played (cold start) and league base rates. It optionally adds pre-closing odds. Fixed seed, deterministic. |
| Ensemble | A weighted average on log-probabilities, fitted monthly on the previous 12 months of out-of-sample predictions only. It can optionally add calibration (multinomial Platt / vector scaling). When an input is missing for a match, a written fallback rule replaces it: xG-proxy → Dixon-Coles → Elo; missing odds → the boosted model without odds. |
| **Deployable rule** | Use the market ensemble when pre-match odds exist; otherwise use the calibrated no-market ensemble. |

## 3. Feature groups, added one at a time (boosted model, selection season)

| Step | Added | Selection log loss | Selection Brier | Kept |
|---|---|---|---|---|
| 1 | Elo + match context | 1.0047 | 0.5998 | yes (start) |
| 2 | Dixon-Coles | 1.0015 | 0.5977 | yes |
| 3 | Shots-based xG proxy | 0.9974 | 0.5956 | yes |
| 4 | Pre-closing odds | 0.9828 | 0.5861 | yes |

Calibration was kept only where it helped on the selection season:
- **No-market ensemble:** helped (0.9900 → 0.9897), so it was kept.
- **Market ensemble:** hurt (0.9772 → 0.9775), so it was dropped.

Both effects are very small. Every model is already well calibrated: the expected calibration error (ECE) is 0.003–0.004, about the same as the bookmaker's 0.006.

## 4. Results by league (both seasons, same matches)

Both models were fed the same permitted data. The "no-odds model" column is what the app would show before odds are published.

| League | Matches | Current engine LL | No-odds model LL | **New (deployable) LL** | Δ LL | Current Brier | New Brier | Δ Brier | Accuracy | Closing odds LL |
|---|---|---|---|---|---|---|---|---|---|---|
| Premier League | 760 | 1.0227 | 1.0084 | **0.9948** | −0.0279 | 0.6143 | 0.5958 | −0.0185 | 49.5% → 51.3% | 0.9901 |
| Championship | 1,114 | 1.0602 | 1.0464 | **1.0365** | −0.0237 | 0.6409 | 0.6246 | −0.0163 | 43.1% → 46.3% | 1.0335 |
| LaLiga | 760 | 0.9996 | 0.9742 | **0.9585** | −0.0411 | 0.5962 | 0.5676 | −0.0285 | 52.2% → 54.7% | 0.9557 |
| Serie A | 760 | 1.0021 | 0.9785 | **0.9652** | −0.0368 | 0.6000 | 0.5749 | −0.0251 | 51.1% → 53.4% | 0.9645 |
| Bundesliga | 612 | 1.0156 | 0.9864 | **0.9706** | −0.0449 | 0.6066 | 0.5758 | −0.0308 | 50.0% → 54.4% | 0.9692 |
| Ligue 1 | 612 | 0.9999 | 0.9801 | **0.9645** | −0.0354 | 0.5974 | 0.5723 | −0.0250 | 51.3% → 54.4% | 0.9662 |
| Eredivisie | 612 | 0.9936 | 0.9743 | **0.9600** | −0.0336 | 0.5918 | 0.5709 | −0.0209 | 50.7% → 53.1% | 0.9576 |
| Liga Portugal | 612 | 0.9625 | 0.9276 | **0.9210** | −0.0416 | 0.5714 | 0.5454 | −0.0260 | 55.9% → 56.2% | 0.9130 |
| Süper Lig | 648 | 0.9836 | 0.9683 | **0.9399** | −0.0436 | 0.5851 | 0.5571 | −0.0280 | 52.0% → 57.1% | 0.9397 |
| MLS | 1,062 | 1.0527 | 1.0510 | 1.0510 | −0.0016 | 0.6340 | 0.6319 | −0.0020 | 47.1% → 47.2% | 1.0273 |
| Champions League (2024-25) | 188 | 0.9288 | 0.9399 | 0.9399 | **+0.0111** | 0.5443 | 0.5537 | **+0.0095** | 59.6% → 57.4% | – |
| **All** | **7,740** | **1.0129** | **0.9953** | **0.9832** | **−0.0297** | **0.6064** | **0.5864** | **−0.0200** | **49.9% → 52.2%** | 0.9788 |

The nine European leagues win in **each season separately**:
- selection season: by 0.022–0.050 log loss;
- test season: by 0.024–0.046 log loss.

**MLS** is worse in 2024 (+0.0125 log loss) and better in 2025 (−0.0153). Every component is worse than the current engine on MLS 2024, and the new model over-predicts home wins there: average P(home) 46.1% vs 44.6% observed. MLS also has no pre-closing odds in the permitted data; the USA file has only closing odds.
- Most likely cause: the new Elo keeps a long memory, while the current engine forgets everything older than 365 days, which suits MLS's high roster turnover.
- Next step: tune a stronger season regression for MLS on pre-evaluation seasons (2021-2023) only, so the evaluation seasons stay out of the tuning.

**The Champions League** is worse (+0.0111). Root cause: the permitted data has only one Champions League season (openfootball 2024-25) and no other cross-league matches before it. Each domestic league's ratings are therefore on their own scale, and a Bundesliga team and an Eredivisie team with equal ratings look equal.
- The current engine shares this weakness and simply copes slightly better with this season.
- It can't be fixed without cross-league history.
- The free football-data.org key would supply it, and it is also the only permitted source of Champions League fixtures from 2025-26 on.

## 5. Calibration (both seasons, all outcome probabilities pooled)

Expected calibration error:

| Model | ECE |
|---|---|
| Current engine | 0.0033 |
| New no-odds model | 0.0031 |
| New deployable model | 0.0039 |
| Bookmaker closing | 0.0061 |

The bin-by-bin reliability tables are in `audit/results/step3_tables.md`. All three are well calibrated; the gain comes from sharper probabilities, not better calibration.

## 6. What didn't work, or wasn't done

- **The boosted model alone** with only Elo and context (1.0047) was *worse* than the plain Elo ordered logit (0.9977) on the selection season. Boosted trees only pay off once they have the model probabilities as inputs.
- **Per-league calibration** (a separate temperature per league, fitted on that league's previous 12 months) made the selection season worse overall (0.9762 → 0.9774) and did not fix MLS. Rejected.
- **Calibration of the market ensemble** was slightly worse. Dropped.
- **Basketball, NFL, NHL and MLB models were not built.** No permitted data exists without your free keys (Step 2), so the brief's net rating, pace, rest and injury model can't be trained or tested yet.
- **Lineups, injuries and real xG are absent** because no permitted source exists. The xG proxy built from shot counts did help (step 3 above).
- **Pre-match odds dominate the remaining gain.** On matches that have them, the market ensemble scores 0.9730. The odds alone score 0.9736 and closing odds 0.9708. With odds, the model is essentially at bookmaker level, so its predictions will move when odds are published (Tuesday/Friday). Step 4 must handle that: recompute only when inputs change, and log why.

## 7. Next

1. Step 3b: an MLS regression setting tuned on pre-evaluation seasons only. Then re-check MLS and leave the test seasons untouched.
2. Step 4:
   - versioned models and data snapshots;
   - a fixed retrain schedule;
   - a prediction log that stores the model version and an inputs hash, and records why each recomputation happened;
   - confidence that drops when data is missing, sources disagree or a team is new.
3. Option (b) for football: the daily job publishes a predictions file and the app reads it instead of ESPN for football. Hosting that file needs the repository on GitHub, which has no remote yet.
