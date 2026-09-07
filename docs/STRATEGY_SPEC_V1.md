# Strategy spec v1 — `MNQ_PULLBACK_V1`, `MNQ_REVERSAL_V1`, `GC_SWEEP_V1`

**Status (2026-09-07): all three evaluators implemented for the owner-approved live-preview scope;
production deployment is recorded in HANDOFF §0AG.** `MNQ_PULLBACK_V1` uses its full six-bar durable
setup. `MNQ_REVERSAL_V1` is P-A only. `GC_SWEEP_V1` is S-A Arm 2 in live; Arm 1 remains a registered
backtest comparison through `confirmationMode=return_only`. All three run through the same
`runRules()` path in live ingest and backtest. This is an owner-approved unvalidated preview, not an
edge claim.

It extends `docs/STRATEGY_ENGINE_PLAN.md` §5 and inherits every constraint there. In particular the
design review's verdict still holds: **boolean first.** Nothing in this document produces a numeric
score, a confidence band, or a ranking. Every strategy answers `eligible: true/false`, a direction,
and a closed-vocabulary rejection reason.

Values written as `proposed` are the author's starting point, not evidence. They are frozen into an
immutable strategy version at registration time, before the first run, and they are not owner
decisions yet because the review requires evidence before any of them can be promoted from a
hypothesis.

---

## 1. The shape every strategy shares

The owner replaced evidence-counting with three parts (HANDOFF §0AB.2):

```
eligible location  →  the event that enters  →  the condition that invalidates the reason
```

Everything below applies to all three strategies.

### 1.1 Causality

Every input must be computable from bars at or before the decision bar's close. This is the same rule
`research/hybrid_ml/dataset.py` enforces and the same class of error §0L was. A future bar is an
error, not a row to discard quietly.

### 1.2 Required data is declared per decision path, not per strategy

This is the owner's fourth objection (HANDOFF §0AB.1) turned into a rule. Each path below names the
inputs it needs. If a named input is missing or unreconciled, **that path** rejects with
`data_unavailable:<input>` and the opportunity is recorded as unavailable — never as "no setup", and
never rerouted to a different input as a workaround. A path that does not name an input is not
affected by that input being broken.

This matters concretely. `computeKeyLevels()` returns `previousDayHigh/Low`, `sessionHigh/Low` and
`initialBalanceHigh/Low` from bar extremes, while `vwap`, `vah`, `val` and `sessionPoc` come from the
footprint profile and are nulled together whenever `profileStatus` is not `complete`
(`_shared/key_levels.ts:25-50`). Measured on 2026-09-07, the profile is unusable on **51.0% of GC
bars** and **30.5% of MNQU6 bars** (`docs/queries/strategy_frequency_gate0.sql` §C3). A spec that
demands the profile everywhere therefore loses half of GC for a reason that has nothing to do with
the market. A spec that names bar-extreme levels keeps working on those same bars.

### 1.3 Distances are measured in true range, never in ticks

`instruments.tick_size` is a live value that moves: three of four recorded ticks changed in one day,
and stored rows were divided by two to four different values per instrument (HANDOFF §0AB.6). Until
that is repaired, any predicate measured in ticks is uninterpretable and not comparable across
instruments — which is what §0Y.4 item 3 already forbade.

So every distance in this document is expressed as a multiple of `medianTrueRange`: the median true
range of the same trailing window `computeMarketContext()` uses for its volatility regime, taken from
bars that closed **before** the decision bar, with the same contiguity requirement. If that window
returns `insufficient_history` the distance cannot be evaluated and the path rejects with
`data_unavailable:volatility`.

This is not a workaround. A tick-free distance is comparable across MNQ and GC on its own merits, and
it stays correct after the tick is repaired.

### 1.4 "Or" is frozen before the test

Where a trigger reads "A **or** B", the specification names the exact alternatives and the counting
rule before any run. Which alternative fired is recorded per opportunity so the split can be examined
afterwards, but the choice is never made retrospectively from what won. Adding, removing or
reweighting an alternative creates a new strategy version and restarts evaluation.

### 1.5 One event is one opportunity

A setup that remains true for six bars is one opportunity, not six. Each opportunity carries a
deduplication key:

```
(strategy_key, instrument, direction, anchor_identity, anchor_touch_id)
```

`anchor_identity` names the level the setup is built on (for example `prev_day_high`), and
`anchor_touch_id` is assigned when price first satisfies the eligibility condition against that
anchor. While a touch is open, further bars satisfying the same condition extend it rather than
creating a new opportunity. A new `anchor_touch_id` is issued only after the setup has been closed by
its trigger, its invalidation, or its expiry.

