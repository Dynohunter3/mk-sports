"""Walk-forward feature generation. Every feature for a match is computed from state that only
contains results with ``result_at < kick-off`` (released from a time-ordered queue), so features
for training rows and evaluation rows are leak-free by construction.

Models producing features:
  elo      goal-difference Elo, one pool across all competitions (links leagues via cups/Europe)
  dc       Dixon-Coles: time-decayed Poisson attack/defence per league, league home advantage, rho
  dcx      the same fitted on a shots-based expected-goals proxy (football-data.co.uk shots and
           shots on target; no permitted xG source exists, see Step 2)
  context  rest days, matches in the last 14 days, games played (cold start), league base rates
  market   pre-closing odds (collected Tue/Fri before kick-off), never closing odds
"""

from __future__ import annotations

import heapq
import math
from collections import defaultdict, deque
from dataclasses import dataclass

import numpy as np
from scipy.optimize import minimize
from scipy.stats import poisson

from .data import DAY, M

MAXG = 10
_G = np.arange(MAXG + 1)


# ----------------------------------------------------------------------------------- Elo
@dataclass
class EloParams:
    k: float = 20.0
    hfa: float = 60.0
    regress: float = 0.15  # pull toward the league mean at a team's first match of a new season
    promoted_offset: float = -60.0  # unseen team starts this far below its league's mean


class Elo:
    def __init__(self, p: EloParams):
        self.p = p
        self.r: dict[str, float] = {}
        self.season_seen: dict[str, str] = {}
        self.league_members: dict[str, dict[str, float]] = defaultdict(dict)  # comp -> team -> last seen t

    def _league_mean(self, comp: str, t: float) -> float:
        xs = [self.r[x] for x, ts in self.league_members[comp].items() if t - ts < 400 * DAY and x in self.r]
        return float(np.mean(xs)) if xs else 1500.0

    def rating(self, team: str, comp: str, season: str, t: float, domestic: bool) -> float:
        if team not in self.r:
            self.r[team] = self._league_mean(comp, t) + (self.p.promoted_offset if domestic else 0.0)
        elif domestic and self.season_seen.get(team) != season:
            self.r[team] += self.p.regress * (self._league_mean(comp, t) - self.r[team])
        if domestic:
            self.season_seen[team] = season
        return self.r[team]

    def update(self, m: M, rh: float, ra: float, domestic: bool) -> None:
        diff = m.hs - m.as_
        exp = 1 / (1 + 10 ** (-(rh + self.p.hfa - ra) / 400))
        score = 1.0 if diff > 0 else 0.0 if diff < 0 else 0.5
        mult = 1.0 if abs(diff) <= 1 else 1.5 if abs(diff) == 2 else (11 + abs(diff)) / 8
        d = self.p.k * mult * (score - exp)
        self.r[m.h], self.r[m.a] = rh + d, ra - d
        if domestic:
            self.league_members[m.comp][m.h] = m.t
            self.league_members[m.comp][m.a] = m.t


# ----------------------------------------------------------------------------------- Dixon-Coles
def _fit_poisson(hi, ai, yh, ya, w, n, ridge=1e-3, x0=None):
    """Weighted Poisson MLE: log lh = mu + home + att[h] - dfn[a]; log la = mu + att[a] - dfn[h]."""

    def f(x):
        mu, home, att, dfn = x[0], x[1], x[2:2 + n], x[2 + n:]
        lh = np.exp(mu + home + att[hi] - dfn[ai])
        la = np.exp(mu + att[ai] - dfn[hi])
        loss = np.sum(w * (lh - yh * np.log(lh) + la - ya * np.log(la))) + ridge * (att @ att + dfn @ dfn)
        gh, ga = w * (lh - yh), w * (la - ya)
        g = np.empty_like(x)
        g[0] = gh.sum() + ga.sum()
        g[1] = gh.sum()
        g_att = np.bincount(hi, gh, n) + np.bincount(ai, ga, n) + 2 * ridge * att
        g_def = -np.bincount(ai, gh, n) - np.bincount(hi, ga, n) + 2 * ridge * dfn
        g[2:2 + n], g[2 + n:] = g_att, g_def
        return loss, g

    x0 = np.zeros(2 + 2 * n) if x0 is None else x0
    if x0 is None or not np.any(x0):
        x0[0] = math.log(max(np.average(np.r_[yh, ya], weights=np.r_[w, w]), 0.1))
    res = minimize(f, x0, jac=True, method="L-BFGS-B", options={"maxiter": 300})
    return res.x


