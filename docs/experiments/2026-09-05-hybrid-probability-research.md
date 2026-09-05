# MNQ / GC hybrid probability research: direction, rejection/continuation and event time

Status: **design + data-readiness work; no model trained, no edge verdict, no production switch**.
Date: 2026-09-05. Source baseline: `b27cfd27db87d4e3ee746d33a4f71ef31fcaedbc`.
Branch: `codex/hybrid-ml-research`. Related gates: HANDOFF §0M, §0L, §5.20–5.23 and
`docs/EXPERIMENT_REVIEW_PROTOCOL.md`.

## 1. Requirement refinement

| Field | Contract |
|---|---|
| OBJECTIVE | ประเมินโอกาสขึ้น/ลง, reject/วิ่งต่อที่ระดับราคา และช่วงเวลาที่จะเกิด โดยใช้ ML ร่วมกับ ATAS order flow แล้วพิสูจน์ย้อนหลังและ forward ก่อนใช้งาน |
| CONFIRMED | เจ้าของขอเริ่มวิจัยคู่ขนานระหว่างรอ review 0036; ใช้ข้อมูลที่มี; สนใจวิธีคณิตศาสตร์และ ML นอกเหนือจากกฎเดิม; คำสั่งล่าสุดจำกัดเฉพาะ MNQ กับ GC เท่านั้น |
| INFERRED | ใช้ข้อมูล 5m ของ MNQ และ GC; MNQ ในช่วงข้อมูลที่ตรวจมี symbol `MNQU6` |
| ASSUMPTIONS | Development sandbox ใช้ `[2026-08-28,2026-09-04)` UTC; horizon 3/6/10 แท่งเป็น candidate design (15/30/50 นาทีเมื่อข้อมูลต่อเนื่อง); ไม่ใช่เกณฑ์ที่ได้จากการดูผล |
| UNKNOWN | ความถูกต้องย้อนหลังของ period/footprint, exchange/session calendars, fill/latency, fees/spread/slippage, independent sessions ที่เพียงพอ, final holdout และผู้ตรวจอิสระ |
| IN SCOPE | MNQ/GC เท่านั้น: literature/capability audit, outcome-blind Gate 0, frozen data contract, backtest design, execution handoff |
| OUT OF SCOPE | ตลาดอื่นรวมถึง BTC/NQ ทั้งใน feature inputs, dataset, training และ evaluation; production model/filter/Telegram, เปลี่ยนกฎหรือ trail, Phase 2 rescore, รัน V4 verdict หรือกิน OOS ที่จองไว้, ซื้อข้อมูล/ส่งคำสั่งเทรด |
| CONSTRAINTS | Preserve original runtime; one research stage at a time; no claim of superiority from reused development history; proposer/executor cannot approve their own work |
| TASK | ตรวจข้อมูล → freeze labels/features/splits → implement/test offline → baseline/challenger backtest → raw independent re-run → new forward shadow → owner decision |
| ACCEPTANCE CRITERIA | ความน่าจะเป็นผ่านการตรวจ calibration บนข้อมูลที่ไม่ใช้ฝึก; เทียบ baseline บน opportunity set ครบ; ต้นทุน/coverage/drawdown ชัด; raw artifact ทำซ้ำได้; ถ้าข้อมูลไม่พอให้ INCONCLUSIVE |

“ดีที่สุดในโลก” เป็นความมุ่งหวัง ไม่ใช่เกณฑ์ที่ตรวจรับได้ในโครงการนี้. เกณฑ์ที่ใช้ได้คือดีกว่า
baseline ที่ระบุ ภายใต้ข้อมูล/ตลาด/ต้นทุน/ช่วงเวลาที่ระบุ พร้อมหลักฐานนอกชุดพัฒนา.

## 2. Roles and independent lanes

