# Step 7: draw calls on the phone, the Predictions screen, post-match review (app 1.7.0)

## What was wrong

App 1.6.0 could show draw calls, but only for predictions downloaded from the published file. The
hosting (GitHub Pages) is not live yet because the repository does not exist. So every phone still ran
the old on-device engine. That engine never calls a draw usefully: with the same draw rule, its test-season
draw calls were right 27.2% of the time, against draws in 26.1% of matches. The new model's draw calls
are right 33.5% of the time.

## What changed

1. **The new model ships inside the app.**
   - The newest published predictions (made 22 Nov 2026 by `fb-2026-11-c251e044`, 266 matches up to 12 Dec) and the accuracy file are built into the APK.
   - The app uses that snapshot only inside its own horizon (21 days).
   - Anything newer that is saved or downloaded replaces it.
   - After the horizon, the app falls back to the on-device engine as before.
   - Once hosting is live, the daily file replaces the snapshot automatically.
2. **A Predictions screen** (Home → Predictions):
   - every football match in the next 7 days, with the call (home, **draw** or away), its strength and the safer call;
   - filters: All, **Draws**, Strong, Safer 85%+; league chips.
   - The Draws filter lists draw calls first, then matches where a draw is close but not called.
3. **Calls everywhere.**
   - Match cards show a cyan **DRAW** badge for draw calls and a strength pill (Strong / Likely / Lean / Toss-up) instead of the old High / Medium / Low.
   - The match page adds a draw note and a source line ("MK Sports model …" or "On-device estimate").
4. **The on-device engine shows the same kind of call**, from its own measured record.
   - It shows strength and a safer call, and never calls a draw.
   - Its strength hit rates are shown, not the new model's.
5. **Post-match review.**
   - After full time the match page shows whether each call was right: result, safer call, over/under 2.5.
   - Example from the screenshot: Man City 1-1 Fulham. The "Man City" call was wrong, but the safer call "Man City or draw" was right.
6. **The safer call always contains the call.** A draw call is never paired with "home or away". This is a pipeline change in `picks.py`, with a regression test.

## Every number the app quotes, and where it comes from

All figures are from two past seasons (7,740 league matches, each predicted only from earlier data), in `audit/results/step6_picks.json`.

| Call | New model (published file) | On-device engine (fallback) |
|---|---|---|
| Strong (pick ≥ 65%) | 75.9% right (16.3% of matches) | 74.1% (10.0%) |
| Likely (50–65%) | 56.2% (30.9%) | 56.4% (31.6%) |
| Lean (40–50%) | 46.1% (33.2%) | 44.6% (39.1%) |
| Toss-up (< 40%) | 37.8% (19.7%) | 37.5% (19.3%) |
| Draw calls | 33.5% right (5.5% of matches); draws are 25.4% of matches | none (no skill) |
| "A draw is a real possibility" (P(draw) ≥ 29%, not called) | 28.8% ended level (14.4% of matches) | 28.9% (19.6%) |
| Safer call (contains the call) | 78.9% | 77.1% |
| Safer call ≥ 85% | 91.4% (18.1% of matches) | 89.8% (11.8%) |

The on-device column is a replay of that engine's model on the same matches. On a phone it also blends
bookmaker and ESPN forecasts, so its live numbers can differ slightly.

## Honest notes

- **Few draw calls right now.**
  - The live file calls a draw in 6 of 266 matches (2.3%), against 5.5% in backtests.
  - The live draw probabilities sit slightly lower this season (95th percentile 0.306 vs 0.311 in the backtest). Many matches land just under the 0.31 cut-off; they show as "draw possible" instead.
  - The rule was **not** re-tuned on live results, because that would be fitting to the test.
- **Draws are the hardest result to call.** A draw call right one time in three is a real edge over the 25% base rate. Still, most draw calls will be wrong.
- **The snapshot ages.**
  - Without hosting, the built-in predictions stop on 12 Dec 2026, and the phone goes back to on-device estimates (no draw calls).
  - Odds that arrive later (Tue/Fri) don't reach the phone either.
  - Hosting fixes both.
- **Hit rate was not raised by this step.** This step changes what the app shows, not the model: the overall hit rate is still 52.5%, against 52.8% for the bookmakers' closing odds.

## Tests

- App: 42 tests (5 new): snapshot horizon and replacement; device calls; the predictions list; the draw note; the safer-call rule.
- Pipeline: 57 tests (1 new): the safer call always contains the call (2,000 random cases).
