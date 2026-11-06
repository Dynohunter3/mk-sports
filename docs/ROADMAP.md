# Roadmap

## Phase 1: MVP (this repository) ✅

Football and basketball, fixtures, live scores, baseline predictions with explanations, the pick game (points, lock at kick-off, streaks, badges), the global leaderboard (weekly, season, all-time), and personalised home feed, accounts and privacy controls. Also pulled forward: the public accuracy tracker.

## Phase 2

| Item | Already in place | To build |
|---|---|---|
| Cricket | Sport and leagues in the catalog (`is_active: false`), `has_draws`, scoring rules | `CricketModel`: format-specific (T20/ODI/Test) team ratings with toss and venue effects. Provider mapping for innings scores (runs/wickets). |
| Tennis | Catalog entries | Surface-specific Elo (hard/clay/grass); player-vs-player "teams"; sets as the score unit |
| Private leagues | `private_leagues`, `private_league_members`, leaderboard `scope`/`scope_id`; app screen preview | Create/join endpoints with invite codes; leaderboard = global entries filtered to members (optionally by sport) |
| Friends leaderboards | `friendships` table | Invite/accept flow; same filtered-leaderboard approach |
| Notifications | `notifications` (with `dedupe_key`), `device_tokens`, `POST /me/devices`, stored per-user preferences | Scheduler hooks for match reminders, pick-lock warnings (30 min before kick-off for unpicked favourite matches), results (on settlement) and leaderboard moves; FCM sender draining the table |
| Accuracy tracker | Done in Phase 1 | Calibration charts, per-model comparison when Phase 3 lands |

## Phase 3

| Item | Notes |
|---|---|
| Tier 2 sports: NFL, MLB, NHL, F1, rugby union, volleyball, boxing/MMA | All in the catalog. F1 needs a multi-competitor event model (`MatchParticipant`) rather than home/away. |
| ML model | `features.py` + walk-forward training data + the `should_promote` gate (must beat the baseline on log loss, Brier **and** accuracy) |
| Premium tier (advanced stats, ad-free) | Entitlements table; card payments plus mobile money (MTN MoMo, Airtel Money) via an aggregator; server-side receipt validation |
| Odds (optional) | Only with an 18+ age gate and responsible-gambling links. `/meta.shows_odds` / `age_gate_required` are the switch. |

## Before a public launch

* Run the provider adapters against real keys and backfill at least two seasons of history per competition.
* Configure Supabase (or Firebase) Auth and test Google and phone flows on devices.
* Replace the placeholder app icon and splash, write the legal texts (terms, privacy), and set up EAS builds and store listings.
* Put the API behind HTTPS with a CDN for the web build, run one worker, and add monitoring/alerting on `job_runs` errors.
