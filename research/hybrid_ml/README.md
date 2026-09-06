# Offline exploratory ML for the recorded instruments

Fits per-market competing-risk forecasts for first upper/lower passage and previous-footprint-POC
continuation/rejection. This is a research pipeline with **no production or order execution integration**.
Results, limitations and every model's metrics are in
[`2026-09-06-hybrid-ml-training-v1.md`](../../docs/experiments/2026-09-06-hybrid-ml-training-v1.md)
and, for the wider v2 scope, [`2026-09-06-hybrid-ml-training-v2.md`](../../docs/experiments/2026-09-06-hybrid-ml-training-v2.md).

## Which config to run

| | `config_v1.json` | `config_v2.json` |
|---|---|---|
| Instruments | MNQU6, GC | MNQU6, GC, NQU6, BTCUSDT |
| Window (UTC) | 2026-08-28 → 2026-09-04 | 2026-08-28 → 2026-09-06 |
| Train / calibration / evaluation | < 09-02 / 09-02 / 09-03 | < 09-03 / 09-03 / 09-04 → 09-06 |
| Export query | `hybrid_ml_training_export_v1.sql` | `hybrid_ml_training_export_v2.sql` |
| Rows the SELECT returned | 3,382 | 7,303 (measured 2026-09-06) |

v2 changes the **scope and nothing else**: identical features, barriers, horizon, purge rule,
estimators and hyperparameters, and no selection on any evaluation score. v1 remains runnable and
byte-reproducible; the runner reads each config's own scope and refuses a snapshot that does not
match it. Because v2 trains on days v1 evaluated, v2 scores are not independent of v1's report.

## Reproduction (PowerShell, repository root)

Use Python 3.12 with pinned dependencies. The original run used Python 3.12.14.
Keep the virtual environment, datasets, predictions and model binaries outside the repository.

```powershell
python -m venv E:\GPT\local-research-data\hybrid-ml\venv
& E:\GPT\local-research-data\hybrid-ml\venv\Scripts\python.exe -m pip install -r research/hybrid_ml/requirements.txt
& E:\GPT\local-research-data\hybrid-ml\venv\Scripts\python.exe -m pip check
& E:\GPT\local-research-data\hybrid-ml\venv\Scripts\python.exe -m unittest research.hybrid_ml.test_pipeline -v
```

Read-only new export using existing Supabase authentication (choose a new output directory). The
config decides the scope, and the script picks the matching query and refuses a mismatched result:

```powershell
& research/hybrid_ml/export_snapshot.ps1 -OutputDirectory E:\GPT\local-research-data\hybrid-ml\snapshot-v2 -Config research/hybrid_ml/config_v2.json
```

Then train and replay that snapshot (the two commands the v2 run needs):

```powershell
& E:\GPT\local-research-data\hybrid-ml\venv\Scripts\python.exe -m research.hybrid_ml.run --snapshot E:\GPT\local-research-data\hybrid-ml\snapshot-v2\snapshot.json --config research/hybrid_ml/config_v2.json --output E:\GPT\local-research-data\hybrid-ml\run-v2
& E:\GPT\local-research-data\hybrid-ml\venv\Scripts\python.exe -m research.hybrid_ml.verify_artifacts E:\GPT\local-research-data\hybrid-ml\run-v2 --result E:\GPT\local-research-data\hybrid-ml\verification-v2.json
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

## What v2 does and does not widen

`Scope` is the only thing a v2 config may move: which instruments and where the train, calibration
and evaluation boundaries fall. `validate_config` rejects any config, v1 or v2, that alters the
feature list, lookback, horizon, barrier multiplier, reported horizons, tasks, sweep flag or
production flag, and `Scope` itself rejects an empty, duplicated or unordered scope.

The wider scope does not repair the underlying data. Migration 0035 is still unapplied, so rows
labelled `5m` that are not 5-minute bars remain in the table; the export keeps them and flags them,
and the builder excludes them as `off_grid` so the count stays visible in the ledger. Adding
BTCUSDT mixes a continuous crypto venue with three session-bound futures under one UTC calendar,
which is a scope decision the owner asked for, not a claim that the samples are comparable.
