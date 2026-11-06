# Step 4: consistency

Branch `engine-v3`. Code: `pipeline/mkmodel/production.py` (bundles, prediction log, grading, confidence), `learners.py` (fit/predict shared with the backtest) and `confidence_check.py`.
Measured outputs: `audit/results/step4_confidence.json` and `audit/results/step4_replay_oct2026.json`. Everything below was measured on 6 Nov 2026.

## Summary

- **Production is the evaluated model, exactly.**
  - A production bundle retrained as of 1 Oct 2025 reproduces the Step 3 backtest's predictions for all 341 October 2025 matches with **zero difference**.
  - After refactoring the backtest onto the shared learners, its prediction hash is unchanged (`ecda4f82795d172b`).
- **Deterministic.** Retraining on the same data gives the same predictions:
  - on real data: two November bundles, max difference 0.0;
  - also covered by a test.
  - Predicting twice with unchanged inputs writes nothing: live, 78 of 78 unchanged.
- **Every change is logged with its reason.** A month-long replay of October 2026 produced 1,288 predictions for 546 matches. Every recomputation recorded why: new results, odds published, or a new model version.
- **The confidence score is measured, not guessed.**
  - My first, hand-written version did *not* track error, so I replaced it with penalties measured on the 2024-25 season.
  - Checked on the untouched 2025-26 season:
    - high-confidence predictions are at bookmaker level (gap to closing odds +0.0005);
    - medium ones sit 0.018 behind;
    - low ones sit 0.142 behind (only 6 matches).

## 1. What was built

| Brief | Implementation |
|---|---|
| Fixed seeds | Seed 42 everywhere; LightGBM in deterministic mode; Nelder-Mead fits start from fixed points. |
| Versioned models | Bundle `fb-YYYY-MM-<hash>` in `pipeline/var/models/`. The hash covers the code (`mkmodel/*.py`), the configuration, a fingerprint of the training data and the cutoff. The manifest records all of these plus the Elo mapping, blend weights, calibration, training row counts and training time. The boosted models are saved as LightGBM text files. |
| Versioned data | Each bundle's `data_version` is a hash of exactly the rows it was trained on. `python -m mkdata snapshot` writes hashed full-store snapshots (Step 2). |
| Fixed retrain schedule | **Monthly**: 00:00 UTC on the 1st, on everything known before that moment. This is the same monthly refit the Step 3 backtest evaluated. The daily job runs `retrain --if-due`, which skips unless a new month has started. A retrain takes about 85 s. |
| Store every prediction with timestamp and model version | Table `predictions`. Each row holds:<br>• match, `made_at`, model version and probabilities;<br>• `inputs` (ratings, form, schedule, odds), plus `inputs_hash`;<br>• `reason`;<br>• `confidence` with its label and reasons;<br>• `variant` (with odds / no odds yet);<br>• the grade: `official`, `outcome`, `log_loss`, `brier`. |
| Recompute only when inputs change, recording why | The daily `predict` writes a row only when the inputs hash differs from the match's last row. The reason lists what changed:<br>• first prediction;<br>• new model version;<br>• kick-off time changed;<br>• bookmaker odds published or changed;<br>• new results updated the ratings;<br>• schedule changed. |
| Grading | `grade` scores **the last prediction made before kick-off** (one official row per match; repeat runs change nothing). Matches that have started are never predicted. |
| Confidence | See section 3. Each prediction carries a 0–1 score, a high/medium/low label and plain-language reasons. |
| Publishing | `pipeline/var/publish/football_predictions.json` holds:<br>• model and data versions;<br>• attribution;<br>• an "information and entertainment, not betting advice" notice;<br>• every upcoming match with its probabilities, variant and confidence.<br>This is the file the app will read under option (b). |
| Monitoring | The health check now loads per-league baselines (`pipeline/config/baselines.json`, from the Step 3 backtest). It alerts when the rolling log loss of graded live predictions exceeds a baseline by max(0.02, 2 standard errors). |

The daily GitHub Actions job now runs these steps in order:
1. sync;
2. upcoming;
3. link;
4. elo;
5. **retrain if due**;
6. **predict**;
7. **grade**;
8. cross-check;
9. snapshot;
10. health (with baselines).

It uploads the published predictions file and the current model pointer.

## 2. Verification

| Check | Result |
|---|---|
| Backtest after refactoring onto shared fit/predict learners | Prediction hash `ecda4f82795d172b`, identical to Step 3 |
| Production bundle as of 1 Oct 2025 vs backtest, Oct 2025 (341 matches) | Max difference 0.0 (final, Elo, both boosted models) |
| Retrain November twice (code changed only by a message text) | New version `fb-2026-11-4812c49a` → `fb-2026-11-89dd91af`, same `data_version` `0a6b16411716`. All 78 upcoming predictions re-logged with reason "new model version", probabilities identical (max difference 0.0). |
| Predict twice, nothing new | 78 considered, 0 written |
| Tests | 50 pipeline tests: Steps 2–4. The Step 4 tests cover the determinism of a retrain, no re-logging on unchanged inputs, logging when odds arrive and when new results arrive, the official grade (last prediction before kick-off), confidence, and as-of loading. Engine: 37 tests. Mobile: 30 tests. All pass. |

## 3. Confidence: measured

**First attempt (did not work).** Hand-written penalties for cold start, missing odds, missing shot data, model disagreement and so on gave flat log loss across bands: high 0.9833, medium 0.9813, low 0.9842. That isn't useful.

