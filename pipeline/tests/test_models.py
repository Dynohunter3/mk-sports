"""Step 3 model tests: no leakage in features, Dixon-Coles recovers known strengths, metrics are right."""

import copy
import math

import numpy as np
import pytest

pytest.importorskip("scipy")

from mkmodel.data import DAY, M  # noqa: E402
from mkmodel.experiment import metrics  # noqa: E402
from mkmodel.features import FEATURES, Config, EloParams, build, fit_league, outcome_probs  # noqa: E402

T0 = 1_600_000_000.0


def synthetic(seasons=3, seed=1):
    """A 10-team double round robin per season with Poisson goals from fixed strengths."""
    rng = np.random.default_rng(seed)
    teams = [f"t{i}" for i in range(10)]
    att = np.linspace(-0.4, 0.4, 10)
    out, t = [], T0
    # circle-method round robin: 9 rounds, mirrored for the second half
    rounds, rot = [], teams[1:]
    for r in range(9):
        line = [teams[0]] + rot
        pairs = [(line[i], line[9 - i]) for i in range(5)]
        rounds.append([(a, b) if r % 2 else (b, a) for a, b in pairs])
        rot = rot[-1:] + rot[:-1]
    rounds += [[(b, a) for a, b in rd] for rd in rounds]
    for s in range(seasons):
        season = f"{2020 + s}-{21 + s}"
        for rd in rounds:
            for k, (h, a) in enumerate(rd):
                lh = math.exp(0.15 + 0.25 + att[int(h[1:])] - att[int(a[1:])] * 0.5)
                la = math.exp(0.15 + att[int(a[1:])] - att[int(h[1:])] * 0.5)
                hs, as_ = int(rng.poisson(lh)), int(rng.poisson(la))
                ko = t + k * 3600
                out.append(M(f"m{len(out)}", "eng.1", season, ko, h, a, hs, as_, ko + 2.5 * 3600, 1.0,
                             stats={"home": {"shots": hs * 3 + 5, "shots_on_target": hs + 2}, "away": {"shots": as_ * 3 + 4, "shots_on_target": as_ + 1}}))
            t += 7 * DAY
    return out


def test_features_never_see_later_results():
    ms = synthetic()
    cfg = Config(elo=EloParams(), start=T0 + 200 * DAY)
    X1, o1 = build(copy.deepcopy(ms), cfg)
    # change every result after a cut-off; features of matches before it must not move
    cut = T0 + 300 * DAY
    changed = copy.deepcopy(ms)
    for m in changed:
        if m.t >= cut:
            m.hs, m.as_ = m.as_ + 3, m.hs
    X2, o2 = build(changed, cfg)
    before = np.array([m.t < cut for m in o1])
    assert before.any() and (~before).any()
    np.testing.assert_array_equal(np.nan_to_num(X1[before], nan=-9), np.nan_to_num(X2[before], nan=-9))
    assert not np.array_equal(np.nan_to_num(X1[~before], nan=-9), np.nan_to_num(X2[~before], nan=-9))


def test_result_released_only_after_it_is_known():
    """A result whose result_at is after the next match's kick-off must not affect that match."""
    ms = synthetic(seasons=1)
    cfg = Config(elo=EloParams(), start=T0)
    late = copy.deepcopy(ms)
    late[0].result_at = late[-1].t + DAY  # first result only becomes known at the very end
    X1, o1 = build(copy.deepcopy(ms), cfg)
    X2, o2 = build(late, cfg)
    i = next(k for k, m in enumerate(o1) if m.t > ms[0].t + DAY and ms[0].h in (m.h, m.a))
    e = FEATURES.index("elo_h") if o1[i].h == ms[0].h else FEATURES.index("elo_a")
    assert X1[i, e] != X2[i, e]


def test_dixon_coles_recovers_strength_order():
    ms = synthetic(seasons=3, seed=7)
    rows = [(m.t, m.h, m.a, m.hs, m.as_, None, None) for m in ms]
    st = fit_league(rows, ms[-1].t + DAY, 0.0, "goals")
    # true strength: attack att, defence 0.5*att (generator); compare ranks of fitted att + def
    fitted = np.array([st.att[st.idx[f"t{i}"]] + st.dfn[st.idx[f"t{i}"]] for i in range(10)])
    rank_corr = np.corrcoef(np.argsort(np.argsort(fitted)), np.arange(10))[0, 1]
    assert rank_corr > 0.9
    assert 0.1 < st.home < 0.45  # true home effect 0.25
    ph, pd, pa = outcome_probs(1.5, 1.0, st.rho)
    assert abs(ph + pd + pa - 1) < 1e-9 and ph > pa


def test_metrics():
    P = np.array([[1.0, 0, 0], [0.5, 0.25, 0.25]])
    y = np.array([0, 2])
    r = metrics(P, y)
    assert r["accuracy"] == 0.5
    assert abs(r["log_loss"] - (-(math.log(1 - 2e-12) + math.log(0.25)) / 2)) < 1e-6
    assert abs(r["brier"] - (0 + (0.25 + 0.0625 + 0.5625)) / 2) < 1e-9
