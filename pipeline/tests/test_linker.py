"""Internal IDs, cross-source linking, conflict rules and source demotion on a small synthetic league."""

import json

from mkdata.linker import Linker, split_country

DAY = 86400
T0 = 1_756_000_000  # Aug 2025


def row(src, d, h, a, hs=None, as_=None, comp="eng.1", season="2025-26", exact=1, ko_shift=0.0, date_override=None):
    from datetime import datetime, timezone

    k = T0 + d * DAY + ko_shift
    final = hs is not None
    return {"source": src, "source_key": f"{d}:{h}:{a}:{ko_shift}", "competition_id": comp, "season": season,
            "kickoff_utc": k, "kickoff_exact": exact,
            "local_date": date_override or datetime.fromtimestamp(k, timezone.utc).date().isoformat(),
            "home_raw": h, "away_raw": a, "status": "final" if final else "scheduled",
            "home_score": hs, "away_score": as_, "fetched_at": T0 + 300 * DAY, "available_at": k + 9000 if final else T0}


FULL = {"Arsenal": "Arsenal FC", "Man United": "Manchester United FC", "Wolves": "Wolverhampton Wanderers FC", "Spurs": "Tottenham Hotspur FC"}
GAMES = [  # day, home, away, score
    (0, "Arsenal", "Man United", 2, 1), (0, "Wolves", "Spurs", 0, 0), (7, "Man United", "Wolves", 1, 1),
    (7, "Spurs", "Arsenal", 1, 3), (14, "Arsenal", "Wolves", 4, 0), (14, "Spurs", "Man United", 2, 2),
    (21, "Man United", "Arsenal", 0, 2), (21, "Spurs", "Wolves", 3, 1),
]
BASE = list(GAMES)
# two more cycles so every team has 12 games: enough evidence for fixture anchoring
GAMES += [(d + 28 * k, h, a, (hs + k) % 4, (as_ + 2 * k) % 3) for k in (1, 2) for (d, h, a, hs, as_) in BASE]


def league(store, of_overrides=None, fd_overrides=None, games=None):
    of_overrides, fd_overrides = of_overrides or {}, fd_overrides or {}
    rows = []
    for i, (d, h, a, hs, as_) in enumerate(games or GAMES):
        rows.append(of_overrides.get(i, row("openfootball", d, FULL[h], FULL[a], hs, as_)))
        rows.append(fd_overrides.get(i, row("footballdata_uk", d, h, a, hs, as_)))
    store.upsert_source_matches([r for r in rows if r])


def test_every_name_gets_one_id_and_matches_merge(store, ids, comps):
    league(store)
    rep = Linker(store, ids, comps, now=T0 + 400 * DAY).run()
    assert rep.unresolved == 0
    assert rep.canonical == len(GAMES)
    assert store.q("SELECT COUNT(*) n FROM entities WHERE kind='team'")[0]["n"] == 4
    # football-data.co.uk is the naming authority; openfootball's full names are resolved to its IDs
    methods = {r["raw"]: r["method"] for r in store.q("SELECT raw, method FROM aliases WHERE source='openfootball'")}
    assert methods["Arsenal FC"] == "normalised-name"
    assert methods["Tottenham Hotspur FC"] == "fixture-anchored"  # 'Spurs' vs 'Tottenham Hotspur'
    assert methods["Wolverhampton Wanderers FC"] == "fixture-anchored"
    assert store.q("SELECT COUNT(*) n FROM conflicts")[0]["n"] == 0
    assert all(r["agreement"] == 1.0 for r in store.q("SELECT agreement FROM matches"))


def _gunners(games):
    g = lambda t: "The Gunners" if t == "Arsenal" else FULL[t]  # noqa: E731
    return {i: row("openfootball", d, g(h), g(a), hs, as_) for i, (d, h, a, hs, as_) in enumerate(games)}


