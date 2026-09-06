"""Run frozen exploratory forecast training; all raw artifacts stay outside Git."""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
from pathlib import Path
import platform
import subprocess
import uuid

import joblib
import numpy as np
from sklearn.exceptions import ConvergenceWarning
from threadpoolctl import threadpool_limits

from .dataset import (FEATURES, LEVEL_FEATURES, SYMBOLS, START, END, TRAIN_END, CAL_END,
                      build_candidates, candidate_census, horizon_label, iso, timestamp)
from .models import fit_model, calibrate, predict_features, metrics


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def save_json(path, obj):
    Path(path).write_text(json.dumps(obj, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def validate_config(c):
    # Dataset v1 is deliberately a frozen measurement, not a parameter-search API.
    expected = {"schema_version": "hybrid-ml-exploratory-v1", "target_symbols": list(SYMBOLS),
                "lookback": 12, "horizon": 10, "bar_minutes": 5, "barrier_multiplier": 1.0,
                "report_horizons": [3, 6, 10], "tasks": ["direction", "level"],
                "features": list(FEATURES), "level_extra_features": list(LEVEL_FEATURES[-2:]),
                "hyperparameter_sweep": False, "production_approved": False, "epsilon": 1e-9}
    for key, value in expected.items():
        if c.get(key) != value:
            raise ValueError(f"Frozen v1 config mismatch: {key}")
    for key, value in [("development_start", START), ("development_end_exclusive", END),
                       ("train_end", TRAIN_END), ("calibration_end", CAL_END), ("evaluation_end", END)]:
        if timestamp(c[key]) != value:
            raise ValueError(f"Frozen v1 time mismatch: {key}")


def feature_census(selected, names):
    if not selected:
        return {"rows": 0, "features": []}
    x = np.asarray([r["features"] for r in selected])
    return {"rows": len(x), "features": [
        {"name": name, "finite": int(np.isfinite(x[:, i]).sum()),
         "constant": bool(np.ptp(x[:, i]) == 0),
         "quantiles": np.quantile(x[:, i], [0, .25, .5, .75, 1]).tolist()}
        for i, name in enumerate(names)]}


def run(snapshot_path, config_path, output_path):
    snapshot_path, config_path, output = (Path(p).resolve() for p in (snapshot_path, config_path, output_path))
    repo = Path(__file__).resolve().parents[2]
    if output.resolve().is_relative_to(repo) or snapshot_path.resolve().is_relative_to(repo):
        raise ValueError("Raw dataset and model artifacts must stay outside repository")
    if output.exists():
        raise FileExistsError("Refusing to overwrite an experiment directory")
    config = json.loads(config_path.read_text(encoding="utf-8"))
    validate_config(config)
    data = json.loads(snapshot_path.read_text(encoding="utf-8"))
    if data.get("schema_version") != "hybrid-ml-training-export-v1":
        raise ValueError("Unsupported snapshot schema")
    rows = data["rows"]
    if len(rows) != data["row_count"] or {r["symbol"] for r in rows} != set(SYMBOLS):
        raise ValueError("Incomplete or out-of-scope snapshot")
    output.mkdir(parents=True)
    source_files = sorted(Path(__file__).parent.glob("*.py")) + [config_path, Path(__file__).parent/"requirements.txt",
                  repo/"docs/queries/hybrid_ml_training_export_v1.sql"]
    manifest = {"run_id": str(uuid.uuid4()), "status": "running", "started_at": iso(datetime.now(timezone.utc)),
                "snapshot_sha256": digest(snapshot_path), "snapshot_path": str(snapshot_path.resolve()),
                "snapshot_executed_at": data["executed_at"], "source_hashes": {str(p.relative_to(repo)): digest(p) for p in source_files},
                "git_head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip(),
                "source_dirty": bool(subprocess.check_output(["git", "status", "--porcelain"], cwd=repo, text=True)),
                "python": platform.python_version(), "libraries": {n: importlib.metadata.version(n) for n in
                    ["numpy", "scipy", "scikit-learn", "joblib", "threadpoolctl"]},
                "config": config, "independent_review": "pending", "production_approved": False}
    save_json(output/"manifest.json", manifest)
    try:
        ledger = build_candidates(rows)
        with (output/"candidates.jsonl").open("w", encoding="utf-8") as f:
            for c in ledger:
                f.write(json.dumps(c, ensure_ascii=False, allow_nan=False) + "\n")
        selected = [c for c in ledger if c["eligible"] and not c["purged"]]
        summary = {"run_id": manifest["run_id"], "status": "exploratory_only", "raw_bars": len(rows),
                   "candidate_census": candidate_census(ledger), "cells": [], "feature_census": [],
                   "limitations": data["limitations"] + [
                       "Latest snapshot after decision times; no original-arrival or true-period certification.",
                       "Root continuation implements and records the proposed model; independent review pending.",
                       "Evaluation interval is reused development history, not pristine OOS.",
                       "Overlapping candidates; UTC dates are not verified exchange sessions or independent samples.",
                       "Scores condition on observable labels; informative censoring remains possible.",
                       "Forecast replay only; no trade fills, fees, net P&L or deployable accuracy claim."]}
        predictions = output/"predictions.jsonl"
        with predictions.open("w", encoding="utf-8") as predfile, threadpool_limits(limits=1):
            for symbol in SYMBOLS:
                for task in config["tasks"]:
                    candidates = [c for c in selected if c["symbol"] == symbol and c["task"] == task]
                    train = [c for c in candidates if c["partition"] == "train"]
                    calibration = [c for c in candidates if c["partition"] == "calibration"]
                    names = FEATURES if task == "direction" else LEVEL_FEATURES
                    summary["feature_census"].append({"symbol": symbol, "task": task,
                                                       "training": feature_census(train, names)})
                    for kind in ("baseline", "logistic", "boosting"):
                        cell = {"symbol": symbol, "task": task, "model": kind,
                                "partition_candidates": dict(Counter(c["partition"] for c in candidates))}
                        try:
                            bundle = fit_model(kind, train, config)
                            bundle.update(feature_names=list(names), config_sha256=digest(config_path),
                                          snapshot_sha256=manifest["snapshot_sha256"], symbol=symbol, task=task)
                            calibration_info = (dict(temperature=1.0, fitted=False, reason="baseline_not_calibrated")
                                                if kind == "baseline" else calibrate(bundle, calibration, config))
                            bundle["calibration"] = calibration_info
                            bundle["temperature"] = calibration_info["temperature"]
                            filename = f"{symbol}_{task}_{kind}.joblib"
                            joblib.dump(bundle, output/filename)
                            cell.update(fit_status="fitted", artifact=filename, artifact_sha256=digest(output/filename),
                                        training_risk_rows=bundle["training_risk_rows"],
                                        training_classes=bundle["training_classes"], calibration=calibration_info,
                                        variants=[])
                            versions = [("raw", 1.0)]
                            if kind != "baseline":
                                versions.append(("temperature", calibration_info["temperature"]))
                            for variant, temperature in versions:
                                cumulative = predict_features(bundle, [c["features"] for c in candidates], temperature)
                                variant_metrics = {"variant": variant, "temperature": temperature, "scores": []}
                                for partition in ("train", "calibration", "evaluation"):
                                    ids = [i for i, c in enumerate(candidates) if c["partition"] == partition]
                                    for h in config["report_horizons"]:
                                        known = [(i, horizon_label(candidates[i], h)) for i in ids]
                                        known = [(i, label) for i, label in known if label is not None]
                                        score = metrics([label for _, label in known],
                                                        [cumulative[i, h-1] for i, _ in known], len(ids),
                                                        config["reliability_bins"])
                                        variant_metrics["scores"].append(dict(partition=partition, horizon=h, **score))
                                cell["variants"].append(variant_metrics)
                                for i, c in enumerate(candidates):
                                    crossed = np.flatnonzero(1 - cumulative[i, :, 3] >= .5)
                                    record = {"candidate_id": c["candidate_id"], "symbol": symbol, "task": task,
                                              "partition": c["partition"], "decision_time": c["decision_time"],
                                              "utc_day": c["utc_day"], "model": kind, "variant": variant,
                                              "median_any_event_minutes": int((crossed[0]+1)*5) if len(crossed) else None,
                                              "median_includes_ambiguous_event": True, "forecasts": [
                                                  {"horizon": h, "probabilities": cumulative[i, h-1].tolist(),
                                                   "label": horizon_label(c, h)} for h in config["report_horizons"]]}
                                    predfile.write(json.dumps(record, allow_nan=False) + "\n")
                        except (ValueError, ArithmeticError, ConvergenceWarning) as error:
                            cell.update(fit_status="failed", failure=str(error))
                        summary["cells"].append(cell)
        summary["fit_status_counts"] = dict(Counter(c["fit_status"] for c in summary["cells"]))
        save_json(output/"summary.json", summary)
        manifest.update(status="completed_exploratory", completed_at=iso(datetime.now(timezone.utc)),
                        files={p.name: digest(p) for p in sorted(output.iterdir()) if p.name != "manifest.json"})
        save_json(output/"manifest.json", manifest)
        return {"run_id": manifest["run_id"], "output": str(output), "raw_bars": len(rows),
                "fit_status_counts": summary["fit_status_counts"], "status": manifest["status"]}
    except Exception as error:
        manifest.update(status="failed", failure_type=type(error).__name__, failure=str(error))
        save_json(output/"manifest.json", manifest)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--config", default=str(Path(__file__).with_name("config_v1.json")))
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    print(json.dumps(run(args.snapshot, args.config, args.output), indent=2))


if __name__ == "__main__":
    main()
