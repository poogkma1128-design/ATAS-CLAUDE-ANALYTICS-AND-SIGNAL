# Codex review and execution record — §00 items 1–6

Date: 2026-09-08  
Role: independent reviewer of PR #105; implementer for the follow-up fixes  
Production mutation: none

## PR #105 review

Reviewed merge `b84e553` and its source commits `cda29b2` / `6c196c6` for
correctness, concurrency, failure handling, and regression coverage.

The re-send guard correctly scopes its lookup to the request's instrument,
timeframe, and timestamps, and correctly keeps both halves of a thinner replay
(`bars` and `cluster_levels`) untouched. Its five tests cover the ordinary
sequential cases.

Finding — **P1 / request changes**: the protection is a read followed by a later
upsert. A live close can write the richer row between those operations, after
which the replay can still overwrite it. Migration
`20260908085500_keep_richer_closed_bar_atomic.sql` adds a database `BEFORE UPDATE`
trigger so the invariant is atomic. The Edge Function guard remains as the cheap
normal path and diagnostic counter.

## Production replay of MNQU6 03:05–03:25 UTC

Read-only source: production `bars`, `cluster_levels`, `rules`, `signals`, and
`strategy_setups` in project `sckdriuwfyittcybnbhz`. The exact production params
and 294 causal bars from 2026-09-06 22:00 through 2026-09-08 03:25 were passed to
the repository's own `buildDecision()` and `evaluatePullback()`.

All five decision bars from 03:05 through 03:25 had usable stored footprints.
The result is therefore **not explained by footprint differences**:

- single-pass beginning at 03:05 had no earlier carry, opened
  `prev_day_high@03:10` long, and triggered it at 03:15 by
  `stacked_imbalance`;
- the live path entered 03:10 carrying `prev_day_high@03:00` short, rejected it
  at 03:10 as `invalidated:bias_flipped`, and correctly did not open another
  setup on the same anchor/bar;
- a full causal run and a per-bar carried run over the same 294 bars were equal.

Root cause: a replay that starts in the middle of a setup's lifetime lacks the
carry immediately before its first bar. A stored closed bar is now allowed to
repair a richer snapshot but is excluded from evaluation, preventing that replay
boundary from manufacturing a signal the live pass never created.

## Follow-up fixes prepared

1. Durable setup writes use a composite touch identity and upsert. The matching
   unique-index migration refuses to apply while duplicate evidence exists; it
   deletes nothing and preserves the owner's decision over the 7 groups / 15
   rows currently present in production.
2. Telegram delivery records `sent`, `failed`, or a specific `skipped_*` state;
   transport/API failures retain a bounded reason. Existing null rows become
   `legacy_unknown` rather than receiving an invented history.
3. Announcement freshness is per bar. A current close in a multi-bar request can
   announce, while older bars remain stored without alerting.
4. `gc_sweep_v1` reads `marketTickSize` through `contractFor()` and includes an
   override in the contract version.

## Gate and rollback

Nothing in this change set is deployed. Independent Claude review is required
before merge/deploy. The unique-index migration additionally requires the owner
to resolve existing duplicate evidence first. Rollback is to redeploy the prior
`ingest` bundle and revert/drop the three new migrations in reverse order using
their documented rollback statements.
