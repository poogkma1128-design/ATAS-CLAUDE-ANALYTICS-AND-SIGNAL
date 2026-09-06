# Plan — confluence strategy engine for NQ and GC

**Status: Phase 1 implementation prepared in `62618e7`, not integrated or applied. Numeric Phase 2
scoring is REJECTED AS WRITTEN by the design review in
`docs/reviews/2026-09-06-strategy-engine-section-5-design-review.md`; only a boolean-first design may
proceed. Phases 3–5 remain proposal-only.** Phase 1 is isolated from ingest/signals/Telegram and
migration 0037 remains unapplied pending the existing migration queue, an owner-approved session
definition and the three P1 repairs from Claude's independent review at `acc3a64` (footprint
reconciliation, bar adjacency and per-window time zones). The repaired Phase 1 must be re-reviewed
before integration. This document remains the scope contract for what must not be rewritten.

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
- **Strategy = decision.** Reads all the evidence for a bar plus market context. Phase 2A makes a
  versioned boolean eligibility/direction decision; only a separately validated later version may
  score confluence. It emits at most one signal, carrying its own identity and version.

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
        └─ strategy engine → Phase 2A: eligible + direction + rejection reasons; score = null
              └─ risk engine (plan.ts, unchanged)
                    └─ boolean gate → later signal integration, or a logged rejection
        └─ Phase 2B only after its gates → shadow score, never a live gate
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
2. **`tick_size` is confirmed wrong on three of four instruments, including the chosen one.** This is
   no longer a suspicion. The smallest gap between distinct traded prices in the footprint levels the
   same feed recorded settles it (`docs/queries/instrument_tick_identity.sql`):

   | symbol | recorded `tick_size` | observed price step | ratio | verdict |
   |---|---:|---:|---:|---|
   | **MNQU6** | **0.75** | **0.25** | **3×** | **DISAGREES** — the chosen instrument |
   | GC | 0.30 | 0.10 | 3× | DISAGREES |
   | BTCUSDT | 10.00 | 0.10 | 100× | DISAGREES |
   | NQU6 | 0.25 | 0.25 | 1× | agrees |

   `tick_value` is **null on all four**, so no money figure can be computed at all. `plan.ts` computes
   stop, target and every R-multiple from `tick_size`; migration 0003 divides by it for every MAE/MFE
   in ticks. Every tick-denominated statistic already stored for MNQU6 — 1,391 signals with outcomes,
   the largest such population in the database — was computed against a tick three times too large.

   **Root cause and fix are written, not yet applied.** The bridge sends ATAS's chart price step and
   `upsertInstrument()` wrote it over the row on every ingest, so the value could not simply be
   corrected in place. `ingest.ts` now treats the tick as curated, and migration 0038 stamps
   `signal_outcomes.tick_size_used`, corrects the three instruments, and adds a trigger that holds the
   value against any blind overwrite — so the correction no longer depends on a deployment staying
   current. Per the owner's decision no stored measurement is rewritten; the corrected reading comes
   from the `signal_outcomes_true_ticks` view. `tick_value` stays null because nothing ever observed
   it. 0038 queues behind 0033-0036 like everything else. See HANDOFF §0Z.
3. **NQ or MNQ — decided: MNQ (`MNQU6`).** Owner decision, 2026-09-06. They are separate order books,
   not one feed recorded twice: across 1,162 bars sharing a timestamp, OHLC matches on 31 and volume
   and ticks match on **zero**. Pooling them stays forbidden. What the choice costs and buys is in
   §10 item 1.
4. **Where NQ and GC history comes from.** The Binance archive solves BTCUSDT only. For NQ and GC the
   options are: keep collecting live (slow, and gapped whenever the terminal is off), or buy history
   (Databento, CME DataMine, a deeper broker feed). This is a spending decision, not a technical one.

Phases 1–5 can be built while this is unresolved. They just cannot be *validated*.

## 4. Phase 1 — market context, key levels, sessions

All backend, no ATAS change, computed from bars and footprints already stored.

**Key level engine.** VWAP, VAH, VAL, session POC, previous-day high/low, session high/low, initial
balance high/low. None existed before Phase 1. Commit `62618e7` adds the isolated causal calculator
and migration contract; nothing calls or persists it yet. The stored inputs remain `public.bars` and
`public.cluster_levels`.

**Session engine.** No production session concept is active. Phase 1 adds an isolated stamper and
versioned definition schema. Asia, Europe, US pre-market, US open, US regular and power hour must be
defined in **exchange time with daylight saving handled explicitly**, then stamped on every bar and
signal in a later reviewed integration. A boundary that silently shifts by an hour twice a year would
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

Three strategies, each with an identity and a version: `MNQ_PULLBACK_V1`, `MNQ_REVERSAL_V1`,
`GC_SWEEP_V1`. The first two were named `NQ_*` while the instrument was undecided; the owner chose
MNQ on 2026-09-06 (§3 item 3, §10 item 1), so they are bound to `MNQU6` and the names follow. Review
artifacts dated before that decision still carry the old names; they are point-in-time records and are
not rewritten.

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

