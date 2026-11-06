"""Turn per-source rows into one canonical match per real match, with internal team IDs.

1. Team names: the naming authority for a competition (first source in AUTHORITY that has rows)
   creates team IDs; every other source must be resolved to them: stored alias -> normalised
   name -> fixture anchoring (same date +-1 day and same final score, opponent consistent) ->
   unique strong name match. Anything left goes to the review queue.
2. Rows for the same pair of teams within +-1 day become one canonical match. A source's stale
   'scheduled' row for a game it later reports final on another date is dropped as superseded.
3. Fields are decided by mkdata.resolve; every disagreement goes to the conflicts table.
"""

from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta

from .ids import IdRegistry
from .names import similarity, tokens
from .resolve import pick_kickoff, pick_score, pick_status
from .store import Store
from .timeutil import result_available_at

DEMOTE_RATE = 0.02  # a source that disagrees with the chosen score on >2% of shared finals is demoted there
DEMOTE_MIN = 30
AUTHORITY = ["openfootball", "football_data_org", "footballdata_uk", "balldontlie", "the_odds_api"]
_CC = re.compile(r"^(.*\S)\s*\(([A-Z]{3})\)$")
FIFA_TO_SCOPE = {"ENG": "eng", "ESP": "esp", "ITA": "ita", "GER": "ger", "FRA": "fra", "NED": "ned", "POR": "por", "TUR": "tur", "USA": "usa"}


def split_country(raw: str) -> tuple[str, str | None]:
    """'Arsenal FC (ENG)' -> ('Arsenal FC', 'eng'): international competitions tag clubs with a country code."""
    m = _CC.match(raw)
    if not m:
        return raw, None
    return m.group(1), FIFA_TO_SCOPE.get(m.group(2), m.group(2).lower())


@dataclass
class LinkReport:
    per_comp: dict = field(default_factory=dict)
    conflicts: Counter = field(default_factory=Counter)
    unresolved: int = 0
    canonical: int = 0
    demoted: list = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"canonical_matches": self.canonical, "unresolved_names": self.unresolved, "demoted_sources": self.demoted,
                "conflicts": {f"{k[0]}:{k[1]}": v for k, v in sorted(self.conflicts.items())}, "per_competition": self.per_comp}


def _d(s: str) -> date:
    return date.fromisoformat(s)


