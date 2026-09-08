# Independent review — the three live strategies (HANDOFF §0AG)

Subject: `MNQ_PULLBACK_V1`, `MNQ_REVERSAL_V1`, `GC_SWEEP_V1` as running in production —
commits `87fe178` and `aaf98da` (PRs #103, #104), migration `20260907164016_live_three_strategies`,
`ingest v23`, `backtest v13`. Reviewed at `b84e553`.

Reviewer: Claude session `01WetmzDSyVMeA63GCr5SZee`, which did not write any of the three
evaluators, `strategy/failed_break.ts`, `strategy/pullback.ts` or `strategy_setups.ts`.
Role basis: HANDOFF §0T, `docs/EXPERIMENT_REVIEW_PROTOCOL.md`.

Disclosure: this session wrote the ingest re-send guard merged as PR #105. That change is **not**
under review here, but it is upstream of the data this review reads, and one finding below concerns
an interaction with it. Findings about PR #105 itself are out of scope and remain unreviewed.

Independence basis: this reviewer re-ran the test suite, re-derived the anchors from raw bars, and
queried production directly rather than reading reported numbers. HANDOFF §0T.1 records that Claude
has no Supabase credentials and can therefore only review narrative — **that row is out of date.**
This session queried the project directly throughout.

## Verdict

**ENDORSE WITH CHANGES.**

The causal core is sound. The strategies do not see the future, the volatility percentile is
computed from a trailing window that excludes the decision bar, the previous-day anchors reproduce
to the cent by hand, the frozen thresholds match what production runs, and `backtest` cannot write a
signal or reach Telegram. Nothing needs reverting and nothing needs switching off.

Every finding below is in **persistence and observability**, not in the strategy logic. Two are
blocking for any frequency or edge claim drawn from `strategy_setups`; none is blocking for
continuing to run the live preview.

---

## Blocking findings

### P1 — `strategy_setups` double-counts when the same bars are ingested twice

`persistStrategyCarry()` (`strategy_setups.ts:156`) resolves an opportunity by touch id **only if
that touch id was in `before.open`**. Anything else is inserted as a new already-resolved row:

```
if (known.has(opportunity.anchorTouchId)) { await resolveByTouchId(...); continue; }
const { error } = await supabase.from("strategy_setups").insert({ ... status, resolved_at ... });
```

That branch is deliberate and documented — a setup that opens and closes inside one batch belongs in
the table too. What it lacks is any idempotency on `anchorTouchId`. The only uniqueness the schema
provides is partial:

```
strategy_setups_one_open_per_anchor
  UNIQUE (strategy_key, instrument_id, timeframe, anchor_identity) WHERE status = 'open'
```

Resolved rows are unconstrained. So when a batch re-processes bars an earlier request already
processed, every setup that opens and closes inside that window is inserted again.

**Measured in production, 2026-09-08 07:0x UTC** — 21 rows, 7 touch ids duplicated:

| strategy | anchor_touch_id | rows | states |
|---|---|---:|---|
| `mnq_pullback_v1` | `prev_day_high@…T02:45:00Z` | **3** | `closed_through_anchor` age 1, 2, 2 |
| `mnq_pullback_v1` | `prev_day_high@…T05:30:00Z` | 2 | **`triggered` age 2 and `triggered` age 3** |
| `mnq_reversal_v1` | `prev_day_high@…T02:50:00Z` | 2 | `attempt_resumed` age 4, 5 |
| `mnq_reversal_v1` | `prev_day_high@…T05:25:00Z` | 2 | `attempt_resumed` age 2, 3 |
| `gc_sweep_v1` | `prev_day_high@…T03:25:00Z` | 2 | `swept_again` age 4, 5 |
| `gc_sweep_v1` | `prev_day_high@…T04:20:00Z` | 2 | `swept_again` age 4, 5 |
| `gc_sweep_v1` | `prev_day_high@…T05:00:00Z` | 2 | `expired_unfired` age 5, 6 |

This is not hypothetical exposure. A reloading ATAS chart re-sends bars it has already streamed —
that behaviour is measured and documented in HANDOFF §0AH, and the duplicates above appeared after
one such backfill.

**Why it blocks a claim rather than the run.** HANDOFF §0AF.3 point 2 states the purpose of keeping
rejected rows: *"'setup 14 ตัวหมดอายุโดยไม่มีใครยืนยัน' คือตัวเลขที่บอกว่า trigger เข้มเกินไปหรือไม่."*
That number is a count over this table. Duplication is driven by how often a chart reloads, which is
uncorrelated with anything about the market, so it inflates the denominator unevenly across
strategies and days. **No frequency, expiry rate or trigger-strictness number may be computed from
`strategy_setups` until this is fixed**, including the "14 of 30 `expired_unfired`" figure if it is
ever recomputed from this table.

**Required:** make the write idempotent on the setup's identity — a unique index on
`(strategy_key, instrument_id, timeframe, anchor_touch_id, contract_version)` with the insert
becoming an upsert, or an explicit existence check before the insert. Note that de-duplicating
existing rows is a separate decision: the rows are evidence of what happened and should not be
deleted without the owner saying so.

### P1 — replay produced a signal the live pass did not

`9edec504-62ce-4e37-b1c3-a73b55f7d365` (`mnq_pullback_v1`, long, touch
`prev_day_high@2026-09-08T03:10:00.000Z`, `setupAgeBars` 2) has `fired_at = 06:41:57 UTC` against a
bar that opened at `03:15` and closed at `03:20`. It was created during the multi-bar backfill, not
by the live pass over that bar. **There is no live signal for that touch id.**

So the same bars produced a different outcome on replay than they did live. That is precisely the
property §0AF says is guaranteed by test — that a setup carried across requests resolves identically
to the same bars run in one pass.

Two candidate explanations, and this review cannot separate them from the data alone:

1. The footprint differed between the two passes. `reconcilesFootprint()` gates both order-flow
   triggers, and before PR #105 a re-send could change a stored bar's footprint. The backfill
   straddles that deploy.
2. The carry and the single-pass evaluation genuinely disagree, and the equality test does not cover
   the case that occurred.

**Required:** the executor should reproduce this specific window (`MNQU6`, `03:05`–`03:25`) both ways
and say which it is. If it is (2), the equality guarantee in §0AF is not what the test measures and
the test needs extending. If it is (1), it is closed by PR #105 and should be recorded as closed —
but not assumed to be.

Impact is bounded: replayed signals arrive in a multi-bar batch and are never announced, so this
cannot reach a phone. It does mean `public.signals` contains rows the live system never emitted,
which matters to any measurement taken over that table.

---

## Non-blocking findings

### P2 — a live, eligible signal did not reach Telegram, and nothing records that it failed

`1432c009-81cb-496c-8fa3-c2106f2c52e2` (`mnq_pullback_v1`, short, `05:45:02 UTC`) has
`telegram_message_id = null`. Every gate that could legitimately stop it is open:

| gate | value |
|---|---|
| `ingest_log` for that request | `bars_count = 1`, `error = null` ⇒ not a historical batch, `announce()` ran |
| `signals.muted` / `suppression_reason` | `false` / `null` |
| `rules.telegram_enabled` | `true` |
| `rules.announcement_mode` | `manual` ⇒ `AnnouncementEligibility.allows()` returns true unconditionally (`announcement_policy.ts:35`) |

By elimination `sendSignal()` returned `null`. `announce()` treats that as `continue`
(`ingest.ts`), leaving only a `console.error` in a log nobody reads later.

The database therefore cannot distinguish three different states, all stored as
`telegram_message_id IS NULL`: never eligible, deliberately not announced because the batch was
historical, and **attempted and failed**. For a live preview whose owner-stated acceptance criterion
is that alerts arrive on a phone, the one outcome that matters most is the one that leaves no trace.

**Suggested:** record the attempt — a `telegram_status` / `telegram_error` column, or a row in an
alert log — so "the phone did not ring" is answerable from the database rather than by inference.

### P2 — a multi-bar request silently suppresses announcement of genuinely live signals

`isHistoricalBatch = bars.length > 1` (`ingest.ts:210`) is the right default for a startup backfill.
But the indicator also posts two bars in one request after a brief network stall, and such a request
contains a signal on a bar that closed seconds ago. It is stored and never announced.

Measured over the last 24 hours of `ingest_log` (`error is null`):

| symbol | requests | multi-bar | % | signals created in multi-bar requests |
|---|---:|---:|---:|---:|
| MNQU6 | 206 | 3 | 1.46% | 31 |
| GC | 188 | 4 | 2.13% | 32 |
| NQU6 | 182 | 4 | 2.20% | 25 |
| BTCUSDT | 269 | 4 | 1.49% | 44 |

The rate is low and the design is defensible. It is listed because combined with P2 above there is
no way to tell afterwards which suppressions were intended.

**Suggested:** decide by bar recency rather than batch size — announce a signal whose bar closed
within the last period, whatever else the request carried — or store the reason for not announcing.

### P3 — `gc_sweep_v1.params.marketTickSize` is decorative

Production carries `marketTickSize: 0.1` in `rules.params` for `gc_sweep_v1`. The evaluator hardcodes
`GC_MARKET_TICK_SIZE = 0.1` (`gc_sweep_v1.ts:16`, passed at line 83) and `contractFor()` never reads
the key. Editing it changes nothing, and because `contractFor()` does not see it, the change would
also **not** rename the contract version.

This is the same trap that had to be retracted in §0AE.3, where `zoneProximity`,
`invalidationDistance` and `setupMaxAgeBars` sat in `params` while the contract was hardcoded, and
three backtest variants that moved them returned baseline to every decimal. The fix there — read the
value and rename the version on override — was applied to those three keys but not to this one.

**Suggested:** either read it through `contractFor()` with the version rename, or delete the key from
`rules.params` so nothing looks like a control that is not one. Deleting is the safer of the two: the
tick is a contract fact, not a tuning parameter.

### P3 — the attempt window is the last N rows, not the last N contiguous bars

`buildFailedBreakDecision()` builds `attemptBars` as `[...history, current]` filtered to the current
trading day and `.slice(-attemptWindowBars)` (`named_level_failed_break.ts:86`). If bars are missing,
those three rows can span far more than fifteen minutes, and a sweep from long before would satisfy
"attempted within 3 bars". The module has a contiguity helper (`contiguousTail`) and uses it for the
volatility tail, but not here.

Measured over 7 days on 5m bars, span from the third-last bar to the current one:

| symbol | bars | window exactly 10 min | stretched | % | stretched > 1 h |
|---|---:|---:|---:|---:|---:|
| MNQU6 | 1,330 | 1,317 | 10 | 0.8% | 10 |
| GC | 1,347 | 1,337 | 10 | 0.7% | 10 |

Every stretched window is longer than an hour, meaning all of them cross a session or day boundary —
which the `tradingDay` filter already removes. **The defect has no effect on the current data.** It is
recorded because the correctness rests on a filter that happens to coincide with it, not on the
contiguity the contract describes.

---

## What was verified and passed

### §0T.4 item 1 — the reviewer ran the tests

`deno task test` re-run in this session: **226 passed, 0 failed**. `deno task check`: PASS on all
four entry points. The reported figure was not taken on trust.

### §0T.4 item 2 — causality

- `computeMarketContext()` **throws** on any history bar whose close is at or after the decision
  bar's close (`market_context.ts:137`), and throws on an unclosed history bar. This is an assertion,
  not a filter — a leak cannot pass silently.
- `evaluateFailedBreak()` and the pullback engine reject a decision bar that is not closed and
  require strictly ascending timestamps (`failed_break.ts:118`).
- `attemptBars` and the trigger detectors read only bars up to and including the decision bar.
- `assertInput()` refuses a carried setup whose `lastSeenAt` is not strictly before the first bar of
  the batch, so a carried setup cannot re-see a bar.

### §0T.4 item 3 — percentile leakage

`VOLATILITY_CONTRACT` uses `nearest_rank` over `contiguousTail`, built by walking **backward from the
decision bar** and breaking on a gap larger than `maxBarSpacingMs` (`market_context.ts:158-168`). The
decision bar's own range is computed separately as `currentRange` and is **not** in `samples`. The
median true range that scales every anchor threshold therefore comes from a trailing window that ends
before the bar being judged. **No leakage.**

### §0T.4 item 4 — thresholds frozen before the run

Contract versions are module constants. `contractFor()` in all three evaluators reads its parameters
and **renames the contract version when any of them moves** — e.g.
`MNQ_PULLBACK_V1@live-preview-1+zoneProximity=0.75`. Production parameters equal the frozen defaults:

| rule | frozen | production | contract version in stored setups |
|---|---|---|---|
| `mnq_pullback_v1` | zone 0.5 · invalidation 0.75 · age 6 | 0.5 · 0.75 · 6 | `MNQ_PULLBACK_V1@live-preview-1` |
| `mnq_reversal_v1` | distance 0.25 · window 3 · age 6 | 0.25 · 3 · 6 | `MNQ_REVERSAL_V1@live-preview-1` |
| `gc_sweep_v1` | sweep 0.25 · window 3 · age 6 · order_flow | 0.25 · 3 · 6 · order_flow | `GC_SWEEP_V1@S-A-arm-2-live-preview-1` |

The stored `contract_version` on every setup row carries no `+override` suffix, which is consistent.
The exception is the decorative key in P3 above.

### §0T.4 item 5 — arithmetic reproduced by hand

Trading day boundary is 17:00 America/Chicago (`SESSION_DEFINITION`,
`tradingDayRolloverMinute: 17*60`). For decisions stamped trading day 2026-09-08, the previous
trading day is `[2026-09-06 22:00Z, 2026-09-07 22:00Z)`. Recomputed from raw `bars`:

| symbol | hand-computed prev-day high | stored `anchor_price` | prior-day bars | ≥ 70 required |
|---|---:|---:|---:|:--:|
| GC | **4481.60** | 4481.6 | 246 | ✓ |
| MNQU6 | **29684.25** | 29684.25 | 228 | ✓ |

Both anchors match exactly, and both previous days clear `MIN_PREVIOUS_DAY_BARS = 70` comfortably, so
`previous_day_completeness` is genuinely satisfied rather than accidentally passed.

Direction and invalidation semantics also reproduce: every stored setup is `short` off
`prev_day_high` for the failed-break strategies, closing with `invalidated:swept_again` (sweep) or
`invalidated:attempt_resumed` (reversal) — which is `close > anchorPrice` for a short
(`failed_break.ts:174`), i.e. the break resumed. That is the correct reading of the event.

### §0T.4 item 6 — write paths

- `public.signals` is written only by `persistSignals()` in `_shared/ingest.ts`, deduplicated by the
  unique constraint on `(bar_id, rule_key, direction)` with `ignoreDuplicates`.
- Telegram is reached only by `announce()`, gated on `telegram_enabled` and `muted`, and only when
  the request was not a multi-bar batch.
- **`backtest` contains no write to `signals` and no Telegram call at all** — it reads
  `telegram_enabled` as a column and never acts on it. The isolation §0AC claimed still holds now
  that the same evaluators are shared with live.

---

## Roles and scope

| Role | Who |
|---|---|
| Proposer | HANDOFF §0AC spec and the owner's scope choices |
| Executor/Recorder | Codex session that wrote PRs #103/#104 |
| Independent Reviewer | this session (wrote none of the code under review) |
| Owner | the user; L3 approval for the live preview already given and recorded in §0AG |

Not reviewed: PR #105 (this session wrote it); the ATAS indicator C# source; migrations
0033/0034/0036/0037/0038, which remain unapplied and blocked on separate conditions; and any claim
about profitability, which no evidence in this project currently supports.

## What would change this verdict

A demonstration that P1 (replay divergence) is case (2) — that carried and single-pass evaluation
genuinely disagree — would move this to REQUEST CHANGES, because the equality property is what makes
backtest and live comparable at all, and every planned measurement depends on it.