def _tau_matrix(lh, la, rho):
    p = np.outer(poisson.pmf(_G, lh), poisson.pmf(_G, la))
    p[0, 0] *= 1 - lh * la * rho
    p[0, 1] *= 1 + lh * rho
    p[1, 0] *= 1 + la * rho
    p[1, 1] *= 1 - rho
    p = np.clip(p, 0, None)
    return p / p.sum()


def outcome_probs(lh, la, rho):
    p = _tau_matrix(lh, la, rho)
    return float(np.tril(p, -1).sum()), float(np.trace(p)), float(np.triu(p, 1).sum())


class LeagueDC:
    """One league's fitted state at a refit time."""

    def __init__(self, teams, x, rho, fit_t):
        self.idx = {t: i for i, t in enumerate(teams)}
        n = len(teams)
        self.mu, self.home, self.att, self.dfn = x[0], x[1], x[2:2 + n], x[2 + n:]
        self.rho, self.fit_t = rho, fit_t
        # an unseen (promoted) team: weak attack, weak defence (20th / 80th percentile)
        self.new_att, self.new_def = float(np.percentile(self.att, 20)), float(np.percentile(self.dfn, 20))

    def lambdas(self, h, a, neutral=False):
        ah = self.att[self.idx[h]] if h in self.idx else self.new_att
        dh = self.dfn[self.idx[h]] if h in self.idx else self.new_def
        aa = self.att[self.idx[a]] if a in self.idx else self.new_att
        da = self.dfn[self.idx[a]] if a in self.idx else self.new_def
        home = 0.0 if neutral else self.home
        return math.exp(self.mu + home + ah - da), math.exp(self.mu + aa - dh)


def fit_league(rows: list[tuple], t_fit: float, xi: float, target: str):
    """rows: (t, h, a, hs, as, xh, xa) finished before t_fit. target 'goals' or 'xg'."""
    rows = [r for r in rows if t_fit - r[0] < 3 * 365 * DAY]
    if len(rows) < 120:
        return None
    teams = sorted({r[1] for r in rows} | {r[2] for r in rows})
    ix = {t: i for i, t in enumerate(teams)}
    hi = np.array([ix[r[1]] for r in rows])
    ai = np.array([ix[r[2]] for r in rows])
    if target == "goals":
        yh = np.array([r[3] for r in rows], float)
        ya = np.array([r[4] for r in rows], float)
    else:
        yh = np.array([r[5] if r[5] is not None else r[3] for r in rows], float)
        ya = np.array([r[6] if r[6] is not None else r[4] for r in rows], float)
    age = (t_fit - np.array([r[0] for r in rows])) / DAY
    w = np.exp(-xi * age)
    x = _fit_poisson(hi, ai, yh, ya, w, len(teams))
    # rho from actual goals (low-score correction), coarse 1-D search
    mu, home, att, dfn = x[0], x[1], x[2:2 + len(teams)], x[2 + len(teams):]
    lh = np.exp(mu + home + att[hi] - dfn[ai])
    la = np.exp(mu + att[ai] - dfn[hi])
    gh = np.array([r[3] for r in rows])
    ga = np.array([r[4] for r in rows])
    best, best_rho = -1e18, 0.0
    for rho in np.linspace(-0.2, 0.1, 13):
        t = np.ones_like(lh)
        m00, m01, m10, m11 = (gh == 0) & (ga == 0), (gh == 0) & (ga == 1), (gh == 1) & (ga == 0), (gh == 1) & (ga == 1)
        t[m00] = 1 - lh[m00] * la[m00] * rho
        t[m01] = 1 + lh[m01] * rho
        t[m10] = 1 + la[m10] * rho
        t[m11] = 1 - rho
        ll = np.sum(w * np.log(np.clip(t, 1e-9, None)))
        if ll > best:
            best, best_rho = ll, rho
    return LeagueDC(teams, x, best_rho, t_fit)