- Owner: project owner, requesting this research; production decisions remain separate.
- Research proposer: owner defines the objective; GPT/Codex and literature helper draft these candidate methods.
- Gate 0 executor/recorder: GPT/Codex, using SELECT queries only; readiness counts are not hypothesis verdicts.
- Model executor: **unassigned**, must be a separate session that did not propose the hypothesis.
- Independent reviewer: **unassigned**, must not be its proposer or executor and must re-query raw artifacts.
- Claude is the project's preferred mechanism/bias challenger. A literature helper is not an independent sign-off.

This work does not certify 0036 or unblock §5.23 Phase 2. Outcome-blind census and local engineering
preparation can proceed while it is reviewed. The O2/per-opportunity/block-resampling requirements still
apply before claims of statistically superior trading performance. Local files are not a shortcut around them.

## 3. What exists, and what would be new

Verified source registry `supabase/functions/_shared/rules/index.ts` has eight evaluators:
stacked imbalance, delta divergence, absorption, POC shift, delta flip, LVN, naked POC and speed of tape.
Price-action context and candle-signature H4 research also exist. Repackaging these as new indicators
would not meet the requested objective. `confidence_v2.ts` explicitly returns `score: null` with
`no_calibrated_model`; the legacy threshold score is not a probability forecast.

