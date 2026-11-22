"""Market-history ratings (Step 8): learn team strength from past odds, never from the match being predicted."""

import math

import numpy as np

from mkmodel.data import DAY, M
from mkmodel.features import FEATURES, Config, EloParams, MarketRatings, build

STRENGTH = {"A": 0.8, "B": 0.3, "C": -0.2, "D": -0.9}


def odds(h: str, a: str) -> tuple:
    s = STRENGTH[h] - STRENGTH[a] + 0.4
    ph, pa = 0.72 / (1 + math.exp(-s)), 0.72 / (1 + math.exp(s))
    return (ph, 0.28, pa)


def league(n_rounds: int = 8) -> list[M]:
    teams, out, t = list(STRENGTH), [], 1.6e9
    for r in range(n_rounds):
        for i, h in enumerate(teams):
            for a in teams[i + 1:]:
                hh, aa = (h, a) if r % 2 == 0 else (a, h)
                out.append(M(f"m{len(out)}", "eng.1", "2020-21", t, hh, aa, 1, 0, t + 2 * 3600, 1.0, close=odds(hh, aa)))
                t += DAY
    return out


def test_ratings_recover_the_market_order():
    mr = MarketRatings()
    for m in league():
        mr.update(m.comp, m.h, m.a, m.close)
    r = {t: mr.r[("eng.1", t)] for t in STRENGTH}
    assert sorted(r, key=r.get) == sorted(STRENGTH, key=STRENGTH.get)
    f = mr.features("eng.1", "A", "D")
    assert abs(f["mr_diff"] - math.log(odds("A", "D")[0] / odds("A", "D")[2])) < 0.3
    assert mr.features("eng.1", "A", "unknown team") == {}


def test_a_matchs_own_odds_never_reach_its_features():
    ms = league()
    X1, o1 = build(ms, Config(elo=EloParams()))
    i = len(ms) - 1
    ms[i].close = (0.05, 0.05, 0.90)  # absurd odds for the last match: its own features must not move
    X2, _ = build(ms, Config(elo=EloParams()))
    c = [FEATURES.index(f) for f in ("mr_diff", "mr_h", "mr_a", "mr_draw")]
    assert np.isfinite(X1[i, c]).all()
    np.testing.assert_array_equal(X1[i, c], X2[i, c])
    # and odds are used only after the result was published: a match whose result comes later than the
    # next kick-off does not inform it
    late = []
    for bad in (False, True):
        ms = league()
        ms[i - 1].result_at = ms[i].t + 3600
        if bad:
            ms[i - 1].close = (0.05, 0.05, 0.90)
        late.append(build(ms, Config(elo=EloParams()))[0][i, c])
    np.testing.assert_array_equal(late[0], late[1])


def test_production_routing_uses_market_history_only_where_it_was_better():
    from mkmodel import production as pr

    n = 5

    def probs(h, d, a):
        return np.tile([h, d, a], (n, 1)).astype(float)

    P = {"elo": probs(.4, .3, .3), "dc": probs(.4, .3, .3), "dcx": probs(.4, .3, .3), "gbm_nomkt": probs(.4, .3, .3),
         "gbm_mkt": probs(.6, .2, .2), "gbm_mh": probs(.2, .3, .5), "mh": probs(.2, .3, .5), "market": probs(.6, .2, .2)}
    P["market"][1:] = np.nan  # row 0 has odds
    P["mh"][4] = np.nan  # row 4: a team without market history
    comps = ["eng.1", "eng.1", "usa.1", "uefa.champions", "eng.1"]

    def copy_last(k):  # blend weights that copy the last input
        return [-30.0] * (k - 1) + [0.0]

    blends = {"A": copy_last(4) + [0.0, 0.0, 0.0], "B": copy_last(6), "MH": copy_last(5) + [0.0, 0.0, 0.0]}
    F, *_ = pr.final_probs(P, blends, comps)
    assert F[0].argmax() == 0  # odds out: the odds blend
    assert F[1].argmax() == 2  # league match, no odds yet, both teams rated: market history
    for i in (2, 3, 4):  # MLS, Champions League, unrated team: the Step 6 no-odds blend
        np.testing.assert_allclose(F[i], [.4, .3, .3], atol=1e-6)
    F_old, *_ = pr.final_probs(P, {"A": blends["A"], "B": blends["B"]}, comps)  # an older bundle without MH
    np.testing.assert_allclose(F_old[1], [.4, .3, .3], atol=1e-6)
