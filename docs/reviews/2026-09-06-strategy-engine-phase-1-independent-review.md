# Independent review — Strategy Engine Phase 1

Subject: commit `62618e7` (implementation) and `55dfa95` (handoff), merged as PR #88.
Reviewer: Claude session `0163k6pVFTJVEUmbCsHUn3z3`, which did not write the Phase 1 code.
Role basis: HANDOFF §0T. The reviewer wrote `docs/STRATEGY_ENGINE_PLAN.md`, so findings against the
**plan** below are findings against the reviewer's own design and are marked as such.

## Verdict

**ENDORSE WITH CHANGES.** The code is causally sound, genuinely isolated from production, and its
arithmetic reproduces by hand. Nothing needs reverting: migration 0037 is unapplied and no module is
imported by the signal path, so the merged state is inert.

Three changes are required **before Phase 1 output is integrated or used by any strategy**. Two are
about data the engine will consume rather than the engine itself, and one is a defect in the plan the
engine faithfully implemented.

## Blocking findings

### P1 — the profile is built from footprints that do not reconcile with their own bar

`key_levels.ts` `profile()` validates only that a level's price and volume are finite and that
volume is not negative (lines 71-77). It does not check that the level's price lies within the bar's
own high/low, and it does not check the footprint against the bar's totals. Every level of every
profile-session bar is pooled into the volume map that produces VWAP, POC, VAH and VAL.

Measured on live data, on-grid closed 5-minute bars since 2026-08-28:

| symbol | on-grid bars | bars with levels priced outside the bar's own high/low | bars whose footprint tick sum ≠ the bar's ticks |
|---|---:|---:|---:|
| GC | 1,530 | **555 (36.3%)** | **797 (52.1%)** |
| MNQU6 | 1,537 | 459 (29.9%) | 654 (42.6%) |
| NQU6 | 1,162 | 318 (27.4%) | 408 (35.1%) |
| BTCUSDT | 1,821 | 259 (14.2%) | 372 (20.4%) |

And the heaviest level is itself outside its bar's range on 2.21% of MNQU6 bars and 2.09% of GC bars,
so this is not confined to stray edge levels — it reaches the price the profile would call the POC.

The repository already has the standard this misses. `research/hybrid_ml/dataset.py`
`footprint_reason()` excludes exactly these bars, with the reasons `invalid_footprint_levels` and
`footprint_tick_mismatch`, and the ML work would not score a candidate built on one. Phase 1 applies
no equivalent rule, so on GC roughly a third of bars would contribute prices the bar never traded to
the level a strategy is meant to trade against.

**Required:** either reject a bar whose footprint fails the same reconciliation the ML pipeline uses
and surface it as a distinct `ProfileStatus`, or state explicitly in the frozen contract that key
levels are computed over unreconciled footprints and carry that caveat into every downstream claim.
The first is strongly preferred; the second at least stops the number being trusted silently.

### P1 — a feed gap turns an ordinary bar into a "high volatility" regime

`market_context.ts` computes true range against `ordered[index - 1].close` (line 141) and the
decision bar against `ordered.at(-1)?.close` (line 144), with no requirement that the previous bar is
adjacent in time. HANDOFF §3.7b records that gaps are normal on this feed because the chart is not
left open, and measures days holding 159 of a possible 288 bars.

Reproduced with the module itself, twelve identical 0.5-range history bars and a decision bar whose
own range is also 0.5:

| scenario | true range | high threshold | regime |
|---|---:|---:|---|
| decision bar 5 minutes after the last history bar | 0.50 | 0.5 | `normal` |
| identical decision bar, 5 hours after it | **20.40** | 0.5 | **`high`** |

The bar did not become volatile. The terminal was off. The same mechanism also injects gap-sized
ranges into the percentile sample that defines the thresholds.

The repository again has the precedent: `dataset.py` requires thirteen contiguous predecessors and
excludes a candidate as `missing_or_invalid_past_13` rather than reaching across a hole.