ATAS already provides footprint/imbalance filtering in
[Cluster Search](https://help.atas.net/en/support/solutions/articles/72000602240-cluster-search), and
[Options Expected Move](https://help.atas.net/en/support/solutions/articles/72000661535-options-expected-move)
uses option-implied information to show a movement range. Therefore we cannot claim ATAS has no
mathematical/probability indicators. A custom calibrated model of direction, level-event type and event
time was **not identified in the built-ins reviewed**; absence across every third-party plugin is UNVERIFIED.

The proposed addition is a probability model over defined future events, with uncertainty and an explicit
“insufficient evidence / abstain” result, combining price context and order-flow observations.

## 4. Data contract and known limitations

Actual schema: `supabase/migrations/0001_schema.sql`; shapes: `_shared/types.ts`;
writer: `_shared/ingest.ts`; ATAS producer: `SignalBridgeIndicator.cs`.

| Data | Source support | Research use / limit |
|---|---|---|
| Closed OHLCV bars, delta, min/max delta, POC | `bars` | Causal features at bar close; an OHLC bar cannot reveal the order of high/low touches |
| Executed bid/ask volume by price | `cluster_levels` | Footprint concentration and flow features, subject to coverage/reconciliation; this is not resting DOM queue size |
| Tick counts | `bars.ticks` and level ticks | Producer sums emitted footprint ticks; meaning still needs feed/ATAS validation before trade-intensity claims |
| Trade count field | `bars.trades` | Historically unassigned by producer; report zeros separately, do not silently replace it with ticks |
| Instrument units | `instruments.tick_size`, `tick_value`, symbol/exchange | Validate MNQ/GC contract, venue and units; do not pool their returns in raw ticks |
| Snapshot provenance | `bars.updated_at` | Latest write only; no immutable record of the original bar/footprint or exact arrival latency |
| Tick event sequence / historical order-book depth | Not present in inspected schema | Hawkes with cancellations, queue models and tick-level event ordering cannot be reconstructed from 5m footprints |

**Data checks come before model choice:**

1. Audit labelled timeframe, closed flag, pre-feed rows, exact timestamp grid, OHLC inequalities,
   nonnegative volumes/counts, instrument units, duplicates and gaps; keep a reason census.
2. Use `mod(extract(epoch from opened_at),300)=0` without rounding epoch to bigint. Fractional timestamps
   can otherwise round onto the grid. Grid alignment is necessary here, but is not proof of actual chart period.
3. Do not interpolate through gaps or across futures contract changes. A missing future bar is censored
   history, not a negative label or a full-horizon timeout. Session calendars must be versioned.
4. `MaxLevels` defaults to 1000 and may truncate the emitted footprint. Bar volume/delta and emitted
   level sums have different provenance; deviations need diagnosis, not automatic equality assumptions.
5. The writer upserts level keys without deleting old prices. Replacing a bar from another period or
   revised payload can retain stale levels. Reconciliation detects some problems; a passing sum cannot
   prove every historical level or grid-aligned bar is authentic.
6. Reconstruct rolling features using only verified past data. Removing bad signal bars alone does not
   remove their influence from rolling windows or old Confidence v2 snapshots.
7. The owner's latest scope is **MNQ and GC only**, including feature inputs, training and evaluation.
   This historical window uses exact symbols `MNQU6` and `GC`; the latter's delivery-contract provenance
   still needs verification. Future MNQ contracts require explicit identities and roll handling, never
   silent concatenation. Report each market separately and use synchronized time splits.

Canonical Gate 0 query: `docs/queries/hybrid_ml_data_gate0.sql`. Its outputs describe data support only;
they do not read trading outcomes or select a profitable model. Store its complete result with query SHA,
source commit, timestamp and row count. Detailed execution status is in HANDOFF's latest section.

## 5. Candidate model design (not an accepted hypothesis)

Start with one model family and at most one challenger, not a contest among dozens of algorithms.

| Method | Mathematical role | Priority and evidence |
|---|---|---|
| Regularized discrete-time competing-risk model | Predicts event type and first-event time jointly; simple multinomial hazard baseline | Start here; the competing-risk formulation is established, but transfer to price events is our unproven design. [DeepHit paper](https://ojs.aaai.org/index.php/AAAI/article/view/11842) is a later neural extension, not justification to start with deep learning |
| Shallow gradient boosting with separate temporal calibration | Captures nonlinear price × flow interactions | One challenger against the simple baseline, with fixed capacity and all attempts logged. Calibration data must be separate from training. [scikit-learn calibration](https://scikit-learn.org/stable/modules/calibration.html) |
| Bayesian online change-point detection | Posterior over run length / evidence of a regime change | Later single ablation. Change probability is not direction probability; causal filtering only. [Adams & MacKay](https://arxiv.org/abs/0710.3742) |
| Low-order mathematical path signatures | Encodes ordered interactions of normalized price, delta, volume and time over past windows | Later research. These iterated-integral features differ from the repo's candle-signature thresholds; 5m inputs cannot restore tick ordering. [Chevyrev & Kormilitzin](https://arxiv.org/abs/1603.03788) |
| Queue imbalance and Hawkes processes | Models resting-book pressure or excitation of timestamped events | Deferred until actual historical book/tick events exist. [Gould & Bonart](https://arxiv.org/abs/1512.03492), [Bacry et al.](https://arxiv.org/abs/1502.04592) |

“Global strategies” should become a small catalog of mechanisms (continuation, failed breakout/rejection,
mean reversion, liquidity pressure), each with a falsifiable event definition. Voting many correlated
indicators together is not evidence of extra information. Test incremental value against price-only,
order-flow-only and combined features on the same population before building an ensemble.

### 5.1 Direction as a first-passage probability

At decision time t (after a verified bar closes), freeze reference price p and a past-only scale s > 0.
Candidate design: two tick-rounded barriers p+s and p-s and maximum horizon H=10 consecutive 5m bars.
The scale definition/multiplier must be frozen before outcomes are read; it is not necessarily trade risk R.

Predict the first upper touch, first lower touch, or survival without either touch by horizon h.
This answers “which meaningful move first?”; it is different from “will close[t+h] exceed close[t]?”
Do not mix these labels or display one as the other.

### 5.2 Rejection versus continuation at a known level

Freeze level L from information strictly before the event bar, its source/version and the side from which
price approached. Initial level candidates are prior-window high/low or an already-known POC, not
future-confirmed pivots. The selected level family and deterministic collision priority need registration.

After an observed touch, issue the forecast at the touch bar's close. Forecasts using the completed
footprint cannot be claimed to have been available before that touch. Let a be approach direction (+1/-1).
Continuation barrier = L+a*s; rejection barrier = L-a*s. If the decision close is already outside either
barrier, record `already_resolved_at_decision` and exclude from new forecasts with a counted reason.
Track the first event after the decision; retests and overlapping touches need a fixed re-arm/cooldown rule.

### 5.3 “When” is a distribution, not an exact timestamp

For event e and future bar k, define the conditional hazard

`q[e,k] = P(T=k, E=e | T>=k, information available at t)`.

With hazards for the two competing events summing to at most one:

`S(0)=1; S(k)=S(k-1)*(1-q[up,k]-q[down,k])`

`F[e,h]=sum(k=1..h, S(k-1)*q[e,k])`.

For rejection/continuation use those event names in the same construction. Every displayed horizon
must satisfy `F[first event,h]+F[other event,h]+S(h)=1`. Report cumulative probabilities at 15/30/50
minutes only when strict bar adjacency is verified. Report a conditional event-time interval if estimable;
if the median lies beyond H or evidence is insufficient, return “not established within horizon”.

If both barriers are reached in one OHLC bar, preserve `ambiguous_intrabar`. Do not assign a favorable
ordering, fabricate ticks, or silently discard such cases to improve accuracy. Freeze competing-label
bounds/sensitivity or an explicit ambiguity model before training. Data loss and unknown ordering are
different from a valid, complete horizon with no event.

## 6. Backtest design and acceptance before implementation

1. **Freeze the dataset.** Read-only export to local storage, raw file SHA256, row counts, query hash,
   timestamp, units, exclusions and known provenance failures. No experimental writes to `public.signals`.
2. **Freeze the event builder.** Unique instrument/exchange/contract/time/event/level key, available_at,
   feature window, barriers, horizon, event/censor time, ambiguity and every exclusion reason.
3. **Test label causality.** Prefix invariance for features; changing future prices must not alter past
   features/level selection. Test high+low in the same bar, missing bars, gaps at split boundaries, session
   end, absent footprint, contract rolls and invalid units with synthetic fixtures.
4. **Split by time across all instruments.** Train → calibration → evaluation; purge any training label
   whose event interval crosses the next partition. Do not treat random row splits or default CV as
   time-safe. [TimeSeriesSplit documentation](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html)
   explains forward splits/gaps, but event-overlap purging and synchronized panels need an explicit implementation.
5. **Avoid holdout reuse.** The pre-4 Sep history was already inspected by H1/H2/H4 and is exploratory
   development history, even if a model has not seen it. Do not use the shared V4 OOS as a model-selection
   sandbox. Freeze a distinct untouched forward interval and policies before evaluating it.
6. **Freeze an experiment budget.** Baseline class-frequency hazard from training only, regularized
   model, and one shallow challenger; separately declared ablations. Log planned/attempted/failed/omitted
   variants. Hyperparameters, calibration, thresholds and ensemble weights must not learn from final test.
7. **Measure forecast quality.** Out-of-time proper scoring rules (log loss, Brier), reliability bins and
   sample counts, calibration slope/intercept where estimable, event-time/censoring performance and
   direction × instrument × session. A lower Brier score alone does not isolate calibration quality.
8. **Measure decision value separately.** Fixed entry/fill/exit and position overlap policy, commission,
   spread, slippage and latency assumptions; R/trade, R/opportunity, total R, drawdown, fill rate and
   abstention/coverage on every candidate. Until actual costs are supplied, show sensitivity and mark
   net performance UNVERIFIED; do not present zero-cost accuracy as a profitable strategy.
9. **Reuse the canonical trade scorer when applicable.** Do not create a fourth independent price-walk
   for trading P&L. A probability label builder is a different measurement and must not silently modify
   `scorePlan`, trail rules or the live outcome model. Next-open fills are an assumption, not a guaranteed fill.
10. **Quantify dependence.** Protocol minimum is instrument × session blocks. For joint MNQ/GC
    claims, also preserve contemporaneous cross-instrument dependence with synchronized
    session blocks. Row count is not independent sample count. Freeze uncertainty/multiplicity plan first.
11. **Require adequacy, not a borrowed threshold.** V4's 285-per-cell criterion belongs to that experiment.
    ML needs its own class/session coverage and power/calibration-precision calculation. A handful of
    days can validate plumbing; it does not establish probability accuracy across regimes.
12. **Independent raw re-run, then forward shadow.** The researcher cannot approve its own model.
    Only later, with accepted evidence and a documented rollback, may the owner approve a live signal path.

Complexity is accepted only when it adds reproducible value beyond the baseline. A result can be
FAIL, INCONCLUSIVE or a candidate for further forward evidence. No model is labelled VALIDATED here.

## 7. Evidence packet for this stage

```text
Hypothesis / estimand: none adjudicated; candidate designs in section 5, data feasibility only
Proposer: owner objective; GPT/Codex literature/method draft
Executor/Recorder: GPT/Codex for Gate 0 only; model executor unassigned
Independent Reviewer: unassigned; no sign-off
Owner approval required (L1-L4): L1 evidence for counts; L2 before verdict if gates fail;
  L3 separate approval for runtime/filter/alerts; L4 execution is outside scope
Pre-registered variants and failure criteria: draft only, section 6; no sweep authorised by this document
Exact experiment_id(s): none; no experiments row or model run created
Code / evaluator / query commit: source base b27cfd2; use commit introducing this document/query
Data window, timezone, bar cap, instruments, sessions:
  development [2026-08-28,2026-09-04) UTC; MNQ (MNQU6) and GC only; 5m; no tail cap; instrument ID + exchange;
  available session support comes from Gate 0, not old Handoff counts
Gate 0 artifact: docs/queries/hybrid_ml_data_gate0.sql; execution record in latest HANDOFF
Attempted variants: none
Succeeded variants: none
Failed variants: none
Planned but not run variants: all model/ablation candidates; pending data and protocol gates
Run but not reported variants: none
Superseded or post-hoc variants: no model variants; initial four-market census superseded by owner scope
  change to MNQ/GC only; earlier aggregates retained locally; browser attempt had no verified result
Baseline and variant metrics: NOT RUN; no accuracy, R, drawdown or calibration result
Per-opportunity artifact version: not implemented; required before inferential comparisons
Uncertainty method and resampling unit: draft section 6; not yet executed
What would falsify the conclusion: no edge conclusion; proposals can fail adequacy,
  causality, calibration, cost-adjusted value or stability checks
Independent re-run result and timestamp: no completed SELECT; raw-data reviewer hit npm EPERM and
  its escalated retry was aborted; no independent database timestamp. Model review remains unassigned.
Decision: provisional research design
Runtime change, deploy, rollback: none; revert research commit for source rollback
```

## 8. Next execution contract

ROLE: Separate GPT/Codex model Executor/Recorder; independent reviewer must be another session.
OBJECTIVE: Turn sections 4–6 into a minimal reproducible MNQ/GC-only offline backtest after data review.
PROBLEM: Existing threshold indicators do not provide validated event probabilities or event-time forecasts.
CURRENT CONTEXT: Read this document, latest HANDOFF, protocol and Gate 0 raw artifact first.
IN SCOPE: MNQ (current historical MNQU6) and GC only; freeze clean local dataset, event builder,
temporal splits, baseline/challenger and complete artifacts.
OUT OF SCOPE: Other markets as inputs or targets, production, V4/OOS interference, 0036 sign-off,
new trade scorer, order execution.
CONSTRAINTS: No inherited training result; owner costs/latency are inputs, not invented facts.
TASK: Resolve quality flags → freeze protocol before outcomes → implement causal tests → execute all
declared variants → record complete results → send raw artifacts to the independent reviewer.
IMPLEMENTATION RULES: Minimum change, isolated research code, pin dependencies, deterministic seeds,
no credential output, no market-data files committed publicly without a separate sharing decision.
DELIVERABLES: Dataset/run manifests, candidate-level artifacts, metrics including failures/abstentions,
reproduction commands and updated HANDOFF.
ACCEPTANCE CRITERIA: Tests verify causality/labels/splits; every numerical claim has raw evidence;
insufficient-data cells remain INCONCLUSIVE; no production behavior changes.
DEFINITION OF DONE: Engineering run is reproducible and documented; scientific acceptance remains
pending until the independent reviewer re-runs it and the owner decides the next stage.
