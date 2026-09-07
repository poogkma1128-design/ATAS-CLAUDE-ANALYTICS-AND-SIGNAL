"""Four-state discrete hazard estimators; no trading or production integration."""
from __future__ import annotations

import warnings
import numpy as np
from scipy.optimize import minimize_scalar
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.exceptions import ConvergenceWarning
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler


def risk_rows(candidates):
    x, y, bins = [], [], []
    for c in candidates:
        for k in range(1, c["observed_bins"] + 1):
            x.append(c["features"] + [k / 10])
            bins.append(k - 1)
            y.append(c["event_class"] if c["event_bin"] == k else 0)
    width = len(candidates[0]["features"]) + 1 if candidates else 1
    return (np.asarray(x, dtype=float).reshape(-1, width),
            np.asarray(y, dtype=int), np.asarray(bins, dtype=int))


def normalize(p, epsilon=1e-9):
    p = np.asarray(p, dtype=float)
    if p.ndim != 2 or p.shape[1] != 4 or not np.isfinite(p).all() or (p < 0).any():
        raise ValueError("Invalid four-class probability matrix")
    p = np.clip(p, epsilon, 1)
    return p / p.sum(axis=1, keepdims=True)


def temperature_transform(p, temperature):
    if not np.isfinite(temperature) or temperature <= 0:
        raise ValueError("Invalid temperature")
    logits = np.log(normalize(p)) / temperature
    logits -= logits.max(axis=1, keepdims=True)
    out = np.exp(logits)
    return out / out.sum(axis=1, keepdims=True)


def conditional_probabilities(bundle, x, bins):
    if bundle["kind"] == "baseline":
        p = bundle["hazards"][bins]
    else:
        fitted = bundle["estimator"]
        raw = fitted.predict_proba(x)
        p = np.zeros((len(x), 4))
        p[:, np.asarray(fitted.classes_, dtype=int)] = raw
    return normalize(p)


def fit_model(kind, candidates, config):
    x, y, bins = risk_rows(candidates)
    if not len(y):
        raise ValueError("no_observed_training_risk_rows")
    bundle = {"kind": kind, "training_candidates": len(candidates),
              "training_risk_rows": len(y), "training_classes": np.unique(y).tolist(),
              "temperature": 1.0, "status": "exploratory_only"}
    if kind == "baseline":
        counts = np.full((10, 4), config["baseline"]["laplace_alpha"], dtype=float)
        np.add.at(counts, (bins, y), 1)
        bundle["hazards"] = counts / counts.sum(axis=1, keepdims=True)
    else:
        if len(np.unique(y)) < 2:
            raise ValueError("insufficient_training_classes")
        if kind == "logistic":
            estimator = make_pipeline(StandardScaler(), LogisticRegression(**config["logistic"]))
        elif kind == "boosting":
            estimator = HistGradientBoostingClassifier(**config["boosting"])
        else:
            raise ValueError("Unknown model")
        with warnings.catch_warnings():
            warnings.simplefilter("error", ConvergenceWarning)
            estimator.fit(x, y)
        bundle["estimator"] = estimator
    return bundle


def calibrate(bundle, candidates, config):
    x, y, bins = risk_rows(candidates)
    info = {"temperature": 1.0, "risk_rows": len(y),
            "classes": np.unique(y).tolist(), "fitted": False}
    settings = config["temperature"]
    if len(y) < settings["min_risk_rows"] or len(np.unique(y)) < settings["min_classes"]:
        return dict(info, reason="insufficient_calibration_support")
    p = conditional_probabilities(bundle, x, bins)

    def loss(t):
        calibrated = temperature_transform(p, t)
        return float(-np.log(np.clip(calibrated[np.arange(len(y)), y], 1e-15, 1)).mean())

    result = minimize_scalar(loss, bounds=settings["bounds"], method="bounded",
                             options={"xatol": 1e-6, "maxiter": 200})
    if not result.success or not np.isfinite(result.fun):
        return dict(info, reason="temperature_optimizer_failed")
    return dict(info, fitted=True, temperature=float(result.x), reason=None,
                calibration_nll_before=loss(1.0), calibration_nll_after=float(result.fun))


def cumulative_probabilities(hazards):
    """Map [stay,event1,event2,ambiguous] to cumulative causes plus survival."""
    h = np.asarray(hazards, dtype=float)
    if h.ndim != 3 or h.shape[1:] != (10, 4):
        raise ValueError("Expected candidate x 10 x 4 hazards")
    if not np.isfinite(h).all() or (h < 0).any() or not np.allclose(h.sum(axis=2), 1):
        raise ValueError("Hazards must conserve probability")
    out = np.empty_like(h)
    survival = np.ones(len(h))
    cumulative = np.zeros((len(h), 3))
    for k in range(10):
        cumulative += survival[:, None] * h[:, k, 1:]
        survival *= h[:, k, 0]
        out[:, k, :3] = cumulative
        out[:, k, 3] = survival
    if not np.allclose(out.sum(axis=2), 1):
        raise ArithmeticError("Cumulative probability did not conserve mass")
    return out


def predict_features(bundle, features, temperature=None):
    """Reusable inference: accepts features only, never labels or future bars."""
    if temperature is None:
        temperature = bundle.get("calibration", {}).get("temperature", 1.0)
    features = np.asarray(features, dtype=float)
    if features.ndim != 2 or not len(features) or not np.isfinite(features).all():
        raise ValueError("Expected nonempty finite feature matrix")
    n = len(features)
    x = np.column_stack((np.repeat(features, 10, axis=0), np.tile(np.arange(1, 11) / 10, n)))
    bins = np.tile(np.arange(10), n)
    hazards = temperature_transform(conditional_probabilities(bundle, x, bins), temperature)
    return cumulative_probabilities(hazards.reshape(n, 10, 4))


def metrics(labels, probabilities, denominator, bins=5):
    y, p = np.asarray(labels, dtype=int), np.asarray(probabilities, dtype=float).reshape(-1, 4)
    out = {"candidates": denominator, "scored": len(y), "unobservable": denominator - len(y),
           "coverage": len(y) / denominator if denominator else None}
    if not len(y):
        return dict(out, log_loss=None, brier=None, accuracy=None, class_counts=[0]*4, reliability=[])
    if (y < 0).any() or (y > 3).any() or not np.allclose(p.sum(axis=1), 1):
        raise ValueError("Invalid labels or cumulative probabilities")
    onehot = np.eye(4)[y]
    out.update(log_loss=float(-np.log(np.clip(p[np.arange(len(y)), y], 1e-15, 1)).mean()),
               brier=float(np.square(p - onehot).sum(axis=1).mean()),
               accuracy=float((p.argmax(axis=1) == y).mean()),
               class_counts=np.bincount(y, minlength=4).tolist())
    reliability = []
    for cls in range(4):
        assignment = np.minimum((p[:, cls] * bins).astype(int), bins - 1)
        for b in range(bins):
            mask = assignment == b
            reliability.append({"class": cls, "bin": b, "lower": b/bins, "upper": (b+1)/bins,
                                "count": int(mask.sum()),
                                "mean_probability": float(p[mask, cls].mean()) if mask.any() else None,
                                "observed_rate": float((y[mask] == cls).mean()) if mask.any() else None})
    out["reliability"] = reliability
    return out