### 1.6 Setup age

An eligible setup that has not triggered expires after `setupMaxAgeBars` bars and closes with
`expired_unfired`. Expiry is not a rejection of the market; it is recorded separately so that
"eligible but never triggered" is countable.

`proposed: setupMaxAgeBars = 6` (30 minutes on 5m bars).

### 1.7 Session is recorded, not gated

The owner trades Asia, Europe, the US open hour and US regular (answers, 2026-09-07), which is
substantially the whole day. So v1 applies **no session filter**. Session is stamped on every
opportunity and reported as a dimension, exactly as HANDOFF §0AB.1 item 3 requires: it starts as
something recorded for analysis, and becomes a gate only if a specific strategy's evidence justifies
one.

Session stamping still needs an owner-approved session definition, which does not exist yet — see §7.

### 1.8 Rejection vocabulary (closed)

An evaluator may emit only these. Adding one requires a new strategy version.

| Reason | Meaning |
|---|---|
| `no_setup` | data was sufficient; the eligibility condition was not met |
| `data_unavailable:<input>` | a named input for this path was missing or unreconciled |
| `insufficient_history` | the trailing window was shorter than `minSamples` or spanned a gap |
| `direction_conflict` | the trigger fired against the direction the setup implies |
| `duplicate_of:<touch_id>` | same event, already counted |
| `expired_unfired` | eligible, never triggered, aged out |
| `invalidated:<condition>` | the reason for the setup stopped holding |

`no_setup` and `data_unavailable:*` must never be merged in any report. That distinction is what
separates "the strategy is selective" from "the system was blind", which HANDOFF §0AB.3 requires.

---

## 2. Owner answers recorded, 2026-09-07

| Question | Answer | Consequence in this spec |
|---|---|---|
| Hours actually traded | Asia, Europe, US open hour, **and** US regular | No session gate in v1 (§1.7); session reported as a dimension |
| `GC_SWEEP_V1` reference levels | prev-day H/L, session H/L, IB H/L, **and** VWAP/VAH/VAL/POC | Four separate registered variants, not one combined requirement (§5); only one can be the primary contrast (§8) |
| `MNQ_PULLBACK_V1` pullback zone | Named price levels | Zone is a named level, not a Fibonacci retracement and not a moving average (§3.1) |

---

## 3. `MNQ_PULLBACK_V1`

**Instrument:** `MNQU6` only. Never pooled with `NQU6` (separate order books — §3 item 3 of the plan).

**Reason for the setup:** there is trend structure, price pulls back into a named zone, and then
confirms a return in the trend direction.

### 3.1 Eligible location

All of:

1. `computeMarketContext().bias` is `bullish` or `bearish` on the decision bar. `neutral` or `null` →
   `no_setup`.
2. The decision bar's low (for `bullish`) or high (for `bearish`) came within
   `zoneProximity × medianTrueRange` of a named anchor level, without the bar closing beyond it.
3. The pullback is a pullback and not a break: the bar closes on the trend side of the anchor.

`proposed: zoneProximity = 0.5`

**Anchor levels, each its own path:**

| Path | Anchor | Inputs it needs | Survives a broken footprint |
|---|---|---|---|
| `P-A` | `previousDayHigh` / `previousDayLow` | bars, trading-day rollover | **yes** |
| `P-B` | `sessionHigh` / `sessionLow` | bars, session definition | **yes** |
| `P-C` | `vwap` | footprint profile `complete` | no |
| `P-D` | `sessionPoc` | footprint profile `complete` | no |

`P-C` and `P-D` reject with `data_unavailable:profile` whenever `profileStatus !== "complete"`. `P-A`
and `P-B` are unaffected — which on MNQU6 is the difference between losing 30.5% of bars and losing
none.

### 3.2 Trigger

Within `setupMaxAgeBars` of the touch, on a bar at or after it, **either** of:

- **T1 — delta flip** in the trend direction, from `_shared/rules/delta_flip.ts`
- **T2 — stacked imbalance** in the trend direction, from `_shared/rules/stacked_imbalance.ts`

Frozen counting rule (§1.4): the first of T1 or T2 to fire ends the setup and enters. If both fire on
the same bar, the opportunity records `trigger = both` and counts once. **Absorption and divergence
are not required** — that is the owner's explicit instruction, and requiring them would be the
double-count of §0AB.1 item 1.