**Required:** the volatility contract must define bar adjacency — a maximum permitted spacing between
consecutive samples and between the last history bar and the decision bar — and return
`insufficient_history` rather than a regime when it is violated. This is a contract field, so it
belongs in the immutable version alongside `lookbackBars` and `minSamples`.

### P1 — a session named in exchange-local time does not track the market it is named after
*(this is a defect in the plan, which the implementation followed correctly)*

`STRATEGY_ENGINE_PLAN.md` §4 says sessions must be "defined in exchange time with daylight saving
handled explicitly". `market_sessions.ts` does exactly that, and does it correctly. But Asia and
Europe are not exchange-local concepts, and their markets do not change clocks with Chicago.

Reproduced with the module, a window fixed at 19:00-23:00 `America/Chicago`:

| | window start, exchange-local | the Tokyo clock it covers |
|---|---|---|
| winter | 19:00 | 10:00 |
| summer | 19:00 | 09:00 |

Japan keeps no daylight saving, so a Chicago-anchored "asia" window slides an hour against Tokyo
twice a year. Any session comparison spanning a DST change compares two different things, and the
plan's own requirement to "split results by session" inherits that.

**Required:** the session definition needs a per-window time zone, not one exchange zone for all
windows, so `asia` can be anchored in `Asia/Tokyo` and `europe` in `Europe/London` while
`us_regular` stays in `America/Chicago`. The schema in 0037 stores windows against a single
definition-level zone, so this is a migration change and is better made before 0037 is applied than
after.

## Items that passed review

These were checked, not assumed.

- **Causality fails closed.** `computeKeyLevels` rejects unclosed bars and any bar closing after
  `decisionAt`; `computeMarketContext` rejects history closing at or after the decision bar's close.
  Both throw rather than degrade.
- **No look-ahead in the percentile sample.** The threshold sample is built from history only; the
  decision bar's own range is computed separately and never enters the distribution. This was the
  reviewer's sharpest prior concern and the code is clean on it.
- **Daylight saving is correct.** On 2026-03-08 in `America/Chicago`, 07:30Z maps to 01:30 local and
  08:30Z to 03:30 local — the 02:00 hour is skipped, and a window covering 02:00-03:00 tags nothing
  that day while tagging 02:30 on 2026-03-07. `hourCycle: "h23"` avoids the 24:00 trap.
- **Arithmetic reproduces by hand.** For levels 99×10, 100×40, 101×50: VWAP 100.4, POC 101, VAL 100,
  VAH 101 by hand, and identical from the module.
- **Isolation is real.** The three modules are imported only by their own tests; they import only
  `types.ts` and `price_action.ts`; `ingest.ts` and `rules/index.ts` reference none of them.
- **Warm-up does not fall back.** Insufficient history yields `insufficient_history` and a null
  regime rather than a global or hand-tuned default.
- **Missing footprint voids the whole profile** rather than computing from part of it, and the
  concern that this would void most sessions in practice was measured and is unfounded: **zero**
  on-grid closed bars since 2026-08-28 lack footprint rows on any instrument.
- **POC and value-area tie rules are deterministic** and documented in the code.

## Non-blocking findings

- **P2 — the value area uses single-row expansion.** From the POC the algorithm compares one row
  above against one row below. Most Market Profile implementations compare the next *two* rows on
  each side. On levels 100×5, 101×30, 102×50, 103×1, 104×1, 105×13 this module returns VAL 101 while
  the two-row convention returns VAL 100. The rule is deterministic and documented, so this is a
  comparability question, not a defect — but strategies are specified to trade *at* VAL/VAH, and a
  value area that differs from the one on the trader's own chart will disagree about which bars
  qualify. Decide and record which convention is intended.