# ----------------------------------------------------------------------------------- xG proxy
def xg_proxy_coefs(rows: list[M]) -> tuple[float, float]:
    """goals ~ a*shots_on_target + b*off_target shots (Poisson, no intercept), on finished rows with stats."""
    X, y = [], []
    for m in rows:
        for side, g in (("home", m.hs), ("away", m.as_)):
            s = m.stats.get(side)
            if s and "shots" in s and "shots_on_target" in s:
                X.append((s["shots_on_target"], max(s["shots"] - s["shots_on_target"], 0)))
                y.append(g)
    if len(y) < 200:
        return 0.3, 0.03
    X, y = np.array(X, float), np.array(y, float)

    def f(b):
        lam = np.clip(X @ b, 1e-6, None)
        return np.sum(lam - y * np.log(lam)), X.T @ (1 - y / lam)

    b = minimize(f, np.array([0.3, 0.03]), jac=True, method="L-BFGS-B", bounds=[(0, 2), (0, 1)]).x
    return float(b[0]), float(b[1])


# ----------------------------------------------------------------------------------- driver
FEATURES = [
    "elo_diff", "elo_h", "elo_a",
    "dc_h", "dc_d", "dc_a", "dc_lh", "dc_la",
    "dcx_h", "dcx_d", "dcx_a", "dcx_lh", "dcx_la",
    "rest_h", "rest_a", "busy_h", "busy_a", "games_h", "games_a",
    "lg_home", "lg_draw", "lg_goals",
    "mk_h", "mk_d", "mk_a",
]
DOMESTIC = {"eng.1", "eng.2", "eng.3", "eng.4", "esp.1", "ita.1", "ger.1", "fra.1", "ned.1", "por.1", "tur.1", "usa.1",
            "esp.2", "ita.2", "ger.2", "fra.2"}


@dataclass
class Config:
    elo: EloParams
    xi: float = 0.0019  # DC time decay per day (half-life ~ 1 year)
    refit_days: int = 7
    start: float = 0.0  # first kick-off for which features are produced
    use_comps: tuple = ()  # competitions whose results feed the state (default: all loaded)