Both detectors read the footprint, so both reject with `data_unavailable:footprint` on a bar whose
levels do not reconcile. An eligible setup whose every trigger bar was unavailable closes as
`data_unavailable:footprint`, not as `expired_unfired`.

### 3.3 Invalidation

Whichever comes first:

- price closes beyond the anchor against the trend by more than `invalidationDistance × medianTrueRange`
  → `invalidated:closed_through_anchor`
- `bias` flips to the opposite side before the trigger → `invalidated:bias_flipped`
- `setupMaxAgeBars` elapses → `expired_unfired`

`proposed: invalidationDistance = 0.75`

### 3.4 Initial live-preview execution scope (superseded later on 2026-09-07)

The owner explicitly accepted live risk and asked to run signals while backtesting in parallel. The
first live adapter therefore implements the strict subset that can be deterministic without durable
setup state:

- instrument/timeframe is hard-coded to `MNQU6 5m`;
- only `P-A` (`previousDayHigh` / `previousDayLow`) is active;
- a signal exists only when the named-level touch and T1/T2 trigger occur on the **same closed bar**;
- the CME trading day is provisionally named by 17:00 `America/Chicago` rollover;
- at least 70 stored bars must exist for the prior trading day; the volatility tail needs 20
  contiguous 5m bars and allows at most six minutes between opened-at stamps;
- numeric score remains `null`; the non-null legacy storage field is written as zero and must not be
  interpreted as confidence;
- every payload says `executionScope=touch_bar_only` and `unvalidated`.

This initial subset was superseded after migration 0040 added durable setup state. The current live
adapter uses `executionScope=carried_setup` and the full `setupMaxAgeBars=6`; the historical
`touch_bar_only` path remains only as the fail-closed fallback when the setup store is unavailable.

---

## 4. `MNQ_REVERSAL_V1`

**Instrument:** `MNQU6` only.

**Reason for the setup:** price reaches a significant level, tries to continue and fails, then closes
back on the other side of that level.

### 4.1 Eligible location

1. On a bar within `attemptWindowBars` before the decision bar, price traded beyond a named anchor by
   at least `attemptDistance × medianTrueRange`.
2. The decision bar closes back on the origin side of that anchor.
3. Direction is set by the recovery, not by trend.

`proposed: attemptWindowBars = 3`, `attemptDistance = 0.25`

Anchors and paths are the same four as §3.1.

**No trend agreement is required.** The owner's instruction is explicit and the mechanism justifies
it: this setup is a test of reversal, so demanding that the prior trend agree would reject the
premise. `bias` is recorded, never gated.

### 4.2 Trigger

Either of:

- **T1 — absorption** at the anchor, from `_shared/rules/absorption.ts`
- **T2 — delta divergence** against the failed attempt, from `_shared/rules/delta_divergence.ts`

Same frozen counting rule as §3.2.

Note for the frequency measurement in step 3: absorption is rare in the live population — 6 signals on
MNQU6 across the whole recorded window against 512 stacked imbalances
(`docs/queries/strategy_frequency_gate0.sql` §C5). If `T2` supplies nearly every trigger, the "or" is
decorative and step 3 must report that rather than hide it.

### 4.3 Invalidation

- price closes beyond the anchor again in the failed direction → `invalidated:attempt_resumed`
- `setupMaxAgeBars` elapses → `expired_unfired`

---

## 5. `GC_SWEEP_V1`

**Instrument:** `GC` only.

**Reason for the setup:** price passes a named reference level and returns inside within a defined
number of bars.

The owner selected all four reference levels, and the question stated that each becomes its own spec
rather than a combined requirement. So this is **four registered variants sharing one mechanism**, and
the plan's instruction not to demand VWAP, VAH/VAL and POC simultaneously is preserved by construction.

| Variant | Reference level | Inputs it needs | Buildable today |
|---|---|---|---|
| `S-A` | `previousDayHigh` / `previousDayLow` | bars, trading-day rollover | needs session definition only |
| `S-B` | `sessionHigh` / `sessionLow` | bars, session definition | needs session definition only |
| `S-C` | `initialBalanceHigh` / `initialBalanceLow` | bars, session definition, IB convention | needs the IB convention too |
| `S-D` | `vwap`, `vah`, `val`, `sessionPoc` | footprint profile `complete` | unusable on 51.0% of GC bars |

### 5.1 Eligible location

1. Price traded beyond the reference level by at least `sweepDistance × medianTrueRange`.
2. Price closed back inside within `returnWindowBars`.
3. Direction is the return direction.

