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