- **P2 — `previousTradingDay` is the most recent day present, not yesterday.** With a gapped feed it
  can be several days old. The engine discloses it in `diagnostics.previousTradingDay`, which is the
  right design; the consumer needs an explicit staleness rule so `previousDayHigh` is not read as
  yesterday's when it is not.
- **P2 — `extrema` spreads arrays into `Math.max`.** Safe at session sizes; would fail on a very
  large bar set. Worth a note rather than a change.

## Process findings against the §5 design review

The §5 review was requested with an acceptance criterion that every one of the eight doubts in
`STRATEGY_ENGINE_PLAN.md` §13 be addressed, with an explicit answer on score-versus-boolean, a
verdict, and output in `docs/reviews/`.

What was delivered materially improved §5 — the eligibility/direction gate, the "missing is not zero
evidence" rule and the full percentile contract are real gains, and the second was not on the
reviewer's list at all. But four doubts are unanswered: **1** (why six hand-written weights should
succeed where the single hand-written `confidence` failed, §5.19), **6** (three strategies ranked on
one small dataset is a multiple comparison), **7** (a high score bar on thin data reproduces the V4
gate), and **8** (score or boolean first — which the contract required to be answered explicitly
because it contradicts the brief and is the owner's call). No verdict was recorded in the
ENDORSE/CHANGES/REJECT form, and no file was written to `docs/reviews/`.

Phase 2 is already blocked pending an owner-approved scoring contract, so this does not stall
anything — but doubts 1, 7 and 8 are precisely the questions about whether the scoring layer should
exist, and they should be answered before its contract is approved rather than after.

## Live and Git evidence

Commands run by this reviewer, not relayed:

| check | result |
|---|---|
| `deno task test` (Deno 2.9.6) | **163 passed, 0 failed** — matches the author's claim |
| `deno task check` | pass, all four entry points |
| `deno lint` on the six Phase 1 files | pass |
| disposable PostgreSQL 16.13: `0001` → `0002` → `0037` → `0037` regression | **all four pass** (after creating the `supabase_realtime` publication, absent from vanilla PostgreSQL) |
| every migration `0001`–`0037` in order, then the 0037 regression | 0037 and its regression **pass**; `0005/0017/0018/0019/0021/0022/0032` fail for missing `pg_cron`/`pg_net`, and **`0035` fails by design**, its census guard reporting "found 0 bars and 0 signals, expected 1538 and 543" on an empty database |
| module probes for causality, DST, gap-driven true range, hand-computed profile | recorded above |
| live read-only SQL for footprint reconciliation and footprint presence | recorded above |

**Not verified, stated rather than glossed:** the full chain could not be replayed with `pg_cron` and
`pg_net` present, so migrations depending on them are unexercised here; nothing was run against
production data end to end, because this environment holds no Supabase credentials beyond a read-only
query tool; and the reviewer did not attempt to install the ATAS DLL or exercise anything on the
owner's machine.

## Required repair and re-review

1. Add footprint reconciliation to the key-level engine, or record the caveat in the frozen contract.
2. Add bar-adjacency to the volatility contract and return `insufficient_history` when violated.
3. Move the time zone from the session definition to the individual window, before 0037 is applied.
4. Decide the value-area convention and record it.
5. Answer doubts 1, 6, 7 and 8 from §13 before the Phase 2 scoring contract is approved.

Items 1-3 change code and 0037, so they need their own re-review. Nothing here requires reverting the
merged commits.

## Runtime, deploy and rollback

Production is untouched and this review changed nothing but this file and the handoff entry. Migration
0037 remains unapplied, behind 0033-0036. No Edge Function was deployed, no data written, no rule
parameter changed, no signal created, no Telegram message sent, no ATAS DLL built or installed. Every
database statement this reviewer ran against the live project was a read-only SELECT; the migration
replays ran in a disposable local PostgreSQL that was discarded. Rollback for the reviewed work
remains a revert of `62618e7` and `55dfa95`, with no database state to undo.
