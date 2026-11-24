# Step 9: fixes, reliability, results review (app 1.8.0)

## Found and fixed

| Problem | Effect | Fix |
|---|---|---|
| Production used market-history step size 0.2; Step 8 had chosen 0.35 | The deployed model was not exactly the tested one (the two differed by 0.0008 log loss in the test) | Default set to 0.35 and recorded in the model manifest |
| The code fingerprint skipped `experiment.py`, where the feature groups live, and a retrain was only due once a month | A change to the model's code could run with a model fitted to the old code until the 1st | The fingerprint covers exactly the files production uses; `retrain --if-due` also refits when the fingerprint changes (tested) |
| Finished matches in the published file had no call | The app's post-match review (1.7.0) never appeared for model predictions | Finished matches carry the call exactly as shown before kick-off |
| "✓ Called it" compared the result with the most likely outcome | A right draw call could show as a miss | Judged on the call that was shown |
| GitHub ran Monday's 04:17 job at 14:43 and skipped Sunday's | Late odds, late grading | Runs every 6 hours |

**Grading latency:** football-data.co.uk published the weekend's results on Monday or Tuesday. Monday's run found none, and Tuesday's graded the first 28 matches. That is the source's pace, not a bug. Faster results would need another source.

## Draw calls before odds are out: tested, not changed

Step 8's market-history component is an ordered logit on one number, so its draw probability stays below about 0.30.

**Tested:** a multinomial version that also knows the teams' draw tendency in the betting market. Protocol fixed before the run (`audit/results/step9.json`):

| Days ahead (league matches before odds) | 2024-25 log loss | Draw calls 2024-25 | Draw calls 2025-26 |
|---|---|---|---|
| Step 8 (deployed) | 0.9694 | 7.4% | 0.9% |
| Multinomial | 0.9698 | 13.7% | 1.9% |

**Decision:** a tie on log loss. The tie-break favours the draw-call rate closer to the 5.7% made at kick-off, which is Step 8. The multinomial version also doesn't fix the 2025-26 drought it was meant to fix, so it was not adopted. Draw calls appear when odds arrive. Before that, matches with a close draw are marked "a draw is a real possibility".

## App 1.8.0

- **Results** on the Predictions screen: every graded match with the call made before kick-off, ✓/✗ for the call and the safer call, and the strength of the call. A summary shows the last 7 and 30 days, safer calls and strong calls.
- **Home** shows the model's 30-day record once at least 10 matches are graded.
- **The match page shows how a prediction moved** since its previous version, and why (for example "Arsenal 48% → 55% since Sun 22 Nov · Why: bookmaker odds published"). Moves under 2 points are hidden.
- **The post-match review now appears for model predictions**, and "✓ Called it" uses the call that was shown.
- **Fresh built-in predictions:** model `fb-2026-11-9e5c31b2`, 267 matches up to 15 Dec, and 28 graded matches.

## The live record so far

28 matches graded on GitHub. Too few to judge: about ±18 points either way by chance.

| Call | Right |
|---|---|
| Calls | 60.7% |
| Safer calls | 82.1% |
| Strong calls | 6 of 6 |

The backtest figures (52.4% at kick-off) remain the honest expectation.

## Tests

- Pipeline: 61, extended:
  - previous versions are published;
  - finished matches carry their call;
  - graded fields and 7- and 30-day windows;
  - retrain-due rules.
- App: 45, 2 new: prediction movement; results and the record.
