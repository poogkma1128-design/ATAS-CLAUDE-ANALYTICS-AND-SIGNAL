# Independent review — migration 0034

Reviewed under `docs/EXPERIMENT_REVIEW_PROTOCOL.md` and HANDOFF §5.21/§5.23.

Review target: commit `c91b167` (PR #70), read at production-branch commit `0533eb3`.
Reviewer: Claude, a different session from the one that wrote migration 0033.
Author of 0034: GPT/Codex. Author of the rejected 0033: Claude. Neither reviewed its own work.

## Cross-reference — a second independent review of 0034 exists and disagrees

**Migration 0034 has two independent reviews, and they reached different verdicts.** Read both before
acting on either. Neither document's findings or verdict has been edited by this cross-reference; only
this block was added.

| | `2026-09-03-migration-0034-independent-review.md` | `2026-09-03-migration-0033-independent-review.md`, section "Independent re-review result — migration 0034 (PR #70)" |
|---|---|---|
| Verdict | **Accepted at L2**, with two test-coverage findings | **Rejected at L2** — P0 ×2, P1 ×2, P2 ×7 |
| On applying to production | "Migration 0034 may be applied to production together with 0033" | Do not apply; P0-1 is unclosed |
| On Phase 2 | Start after finding R1 closes | Blocked until P0/P1 close |
| Reviewer | Claude, a session that did not write 0033 or 0034 | Claude, a different session that did not write 0033 or 0034, propose §5.23, or perform the other review |

Both reviewed commit `c91b167` (PR #70), both replayed `0001`→`0034` on a disposable PostgreSQL 16
instance, and both got `0034 regression: PASS`. **Where the two overlap they agree.** Both independently
confirm that the three P0 findings and the P1 finding against migration 0033 are genuinely fixed, and both
independently found that `pg_temp.expect_error` accepts any error as a pass (recorded as R2 in one document
and P2-6 in the other).

**The verdicts differ because the two reviews tested different things, not because they measured the same
thing differently.**

| Checked by the "Accepted" review only | Checked by the "Rejected" review only |
|---|---|
| Mutation-testing the suite by dropping one guard at a time — which is how it found **R1**: `trail_rescore_expected` never appears in the test file, so the immutability trigger the whole fix rests on has no coverage | `set role service_role` and writing directly to `trail_rescore_runs` / `trail_rescore_expected` (**P0-1**) |
| | Writing a valid `included = false` row and observing the parity gate (**P0-2**) |
| | Storing a `risk_ticks` that contradicts `public.signals` (**P1-1**) |
| | Mutating `opportunity_results` after the run reaches `done` (**P1-2**) |

So each review carries at least one finding the other does not, and the four P0/P1 items are additive
rather than contradicted: no measurement in the "Accepted" review rebuts them, because that review did not
exercise those paths. Conversely R1 stands on its own and the "Rejected" review did not find it.

**One factual correction.** The "Accepted" review states that the original `{A,B}` vs `{C,D}` denominator
counterexample "turns out to be unconstructible now" because `guard_no_trail_after_parity` refuses a
`no_trail` row until baseline parity passes. It is constructible: write a complete baseline arm first so
parity is empty, then write `no_trail` rows for two *different* candidates — the guard only checks that
parity is currently empty, not that the `no_trail` candidate belongs to the frozen manifest.
`trail_counterfactual_denominator_mismatches` then returns 4 rows and `status = 'done'` is refused with
`has unequal candidate sets`, so the gate does catch it — but it is the denominator view that catches it,
not the write guard.

**Decided by the owner on 2026-09-03 06:25 UTC — production apply stays blocked until P0-1 is closed.**
The one point the two reviews did not reconcile was whether 0033 and 0034 may be applied to production.
Neither review can settle that; it is an owner decision, and the owner has now made it in writing: **do
not apply to production until P0-1 (`service_role` can write `trail_rescore_runs` and
`trail_rescore_expected` directly, and therefore author the manifest the parity gate is anchored to) is
fixed and the fix has passed an independent re-run.** The "Accepted" review's line that 0034 "may be
applied to production together with 0033" is therefore superseded as a recommendation — its findings and
verdict on the schema are untouched. HANDOFF §0J and §7.2 rows O2/R record the same decision.


## Verdict

**Accepted at L2 for the three P0 findings and the P1. Two test-coverage gaps must close before
Phase 2 begins.** The migration itself is not blocked; the gaps are in the regression suite, not in
the schema.

Migration 0034 may be applied to production together with 0033. `rescore.ts` should not start until
finding R1 below is closed, because Phase 3 is what will first exercise the frozen cohort in anger.

## Method — executed, not read

HANDOFF §5.21 hard rule 2 requires a reviewer to query the artifact rather than read the summary.
Every claim below was produced by running SQL on a disposable PostgreSQL 16 instance:

1. replayed `0001`→`0034` in order on an empty cluster. Only three failures, all environment-only
   and identical to those seen on 0033 (`supabase_realtime` publication, `pg_cron`, `pg_net`).
   `0034` applied clean.
2. ran `supabase/tests/0034_..._test.sql` → `0034 regression: PASS`.
3. **mutation-tested the suite**: removed one guard at a time from a clone of the migrated database
   and re-ran the tests. A guard whose removal leaves the suite green is a guard the suite does not
   actually test. This is the same class of defect the 0033 review found in Claude's parity view,
   applied to GPT's tests.
4. constructed the review's own counterexamples by hand through the real write path.

## The three P0 findings are genuinely fixed

Not "the code looks right" — each was reproduced as a failure that the new schema now catches.

### P0-1 — parity can pass without a baseline: **fixed**

`trail_rescore_expected` freezes the expected cohort *with the live outcome values copied into it*
(`live_exit_reason`, `live_bars_used`, `live_pnl_ticks`), so parity no longer starts from the rows
that happen to exist. Executed check: froze a cohort of 1 candidate, wrote **zero** baseline rows,
queried `trail_counterfactual_parity` → **1 mismatch row**. Under 0033 this returned 0 rows and read
as a pass. The worst writer failure is now the loudest.

### P0-2 — equal counts are not equal denominators: **fixed**

Executed check: froze 2 candidates, wrote a complete parity-exact baseline (parity → 0 mismatches),
then wrote a `no_trail` arm covering only 1 of the 2 candidates.
`trail_counterfactual_denominator_mismatches` → **1 row**. Key sets are compared, not counts.

The original `{A,B}` vs `{C,D}` counterexample turns out to be unconstructible now: `guard_no_trail_after_parity`
refuses any `no_trail` row until baseline parity has passed, and both arms are anchored to the same
frozen key set. I confirmed this by hitting the guard: `run ... baseline parity has not passed`.

### P0-3 — invalid result rows pass the constraints: **fixed**

`opportunity_results_state_0034_check` is a full state machine over
`included` × `status` × the plan and outcome columns. It rejected my own hand-written baseline row
twice before I supplied every required field — which is the constraint working, not a defect.
Mutation-tested: dropping `..._state_0034_check`, `..._r_consistent_0034_check` or
`..._variant_0034_check` each turns the suite red.

### P1 — cohort export contract: **fixed, and matches §5.23 rules 6–8**

Queried `information_schema.columns` directly:

- `confidence_v2_cohort` exposes **none** of `muted`, `suppression_reason`, `telegram_message_id`,
  `exit_reason`.
- `confidence_v2_cohort_audit` carries all three of `muted`, `exit_reason`, `suppression_reason`.
- `pg_get_viewdef('confidence_v2_cohort')` contains **no** reference to `fired_at`.

## Findings

### R1 (must close before Phase 2) — the anchor guard has no test

`trail_rescore_expected_immutable` is the trigger the entire fix rests on: if the frozen cohort can
be edited after scoring starts, the parity gate and the denominator gate both become negotiable.

The string `trail_rescore_expected` **does not appear anywhere** in
`supabase/tests/0034_make_the_counterfactual_fail_closed_test.sql`.

Reproduce:

```
drop trigger trail_rescore_expected_immutable on public.trail_rescore_expected;
psql -f supabase/tests/0034_make_the_counterfactual_fail_closed_test.sql
-- still prints: 0034 regression: PASS
```

The trigger itself is correct — I verified `UPDATE` and `DELETE` are both rejected, and that
extending a cohort after `opportunity_results` rows exist is refused. So this is a coverage gap,
not a live defect. It needs three assertions: `UPDATE` rejected, `DELETE` rejected, and post-scoring
`INSERT` rejected.

### R2 (should close) — `expect_error` accepts the wrong errors

`pg_temp.expect_error` catches `when others`, so a statement that fails for *any* reason counts as a
pass — including a typo in the test's own SQL, a renamed column, or a missing fixture. Twenty-seven
assertions rest on it. A counterexample that stops being a counterexample would keep passing silently.

Confirmed the mechanism: `execute 'this is not valid sql at all'` is swallowed by `when others`.

Fix: assert on `SQLSTATE` or match the expected message, so the test proves *why* the statement was
rejected rather than only that it was.

## Items that passed review

- The migration is additive; no trigger on `ingest`, no rule change, no Telegram path, no signal
  generation.
- Guards are write-ordered correctly: cohort frozen → baseline written → parity passes → `no_trail`
  permitted. Each step refuses to proceed until the previous one holds.
- `trail_rescore_runs` pins one `evaluator_version`/`data_version` per run and ties `run_id` to
  `experiments.kind = 'rescore'` through a composite foreign key, so a rescore cannot be filed as a
  sweep.
- RLS enabled on both new tables with narrow signed-in read policies; views are `security_invoker`.
- `expected_count` is enforced: writes are refused while the frozen cohort is incomplete. I hit this
  guard by omitting it.

## Live and Git evidence

- Reviewed at production-branch `0533eb3`; migration content from `c91b167` (PR #70).
- Production migration history still ends at `20260902142002`. Neither 0033 nor 0034 is applied.
  No production DDL was run in this review; all execution was against a disposable local cluster.

## Runtime, deploy and rollback

No runtime code, signal logic, production database object, Edge Function, Telegram setting or
production data changed by this review. The only change is this document. Rollback is a
documentation revert.
