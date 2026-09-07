# MNQ Pullback — why the live preview found nothing, measured offline

**Status: diagnostic, run twice, conclusive about the cause. No profit claim.**
**One production change: migration 0035 was applied (see §2).**

On 2026-09-07 the `mnq_pullback_v1` live preview was deployed under the owner's L3 override
(HANDOFF §0AD) and produced **zero signals**. Three backtest runs were spent trying to explain
that and could not. This document says what the cause actually is, with the numbers.

The short version: **the thresholds were never the problem, and neither was the window.** The
adapter can only fire when the touch and the confirmation land on the *same* closed bar, and that
restriction throws away most of what the strategy finds. On genuine 5-minute bars the full six-bar
evaluator opens **30 opportunities and confirms at least 5**; the touch-bar-only adapter can emit
**1**.

---

## 1. What the three earlier runs actually established

| experiment_id | name | status | what it proves |
|---|---|---|---|
| `2d17efb1-955b-4359-99a5-5cc1333059e5` | MNQ pullback live-preview launch baseline | failed | `HTTP 546 WORKER_RESOURCE_LIMIT` at 1000 bars |
| `85db5d77-956c-457a-a66c-1f138754d839` | MNQ pullback live-preview v9 1000-bar frequency | failed | same ceiling after the session cache fix |
| `fdb0245f-634a-481d-8665-fcaf68c824c6` | MNQ pullback live-preview v9 400-bar sensitivity | done | variant `pullback zone 0.75` |
| `a191db22-8a05-453a-a3b5-bfbbe597f6bc` | MNQ pullback v9 400-bar relaxed frequency diagnostic | done | variant `relaxed frequency diagnostic` |

The two runs that finished carry **no `mnq_pullback_v1` row at all**, and — the part that matters —
every row of both variants is **numerically identical to its baseline**, to the last decimal, on
all eight other rules.

That is not a strategy declining to fire. That is a sweep that changed nothing: `mnq_pullback_v1`
hardcoded its `PullbackContract` and never read `ctx.params`, so `zoneProximity`,
`invalidationDistance` and `setupMaxAgeBars` sat in `public.rules.params` looking adjustable while
the evaluator ignored them. **The conclusion "even a very relaxed filter still yields 0 setups" was
not measured** — the relaxed filter was never applied. It is withdrawn here.

`supabase/functions/backtest` also cannot answer the frequency question even when it works: it
reports *trades*. A strategy that never opens a setup and one that opens setups nothing confirms
both arrive as the same absent row.

## 2. The data had to be cleaned before the measurement meant anything

The first pass of this probe ran over everything labelled `5m` and found 2,434 MNQU6 bars — but
**705 of them were never 5-minute bars**. Some opened one minute apart, some carried sub-second
timestamps. Every distance in this strategy is denominated in a median true range computed from
those bars, so the measurement was standing on the §0L contamination.

Two facts settled what to do, both queried directly:

1. **It has stopped arriving.** The newest off-grid bar is MNQU6 `2026-09-03 14:38 UTC`; BTCUSDT
   and GC stop at `2026-08-31`. NQU6 never had one. The `ingest.validate()` guard from PR #79 is
   holding.
2. **The stored rows still matched the reviewed census exactly** — 1,538 bars, 543 signals,
   158,647 cluster_levels, 264 signal_outcomes, unchanged from the 2026-09-04 review, and all 543
   affected signals already carry an outcome row, so nothing pending was disturbed.

Migration **0035** was written for exactly this and had been waiting on one thing: an independent
re-run of its census before applying. That re-run is the query above. **0035 was applied on
2026-09-07.** 1,538 bars and 543 signals now carry `timeframe = 'quarantine:not-5m'`; 6,690 genuine
5m bars remain and the feed keeps flowing. Nothing was deleted; the rollback is the pair of
`update` statements in the migration's footer.

Every number below is from **after** that, on bars that are actually five minutes long.

## 3. The instrument

`scripts/mnq_pullback_probe.ts` runs the **production `buildDecision()` and `evaluatePullback()`**
over bars read from a file. Same code as the live rule; no second implementation, no edge-function
CPU budget, no database write. It reports the per-gate census the evaluator already produces
(`barOutcomes`, `diagnostics`) plus one thing the evaluator does not: how close price actually came
to each anchor, in median true ranges.

## 4. Result at the live setting

