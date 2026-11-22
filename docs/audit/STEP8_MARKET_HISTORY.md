# Step 8: market history (raising the hit rate)

## Where the headroom was

Measured on the Step 6 predictions (two seasons, 7,740 matches):

| | Our model | Bookmaker pre-match odds | Bookmaker closing odds |
|---|---|---|---|
| Matches with pre-match odds (84%) | 53.1% | 53.0% | 53.6% |
| Same matches, our model **without** odds | 51.6% | | |
| Matches that never get pre-match odds (MLS, Champions League) | 49.5% | – | MLS closing: 48.0% |

- **At kick-off, the only headroom is fresher odds: about +0.5 points.** An ensemble fed closing odds reached 53.6%.
- **Matches with no odds are not a model weakness.** They are mostly MLS, where even closing odds get 48.0% (us: 47.9%).
- **The real gap is the prediction made before a match's odds are out.** That is what the app shows for most of the week: odds arrive on Tuesdays and Fridays, and 237 of the 266 published matches had none. There our model was 1.4 points behind the bookmakers.

## The idea

**Market history** gives each team a rating from the odds of the matches it has **already played**.
- **How it's built:** the market's supremacy for each past match, ln(P home / P away), is modelled as rating(home) − rating(away) + home edge. Each match moves both ratings toward what the market implied.
- **Why it helps:** the market prices injuries, transfers and new managers, so this gives the model the market's view of each team days before the next match's odds appear.
- **Leak-free:** a match's odds are used only once its result is published, because closing odds come with the result. A match's own odds never reach its own prediction (tested).
- **No new source:** it uses the same football-data.co.uk files.
- **Scope:**
  - Ratings live within one competition, because ratings from different leagues aren't on one scale.
  - Champions League matches get no rating.
  - Coverage is 98% of league matches.

## The test

**Protocol (fixed before any result was seen):**
- Same walk-forward and matches as Step 6.
- Step size chosen on the 2024-25 season only, from 0.1, 0.2 and 0.35. The choice was 0.35.
- Adoption required a lower 2024-25 log loss for **both** the deployed rule and the no-odds model.

**Result: mixed.**
- **No-odds model, all matches:**
  - 2024-25: log loss 0.9858 → 0.9777;
  - 2025-26 (test): 1.0011 → 0.9945;
  - hit rate (both seasons): 51.3% → 51.9%.
- **Once a match's own odds are out, it adds nothing.** The deployed rule's 2024-25 log loss went 0.9730 → 0.9739, so the all-or-nothing rule said **not adopted**.
- **Matches that never get odds got worse on 2024-25**, mostly the Champions League, which has no ratings.

**What was deployed, decided on 2024-25 numbers only:** market history is used for **league matches before their odds are out**, when both teams have a rating.
- With odds: unchanged (Step 6).
- MLS and the Champions League: unchanged (Step 6). MLS was slightly worse on 2024-25.

| League matches before odds (what the app shows days ahead) | Before | After | Bookmaker pre-match odds |
|---|---|---|---|
| 2024-25 | 52.6% (LL 0.9804) | **53.2%** (LL 0.9694) | 53.6% |
| 2025-26 (test) | 50.7% (LL 0.9933) | **51.7%** (LL 0.9872) | 52.4% |
| Both | 51.6% (LL 0.9868) | **52.5%** (LL 0.9783) | 53.0% |
| **At kick-off, all matches** | 52.4% | 52.4% (unchanged) | |

## Honest notes

- **The official hit rate does not change.** It is graded on the last prediction before kick-off, which usually has odds: 52.4%. What improves is the prediction you see during the week, by about 0.9 points. The gap to the bookmakers there shrinks from 1.4 points to 0.5.
- **Fewer draw calls before odds are out.**
  - When the blend relies on the market-history rating, its draw probabilities rarely reach the 31% needed for a draw call.
  - Days-ahead draw calls: 4.2% of matches over both seasons, but only 0.9% in 2025-26 and none in this week's file.
  - Draw calls at kick-off (odds out) are unchanged.
- **A version that keeps draws was tested** (the boosted model alone carries market history). Pre-set rule: lower 2024-25 log loss wins, with a tie zone of 0.001. Its log loss was 0.0043 worse, so it was not chosen.
  - Its days-ahead numbers: 52.4% hit, 9.4% draw calls (29% right).
  - This is a one-line switch if draw calls during the week matter more than 0.1 points of hit rate.
- **A bigger gain at kick-off needs fresher odds** (up to about +0.5 points), meaning a live-odds source. The Odds API has a free tier, but it needs your own account and key. Nothing was signed up for.

Files:
- `audit/results/step8.json`: grid, both variants, the deployed rule, the draw check;
- `pipeline/mkmodel/step8.py`: re-run with `python -m mkmodel.step8`, then `python -m mkmodel.step8 --rule`;
- `pipeline/tests/test_market_history.py`.