class Linker:
    def __init__(self, store: Store, ids: IdRegistry, comps: dict[str, dict], now: float):
        self.s, self.ids, self.comps, self.now = store, ids, comps, now

    # -- 1. names ---------------------------------------------------------------------------
    def resolve_names(self, comp_id: str) -> dict[str, dict[str, str]]:
        comp = self.comps[comp_id]
        sport, scope = comp["sport"], comp.get("country") or ""
        rows = [dict(r) for r in self.s.q("SELECT * FROM source_matches WHERE competition_id=?", comp_id)]
        by_src: dict[str, list[dict]] = defaultdict(list)
        for r in rows:
            by_src[r["source"]].append(r)
        order = [s for s in AUTHORITY if s in by_src] + sorted(s for s in by_src if s not in AUTHORITY)
        resolved: dict[str, dict[str, str]] = {}
        if not order:
            return resolved
        creator = order[0]
        creator_seasons = {r["season"] for r in by_src[creator]}
        for src in order:
            names = sorted({r["home_raw"] for r in by_src[src]} | {r["away_raw"] for r in by_src[src]})
            m: dict[str, str] = {}
            for raw in names:
                eid = self.ids.resolve(src, "team", raw, sport, scope)
                if not eid and not scope:
                    base, cc = split_country(raw)
                    if cc:
                        eid = self.ids.resolve(src, "team", base, sport, cc)
                        if eid:
                            self.ids.add_alias(src, "team", raw, scope, eid, "country-suffix", f"{base} in {cc}")
                if eid:
                    m[raw] = eid
            if src == creator:
                # before creating IDs, let fixtures prove a name is a team another source already knows
                # (e.g. 'Cheltenham Town' here vs 'Cheltenham' created earlier from a season this source lacks)
                for other in order[1:]:
                    omap = {}
                    for raw in {r["home_raw"] for r in by_src[other]} | {r["away_raw"] for r in by_src[other]}:
                        eid = self.ids.resolve(other, "team", raw, sport, scope)
                        if eid:
                            omap[raw] = eid
                    known = {r["home_raw"] for r in by_src[src]} | {r["away_raw"] for r in by_src[src]}
                    if omap and any(raw not in m for raw in known):
                        self._anchor(src, by_src[src], by_src[other], omap, m, comp_id, scope, sport, name_fallback=False)
                self._adopt_provisional(src, by_src, order, m, names, sport, scope)
                for raw in names:
                    if raw not in m:
                        base, cc = split_country(raw) if not scope else (raw, None)
                        m[raw] = self.ids.new_team(base, sport, scope or cc, created_by=src)
                        self.ids.add_alias(src, "team", raw, scope, m[raw], "created")
            else:
                self._anchor(src, by_src[src], by_src[creator], resolved[creator], m, comp_id, scope, sport)
                for raw in names:
                    if raw in m:
                        continue
                    seasons = {r["season"] for r in by_src[src] if raw in (r["home_raw"], r["away_raw"])}
                    if not seasons & creator_seasons:
                        # the authority has no data where this team plays -> safe to create
                        m[raw] = self.ids.new_team(raw, sport, scope or None, created_by=src)
                        self.ids.add_alias(src, "team", raw, scope, m[raw], "created", "no authority data for its seasons")
            resolved[src] = m
            for raw in names:
                if raw not in m:
                    guess, sc = self.ids.best_name_match(raw, sorted(set(resolved[creator].values())))
                    self.ids.note_unresolved(src, "team", raw, scope, guess, round(sc, 3))
        self.s.db.commit()
        return resolved

    def _adopt_provisional(self, src, by_src, order, m, names, sport, scope) -> None:
        """A team ID created earlier by a non-authority source (from a season the authority lacks) is
        adopted when its name is a token subset/superset of ours ('Cheltenham' / 'Cheltenham Town'), it is
        the only such candidate, and at least 3 games line up by date (+-1 day), side and final score."""
        prov = [r for r in self.s.q("SELECT id, name FROM entities WHERE kind='team' AND sport=? AND country IS ? AND created_by != ?",
                                    sport, scope or None, src)]
        if not prov:
            return
        mine = by_src[src]
        for raw in names:
            if raw in m:
                continue
            t = set(tokens(raw))
            cands = [p for p in prov if p["id"] not in m.values() and (set(tokens(p["name"])) <= t or t <= set(tokens(p["name"]))) and tokens(p["name"])]
            if len(cands) != 1:
                continue
            cand = cands[0]["id"]
            mine_games = {(r["local_date"], r["home_raw"] == raw, r["home_score"], r["away_score"]) for r in mine
                          if r["status"] == "final" and raw in (r["home_raw"], r["away_raw"])}
            hits = 0
            for other in order[1:]:
                for r in by_src[other]:
                    if r["status"] != "final":
                        continue
                    side = self.ids.resolve(other, "team", r["home_raw"], sport, scope) == cand
                    if not side and self.ids.resolve(other, "team", r["away_raw"], sport, scope) != cand:
                        continue
                    d0 = _d(r["local_date"])
                    if any(((d0 + timedelta(days=k)).isoformat(), side, r["home_score"], r["away_score"]) in mine_games for k in (-1, 0, 1)):
                        hits += 1
            if hits >= 3:
                m[raw] = cand
                self.ids.add_alias(src, "team", raw, scope, cand, "adopted-provisional", f"{hits} games agree by date, side and score")

    def _anchor(self, src, mine, auth_rows, auth_map, m, comp_id, scope, sport, name_fallback=True) -> None:
        by_day: dict[date, list[dict]] = defaultdict(list)
        for r in auth_rows:
            if r["status"] == "final" and r["home_raw"] in auth_map and r["away_raw"] in auth_map:
                by_day[_d(r["local_date"])].append(r)
        finals = [r for r in mine if r["status"] == "final"]
        for _round in range(4):
            progress = False
            claimed = set(m.values())
            for raw in sorted({r["home_raw"] for r in mine} | {r["away_raw"] for r in mine}):
                if raw in m:
                    continue
                votes: Counter = Counter()
                games = [r for r in finals if raw in (r["home_raw"], r["away_raw"])]
                for r in games:
                    home_side = r["home_raw"] == raw
                    opp = m.get(r["away_raw"] if home_side else r["home_raw"])
                    d0 = _d(r["local_date"])
                    for dd in (d0 - timedelta(days=1), d0, d0 + timedelta(days=1)):
                        for c in by_day.get(dd, []):
                            if (c["home_score"], c["away_score"]) != (r["home_score"], r["away_score"]):
                                continue
                            cand = auth_map[c["home_raw"] if home_side else c["away_raw"]]
                            other = auth_map[c["away_raw"] if home_side else c["home_raw"]]
                            if opp is not None and other != opp:
                                continue
                            votes[cand] += 1.0 if opp else 0.5
                if not votes:
                    continue
                (best, v1), *rest = votes.most_common(2)
                v2 = rest[0][1] if rest else 0.0
                sim = similarity(raw, self.ids.name(best) or "")
                # only games on days the authority has results for can line up (it may be stale or partial)
                overlap = sum(1 for r in games if any(by_day.get(_d(r["local_date"]) + timedelta(days=k)) for k in (-1, 0, 1)))
                if v1 >= max(3.0, 0.4 * overlap) and v1 >= 2 * v2 and (sim >= 0.2 or v1 >= 8) and best not in claimed:
                    m[raw] = best
                    claimed.add(best)
                    self.ids.add_alias(src, "team", raw, scope, best, "fixture-anchored",
                                       f"votes={v1:g} of {len(games)} finals, runner-up={v2:g}, name_sim={sim:.2f}")
                    progress = True
            if not progress:
                break
        if not name_fallback:
            return
        # names with no finished games yet (new season, promoted team): unique strong name match only
        team_ids = sorted(set(auth_map.values()) - set(m.values()))
        for raw in sorted({r["home_raw"] for r in mine} | {r["away_raw"] for r in mine}):
            if raw in m:
                continue
            scored = sorted(((similarity(raw, self.ids.name(t) or ""), t) for t in team_ids), reverse=True)
            if scored and scored[0][0] >= 0.75 and (len(scored) == 1 or scored[1][0] < 0.5):
                m[raw] = scored[0][1]
                self.ids.add_alias(src, "team", raw, scope, scored[0][1], "name-similarity", f"sim={scored[0][0]:.2f}")

    # -- 2+3. canonical matches -------------------------------------------------------------
    def build(self, comp_id: str, resolved: dict[str, dict[str, str]], report: LinkReport) -> None:
        comp = self.comps[comp_id]
        # rebuilt from scratch every run (IDs are deterministic, so they come back the same)
        self.s.db.execute("DELETE FROM conflicts WHERE match_id IN (SELECT match_id FROM matches WHERE competition_id=?)", (comp_id,))
        self.s.db.execute("DELETE FROM matches WHERE competition_id=?", (comp_id,))
        rows = []
        for r in self.s.q("SELECT * FROM source_matches WHERE competition_id=?", comp_id):
            r = dict(r)
            m = resolved.get(r["source"], {})
            r["home_id"], r["away_id"] = m.get(r["home_raw"]), m.get(r["away_raw"])
            rows.append(r)
        ok = [r for r in rows if r["home_id"] and r["away_id"]]
        # A source's past 'scheduled' row is superseded (the game was moved) when no other source has that
        # pairing within +-1 day of it and the same source reports the pairing final within 120 days.
        finals, seen = defaultdict(list), defaultdict(list)
        for r in ok:
            pair = (r["season"], r["home_id"], r["away_id"])
            seen[pair].append((r["source"], _d(r["local_date"])))
            if r["status"] == "final":
                finals[(r["source"], *pair)].append(_d(r["local_date"]))
        live = []
        for r in ok:
            if r["status"] != "final" and r["kickoff_utc"] < self.now - 6 * 3600:
                pair, d0 = (r["season"], r["home_id"], r["away_id"]), _d(r["local_date"])
                confirmed = any(src != r["source"] and abs((d - d0).days) <= 1 for src, d in seen[pair])
                moved = any(abs((d - d0).days) <= 120 for d in finals.get((r["source"], *pair), []))
                if moved and not confirmed:
                    continue
            live.append(r)
        groups: dict[tuple, list[list[dict]]] = defaultdict(list)
        for r in sorted(live, key=lambda r: (r["local_date"], AUTHORITY.index(r["source"]) if r["source"] in AUTHORITY else 99)):
            key = (r["season"], r["home_id"], r["away_id"])
            for cl in groups[key]:
                if r["source"] not in {x["source"] for x in cl} and abs((_d(cl[0]["local_date"]) - _d(r["local_date"])).days) <= 1:
                    cl.append(r)
                    break
            else:
                groups[key].append([r])
        # merge a past, never-finished cluster into a finished one of the same pairing when their sources do not overlap
        for key, cls in groups.items():
            if len(cls) < 2:
                continue
            done = [c for c in cls if any(x["status"] == "final" for x in c)]
            for c in [c for c in cls if c not in done]:
                if c[0]["kickoff_utc"] >= self.now:
                    continue
                for f in done:
                    if not ({x["source"] for x in c} & {x["source"] for x in f}) and abs((_d(c[0]["local_date"]) - _d(f[0]["local_date"])).days) <= 120:
                        f.extend(c)
                        cls.remove(c)
                        break
        stats = Counter()
        for (season, h, a), cls in groups.items():
            cls.sort(key=lambda c: min(x["local_date"] for x in c))
            for i, cl in enumerate(cls):
                mid = f"{comp_id}/{season}/{h}~{a}" + (f"#{i + 1}" if i else "")
                self._write(mid, comp, comp_id, season, h, a, cl, report)
                stats["canonical"] += 1
                stats[f"sources={len({x['source'] for x in cl})}"] += 1
        per_src = Counter(r["source"] for r in rows)
        per_src_ok = Counter(r["source"] for r in ok)
        report.per_comp[comp_id] = {
            "rows": dict(per_src), "rows_with_both_teams_resolved": dict(per_src_ok), **dict(stats),
        }
        report.canonical += stats["canonical"]

    def _write(self, mid, comp, comp_id, season, h, a, cl, report) -> None:
        st, ko, sc = pick_status(cl), pick_kickoff(cl), pick_score(cl)
        for dec in (st, ko, sc):
            if dec and dec.severity:
                self.s.log_conflict(mid, dec.field, dec.severity, dec.rule, dec.source, dec.value, dec.candidates)
                report.conflicts[(dec.field, dec.severity)] += 1
                if dec.severity == "major" and dec.field == "score":
                    self.s.raise_alert("conflict", mid, "warning", f"sources disagree on the score: {dec.candidates}")
        if sc and len(sc.candidates) >= 2:
            for src, v in sc.candidates.items():
                q = self.quality[(src, comp_id, season)]
                q[0] += 1
                q[1] += v != sc.value
        if ko.severity:
            for x in cl:
                if x["kickoff_exact"] and abs(x["kickoff_utc"] - ko.value) > 15 * 60:
                    self.quality[(x["source"], comp_id, season)][2] += 1
        final = st.value == "final" and sc is not None
        avail = min((x["available_at"] for x in cl if x["status"] == "final" and sc and [x["home_score"], x["away_score"]] == sc.value), default=None)
        if avail is not None:
            # never earlier than the chosen kick-off + match length: a source with a wrong (earlier) kick-off
            # must not make the result look known before the game was played
            exact = any(x["kickoff_exact"] and x["kickoff_utc"] == ko.value for x in cl)
            avail = max(avail, result_available_at(ko.value, exact, comp["sport"]))
        if final and sc:
            agree = sum(1 for v in sc.candidates.values() if v == sc.value) / len(sc.candidates)
        else:
            agree = 1.0 if not ko.severity else 0.5
        self.s.db.execute(
            "INSERT OR REPLACE INTO matches VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (mid, comp["sport"], comp_id, season, ko.value, h, a, st.value,
             sc.value[0] if final else None, sc.value[1] if final else None, avail if final else None,
             json.dumps(sorted({x["source"] for x in cl})), agree, self.now),
        )
        for x in cl:
            self.s.db.execute("UPDATE source_matches SET match_id=?, home_id=?, away_id=? WHERE source=? AND source_key=?",
                              (mid, h, a, x["source"], x["source_key"]))

    def _apply_quality(self, report: LinkReport) -> None:
        self.s.db.execute("DELETE FROM source_quality")
        demoted = []
        for (src, comp, season), (n, bad, ko_bad) in sorted(self.quality.items()):
            dem = n >= DEMOTE_MIN and bad / n > DEMOTE_RATE
            self.s.db.execute("INSERT INTO source_quality VALUES (?,?,?,?,?,?,?,?)", (src, comp, season, n, bad, ko_bad, int(dem), self.now))
            if dem:
                demoted.append((src, comp, season, n, bad))
                self.s.raise_alert("source_quality", f"{src}:{comp}/{season}", "warning",
                                   f"disagrees with the chosen score on {bad} of {n} shared finals; demoted for this competition-season")
                # matches only this source reports, in that competition-season, get zero agreement (low confidence)
                self.s.db.execute(
                    "UPDATE matches SET agreement=0 WHERE competition_id=? AND season=? AND sources=?",
                    (comp, season, json.dumps([src])),
                )
        report.demoted = [f"{s}:{c}/{y} ({b}/{n})" for s, c, y, n, b in demoted]

    def run(self, comp_ids: list[str] | None = None) -> LinkReport:
        report = LinkReport()
        self.quality = defaultdict(lambda: [0, 0, 0])
        present = [r["competition_id"] for r in self.s.q("SELECT DISTINCT competition_id FROM source_matches")]
        # domestic leagues first so international competitions can reuse their team IDs
        todo = sorted((c for c in present if (comp_ids is None or c in comp_ids) and c in self.comps),
                      key=lambda c: (self.comps[c].get("country") is None, c))
        for comp_id in todo:
            resolved = self.resolve_names(comp_id)
            self.build(comp_id, resolved, report)
        self._apply_quality(report)
        self.s.db.commit()
        report.unresolved = self.s.q("SELECT COUNT(*) n FROM unresolved")[0]["n"]
        return report
