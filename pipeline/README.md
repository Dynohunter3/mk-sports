# mkdata: MK Sports multi-source data layer

Standard-library Python (3.10+). It fetches only from sources whose terms permit our use (see
`../docs/SOURCE_REGISTRY.md`). It gives every team and competition one internal ID, cross-checks
the sources, logs every disagreement, and stores each data point with the time it first existed
(`available_at`), so model features cannot see the future.

    python -m mkdata sync && python -m mkdata upcoming && python -m mkdata link && python -m mkdata elo
    python -m mkdata health --status var/status.json      # exit 2 on critical alerts
    python -m mkdata photos --budget 4000                 # player photos: Wikidata + Wikimedia Commons (pip install -r requirements-photos.txt)
    python -m pytest -q

**Optional keys:** `FOOTBALL_DATA_ORG_KEY`, `THE_ODDS_API_KEY` and `BALLDONTLIE_API_KEY` switch on the
matching adapters. `MK_ALERT_WEBHOOK` sends alerts to a webhook. Keys are read from the environment
only (CI secrets in production) and are redacted from logs and the cache.

**Files:**
- `registry/` holds the committed internal-ID tables (`entities.csv`, `aliases.csv`) and the review
  queue (`unresolved.csv`).
- `var/` holds the rebuildable database, HTTP cache, snapshots and status files. It is not committed.

Report for this step: `../docs/audit/STEP2_DATA_LAYER.md`.
