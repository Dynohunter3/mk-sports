# Step 11: the season simulator, and whether its chances hold up

- **Results:** `audit/results/step11.json`.
- **Code:**
  - the simulator: `pipeline/mkmodel/simulate.py`;
  - the backtest: `pipeline/mkmodel/sim_backtest.py`;
  - tests: `pipeline/tests/test_simulate.py`.

## What it does

Every 6 hours the pipeline plays out every league fixture still to come, 10,000 times. From that it publishes each team's chances in `simulations.json`, with the change since last week:
- title;
- top four;
- top six (Europe);
- automatic promotion and play-offs;
- relegation.

**How it works:**
- **Which leagues:** only those whose season is a plain double round robin, with the final table deciding everything. That is 15 of the 20 published competitions:
  - Premier League, Championship, League One, League Two;
  - LaLiga, LaLiga 2;
  - Serie A, Serie B;
  - Bundesliga, 2. Bundesliga;
  - Ligue 1, Ligue 2;
  - Eredivisie, Liga Portugal, Süper Lig.
- **Not simulated, and why** (the app says so):
  - Scottish Premiership: the league splits after 33 rounds;
  - Belgium and Greece: the title and relegation are decided in play-offs;
  - MLS: conferences and play-offs;
  - Champions League: a knockout competition.
- **Fixtures left:** every home-and-away pairing not played yet. These are known even when fixture lists arrive late.
- **Each fixture's chances:**
  - the published prediction where there is one, which uses the bookmakers' odds when they are out;
  - otherwise the production model's no-odds blend, with features as they stand now (ratings, Dixon-Coles strengths, form) and a neutral week's rest.
- **Scores:** drawn from the Dixon-Coles grid of the model's expected goals, re-weighted so home win, draw and away win have exactly the model's chances.
- **Tables:** ranked on points, then goal difference, then goals scored.
- **Change since last week:** compared with the stored run closest to seven days earlier. The first time, a run is made with the data as it stood seven days before, and the file says so.
- **Not modelled:**
  - point deductions;
  - head-to-head tie-breakers;
  - the play-off matches themselves (only the places that lead to them);
  - team strengths changing during the rest of the season (each fixture's chances stay fixed).
- **Runtime:** about 2 minutes per run on the GitHub runner (about 4 minutes the first time, with the week-ago run).

## The backtest (protocol fixed before any result was seen)

- **Dates:** 1 December and 1 March, in 2024-25 and 2025-26 (15 leagues at 4 dates: 60 league tables).
- **Model:** at each date, retrained on data from before that date only, with the same code and settings as production.
- **Simulation:** the simulator then runs exactly as in production, with every fixture on the no-odds model, because no predictions were published at the time.
- **Outcome:** the final table worked out from the results.
- **Baselines:**
  - "the table as it stands": 100% for teams inside a zone on the date, 0% otherwise;
  - the zone's base rate.
- **Skipped league tables:** those that are not a clean double round robin in the data:
  - the 19-team Süper Lig of 2024-25;
  - Ligue 2 2025-26, with matches missing from the store;
  - four where a pairing had two results recorded on the date (League One 2025-26 in March, League Two 2025-26 at both dates, Serie B 2025-26 in March).

  That left 52 league tables on a date, and 1,036 team forecasts.

## Results

**Brier score of each zone's probability** (lower is better):

| Zone | Team forecasts | Happened | Simulator | Table as it stood | Base rate |
|---|---|---|---|---|---|
| Title | 1,036 | 52 | **0.018** | 0.031 | 0.048 |
| Top four | 564 | 120 | **0.041** | 0.071 | 0.167 |
| Top six (Europe) | 384 | 120 | **0.063** | 0.083 | 0.215 |
| Automatic promotion | 472 | 46 | **0.051** | 0.089 | 0.088 |
| Play-off places | 472 | 80 | **0.095** | 0.182 | 0.137 |
| Relegation | 1,036 | 139 | **0.051** | 0.100 | 0.116 |

- **Every zone:** the simulator beats both baselines, by 25–50% against the table as it stood.
- **Finishing place:** the ranked probability score of each team's whole finishing-place distribution is 0.067, against 0.109 for "every team stays where it is".
- **By date:** the gain is largest early in the season. On 1 December the Brier score is 0.055–0.057 against 0.096–0.117 for the table; on 1 March it is 0.033–0.041 against 0.052–0.066.

**Calibration** (all zones together):

| Chance given | Cases | Average given | Happened |
|---|---|---|---|
| under 2% | 2,542 | 0.2% | 0.2% |
| 2–10% | 367 | 5.0% | 6.5% |
| 10–25% | 311 | 16.5% | 16.4% |
| 25–50% | 276 | 37.2% | 36.2% |
| 50–75% | 175 | 61.1% | 58.3% |
| 75–90% | 86 | 82.5% | 82.6% |
| 90–98% | 67 | 94.9% | 97.0% |
| 98% or more | 140 | 99.7% | 100% |

- **Overall:** the chances hold up.
- **Slightly too sure:** long shots (2–10%) happened a little more often than given, and 50–75% chances a little less. That is the expected side effect of fixed team strengths. Both gaps are within about one standard error of the counts, so they are not clearly real.
- **In the app:** percentages under 0.5% are shown as "<1%" and over 99.5% as ">99%", never as 0% or 100%.

## Weekly change and noise

- **Noise:** with 10,000 simulations, a 34% chance carries about ±1 percentage point of simulation noise (95%), and a week-on-week difference about ±1.3.
- **What the app shows:** a weekly change only when it is 2 points or more.

## Limits

- **Fixed chances within a run:** they make long-range outcomes slightly too certain (above).
- **The backtest used the no-odds model throughout:** production uses the published prediction, with odds, for the next few days' fixtures, which is a small difference.
- **Final tables in the backtest come from the results:** point deductions and head-to-head tie-breakers would change a few places in real tables.
