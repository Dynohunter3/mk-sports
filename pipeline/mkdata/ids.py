"""One internal ID per competition, team and player, whatever each source calls them.

Resolution order for a raw name from a source:
  1. a stored alias for (source, raw, scope)          -> exact, reviewed or learned earlier
  2. the same normalised name already aliased to one team in this sport/scope (any source)
  3. fixture anchoring (mkdata.linker): the name's matches line up by date and score with a team
     the naming authority already knows
  4. otherwise the name goes to the ``unresolved`` review queue (never silently merged)

IDs and aliases are exported to ``pipeline/registry/*.csv`` and committed, so they stay stable
when the database is rebuilt.
"""

from __future__ import annotations

import csv
import time
from pathlib import Path

from .names import norm_key, similarity, slug
from .store import Store

SPORT_PREFIX = {"football": "fb", "basketball": "bb", "american-football": "af", "hockey": "ih", "baseball": "bs"}


class IdRegistry:
    def __init__(self, store: Store, clock=time.time):
        self.s = store
        self.clock = clock

    # -- entities ---------------------------------------------------------------------------
    def ensure(self, entity_id: str, kind: str, sport: str, name: str, country: str | None, created_by: str) -> str:
        self.s.db.execute(
            "INSERT OR IGNORE INTO entities VALUES (?,?,?,?,?,?,?)",
            (entity_id, kind, sport, name, country, self.clock(), created_by),
        )
        return entity_id

    def new_team(self, name: str, sport: str, country: str | None, created_by: str) -> str:
        base = f"{SPORT_PREFIX[sport]}-{country or 'int'}-{slug(name)}"
        tid, n = base, 2
        while self.s.q("SELECT 1 FROM entities WHERE id=?", tid):
            tid, n = f"{base}-{n}", n + 1
        return self.ensure(tid, "team", sport, name, country, created_by)

    def name(self, entity_id: str) -> str | None:
        r = self.s.q("SELECT name FROM entities WHERE id=?", entity_id)
        return r[0]["name"] if r else None

    # -- aliases ----------------------------------------------------------------------------
    def add_alias(self, source: str, kind: str, raw: str, scope: str, entity_id: str, method: str, evidence: str = "") -> None:
        self.s.db.execute(
            "INSERT OR REPLACE INTO aliases VALUES (?,?,?,?,?,?,?,?)",
            (source, kind, raw, scope, entity_id, method, evidence, self.clock()),
        )
        self.s.db.execute("DELETE FROM unresolved WHERE source=? AND kind=? AND raw=? AND scope=?", (source, kind, raw, scope))

    def resolve(self, source: str, kind: str, raw: str, sport: str, scope: str = "") -> str | None:
        if scope:
            r = self.s.q("SELECT DISTINCT entity_id FROM aliases WHERE source=? AND kind=? AND raw=? AND scope IN (?, '')", source, kind, raw, scope)
        else:  # international competition: an alias from any country counts, if unambiguous
            r = self.s.q("SELECT DISTINCT entity_id FROM aliases WHERE source=? AND kind=? AND raw=?", source, kind, raw)
        if len(r) == 1:
            return r[0]["entity_id"]
        key = norm_key(raw)
        if not key:
            return None
        # same normalised name, any source, same sport and scope -> only if it points at exactly one entity
        hits = {
            a["entity_id"]
            for a in self.s.q(
                """SELECT a.raw, a.entity_id FROM aliases a JOIN entities e ON e.id=a.entity_id
                   WHERE a.kind=? AND e.sport=? AND (a.scope=? OR ?='')""",
                kind, sport, scope, scope,
            )
            if norm_key(a["raw"]) == key
        }
        if len(hits) == 1:
            eid = hits.pop()
            self.add_alias(source, kind, raw, scope, eid, "normalised-name")
            return eid
        return None

    def note_unresolved(self, source: str, kind: str, raw: str, scope: str, best_guess: str | None = None, best_score: float | None = None) -> None:
        now = self.clock()
        self.s.db.execute(
            """INSERT INTO unresolved VALUES (?,?,?,?,?,?,1,?,?)
               ON CONFLICT(source, kind, raw, scope) DO UPDATE SET last_seen=excluded.last_seen, n=n+1,
                 best_guess=excluded.best_guess, best_score=excluded.best_score""",
            (source, kind, raw, scope, now, now, best_guess, best_score),
        )

    def best_name_match(self, raw: str, candidates: list[str]) -> tuple[str | None, float]:
        best, score = None, 0.0
        for eid in candidates:
            s = similarity(raw, self.name(eid) or "")
            if s > score:
                best, score = eid, s
        return best, score

    # -- persistence ------------------------------------------------------------------------
    def dump(self, folder: Path) -> None:
        folder.mkdir(parents=True, exist_ok=True)
        with open(folder / "entities.csv", "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["id", "kind", "sport", "name", "country", "created_by"])
            for r in self.s.q("SELECT id, kind, sport, name, country, created_by FROM entities ORDER BY kind, id"):
                w.writerow(list(r))
        with open(folder / "aliases.csv", "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["source", "kind", "raw", "scope", "entity_id", "method", "evidence"])
            for r in self.s.q("SELECT source, kind, raw, scope, entity_id, method, evidence FROM aliases ORDER BY source, kind, scope, raw"):
                w.writerow(list(r))
        with open(folder / "unresolved.csv", "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["source", "kind", "raw", "scope", "n", "best_guess", "best_score"])
            for r in self.s.q("SELECT source, kind, raw, scope, n, best_guess, best_score FROM unresolved ORDER BY source, scope, raw"):
                w.writerow(list(r))

    def load(self, folder: Path) -> int:
        n = 0
        if (folder / "entities.csv").exists():
            with open(folder / "entities.csv", newline="") as f:
                for r in csv.DictReader(f):
                    self.ensure(r["id"], r["kind"], r["sport"], r["name"], r["country"] or None, r["created_by"])
                    n += 1
        if (folder / "aliases.csv").exists():
            with open(folder / "aliases.csv", newline="") as f:
                for r in csv.DictReader(f):
                    self.add_alias(r["source"], r["kind"], r["raw"], r["scope"], r["entity_id"], r["method"], r["evidence"])
        self.s.db.commit()
        return n