### §5 design-review closure: boolean first, numeric score must earn promotion

The formal review answers the four remaining acceptance questions and has the controlling verdict:
**REJECT AS WRITTEN for numeric scoring.** Its decisions are part of this plan:

- The hand-assigned 25/20/15/20/10/10 weights have no presumed advantage after legacy `confidence`
  failed to rank outcomes (§5.19). Phase 2A does not store or execute them. A later score must beat an
  eligibility-only boolean baseline and equal-weight/evidence-count baseline on untouched OOS data,
  with component ablations and after-cost outcomes.
- The three strategies form one confirmatory family. Register one primary contrast each, resample them
  jointly by session × instrument and control family-wise alpha 0.05 with Holm adjustment. All other
  slices are descriptive unless separately registered and charged to a new error budget.
- A score band on inadequate data is `UNDERPOWERED`, not GOOD/STRONG/A+. Before outcomes are read,
  freeze the after-cost SESOI, conservative planning alpha `0.05 / 3`, target power ≥0.80, block unit,
  calculated minimum blocks/opportunities and data boundaries. No ranking or edge claim before it passes.
- **The contract chooses boolean-first.** Phase 2A records `eligible`, direction, closed rejection
  reasons and raw features with `score=null`/`classification=null`. Phase 2B may compute a shadow score
  only after Gate 0 and a frozen score contract. Phase 2C may gate live decisions only after forward/OOS
  evidence, independent raw re-run, rollback and written owner L3 approval.

The strategy-version migration (0039 since 0038 was taken by the tick correction) must therefore
include an explicit `decision_mode` (`boolean`, `score_shadow`,
`score_gate`) and database constraints: boolean rows require score/classification null; shadow scores
cannot determine live acceptance; only a separately owner-approved score-gate version may do so.

**Logging rejected candidates.** The request is to log every candidate including rejections. This is
worth doing and has a cost: it is a row per bar per strategy rather than a row per signal, and it
must not travel through the signal dedupe path or Telegram. A separate table, with the same frozen
feature contract as `confidence_v2`.

Proposed migrations, in order, numbered from the next free slot:

| # | Adds |
|---|---|
| 0037 | `key_levels`, session definitions, and session/context columns on `bars` |
| 0038 | *(taken)* `signal_outcomes.tick_size_used`, the tick correction and the metadata trigger — see HANDOFF §0Z |
| 0039 | `strategies` + `strategy_versions` with `decision_mode`; nullable score fields and mode constraints; no score-gate seed; later signal fields remain integration-only |
| 0040 | `strategy_candidates` — every evaluated candidate, accepted or rejected, with its features |
| 0041 | `news_events` + `signals.news_state` |
| 0042 | metric columns on `experiment_results` (§6) |

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

1. ~~NQ or MNQ, or both as separate instruments.~~ **Decided 2026-09-06: MNQ (`MNQU6`).** The two NQ
   strategies bind to `MNQU6`; `NQU6` is neither pooled with it nor a fallback, and its 442 signals
   stay out of the strategy family unless separately registered. What follows from the choice:
   - **It is the better-evidenced instrument.** MNQU6 holds 6 usable US-regular blocks against NQU6's
     4, and 1,391 signals with outcomes against 442 (`docs/queries/strategy_block_census.sql`).
   - **It is also the one whose recorded tick is wrong** — 0.75 against an observed 0.25 (§3 item 2).
     NQU6's recorded tick is correct, so this decision moves the strategy onto the broken row. The
     tick must be corrected, and the tick-denominated history already derived from it triaged, before
     any location predicate measured in ticks or any R figure means anything.
   - **After-cost validation gets harder, not easier.** A micro contract's tick is worth a tenth of
     the full-size one while commission per contract is not a tenth, so cost is a much larger share of
     each tick. The after-cost SESOI in item 5 must be set for MNQ specifically; a threshold that
     clears on NQ can fail on MNQ on identical price behaviour. This cannot be computed at all today:
     `tick_value` is null on every instrument.
2. Whether to buy NQ/GC history, keep collecting, or accept that validation waits.
3. Whether rejected-candidate logging starts now (more data for later, more rows) or after phase 3.
4. Whether the four unapplied migrations get resolved first, or this plan's migrations are written
   and left unapplied behind them.
5. The exact boolean requirements/rejection vocabulary per strategy and the after-cost SESOI used to
   calculate the Phase 2B information gate. Hand weights and band boundaries are not an owner decision
   yet because the review requires evidence before either can be promoted from a hypothesis.

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

## 13. Design review contract — §5, before any phase starts

Per HANDOFF §0T.2: this document was written by Claude, so Claude reviewing an implementation of it
checks conformance rather than whether the design is right. §5 is where a wrong design is hardest to
detect afterwards, so it is challenged first, by a session that did not write it. This is the same
shape as §0H, where Codex challenged the §5.21 draft and changed two things before endorsing it.

### Claims the author is least sure of

