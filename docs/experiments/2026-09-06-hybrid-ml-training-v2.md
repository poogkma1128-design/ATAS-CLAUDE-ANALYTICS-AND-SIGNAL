# Training on everything recorded — v2 scope

Owner asked to continue training with **all the data there is**, and separately whether historical
replay can be pulled from ATAS. This document answers both.

**Actual status: run, replayed, and negative.** The owner executed the run on the machine holding the
credentials. Across the eight market-and-task cells, the frequency baseline scores better than or
equivalent to every fitted model in seven; one cell favours boosting on 66 scored candidates. The
widened scope did not surface an edge — it removed one that v1 appeared to show. Nothing here is an
independent review, and nothing here changes production.

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

## What was verified while building it

These are the authoring session's checks on the code, before the owner ran the real thing. Python
3.11.15 with the pinned dependencies (`pip check` clean); the real run used 3.12.14, as v1 did. The
v1 regression ran under 3.11.15 on both sides, so it isolates the code change rather than the
interpreter.

| Check | Result |
|---|---|
| `python -m unittest research.hybrid_ml.test_pipeline` | ✅ **24 passed** (19 before; 5 new cover scope, config rejection, and the multi-instrument run) |
| v1 regression: same synthetic v1 snapshot through the pre-change code and the post-change code | ✅ **15/15 artifacts byte-identical**, including all 12 model binaries, `candidates.jsonl` and `predictions.jsonl` |
| Synthetic four-instrument v2 run over the real v2 date scope | ✅ 24/24 cells fitted, 20,736 ledger rows, 82,275 prediction rows, 13 s |
| `verify_artifacts` replay of that v2 run | ✅ `engineering_replay_pass`, 24 artifacts and 360 metric rows recomputed |
| v2 export SQL executed against the live database | ✅ returns the census in the table above; SELECT-only |
| `export_snapshot.ps1` and `extract_snapshot.py` against a stubbed CLI and a 9.47 MB reply | ✅ every wrapper shape extracts; nine malformed replies each refused |

The synthetic snapshots are random walks written for the test. They prove the pipeline, the scope
plumbing and the replay path. **They prove nothing about the market.**

## Where the run happened

Not in the authoring session. That session runs in a cloud container with no Supabase credentials;
its only database access is a read-only tool whose results return into the conversation rather than
to disk, and `public.bars` and `public.cluster_levels` are readable by the `authenticated` role only,
so there was no anonymous bulk path either. Exporting 7,303 rows by hand through a conversation
would have meant retyping the dataset, which is how a silent transcription error gets into research
evidence. It was not done. The owner ran it where v1 ran, on the machine holding the credentials and
the local research directory; the commands are in `research/hybrid_ml/README.md`.

The export needed two attempts for reasons unrelated to the data: the Supabase CLI returned the
result rows as a bare JSON array rather than the wrapper the shell script expected, and Windows
PowerShell 5.1 would not parse the roughly nine-megabyte reply the way PowerShell 7 does. Parsing
now lives in `research/hybrid_ml/extract_snapshot.py`, and the shell script only runs the query and
saves the reply. Neither attempt changed a row: both are SELECTs, and the raw reply from the first
attempt is what the second one parsed.

## Results

Run `2da55b96-1b8d-403d-9c82-f75daa3f4e4d`, Python 3.12.14, source at `56e265c` (working tree not
clean at run time, recorded as `source_dirty: true`). Snapshot SHA256
`01b848db3e6f5305c4eeb6d4bb27ed3b48c1fcf4f65d97b10caf6b464b6b25ab`, **7,303 raw bars**, matching the
pre-flight census above exactly. **24/24 model cells fitted.** `verify_artifacts` returned
`engineering_replay_pass` over 24 artifacts, 360 metric rows, 25,245 prediction rows and 14,606
ledger rows — which is 7,303 × 2, one candidate per bar per task, so no bar was silently dropped
from the accounting. That replay is the recorder's own; it is not independent review.

### Selected candidates (eligible, not purged)

| market | task | train | calibration | evaluation |
|---|---|---:|---:|---:|
| MNQU6 | direction | 427 | 204 | 178 |
| MNQU6 | level | 213 | 107 | 111 |
| GC | direction | 400 | 117 | 129 |
| GC | level | 159 | 44 | 72 |
| NQU6 | direction | 488 | 52 | 123 |
| NQU6 | level | 252 | 31 | 68 |
| BTCUSDT | direction | 814 | 169 | 294 |
| BTCUSDT | level | 376 | 85 | 136 |
| **total** | | **3,129** | **809** | **1,111** |

