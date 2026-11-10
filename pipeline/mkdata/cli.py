"""Command line for the scheduled data job.

    python -m mkdata sync [--comps eng.1,esp.1] [--seasons 2024-25,2025-26]   # history + current season
    python -m mkdata upcoming                                                   # next fixtures + current odds
    python -m mkdata link                                                       # IDs, canonical matches, conflicts
    python -m mkdata elo                                                        # our own ratings
    python -m mkdata crosscheck --out ../audit/results/step2_crosscheck.json    # measured source agreement
    python -m mkdata snapshot                                                   # versioned data snapshot
    python -m mkdata health [--status var/status.json]                          # alerts; exit 2 on critical
    python -m mkdata registry-doc                                               # docs/SOURCE_REGISTRY.md
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import statistics
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from . import monitor, ratings, validate
from .adapters import ADAPTERS, load_competitions
from .fallback import run_chain
from .http import HttpClient
from .ids import IdRegistry
from .linker import Linker
from .resolve import consensus_odds
from .sources import REGISTRY, RESULTS
from .store import Store
from .timeutil import season_of

ROOT = Path(__file__).resolve().parents[1]
VAR = ROOT / "var"
REGISTRY_DIR = ROOT / "registry"
DEFAULT_SEASONS = {"split": ["2023-24", "2024-25", "2025-26", "2026-27"], "calendar": ["2023", "2024", "2025", "2026"]}
# everything the models train on (Step 3 backfilled from 2019-20)
BACKFILL_SEASONS = {"split": [f"{y}-{str(y + 1)[2:]}" for y in range(2014, 2023)] + DEFAULT_SEASONS["split"],
                    "calendar": [str(y) for y in range(2015, 2023)] + DEFAULT_SEASONS["calendar"]}
RESULT_SOURCES = ["football_data_org", "footballdata_uk", "openfootball", "balldontlie"]
ODDS_SOURCES = ["the_odds_api", "footballdata_uk"]
log = logging.getLogger("mkdata")


def _ctx(args):
    store = Store(args.db)
    ids = IdRegistry(store)
    ids.load(REGISTRY_DIR)
    http = HttpClient(cache_dir=VAR / "cache")
    comps = load_competitions()
    return store, ids, http, comps


def _write(store: Store, res, comps: dict) -> None:
    good, bad = validate.split(res.data.matches, comps)
    for (src, comp, season, why), n in bad.items():
        store.raise_alert("data_quality", f"{src}:{comp}/{season}", "warning", f"{n} rows quarantined: {why}")
        log.warning("quarantined %d %s rows for %s/%s: %s", n, src, comp, season, why)
        keys = [r["source_key"] for r in res.data.matches if r["source"] == src and r["competition_id"] == comp
                and r["season"] == season and validate.problems(r, comps) == why]
        store.db.executemany("DELETE FROM source_matches WHERE source=? AND source_key=?", [(src, k) for k in keys])
    store.upsert_source_matches(good)
    store.add_odds(res.data.odds)
    store.add_team_stats(res.data.stats)


def cmd_sync(args) -> int:
    store, ids, http, comps = _ctx(args)
    adapters = [ADAPTERS[n](http, comps) for n in RESULT_SOURCES]
    want = args.comps.split(",") if args.comps else list(comps)
    summary = {}
    for comp_id in want:
        style = comps[comp_id]["seasons"]
        if args.current:
            seasons = [season_of(datetime.now(timezone.utc).date(), style)]
        elif args.backfill:
            seasons = BACKFILL_SEASONS[style]
        else:
            seasons = args.seasons.split(",") if args.seasons else DEFAULT_SEASONS[style]
        cover = [a for a in adapters if a.covers(comp_id)]
        for season in seasons:
            res = run_chain(store, RESULTS, f"{comp_id}/{season}", cover, lambda a: a.fetch_season(comp_id, season), mode="collect_all")
            _write(store, res, comps)
            summary[f"{comp_id}/{season}"] = {"used": res.used, "failed": res.failed, "rows": len(res.data.matches)}
            log.info("%s %s used=%s failed=%s rows=%d", comp_id, season, res.used, list(res.failed), len(res.data.matches))
    print(json.dumps(summary, indent=1))
    return 0


def cmd_upcoming(args) -> int:
    store, ids, http, comps = _ctx(args)
    football = [c for c, v in comps.items() if v["sport"] == "football"]
    adapters = [ADAPTERS[n](http, comps) for n in ODDS_SOURCES]
    # an empty list is normal between rounds (the source has not published the next fixtures yet): not a failure
    res = run_chain(store, "odds_current", "football", adapters, lambda a: a.fetch_upcoming(football), mode="first_success",
                    validate=lambda r: None)
    _write(store, res, comps)
    print(json.dumps({"used": res.used, "failed": res.failed, "skipped": res.skipped, "degraded": res.degraded,
                      "matches": len(res.data.matches), "odds_rows": len(res.data.odds)}, indent=1))
    return 0


def cmd_link(args) -> int:
    store, ids, http, comps = _ctx(args)
    rep = Linker(store, ids, comps, time.time()).run(args.comps.split(",") if args.comps else None)
    ids.dump(REGISTRY_DIR)
    print(json.dumps(rep.as_dict(), indent=1))
    return 0


def cmd_elo(args) -> int:
    store, *_ = _ctx(args)
    for sport in ("football", "basketball"):
        print(sport, ratings.compute(store, sport, time.time()))
    return 0


def cmd_crosscheck(args) -> int:
    store, *_ = _ctx(args)
    out: dict = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "competitions": {}}
    rows = store.q("SELECT * FROM source_matches WHERE match_id IS NOT NULL")
    by_mid: dict[str, list] = defaultdict(list)
    for r in rows:
        by_mid[r["match_id"]].append(r)
    comps = sorted({r["competition_id"] for r in rows})
    for c in comps:
        mids = [m for m, rs in by_mid.items() if rs[0]["competition_id"] == c]
        multi = [by_mid[m] for m in mids if len({r["source"] for r in by_mid[m]}) >= 2]
        both_final = [rs for rs in multi if sum(r["status"] == "final" for r in rs) >= 2]
        score_agree = sum(len({(r["home_score"], r["away_score"]) for r in rs if r["status"] == "final"}) == 1 for rs in both_final)
        dk = [abs(max(r["kickoff_utc"] for r in rs if r["kickoff_exact"]) - min(r["kickoff_utc"] for r in rs if r["kickoff_exact"])) / 60
              for rs in multi if sum(r["kickoff_exact"] for r in rs) >= 2]
        same_date = sum(len({r["local_date"] for r in rs}) == 1 for rs in multi)
        per_source = Counter(r["source"] for m in mids for r in by_mid[m])
        single = Counter(by_mid[m][0]["source"] for m in mids if len(by_mid[m]) == 1)
        out["competitions"][c] = {
            "canonical_matches": len(mids), "rows_per_source": dict(per_source), "in_one_source_only": dict(single),
            "in_two_or_more_sources": len(multi), "both_final": len(both_final),
            "score_agreement": round(score_agree / len(both_final), 5) if both_final else None,
            "score_disagreements": len(both_final) - score_agree,
            "kickoff_pairs_exact": len(dk), "kickoff_within_15min": round(sum(x <= 15 for x in dk) / len(dk), 4) if dk else None,
            "kickoff_median_abs_diff_min": statistics.median(dk) if dk else None,
            "same_local_date": round(same_date / len(multi), 4) if multi else None,
        }
    # freshness: matches that kicked off over 3 days ago and are final in the canonical table, but
    # still unplayed in a given source (that source is behind)
    cutoff = time.time() - 3 * 86400
    lag: dict = defaultdict(lambda: [0, 0])
    for r in store.q("""SELECT sm.source, sm.competition_id, sm.season, sm.status FROM source_matches sm JOIN matches m USING (match_id)
                        WHERE m.status='final' AND m.kickoff_utc < ?""", cutoff):
        k = f"{r['source']}:{r['competition_id']}/{r['season']}"
        lag[k][0] += 1
        lag[k][1] += r["status"] != "final"
    out["missing_results_in_source"] = {k: {"rows": n, "not_final": b, "share": round(b / n, 4)} for k, (n, b) in sorted(lag.items()) if b}
    out["source_quality"] = [dict(r) for r in store.q("SELECT source, competition_id, season, shared_finals, score_disagreements, kickoff_disagreements, demoted FROM source_quality WHERE score_disagreements>0 OR kickoff_disagreements>0 OR demoted=1")]
    out["quarantined"] = [dict(r) for r in store.q("SELECT subject, message FROM alerts WHERE kind='data_quality'")]
    # odds: Pinnacle closing vs market-average closing, same match
    spreads = []
    for (mid,) in store.q("SELECT DISTINCT sm.match_id FROM odds o JOIN source_matches sm ON sm.mkey=o.match_key WHERE o.kind='closing' AND sm.match_id IS NOT NULL"):
        orows = [dict(r) for r in store.q("SELECT o.* FROM odds o JOIN source_matches sm ON sm.mkey=o.match_key WHERE sm.match_id=? AND o.kind='closing' AND o.bookmaker IN ('pinnacle','market_avg','bet365')", mid)]
        if len({r["bookmaker"] for r in orows}) >= 2:
            spreads.append(consensus_odds(orows)[3])
    if spreads:
        spreads.sort()
        out["closing_odds_spread_p_home"] = {"matches": len(spreads), "median": round(statistics.median(spreads), 4),
                                             "p90": round(spreads[int(0.9 * len(spreads))], 4),
                                             "share_over_8pts": round(sum(s > 0.08 for s in spreads) / len(spreads), 5)}
    out["conflicts"] = {f"{r['field']}:{r['severity']}": r["n"] for r in store.q("SELECT field, severity, COUNT(*) n FROM conflicts GROUP BY field, severity")}
    out["aliases_by_method"] = {f"{r['source']}:{r['method']}": r["n"] for r in store.q("SELECT source, method, COUNT(*) n FROM aliases GROUP BY source, method")}
    out["unresolved"] = [dict(r) for r in store.q("SELECT source, raw, scope, n, best_guess, best_score FROM unresolved ORDER BY source, raw")]
    out["teams"] = store.q("SELECT COUNT(*) n FROM entities WHERE kind='team'")[0]["n"]
    text = json.dumps(out, indent=1, sort_keys=True)
    if args.out:
        Path(args.out).write_text(text + "\n")
    print(text)
    return 0


def cmd_snapshot(args) -> int:
    store, *_ = _ctx(args)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    folder = VAR / "snapshots" / stamp
    folder.mkdir(parents=True, exist_ok=True)
    tables = {
        "entities": "SELECT * FROM entities ORDER BY id",
        "matches": "SELECT * FROM matches ORDER BY kickoff_utc, match_id",
        "odds": "SELECT sm.match_id, o.source, o.bookmaker, o.kind, o.home, o.draw, o.away, o.available_at FROM odds o JOIN source_matches sm ON sm.mkey=o.match_key WHERE sm.match_id IS NOT NULL ORDER BY sm.match_id, o.source, o.bookmaker, o.kind, o.available_at",
        "team_stats": "SELECT sm.match_id, t.side, t.source, t.stats, t.available_at FROM team_stats t JOIN source_matches sm ON sm.mkey=t.match_key WHERE sm.match_id IS NOT NULL ORDER BY sm.match_id, t.side, t.source",
        "ratings": "SELECT team_id, source, as_of, value, available_at FROM ratings ORDER BY team_id, source, as_of",
    }
    manifest = {"created_at": stamp, "files": {}}
    for name, sql in tables.items():
        drop = {"resolved_at"}  # run-time bookkeeping, not data
        lines = [json.dumps({k: r[k] for k in r.keys() if k not in drop}, sort_keys=True) for r in store.q(sql)]
        body = ("\n".join(lines) + "\n").encode()
        (folder / f"{name}.jsonl").write_bytes(body)
        manifest["files"][name] = {"rows": len(lines), "sha256": hashlib.sha256(body).hexdigest()}
    manifest["data_version"] = hashlib.sha256(json.dumps(manifest["files"], sort_keys=True).encode()).hexdigest()[:16]
    (folder / "manifest.json").write_text(json.dumps(manifest, indent=1))
    print(json.dumps(manifest, indent=1))
    return 0


def cmd_health(args) -> int:
    store, *_ = _ctx(args)
    baselines = {k: v for k, v in json.loads(Path(args.baselines).read_text()).items() if not k.startswith("_")} if args.baselines else {}
    rep = monitor.check(store, time.time(), baselines)
    if args.status:
        Path(args.status).parent.mkdir(parents=True, exist_ok=True)
        Path(args.status).write_text(json.dumps(rep, indent=1))
    for a in rep["alerts"]:
        print(f"[{a['severity']}] {a['kind']} {a['subject']}: {a['message']}")
    try:
        monitor.notify(rep)
    except OSError as e:
        print(f"[warning] alert webhook failed: {type(e).__name__}")
    return 0 if rep["ok"] else 2


def cmd_registry_doc(args) -> int:
    from .registry_doc import render

    path = ROOT.parent / "docs" / "SOURCE_REGISTRY.md"
    path.write_text(render(REGISTRY, args.crosscheck))
    print(path)
    return 0


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    p = argparse.ArgumentParser(prog="mkdata")
    p.add_argument("--db", default=str(VAR / "mkdata.sqlite"))
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("sync")
    s.add_argument("--comps")
    s.add_argument("--seasons")
    s.add_argument("--current", action="store_true", help="only each competition's current season (daily job)")
    s.add_argument("--backfill", action="store_true", help="every season the models use (first run on a new machine)")
    sub.add_parser("upcoming")
    s = sub.add_parser("link")
    s.add_argument("--comps")
    sub.add_parser("elo")
    s = sub.add_parser("crosscheck")
    s.add_argument("--out")
    sub.add_parser("snapshot")
    s = sub.add_parser("health")
    s.add_argument("--status")
    s.add_argument("--baselines")
    s = sub.add_parser("registry-doc")
    s.add_argument("--crosscheck")
    args = p.parse_args(argv)
    return {"sync": cmd_sync, "upcoming": cmd_upcoming, "link": cmd_link, "elo": cmd_elo, "crosscheck": cmd_crosscheck,
            "snapshot": cmd_snapshot, "health": cmd_health, "registry-doc": cmd_registry_doc}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
