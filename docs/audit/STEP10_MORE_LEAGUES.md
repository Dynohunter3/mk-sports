# Step 10: nine more leagues on the published model, and better accuracy measures

Results: `audit/results/step10.json`. Code: `pipeline/mkmodel/step10.py`; the engine replay is `mobile/scripts/audit/engine-on-permitted.ts` with `POOL`/`OUT` set.

## The question

football-data.co.uk, already a source, has results, shots and odds for nine more leagues, and ESPN has live scores for all of them (checked 25 Nov 2026):
- League One and League Two;
- the Scottish Premiership;
- the 2. Bundesliga, Serie B, LaLiga 2 and Ligue 2;
- the Belgian Pro League and the Greek Super League.

Six of them already fed the ratings. Scotland, Belgium and Greece were added (13 seasons each). Should the published model predict them, instead of the on-device engine the app would otherwise use?

## Protocol (written before any result was seen)

- **Two runs of the deployed model:** Step 8's production rule, same features, monthly walk-forward refits and blend fits.
  - **Current:** the 11 published competitions, with the lower divisions feeding ratings only.
  - **Extended:** the 11 plus the nine.
- **Scoring:** at kick-off (what the official record grades) and days ahead. 2024-25 is the selection season and 2025-26 the test season; both are reported.
- **Benchmarks on the same matches:**
  - the on-device engine, replayed on the same permitted data;
  - league base rates;
  - bookmakers' closing odds.
- **Decision rules:**
  - Publish a new league if the extended model's at-kick-off log loss beats the on-device engine's on the same matches (both seasons together).
  - Gate: the existing leagues may not get worse by more than 0.002 log loss, or nothing is published.

## Results

**Existing leagues, current vs extended (7,740 matches, at kick-off):**

| | Log loss | Hit rate | RPS |
|---|---|---|---|
| Current | 0.9818 | 52.43% | 0.1990 |
| Extended | 0.9814 | 52.47% | 0.1991 |

The change is within noise, so the gate passed. Days-ahead log loss: 0.9783 → 0.9778.

**New leagues, both seasons, at kick-off:**

| League | Matches | Model hit rate | Model log loss | On-device engine log loss | Closing odds log loss |
|---|---|---|---|---|---|
| League One | 1,114 | 50.3% | 1.015 | 1.043 | 1.012 |
| League Two | 1,106 | 46.9% | 1.041 | 1.065 | 1.040 |
| Scottish Premiership | 456 | 53.5% | 0.960 | 0.985 | 0.963 |
| 2. Bundesliga | 612 | 47.5% | 1.045 | 1.078 | 1.045 |
| Serie B | 768 | 45.6% | 1.032 | 1.064 | 1.028 |
| LaLiga 2 | 924 | 48.9% | 1.026 | 1.047 | 1.021 |
| Ligue 2 | 611 | 47.5% | 1.040 | 1.068 | 1.035 |
| Belgian Pro League | 623 | 50.7% | 1.007 | 1.039 | 1.004 |
| Greek Super League | 469 | 51.8% | 0.968 | 1.003 | 0.953 |

- **Against the on-device engine:** the model is better in every league, and in each season separately.
- **Against the bookmakers:** it is within 0.005 log loss of the closing odds, except in Greece (0.015 behind). It is level or slightly better in Scotland and the 2. Bundesliga.

**Decision:** all nine are published from Step 10 on (`mkmodel/data.py`: `APP_LEAGUES = APP_LEAGUES_STEP9 + STEP10_LEAGUES`). The Step 3–9 experiment scripts are pinned to the earlier lists, so their results stay reproducible.

## The deployed model's record, all 20 competitions

At kick-off, 2024-25 and 2025-26, 14,423 matches.

**Overall:**
- **Hit rate:** 50.8% for the most likely outcome; 50.4% for the call shown, which follows the draw rule. Lower leagues are harder to call than top leagues.
- **Log loss:** 0.9992.
- **Ranked probability score (RPS):** 0.2035, against 0.2023 for the bookmakers' closing odds on the same matches.

**Calls, as the app shows them:**

| Call | Right | Share of matches |
|---|---|---|
| Strong | 75.6% | 11.7% |
| Likely | 57.8% | 29.4% |
| Lean | 44.6% | 36.3% |
| Toss-up | 37.1% | 22.6% |
| All calls | 50.4% (bookmakers' favourite 51.0%) | |
| Safer calls | 78.2% | |
| Draw calls (draws happen 26.0%) | 33.1% | 7.4% |

**Calibration of the call:** the chance given, against how often it happened.

| Given | Matches | Average given | Happened |
|---|---|---|---|
| 30–40% | 2,954 | 37.6% | 38.5% |
| 40–50% | 5,546 | 44.6% | 44.5% |
| 50–60% | 3,280 | 54.8% | 56.2% |
| 60–70% | 1,524 | 64.2% | 65.2% |
| 70–80% | 818 | 74.4% | 76.5% |
| 80–100% | 301 | 83.9% | 85.7% |

The calibration is close to exact, and slightly cautious at the top.

The app's accuracy page shows these figures. The track record shown with each prediction now comes from this run (`production.track_record()` reads `step10.json`). Over/under 2.5 and the draw note still come from Step 6, because the Step 10 runs did not model goals.

## Measuring the live record honestly

- **Live RPS:** `accuracy.json` now carries the live record's RPS next to the hit rate.
- **Record check:**
  - The tested hit rate's 95% chance range is 1.96 × √(p(1−p)/n).
  - Under 100 graded matches it reports "too early to judge". With 28 matches the range is about ±18 points.
  - From 100 matches on, a live record outside the range is flagged in the app and raised as a `model_drift` warning in the pipeline's health check.

## Limits

- **Few days of notice for the new leagues.** openfootball has no 2026-27 files for any of the nine, so their fixtures arrive only through football-data.co.uk's next-round list, about 2–4 days ahead. Further out, the app shows its on-device estimate for those matches.
- **Each phone downloads more history.** The on-device fallback needs 12 months of results for every football league the app lists, so first use of football downloads a little more than before.
