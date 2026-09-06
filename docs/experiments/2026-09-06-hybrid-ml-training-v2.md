# Training on everything recorded — v2 scope

Owner asked to continue training with **all the data there is**, and separately whether historical
replay can be pulled from ATAS. This document answers both.

**Actual status: the pipeline is widened, tested and pre-flighted against the live database, but the
fit on real rows has not been run.** No v2 accuracy, calibration or comparison number exists yet, and
this session produced none. The reason is stated in full under *What could not be run here*, together
with the two commands that complete it. Nothing below is an independent review, and nothing below
changes production.

## What changed

Only the **scope**: which instruments are read, and where the train / calibration / evaluation
boundaries fall. Features, barriers, horizon, purge rule, estimators, hyperparameters, seed and the
reporting contract are identical to v1, and no config value was chosen by looking at an evaluation
score.

| | v1 (recorded run) | v2 |
|---|---|---|
| Instruments | MNQU6, GC | MNQU6, GC, **NQU6, BTCUSDT** |
| Window (UTC) | 2026-08-28 → 2026-09-04 | 2026-08-28 → **2026-09-06** |
| Train | < 2026-09-02 | < 2026-09-03 |
| Calibration | 2026-09-02 | 2026-09-03 |
| Evaluation | 2026-09-03 | 2026-09-04 → 2026-09-06 |
| Rows the SELECT returns | 3,382 | **7,303** |
| Model cells | 12 | 24 |

`config_v2.json` is the machine-readable version of that table. `research/hybrid_ml/dataset.py` now
carries a frozen `Scope` object; `validate_config` returns the scope a config is allowed to read and
rejects any config — v1 or v2 — that moves a feature, the lookback, the horizon, the barrier
multiplier, the reported horizons, the task list, the sweep flag or the production flag. `Scope`
itself rejects an empty, duplicated or unordered scope. The runner refuses a snapshot whose symbols
or window do not match the config it was given, so a snapshot exported under one scope cannot be
trained under another.

### What the wider evaluation window is and is not

v1 evaluated on 2026-09-03 UTC. Under v2 that day becomes **calibration**, and everything before it
becomes training, so **v2 scores are not independent of what v1 already reported**. The v2 evaluation
span, 2026-09-04 to 2026-09-06 UTC, was never scored by v1 — but it is still reused development
history, not a pre-registered out-of-sample set.

It does not touch V4's reserve. V4's out-of-sample is defined in HANDOFF §0L as the sessions **after**
its gate opens, which is 2026-09-18 at the earliest and 2026-09-25 for the tightest cell. Every row in
the v2 window is earlier than that, so reading them costs V4 nothing.

BTCUSDT is a continuous crypto venue and the three futures are not. Under one shared UTC split,
BTCUSDT gets roughly two evaluation days and the futures roughly one, because the futures' last
recorded bar is the 2026-09-04 weekend close. Sample counts are **not** comparable across those
venues, and this run pools nothing: every market is still fitted separately.

## Pre-flight measured against the live database

Read-only SELECTs, project `sckdriuwfyittcybnbhz`, 2026-09-06. These are what
`docs/queries/hybrid_ml_training_export_v2.sql` will return; they are diagnostics, not a certification
of the data.

| Symbol | Rows | UTC days | First bar | Last bar | Off-grid | Footprint tick mismatch | Levels outside high/low |
|---|---:|---:|---|---|---:|---:|---:|
| MNQU6 | 2,242 | 7 | 08-28 07:45 | 09-04 20:50 | 705 | 654 | 459 |
| GC | 1,642 | 7 | 08-28 00:00 | 09-04 20:50 | 112 | 797 | 555 |
| NQU6 | 1,162 | 7 | 08-28 12:35 | 09-04 10:05 | 0 | 408 | 318 |
| BTCUSDT | 2,257 | 8 | 08-29 02:30 | 09-05 23:55 | 490 | 376 | 261 |
| **Total** | **7,303** | | | | **1,307** | **2,235** | **1,593** |

