# MNQ / GC hybrid ML data readiness — observed data defects, model run not started

Gate 0 run ID (local evidence, **not** a `public.experiments` ID):
`a533b89c-616f-4812-a139-88fdaad89dc1`.

Observed at **2026-09-05 13:42:56.255496 UTC** (20:42:56 Bangkok).
Project: `sckdriuwfyittcybnbhz` (`atas-signal`). Development interval:
**2026-08-28 00:00 UTC ≤ opened_at < 2026-09-04 00:00 UTC**.
This window was chosen before reading outcomes and does not authorize any V4/OOS use.
The owner's latest instruction restricts this work to **MNQ and GC only**. The exact symbols in
this snapshot are `MNQU6` and `GC`; both SELECT queries filter them before calculating diagnostics.
No other market is an input or evaluation target in the current research design.

## 1. What was executed

Executed `docs/queries/hybrid_ml_data_gate0.sql` against the live project using an existing authenticated
Supabase CLI session. The file is one SELECT statement. It returned one complete JSON artifact;
process exit code was 0. It reads timestamp coverage, data integrity and footprint reconciliation.
The horizon availability branch reads timestamps, not forward returns or trading outcomes.

The complete aggregate result is in
[`evidence/2026-09-05-hybrid-ml-gate0.json`](evidence/2026-09-05-hybrid-ml-gate0.json).
It contains counts/metadata, **no raw price paths, credentials or fitted-model results**.
Tables below were reduced deterministically from that JSON using grouped sums, not calculated by an AI
from a narrative. Days are distinct UTC dates, not proven independent trading sessions.

| Instrument | On-grid closed bars | UTC days with on-grid bars | Off-grid closed bars | On-grid bars with footprint ticks mismatch | Footprint levels outside on-grid bar high/low |
|---|---:|---:|---:|---:|---:|
| GC | 1,279 | 6 | 112 | 675 | 2,941 |
| MNQU6 | 1,286 | 6 | 705 | 580 | 1,620 |

Across the **2,565 on-grid closed bars**, **1,255 bars** have level-tick sums different from `bars.ticks`,
and **4,561 individual level rows** lie outside their parent bar's high/low. These are different units and
overlapping diagnostic categories: do not add them or interpret either as a count of all unusable bars.

Every on-grid bar has footprint rows. Basic OHLC, volume, negative-tick and invalid-level-value checks
reported zero defects there; that does **not** override the reconciliation failures. `bars.trades=0`
for all 2,565, consistent with the producer's historically unassigned field. `updated_at` was at/after
the development cutoff for 131 on-grid rows; that is evidence of a later write, not proof that their
economic contents changed or that the original contents are recoverable.

### Exact timestamp diagnostic

The exact numeric modulo check catches **7 development rows** that the legacy rounded-to-bigint
epoch check considers aligned: GC 1, MNQU6 6. This is a comparison of two
definitions on the same frozen window, not a claim that all those rows arrived since the prior Handoff.
The `0035` quarantine reviewer must assess this rounding behavior before accepting its census.
This task did not modify or apply migration 0035.

### Availability alone

| Instrument | 50 prior bars + 15m horizon | +30m horizon | +50m horizon |
|---|---:|---:|---:|
| GC | 887 | 869 | 845 |
| MNQU6 | 944 | 926 | 902 |

These are **clock-only candidates**. They have exact 5-minute spacing for the specified history and
future range, but are not certified clean features/labels, level-touch events, class-balanced samples
or independent observations. No price-quality filter or favorable-outcome selection is applied to these counts.

### Conservative reconciliation follow-up (2026-09-05 13:45:43.799392 UTC)

Executed `docs/queries/hybrid_ml_reconciled_clock_gate0.sql` separately, exit code 0. It requires
positive volume/tick size, valid OHLC inequalities, footprint presence, matching ask/bid/ticks sums
within the stated rounding tolerance and no level outside the bar. It is a diagnostic subset, not
a complete authenticity test or model-selection result. The complete parsed rows and query hashes are in
[`evidence/2026-09-05-hybrid-ml-reconciled-clock.json`](evidence/2026-09-05-hybrid-ml-reconciled-clock.json).

| Instrument | Bars passing these reconciliation checks | 50 consecutive passing predecessors | Same history +10 consecutive passing future bars |
|---|---:|---:|---:|
| GC | 604 | 36 | 23 |
| MNQU6 | 706 | 224 | 174 |

The future footprint-quality restriction is **only for conservative availability measurement**.
Do not use future quality as an at-decision trading filter: a real dataset must retain all candidates
known at the decision and record subsequent data loss/censoring. These windows overlap and can cross
UTC date boundaries. They do not establish effective sample size, calibrated probabilities, or clean
historical arrival-time provenance. In particular, this query does not justify a deep model for GC's 23 windows.

