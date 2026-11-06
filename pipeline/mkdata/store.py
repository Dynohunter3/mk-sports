"""SQLite point-in-time store.

Two clocks on every data point:
  available_at  the earliest moment the information existed in the real world (a result: final
                whistle; closing odds: kick-off; pre-match odds: when the source collected them).
                For live fetches it is the fetch time.
  fetched_at    when this pipeline downloaded it.

Features are read through :class:`PointInTime`, which only returns rows with
``available_at < as_of`` and refuses (``LeakageError``) anything else.
"""

from __future__ import annotations

import json
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

SCHEMA = """
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, sport TEXT NOT NULL, name TEXT NOT NULL, country TEXT,
  created_at REAL NOT NULL, created_by TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS aliases (
  source TEXT NOT NULL, kind TEXT NOT NULL, raw TEXT NOT NULL, scope TEXT NOT NULL DEFAULT '',
  entity_id TEXT NOT NULL REFERENCES entities(id), method TEXT NOT NULL, evidence TEXT, created_at REAL NOT NULL,
  PRIMARY KEY (source, kind, raw, scope));
CREATE TABLE IF NOT EXISTS unresolved (
  source TEXT NOT NULL, kind TEXT NOT NULL, raw TEXT NOT NULL, scope TEXT NOT NULL DEFAULT '',
  first_seen REAL NOT NULL, last_seen REAL NOT NULL, n INTEGER NOT NULL DEFAULT 1, best_guess TEXT, best_score REAL,
  PRIMARY KEY (source, kind, raw, scope));
CREATE TABLE IF NOT EXISTS source_matches (
  source TEXT NOT NULL, source_key TEXT NOT NULL, competition_id TEXT NOT NULL, season TEXT NOT NULL,
  kickoff_utc REAL, kickoff_exact INTEGER NOT NULL, local_date TEXT NOT NULL,
  home_raw TEXT NOT NULL, away_raw TEXT NOT NULL, home_id TEXT, away_id TEXT,
  status TEXT NOT NULL, home_score INTEGER, away_score INTEGER,
  fetched_at REAL NOT NULL, available_at REAL NOT NULL, match_id TEXT, mkey TEXT NOT NULL,
  PRIMARY KEY (source, source_key));
CREATE INDEX IF NOT EXISTS sm_comp ON source_matches (competition_id, local_date);
CREATE INDEX IF NOT EXISTS sm_mkey ON source_matches (mkey);
CREATE INDEX IF NOT EXISTS sm_mid ON source_matches (match_id);
CREATE TABLE IF NOT EXISTS matches (
  match_id TEXT PRIMARY KEY, sport TEXT NOT NULL, competition_id TEXT NOT NULL, season TEXT NOT NULL,
  kickoff_utc REAL, home_id TEXT NOT NULL, away_id TEXT NOT NULL, status TEXT NOT NULL,
  home_score INTEGER, away_score INTEGER, result_available_at REAL, sources TEXT NOT NULL,
  agreement REAL NOT NULL, resolved_at REAL NOT NULL);
CREATE INDEX IF NOT EXISTS m_kick ON matches (kickoff_utc);
CREATE TABLE IF NOT EXISTS odds (
  match_key TEXT NOT NULL, source TEXT NOT NULL, bookmaker TEXT NOT NULL, kind TEXT NOT NULL,
  home REAL NOT NULL, draw REAL, away REAL NOT NULL, available_at REAL NOT NULL, fetched_at REAL NOT NULL,
  PRIMARY KEY (match_key, source, bookmaker, kind, available_at));
CREATE TABLE IF NOT EXISTS team_stats (
  match_key TEXT NOT NULL, side TEXT NOT NULL, source TEXT NOT NULL, stats TEXT NOT NULL,
  available_at REAL NOT NULL, fetched_at REAL NOT NULL, PRIMARY KEY (match_key, side, source));
CREATE TABLE IF NOT EXISTS ratings (
  team_id TEXT NOT NULL, source TEXT NOT NULL, as_of TEXT NOT NULL, value REAL NOT NULL,
  available_at REAL NOT NULL, fetched_at REAL NOT NULL, PRIMARY KEY (team_id, source, as_of));
CREATE TABLE IF NOT EXISTS conflicts (
  match_id TEXT NOT NULL, field TEXT NOT NULL, severity TEXT NOT NULL, rule TEXT NOT NULL,
  chosen_source TEXT NOT NULL, chosen_value TEXT, candidates TEXT NOT NULL, logged_at REAL NOT NULL,
  PRIMARY KEY (match_id, field));
CREATE TABLE IF NOT EXISTS source_quality (
  source TEXT NOT NULL, competition_id TEXT NOT NULL, season TEXT NOT NULL, shared_finals INTEGER NOT NULL,
  score_disagreements INTEGER NOT NULL, kickoff_disagreements INTEGER NOT NULL, demoted INTEGER NOT NULL,
  measured_at REAL NOT NULL, PRIMARY KEY (source, competition_id, season));
CREATE TABLE IF NOT EXISTS source_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, job TEXT NOT NULL, started_at REAL NOT NULL,
  finished_at REAL, ok INTEGER, rows INTEGER, error TEXT);
CREATE TABLE IF NOT EXISTS fallback_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL, scope TEXT NOT NULL, failed_source TEXT NOT NULL,
  used_source TEXT, reason TEXT NOT NULL, at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, subject TEXT NOT NULL, severity TEXT NOT NULL,
  message TEXT NOT NULL, at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS predictions (
  prediction_id TEXT PRIMARY KEY, match_id TEXT NOT NULL, model_version TEXT NOT NULL, made_at REAL NOT NULL,
  p_home REAL NOT NULL, p_draw REAL, p_away REAL NOT NULL, inputs_hash TEXT NOT NULL, reason TEXT NOT NULL,
  outcome TEXT, log_loss REAL, brier REAL, graded_at REAL);
"""


