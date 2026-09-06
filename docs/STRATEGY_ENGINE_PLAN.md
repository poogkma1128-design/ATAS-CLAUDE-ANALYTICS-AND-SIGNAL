# Plan — confluence strategy engine for NQ and GC

**Status: proposal. Nothing here is built, no migration is written, no file is changed.** This
document exists so the owner can approve a scope, and so whoever implements it knows what already
exists and must not be rewritten.

The requested target is: ATAS sends order-flow features → the backend decides → Supabase records →
Telegram announces, with three named strategies backtested per instrument and no single indicator
allowed to fire a trade on its own.

## 1. What already exists, and must not be rewritten

The requested architecture is, in its essentials, the architecture this repository already has. The
decision already happens in the backend, rule parameters already live in the database and are edited
at `/rules` without recompiling anything, and the backtest runner already refuses by construction to
reach Telegram.

| Requirement | Where it already lives |
|---|---|
| Backend decides the signal | `supabase/functions/_shared/ingest.ts` → `runRules()` |
| Change rules without recompiling ATAS | `public.rules.params`, edited at `/rules` |
| Absorption detector | `_shared/rules/absorption.ts` |
| Delta divergence detector | `_shared/rules/delta_divergence.ts` |
| Stacked imbalance detector | `_shared/rules/stacked_imbalance.ts` |
| Five more detectors | `poc_shift`, `delta_flip`, `lvn`, `naked_poc`, `speed_of_tape` |
| Backtest runner, isolated from production | `functions/backtest/index.ts`; writes `experiments` / `experiment_results`, never `public.signals` |
| MAE / MFE per trade | `signal_outcomes.mae_ticks`, `mfe_ticks`, plus `exit_reason`, `pnl_ticks` |
| Entry / stop / target / trail / R:R | `_shared/plan.ts`, persisted on `public.signals` |
| A frozen feature contract for later ML | `_shared/confidence_v2.ts` — `score` is deliberately `null` |
| Rule test coverage | `_shared/rules/rules_test.ts`, 919 lines |

Two consequences. First, most of this plan is **addition, not replacement**. Second, the existing
detectors are the raw material for the three strategies — they should be reused, not reimplemented
inside a new strategy module.

## 2. The one structural change: a rule is not a strategy

Today every enabled rule can produce a signal on its own, and any signal can reach Telegram. The
requested design forbids exactly that: stacked imbalance alone, delta alone, CVD divergence alone or
big trades alone must never be a final entry.

So the change is not "add more rules". It is to split one concept into two:

- **Rule = detector.** Answers "is absorption present on this bar, and how strong?" Produces
  *evidence*, never a trade.
- **Strategy = decision.** Reads all the evidence for a bar plus market context, scores confluence,
  and emits at most one signal, carrying its own identity and version.

Concretely, in `_shared/rules/index.ts`, `runRules()` currently returns `EvaluatedSignal[]` — one per
rule, each already a tradeable signal. It would return `RuleEvidence[]` instead, and a new
`_shared/strategy/` layer would consume that. The evaluators themselves barely change: they already
compute and return the evidence in `RuleSignal.payload`; what changes is who is allowed to call the
result a trade.

```
bar closes
  └─ feature engine        → market context (trend, volatility, session, news state)
  └─ key level engine      → VWAP, VAH/VAL/POC, prev day H/L, session H/L, IB H/L
  └─ rule evaluators       → evidence: absorption?, divergence?, stacked imbalance?, …
        └─ strategy engine → per strategy: location + confluence → score 0..100
              └─ risk engine (plan.ts, unchanged)
                    └─ classification gate → signal, or a logged rejection
```

`confidence_v2` is the right starting point for the scoring layer rather than a fresh invention: it
already defines a whitelisted, versioned, signal-time feature snapshot, and it already refuses to
emit a number it has not earned. The scoring layer should extend that contract, not sit beside it.

## 3. Phase 0 — the data foundation, which is the actual blocker