def test_fixture_anchoring_links_unrelated_names(store, ids, comps):
    """A name with no textual overlap ('Gunners') is linked purely by date + score evidence (12 games)."""
    league(store, of_overrides=_gunners(GAMES))
    Linker(store, ids, comps, now=T0 + 400 * DAY).run()
    al = store.q("SELECT entity_id, method FROM aliases WHERE source='openfootball' AND raw='The Gunners'")
    assert al and al[0]["entity_id"] == "fb-eng-arsenal" and al[0]["method"] == "fixture-anchored"


def test_too_little_evidence_is_not_linked(store, ids, comps):
    """With only 4 games and no name overlap the safety rule refuses to link; the name waits for review."""
    league(store, of_overrides=_gunners(BASE), games=BASE)
    Linker(store, ids, comps, now=T0 + 400 * DAY).run()
    assert "The Gunners" in [r["raw"] for r in store.q("SELECT raw FROM unresolved")]
    assert not store.q("SELECT 1 FROM aliases WHERE raw='The Gunners'")


def test_score_disagreement_is_major_logged_and_alerted(store, ids, comps):
    league(store, of_overrides={0: row("openfootball", 0, "Arsenal FC", "Manchester United FC", 3, 1)})
    Linker(store, ids, comps, now=T0 + 400 * DAY).run()
    c = store.q("SELECT * FROM conflicts WHERE field='score'")[0]
    assert c["severity"] == "major" and c["chosen_source"] == "footballdata_uk"
    assert json.loads(c["candidates"]) == {"footballdata_uk": [2, 1], "openfootball": [3, 1]}
    m = store.q("SELECT home_score, agreement FROM matches WHERE match_id LIKE '%arsenal~fb-eng-manchester-united'")[0]
    assert m["home_score"] == 2 and m["agreement"] == 0.5
    assert store.q("SELECT COUNT(*) n FROM alerts WHERE kind='conflict'")[0]["n"] == 1


def test_kickoff_rules(store, ids, comps):
    league(store, of_overrides={
        1: row("openfootball", 0, "Wolverhampton Wanderers FC", "Tottenham Hotspur FC", 0, 0, ko_shift=3600),  # 1 h off: minor
        2: row("openfootball", 7, "Manchester United FC", "Wolverhampton Wanderers FC", 1, 1, ko_shift=5 * 3600),  # 5 h: major
    })
    Linker(store, ids, comps, now=T0 + 400 * DAY).run()
    sev = {r["match_id"].split("/")[-1]: r["severity"] for r in store.q("SELECT match_id, severity FROM conflicts WHERE field='kickoff'")}
    assert sev == {"fb-eng-wolverhampton~fb-eng-tottenham": "minor",
                   "fb-eng-manchester-united~fb-eng-wolverhampton": "major"}
    # football-data.co.uk outranks openfootball for kick-off times
    k = store.q("SELECT kickoff_utc FROM matches WHERE match_id LIKE '%fb-eng-wolverhampton~fb-eng-tottenham'")[0][0]
    assert k == T0


def test_stale_scheduled_row_is_staleness_not_a_clash(store, ids, comps):
    league(store, of_overrides={3: row("openfootball", 7, "Tottenham Hotspur FC", "Arsenal FC")})  # not updated
    Linker(store, ids, comps, now=T0 + 400 * DAY).run()
    m = store.q("SELECT status, home_score FROM matches WHERE match_id LIKE '%fb-eng-tottenham~fb-eng-arsenal'")[0]
    assert (m["status"], m["home_score"]) == ("final", 1)
    c = store.q("SELECT severity, rule FROM conflicts WHERE field='status'")[0]
    assert c["severity"] == "minor"


def test_postponed_game_merges_with_its_new_date(store, ids, comps):
    # openfootball still lists the original date (never played); football-data has it 40 days later, final
    league(store, of_overrides={7: row("openfootball", 21, "Tottenham Hotspur FC", "Wolverhampton Wanderers FC")},
           fd_overrides={7: row("footballdata_uk", 61, "Spurs", "Wolves", 3, 1)})
    rep = Linker(store, ids, comps, now=T0 + 400 * DAY).run()
    assert rep.canonical == len(GAMES)
    srcs = json.loads(store.q("SELECT sources FROM matches WHERE match_id LIKE '%fb-eng-tottenham~fb-eng-wolverhampton'")[0][0])
    assert srcs == ["footballdata_uk", "openfootball"]


