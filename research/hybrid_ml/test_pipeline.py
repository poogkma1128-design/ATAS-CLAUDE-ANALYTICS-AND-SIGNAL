"""Synthetic causality, time split, censoring, and estimator regression checks."""
import copy
from datetime import timedelta
import json
from pathlib import Path
import unittest

import numpy as np
from threadpoolctl import threadpool_limits

from research.hybrid_ml import dataset as d
from research.hybrid_ml.models import (cumulative_probabilities, fit_model, calibrate,
                                      predict_features, risk_rows, metrics)
from research.hybrid_ml.run import validate_config


def rows(n=55, start=d.START, symbol="MNQU6"):
    out = []
    for i in range(n):
        out.append(dict(id=i, instrument_id=symbol+"-test-id", symbol=symbol, exchange="test",
                        tick_size=.25, timeframe_sec=300, timeframe="5m", is_closed=True,
                        opened_at=d.iso(start + i*d.STEP), open=100., high=101., low=99., close=100.,
                        volume=20., ask_volume=12., bid_volume=8., ticks=10,
                        level_count=3, level_volume_sum=20., ask_sum=12., bid_sum=8., tick_sum=10,
                        max_level_volume=10., derived_poc=100.5, outside_level_count=0,
                        invalid_level_count=0))
    return out


def at(ledger, bar=20, task="direction"):
    return next(r for r in ledger if r["bar_id"] == bar and r["task"] == task)


class DatasetTests(unittest.TestCase):
    def test_prefix_and_future_mutation_invariance(self):
        source = rows()
        full = at(d.build_candidates(source))
        prefix = at(d.build_candidates(source[:21]))
        changed = copy.deepcopy(source)
        for r in changed[21:]:
            r.update(open=140., high=150., low=130., close=145., ticks=-1, volume=-1.)
        mutated = at(d.build_candidates(changed))
        keys = ["features", "scale", "reference", "upper_barrier", "lower_barrier", "eligible", "purged"]
        for key in keys:
            self.assertEqual(full[key], prefix[key])
            self.assertEqual(full[key], mutated[key])
        self.assertNotEqual(full["event_class"], mutated["event_class"])

    def test_future_footprint_not_used(self):
        source = rows()
        original = at(d.build_candidates(source))
        for r in source[21:]:
            r.update(invalid_level_count=99, level_count=0, ticks=-1, ask_sum=None, bid_sum=None)
        modified = at(d.build_candidates(source))
        for key in ["eligible", "features", "observed_bins", "event_bin", "event_class", "censor_reason"]:
            self.assertEqual(original[key], modified[key])

    def test_gap_censors_not_timeout_and_never_skips_ahead(self):
        source = rows()
        del source[23]
        c = at(d.build_candidates(source))
        self.assertEqual(c["observed_bins"], 2)
        self.assertIsNone(d.horizon_label(c, 3))
        self.assertEqual(d.horizon_label(c, 2), 3)
        self.assertEqual(c["censor_reason"], "missing_future_bar")

    def test_invalid_future_ohlc_censors(self):
        source = rows()
        source[21]["high"] = float("nan")
        c = at(d.build_candidates(source))
        self.assertEqual(c["observed_bins"], 0)
        self.assertEqual(c["censor_reason"], "invalid_ohlc")

    def test_missing_past_prevents_features(self):
        source = rows()
        del source[15]
        c = at(d.build_candidates(source))
        self.assertFalse(c["eligible"])
        self.assertNotIn("features", c)

    def test_simultaneous_barriers_preserved_as_ambiguous(self):
        source = rows()
        source[21].update(high=105., low=95.)
        c = at(d.build_candidates(source))
        self.assertEqual((c["event_class"], c["event_bin"]), (3, 1))
        self.assertEqual(d.horizon_label(c, 10), 2)

    def test_event_stops_before_later_gap(self):
        source = rows()
        source[21]["high"] = 105.
        del source[22]
        c = at(d.build_candidates(source))
        self.assertEqual(c["event_class"], 1)
        self.assertEqual(d.horizon_label(c, 10), 0)
        self.assertIsNone(c["censor_reason"])

    def test_previous_poc_level_and_approach_mapping(self):
        source = rows()
        source[19]["derived_poc"] = 99.5  # approach from above => lower touch continues
        source[21]["low"] = 95.
        c = at(d.build_candidates(source), task="level")
        self.assertTrue(c["eligible"])
        self.assertEqual(c["approach"], -1)
        self.assertEqual(c["reference"], 99.5)
        self.assertEqual(c["event_class"], 1)

    def test_level_already_resolved_excluded(self):
        source = rows()
        source[20].update(close=104., high=105.)
        c = at(d.build_candidates(source), task="level")
        self.assertEqual(c["exclusion_reason"], "already_resolved_at_decision")

    def test_exact_fractional_grid_and_reconciliation(self):
        source = rows()
        source[20]["opened_at"] = d.iso(d.timestamp(source[20]["opened_at"]) + timedelta(microseconds=1))
        self.assertEqual(at(d.build_candidates(source))["exclusion_reason"], "off_grid")
        source = rows()
        source[20]["tick_sum"] += 1
        self.assertEqual(at(d.build_candidates(source))["exclusion_reason"], "footprint_tick_mismatch")
        source[20]["tick_sum"] -= 1
        source[20]["ask_sum"] += .01
        self.assertEqual(at(d.build_candidates(source))["exclusion_reason"], "footprint_ask_mismatch")

    def test_duplicates_other_symbols_and_holdout_rejected(self):
        for source in [rows()+[rows()[0]], rows(symbol="NQU6"), rows(start=d.END)]:
            with self.assertRaises(ValueError):
                d.build_candidates(source)

    def test_tick_rounding(self):
        self.assertEqual(d.barriers(100.1, 1.01, .25), (101.25, 99.0))

    def test_purge_on_max_horizon_not_observed_event(self):
        self.assertEqual(d.split_at(d.TRAIN_END-timedelta(minutes=55)), ("train", False))
        self.assertEqual(d.split_at(d.TRAIN_END-timedelta(minutes=50)), ("train", True))
        self.assertEqual(d.split_at(d.TRAIN_END), ("calibration", False))
        self.assertEqual(d.split_at(d.CAL_END), ("evaluation", False))
        self.assertEqual(d.split_at(d.END), ("outside_window", True))
        source = rows(start=d.TRAIN_END-timedelta(hours=3))
        source[27]["high"] = 120.
        mnq = at(d.build_candidates(source), bar=26)
        other = copy.deepcopy(source)
        for r in other:
            r.update(symbol="GC", instrument_id="GC-test-id")
        gc = at(d.build_candidates(other), bar=26)
        self.assertTrue(mnq["purged"])
        self.assertEqual(mnq["partition"], gc["partition"])
        self.assertEqual(mnq["purged"], gc["purged"])