5,049 of 14,606 candidate slots survived (34.6%). The rest were excluded with a recorded reason —
off-grid bars, footprint that does not reconcile, missing predecessors — or purged at a partition
boundary. That is the cost of the wider scope being honest about the data it was handed: **7,303
bars did not become 7,303 usable samples.**

### Evaluation partition, 50-minute horizon

Lower Brier and log loss are better. Accuracy counts four classes and **is not a win rate**.

| market / task | variant | Brier | log loss | accuracy | scored/candidates |
|---|---|---:|---:|---:|---:|
| MNQU6 / direction | baseline raw | **0.5668** | **0.9389** | 38.73% | 173/178 |
| | logistic raw | 0.5962 | 0.9930 | 42.77% | 173/178 |
| | logistic temperature | 0.5883 | 0.9723 | 42.77% | 173/178 |
| | boosting raw | 0.6148 | 1.1064 | 39.88% | 173/178 |
| | boosting temperature | 0.6113 | 1.0978 | 39.88% | 173/178 |
| MNQU6 / level | baseline raw | **0.5138** | 0.8210 | 54.72% | 106/111 |
| | logistic raw | 0.5207 | 0.8026 | 51.89% | 106/111 |
| | logistic temperature | 0.5211 | 0.8035 | 51.89% | 106/111 |
| | boosting raw | 0.5328 | **0.8018** | 53.77% | 106/111 |
| | boosting temperature | 0.5427 | 0.8173 | 53.77% | 106/111 |
| GC / direction | baseline raw | 0.6620 | **1.1817** | 37.50% | 120/129 |
| | logistic raw | **0.6548** | 1.2432 | 39.17% | 120/129 |
| | logistic temperature | 0.6572 | 1.2472 | 38.33% | 120/129 |
| | boosting raw | 0.7104 | 1.3088 | 41.67% | 120/129 |
| | boosting temperature | 0.7104 | 1.3080 | 41.67% | 120/129 |
| GC / level | baseline raw | **0.6321** | **1.2002** | 40.91% | 66/72 |
| | logistic raw | 0.6653 | 1.3884 | 42.42% | 66/72 |
| | logistic temperature | 0.6659 | 1.3722 | 43.94% | 66/72 |
| | boosting raw | 0.6546 | 1.6193 | 53.03% | 66/72 |
| | boosting temperature | 0.6547 | 1.6180 | 53.03% | 66/72 |
| NQU6 / direction | baseline raw | **0.5182** | **0.7940** | 39.50% | 119/123 |
| | logistic raw | 0.5957 | 0.8903 | 42.02% | 119/123 |
| | logistic temperature | 0.6140 | 0.9288 | 42.02% | 119/123 |
| | boosting raw | 0.6334 | 0.9194 | 45.38% | 119/123 |
| | boosting temperature | 0.6534 | 0.9575 | 45.38% | 119/123 |
| NQU6 / level | baseline raw | 0.5260 | 0.8301 | 34.85% | 66/68 |
| | logistic raw | 0.5302 | 0.7896 | 51.52% | 66/68 |
| | logistic temperature | 0.5723 | 0.8900 | 51.52% | 66/68 |
| | boosting raw | **0.4527** | **0.6879** | 68.18% | 66/68 |
| | boosting temperature | 0.4541 | 0.6931 | 68.18% | 66/68 |
| BTCUSDT / direction | baseline raw | **0.5459** | **0.8771** | 46.40% | 278/294 |
| | logistic raw | 0.5495 | 0.9020 | 47.12% | 278/294 |
| | logistic temperature | 0.5519 | 0.9176 | 47.12% | 278/294 |
| | boosting raw | 0.5748 | 1.0036 | 44.24% | 278/294 |
| | boosting temperature | 0.5837 | 1.0310 | 44.24% | 278/294 |
| BTCUSDT / level | baseline raw | 0.5378 | **0.8599** | 53.54% | 127/136 |
| | logistic raw | 0.5424 | 1.0809 | 48.82% | 127/136 |
| | logistic temperature | 0.5427 | 1.0259 | 48.82% | 127/136 |
| | boosting raw | 0.5565 | 1.1580 | 55.12% | 127/136 |
| | boosting temperature | **0.5350** | 1.0278 | 58.27% | 127/136 |

### Reading it

The baseline is the weakest thing in the run: a per-time-bin event frequency with no features at all.
Comparing the best ML variant in each cell against it, on both proper scoring rules:

