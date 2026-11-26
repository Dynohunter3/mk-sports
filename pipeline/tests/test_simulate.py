"""Step 11: season simulator, Elo history replay and the proof index."""

import numpy as np

from mkmodel import proof as PR
from mkmodel import simulate as S
from mkmodel.data import M
from mkmodel.elo_history import replay
from mkmodel.features import Elo, EloParams

DAY = 86400.0


def tiny_season(results: dict[tuple[str, str], tuple[int, int]], teams=("A", "B", "C", "D")):
    """A 4-team double round robin with the given (home, away) -> score results played."""
    ms, t = [], 1_700_000_000.0
    for h in teams:
        for a in teams:
            if h == a:
                continue
            t += DAY
            sc = results.get((h, a))
            ms.append(M(f"x/{h}~{a}", "eng.1", "2026-27", t, h, a, sc[0] if sc else None, sc[1] if sc else None,
                        t + 7200 if sc else None, 1.0))
    return ms


def test_league_state_table_and_remaining():
    ms = tiny_season({("A", "B"): (2, 0), ("C", "D"): (1, 1)})
    st = S.league_state(ms, "eng.1", ms[-1].t, 4)
    assert st.problem is None and st.season == "2026-27"
    assert st.table["A"]["pts"] == 3 and st.table["B"]["pts"] == 0 and st.table["C"]["pts"] == 1
    assert st.table["A"]["gf"] == 2 and st.table["B"]["ga"] == 2
    assert len(st.remaining) == 12 - 2 and ("A", "B") not in st.remaining and ("B", "A") in st.remaining
    assert S.league_state(ms, "eng.1", ms[-1].t, 5).problem == "4 teams in the data, 5 expected"


def test_score_grids_keep_model_outcome_probabilities():
    p = np.array([[0.5, 0.3, 0.2], [0.1, 0.2, 0.7]])
    cum = S.score_grids(p, np.array([[1.4, 1.1], [0.9, 2.0]]))
    k = 11
    for i in range(2):
        cell = np.diff(np.r_[0.0, cum[i]])
        hi, ai = np.divmod(np.arange(k * k), k)
        got = [cell[hi > ai].sum(), cell[hi == ai].sum(), cell[hi < ai].sum()]
        assert np.allclose(got, p[i], atol=1e-9)


def test_simulation_certain_results_and_valid_distributions():
    ms = tiny_season({})
    st = S.league_state(ms, "eng.1", ms[0].t - 1, 4)
    st.problem = None
    # the home side always wins: every team ends on 9 points, so places come down to goals and chance
    p = np.tile([1.0, 0.0, 0.0], (len(st.remaining), 1))
    sim = S.simulate_league(st, p, np.full((len(st.remaining), 2), 1.3), 2000, np.random.default_rng(1))
    assert np.allclose(sim["points"], 9)
    assert np.allclose(sim["positions"].sum(0), 1) and np.allclose(sim["positions"].sum(1), 1)
    # A wins everything: champion every time
    p2 = np.array([[1, 0, 0] if h == "A" else [0, 0, 1] if a == "A" else [0.4, 0.3, 0.3] for h, a in st.remaining], float)
    sim2 = S.simulate_league(st, p2, np.full((len(st.remaining), 2), 1.3), 2000, np.random.default_rng(2))
    idx = st.teams.index("A")
    assert sim2["positions"][idx, 0] == 1.0
    z = S.zone_probs(sim2["positions"], [{"key": "title", "from": 1, "to": 1}, {"key": "rel", "from": 4, "to": 4}])
    assert z[idx, 0] == 1.0 and np.isclose(z[:, 0].sum(), 1) and np.isclose(z[:, 1].sum(), 1)


def test_elo_replay_matches_the_model_elo():
    ms = tiny_season({("A", "B"): (3, 0), ("B", "C"): (1, 1), ("C", "A"): (0, 2)})
    ms = [m for m in ms if m.outcome is not None]
    events, cur = replay(ms, ms[-1].t + DAY)
    elo = Elo(EloParams())
    for m in ms:  # results known two hours after kick-off, before the next match
        rh, ra = elo.rating(m.h, m.comp, m.season, m.t, True), elo.rating(m.a, m.comp, m.season, m.t, True)
        elo.update(m, rh, ra, True)
    assert all(abs(cur[t] - elo.r[t]) < 1e-9 for t in elo.r)
    assert len(events) == 2 * len(ms)


def test_proof_index_keeps_first_commit_and_prunes():
    preds = {"matches": [{"match_id": "m1", "made_at": "2026-11-26T08:00:00+00:00", "kickoff": "2026-11-30T15:00:00+00:00"}],
             "recent": []}
    d1 = PR.update({}, preds, "aaa", "2026-11-26T08:05:00+00:00", "1", "o/r")
    assert d1["entries"]["m1@2026-11-26T08:00:00+00:00"]["commit"] == "aaa" and d1["added"] == 1
    preds["matches"].append({"match_id": "m2", "made_at": "2026-11-26T14:00:00+00:00", "kickoff": "2026-12-01T15:00:00+00:00"})
    d2 = PR.update(d1, preds, "bbb", "2026-11-26T14:05:00+00:00", "2", "o/r")
    assert d2["entries"]["m1@2026-11-26T08:00:00+00:00"]["commit"] == "aaa"  # first publication wins
    assert d2["entries"]["m2@2026-11-26T14:00:00+00:00"]["commit"] == "bbb" and d2["added"] == 1
    d3 = PR.update(d2, {"matches": [], "recent": []}, "ccc", "2027-03-01T00:00:00+00:00", None, "o/r")
    assert d3["entries"] == {}  # more than 60 days after kick-off
