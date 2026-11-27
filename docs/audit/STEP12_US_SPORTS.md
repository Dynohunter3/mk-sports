# Step 12: better NBA, NHL and NFL predictions?

- **Results:** `audit/results/step12.json`.
- **Code:**
  - the experiment: `mobile/scripts/audit/us-sports.ts`;
  - the shipped engine check: `mobile/scripts/audit/us-sports-check.ts`;
  - the new ratings: `mobile/src/engine/ridge.ts` (with tests).

## Short answer

- **NBA: yes.** Opponent-adjusted ratings blended 70/30 with the current model improve log loss on the test season from 0.6017 to 0.5981 (the shipped engine) and the hit rate from 67.9% to 68.5%. It also improves on the 2024-25 selection season and on the first 121 games of 2026-27.
- **NHL and NFL: no.**
  - None of the candidates beat the current model on the test season, so those models are unchanged.
  - The new ratings did better on the selection season and on 2026-27 so far, but worse on 2025-26.
  - With differences this small (NHL) or samples this small (NFL, 285 games), that is noise, and the rule says no change.
- **All three, when ESPN lists a bookmaker line:** the app's blend now puts 90% on the market instead of two-thirds. That was better on both seasons in all three sports.
- **The gap to the bookmakers remains.** On the 2025-26 games with a line, log loss:
  - NBA: new model 0.598, market 0.577;
  - NHL: model 0.686, market 0.681;
  - NFL: model 0.626, market 0.609.

  The market knows things the app's free data doesn't: injuries before they're announced, rest decisions, goalie starts, quarterbacks.

## Protocol (fixed before any result was seen)

- **Data:** the ESPN results already saved for Step 1 (`audit/data/espn`), from autumn 2023 to 6 November 2026, with preseason games left out. Nothing was downloaded again.
- **Same conditions as the app:** every game is predicted from the finished games of the previous 365 days (NFL 730) before its UTC day. Rest days come from the schedule, which is public before tip-off.
- **Seasons:**
  - 2024-25 (NFL 2024) chooses every setting;
  - 2025-26 (NFL 2025) is the test;
  - 2026-27 so far is a fresh check.
- **Candidates:**
  - **engine:** the current model, unchanged.
  - **retuned:** the same model with its settings re-chosen on the selection season (home advantage, spread, Elo weight, smoothing, back-to-back).
  - **ridge:** opponent-adjusted ratings. Each game's margin is fitted by least squares with recent games weighted more, so beating a strong team counts for more. Home advantage and rest effects (NBA and NHL back-to-backs; NFL byes and short weeks) are learned from the same window. A normal model's spread, fitted on the selection season, turns margins into win chances.
  - **blend:** ridge and engine margins combined, with the weight and spread chosen on the selection season.
- **Benchmarks:**
  - ESPN's listed closing line, margin removed;
  - always the home team.
- **Decision rule:** a sport switches only if test-season log loss beats the current engine by at least 0.003 and the selection season is not worse.
- **Caveat on the baseline:** the current NFL and NHL settings were tuned in October on data that overlaps these seasons, so their baseline is slightly flattering. That works against the new candidates.

## Results

**Log loss** (lower is better; a coin flip is 0.693):

| | Season | Games | Current | Retuned | Ridge | Blend | Market |
|---|---|---|---|---|---|---|---|
| **NBA** | selection | 1,324 | 0.6081 | 0.6052 | 0.6046 | **0.6039** | 0.5853 |
| | test | 1,326 | 0.6017 | 0.6015 | 0.5991 | **0.5979** | 0.5767 |
| | 2026-27 so far | 121 | 0.6476 | 0.6413 | 0.6096 | 0.6192 | – |
| **NHL** | selection | 1,405 | 0.6708 | 0.6666 | 0.6637 | 0.6637 | 0.6568 |
| | test | 1,394 | **0.6863** | 0.6866 | 0.6900 | 0.6900 | 0.6808 |
| | 2026-27 so far | 252 | 0.6586 | 0.6551 | 0.6533 | 0.6533 | – |
| **NFL** | selection | 286 | 0.6160 | 0.6127 | 0.6173 | 0.6141 | 0.5892 |
| | test | 285 | **0.6255** | 0.6315 | 0.6397 | 0.6294 | 0.6094 |
| | 2026-27 so far | 120 | 0.6578 | 0.6576 | 0.6436 | 0.6504 | – |

- **Market column:** games with a listed line, nearly all of them. No closing lines were saved for 2026-27.
- **NBA hit rate on the test season:**
  - current 67.9%;
  - blend 68.5% (the shipped engine: 68.5%);
  - market 68.6%.
- **NBA calibration (test season):** the blend is closer at the top end. Favourites given 70–80% won 76.8% of the time (current model: 79.0%), and 80–90% won 83.1% (current: 81.7%).
- **Settings chosen for the NBA:**
  - opponent-adjusted ratings with a 60-day half-life, a pull of 2 games' weight towards average, margins capped at 20, last season counted in full, and the back-to-back effect learned;
  - blend weight 0.7;
  - spread 10.81 points.
  - The pull (2) was the smallest value tried, so a still smaller one might do slightly better. It was not tried, to keep the test season clean.

## Bookmaker weight (an extra analysis added after the main results, with the same split)

- **How the app combines sources:** a weighted average of its own model and the bookmakers' line whenever ESPN lists one. The weights have stayed at their starting values, 2 for the market and 1 for the model (two-thirds on the market), because ESPN removes odds after games, so the app can never learn better ones.
- **What the backtest chose:** on the selection season, 0.85–1.0 on the market.
- **The app now uses 0.9** for basketball, ice hockey and American football. Football and other sports are unchanged.

| Test season, games with a line | Two-thirds on the market | 90% on the market | Market only |
|---|---|---|---|
| NBA (new model) | 0.5791 | 0.5769 | 0.5767 |
| NHL | 0.6815 | 0.6808 | 0.6808 |
| NFL | 0.6108 | 0.6094 | 0.6094 |

- **Caveat:** these are closing lines. The app sees ESPN's line before the game, which is usually close to the closing line on game day but not identical.
- **When odds are missing:** for games days away, or where ESPN lists no line, the app's own model is all there is. That is where the NBA model change matters most.

## Shipping it

- **Engine change:** `ridgeWeight` and the related settings were added to the margin model. They are off by default, so the parity tests against the Python engine are unchanged. They are switched on in the NBA's settings (`src/data/leagues.ts`).
- **Injuries:** they stay a full adjustment on top of the blend, because they come from today's team news, not from past results.
- **The shipped engine matches the experiment:** NBA log loss 0.6034 / 0.5981 / 0.6188 on selection, test and 2026-27 so far, against 0.6039 / 0.5979 / 0.6192. The small differences come from rest days at the window's edge and rounding the spread.
- **Speed:** one fit a day, with the weighted sums rolled forward rather than rebuilt. The app's background re-scoring of a season of NBA games went from 70 ms to 109 ms on the development machine; it was 861 ms before this optimisation.
- **Tests:**
  - the rolled sums equal a direct fit;
  - the ratings recover a known order and home edge;
  - the blend is used only when the settings ask for it;
  - the 90% market weight applies only to the three US sports.
