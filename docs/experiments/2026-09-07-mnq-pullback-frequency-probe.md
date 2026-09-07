# MNQ Pullback — why the live preview found nothing, measured offline

**Status: diagnostic, run, and conclusive about the cause. No profit claim, no production change.**

On 2026-09-07 the `mnq_pullback_v1` live preview was deployed under the owner's L3 override
(HANDOFF §0AD) and produced **zero signals**. Three backtest runs were spent trying to explain
that and could not. This document says what the cause actually is, with the numbers.

The short version: **the thresholds were never the problem, and neither was the window.** The
adapter can only fire when the touch and the confirmation land on the *same* closed bar, and that
restriction throws away most of what the strategy finds. Over the same bars the full six-bar
evaluator opens **42 opportunities and confirms 13**; the touch-bar-only adapter can emit **6**.

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

## 2. The instrument used instead

`scripts/mnq_pullback_probe.ts` runs the **production `buildDecision()` and `evaluatePullback()`**
over bars read from a file. Same code as the live rule; no second implementation, no edge-function
CPU budget, no database write. It reports the per-gate census the evaluator already produces
(`barOutcomes`, `diagnostics`) plus one thing the evaluator does not: how close price actually came
to each anchor, in median true ranges.

## 3. Result at the live setting

```text
bars:              2434      window: 2026-04-15T22:00Z .. 2026-09-07T07:05Z
decision bars:     2434
no volatility:      257
no bias:            736
prior day known:   2046
footprint usable:   125  (supplied for 237 bars)

how close price came to its anchor, in median true ranges
  (bar, anchor) pairs with a usable bias, volatility and level: 2554
  p01 0.139   p05 0.702   p10 1.286   p25 3.131   p50 9.171   closest 0.000
  within 0.5:                                 90
  within 0.5 and closing on the trend side:   80

why each (bar, anchor) pair opened no setup
  3710  no_setup
   514  insufficient_history
   328  data_unavailable:previous_day_completeness
   136  data_unavailable:bias

opportunities: 42
    15  rejected:expired_unfired
    10  rejected:invalidated:closed_through_anchor
    10  triggered:stacked_imbalance
     3  triggered:delta_flip
     3  rejected:direction_conflict
     1  rejected:invalidated:bias_flipped

live preview (touch_bar_only) would have fired: 6
```

Every opportunity falls on five UTC dates — 2026-08-31, 09-01, 09-02, 09-03, 09-04 — because those
are the days with a full feed. Two other full days (2026-08-28, 2026-09-07) produced none, and
everything before 2026-08-28 is one bar per day.

**So: 42 opportunities and 13 confirmations across 7 fully-fed trading days, of which 5 produced
anything.** That is a usable rate. It is *not* a claim that the trades win — no R, no cost, no
after-cost figure was computed here, and none should be quoted from this document.

## 4. Where the signals go

| stage | count | what removes them |
|---|---|---|
| (bar, anchor) pairs judgeable | 2554 | — |
| came within 0.5 median true ranges | 90 | distance: p05 is 0.702, so the zone catches the nearest ~3.5% of approaches |
| … and closed on the trend side | 80 | direction |
| distinct opportunities (repeats merged) | 42 | one event is one opportunity |
| confirmed by a trigger | 13 | 15 expired unfired, 10 closed through the anchor, 3 direction conflict, 1 bias flip |
| **emittable by the live adapter** | **6** | **`touch_bar_only`: the other 7 confirm on a later bar** |

The last row is the finding. **Roughly half the confirmed opportunities arrive on a bar after the
touch, and the live adapter is structurally unable to emit them** — not because of a threshold, but
because an edge function keeps no state between invocations, so a setup cannot stay open for the six
bars the contract allows.

## 5. Sensitivity — and why loosening is the weak lever

zoneProximity swept on the same bars (opportunity counts are exact; trigger counts are a lower bound
above 0.5, because the footprint export covers only the windows the 0.5 pass found):

| zoneProximity | opportunities | confirmed | live adapter could emit |
|---|---|---|---|
| 0.25 | 30 | 8 | 3 |
| **0.50 (live)** | **42** | **13** | **6** |
| 0.75 | 54 | 15 | 7 |
| 1.00 | 65 | 17 | 8 |
| 1.50 | 78 | 21 | 9 |

Tripling the zone (0.5 → 1.5) not quite doubles opportunities and moves what the live adapter can
emit from 6 to 9. Carrying setup state across bars, at the unchanged frozen zone, moves it from 6 to
13. **The state is worth more than the loosening, and it costs no widening of the entry criteria.**

## 6. Data-quality facts found on the way, not yet acted on