```text
bars:              1659      window: 2026-08-28T07:45Z .. 2026-09-07T07:55Z
decision bars:     1659
no volatility:      160
no bias:            459
prior day known:   1500
footprint usable:    73  (supplied for 200 bars — 36.5%)

how close price came to its anchor, in median true ranges
  (bar, anchor) pairs with a usable bias, volatility and level: 1894
  p01 0.139   p05 0.627   p10 1.286   p25 3.265   p50 9.412   closest 0.000
  within 0.5:                                 75
  within 0.5 and closing on the trend side:   69

why each (bar, anchor) pair opened no setup
  2555  no_setup
   319  insufficient_history
   186  data_unavailable:previous_day_completeness
   106  data_unavailable:bias

opportunities: 30
    14  rejected:expired_unfired
     7  rejected:invalidated:closed_through_anchor
     4  triggered:stacked_imbalance
     3  rejected:direction_conflict
     1  rejected:data_unavailable:feed_gap
     1  triggered:delta_flip

live preview (touch_bar_only) would have fired: 1
```

Every opportunity falls on five UTC dates — 2026-08-31, 09-01, 09-02, 09-03, 09-04 — out of the
eight fully-fed trading days in the window.

**30 opportunities, at least 5 confirmations, 1 emittable — across 8 trading days.** The
confirmation count is a **lower bound**: the footprint reconciles on only 36.5% of these bars, so
`stacked_imbalance` was unevaluable on most of them, and 14 of the 30 expired without any trigger
able to speak. No R, no cost, no after-cost figure was computed here, and none should be quoted
from this document.

## 5. Where the signals go

| stage | count | what removes them |
|---|---|---|
| (bar, anchor) pairs judgeable | 1894 | — |
| came within 0.5 median true ranges | 75 | distance: p05 is 0.627, so the zone catches the nearest ~4% of approaches |
| … and closed on the trend side | 69 | direction |
| distinct opportunities (repeats merged) | 30 | one event is one opportunity |
| confirmed by a trigger | ≥5 | 14 expired unfired, 7 closed through the anchor, 3 direction conflict |
| **emittable by the live adapter** | **1** | **`touch_bar_only`: the other 4 confirm on a later bar** |

The last row is the finding. **Four of the five confirmations arrive on a bar after the touch, and
the live adapter is structurally unable to emit them** — not because of a threshold, but because an
edge function keeps no state between invocations, so a setup cannot stay open for the six bars the
contract allows.

## 6. Sensitivity — and why loosening is the weak lever

zoneProximity swept on the same bars. Opportunity counts are exact; confirmation counts stay a
lower bound for the footprint reason in §4.

| zoneProximity | opportunities | confirmed | live adapter could emit |
|---|---|---|---|
| 0.25 | 25 | 4 | 1 |
| **0.50 (live)** | **30** | **5** | **1** |
| 0.75 | 37 | 6 | 2 |
| 1.00 | 45 | 8 | 3 |
| 1.50 | 57 | 12 | 3 |

Tripling the zone (0.5 → 1.5) nearly doubles opportunities and moves what the live adapter can emit
from 1 to 3 — while the confirmations it cannot reach grow from 5 to 12. Carrying setup state
across bars, at the unchanged frozen zone, moves it from 1 to 5. **The state is worth more than the
loosening, and it costs no widening of the entry criteria.**

## 7. What the first, contaminated pass reported

Kept because it is what the quarantine changed, and because a reader who saw the earlier version of
this document should be able to see exactly what moved:

| | before 0035 (contaminated) | after 0035 (genuine 5m) |
|---|---|---|
| bars | 2,434 | 1,659 |
| opportunities | 42 | 30 |
| confirmed | 13 | ≥5 |
| live adapter could emit | 6 | 1 |
| footprint usable | 125 / 237 (52.7%) | 73 / 200 (36.5%) |

The direction of the finding did not change; it got sharper. The earlier absolute numbers are
superseded and must not be quoted.

## 8. Data-quality facts found on the way, not yet acted on

1. **The footprint reconciles on 36.5% of genuine 5m bars.** `reconcilesFootprint()` requires the
   ladder's ticks to sum to the bar's, and on most bars it does not. That, not the zone, is what
   closes 14 of 30 opportunities as `expired_unfired`, and it makes every confirmation count in
   this document a lower bound. It is the single largest unexplored lever on this strategy.
2. **319 (bar, anchor) pairs are closed by `insufficient_history` and 186 by
   `previous_day_completeness`** — real gaps in the feed, correctly reported as missing data rather
   than as "no setup", which is the §0AB.3 distinction working as designed.
3. Contamination has stopped arriving; see §2. The indicator-side guard (`SignalBridgeIndicator.cs`
   REV 1.5.0) is still unbuilt, so the server-side check in `ingest.validate()` is the only line of
   defence.

## 9. Evidence packet