- **1,307 off-grid rows are the still-unquarantined timeframe contamination** (§0L). Migration 0035
  is still unapplied, so they are still labelled `5m`. The export keeps them and flags them; the
  builder excludes them with reason `off_grid` and the ledger counts the exclusion, so the
  contamination stays visible instead of being silently dropped or silently used.
- The footprint mismatch and outside-level counts are the same failures §0N reported, now measured
  over four instruments. Those rows are excluded per task with an explicit reason. **A large share of
  the 7,303 rows will not become eligible candidates**; the wider scope buys fewer usable samples than
  the row count suggests, and the exact eligible count is only known once the run happens.
- Identity check: each symbol maps to exactly one `instrument_id` and one exchange, and there are no
  duplicate `(instrument_id, opened_at)` pairs in the window — the two conditions that would abort the
  run. 5,996 of 7,303 rows sit exactly on the 5-minute grid.

### An anomaly worth a look, not fixed here

`public.instruments.tick_size` — written verbatim from what the ATAS indicator sends
(`InstrumentInfo.TickSize`) — reads **MNQU6 0.75, GC 0.30, NQU6 0.25, BTCUSDT 10.0**. Three of those
are not the exchange minimum tick most references give for those contracts (MNQ 0.25, GC 0.10), and
MNQU6 and GC are exactly three times it. This is **pre-existing**, identical in v1, and not something
this session changed or verified — it cannot be checked without the ATAS terminal. It matters beyond
this experiment: `tick_size` is the unit under `minRiskTicks`, the risk floor and every R-multiple in
`public.signals`. Someone with the terminal open should compare the value ATAS reports against the
contract spec before the next statistic is quoted in ticks.

## What was verified here

Python 3.11.15 with the pinned dependencies (`pip check` clean). The recorded v1 run used 3.12.14;
that difference is a deviation to note when comparing binaries, and the v1 regression below was run
under 3.11.15 on both sides so it isolates the code change.

| Check | Result |
|---|---|
| `python -m unittest research.hybrid_ml.test_pipeline` | ✅ **24 passed** (19 before; 5 new cover scope, config rejection, and the multi-instrument run) |
| v1 regression: same synthetic v1 snapshot through the pre-change code and the post-change code | ✅ **15/15 artifacts byte-identical**, including all 12 model binaries, `candidates.jsonl` and `predictions.jsonl` |
| Synthetic four-instrument v2 run over the real v2 date scope | ✅ 24/24 cells fitted, 20,736 ledger rows, 82,275 prediction rows, 13 s |
| `verify_artifacts` replay of that v2 run | ✅ `engineering_replay_pass`, 24 artifacts and 360 metric rows recomputed |
| v2 export SQL executed against the live database | ✅ returns the census in the table above; SELECT-only |
| `export_snapshot.ps1` (now config-driven) | ⚠️ **not executed** — no PowerShell and no Supabase credentials in this container |

The synthetic snapshots are random walks written for the test. They prove the pipeline, the scope
plumbing and the replay path. **They prove nothing about the market.**

## What could not be run here, and why

The fit on real rows did not happen in this session. The session runs in a cloud container that has
no Supabase credentials; the only database access is a read-only tool whose results come back into
the conversation rather than to disk. `public.bars` and `public.cluster_levels` are readable by the
`authenticated` role only, so there is no anonymous path to bulk-download them either. Exporting
7,303 rows by hand through the conversation would mean retyping the dataset, which is exactly how a
silent transcription error gets into research evidence. That was not done.

The run therefore belongs where v1's ran — the machine that holds the credentials and the local
research directory:

