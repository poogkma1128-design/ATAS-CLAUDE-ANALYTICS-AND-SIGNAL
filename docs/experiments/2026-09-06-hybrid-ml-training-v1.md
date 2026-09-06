# MNQ / GC exploratory training v1

Owner explicitly requested "ฝีกเลย" after receiving the data-quality findings, then requested continuation.
This authorizes an offline exploratory fit; it does not establish historical authenticity, predictive edge,
or permission to deploy. **Actual status: exploratory training and forecast replay completed; no
independent scientific acceptance or production permission.**

## Frozen measurement before price export

Source baseline: `c8a0e70b94de83debec4b895780aa18b63e061e2`. Machine-readable specification:
`research/hybrid_ml/config_v1.json`, frozen 2026-09-05 14:02:07 UTC before exporting price paths.
Only `MNQU6` and `GC`, using the existing development interval `[2026-08-28,2026-09-04)` UTC.
No reserved V4 OOS, random split, market pooling or parameter sweep.

- Decision is bar close. Training decisions precede Sep 2 UTC; Sep 2 is calibration; Sep 3 is evaluation.
  Purge every candidate whose maximum 50-minute horizon reaches its partition end, irrespective of
  whether an event occurs early. These partitions are reused development history, not pristine OOS.
- Twelve previous true ranges define the scale (13 predecessor closes needed), bounded below by a tick.
  Current footprint must reconcile. Historical price/volume features require contiguous valid bars;
  historical footprint values are not features. For the level task the previous footprint must also reconcile.
- This is a new frozen feature definition, not the earlier 50-bar full-footprint availability diagnostic.
  It was selected from outcome-blind coverage limitations before exporting outcomes, not by comparing scores.
  Neither definition repairs missing chart-period or original-arrival provenance.
- Direction labels are first passage of close ± one scale over ten future bars. They are not terminal
  close direction or profitable trade labels. Level labels use the previous emitted-footprint POC,
  current touch and prior-close approach direction; predict continuation/rejection from the decision onward.
- Outward tick rounding; already-resolved level events excluded with reasons; no optimized cooldown.
  Both barriers in one OHLC bar yield a separate ambiguous cause. A missing/invalid future price bar
  censors observation immediately. Future footprint quality never determines eligibility or censoring.
- Per market and task, fit a Laplace-smoothed per-bin hazard baseline, L2 logistic regression, and
  shallow histogram gradient boosting. All settings are in the frozen config. No best-model selection.
  Fit temperature on calibration risk rows only if the fixed support requirement is met; otherwise
  preserve the uncalibrated model and record why calibration did not run.
- Report four-class cumulative probabilities (two events, ambiguity, no event) at 15/30/50 minutes,
  probability conservation, log loss, multiclass Brier, accuracy, calibration-bin counts and coverage.
  Censored/unobservable labels remain in the candidate ledger and denominator accounting.
  No net P&L claim: fees, fills, latency and the canonical trading scorer are not part of this forecast replay.

## Roles, evidence and boundaries

Owner: project owner. Proposer: prior GPT/Codex method draft and frozen v1 specification.
Initial Executor: separate `ml_executor` agent, which produced a partial candidate builder before interruption.
Continuation Executor/Recorder: root GPT/Codex, at the owner's request. These roles overlap in the continuation;
there is **no independent sign-off** and the root cannot approve its own results. Independent reviewer is
unassigned. Results must remain provisional even if engineering tests and deterministic replay pass.

Raw prices, candidate-level predictions and fitted models stay outside Git under local-research-data.
Record source/config/query/snapshot hashes, exact local run ID, all attempted/succeeded/failed/omitted models,
tests and aggregate metrics. No `public.experiments` row, migration, signal, alert, strategy rule or runtime
setting is written. L2 remains on scientific validation; this run exercises the offline pipeline.

Acceptance for this engineering stage: actual saved models or explicitly failed cells, deterministic
candidate ledger and replay, meaningful causality/purging tests, complete evidence and reproducible commands.
This is not acceptance of trading performance. Rollback is a source revert; local runs remain immutable.

## Execution results

Final local run ID: `80c96e5d-7054-4df6-8330-d62a608a4c12` (not a `public.experiments` ID).
Started **2026-09-06 03:59:05 UTC**, completed **03:59:09 UTC**. Export SELECT returned **3,382 bars**
at **03:50:19.277948 UTC**; complete price snapshot is local only. Snapshot SHA256:
`9f700e35a5362053ba9650b9f0c1391b6518f7e947b652e5b2092f9f073b697f`.