## 2. Interpretation and immediate boundary

`Use current history to certify hybrid-ML accuracy` → **L2** → historical footprint/bar consistency
and snapshot provenance are unproven → fitting could learn corrupted features and misstate probability
quality → data engineering Executor + independent raw reviewer → resolve/version the dataset and
event definitions before training or claiming a result.

Source inspection identifies a plausible mechanism: `ingest.ts` upserts price-level keys and does not
remove old prices if a later payload replaces a bar or contains fewer levels. `MaxLevels` can also cap
the emitted footprint. **The census does not prove the cause of each mismatch**; feed semantics,
truncation, revisions and period contamination must be distinguished. Do not silently repair footprints
by forcing sums to equal bar totals, delete historical evidence, or call passing bars authentic by default.

Useful parallel work now: finalize measurement design, prepare causal label/split tests with synthetic
fixtures, characterize data failures and define a clean export contract. The full model/backtest is **NOT RUN**.
There is no accuracy, win rate, edge, probability calibration or “best strategy” result from this task.

Suggested data follow-up (separate bounded work): independently diagnose retained level rows and exact
grid failures, identify a verifiable source/snapshot, quarantine only in a local research copy with a
complete reason census, and determine whether enough contiguous history remains for development.
A tick/DOM data purchase or historical ATAS re-import is not authorized by this research record.

## 3. Reproduction and evidence identity

Executed CLI version: **2.116.0**, resolved through npm. Installed Scoop executable could not run
(`not a valid application for this OS platform`); this task did not replace it or change system settings.
The CLI project listing reported PostgreSQL `17.6.1.165`; this is platform metadata, not a direct server-version query.

```powershell
npx --yes supabase@2.116.0 db query --linked --project-ref sckdriuwfyittcybnbhz --file docs/queries/hybrid_ml_data_gate0.sql -o json
npx --yes supabase@2.116.0 db query --linked --project-ref sckdriuwfyittcybnbhz --file docs/queries/hybrid_ml_reconciled_clock_gate0.sql -o json
```

This uses the user's existing CLI authentication. Do not put tokens or passwords in the command or Git.
The same development timestamps may have been updated since this run; a later result is a new snapshot
and must not overwrite this evidence silently. The CLI response wrapper has an untrusted-data boundary;
only `rows[0].hybrid_ml_gate0` is the saved aggregate artifact.

| Evidence field | Value |
|---|---|
| Source baseline | `b27cfd27db87d4e3ee746d33a4f71ef31fcaedbc` |
| Query Git blob SHA1 | `cb7d7745545fcf454766687e653afc56e2360537` |
| Query SHA256 at execution (LF bytes) | `86e56f621bf99131100ce0e01666e70c96d84d2c364715c626c45d9a23630ede` |
| Complete JSON SHA256 (saved bytes) | `190bc949a9de604d153560ef237b5c785a7d3e178e521bc5c60c9abd5192a395` |
| Query version | `hybrid-ml-data-gate0-v2-mnq-gc` |
| Exact model experiment IDs | None; no model run and no `experiments` row created |
| Model variants attempted/succeeded/failed | None / none / none |
| Independent diagnostic re-run | UNVERIFIED; separate raw-data reviewer completed no SELECT; see attempt record below |
| Runtime actions | No migrations, data repair, rule/filter changes, deployment or ATAS installation |

Separate raw-data reviewer `/root/raw_data_review` reported no completed SELECT: its first command
failed at npm cache access (`EPERM`), and its escalated retry was aborted without a SQL result.
It has no independent counts or database execution timestamp. Its prepared query predated the
MNQ/GC restriction and is superseded. This is a failed verification attempt, not corroboration;
independent raw review remains pending. The two successful runs above belong to the root recorder.

The initial four-market census (08:31:51 UTC) and follow-up (13:28:36 UTC) predated the owner's
scope restriction. They are superseded for this task, not model variants or evidence of other-market
performance. Their aggregate files were preserved locally under
`E:\GPT\local-research-data\hybrid-ml\superseded-four-market-*.json` before replacing the active
evidence with newly executed MNQ/GC-only queries. No historical source data was deleted.

On Windows, Git may convert working-tree newlines. Use the recorded Git blob for source identity and
compare parsed JSON for semantic equality if line endings change; byte SHA256 is for the captured bytes.
The earlier browser SELECT attempt returned no verified result and is not evidence. The SQL Editor
may retain its automatically saved draft query; no application-data mutation was requested from it.

## 4. Linked design and handoff

The mathematical/ML design and acceptance plan are in
`2026-09-05-hybrid-probability-research.md`. HANDOFF's newest section links both records.
Source rollback: revert the research commit; there are no model/runtime settings to roll back.
Do not mark the overall trading-system objective complete from this feasibility stage.