```powershell
& research/hybrid_ml/export_snapshot.ps1 -OutputDirectory E:\GPT\local-research-data\hybrid-ml\snapshot-v2 -Config research/hybrid_ml/config_v2.json
& E:\GPT\local-research-data\hybrid-ml\venv\Scripts\python.exe -m research.hybrid_ml.run --snapshot E:\GPT\local-research-data\hybrid-ml\snapshot-v2\snapshot.json --config research/hybrid_ml/config_v2.json --output E:\GPT\local-research-data\hybrid-ml\run-v2
& E:\GPT\local-research-data\hybrid-ml\venv\Scripts\python.exe -m research.hybrid_ml.verify_artifacts E:\GPT\local-research-data\hybrid-ml\run-v2 --result E:\GPT\local-research-data\hybrid-ml\verification-v2.json
```

On this container the equivalent 10,368-row synthetic run took 13 seconds, so the real one is a
sub-minute job. Report the resulting `summary.json` back and the results section of this document can
be filled in — with the same rule v1 used: no winner is declared, and accuracy is never reported as a
win rate.

## Can historical replay be pulled from the ATAS API?

Short answer: **not usefully, and this was already measured.**

- ATAS has no public REST or cloud API for historical data. The only integration surface is the .NET
  SDK running inside the terminal — which is what `SignalBridgeIndicator.cs` already is. Whatever
  history it can see is whatever the connected data provider has sent to that chart.
- The owner checked the depth on 2026-09-03: M5 on GC and MNQU6 reaches back only to **31 Aug**
  before the chart hangs on "Processing data…" — roughly **3–4 days**, against ~9 months on Daily.
  That is shorter than what Supabase already holds, so a backfill would return **zero new bars**.
  Recorded in §ญ.11 of `2026-09-03-candle-signature-v3.md` and row AA of HANDOFF §7.2; the conclusion
  has not changed.
- ATAS **Market Replay** replays tick data the terminal has stored locally. It is bounded by the same
  provider retention (the owner already hit 1-day / 1-week limits on DOM and tick data), so it does
  not create history that the feed never delivered. It is a tool for re-watching a session, not for
  building a dataset.
- The current backfill path is also capped by design at 200 bars in one request
  (`SignalBridgeIndicator.cs` `BackfillBars`, `MAX_BARS_PER_REQUEST` in `ingest.ts`), and — the part
  that matters most — sending old bars through `ingest` would run today's rules over them and write
  into `public.signals`, contaminating every statistic computed on that table. Any backfill must land
  in a separate table with its own provenance column and no rule evaluation, as designed in §ญ.11.

If the goal is more history rather than more of ATAS, the sources that actually have it:

| Want | Realistic source | Notes |
|---|---|---|
| BTCUSDT, years of it | Binance public data (`data.binance.vision` dumps, or the REST klines endpoint) | Free. `aggTrades` carry the buyer-maker flag, so delta, POC and a real footprint can be **reconstructed**, not approximated. This is the cheapest large increase in sample size available to this project. |
| NQ / MNQ / GC deep history | A paid historical vendor — Databento, CME DataMine, or a deeper dxFeed/Rithmic/CQG subscription | Trades with aggressor side (or MBP/MBO) are needed to rebuild footprint; plain OHLCV is enough only for the mathematical layer described as Backtest A in §ญ.11. |
| Nothing new to buy | Keep collecting live | ~288 bars per market per session, which is the pace the V4 gate is already waiting on. |

Any of those is a **separate table, separate ingest path, and its own Gate 0 and independent review**
before a single row is trained on — the same rule that closed V3.1. None of it is started here.

## Roles, boundaries, rollback

Proposer and Executor for this change are the same session, so this is not independent review and
cannot approve itself. Independent reviewer remains unassigned; a reviewer should re-run the tests,
repeat the v1 byte-identical regression, run the export SELECT themselves, and check that the scope
widening did not quietly change the measurement.

No production change: no migration applied (0035 still unapplied), no Edge Function deployed, no data
written, no rule, filter, Telegram or ATAS DLL change, no `public.experiments` row. Every database
statement in this session was a SELECT. Rollback is a source revert; there is no runtime state and no
model artifact in the repository.