**What I measured instead (2024-25 selection season).** For each reason, two numbers:
- *excess loss*: actual log loss minus the loss the model's own probabilities expect;
- *gap to closing odds*.

| Reason | Matches | Gap to closing | Excess loss | Kept as a penalty |
|---|---|---|---|---|
| All matches | 3,973 | +0.007 | −0.007 | – |
| No bookmaker odds yet | 715 | **+0.029** | **+0.016** | yes, ×0.8 |
| No shot data for the league | 584 | **+0.029** | **+0.031** | yes, ×0.9 |
| Component models disagree by more than 25 points on P(home) | 68 | **+0.017** | **+0.064** | yes, ×0.75 |
| Component models disagree by 15–25 points | 351 | +0.006 | −0.032 | no |
| Fewer than 15 matches played | 107 | −0.002 | −0.067 | no |
| Fewer than 5 matches played | 80 | −0.030 | −0.037 | no |
| No league goals model | 126 | – | −0.057 | no |

Three rules from your brief can't be measured in the backtest, so they keep fixed penalties:
- sources disagree on this fixture (×0.8; only 2 backtest matches);
- disputed recent results (×0.9);
- the latest league results are not confirmed yet (×0.85).

Labels: high ≥ 0.85, medium ≥ 0.6, low below that.

**Verified on the untouched test season (2025-26):**

| Band | Share | Log loss | Excess loss | Gap to closing |
|---|---|---|---|---|
| High | 84.2% | 0.9803 | −0.008 | **+0.0005** |
| Medium | 15.7% | 1.0433 | +0.020 | **+0.018** |
| Low | 0.2% (6) | 1.2697 | +0.334 | **+0.142** |

Cold start no longer lowers confidence. Thanks to the lower-division data, teams with little history were *not* predicted worse here. Step 1's large cold-start losses came from cups and international football, which the permitted data doesn't cover yet. If those competitions come back, this rule must be re-measured.

## 4. A month of predictions, replayed (October 2026)

I replayed October 2026 on a copy of the database, so the live prediction log was not touched:
- one bundle trained as of 1 Oct;
- predictions on 9 dates (Wednesdays at noon, Fridays at 18:00 after the odds are collected), each seeing only what was known at that moment;
- grading on 6 Nov.

| | |
|---|---|
| Predictions written | 1,288 for 546 matches. Per match: 1 version 105 times, 2 versions 145, 3 versions 291, 4 versions 5. |
| Reasons written | First prediction 546; bookmaker odds published 302; new results updated the ratings 395; both 45 (total 1,288) |
| Graded (official = last before kick-off) | 466 matches. Log loss **0.9610**, Brier 0.5687. Closing odds on the same matches: 0.9542 (gap 0.0068). |
| By competition (log loss, n) | Premier League 0.977 (40), Championship 1.004 (73), LaLiga 0.875 (40), Ligue 1 0.869 (36), Bundesliga 1.069 (36), Serie A 0.879 (50), Eredivisie 1.080 (36), Liga Portugal 0.928 (28), Süper Lig 0.830 (36), MLS 1.012 (91). One month per league is a small sample; these are not comparable to the two-season backtest numbers. |

**How much predictions move when recomputed** (the consistency problem from Step 1):

| Trigger | Recomputations | Mean change in P(home) | 90th percentile | Predicted winner changes |
|---|---|---|---|---|
| New results | 395 | 1.2 points | 2.8 points | 1.5% |
| Bookmaker odds published | 347 | 5.0 points | 9.9 points | 15.6% |

The jump when odds arrive is about the size Step 1 measured for the shipped app: 5.9 points mean, with the pick flipping in 11–15% of matches. The odds carry real information, and including them is what brings the model to bookmaker level (Step 3), so I have not damped it. The difference now is that each change is logged with its reason, and the "no odds yet" variant is labelled medium confidence.

## 5. Live right now

- Bundle `fb-2026-11-89dd91af`: trained as of 1 Nov 2026 on 31,195 rows, with blend weights from 3,734 out-of-sample predictions.
- 78 upcoming matches in the next 10 days are predicted and published. All are "no odds yet" and medium confidence (one low).
- football-data.co.uk collects weekend odds on Friday afternoon. When the next daily run picks them up, the affected matches will be re-predicted with the reason "bookmaker odds published".

## 6. Limits and what isn't done

- **The app does not read the predictions file yet.** That is the option (b) switch for football. Hosting the file needs the repository on GitHub, which has no remote yet.
- **Model bundles live in `pipeline/var/models`**, which the daily job keeps in its cache, and each run uploads the current pointer as an artifact. An evicted cache would only force a retrain, and a retrain is deterministic, so the bundle and its predictions come back the same.
- **MLS still needs the regression-setting fix** noted in Step 3. It's planned before the Step 5 before/after run.
- **Unmeasurable confidence rules:** source disagreement, disputed results and unconfirmed results can't be validated in the backtest. They are applied as your brief requires and listed in every prediction's reasons.

## Next

- **Step 5:**
  - the MLS fix (tuned on pre-evaluation seasons only);
  - the same walk-forward re-run, with a final before/after table by league;
  - the in-app accuracy tracker that grades every prediction from this log.
- **Option (b):** the app reads the published football predictions instead of computing them from ESPN.
