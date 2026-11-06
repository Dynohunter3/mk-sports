# Prediction engine

`engine/predictpro_engine` is a dependency-free Python package. It knows nothing about the database: callers pass `FinishedMatch` history and receive `Prediction` objects. The live API, the scheduler and the backtester all use the same code path.

```python
from predictpro_engine import get_model, Absence
model = get_model("football", league_params={"premier-league": {"home_advantage_elo": 60}})
book = model.new_book()
book.update_many(history)                      # chronological FinishedMatch list
inp = book.build_input("arsenal", "chelsea", kickoff, "premier-league",
                       away_absences=[Absence("K. Mensah", "FWD", 1.0, "injured", "top_scorer")])
pred = model.predict(inp)                      # probabilities, score, confidence, factors, explanation
```

## Football: Elo + Poisson (`football.py`)

1. **Elo**, cross-competition (Champions League games link the domestic leagues). K=20, home advantage 65, and the World Football Elo goal-difference multiplier. Ratings regress a third toward the mean after a 60-day gap (off-season).
2. **Attack/defence strength** relative to the competition's scoring average, updated online after every match. Each observation is adjusted for the opponent's strength (an exponentially weighted Maher model, roughly an 8-game memory).
3. **Expected goals** = competition average × attack × opponent defence. The goal *supremacy* is blended 50/50 with Elo's view (Elo gap ÷ 250 per goal), and the total is shrunk 30% toward the league average.
4. **Team news**: unavailable forwards cut that side's attack (10% × importance); goalkeepers and defenders weaken its defence. Each effect is capped at 30%, and doubtful players count half.
5. **Poisson score grid** with a Dixon–Coles low-score correction (ρ = −0.08) gives home/draw/away probabilities. The predicted score is the most likely scoreline *within* the most likely outcome, so the score always agrees with the pick.

## Basketball: Elo + net rating (`basketball.py`)

Margin = ½ × Elo gap ÷ 28 + ½ × 0.8 × net-rating gap + home court (NBA 2.5, EuroLeague 3.0) + rest (back-to-back −2.0; +0.5 per extra rest day, up to 2) − absences (4.5 points × importance, capped at 12). Win probability is Φ(margin ÷ σ), with σ of 12.5 for the NBA and 11 for the EuroLeague. There is **no draw outcome**. The projected score splits the expected total (from points for and against) by the margin, and is never tied.

Net rating here is points scored minus points allowed per game, exponentially weighted. Possession-adjusted ratings are a drop-in improvement once a provider supplies possessions.

## Confidence

| | High | Medium | Low |
|---|---|---|---|
| Football | top outcome ≥ 60% | ≥ 45% | otherwise |
| Basketball | ≥ 75% | ≥ 60% | otherwise |

The level drops one step if either team has fewer than 5 recorded matches, and another if Elo and the scoring model disagree on the favourite. The reasons appear in the explanation. On the seeded data, hit rate rises with confidence: basketball 88% high, 64% medium, 58% low; football 72% high, 57% medium, 43% low.

## Key factors & explanation

`factors.py` generates candidate factors with an impact score: rating gap, winning/unbeaten/losing/winless runs (tracked as true streaks, not capped by the form window), home/away record, head-to-head, scoring and clean sheets, absences (naming top scorers, captains and stars), rest days, and limited-data warnings. The top 3–5 are kept, at most 2 per category. Each prediction also carries `explanation.steps` (the calculation in plain language) and `explanation.inputs` (the raw numbers), shown under "How this prediction was made".

## Versioning & schedule (backend `services/predictions.py`)

* Every 15 minutes, and whenever squads change, upcoming matches in the next 10 days are re-predicted.
* A new **version** is stored only when a probability moves ≥ 1 point, the predicted score or confidence changes, or the absences change (`trigger=team_news`). Each version has `created_at`, `trigger`, `model_version` and `input_hash`, and exactly one version is `is_current`.
* Predictions **freeze at kick-off**. After the result, the last version made before kick-off is scored (correct, Brier, log loss) for the public accuracy tracker.
* `backfill` predictions for history imported at seed time are walk-forward: each uses only earlier results, and cold-start matches (either team with fewer than 3 games) are not published. They're labelled `backtest` on the accuracy page, never mixed in silently.

## Backtesting

```bash
python -m app.cli backtest              # on the database's results (backend)
predictpro-backtest results.csv --sport football --warmup 200   # any CSV
```

On the seeded mock history (walk-forward, 200-match warm-up):

| Sport | Model log loss / Brier / accuracy | Base rate (historical H/D/A frequency) |
|---|---|---|
| Football (772 matches) | 1.025 / 0.614 / 49.6% | 1.069 / 0.646 / 45.2% |
| Basketball (680 matches) | 0.645 / 0.454 / 63.5% | 0.680 / 0.487 / 58.5% |

