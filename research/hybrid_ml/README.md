# MNQ / GC offline exploratory ML

Fits per-market competing-risk forecasts for first upper/lower passage and previous-footprint-POC
continuation/rejection. This is a research pipeline with **no production or order execution integration**.
Results, limitations and every model's metrics are in
[`2026-09-06-hybrid-ml-training-v1.md`](../../docs/experiments/2026-09-06-hybrid-ml-training-v1.md).

## Reproduction (PowerShell, repository root)

Use Python 3.12 with pinned dependencies. The original run used Python 3.12.14.
Keep the virtual environment, datasets, predictions and model binaries outside the repository.

```powershell
python -m venv E:\GPT\local-research-data\hybrid-ml\venv
& E:\GPT\local-research-data\hybrid-ml\venv\Scripts\python.exe -m pip install -r research/hybrid_ml/requirements.txt
& E:\GPT\local-research-data\hybrid-ml\venv\Scripts\python.exe -m pip check
& E:\GPT\local-research-data\hybrid-ml\venv\Scripts\python.exe -m unittest research.hybrid_ml.test_pipeline -v
```

Read-only new export using existing Supabase authentication (choose a new output directory):

```powershell
& research/hybrid_ml/export_snapshot.ps1 -OutputDirectory E:\GPT\local-research-data\hybrid-ml\snapshot-new
```

A later export is not identical historical evidence. To reproduce the recorded run, use its existing
snapshot and choose a **new** training output directory. The runner refuses overwrite and refuses raw
input/output inside the repository.

```powershell
& E:\GPT\local-research-data\hybrid-ml\venv\Scripts\python.exe -m research.hybrid_ml.run --snapshot E:\GPT\local-research-data\hybrid-ml\snapshot-20260906-v1-retry\snapshot.json --config research/hybrid_ml/config_v1.json --output E:\GPT\local-research-data\hybrid-ml\run-reproduction
& E:\GPT\local-research-data\hybrid-ml\venv\Scripts\python.exe -m research.hybrid_ml.verify_artifacts E:\GPT\local-research-data\hybrid-ml\run-reproduction --result E:\GPT\local-research-data\hybrid-ml\verification-reproduction.json
```

Source line endings and evidence bytes are preserved by the scoped `.gitattributes` entries.
`manifest.json` records exact source/config/data hashes and all artifact hashes. `candidates.jsonl`
retains eligibility, exclusions, purging and censoring. `predictions.jsonl` contains every variant's
horizon probabilities and labels. `summary.json` has all scores and denominators. Models are
`{symbol}_{task}_{model}.joblib`, with feature order and calibration metadata.

## Saved-model inference

Load only a trusted model created locally by this runner; joblib deserializes Python objects.
From a Python session launched at the repository root:

```python
from pathlib import Path
import json
import joblib
from research.hybrid_ml.models import predict_features

run = Path(r"E:\GPT\local-research-data\hybrid-ml\run-20260906-v1-final")
model = joblib.load(run / "MNQU6_direction_logistic.joblib")
# Demonstration: reproduce a recorded historical candidate, not a live signal.
candidates = (json.loads(line) for line in (run / "candidates.jsonl").open(encoding="utf-8"))
candidate = next(c for c in candidates if c["symbol"] == model["symbol"]
                 and c["task"] == model["task"] and c["eligible"] and not c["purged"])
probabilities = predict_features(model, [candidate["features"]])
print(probabilities[0, [2, 5, 9]])  # 15/30/50m: [event1,event2,ambiguous,no_event]
```

Default inference uses that model's stored calibration temperature. Pass `temperature=1.0` to
explicitly reproduce the raw variant. `model['feature_names']` is the required feature order.
Direction event1/event2 mean up/down first passage; level event1/event2 mean continuation/rejection.
These probabilities describe the specified barriers, not guaranteed terminal direction or trading wins.
The reported event-time median includes ambiguous first events and is null if the model's cumulative
any-event probability does not reach 0.5 within ten bars.

## Frozen v1 constraints

Only MNQU6/GC, exact development window, causal 13-predecessor input support and current reconciled
footprint. Future footprint does not filter labels. A first missing/invalid future OHLC censors the path.
The model treats an OHLC bar touching both barriers as an ambiguous event without imposing tick order.
Decision-time calibration/evaluation partitions and maximum-horizon purging are fixed in v1;
`config_v1.json` does not constitute permission to tune against the evaluation results.

Original source period, delivery contract and arrival snapshots remain unverified. Current-snapshot
reconciliation is not historical authentication. Engineering replay is not independent scientific review.
No P&L scorer, dashboard probability, Telegram signal or live model loader was modified.
