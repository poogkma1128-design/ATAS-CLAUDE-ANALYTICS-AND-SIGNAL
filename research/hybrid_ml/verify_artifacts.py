"""Engineering replay by the same recorder; explicitly NOT independent sign-off."""
import argparse
from collections import defaultdict
import json
from pathlib import Path

import joblib
import numpy as np
from threadpoolctl import threadpool_limits

from .dataset import build_candidates, horizon_label, scope_from_config
from .models import predict_features
from .run import digest, save_json


def verify(run_directory, result_path=None):
    path = Path(run_directory).resolve()
    manifest = json.loads((path/"manifest.json").read_text(encoding="utf-8"))
    if manifest["status"] != "completed_exploratory":
        raise ValueError("Cannot certify an incomplete engineering run")
    for filename, sha in manifest["files"].items():
        assert digest(path/filename) == sha, filename
    assert digest(manifest["snapshot_path"]) == manifest["snapshot_sha256"]
    repo = Path(__file__).resolve().parents[2]
    for filename, sha in manifest["source_hashes"].items():
        assert digest(repo/filename) == sha, filename
    data = json.loads(Path(manifest["snapshot_path"]).read_text(encoding="utf-8"))
    ledger = [json.loads(line) for line in (path/"candidates.jsonl").read_text(encoding="utf-8").splitlines()]
    # Rebuild under the run's own recorded scope, so a v2 run is replayed as v2 and a
    # v1 run stays exactly as v1: the config carries both instruments and boundaries.
    assert build_candidates(data["rows"], scope_from_config(manifest["config"])) == ledger
    selected = {c["candidate_id"]: c for c in ledger if c["eligible"] and not c["purged"]}
    predictions = [json.loads(line) for line in (path/"predictions.jsonl").read_text(encoding="utf-8").splitlines()]
    summary = json.loads((path/"summary.json").read_text(encoding="utf-8"))
    groups = defaultdict(list)
    for p in predictions:
        assert p["candidate_id"] in selected
        groups[(p["symbol"], p["task"], p["model"], p["variant"])].append(p)
    checked_cells = checked_scores = 0
    with threadpool_limits(limits=1):
        for cell in summary["cells"]:
            if cell["fit_status"] != "fitted":
                continue
            bundle = joblib.load(path/cell["artifact"])  # only this locally produced trusted artifact
            for variant in cell["variants"]:
                key = (cell["symbol"], cell["task"], cell["model"], variant["variant"])
                ps = groups[key]
                cs = [selected[p["candidate_id"]] for p in ps]
                assert len({p["candidate_id"] for p in ps}) == len(ps)
                expected_ids = {k for k,c in selected.items() if c["symbol"]==key[0] and c["task"]==key[1]}
                assert {p["candidate_id"] for p in ps} == expected_ids
                calculated = predict_features(bundle, [c["features"] for c in cs], variant["temperature"])
                if variant["variant"] == "temperature":
                    np.testing.assert_allclose(predict_features(bundle, [c["features"] for c in cs]), calculated)
                assert np.all(np.diff(calculated[:,:,3], axis=1) <= 1e-12)
                for i, (p,c) in enumerate(zip(ps,cs)):
                    for f in p["forecasts"]:
                        np.testing.assert_allclose(calculated[i, f["horizon"]-1], f["probabilities"], rtol=1e-12, atol=1e-12)
                        assert f["label"] == horizon_label(c, f["horizon"])
                # Recompute scores directly, without calling the reporting metrics function.
                for score in variant["scores"]:
                    pp = [p for p in ps if p["partition"] == score["partition"]]
                    fs = [f for p in pp for f in p["forecasts"] if f["horizon"] == score["horizon"]]
                    known = [f for f in fs if f["label"] is not None]
                    assert score["candidates"] == len(pp)
                    assert score["scored"] == len(known)
                    assert score["unobservable"] == len(pp)-len(known)
                    if known:
                        probs = np.asarray([f["probabilities"] for f in known])
                        labels = np.asarray([f["label"] for f in known])
                        brier = np.square(probs-np.eye(4)[labels]).sum()/len(known)
                        nll = -sum(np.log(max(f["probabilities"][f["label"]], 1e-15)) for f in known)/len(known)
                        np.testing.assert_allclose([score["brier"],score["log_loss"]], [brier,nll], atol=1e-12)
                    checked_scores += 1
            checked_cells += 1
    result = {"status": "engineering_replay_pass", "independent_review": False,
              "run_id": manifest["run_id"], "model_artifacts_checked": checked_cells,
              "metric_rows_checked": checked_scores, "prediction_rows_checked": len(predictions),
              "ledger_rows_checked": len(ledger), "snapshot_sha256": manifest["snapshot_sha256"]}
    if result_path:
        result_path = Path(result_path).resolve()
        if result_path.exists() or result_path.is_relative_to(path):
            raise ValueError("Verification output must be new and outside immutable run directory")
        save_json(result_path, result)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_directory")
    parser.add_argument("--result")
    args = parser.parse_args()
    print(json.dumps(verify(args.run_directory, args.result), indent=2))