class LeakageError(AssertionError):
    pass


class Store:
    def __init__(self, path: str | Path = ":memory:", clock=time.time):
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.path)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA)
        self.clock = clock

    def close(self) -> None:
        self.db.close()

    # -- writes -----------------------------------------------------------------------------
    def upsert_source_matches(self, rows: Iterable[dict]) -> int:
        n = 0
        for r in rows:
            self.db.execute(
                """INSERT INTO source_matches (source, source_key, competition_id, season, kickoff_utc, kickoff_exact,
                     local_date, home_raw, away_raw, status, home_score, away_score, fetched_at, available_at, mkey)
                   VALUES (:source,:source_key,:competition_id,:season,:kickoff_utc,:kickoff_exact,:local_date,
                     :home_raw,:away_raw,:status,:home_score,:away_score,:fetched_at,:available_at,:mkey)
                   ON CONFLICT(source, source_key) DO UPDATE SET
                     season=excluded.season, kickoff_utc=excluded.kickoff_utc, kickoff_exact=excluded.kickoff_exact, local_date=excluded.local_date,
                     status=excluded.status, home_score=excluded.home_score, away_score=excluded.away_score,
                     fetched_at=excluded.fetched_at,
                     available_at=CASE WHEN source_matches.status=excluded.status
                                        AND source_matches.home_score IS excluded.home_score
                                        AND source_matches.away_score IS excluded.away_score
                                       THEN source_matches.available_at ELSE excluded.available_at END""",
                {**r, "mkey": f"{r['source']}:{r['source_key']}"},
            )
            n += 1
        self.db.commit()
        return n

    def add_odds(self, rows: Iterable[dict]) -> int:
        n = 0
        for r in rows:
            self.db.execute(
                "INSERT OR IGNORE INTO odds VALUES (:match_key,:source,:bookmaker,:kind,:home,:draw,:away,:available_at,:fetched_at)", r
            )
            n += 1
        self.db.commit()
        return n

    def add_team_stats(self, rows: Iterable[dict]) -> int:
        n = 0
        for r in rows:
            self.db.execute(
                "INSERT OR REPLACE INTO team_stats VALUES (:match_key,:side,:source,:stats,:available_at,:fetched_at)",
                {**r, "stats": json.dumps(r["stats"], sort_keys=True)},
            )
            n += 1
        self.db.commit()
        return n

    def add_ratings(self, rows: Iterable[dict]) -> int:
        n = 0
        for r in rows:
            self.db.execute("INSERT OR REPLACE INTO ratings VALUES (:team_id,:source,:as_of,:value,:available_at,:fetched_at)", r)
            n += 1
        self.db.commit()
        return n

    def log_run(self, source: str, job: str, started_at: float, ok: bool, rows: int = 0, error: str | None = None) -> None:
        self.db.execute(
            "INSERT INTO source_runs (source, job, started_at, finished_at, ok, rows, error) VALUES (?,?,?,?,?,?,?)",
            (source, job, started_at, self.clock(), int(ok), rows, error),
        )
        self.db.commit()

    def log_fallback(self, category: str, scope: str, failed: str, used: str | None, reason: str) -> None:
        self.db.execute(
            "INSERT INTO fallback_events (category, scope, failed_source, used_source, reason, at) VALUES (?,?,?,?,?,?)",
            (category, scope, failed, used, reason, self.clock()),
        )
        self.db.commit()

    def raise_alert(self, kind: str, subject: str, severity: str, message: str) -> None:
        self.db.execute(
            "INSERT INTO alerts (kind, subject, severity, message, at) VALUES (?,?,?,?,?)",
            (kind, subject, severity, message, self.clock()),
        )
        self.db.commit()

    def log_conflict(self, match_id: str, field: str, severity: str, rule: str, chosen_source: str, chosen_value, candidates: dict) -> None:
        self.db.execute(
            "INSERT OR REPLACE INTO conflicts VALUES (?,?,?,?,?,?,?,?)",
            (match_id, field, severity, rule, chosen_source, json.dumps(chosen_value), json.dumps(candidates, sort_keys=True), self.clock()),
        )

    # -- reads ------------------------------------------------------------------------------
    def q(self, sql: str, *args) -> list[sqlite3.Row]:
        return self.db.execute(sql, args).fetchall()

    def at(self, as_of: float) -> "PointInTime":
        return PointInTime(self, as_of)