def build(matches: list[M], cfg: Config) -> tuple[np.ndarray, list[M]]:
    """Return (features matrix [n x len(FEATURES)], the matches in the same order) for kick-offs >= cfg.start."""
    feed = set(cfg.use_comps) if cfg.use_comps else None
    elo = Elo(cfg.elo)
    pending: list[tuple[float, int]] = []  # (result_at, index) heap
    last_t: dict[str, float] = {}
    recent: dict[str, deque] = defaultdict(deque)
    games: dict[str, int] = defaultdict(int)
    league_hist: dict[str, deque] = defaultdict(deque)  # comp -> (t, outcome, goals)
    league_rows: dict[str, list[tuple]] = defaultdict(list)
    released: list[M] = []
    dc_state: dict[str, LeagueDC | None] = {}
    dcx_state: dict[str, LeagueDC | None] = {}
    last_fit: dict[str, float] = {}
    xg_coef = (0.3, 0.03)
    xg_coef_t = -1e18
    pre_ratings: dict[int, tuple[float, float]] = {}
    feats, order = [], []

    def release(upto: float):
        nonlocal xg_coef, xg_coef_t
        while pending and pending[0][0] < upto:
            _, i = heapq.heappop(pending)
            m = matches[i]
            if feed is not None and m.comp not in feed:
                continue
            dom = m.comp in DOMESTIC
            rh, ra = pre_ratings[i]
            elo.update(m, rh, ra, dom)
            games[m.h] += 1
            games[m.a] += 1
            league_hist[m.comp].append((m.t, m.outcome, m.hs + m.as_))
            xh = xa = None
            sh, sa = m.stats.get("home"), m.stats.get("away")
            if sh and sa and "shots_on_target" in sh and "shots_on_target" in sa:
                xh = xg_coef[0] * sh["shots_on_target"] + xg_coef[1] * max(sh["shots"] - sh["shots_on_target"], 0)
                xa = xg_coef[0] * sa["shots_on_target"] + xg_coef[1] * max(sa["shots"] - sa["shots_on_target"], 0)
            league_rows[m.comp].append((m.t, m.h, m.a, m.hs, m.as_, xh, xa))
            released.append(m)

    for i, m in enumerate(matches):
        release(m.t)
        dom = m.comp in DOMESTIC
        rh = elo.rating(m.h, m.comp, m.season, m.t, dom)
        ra = elo.rating(m.a, m.comp, m.season, m.t, dom)
        pre_ratings[i] = (rh, ra)
        if m.outcome is not None and m.result_at is not None:
            heapq.heappush(pending, (m.result_at, i))
        # schedule context (a past match's occurrence is public at its kick-off; results are not used here)
        ctx = []
        for team in (m.h, m.a):
            q = recent[team]
            while q and m.t - q[0] > 14 * DAY:
                q.popleft()
            ctx.append((min((m.t - last_t[team]) / DAY, 30.0) if team in last_t else 30.0, len(q)))
        for team in (m.h, m.a):
            last_t[team] = m.t
            recent[team].append(m.t)
        if m.t < cfg.start:
            continue
        # refit xG proxy coefficients yearly; league models weekly
        if m.t - xg_coef_t > 365 * DAY:
            xg_coef = xg_proxy_coefs([x for x in released if m.t - x.t < 3 * 365 * DAY])
            xg_coef_t = m.t
        comp = m.comp
        if comp not in last_fit or m.t - last_fit[comp] >= cfg.refit_days * DAY:
            rows = league_rows.get(comp, [])
            dc_state[comp] = fit_league(rows, m.t, cfg.xi, "goals")
            has_x = sum(1 for r in rows[-400:] if r[5] is not None) > 200
            dcx_state[comp] = fit_league(rows, m.t, cfg.xi, "xg") if has_x else None
            last_fit[comp] = m.t
        f = dict.fromkeys(FEATURES, np.nan)
        f.update(elo_diff=rh + cfg.elo.hfa - ra, elo_h=rh, elo_a=ra)
        for key, st in (("dc", dc_state.get(comp)), ("dcx", dcx_state.get(comp))):
            if st is not None:
                lh, la = st.lambdas(m.h, m.a)
                ph, pd, pa = outcome_probs(lh, la, st.rho)
                f.update({f"{key}_h": ph, f"{key}_d": pd, f"{key}_a": pa, f"{key}_lh": lh, f"{key}_la": la})
        (rest_h, busy_h), (rest_a, busy_a) = ctx
        f.update(rest_h=rest_h, rest_a=rest_a, busy_h=busy_h, busy_a=busy_a, games_h=min(games[m.h], 60), games_a=min(games[m.a], 60))
        hist = league_hist[comp]
        while hist and m.t - hist[0][0] > 365 * DAY:
            hist.popleft()
        if len(hist) >= 30:
            oc = [x[1] for x in hist]
            f.update(lg_home=oc.count(0) / len(oc), lg_draw=oc.count(1) / len(oc), lg_goals=float(np.mean([x[2] for x in hist])))
        if m.pre is not None and m.pre_at is not None and m.pre_at < m.t:
            f.update(mk_h=m.pre[0], mk_d=m.pre[1], mk_a=m.pre[2])
        feats.append([f[k] for k in FEATURES])
        order.append(m)
    return np.array(feats, float), order