The acceptance criteria begin with "a sufficient historical dataset". **That criterion cannot be met
today, and no amount of engineering in phases 1–5 changes it.**

| Fact | Number |
|---|---|
| Total 5m bars held, all instruments | 7,612 |
| NQU6 bars, and its last one | 1,162, stopped 2026-09-04 10:05 UTC |
| GC bars | 1,800 |
| History ATAS itself can backfill | ~3–4 days on M5, shorter than what Supabase already holds |
| Feed completeness | gapped, because the chart is not left open (HANDOFF §3.7b) |

The requested backtest splits by strategy × instrument × direction × session × volatility regime ×
day of week × news × trend/range. That is dozens of cells. Against roughly a week of gapped data,
most cells would hold single-digit trades, and a few would hold none. Reporting a ranking from that
would be the precise failure the protocol exists to prevent.

Four things must be settled before results from this engine mean anything:

1. **Migration 0035 is still unapplied**, so 15% of `public.signals` was produced by rules reading
   bars that were never 5-minute bars (§0L). Any backtest run today inherits that population.
   Production migration head is still `20260902142002`; **0033, 0034, 0035 and 0036 are all
   unapplied**, and 0034/0036 are blocked on independent review. Every migration this plan proposes
   queues behind them.
2. **`tick_size` is wrong or at least not what its name says** — MNQU6 0.75, GC 0.30, BTCUSDT 10.0,
   against contract ticks of 0.25, 0.10 and 0.1. `plan.ts` computes stop, target and every R-multiple
   directly from it. Confirm against the terminal before any R number from this engine is trusted.
3. **NQ or MNQ.** The request says NQ; most data is MNQU6. They are different contracts with
   different tick values, and pooling them silently would be its own contamination.
4. **Where NQ and GC history comes from.** The Binance archive solves BTCUSDT only. For NQ and GC the
   options are: keep collecting live (slow, and gapped whenever the terminal is off), or buy history
   (Databento, CME DataMine, a deeper broker feed). This is a spending decision, not a technical one.

Phases 1–5 can be built while this is unresolved. They just cannot be *validated*.

## 4. Phase 1 — market context, key levels, sessions

All backend, no ATAS change, computed from bars and footprints already stored.

**Key level engine.** VWAP, VAH, VAL, session POC, previous-day high/low, session high/low, initial
balance high/low. None of these exist anywhere in the repository today — the grep for `vwap`,
`vah`, `value_area` and `initial_balance` returns nothing. Everything needed to compute them is
already in `public.bars` and `public.cluster_levels`.

**Session engine.** No session concept exists. Asia, Europe, US pre-market, US open, US regular and
power hour must be defined in **exchange time with daylight saving handled explicitly**, then stamped
on every bar and signal. A session boundary that silently shifts by an hour twice a year would
corrupt every session comparison built on top of it.

**Market context.** Trend/bias and volatility regime, so "trend pullback" has something to read.

**Causality rule, non-negotiable.** Every feature must be computable from bars at or before the
decision bar's close. This is the same discipline the ML work already enforces in
`research/hybrid_ml/dataset.py`, and the same class of error §0L was.

**Phase 1 implementation contract (Codex design review, 2026-09-06).** Session windows are data,
not constants hidden in an evaluator. Each definition carries an immutable version, IANA exchange
time zone, trading-day rollover minute and ordered windows. Phase 1 deliberately seeds no NQ/GC
times: Asia/Europe segmentation and the precise US-open/initial-balance convention are owner trading
definitions, not facts an implementer may invent. Until an independently reviewed definition is
activated, the pure engine can be tested but the ingest path must not stamp production bars.

Key levels are point-in-time results bound to a decision bar, session-definition version and engine
version. A future bar is an error, not a row to silently discard. A missing footprint nulls the whole
VWAP/value-area/session-POC profile and records `missing_footprint`; partial volume must never be
presented as a complete profile. Market volatility uses a versioned trailing-window contract, excludes
the decision bar from its thresholds, emits `insufficient_history` during warm-up, and does not feed
any existing rule or signal in Phase 1.

