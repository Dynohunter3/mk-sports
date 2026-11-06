# API reference (v1)

Base URL: `/api/v1`. Interactive OpenAPI docs: `/docs`. JSON responses are gzip-compressed and carry a weak `ETag`; send `If-None-Match` to get an empty `304` when nothing changed. Authenticated endpoints take `Authorization: Bearer <token>` (dev JWT or Supabase access token).

Errors use `{"detail": {"code": "...", "message": "..."}}` for game rules, for example `locked`, `no_draws`, `score_mismatch` and `consent_required`.

## Catalog

| Method | Path | Notes |
|---|---|---|
| GET | `/meta` | Disclaimer text, `free_to_play`, `shows_odds`, `age_gate_required` |
| GET | `/sports?include_inactive=` | Sports with colour, icon, `has_draws`, scoring rules, phase |
| GET | `/leagues?sport=&include_inactive=` | Competitions plus current season |
| GET | `/leagues/{id}` | One competition with live/upcoming counts |
| GET | `/leagues/{id}/standings` | League table (P W D L, points for/against, points, form) |
| GET | `/teams?search=&sport=&league_id=&limit=` | Team search, with Elo and form |
| GET | `/teams/{id}` | One team |

## Matches & predictions

| Method | Path | Notes |
|---|---|---|
| GET | `/matches` | Filters: `date` + `tz` (local day), `from`, `to`, `sport`, `league_id`, `team_id`, `status`, `order`, `limit`, `cursor` (keyset pagination) |
| GET | `/matches/live?sport=` | Everything in progress |
| GET | `/matches/{id}` | Detail: card, venue, events, full prediction (probabilities, score, expected goals/points, confidence, key factors, explanation steps, version), last-5 form, head-to-head, standings, injuries, ratings, scoring rules, your pick |
| GET | `/matches/{id}/predictions` | Every stored prediction version (timestamp, trigger, probabilities) |
| GET | `/feed?sports=&leagues=&teams=&tz=` | Personalised home: live, your teams, today, most confident predictions, coming up, latest results. Guests pass favourites as ids; signed-in users get their saved favourites. |
| GET | `/accuracy?source=all\|live\|backtest&sport=` | Hit rate, Brier score and log loss overall and by sport, league and confidence, plus recent outcomes |

A match card (used in every list):

```json
{
  "id": 899, "sport": "football",
  "league": {"id": 6, "slug": "champions-league", "short_name": "Champions League"},
  "start_time": "2026-11-03T20:00:00Z", "status": "scheduled", "clock": null, "round": "League phase MD8",
  "home": {"id": 131, "name": "FC Copenhagen", "short_name": "Copenhagen", "code": "FCK", "color": "#D1D5DB"},
  "away": {"id": 128, "name": "Galatasaray", "short_name": "Galatasaray", "code": "GAL", "color": "#A90432"},
  "home_score": null, "away_score": null,
  "prediction": {"home": 0.35, "draw": 0.27, "away": 0.38, "score": [1, 2], "confidence": "low", "pick": "away"},
  "my_pick": {"pick": "away", "home_score": 1, "away_score": 2, "status": "pending", "points": 0},
  "locked": false
}
```

## The game

| Method | Path | Notes |
|---|---|---|
| PUT | `/picks/{match_id}` | Body `{"pick": "home"\|"draw"\|"away", "home_score"?, "away_score"?}`. A score alone implies the outcome. `409 locked` from kick-off; `403 consent_required`. Returns any newly earned badges. |
| DELETE | `/picks/{match_id}` | Until kick-off |
| GET | `/picks?match_ids=1,2,3` | Your picks for specific matches |
| GET | `/leaderboards/global?period=week\|season\|all&key=&limit=&offset=` | Ranked rows (ties share a rank) plus your own row |
| GET | `/leaderboards/periods` | Current period keys and periods that have data |

## Account

| Method | Path | Notes |
|---|---|---|
| GET | `/auth/config` | `dev` or `supabase`, available methods |
| POST | `/auth/register` | Dev mode: email, password, display name, **consent required** |
| POST | `/auth/login` | Dev mode |
| POST | `/auth/demo` | Dev mode, non-production only: the seeded demo user |
| GET | `/me` | Profile, consent state, favourites, stats (points, accuracy, streaks, rank), badges |
| PATCH | `/me` | `display_name`, `country`, `notification_prefs`, `marketing_opt_in` |
| POST | `/me/consent` | Accept terms and privacy (Supabase users, before first pick) |
| PUT | `/me/favourites` | `{sports: [], leagues: [], teams: []}` |
| GET | `/me/picks?status=all\|pending\|settled&cursor=` | Pick history |
| POST | `/me/devices` | Register an FCM token (delivery in Phase 2) |
| GET | `/me/export` | Everything stored about you |
| DELETE | `/me` | Delete the account and all data |

## Admin (`X-Admin-Token` header)

| Method | Path | Notes |
|---|---|---|
| POST | `/admin/jobs/{fixtures\|live\|squads\|predictions\|standings\|settle}` | Run a job now |
| GET | `/admin/jobs` | Recent job runs |
| POST | `/admin/catalog` | Upsert sports, leagues and badges (same shape as `catalog.json`) |

`GET /health` is the liveness check.