Listing these is not an invitation to stop at them. They are where the author expects to be wrong,
and a review that only confirms them has not done its job.

1. **A hand-written weighted score may repeat a known failure.** HANDOFF §5.19 established that the
   existing hand-written `signals.confidence` does not predict realised R, and
   `_shared/confidence_v2.ts` says in its own docstring that re-labelling another hand-written
   formula as a probability would repeat that error. §5 proposes exactly that, with six weights
   instead of one. **Why would six hand-picked numbers succeed where one did not?**
2. **Sixteen free parameters against one week of gapped data.** Six weights, four band edges, the
   percentile levels, and the window length. §5 says freeze them before the run — but says nothing
   about what happens when the frozen v1 fails. Any second attempt is optimisation on the evaluation
   set unless fresh data is reserved for it, and there is not enough data to reserve any.
3. **The score sums components that are not independent.** Absorption at a level, a stacked imbalance
   at that same level and a delta divergence on the same bar are one phenomenon seen three ways, not
   three votes. Adding 20 + 20 + 15 treats them as independent evidence, which over-counts.
4. **"Location = 25" is undefined.** Graded on distance in ticks, in ATR, or binary at/near a level?
   Tick size differs per instrument and the recorded `tick_size` values are themselves under
   suspicion (§0Q, §0R), so a tick-based grade may not be comparable across NQ and GC at all.
5. **The percentile's population is unspecified.** Per instrument only, or per instrument × session,
   or × volatility regime? Each choice is another parameter, and the finer the split the fewer
   observations feed each percentile.
6. **Three strategies scored on the same bars is a multiple comparison.** Ranking three and reporting
   the winner is a selection process; with cells this small the winner can be noise, exactly as
   NQU6/level was in §0Q.
7. **A high score bar on thin data reproduces the V4 gate problem** — a threshold that is defensible
   and fires almost never, leaving nothing to evaluate.
8. **The scoring layer may be premature.** A strict boolean confluence — location AND absorption AND
   divergence AND stacked imbalance, no weights at all — has zero tunable weights, is far harder to
   overfit, and can be backtested immediately. **Does the score buy anything the boolean does not,
   at this sample size?** The author does not know, and the request's own instruction is to use
   scoring rather than binary conditions, so this needs the owner's decision rather than a silent
   substitution.

### The contract

```text
ROLE: Independent design reviewer of section 5 of docs/STRATEGY_ENGINE_PLAN.md.
You did not write that document and are not implementing it yet.
OBJECTIVE: Decide whether section 5's design is sound enough to build, and say what must change first.
PROBLEM: The plan proposes a weighted confluence score with roughly sixteen free parameters, to be
validated on about one week of gapped data, in a repository where a previous hand-written confidence
number was already shown not to predict realised R.
CURRENT CONTEXT: Repository E:\GPT\ATAS-CLAUDE-ANALYTICS-AND-SIGNAL, default branch.
Read AGENTS.md, docs/EXPERIMENT_REVIEW_PROTOCOL.md, docs/STRATEGY_ENGINE_PLAN.md in full, and
HANDOFF sections 0L, 0Q, 0R, 0S, 0T, 3.7b, 5.19 and 5.21 before reviewing. Read
supabase/functions/_shared/confidence_v2.ts, rules/index.ts and rules/*.ts, since section 5 builds
on them.
IN SCOPE: The design in section 5 only - the rule/strategy split as it affects scoring, adaptive
thresholds, the score and its bands, rejected-candidate logging, and the five proposed migrations.
Also in scope: whether a simpler design answers the same question at this sample size.
OUT OF SCOPE: Implementing anything. Changing production. Applying a migration. Phases 1, 3, 4 and 5
except where they constrain section 5. Re-litigating whether the ML result in section 0Q was right.
CONSTRAINTS: Read-only. No migration is applied, no Edge Function deployed, no rule parameter
changed, no data written. Note that migrations 0033-0036 are unapplied in production (head
20260902142002), so anything proposed queues behind them.
TASK: For each of the eight numbered doubts in section 13, state whether it is real, and why.
Then find what the list misses. For every finding give severity (P0 blocks building, P1 must change
before the backtest, P2 worth doing), the exact claim in the plan it contradicts, and a concrete
alternative rather than only an objection.
IMPLEMENTATION RULES: Cite file and line, or the plan's section, for every claim. Where a claim is
empirical, name the query or artifact that would settle it rather than asserting it. Do not approve
your own later implementation on the strength of this review.
DELIVERABLES: A verdict of ENDORSE / ENDORSE WITH CHANGES / REJECT, the findings by severity, and
an explicit answer to doubt 8 - score or boolean first, and on what evidence.
ACCEPTANCE CRITERIA: Every one of the eight doubts is addressed; at least the leakage, parameter
count and correlated-component questions get a concrete design answer; no finding rests on narrative
alone where an artifact could settle it; and the review states plainly what it could not check.
```

The review's output belongs in `docs/reviews/`, named for its date and subject, following the two
migration reviews already there. HANDOFF gets the verdict and what changed as a result.
