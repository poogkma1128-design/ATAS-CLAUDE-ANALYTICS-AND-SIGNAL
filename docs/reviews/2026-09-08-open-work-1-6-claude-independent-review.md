# Independent review — `codex/open-work-1-6` @ `9eab3a3`

Date: 2026-09-08
Reviewer: Claude session `019AJCKM…` — **did not write** any line of this branch, nor
PR #105, nor the three evaluators. Independent under §0T.
Base compared against: `origin/main` @ `cdd2a37` (after PR #107 merged).
Production mutation: **none.** Every production statement in this document is a
`select`. No migration applied, no function deployed, no row deleted.

## Verdict: **APPROVE**

All six items of §00.1 are addressed, the P1-2 diagnosis is **correct and independently
reproducible from production rows**, and the two migrations that change data semantics are
conservative. Six findings follow; **none of them blocks merge**, but F1 and F2 are
sequencing hazards that must be written into the Handoff before anyone deploys.

---

## 1. What was run

| Check | Result |
|---|---|
| `deno task test` on `9eab3a3` | **234 passed · 0 failed** |
| `deno task test` on `origin/main` (baseline) | 226 passed · 0 failed → **+8 new tests** |
| `deno task check` (4 entrypoints) | **PASS** |
| `deno lint` | 34 problems on **both** branches → no regression (all `no-import-prefix`, pre-existing) |
| `deno fmt --check` | 10 unformatted files on **both** branches → no regression; the 2 new test files are clean |

There is no `.github/workflows/`, so `test` and `check` are the whole gate.

---

## 2. Item-by-item

### Item 1 — `strategy_setups` duplicate prevention and migration fail-closed · **PASS**

`persistStrategyCarry()` now upserts on
`strategy_key,instrument_id,timeframe,anchor_touch_id` with `ignoreDuplicates: true`, and
the resolved branch tries the `status='open'` update **first** and only falls through to the
upsert when it changed nothing (`resolveByTouchId` now returns a row count). That closes the
exact path §0AI.2 identified: a touch id not present in `before.open` used to insert a second
closed row every replay.

Verified against production:

- All four index columns are `NOT NULL`
  (`information_schema.columns` on `public.strategy_setups`) ⇒ the unique index has **no
  NULL escape hatch**; uniqueness is total, not partial.
- No unique index on those four columns exists today — only
  `strategy_setups_one_open_per_anchor` on `(…, anchor_identity) WHERE status='open'`.
  The new index is additive, not a replacement.
- `ingest` is the **only** writer. Nothing in `backtest`, `outcome-notify`,
  `chart-annotations` or `web/` writes this table.
- The existing SQL test `supabase/tests/0040_a_setup_that_outlives_its_bar_test.sql` is
  **not** broken by the new index: its two `prev_day_low` rows carry different touch ids
  (`@14:00` and `@15:00`).

Fail-closed migration `20260908090000` — the guard clause is real and it fires today:

```
total_rows = 23 · duplicate groups = 7 · rows inside those groups = 15
```

so the `raise exception` path is the one that executes right now. It deletes nothing. Good.

I simulated the post-cleanup state read-only:

```sql
with keep as (select * from public.strategy_setups where id not in (13,14,15,16,17,19,20,21))
select count(*) …               -- rows_after = 15
                                -- dup_groups_after = 0
                                -- open_anchor_conflicts_after = 0
```

⇒ with the deletion set in §4 the migration applies cleanly on the first try.

### Item 2 — MNQU6 03:05–03:25 replay: **carry state, confirmed. Not footprint.** · **PASS**

I did not take the executor's word for this. Two production rows settle it:

| id | touch | dir | status / reason | opened | last seen | resolved | created |
|---|---|---|---|---|---|---|---|
| **7** | `prev_day_high@03:00` | short | `rejected` · `invalidated:bias_flipped` | 03:00 | 03:05 | **03:15:02** | 03:05:02 |
| **18** | `prev_day_high@03:10` | long | `triggered` · `stacked_imbalance` | 03:10 | 03:15 | **06:41:56** | **06:41:56** |

Row 18 is a **singleton** — it has no live counterpart at all — and signal
`9edec504-62ce-4e37-b1c3-a73b55f7d365` (seq 8995, `mnq_pullback_v1` long, bar `03:15`,
`fired_at 06:41:57.3`) is the signal it produced. Row 7 was resolved at `03:15:02`, i.e. by
the live request that closed bar **03:10**.

The mechanism is in the engine's own source, not in the data:
`supabase/functions/_shared/strategy/pullback.ts:418-441` keeps a `resolvedThisBar` set, and
every open-new-setup branch (`:568`, `:581`, `:591`) begins

```ts
if (open.has(identity) || resolvedThisBar.has(identity)) continue;
```

with the comment citing §1.5 of the spec: an anchor that closed on a bar cannot also open on
it. So the live pass, arriving at bar 03:10 carrying `prev_day_high@03:00` short, closed it
on that bar and was then **forbidden by design** from opening `prev_day_high@03:10` long. The
06:41 replay began mid-lifetime with no carry, had nothing open on `prev_day_high`, and
opened it.

Footprint is ruled out by measurement, not by argument. Every decision bar in the window is
stored closed with a usable ladder:

| bar | closed | ticks | `cluster_levels` rows |
|---|---|---|---|
| 03:05 | true | 2420 | 91 |
| 03:10 | true | 2978 | 50 |
| 03:15 | true | 2218 | 64 |
| 03:20 | true | 2747 | 50 |
| 03:25 | true | 5235 | 167 |

There is exactly **one** stored copy of each bar, and both runs read it. The differing
variable between the two runs is the carry, and nothing else.

The 294-bar window the executor reports (`2026-09-06T22:00` → `2026-09-08T03:25`, MNQU6 5m,
closed) returns **294** rows when I count it. The number checks out.

**The fix is the right shape.** `ingest.ts` now excludes any bar already stored as closed
from the decision set while still letting a richer snapshot repair `bars`/`cluster_levels`.
`history` is loaded from the database (`loadHistory`), not from the batch, so narrowing the
decision set does not narrow the context the rules see. And the live path here is the
*correct* one per the engine's own spec, so making replay unable to contradict it is
cementing the specified behaviour, not a bug.

### Item 3 — PR #105 re-send guard and race condition · **PASS, with F4**

The read-then-upsert race the executor found is real: `loadStoredBars()` runs at
`ingest.ts:236`, `upsertBars()` at `:262`, and a live close can land between them.

`20260908085500` closes it for `bars` with a `BEFORE UPDATE` trigger. Two details I checked
because getting either wrong would be severe:

- The trigger returns **`old`**, not `NULL`. Returning `NULL` would drop the row from the
  upsert's `RETURNING`, and `barIds[index]` is positionally aligned with `fresh` —
  misalignment would attach signals and levels to the **wrong bar**. Returning `old` keeps
  the row in `RETURNING`. This is the correct choice and it is not obvious.
- Postgres fires `BEFORE` triggers alphabetically. `bars_touch_updated_at` (existing) sorts
  before `keep_richer_closed_bar_before_update`, so the `updated_at` bump is written first
  and then discarded with the rest of the tuple. A suppressed re-send leaves `updated_at`
  untouched, which is what it should do.
- `set search_path = ''` is safe here: the body references only `old`, `new` and `coalesce`.

See F4 for what the trigger does **not** cover.

### Item 4 — Telegram delivery status / error recording · **PASS**

`telegram_message_id IS NULL` no longer conflates three things. The six states the code
writes — `skipped_historical`, `skipped_rule_disabled`, `skipped_muted`,
`skipped_unconfigured`, `sent`, `failed` — are all present in the migration's CHECK
constraint, alongside `pending` (the new default) and `legacy_unknown`. No state the code can
write is missing from the constraint; I checked them one by one.

`announcement_mode` is not a separate hole: it folds into `muted` via
`announcementEligibility.allows()` → `suppression_reason` → `muted`, so it surfaces as
`skipped_muted` with `suppression_reason` already carrying the detail.

The backfill is honest — 929 rows with a message id become `sent`, 3,691 become
`legacy_unknown` rather than being given an invented history. At 4,620 rows the `NOT NULL`
and `CHECK` validation scans are milliseconds; no lock concern.

`callTelegramDetailed()` bounds the reason to 500 chars on both the API-error and
thrown-exception paths, and still never fails an ingest.

### Item 5 — multi-bar request no longer swallows the live announcement · **PASS**

`isHistoricalBatch = bars.length > 1` is replaced by per-bar classification in
`liveClosedBarIds()`: a closed bar counts as live when
`-60_000 ≤ receivedAt − (openedAt + period) ≤ period`. Non-time timeframes
(`timeframeMinutes()` returns `null`) keep the old conservative single-bar rule — a good
default rather than a guess.

The new test pins the boundary properly: at `receivedAt 10:10:02`, the `10:05` bar is live
(lag 2 s) and the `10:00` bar is historical (lag 302 s > 300 s period). One bar either side
of the edge.

Note this cannot re-open the alert-flood risk in the reload case, because a reloaded bar is
already stored closed and is now excluded from evaluation entirely — it produces no new
signal to announce.

### Item 6 — `gc_sweep_v1.params.marketTickSize` · **PASS**

`contractFor()` now reads it through `num()`, rejects non-positive values, and appends
`marketTickSize=<v>` to the contract version when it differs from the frozen `0.1`. `step()`
passes `contract.marketTickSize` instead of the hardcoded constant.

**The important production check:** `rules.params` for `gc_sweep_v1` currently holds
`"marketTickSize": 0.1` — exactly the frozen default. So this change is a **no-op on live
behaviour and leaves `contract_version` unchanged**. Had production held ATAS's `0.40`, this
"cosmetic" fix would have silently changed footprint adjacency *and* rotated the contract
version, rejecting every open setup as `data_unavailable:contract_changed`. It does not.
This is the §0AE.3 trap the finding was about, and it is avoided.

### Item 7 — the three migrations, apply order, rollback, risk · **PASS, with F1/F2**

| File | What it does | Rollback | Risk |
|---|---|---|---|
| `20260908085500_keep_richer_closed_bar_atomic` | trigger + function on `bars` | documented; `drop trigger` + `drop function` | low — 9,254 rows, no rewrite |
| `20260908085800_record_telegram_delivery` | 2 columns, backfill, default, NOT NULL, CHECK, partial index | documented, reverse order | low — 4,620 rows |
| `20260908090000_strategy_setups_idempotent` | fail-closed guard + unique index | documented | **gated**: cannot apply until the 7 duplicate groups are resolved |

Filenames sort correctly after the last applied migration (`20260908051500`). Each
migration carries its own `-- ROLLBACK` block. Reverse-order rollback as the executor
describes is correct: 090000 → 085800 → 085500.

---

## 3. Findings — none blocking

### F1 · P2 · deploy order is load-bearing and the failure is silent

`ignoreDuplicates: true` with `onConflict` becomes
`ON CONFLICT (…) DO NOTHING` in PostgREST. Without a **matching unique index** Postgres
raises `42P10` ("no unique or exclusion constraint matching the ON CONFLICT
specification"). That index does not exist in production yet, and cannot be created until the
owner resolves the duplicates.

If `ingest` is deployed before the migration, `persistStrategyCarry()` throws — and
`ingest.ts:758` catches it and only `console.error`s. The request still returns 200. The
observable result is that **`strategy_setups` silently stops being written**, so
`loadStrategyCarry()` finds nothing on the next request and the three strategies fall back to
single-bar scope — the 1-signal regime §0AF was written to escape. Nobody would see an error.

The order is therefore strict and non-negotiable:

```
1. owner resolves the 7 duplicate groups   (§4 below)
2. apply 20260908085500  and 20260908085800
3. apply 20260908090000                    (fails closed if step 1 is incomplete)
4. deploy ingest
```

`docs/HANDOFF.md` §00.1 says "apply migration ตามลำดับและ deploy `ingest`", which is the
right order but does not say what happens if it is not followed. **Write the consequence
down** — a silent regression is exactly the kind this project keeps paying for.

### F2 · P2 · `supabase db push` would sweep in five owner-blocked migrations

Remote history (`list_migrations`) contains 36 rows and does **not** contain `0033`, `0034`,
`0036`, `0037` or `0038` — the ones gated by §0I/§0J/§0M and by §00.2 item 3. §3 of the
Handoff already warns that local numeric filenames do not match remote timestamp history and
forbids a blanket push; the new work's own apply note should repeat it. Apply the three files
**individually**, then `supabase migration repair --status applied <version>` as was done for
`20260908051500` (§0AH).

### F3 · P2 · one UPDATE per signal undoes the batching this file was built around

`recordTelegramStatus()` issues a single-row `UPDATE` per signal, including for every
`skipped_historical` row. `ingest.ts:258` carries the comment "A hundred-bar backfill used to
cost four round trips per bar; it now costs a handful for the whole request, which is the
difference between the function finishing in a second and timing out." A first-ever ingest or
a post-downtime catch-up of N genuinely new bars now costs N sequential PostgREST round trips
that previously cost zero.

Exposure is smaller than it first looks — a chart **reload** now yields zero new signals, so
zero updates — but the fix is one line of shape:

```ts
await supabase.from("signals")
  .update({ telegram_status: "skipped_historical" })
  .in("id", historical.map((s) => s.id));
```

### F4 · P3 · the trigger makes `bars` atomic, not the invariant

PR #105's guard protects **both** `bars` and `cluster_levels` (a superseded bar is dropped
from `fresh`, so `upsertLevels()` never runs for it). The new trigger protects `bars` only.
In the race window the replay's bar stays in `fresh`, so `upsertLevels()` runs and
`cluster_levels` is upserted `onConflict: "bar_id,price"` — which **replaces**
`ask/bid/volume/ticks` per price rather than accumulating them. The outcome is a rich bar row
with a thinned ladder: precisely the reconcile mismatch of §0AE.5, arrived at from the other
side.

This is still strictly better than before (previously both halves were thinned), and the
window is sub-second. But the review doc's phrase "the invariant is atomic" is stronger than
what was delivered — it is **narrowed**, not closed.

### F5 · P3 · a bar whose live evaluation failed can no longer be recovered

`if (prior?.isClosed) continue;` is unconditional. If a live pass stored a bar and then died
before evaluating it — or if the strategy-store write failed and was swallowed at
`ingest.ts:758` — a re-send used to be the recovery path. It no longer is, and `signals` is
unique on `(bar_id, rule_key, direction)` with `ignoreDuplicates`, so there is no other route
in. This is a defensible trade (idempotency over recovery) but it is undocumented. Say so in
`docs/SETUP.md` next to the sentence that was added there.

### F6 · P3 · idempotency is tested against a fake, not against Postgres

`strategy_setups_test.ts` asserts the *call shape* — that `upsert` was invoked with the right
`onConflict` string and `ignoreDuplicates`. It cannot fail if the index is missing, wrong, or
never applied, which is the failure F1 describes. `supabase/tests/` already holds a
DB-level test in this exact style (`0040_…_test.sql`); a sibling asserting `23505` /
`strategy_setups_one_row_per_touch` on a repeated touch id would close the gap.

---

## 4. `strategy_setups` duplicates — every group, and what to keep

**Nothing here has been deleted. These are proposals for the owner (§00.2 item 2).**

Read across every group the pattern is identical and unambiguous:

- the **lower id** was written live, minutes after the bar, and carries the true
  `saw_evaluable_trigger` / `saw_opposing_trigger` flags;
- the **higher id** was written by the 06:40–06:41 replay batch, has every `saw_*` flag
  reset to `false`, and has `age_bars` inflated by one and `last_seen_at` extended by one
  bar — the signature of a run that began without the live carry.

The live row is the record of what actually happened and what actually could have reached a
phone. **Keep the live row; the replay row is the artefact.**

| # | strategy | symbol | `anchor_touch_id` | status | **KEEP** | **DELETE** |
|---|---|---|---|---|---|---|
| 1 | `gc_sweep_v1` | GC | `prev_day_high@2026-09-08T03:25:00.000Z` | rejected · `invalidated:swept_again` | **8** | **13** |
| 2 | `gc_sweep_v1` | GC | `prev_day_high@2026-09-08T04:20:00.000Z` | rejected · `invalidated:swept_again` | **9** | **14** |
| 3 | `gc_sweep_v1` | GC | `prev_day_high@2026-09-08T05:00:00.000Z` | rejected · `expired_unfired` | **10** | **15** |
| 4 | `mnq_pullback_v1` | MNQU6 | `prev_day_high@2026-09-08T02:45:00.000Z` | rejected · `invalidated:closed_through_anchor` | **5** | **16, 17** |
| 5 | `mnq_pullback_v1` | MNQU6 | `prev_day_high@2026-09-08T05:30:00.000Z` | **triggered** · `stacked_imbalance` | **12** | **19** |
| 6 | `mnq_reversal_v1` | MNQU6 | `prev_day_high@2026-09-08T02:50:00.000Z` | rejected · `invalidated:attempt_resumed` | **6** | **20** |
| 7 | `mnq_reversal_v1` | MNQU6 | `prev_day_high@2026-09-08T05:25:00.000Z` | rejected · `invalidated:attempt_resumed` | **11** | **21** |

**Keep (7 ids):** `5, 6, 8, 9, 10, 11, 12`
**Delete (8 ids):** `13, 14, 15, 16, 17, 19, 20, 21`

Group 5 is the pair §0AI flagged as `triggered` on both rows — the one that would have
double-counted a real trigger. Group 4 is the only group of three: the replay ran twice
(06:40:53 and 06:41:56).

The statement, **for the owner to run, not for an AI**:

```sql
-- read the 8 rows one last time before removing them
select * from public.strategy_setups where id in (13,14,15,16,17,19,20,21);

delete from public.strategy_setups where id in (13,14,15,16,17,19,20,21);
-- expected: DELETE 8, leaving 23 - 8 = 15 rows and 0 duplicate groups
```

Verified read-only that this is exactly sufficient: 15 rows after, 0 duplicate groups, 0
`status='open'` anchor conflicts ⇒ `20260908090000` then applies.

### One row that is **not** a duplicate and must **not** be deleted

**id 18** — `mnq_pullback_v1` / `prev_day_high@2026-09-08T03:10:00.000Z` / long /
`triggered` / created `06:41:56`. It is a singleton, so the unique index is indifferent to
it, but it is the **replay-manufactured setup of P1-2** and the parent of signal
`9edec504-62ce-4e37-b1c3-a73b55f7d365` (seq 8995). Keep both as evidence. If the signal
census is ever recomputed, exclude seq 8995 from "signals the live system produced" — it
never existed live, and it never reached Telegram (`telegram_message_id` is null and it
arrived inside a multi-bar batch).

### Reminder that still stands

Frequency, expiry rate and trigger intensity **must not** be computed from
`strategy_setups` until the deletion above is done *and* `20260908090000` is applied.
Until then 8 of 23 rows are replay artefacts — 35% of the table.

---

## 5. What this review did not do

- Did not re-run the executor's offline 294-bar carry-vs-single-pass comparison. The
  production rows 7 and 18 plus the `resolvedThisBar` rule establish the same conclusion
  from evidence that cannot be re-parameterised, so the offline run would have been a
  weaker check, not a stronger one.
- Did not exercise the three migrations against a database. Applying them is a write, and
  `20260908090000` is gated on an owner decision.
- Did not evaluate whether any of this makes money. It does not bear on that question and
  nothing in this branch changes strategy logic.