| market / task | best ML Brier vs baseline | best ML log loss vs baseline | reading |
|---|---:|---:|---|
| MNQU6 / direction | +0.0215 worse | +0.0334 worse | baseline |
| MNQU6 / level | +0.0069 worse | −0.0192 better | split |
| GC / direction | −0.0072 better | +0.0615 worse | split |
| GC / level | +0.0225 worse | +0.1882 worse | baseline |
| NQU6 / direction | +0.0775 worse | +0.0963 worse | baseline |
| NQU6 / level | **−0.0733 better** | **−0.1422 better** | boosting, n=66 |
| BTCUSDT / direction | +0.0036 worse | +0.0249 worse | baseline |
| BTCUSDT / level | −0.0028 better | +0.1679 worse | baseline |

**Seven of eight cells give the featureless baseline the better or equivalent probability.** The
eleven footprint and price features did not add usable information on this data. The exception,
NQU6 level with boosting, is the smallest evaluation cell in the run — 66 scored candidates on a
market that v1 never touched. With eight cells scored, one looking good is what chance produces; it
is a hypothesis for the next dataset, not a result.

**Accuracy moved the other way from the scores, repeatedly.** GC level boosting reaches 53.03%
accuracy against the baseline's 40.91% while its log loss degrades from 1.20 to 1.62; BTCUSDT level
boosting reaches 58.27% against 53.54% with log loss degrading from 0.86 to 1.03. A model that picks
the right class more often while its probabilities get worse is more confident than it has earned.
Calibrated probability is the entire output of this system, so accuracy improvements of this shape
are a warning, not a result — which is why the frozen v1 contract reports all three and refuses to
call accuracy a win rate.

### What v2 says about v1

v1 observed that MNQU6 level ML had a lower Brier than its baseline: 0.5353 for temperature-scaled
boosting against 0.5725. That was the single most encouraging number in the v1 report.

With more data and an evaluation window v1 never scored, **it reverses**: baseline 0.5138 against
0.5427 for the same estimator. The v1 observation does not survive contact with more data.

This is the run's most useful outcome. It is also exactly what the v1 report said its own numbers
could not establish, so the frozen contract behaved as intended rather than being rescued after the
fact. GC level, which v1 already scored in the baseline's favour, stayed there.

### What this does not establish

No significance is claimed, and none can be from this run. Candidates overlap heavily — one per
5-minute bar, each looking 50 minutes ahead — so the scored rows are not independent draws; the
evaluation spans one to two UTC days per market; per-opportunity artifacts and session-by-instrument
block resampling do not exist yet (`EXPERIMENT_REVIEW_PROTOCOL.md` §5). "The baseline scores better"
is an observation about this interval, not proof that these features are worthless. Equally, nothing
here supports promoting any model, and no model is promoted. There is still no cost, fill, latency or
P&L backtest, and the timeframe contamination and source-provenance gaps recorded above are unchanged.

### The cheapest way to learn more

Sample size is the binding constraint: the largest evaluation cell in this run is 294 candidates.
BTCUSDT is the one market where that can change without buying anything — Binance publishes years of
public data, and `aggTrades` carry the buyer-maker flag, so delta, POC and a genuine footprint can be
reconstructed rather than approximated. That is the path from a few hundred overlapping candidates to
tens of thousands, which is what separates "these features carry nothing" from "this interval was too
short to tell". It needs its own table, ingest path, Gate 0 and independent review before a single
row of it is trained on.

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

Proposer and Recorder for this change are the same session, which also wrote the reading above, so
this is not independent review and cannot approve itself. The owner executed the run; the reported
numbers were relayed from that machine's `report_scores` output, and the authoritative artifacts —
`snapshot.json`, `candidates.jsonl`, `predictions.jsonl`, `summary.json`, the twelve model files and
`verification-v2.json` — are local to it, under `E:\GPT\local-research-data\hybrid-ml\run-v2` with
run id `2da55b96-1b8d-403d-9c82-f75daa3f4e4d`.

Independent reviewer remains unassigned. A reviewer should re-run the tests, repeat the v1
byte-identical regression, run the export SELECT themselves, check that the scope widening did not
quietly change the measurement, and read the scores off `summary.json` directly rather than off this
document. The negative reading deserves the same scrutiny a positive one would get: a bug that
handicaps the fitted models would produce exactly this table.

No production change: no migration applied (0035 still unapplied), no Edge Function deployed, no data
written, no rule, filter, Telegram or ATAS DLL change, no `public.experiments` row. Every database
statement in this session was a SELECT. Rollback is a source revert; there is no runtime state and no
model artifact in the repository.