class ModelTests(unittest.TestCase):
    def setUp(self):
        self.config = json.loads(Path(__file__).with_name("config_v1.json").read_text(encoding="utf-8"))
        self.candidates = []
        for i in range(40):
            self.candidates.append(dict(features=[i/40., i%3], observed_bins=3,
                                        event_bin=3, event_class=1+i%3))

    def test_risk_expansion_stops_at_event_or_censor(self):
        x, y, bins = risk_rows([dict(features=[1.], observed_bins=2, event_bin=None, event_class=None),
                               dict(features=[2.], observed_bins=1, event_bin=1, event_class=2)])
        self.assertEqual(y.tolist(), [0, 0, 2])
        self.assertEqual(bins.tolist(), [0, 1, 0])
        self.assertEqual(x[:, -1].tolist(), [.1, .2, .1])

    def test_mass_and_monotone_survival(self):
        h = np.broadcast_to([.7, .1, .15, .05], (2, 10, 4)).copy()
        p = cumulative_probabilities(h)
        np.testing.assert_allclose(p.sum(axis=2), 1)
        self.assertTrue((np.diff(p[:, :, 3], axis=1) <= 0).all())
        np.testing.assert_allclose(p[0, 0], [.1, .15, .05, .7])
        with self.assertRaises(ValueError):
            cumulative_probabilities(h*2)

    def test_each_estimator_predicts_feature_only(self):
        with threadpool_limits(limits=1):
            for kind in ["baseline", "logistic", "boosting"]:
                fitted = fit_model(kind, self.candidates, self.config)
                p = predict_features(fitted, [[.2, 0], [.8, 1]])
                self.assertEqual(p.shape, (2, 10, 4))
                np.testing.assert_allclose(p.sum(axis=2), 1)
                self.assertTrue(np.isfinite(p).all())

    def test_scaler_train_only_and_calibration_no_refit(self):
        fitted = fit_model("logistic", self.candidates, self.config)
        expected_x = risk_rows(self.candidates)[0]
        scaler = fitted["estimator"].steps[0][1]
        np.testing.assert_allclose(scaler.mean_, expected_x.mean(axis=0))
        old_mean = scaler.mean_.copy()
        old_coef = fitted["estimator"].steps[-1][1].coef_.copy()
        cal = copy.deepcopy(self.candidates)
        for c in cal:
            c["features"][0] += 100
        info = calibrate(fitted, cal, self.config)
        self.assertTrue(info["fitted"])
        np.testing.assert_array_equal(scaler.mean_, old_mean)
        np.testing.assert_array_equal(fitted["estimator"].steps[-1][1].coef_, old_coef)
        self.assertFalse(calibrate(fitted, [], self.config)["fitted"])

    def test_one_class_fail_explicitly_and_scores_count_censoring(self):
        with self.assertRaisesRegex(ValueError, "insufficient_training_classes"):
            fit_model("logistic", [dict(features=[1.], observed_bins=2, event_bin=None, event_class=None)], self.config)
        m = metrics([0, 3], [[1, 0, 0, 0], [0, 0, 0, 1]], 3)
        self.assertEqual(m["brier"], 0)
        self.assertEqual(m["unobservable"], 1)
        self.assertAlmostEqual(m["coverage"], 2/3)

    def test_frozen_config_rejects_changed_window_or_features(self):
        validate_config(self.config)
        for key, value in [("train_end", "2026-09-03T00:00:00Z"), ("lookback", 50), ("features", [])]:
            bad = dict(self.config, **{key: value})
            with self.assertRaises(ValueError):
                validate_config(bad)


if __name__ == "__main__":
    unittest.main()
