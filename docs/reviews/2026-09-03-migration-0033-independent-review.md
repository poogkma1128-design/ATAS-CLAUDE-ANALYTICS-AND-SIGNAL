# Independent review — migration 0033

Reviewed under `docs/EXPERIMENT_REVIEW_PROTOCOL.md` and HANDOFF §5.21/§5.23.

## Verdict

**Rejected at L2. Do not start Phase 2 and do not apply migration 0033 to production yet.**

Requested action → review migration 0033, then implement Phase 2 only if it passes → **L2** → the
parity and denominator gates can report a pass for incomplete or different cohorts, and the schema accepts
rows that do not represent a valid scored opportunity → the counterfactual can be reported from the wrong
population with internally inconsistent R → GPT/Codex independent reviewer → repair in a new migration,
add executable regression tests, then repeat this review before `rescore.ts` begins.

The source reviewed was production-branch commit `5cc79ba` (migration content from PR #63,
`0bdd9d1`; PR #64 changed one Handoff line only). Claude was both proposer and implementer; this review is
the first independent sign-off attempt and therefore supersedes the self-reported Phase 1 completion claim.

## Blocking findings

### P0 — parity can pass without a baseline

`trail_counterfactual_parity` starts from rows already present in `opportunity_results`, then inner-joins
`signal_outcomes` (`0033:264-268`). Consequently all of these invalid runs return zero mismatch rows:

- no baseline rows were written;
- an expected baseline opportunity was omitted;
- a baseline row has `signal_id = null`;
- a baseline row points to no resolved outcome.

The view contract says “empty is a pass”, so the most serious writer failure is indistinguishable from a
perfect reproduction. It also treats rescored `pnl_ticks = null` as equal to live `pnl_ticks = 0` through
`coalesce` (`0033:271`). Phase 3 must not use this view as its gate until the expected cohort is anchored
independently and missing/extra rows are emitted as mismatches.

### P0 — equal counts are not equal denominators

`arms_agree_on_denominator` compares only `count(*)` per cell (`0033:294,332`). Baseline candidates
`{A,B}` and no-trail candidates `{C,D}` therefore report agreement because both counts are two. The frozen
estimand requires the same complete candidate-key set, including exclusions; compare keys in both
directions, not only their counts.

### P0 — invalid and inconsistent result rows pass the constraints

The current checks allow, among other cases:

- `included = true` with zero/negative risk, missing target or tick size, and `status = 'skipped'`;
- `status = 'resolved'` with missing exit fields, PnL or R;
- an excluded row carrying `exit_reason`, `exit_bar_id`, `bars_used`, ambiguity and excursion fields;
- any free-form `variant`, including a third arm, and a rescore row attached to a `kind = 'sweep'` run;
- stored `r` that disagrees with `pnl_ticks / risk_ticks`;
- two arms in one run stamped with different `evaluator_version` or `data_version` values.

Those rows are then counted by `trail_counterfactual`, where null R is converted to zero. The database is
therefore not yet enforcing the artifact contract that the analysis relies on.

### P1 — cohort export violates the frozen feature/time contract

HANDOFF §5.23 freezes two relevant rules: do not export `muted`, and derive the observation/session from
the opportunity's `bar_opened_at`. The view exports `s.muted` (`0033:395`) and groups on `s.fired_at`
(`0033:364-365`). A production read-only query at `2026-09-02 23:18 UTC` found **68 of 1,006**
confidence-v2 signals whose `fired_at` UTC date differs from the source bar's UTC date; observed ingest lag
ranged from about 5 minutes to more than 1 day. Using `fired_at` therefore changes the session assignment
for real rows, especially backfill, and is not a harmless alias.

## Items that passed static review

- The migration is additive and contains no trigger, signal generation, rule change or Telegram path.
- Candidate identity is generated and unique within one `(run_id, variant)` arm.
- `session_day` on `opportunity_results` is generated from `bar_opened_at` and its UTC/CME limitation is
  stated explicitly.
- RLS is enabled, the signed-in read policy is narrow, and the views use `security_invoker = true`.
- The confidence feature namespace and `f_` prefix reduce accidental label/feature collisions.

These positives do not compensate for the P0 failures because the migration's purpose is to make omission
and population drift impossible to hide.

## Live and Git evidence

- PR #63 merged at `72ea987`; PR #64 merged at `5cc79ba`. Neither had a human/independent review;
  their only PR comment was the Vercel bot.
- Production migration history still ends at `20260902142002 a_sweep_that_finishes_beats_one_that_does_not`.
- At `2026-09-02 23:18:30 UTC`, `opportunity_results`, both trail views and
  `confidence_v2_cohort` were absent and `experiments.kind` did not exist. No production DDL was run in
  this review.

## Required repair and re-review

Do not rewrite merged migration 0033. Add a follow-up migration and executable SQL regression tests that:

1. anchor parity to the frozen expected baseline cohort and emit missing, extra and null-linked rows;
2. compare the exact candidate-key sets between arms;
3. enforce the two allowed variants, rescore run kind, plan/outcome state machine, positive units,
   full excluded-row emptiness, R consistency, and one run-wide evaluator/data version;
4. derive cohort event time from `bars.opened_at` and remove `muted` from the export contract;
5. prove every counterexample above is rejected or returned as a mismatch.

After the follow-up passes an independent raw re-run, Phase 2 may create
`supabase/functions/_shared/rescore.ts` and must call the existing `scorePlan` unchanged with only the
no-trail plan override `trailTriggerTicks: 0`.

## Runtime, deploy and rollback

No runtime code, signal logic, database object, Edge Function, Telegram setting or production data changed.
The only changes from this review are documentation. Rollback is a documentation revert; there is no
runtime rollback.

## Remediation candidate recorded 2026-09-03 — not yet re-reviewed

GPT/Codex, acting as the Executor/Recorder rather than the independent reviewer, added:

- `supabase/migrations/0034_make_the_counterfactual_fail_closed.sql`;
- `supabase/tests/0034_make_the_counterfactual_fail_closed_test.sql`.

Review target: commit `c91b167` on branch `codex/migration-0034-repair`,
[PR #70](https://github.com/poogkma1128-design/ATAS-CLAUDE-ANALYTICS-AND-SIGNAL/pull/70).

The candidate addresses the five required repairs with a database-frozen expected cohort, explicit parity
reasons, an exact two-way candidate-key difference, row/run/finalization constraints, and separate
confidence training/audit views. The audit view is a post-review governance addition from HANDOFF §5.23
items 6–8: it includes delivery/post-outcome fields for composition checks and stratified reporting only;
the training view excludes `muted`, `suppression_reason`, `telegram_message_id` and `exit_reason`, while
retaining muted and announced rows in the population. Both derive event/session time from
`bars.opened_at`.

Executor verification replayed the relevant schema through 0033, loaded 0034, and ran the SQL regression
inside a transaction on a disposable local PostgreSQL engine. It returned `0034 regression: PASS` for
missing/partial/null/extra baseline cases, null PnL, equal counts with different keys, invalid
variant/kind/state/units/excluded/R/version rows, plan drift, and the three-layer confidence contract.

**This does not change the rejected verdict above.** The person/session that proposed or implemented the
repair cannot approve it under HANDOFF §5.21. Required re-review procedure:

1. apply 0033 then 0034 to a disposable PostgreSQL or Supabase development branch, never production;
2. run `supabase/tests/0034_make_the_counterfactual_fail_closed_test.sql` with errors fatal;
3. inspect raw constraints, both mismatch views and the two confidence view column lists independently;
4. record the database/branch, exact commits, raw result and any untested limitation here;
5. only after an independent pass may Phase 2 `rescore.ts` begin. Production application remains a
   separate owner-approved action.

---

## Independent re-review result — migration 0034 (PR #70) — **REQUEST CHANGES (L2)**

Performed under `docs/EXPERIMENT_REVIEW_PROTOCOL.md` §1–§5 and HANDOFF §5.21/§5.23. The reviewer is
neither the proposer of §5.23 nor the author of 0033 or 0034, and re-derived every claim below by running
raw SQL. Nothing in the GPT/Codex report or in the `0034 regression: PASS` line was accepted as evidence
in place of an own run.

### Verdict

**REJECTED at L2.** Two P0 findings and two P1 findings. Migration 0034 must not be applied to production,
and Phase 2 `supabase/functions/_shared/rescore.ts` remains blocked. The 0033 verdict above is unchanged
and is not superseded by this section.

`requested action` → re-review 0034 and unlock Phase 2 if it passes → **L2** → the frozen manifest is
writable by the same role that writes the arms, and any run that records an exclusion can never complete →
the counterfactual can still be reported over a writer-chosen denominator, and the exclusion census the
artifact exists for is unreachable → GPT/Codex as Executor/Recorder for the repair; owner for any
production apply → a further migration plus a regression suite that proves the two P0 counterexamples below
are rejected, then another independent re-run.

### Environment and exact target

| Item | Value |
|---|---|
| Review target | PR #70 HEAD `7ecd537`; migration/test commit `c91b167`; branch `codex/migration-0034-repair` |
| Merge state | PR #70 was merged into `claude/form-signal-telegram-rz8am1` at `0533eb3` **before** this review existed |
| Review database | disposable local cluster `rev0034` on this session's container — **not** a Supabase project, no network reachability, destroyed with the container |
| Engine | PostgreSQL **16.13** (Ubuntu 16.13-0ubuntu0.24.04.1) |
| Migrations replayed | `0001` → `0034` in order, `psql -v ON_ERROR_STOP=1`, all 34 files applied |
| Vendor suite | `psql -v ON_ERROR_STOP=1 -f supabase/tests/0034_make_the_counterfactual_fail_closed_test.sql` → `0034 regression: PASS`, exit code 0, `ROLLBACK` |
| Production read | project `sckdriuwfyittcybnbhz`, read-only `SELECT` only, at **2026-09-03 01:12:46 UTC** |
| Production engine | PostgreSQL **17.6** |
| Production migration head | `20260902142002` (0032). `opportunity_results`, `trail_rescore_runs`, `confidence_v2_cohort_audit` absent; `experiments.kind` absent |
| DDL executed on production | **none** |

### Scope check — passed

- `supabase/migrations/0033_what_the_trail_actually_cost.sql` is byte-identical on both sides of the PR
  (blob `3645ddc79636ea09ba7442ac05f1244599c3896c` at `ddfcda5` and at `7ecd537`).
- The PR changes five files only: `docs/HANDOFF.md`, `docs/experiments/2026-09-02-trail-counterfactual.md`,
  this review document, `supabase/migrations/0034_make_the_counterfactual_fail_closed.sql`,
  `supabase/tests/0034_make_the_counterfactual_fail_closed_test.sql`.
- Nothing under `supabase/functions/`, `web/`, `atas-indicator/`, `scripts/`, or `deno.json` is touched. No
  rule, filter, `announcement_mode`, Telegram path, cron job or `pg_net` call appears in either SQL file.
  The test file contains no `commit`.

### P0-1 — the writer can author its own "database-frozen" manifest

`0034:45-48` states that the manifest "is independent of both scored arms", and `0034:82-84` that
"the only supported way to create the expected cohort derives it from the database". The privilege model
does not enforce either claim.

`0034:761-785` revokes writes from `anon` and `authenticated` and then **grants** to `service_role`. GRANT
is additive; nothing is revoked from `service_role`, and Supabase's default ACL for the `public` schema
already gives it everything. Verified read-only in production:

```sql
select defaclacl from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
 where n.nspname = 'public' and d.defaclobjtype = 'r';
-- {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,
--  authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
-- (and the same set granted by supabase_admin)
select has_table_privilege('service_role','public.experiments','INSERT');   -- true
select has_table_privilege('service_role','public.experiments','TRUNCATE'); -- true
```

So after 0034 is applied, `service_role` — the role Phase 3 writes as — holds `arwdDxtm` on
`trail_rescore_runs` and `trail_rescore_expected`. Confirmed on the review database:

```
             role      | table                  | privileges held
   service_role        | trail_rescore_runs     | SELECT INSERT UPDATE DELETE TRUNCATE REFERENCES TRIGGER
   service_role        | trail_rescore_expected | SELECT INSERT UPDATE DELETE TRUNCATE REFERENCES TRIGGER
```

**Counterexample (run as `set role service_role`).** The experiment window holds two live resolved trades.
The writer skips `freeze_trail_rescore_cohort` and inserts a one-row manifest of its own choosing:

```sql
set role service_role;
insert into public.trail_rescore_runs (run_id, evaluator_version, data_version, timeframe, expected_count)
values ('aa..c2', 'scorePlan@writer', 'bars@writer', '5m', 1);                       -- ACCEPTED
insert into public.trail_rescore_expected (run_id, symbol, timeframe, rule_key, direction,
       bar_opened_at, signal_id, bar_id, live_exit_reason, live_bars_used, live_pnl_ticks)
values ('aa..c2','RVX','5m','rv_rule','long','2026-03-01 23:50:00+00','aa..b1',91001,'target',1,12);
                                                                                     -- ACCEPTED
-- then one matching baseline row and one no_trail row carrying pnl_ticks 24 / r 6.0000
```

| Check | Expected | Actual |
|---|---|---|
| `trail_rescore_expected` rows | 2 (the live resolved population of the window) | **1** — chosen by the writer |
| `select count(*) from public.trail_counterfactual_parity` | ≥ 1 mismatch | **0** |
| `select count(*) from public.trail_counterfactual_denominator_mismatches` | ≥ 1 | **0** |
| `update public.experiments set status='done'` | rejected | **accepted** |
| `trail_counterfactual.arms_agree_on_denominator` | false | **true** |
| reported `baseline_total_r` / `no_trail_total_r` | 3.0000 / 3.0000 over 2 opportunities | **3.0000 / 6.0000 over 1** |

Live population for the same window, re-derived independently:
`select count(*) from public.signals s join public.bars b on b.id=s.bar_id join public.signal_outcomes o
on o.signal_id=s.id where o.status='resolved' and b.opened_at between …` → **2**.

The anchor is therefore only as strong as the writer's discipline, which is exactly the property the
2026-09-03 rejection required be removed. `0034:751-752` ("State both explicitly so a platform default-grant
change cannot turn a policy into a false sense of protection") states the intent and then omits
`service_role` from every `revoke`.

Files/lines: `supabase/migrations/0034_make_the_counterfactual_fail_closed.sql:761-785`, and the
`freeze_trail_rescore_cohort` grant at `:185-188`.

### P0-2 — recording any exclusion permanently voids the run

`freeze_trail_rescore_cohort` builds the manifest only from signals whose outcome is already
`status='resolved'` with non-null `exit_reason`/`bars_used`/`pnl_ticks` (`0034:157-167`). Parity classifies
a baseline row against that manifest at `0034:401-413`. Consequently **every** `included = false` row is a
parity mismatch:

| Case | `mismatch_reason` returned |
|---|---|
| excluded candidate that is not in the manifest (e.g. `no_plan` on a bar that never produced a signal) | `extra_baseline` |
| excluded candidate that **is** in the manifest (e.g. `insufficient_bars`) | `baseline_excluded` |

Both make `trail_counterfactual_parity` non-empty, which then blocks everything downstream:

```
CE-16 insert a valid excluded baseline row        => ACCEPTED by the row constraints
      trail_counterfactual_parity                 => 1 row, reason 'extra_baseline'
CE-16 insert the matching excluded no_trail row   => REJECTED P0001
                                                     "run aa..c2 baseline parity has not passed"
CE-15 update experiments set status='done'        => REJECTED P0001
```

This is not a corner case. The state machine requires `horizon_bars_seen = horizon_bars` for a `resolved`
row (`0034:334-335`), and `freeze` does not require the forward window to be closed. A trade that resolved
live at bar 2 of a 10-bar horizon can enter the manifest while bars 3–10 are not yet closed; the rescore
must then exclude it (`insufficient_bars` / `unclosed_bar`) or write it as `expired`, and both give
`baseline_excluded` / `baseline_not_resolved`. Near the right edge of any real data window that is the
normal case, so a run that reaches `done` on production data would be the exception.

The consequences are the ones HANDOFF §5.23 built this table to prevent:

- the six-value `opportunity_results_exclusion_reason_check` vocabulary (`0033:176-184`) is unreachable;
- `baseline_not_taken` / `no_trail_not_taken` are always `0`, so `r_per_opportunity` is by construction
  identical to `r_per_trade` — the two numbers §5.23 requires be reported side by side "เพราะสองค่านี้
  ต่างกันเท่ากับจำนวนที่ถูก exclude พอดี";
- the estimand degenerates to the intersection of the two arms, which is the selection bias §5.18a found
  and `EXPERIMENT_REVIEW_PROTOCOL` §4 forbids.

0034 contradicts itself here: `guard_rescore_completion` at `:611-613` compares `b.included` and
`b.exclusion_reason` between arms, i.e. it is written on the assumption that excluded rows exist, while
the parity gate guarantees they cannot.

Files/lines: `0034:157-167` (manifest population), `0034:401-413` (`extra_baseline` / `baseline_excluded`),
`0034:544-549` (no_trail block), `0034:576-580` (completion block), `0034:611-613` (the contradiction).

### P1-1 — parity does not anchor the plan that R is divided by

The manifest freezes `live_exit_reason`, `live_bars_used`, `live_pnl_ticks` (`0034:64-67`) and parity
compares only those three (`0034:408-411`). `risk_ticks` — the denominator of the estimand — is never
compared with `public.signals.risk_ticks`. `opportunity_results_r_consistent_0034_check` (`0034:364-380`)
only checks `r = round(pnl_ticks / risk_ticks, 4)` internally.

**Counterexample.** Live `signals.risk_ticks = 4.00`. The baseline arm stores `risk_ticks = 1.00` and the
internally consistent `r = 12.0000`; the no_trail arm mirrors it.

| Check | Expected | Actual |
|---|---|---|
| `trail_counterfactual_parity` | ≥ 1 mismatch | **0 rows** |
| `update public.experiments set status='done'` | rejected | **accepted** |
| `trail_counterfactual.baseline_total_r` | `3.0000` | **`12.0000`** |

The frozen packet says the run is void unless the baseline reproduces `public.signal_outcomes` exactly.
A 4× error in every reported R currently satisfies every gate.

### P1-2 — the artifact is not sealed after `done`, and the view that is read carries no parity signal

`trail_counterfactual` has 22 columns and none of them reports parity; its only integrity flag,
`arms_agree_on_denominator`, is candidate-set equality (`0034:502-510`). Gates run at write time and at the
`running → done` transition and never again.

```
after the run is finalized:
  update opportunity_results set pnl_ticks=40, r=10.0000 where variant='no_trail' and direction='long'
        => ACCEPTED. parity = 0 rows, denominator mismatches = 0,
           trail_counterfactual.no_trail_total_r 3.0000 -> 10.0000
  delete from opportunity_results where direction='short'   (the matching pair, both arms)
        => ACCEPTED. arms_agree_on_denominator stays true; only the parity view shows the loss
  update opportunity_results set pnl_ticks=40, r=10.0000 where variant='baseline' and direction='long'
        => ACCEPTED. parity = 1 row, but trail_counterfactual still reports baseline_total_r 10.0000
```

The `no_trail` arm has no anchor at any point — parity constrains only the baseline. So
`0033:246-249` ("shipped as a view rather than left as a query somebody remembers to run") is still not
true of the number a reader actually consumes.

### P2 — smaller items, none of them blocking on their own

1. **0034 is not re-runnable.** Re-applying it aborts immediately:
   `ERROR: relation "experiments_id_kind_key" already exists` at `0034:23`. The `duplicate_object` handler
   does not catch `duplicate_table` (SQLSTATE 42P07) raised when the unique constraint builds its index.
   `create table` (`:25`), `create index` (`:77,:79`), `create trigger` (`:210,:555,:631`) and
   `create policy` (`:756,:758`) are unguarded too. 0033 deliberately kept itself re-runnable
   (`0033:233-235`) and the evidence packet's rollback plan relies on that property.
2. **`authenticated` keeps write privileges on all six new/rebuilt views.** 0034 grants SELECT and revokes
   only from `anon`. Measured: `authenticated` holds `SELECT INSERT UPDATE DELETE TRUNCATE REFERENCES
   TRIGGER` on `confidence_v2_cohort`, `confidence_v2_cohort_audit`, `confidence_v2_features`,
   `trail_counterfactual`, `trail_counterfactual_parity` and
   `trail_counterfactual_denominator_mismatches`, and successfully executed
   `create trigger … instead of insert on public.confidence_v2_cohort` in the review database. Production
   already shows the same shape on the existing 0029 view (`has_table_privilege('authenticated',
   'public.confidence_v2_progress','TRIGGER')` → `true`).
3. **`anon` keeps SELECT on `opportunity_results`.** `0034:763-764` revokes only DML. RLS returns 0 rows so
   the impact is nil, but it is inconsistent with the explicit `revoke all … from anon` used on every other
   new object.
4. **Two FKs to `public.bars` still have no supporting index**: `opportunity_results.bar_id` and
   `.exit_bar_id`, both `ON DELETE SET NULL`, on the highest-churn table in the schema. Inherited from
   0033; 0034 indexes the new tables' FKs but not these.
5. **The two confidence views describe different populations.** `confidence_v2_cohort` filters
   `o.status = 'resolved'` (`0034:680`); `confidence_v2_cohort_audit` does not (`0034:713-714`). Measured:
   flipping one outcome to `pending` gives cohort = 1, audit = 2. §5.23 item 6 gives the audit view exactly
   two jobs — checking mute/announced balance between train and holdout, and reporting results split by
   group — and both need the same denominator as the training view.
6. **The regression suite's negative cases prove less than they appear to.** `expect_error`
   (`test:20-32`) treats *any* exception as a pass. Verified: a misspelled table name, an outright syntax
   error and a wrong column count are all reported as correctly rejected. The `assert_true` cases are sound;
   the `expect_error` cases need the expected SQLSTATE or constraint name asserted.
7. **`kind='rescore' AND status='done'` is not by itself proof the gates ran.**
   `guard_rescore_completion` fires only on `UPDATE` with a changed status (`0034:568-569`). Inserting an
   experiment already at `kind='rescore', status='done'` is accepted, and flipping a `sweep` row that is
   already `done` to `kind='rescore'` is accepted. Neither reaches a bad artifact — `freeze` requires
   `status='running'`, and flipping a live rescore run to `sweep` is blocked by
   `trail_rescore_runs_experiment_kind_fk` — but a reader must check the artifacts, not the status.

### What the re-review confirmed as fixed

Every item below was re-derived on the review database with the reviewer's own fixtures (symbol `RVX`,
signals `aa…b1`/`aa…b2`, experiments `aa…c1`/`aa…c2`), not with the vendor test's fixtures.

**Required repair 1 — parity anchored to a frozen manifest, omissions emitted.** Each case produced the
right explicit reason and no silent pass:

| Counterexample | `mismatch_reason` |
|---|---|
| no baseline rows at all | `missing_baseline` × 2 |
| one of two baseline candidates missing | `missing_baseline` × 1 |
| baseline row with `signal_id = null` | `null_linked_baseline` |
| baseline row linked to the other signal | `wrong_signal_link` |
| baseline candidate absent from the manifest | `extra_baseline` |
| baseline row left `pending` | `baseline_not_resolved` |
| baseline `exit_reason` differs from live | `outcome_mismatch` |
| complete, matching baseline | *(empty)* |

The 0033 `coalesce(null, 0) = coalesce(0, 0)` hole is closed twice over, tested against a live trade whose
PnL really is `0.00`: a `resolved` row with `pnl_ticks = null` is rejected by
`opportunity_results_state_0034_check`, and the same candidate written as `pending` is emitted as
`baseline_not_resolved`.

**Required repair 2 — exact candidate-key sets.** Two baseline rows and two no_trail rows with disjoint
keys: `trail_counterfactual_denominator_mismatches` returns **4** rows
(2 × `missing_from_baseline`, 2 × `missing_from_no_trail`) and `update experiments set status='done'` is
refused with `rescore run … has unequal candidate sets`. A cell present in one arm only reports
`arms_agree_on_denominator = false`.

**Required repair 3 — row, run and completion contracts.** All rejected, 0 rows written:
third variant `trail_half` (`opportunity_results_variant_0034_check`); artifact attached to a `kind='sweep'`
run and `freeze_trail_rescore_cohort` called on one (FK + `P0001 has kind sweep, expected rescore`);
included row missing `target_price`; `risk_ticks = 0`; `risk_ticks = -4`; `tick_size = 0`;
`horizon_bars = 0`; `included` with `status='skipped'`; `resolved` with no exit fields; `resolved` with
`r = null`; `resolved` with no full-horizon excursions; excluded rows carrying a plan, `exit_reason`/
`bars_used`, `mfe_horizon_ticks`, or `pnl_ticks`/`r`; `r = 2.99` against `pnl/risk = 3`; `r` with the wrong
sign; a second `evaluator_version` or `data_version` inside one run (FK to `trail_rescore_runs`);
`no_trail` with `trail_trigger_ticks = 2`. Completion is refused when only one arm exists, when any row is
still `pending`, and when the `no_trail` arm drifted `stop_price`; a clean run finalizes and
`trail_counterfactual` then reports it.

Frozen-cohort tampering is refused: `update` and `delete` on `trail_rescore_expected`
(`trail_rescore_expected is immutable; create a new run instead`), appending after scoring began
(`cannot extend frozen cohort … after scoring began`), and re-freezing a run
(`cohort … is already frozen or scoring already began`).

**Required repair 4 — cohort time and the three-layer muted contract.** Read from
`information_schema.columns`, not from the migration text:

- `confidence_v2_cohort` contains none of `muted`, `suppression_reason`, `telegram_message_id`,
  `exit_reason` — nor `status`, `pnl_ticks`, `bars_used` or `fired_at`. It carries join keys, 15 `f_`
  feature columns, `r` and `label_positive_r`.
- `confidence_v2_cohort_audit` is a separate view object keyed by `signal_id` and carries all four
  delivery/post-outcome fields.
- Population includes both delivery states: 2 cohort rows, 1 muted and 1 announced.
- Event time comes from the bar. Fixture `aa…b1` opened `2026-03-01 23:50 UTC` and fired
  `2026-03-02 00:40 UTC`; both views report `session_day = 2026-03-01`.
- The migration cannot prevent a `join` of the audit view into model fitting; separating the objects is the
  enforceable part and it is done.

**Security items that passed.** `freeze_trail_rescore_cohort` is the only `SECURITY DEFINER` function and
carries `search_path=''`; the three trigger functions are `SECURITY INVOKER` with `search_path=''`;
`opportunity_candidate_key` is `IMMUTABLE` with `search_path=''`. `authenticated` cannot insert into
`opportunity_results` or `trail_rescore_runs` and cannot execute `freeze_trail_rescore_cohort`
(`42501` in all three). `anon` is denied on `trail_rescore_runs`, `trail_rescore_expected`,
`confidence_v2_cohort` and `trail_counterfactual_parity`, and RLS returns it 0 rows from
`opportunity_results`. Every FK on the two new tables has a supporting index.

### Limitations of this re-review — what remains unproven

1. The replay ran on **PostgreSQL 16.13**; production is **17.6**. Nothing relied on below is
   version-specific, but 0034 has never executed on 17.
2. `pg_cron` and `pg_net` do not exist in stock PostgreSQL. To replay `0001`→`0034` the reviewer commented
   out the two `create extension` lines in `0005_cron.sql` and `0017_run_backtest_from_sql.sql` and stubbed
   `cron.schedule` / `cron.unschedule`, `net.http_post`, `net._http_response`, `vault.decrypted_secrets`,
   `auth.uid()` / `auth.role()` and the `supabase_realtime` publication. **No file in this PR was
   modified**, and 0034 touches none of those objects.
3. The role findings assume the migration is applied by `postgres` under Supabase's default privileges.
   That premise was checked read-only against production (`pg_default_acl` above) but the post-apply ACLs
   on the new objects cannot be observed until 0034 is actually applied somewhere.
4. No Supabase development branch was created, so the migration has not run through the Supabase CLI /
   branch tooling — only through `psql` against a local engine.
5. This review says nothing about whether `no_trail` beats `baseline`. No run exists, `rescore.ts` does not
   exist, no bootstrap was performed, and `EXPERIMENT_REVIEW_PROTOCOL` §5 still forbids any significance
   claim.
6. `docs/queries/trail_counterfactual.sql` (Phase 4) and the cohort export (Phase 5) do not exist, so the
   Q1–Q4 re-derivation path was not exercised.

### Required before the next re-review

Do not rewrite 0033 or 0034. Add a further migration and extend the regression suite so that:

1. `service_role` cannot write `trail_rescore_runs` or `trail_rescore_expected` at all — explicit
   `revoke insert, update, delete, truncate, references, trigger … from service_role`, leaving
   `freeze_trail_rescore_cohort` as the only entry point, with a test that runs as `service_role` and
   proves the direct insert is denied;
2. an `included = false` row can be recorded without voiding the run — either freeze the manifest over
   candidates rather than resolved signals, or give parity a legitimate-exclusion class that is not a
   mismatch, with a test that finalizes a run containing at least one exclusion and shows
   `not_taken > 0` and `r_per_opportunity <> r_per_trade`;
3. parity anchors the plan as well as the outcome (at minimum `risk_ticks`, `entry_price`, `stop_price`
   against `public.signals`), with the 4× counterexample above as a test;
4. the finished artifact is sealed — no `update`/`delete` on `opportunity_results` for a run whose
   experiment is `done`, and `trail_counterfactual` exposes parity state alongside
   `arms_agree_on_denominator`;
5. the P2 items are addressed or explicitly accepted in writing: re-runnability, `authenticated` write
   privileges on the views, `anon` select on `opportunity_results`, the two unindexed `bars` FKs, the
   cohort/audit population mismatch, and `expect_error` asserting the specific SQLSTATE or constraint name.

Until an independent re-run passes: **Phase 2 `rescore.ts` stays blocked, `docs/HANDOFF.md` §7.2 rows O2
and R stay blocked at L2, and applying 0033/0034 to production remains a separate owner-only decision that
this review does not grant.**

### Runtime, deploy and rollback

No runtime code, signal logic, rule, filter, `announcement_mode`, Telegram setting, Edge Function,
production database object or production data was changed by this review. The only production interaction
was read-only `SELECT`. The review database was a disposable local PostgreSQL cluster inside this
session's container. The only changes from this review are documentation; rollback is a documentation
revert and there is no runtime rollback.