## 5. Phase 2 — strategy layer, scoring, and schema

Three strategies, each with an identity and a version, as requested: `NQ_PULLBACK_V1`,
`NQ_REVERSAL_V1`, `GC_SWEEP_V1`.

**Adaptive thresholds.** Every rule today uses fixed parameters — `volumeMultiple: 3`,
`minRateRatio: 2`, and so on. The request is percentile thresholds per instrument. The complete
contract must be frozen before an evaluator is written:

- The reference population is keyed by instrument, timeframe, feature, direction (when polarity
  matters) and strategy-version. NQ and MNQ are never pooled implicitly.
- The sample is a fixed-length trailing window of bars that **closed before the decision bar**. The
  decision bar and every later bar are excluded. Whole-dataset percentiles are forbidden leakage.
- Window length, minimum sample count, percentile, interpolation/tie method, null/non-finite handling
  and winsorisation (if any) live in the immutable strategy version. Phase 1 uses `nearest_rank` for
  volatility; a different method requires a new version rather than an in-place edit.
- Warm-up or missing feature history produces `insufficient_history`. It does not fall back to a
  global threshold, zero, or a hand-tuned constant, and cannot become an accepted candidate.
- Start with per-bar recomputation because it is the smaller auditable implementation. A stored rolling
  distribution is an optimisation only after parity tests prove identical results bar by bar.

**Scoring.** The proposed Location 25, absorption 20, divergence 15, stacked imbalance 20, delta
acceleration 10 and volume/big-trades 10 are a starting hypothesis, not yet a scoring contract.
Before Phase 2 code exists, its versioned row must freeze all of the following:

1. **Eligibility and direction first.** Location/session eligibility, required data, directional
   agreement and hard rejection reasons are evaluated separately from evidence strength. A high
   absolute score cannot rescue an ineligible or directionally contradictory candidate.
2. **One normalized component per concept.** Each component is explicitly mapped to `[0,1]`, states
   whether it supports long, short or either direction, and names its source features. Overlapping
   detectors may not double-count the same raw event without an explicit dependency rule.
3. **Missing is not zero evidence.** Every component declares required/optional status. A missing
   required component rejects with a closed vocabulary; an optional component uses a frozen
   renormalisation rule. The implementation records both raw features and normalized contributions.
4. **Exact arithmetic.** Weights are non-negative and total 100. The raw weighted score, rounding
   mode and precision are stored. NO_TRADE / WATCH / GOOD / STRONG / A+ are contiguous, non-overlapping
   half-open intervals with exact boundaries in the same immutable version.
5. **No fitting on the reported period.** Weights, component transforms, percentile contracts and
   band boundaries are frozen before the development run, then held fixed through walk-forward and
   final OOS evaluation. Changing one creates a new version and restarts evaluation.

Until these fields and the exact band boundaries are owner-approved, no numeric strategy score or
classification is allowed. This closes the ambiguity found in the §5 design review rather than
letting implementation choices silently become trading policy.

**Logging rejected candidates.** The request is to log every candidate including rejections. This is
worth doing and has a cost: it is a row per bar per strategy rather than a row per signal, and it
must not travel through the signal dedupe path or Telegram. A separate table, with the same frozen
feature contract as `confidence_v2`.

Proposed migrations, in order, numbered from the next free slot:

| # | Adds |
|---|---|
| 0037 | `key_levels`, session definitions, and session/context columns on `bars` |
| 0038 | `strategies` + `strategy_versions`; `signals.strategy_id`, `strategy_version`, `score`, `score_breakdown`, `classification` |
| 0039 | `strategy_candidates` — every evaluated candidate, accepted or rejected, with its features |
| 0040 | `news_events` + `signals.news_state` |
| 0041 | metric columns on `experiment_results` (§6) |