```text
Hypothesis / estimand: the zero live signals of mnq_pullback_v1 are caused by the touch_bar_only
  execution scope, not by threshold width or by the backtest window's placement.
Proposer: Claude (this session)
Executor/Recorder: Claude (this session), scripts/mnq_pullback_probe.ts
Independent Reviewer: none yet for this probe. For migration 0035 this session acted as the
  independent census re-run its header required; it did not write 0035.
Owner approval required (L1-L4): L3 for any change to what the live rule emits. The probe itself
  is L1 (read-only). Applying 0035 was owner-approved on 2026-09-04 and gated only on the census.
Pre-registered variants and failure criteria: primary contrast is P-A (prev_day_high/low), the
  contrast registered in §0AC.4. Falsified if the full evaluator finds no more confirmations than
  the touch-bar-only adapter.
Exact experiment_id(s): none. This probe writes nothing to public.experiments by design; the four
  UUIDs in §1 are the prior edge-function runs it reinterprets.
Code / evaluator / query commit: this commit; evaluator unchanged from d6df03c apart from reading
  ctx.params, which cannot alter the numbers above — the probe passes the live params, and the
  live params equal the frozen defaults.
Data window, timezone, bar cap, instruments, sessions: MNQU6 5m closed bars after the 0035
  quarantine, 2026-08-28T07:45Z to 2026-09-07T07:55Z, 1,659 bars, no bar cap, no session filter
  (v1 has none). Trading day = 17:00 America/Chicago rollover.
Gate 0 artifact: §4 and §5 are the bind/pass census, by anchor and reason.
Attempted variants: zoneProximity in {0.25, 0.5, 0.75, 1.0, 1.5}, before and after 0035, with and
  without --levels.
Succeeded variants: all of them.
Failed variants: none.
Planned but not run variants: invalidationDistance and setupMaxAgeBars sweeps; both are now
  reachable from public.rules.params but were not run here.
Run but not reported variants: none. The pre-quarantine pass is reported in §7 rather than
  discarded.
Superseded or post-hoc variants (with reason): the "relaxed frequency diagnostic" conclusion from
  a191db22 is withdrawn — the params it set were never read. The pre-quarantine figures in §7 are
  superseded by §4 because they were computed partly on bars that were not 5m.
Baseline and variant metrics: NOT COMPUTED. This measures opportunity frequency and rejection
  reasons only. No R per trade, no total R, no drawdown, no fill rate, no after-cost figure.
Per-opportunity artifact version: PullbackOpportunity from strategy/pullback.ts, unchanged.
Uncertainty method and resampling unit: none. 30 opportunities on 5 trading days is far too few
  for a session-by-instrument block resample, so nothing here is a significance claim (§4 of the
  protocol).
What would falsify the conclusion: a fed-back run in which the six-bar evaluator confirms no more
  than touch_bar_only does, or a demonstration that the 4 later-bar confirmations are look-ahead.
Independent re-run result and timestamp: none yet for the probe.
Decision: provisional. Diagnosis accepted as the reason to stop widening thresholds; no runtime
  change to the rule is authorised by it.
Runtime change, deploy, rollback: migration 0035 applied 2026-09-07 (1,538 bars + 543 signals
  re-labelled 'quarantine:not-5m'; rollback is the two update statements in the migration footer).
  No Edge Function deployed: ingest stays v19, backtest stays v9. Migration 0039 and the rules row
  untouched.
```

## 10. Reproducing it

```bash
# 1. export bars (SQL editor or psql) into bars.psv, and optionally footprints into levels.psv;
#    the header comment in scripts/mnq_pullback_probe.ts carries both queries verbatim.
# 2.
deno run --allow-read scripts/mnq_pullback_probe.ts bars.psv --levels=levels.psv
deno run --allow-read scripts/mnq_pullback_probe.ts bars.psv 0.75 --levels=levels.psv
deno run --allow-read scripts/mnq_pullback_probe.ts bars.psv --windows   # names the setup bars
```

`--windows` prints every bar an opportunity was open on, which is how the footprint export is kept
to a couple of hundred bars instead of the whole table.

## 11. What this says to do next, in order

1. **Do not loosen the thresholds.** §6 shows what that buys and it is the smaller half.
2. ~~**Give a setup somewhere to live between bars.**~~ **Done, pending one deploy.** The owner
   approved it (L3) on 2026-09-07 and it is built: the evaluator takes and returns its open
   setups, `public.strategy_setups` holds them, and `ingest` reads and writes them around the bar
   loop. The table is applied to production and empty; the live rule keeps its single-bar scope
   until `supabase functions deploy ingest` runs. See HANDOFF §0AF.
3. **Then find out why the footprint reconciles on only 36.5% of bars** (§8.1). Until that is
   understood, every confirmation count on this strategy is a lower bound of unknown tightness —
   and with setups now able to wait, it is what closes 14 of the 30.
4. **Only then** measure after-cost outcomes.