**12/12 model cells fitted**, comprising 8 ML estimators plus 4 frequency baselines. All 8 ML
temperature fits had the specified calibration support. There are **20 raw/temperature scoring variants**,
not 20 independently trained models. No sweep or outcome-driven model selection was run.

The complete aggregate packet contains every horizon (15/30/50 minutes), every raw/calibrated variant,
reliability-bin counts, feature census, exclusion/censor counts, source/config/query hashes, manifests and
replay evidence: [`evidence/2026-09-06-hybrid-ml-training-v1.json`](evidence/2026-09-06-hybrid-ml-training-v1.json).
Packet byte SHA256: `9145878a8951f34eb7133c90522a4d1ae67d055145fc5a2be4ef613a6edddff9`.

| Market / task | Train | Calibration | Evaluation eligible / scored at 50m |
|---|---:|---:|---:|
| MNQU6 / direction | 326 | 98 | 204 / 202 |
| MNQU6 / level | 175 | 38 | 107 / 107 |
| GC / direction | 286 | 110 | 117 / 113 |
| GC / level | 116 | 42 | 44 / 43 |

Below is the frozen maximum 50-minute horizon on **Sep 3 UTC only**, not a selected best horizon.
Brier is the sum of four squared probability errors; lower Brier/log loss is better. Accuracy includes
ambiguous and no-event classes; **it is not binary direction accuracy or trading win rate**.

| Market / task | Variant | Brier | Log loss | Accuracy (four classes) |
|---|---|---:|---:|---:|
| MNQU6 / direction | baseline / raw | 0.572274 | 0.960468 | 42.57% |
| MNQU6 / direction | logistic / raw | 0.597961 | 0.982129 | 45.05% |
| MNQU6 / direction | logistic / temperature | 0.586992 | 0.959469 | 45.05% |
| MNQU6 / direction | boosting / raw | 0.642330 | 1.131934 | 43.07% |
| MNQU6 / direction | boosting / temperature | 0.623686 | 1.104347 | 44.06% |
| MNQU6 / level | baseline / raw | 0.572544 | 0.961665 | 42.06% |
| MNQU6 / level | logistic / raw | 0.564194 | 0.895109 | 52.34% |
| MNQU6 / level | logistic / temperature | 0.560808 | 0.919870 | 53.27% |
| MNQU6 / level | boosting / raw | 0.551838 | 1.012092 | 57.94% |
| MNQU6 / level | boosting / temperature | 0.535257 | 1.062953 | 60.75% |
| GC / direction | baseline / raw | 0.660844 | 1.148639 | 36.28% |
| GC / direction | logistic / raw | 0.746137 | 1.290510 | 37.17% |
| GC / direction | logistic / temperature | 0.725190 | 1.261203 | 38.94% |
| GC / direction | boosting / raw | 0.791763 | 1.458586 | 38.05% |
| GC / direction | boosting / temperature | 0.754389 | 1.428566 | 38.05% |
| GC / level | baseline / raw | 0.610389 | 1.098843 | 41.86% |
| GC / level | logistic / raw | 0.642308 | 1.128346 | 55.81% |
| GC / level | logistic / temperature | 0.630507 | 1.191138 | 51.16% |
| GC / level | boosting / raw | 0.687633 | 1.263234 | 44.19% |
| GC / level | boosting / temperature | 0.643206 | 1.356013 | 44.19% |

Descriptively, MNQ level-event ML has lower Brier than the frequency baseline in this interval, but
boosting has worse log loss. GC ML has worse Brier and log loss than its baseline in both tasks here.
These observations do not establish significance, robustness or reliable probability calibration;
an increased classification accuracy alone is insufficient. No model is promoted or declared a winner.
The small samples, reused history, overlapping windows and unresolved source provenance remain material.

### Verification and complete attempts

- **19 synthetic tests passed**: prefix/future mutation invariance, exact grid and reconciliation,
  missing-history exclusion, censoring vs timeout, ambiguity, level mapping, purging, scope/holdout
  rejection, mass conservation, train-only scaling and calibration without refitting base estimators.
- `pip check` passed with the five pinned Python packages. Python **3.12.14**. Training uses one
  numerical thread. Windows emitted a physical-core detection warning and used logical-core metadata;
  execution succeeded. No GPU or OpenAI API inference is used in these ML models.
- Reloaded all **12 saved models**, rebuilt **6,764 ledger rows**, checked **8,315 prediction rows**
  and independently recomputed formulas for **180 metric rows** in the same recorder's verification
  script. All matched. This is **engineering replay, not an independent reviewer sign-off**.