`proposed: sweepDistance = 0.25`, `returnWindowBars = 3`

### 5.2 Trigger — this is the question the strategy exists to answer

Two arms, registered as a pair before the run:

- **Arm 1 — return only.** The return inside the level is the entry. No order-flow condition.
- **Arm 2 — return plus order-flow confirmation.** The return, plus absorption **or** stacked
  imbalance in the return direction.

Step 4 compares Arm 1 against Arm 2 under identical entry, exit, cost and risk rules, and reports the
opportunities each accepted **and rejected**. That is the concrete form of "does the extra filter earn
the opportunities it costs".

### 5.3 Invalidation

- price closes back outside the reference level → `invalidated:swept_again`
- `setupMaxAgeBars` elapses → `expired_unfired`

---

## 6. Overlap between the two MNQ strategies

`MNQ_PULLBACK_V1` and `MNQ_REVERSAL_V1` read the same bars and can be eligible on the same bar in
opposite directions. HANDOFF §0AB.4 step 5 requires the combined frequency to net out duplicates, so:

- Each strategy is evaluated independently and records its own opportunity. Neither suppresses the
  other.
- A **combined** report additionally counts a joint opportunity key
  `(instrument, decision_bar, anchor_identity)` so that one market event seen by two strategies is
  counted once in any total.
- Where both are eligible in opposite directions on the same anchor and bar, that is recorded as
  `contested` and reported. It is not resolved by a rule in v1, because picking a winner is exactly
  the kind of choice that must be made on evidence rather than by an implementer.

---

## 7. What these specs need that does not exist yet

Written plainly, because HANDOFF §0AB.3 requires "blocked" and "no setup" to stay distinguishable.

| Need | State on 2026-09-07 | Blocks |
|---|---|---|
| Owner-approved session definition (windows + IANA zones + trading-day rollover) | none seeded; Phase 1 deliberately seeds none | every anchor, including prev-day levels, because the trading day comes from the rollover |
| Initial-balance convention | not decided | `S-C` only |
| Value-area convention (P2, still open from §0V) | not decided | `P-C`, `P-D`, `S-D` |
| Phase 1 independent re-review of `acc3a64` | outstanding (§0AA) | using any `computeKeyLevels` / `computeMarketContext` output for a conclusion |
| Migration 0039 (`strategies`, `strategy_versions`, `decision_mode`) | not written; queues behind 0033-0038 | persisting anything |
| Repaired tick and non-null `tick_value` | tick oscillates; `tick_value` null on all four (§0AB.6) | after-cost results, R figures, SESOI — i.e. steps 4-5, not steps 2-3 |

The evaluator can still be written and unit-tested now, the same way Phase 1 was: a pure function that
takes the session definition and contracts as inputs and is exercised against fixtures. What it may
not do is stamp production bars or have its output treated as a result.

---

## 8. Multiplicity budget

Four `GC_SWEEP_V1` variants × two trigger arms is eight candidate configurations for one strategy, on
top of four anchor paths each for the two MNQ strategies. Reporting the best of those as if one
hypothesis had been tested is precisely the selection error §0W item 2 and `EXPERIMENT_REVIEW_PROTOCOL.md`
§4 exist to prevent.

So, before step 3 runs:

- **One primary contrast per strategy** is registered in advance. Every other variant is descriptive
  unless separately registered against a new error budget.
- Every attempted variant is counted in the evidence packet — including the ones that were run and not
  reported.
- The proposed primary contrasts are: `MNQ_PULLBACK_V1` path `P-A` (the anchor that survives a broken
  footprint); `MNQ_REVERSAL_V1` path `P-A`; `GC_SWEEP_V1` variant `S-A`, Arm 1 against Arm 2.

These are proposals for the owner to accept or change **before** any outcome is read.

---

## 9. Which evaluator gets built first

`MNQ_PULLBACK_V1`, on the owner's stated criterion of data readiness and opportunity count rather than
historical profit — no profit figure has been looked at, and none can be computed today anyway.

The evidence: MNQU6 holds 6 usable US-regular blocks, equal to GC's 6 and more than NQU6's or
BTCUSDT's 4; its footprint reconciles on 69.5% of bars against GC's 49.0%; and 8.3% of its 20-bar
trailing windows span a gap against GC's 12.1% (`docs/queries/strategy_frequency_gate0.sql`, sections
C1-C3). Its `P-A` path additionally needs no footprint at all for eligibility.