The mock world is synthetic, so treat these as a correctness check of the pipeline, not a claim about real-world skill. Measure real accuracy on provider history before launch.

## Phase 3: gradient-boosted model

* `features.py` turns any `MatchInput` into a flat numeric feature vector (Elo gap, attack/defence, net ratings, form, rest, absence weight, head-to-head). Training data comes from `walk_forward` over history, so there's no look-ahead leakage.
* `evaluation.should_promote(candidate, baseline)` is the gate: the ML model replaces the baseline only if it beats it on **log loss and Brier score and accuracy**, with enough backtest matches (default 300). Install the extra with `pip install predictpro-engine[ml]` (pandas, scikit-learn, xgboost).

## Adding a sport

Implement a `RatingBook` subclass and a model with `new_book()` and `predict()`, then register it in `registry.py`. Tennis would add a surface-specific Elo; cricket, format-specific ratings with toss and venue effects; F1, driver and constructor ratings over a multi-competitor event model. Set the sport's `has_draws` and `scoring_rules` in the catalog.

## On-device engine and multi-source ensemble (mobile app)

`mobile/src/engine` is a line-for-line TypeScript port of this package. `npm test` replays fixtures generated by `engine/scripts/make_parity_fixtures.py` and requires identical ratings, probabilities, scores, confidence, key-factor wording and backtest metrics.

On the phone, the model is one of several sources (`mobile/src/engine/ensemble.ts`, `mobile/src/data/predict.ts`):

* **Sources:** the MK Sports model, ClubElo fixture probabilities, ESPN Analytics' matchup predictor, and betting-market consensus (prices converted to probabilities with the margin removed; never shown).
* **Evidence:** for each source, the mean log loss minus the model's log loss *on the same matches*. It comes from a walk-forward backtest over the stored 12 months of results (model vs market), plus every forecast saved on the phone before kick-off and scored afterwards. The backtest runs in the background, at most every 6 hours or when the history grows by 5%, and is persisted.
* **Weights:** `prior × exp(−min(n, 300) × (gap − best gap) / 2)`: tempered Bayesian model averaging. Sources need at least 20 matches of evidence before it moves their weight.
* **Blend:** a linear opinion pool. The predicted score is re-derived from the blended probabilities (Poisson supremacy solved by bisection for football; normal-margin inverse for basketball), so the score always agrees with the favourite.

## Other team sports: NFL, NHL, MLB (mobile app)

These sports use the same Elo + net-rating margin model as basketball, with settings per sport (`MARGIN_SPORTS` in `mobile/src/engine/models.ts`). A margin is projected in the sport's unit (points, goals or runs). Win probability is the normal CDF of margin / σ, and the score follows from the projected margin and total.

The settings are tuned by `mobile/scripts/calibrate-margin.ts` on real ESPN results. It uses coordinate descent over K, home advantage, Elo-to-margin scale, Elo/net blend, shrinkage, EWMA speed, σ and the back-to-back penalty. Games 30–70% of the way through the sample are used for tuning, and the last 30% are held out:

| | Data | Held-out games | Hit rate | Log loss | Before tuning (same games) |
|---|---|---|---|---|---|
| NFL | Oct 2023 – Nov 2026, 858 games | 256 | 62.1% | 0.636 | 62.1% / 0.643 |
| NHL | Apr 2025 – Nov 2026, 1,706 games | 512 | 58.0% | 0.669 | 57.8% / 0.676 |
| MLB | Apr 2025 – Oct 2026, 4,611 games | 1,383 | 57.0% | 0.682 | 55.6% / 0.685 |

The confidence thresholds are set per sport, because favourites win less often in hockey and baseball (high/medium: NFL 75/60%, NHL 65/56%, MLB 62/55%). On the held-out games, high-confidence calls were right 80% (NFL), 76% (NHL) and 66% (MLB) of the time.

## Expected goals (mobile app)

`mobile/src/engine/xg.ts` is a logistic regression on shot distance and the angle of the goal mouth. It is fitted by `engine/scripts/fit_xg.py` on shots collected by `engine/scripts/collect_shots.py` from ESPN play-by-play: 22,711 non-penalty shots from 910 matches.

ESPN uses two coordinate systems. Older matches give x as a fraction of half the pitch, measured from the goal line; newer ones use 0–100 towards the target goal. Both were validated on the penalty spot (both read about 12 m) and on the commentary's "six yard box" and "outside the box" descriptions.

Commentary text is not used as a feature. Goals are always described as "footed shot", never "header", so text tags would leak the outcome.

On held-out matches the model predicted 368.0 xG against 361 goals. Log loss is 0.262 against 0.278 for a constant rate. Penalties use the observed conversion rate (0.766).