1. **The `5m` feed is not all 5-minute bars.** Of 2,353 MNQU6 bars since 2026-08-27, **567 (24%)**
   open at a minute that is not a multiple of five, and 199 consecutive pairs are **one minute**
   apart. 2026-09-03 holds 686 bars and 2026-08-31 holds 490, where a 23-hour CME day admits at
   most 276. This is the §0L timeframe contamination, still live, and it feeds the median true
   range that every distance in this strategy is denominated in.
2. **The footprint reconciles on 125 of 237 bars (52.7%)** in the setup windows — consistent with
   the 30.5% unusable rate recorded in §0AB, and the reason the trigger census is a lower bound.
3. **328 (bar, anchor) pairs are closed by `previous_day_completeness`** and 514 by
   `insufficient_history`: real gaps in the feed, correctly reported as missing data rather than as
   "no setup", which is the §0AB.3 distinction working as designed.

## 7. Evidence packet

```text
Hypothesis / estimand: the zero live signals of mnq_pullback_v1 are caused by the touch_bar_only
  execution scope, not by threshold width or by the backtest window's placement.
Proposer: Claude (this session)
Executor/Recorder: Claude (this session), scripts/mnq_pullback_probe.ts
Independent Reviewer: none yet — REQUIRED before any of this is used to justify a runtime change.
Owner approval required (L1-L4): L3 for any change to what the live rule emits. The diagnostic
  itself is L1 (read-only, no production write).
Pre-registered variants and failure criteria: primary contrast is P-A (prev_day_high/low), the
  contrast registered in §0AC.4. Falsified if the full evaluator finds no more confirmations than
  the touch-bar-only adapter.
Exact experiment_id(s): none. This probe writes nothing to public.experiments by design; the four
  UUIDs in §1 are the prior edge-function runs it reinterprets.
Code / evaluator / query commit: this commit; evaluator unchanged from d6df03c apart from reading
  ctx.params (which cannot alter the numbers above — the probe passes the live params, and the
  live params equal the frozen defaults).
Data window, timezone, bar cap, instruments, sessions: MNQU6 5m closed bars, 2026-04-15T22:00Z to
  2026-09-07T07:05Z, 2,434 bars after de-duplication, no bar cap, no session filter (v1 has none).
  Trading day = 17:00 America/Chicago rollover.
Gate 0 artifact: §3 and §4 above are the bind/pass census, by anchor and reason.
Attempted variants: zoneProximity in {0.25, 0.5, 0.75, 1.0, 1.5}, with and without --levels.
Succeeded variants: all five, both ways.
Failed variants: none.
Planned but not run variants: invalidationDistance and setupMaxAgeBars sweeps; both are now
  reachable from public.rules.params but were not run here.
Run but not reported variants: none.
Superseded or post-hoc variants (with reason): the "relaxed frequency diagnostic" conclusion from
  a191db22 is withdrawn — the params it set were never read.
Baseline and variant metrics: NOT COMPUTED. This measures opportunity frequency and rejection
  reasons only. No R per trade, no total R, no drawdown, no fill rate, no after-cost figure.
Per-opportunity artifact version: PullbackOpportunity from strategy/pullback.ts, unchanged.
Uncertainty method and resampling unit: none. 42 opportunities on 5 trading days is far too few
  for a session-by-instrument block resample, so nothing here is a significance claim (§4 of the
  protocol).
What would falsify the conclusion: a fed-back run in which the six-bar evaluator confirms no more
  than touch_bar_only does, or a demonstration that the 7 later-bar confirmations are look-ahead.
Independent re-run result and timestamp: none yet.
Decision: provisional. Diagnosis accepted as the reason to stop widening thresholds; no runtime
  change is authorised by it.
Runtime change, deploy, rollback: none. Nothing deployed. ingest stays v19, backtest stays v9,
  migration 0039 unchanged, rules row unchanged.
```

## 8. Reproducing it

```bash
# 1. export bars (SQL editor or psql) into bars.psv, and optionally footprints into levels.psv;
#    the header comment in scripts/mnq_pullback_probe.ts carries both queries verbatim.
# 2.
deno run --allow-read scripts/mnq_pullback_probe.ts bars.psv --levels=levels.psv
deno run --allow-read scripts/mnq_pullback_probe.ts bars.psv 0.75 --levels=levels.psv
deno run --allow-read scripts/mnq_pullback_probe.ts bars.psv --windows   # names the setup bars
```

## 9. What this says to do next, in order

1. **Do not loosen the thresholds.** §5 shows what that buys and it is the smaller half.
2. **Give a setup somewhere to live between bars** — a durable row keyed on
   `(strategy, instrument, direction, anchor, touch)` that ingest opens on the touch and closes on
   the trigger, the invalidation or the sixth bar. This is what turns 6 into 13, and it is an owner
   L3 decision because it changes what the live rule emits.
3. **Then** measure after-cost outcomes. Not before: §6.1 means every distance is currently
   denominated in a median true range computed partly from one-minute bars.