All five are additive. None alters an existing column, and none may be written before the four
unapplied migrations ahead of them are resolved.

## 6. Phase 3 — backtest, which is half-built already

`experiment_results` records trades, wins, win_rate, total_r, hit_target/stop/trail, timed_out,
max_drawdown_r, worst_losing_streak and missed_fills, and every run scores a baseline variant from
live settings for comparison. What the request needs on top:

| Missing metric | Missing dimension |
|---|---|
| Profit factor, expectancy | by session |
| Average win, average loss | by volatility regime |
| Sharpe, where it is meaningful | by day of week |
| MAE / MFE aggregates (per-trade values already exist) | news vs non-news |
| Average holding time | trend vs range |
| R distribution | long vs short (per strategy) |
| Commission and slippage, netted | |

And the validation structure the request demands and the runner does not have: **walk-forward,
a reserved out-of-sample period, and a parameter stability test**. The existing runner sweeps one
period and compares against baseline; it has no notion of a period it is not allowed to look at.

Note that win rate must not decide anything on its own — the existing `price_action_edge` view and
the §5.24 trend-filter result already work this way, so the convention is established.

## 7. Phase 4 — Telegram

The message today carries instrument, direction, rule name, entry, stop, target and trail. It needs
score, classification, market context, the evidence checklist, strategy id and version, and R:R.
`_shared/telegram.ts` already builds a structured message; this is formatting, not architecture, and
is the smallest piece of work in the plan.

## 8. Phase 5 — the only ATAS change

Two features cannot be reconstructed in the backend from what is stored:

- **Volume per second** needs intra-bar timing. `speed_of_tape` currently uses trades-per-bar as a
  proxy, and its own comment says so.
- **Big trades** needs individual trade sizes. `BarInput.trades` exists but the indicator has never
  assigned it, so it is **0 on every bar ever stored** (HANDOFF 5.16).

Both are one C# change in `SignalBridgeIndicator.cs`, and should be batched into a single REV bump
rather than two. Everything else in this plan is backend-only, which is what the request asked for.

## 9. What must not change

- No historical bar goes through `ingest`. Sending old bars through it would run today's rules over
  them and write into `public.signals`, contaminating every statistic computed on that table
  (§ญ.11). This applies to any backfill this plan later motivates.
- The backtest runner keeps its property that it cannot reach `public.signals` or Telegram. That is
  a structural guarantee, not a flag.
- Existing rule behaviour outside this scope stays as it is. The detectors keep their current outputs
  so the signals already recorded remain comparable.
- No production parameter changes without a backtest, and no "best strategy" claim without
  out-of-sample validation.

## 10. Decisions the owner has to make before phase 2

1. NQ or MNQ, or both as separate instruments.
2. Whether to buy NQ/GC history, keep collecting, or accept that validation waits.
3. Whether rejected-candidate logging starts now (more data for later, more rows) or after phase 3.
4. Whether the four unapplied migrations get resolved first, or this plan's migrations are written
   and left unapplied behind them.

## 11. How this plan can fail

The most likely failure is not a bug. It is building all five phases against a week of gapped data,
getting a ranking, and believing it. The second most likely is optimising the scoring weights and the
percentile thresholds against the same period used to report performance. Both are already forbidden
by `EXPERIMENT_REVIEW_PROTOCOL.md`; both are easy to do by accident once there is a scoring engine
with sixteen tunable numbers in it.

The mitigation is the one the ML work already used: freeze the configuration in a versioned row
before the run, keep a period nobody has looked at, report the baseline in every cell, and let a
negative result be the answer.

## 12. Roles

This is a proposal by the session that produced it and is not an independent review. The owner
decides scope. Whoever implements a phase records it in `docs/HANDOFF.md` per the completion gate,
and the strategy scoring layer in particular needs a reviewer who did not write it before any of its
numbers are used to judge a strategy. Nothing here changes production; if the plan is rejected,
nothing needs rolling back.