@dataclass
class PointInTime:
    """Read-only view of the store as it was known just before ``as_of`` (UTC epoch seconds)."""

    store: Store
    as_of: float

    def _check(self, rows: list[sqlite3.Row], col: str = "available_at") -> list[sqlite3.Row]:
        for r in rows:
            if r[col] is None or r[col] >= self.as_of:
                raise LeakageError(f"row available at {r[col]} is not before {self.as_of}")
        return rows

    def results(self, sport: str, since: float | None = None) -> list[sqlite3.Row]:
        """Finished matches whose result was known before ``as_of``, oldest first."""
        rows = self.store.q(
            """SELECT match_id, competition_id, season, kickoff_utc, home_id, away_id, home_score, away_score,
                      result_available_at AS available_at
                 FROM matches WHERE sport=? AND status='final' AND result_available_at < ? AND kickoff_utc >= ?
                 ORDER BY kickoff_utc, match_id""",
            sport, self.as_of, since if since is not None else -1e18,
        )
        return self._check(rows)

    def odds(self, match_id: str, kind: str | None = None) -> list[sqlite3.Row]:
        """All odds rows (any source) for a canonical match, known before ``as_of``."""
        rows = self.store.q(
            """SELECT o.* FROM odds o JOIN source_matches sm ON sm.mkey = o.match_key
                 LEFT JOIN matches m ON m.match_id = sm.match_id
                WHERE sm.match_id=? AND o.available_at < ? AND (? IS NULL OR o.kind=?)
                  AND (o.kind != 'closing' OR m.kickoff_utc IS NULL OR m.kickoff_utc <= ?)
                ORDER BY o.available_at, o.source, o.bookmaker""",
            match_id, self.as_of, kind, kind, self.as_of,
        )
        return self._check(rows)

    def team_stats(self, match_id: str) -> list[sqlite3.Row]:
        rows = self.store.q(
            """SELECT t.* FROM team_stats t JOIN source_matches sm ON sm.mkey = t.match_key
                WHERE sm.match_id=? AND t.available_at < ? ORDER BY t.source, t.side""",
            match_id, self.as_of,
        )
        return self._check(rows)

    def rating(self, team_id: str, source: str) -> sqlite3.Row | None:
        rows = self.store.q(
            "SELECT * FROM ratings WHERE team_id=? AND source=? AND available_at < ? ORDER BY available_at DESC LIMIT 1",
            team_id, source, self.as_of,
        )
        return self._check(rows)[0] if rows else None
