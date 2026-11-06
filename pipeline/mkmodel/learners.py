"""Learners as separate fit / predict steps, shared by the backtest (experiment.py) and production
(production.py), so the deployed model is exactly the model that was evaluated."""

from __future__ import annotations

import math

import lightgbm as lgb
import numpy as np
from scipy.optimize import minimize

SEED = 42
EPS = 1e-12
DAY = 86400.0


# ----------------------------------------------------------------------------------- ordered logit on Elo
def fit_ordered_logit(Xtr: np.ndarray, ytr: np.ndarray, ttr: np.ndarray, cutoff: float) -> list[float]:
    d = Xtr[:, 0] / 100
    w = np.exp(-(cutoff - ttr) / DAY * 0.0012)

    def nll(th):
        P = np.clip(ordered_logit_probs(th, d), EPS, 1)
        return -np.sum(w * np.log(P[np.arange(len(ytr)), ytr]))

    th = minimize(nll, np.array([0.5, -0.3, math.log(0.6)]), method="Nelder-Mead",
                  options={"maxiter": 2000, "xatol": 1e-6, "fatol": 1e-8}).x
    return [float(v) for v in th]


def ordered_logit_probs(th, d: np.ndarray) -> np.ndarray:
    b, c1, c2 = th[0], th[1], th[1] + math.exp(th[2])
    z = b * d
    pa = 1 / (1 + np.exp(-(c1 - z)))
    pad = 1 / (1 + np.exp(-(c2 - z)))
    return np.stack([1 - pad, pad - pa, pa], 1)


def predict_ordered_logit(th, X: np.ndarray) -> np.ndarray:
    return ordered_logit_probs(th, X[:, 0] / 100)


# ----------------------------------------------------------------------------------- boosted trees
GBM_PARAMS = dict(objective="multiclass", n_estimators=350, learning_rate=0.03, num_leaves=15, min_child_samples=60,
                  subsample=0.8, subsample_freq=1, colsample_bytree=0.8, reg_lambda=2.0, random_state=SEED,
                  deterministic=True, force_row_wise=True, n_jobs=4, verbose=-1)


def fit_gbm(cols: list[int], Xtr: np.ndarray, ytr: np.ndarray, ttr: np.ndarray, cutoff: float) -> lgb.LGBMClassifier:
    w = np.exp(-(cutoff - ttr) / DAY * 0.0008)
    clf = lgb.LGBMClassifier(**GBM_PARAMS)
    clf.fit(Xtr[:, cols], ytr, sample_weight=w)
    return clf


def predict_gbm(clf, cols: list[int], X: np.ndarray) -> np.ndarray:
    return clf.predict_proba(X[:, cols])


def gbm_to_string(clf) -> str:
    return clf.booster_.model_to_string()


def gbm_from_string(s: str):
    return lgb.Booster(model_str=s)


def predict_booster(booster, cols: list[int], X: np.ndarray) -> np.ndarray:
    return booster.predict(X[:, cols])


# ----------------------------------------------------------------------------------- blend (+ calibration)
def blend_probs(theta, L: np.ndarray, calibrate: bool) -> np.ndarray:
    """L: k x n x 3 log-probabilities. Weights on the simplex; optional vector scaling."""
    k = L.shape[0]
    wv = np.exp(theta[:k]) / np.exp(theta[:k]).sum()
    z = np.tensordot(wv, L, 1)
    if calibrate:
        z = z * math.exp(theta[k]) + np.r_[theta[k + 1], 0.0, theta[k + 2]]
    z = z - z.max(1, keepdims=True)
    return np.exp(z) / np.exp(z).sum(1, keepdims=True)


def fit_blend(L: np.ndarray, y: np.ndarray, calibrate: bool) -> list[float]:
    k = L.shape[0]
    if len(y) < 300:
        return [0.0] * (k + (3 if calibrate else 0))  # equal weights, identity calibration

    def nll(theta):
        P = np.clip(blend_probs(theta, L, calibrate), EPS, 1)
        return -np.mean(np.log(P[np.arange(len(y)), y])) + 1e-3 * np.sum(np.asarray(theta[k:]) ** 2)

    th = minimize(nll, np.zeros(k + (3 if calibrate else 0)), method="Nelder-Mead", options={"maxiter": 4000}).x
    return [float(v) for v in th]


def to_log(P: np.ndarray) -> np.ndarray:
    return np.log(np.clip(P, EPS, 1))