def test_unrecognisable_name_goes_to_review_queue(store, ids, comps):
    league(store)
    store.upsert_source_matches([row("openfootball", 90, "Mystery Town", "Arsenal FC")])  # no finals, no name match
    Linker(store, ids, comps, now=T0 + 400 * DAY).run()
    q = store.q("SELECT raw FROM unresolved")
    assert [r["raw"] for r in q] == ["Mystery Town"]
    assert store.q("SELECT COUNT(*) n FROM entities WHERE name LIKE 'Mystery%'")[0]["n"] == 0


def test_international_clubs_reuse_domestic_ids(store, ids, comps):
    league(store)
    store.upsert_source_matches([row("openfootball", 100, "Arsenal FC (ENG)", "Club Brugge KV (BEL)", 3, 0, comp="uefa.champions")])
    Linker(store, ids, comps, now=T0 + 400 * DAY).run()
    m = store.q("SELECT home_id, away_id FROM matches WHERE competition_id='uefa.champions'")[0]
    assert m["home_id"] == "fb-eng-arsenal" and m["away_id"] == "fb-bel-brugge-kv"
    assert split_country("Celtic FC (SCO)") == ("Celtic FC", "sco")


def test_source_demoted_when_it_keeps_disagreeing(store, ids, comps, monkeypatch):
    import mkdata.linker as L

    monkeypatch.setattr(L, "DEMOTE_MIN", 5)
    bad = {i: row("openfootball", d, FULL[h], FULL[a], hs + 1, as_) for i, (d, h, a, hs, as_) in enumerate(GAMES) if i in (0, 6)}
    league(store, of_overrides=bad)
    rep = Linker(store, ids, comps, now=T0 + 400 * DAY).run()
    q = store.q("SELECT * FROM source_quality WHERE source='openfootball'")[0]
    assert (q["shared_finals"], q["score_disagreements"], q["demoted"]) == (len(GAMES), 2, 1)
    assert rep.demoted and store.q("SELECT COUNT(*) n FROM alerts WHERE kind='source_quality'")[0]["n"] == 1


def test_id_created_from_a_season_the_authority_lacks_is_adopted_not_duplicated(store, ids, comps):
    # 2024-25 League One exists only in football-data.co.uk -> it creates 'Wolves' etc.
    store.upsert_source_matches([row("footballdata_uk", d, h, a, hs, as_, comp="eng.3", season="2024-25")
                                 for d, h, a, hs, as_ in GAMES])
    # 2025-26 League Two: openfootball (the naming authority) uses full names, football-data short ones
    for d, h, a, hs, as_ in GAMES:
        store.upsert_source_matches([row("openfootball", d + 365, FULL[h], FULL[a], hs, as_, comp="eng.4"),
                                     row("footballdata_uk", d + 365, h, a, hs, as_, comp="eng.4")])
    Linker(store, ids, comps, now=T0 + 800 * DAY).run()
    wolves = store.q("SELECT id FROM entities WHERE name LIKE 'Wolv%'")
    assert len(wolves) == 1
    al = store.q("SELECT method FROM aliases WHERE source='openfootball' AND raw='Wolverhampton Wanderers FC'")[0]
    assert al["method"] in ("fixture-anchored", "adopted-provisional")


def test_wrong_early_kickoff_in_one_source_cannot_leak_the_result(store, ids, comps):
    # openfootball says the game started a day earlier (it was moved); its 'available_at' is therefore early
    league(store, of_overrides={4: row("openfootball", 13, "Arsenal FC", "Wolverhampton Wanderers FC", 4, 0)})
    Linker(store, ids, comps, now=T0 + 400 * DAY).run()
    m = store.q("SELECT kickoff_utc, result_available_at FROM matches WHERE match_id LIKE '%fb-eng-arsenal~fb-eng-wolverhampton'")[0]
    assert m["kickoff_utc"] == T0 + 14 * DAY  # football-data.co.uk's time wins
    assert m["result_available_at"] >= m["kickoff_utc"] + 2 * 3600