- First completed local run `06817a4b-894b-48d7-b847-26affba12f3a` is preserved. The final run fixes
  relative config-path handling and makes saved-model default inference use its fitted temperature.
  Frozen features/parameters, every candidate census, calibration result and score are unchanged.
  Both runs fitted 12 cells; no failed model cell. This was an engineering rerun, not a search for scores.
- First export attempt failed before SQL with npm cache `EPERM`; an escalated SELECT retry succeeded.
  Both directories are preserved. No application database rows were written.
- Planned later price-only/order-flow-only ablations, BOCPD/signatures, genuine forward OOS and
  trade-execution/cost backtesting are **not run in v1**, not silently omitted successful variants.

## Reproduce and load artifacts

See `research/hybrid_ml/README.md` for installation, export, training, replay and model-loading commands.
Final model directory:
`E:\GPT\local-research-data\hybrid-ml\run-20260906-v1-final`.
Raw snapshot:
`E:\GPT\local-research-data\hybrid-ml\snapshot-20260906-v1-retry\snapshot.json`.
Reuse that exact snapshot for reproduction; a fresh SELECT creates a different, mutable snapshot.

## Next owner and acceptance

The requested exploratory fit is complete. Independent reviewer remains unassigned and must rerun
the raw local artifacts plus source-query evidence, challenge leakage/measurement/censoring and record
a provisional or rejected judgment. Before any deployment, resolve period/contract/arrival provenance,
obtain more verified history and a distinct untouched forward window, and evaluate trade costs separately.
Do not tune against the displayed evaluation table or reuse it as a new untouched holdout.

### Standalone review contract

```text
ROLE: Independent Reviewer, not a proposer or executor of this v1 run.
OBJECTIVE: Verify the engineering claims and determine what the MNQ/GC exploratory evidence supports.
PROBLEM: Training completed, but source authenticity, sample adequacy and predictive superiority are unproven.
CURRENT CONTEXT: Repository E:\GPT\ATAS-CLAUDE-ANALYTICS-AND-SIGNAL, branch codex/hybrid-ml-research.
Read AGENTS.md, complete docs/HANDOFF.md, docs/EXPERIMENT_REVIEW_PROTOCOL.md,
docs/experiments/2026-09-06-hybrid-ml-training-v1.md and the complete evidence JSON before reviewing.
Final run ID: 80c96e5d-7054-4df6-8330-d62a608a4c12. Local models and raw artifacts:
E:\GPT\local-research-data\hybrid-ml\run-20260906-v1-final.
Raw snapshot: E:\GPT\local-research-data\hybrid-ml\snapshot-20260906-v1-retry\snapshot.json.
IN SCOPE: Independently rerun raw-artifact checks, all candidate exclusions, labels, purging,
calibration, every reported metric and source-query/data provenance checks for MNQU6/GC only.
OUT OF SCOPE: Parameter tuning, new models, other markets, production changes, data repair,
reserved V4 OOS, order execution, declaring profitability from classification accuracy.
CONSTRAINTS: Raw prices/models are intentionally not in Git; use this host's local artifacts.
If inaccessible, mark raw review UNVERIFIED, never endorse from the narrative alone.
TASK: Check code/config/data hashes -> reconstruct candidates -> verify signal-time causality and
ambiguity/censoring -> reproduce model predictions and scores -> challenge calibration, dependence,
source-period/contract/arrival claims -> record exact evidence and provisional or rejected findings.
IMPLEMENTATION RULES: Read-only queries, isolated new local output directory, no secret output,
no overwrite of evidence, no production writes, no self-approval by previous participants.
DELIVERABLES: Reproduction commands/timestamps, exact run/source identities, findings with file lines,
and separate engineering, data-validity and statistical judgments.
ACCEPTANCE CRITERIA: Every claim checked against raw evidence; omitted/failed/superseded attempts
accounted for; gaps and limitations remain explicit; no unsupported independent-sample or edge claim.
DEFINITION OF DONE: Document reviewer identity and raw re-run evidence in Handoff. Owner alone
decides later runtime use after adequate fresh evidence; a passing code replay cannot authorize it.
```

## Method references

Implementation uses [LogisticRegression](https://scikit-learn.org/1.7/modules/generated/sklearn.linear_model.LogisticRegression.html),
[HistGradientBoostingClassifier](https://scikit-learn.org/1.7/modules/generated/sklearn.ensemble.HistGradientBoostingClassifier.html)
and temporally separate [probability calibration](https://scikit-learn.org/1.7/modules/calibration.html).
The causal event definitions above are this project's exploratory measurement, not a proven financial edge.
