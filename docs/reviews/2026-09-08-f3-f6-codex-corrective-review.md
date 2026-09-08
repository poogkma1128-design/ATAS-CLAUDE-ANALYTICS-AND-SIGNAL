# Corrective review — F3–F6 on `main`

Date: 2026-09-08

Reviewer: Codex session on branch `codex/review-f3-f6-main`

Base: `main` at `ffa282afeba7c5fc30c913f148fbf2d4f006e6e5`

Reviewed implementation: `4fa2ce8e59e761c3cdfeeb041d89165fa1125a19` (Claude)

Corrective implementation: `9124b31` (Codex; requires a fresh Claude review)
Production mutation: none. No migration was applied, no function was deployed, and no production row was read or written.

## Verdict

F6 passes independently. F3 and F5 had two narrow review findings, corrected in `9124b31`.
F4 remains an owner design decision; this branch does not edit its migration. Nothing in this
packet authorizes applying `20260908150000_keep_richer_cluster_level.sql` or deploying `ingest`.

Because Codex authored the F3/F5 corrections, a fresh Claude session must review this branch before
merge under HANDOFF §0T. The owner must choose the F4 contract before that review can give a final
verdict on all four findings.

## Finding review

### F3 — corrected, pending fresh review

The historical path correctly changed from one `UPDATE` per signal to one
`update(...).in("id", ids)` statement. The implementation also grouped
`skipped_unconfigured`, `skipped_rule_disabled`, and `skipped_muted`, and reordered live-path status
writes ahead of Telegram sends. That was outside the requested change and altered sequencing without
a finding that required it.

Commit `9124b31` retains the one-statement historical update while restoring the live-path status
writes and `sent`/`failed` writes to their previous per-signal order. The unit test now proves that a
mixed request uses `.in()` for the historical signal and `.eq()` for the live unconfigured signal.

### F4 — owner choice required; migration left untouched

The migration currently on `main` installs a row trigger on `cluster_levels` and keeps the old row
when `new.ticks < old.ticks`. It closes the reported race if footprint snapshots are monotonic at each
price. The database regression passes for that case.

Two counterexamples define the contract the owner still needs to choose:

- An open bar with a level changing from 64 ticks to 8 ticks retains 64. The existing bar trigger
  deliberately guards only rows whose old bar is closed, while the new level trigger guards every
  level update.
- An update with the same 64 ticks but volume falling from 64 to 2 is accepted. The trigger defines
  “richer” only by tick count; it does not preserve every footprint measure.

Options:

| Option | Contract | Benefit | Cost / limitation |
|---|---|---|---|
| **A — keep the current trigger (recommended minimum change)** | Per price, never replace a row with fewer ticks, for open and closed bars | One small migration; no extra parent lookup; closes the reported race under the monotonic-snapshot assumption already stated by `upsertLevels()` | Makes decreasing open-bar corrections impossible; equal-tick lower-volume replacements remain possible |
| **B — guard only levels whose parent bar is closed** | Look up `bars.is_closed` in the trigger and keep the old level only for a closed bar with fewer incoming ticks | Matches the scope of `keep_richer_closed_bar`; open-bar corrections retain their former behavior | Adds an indexed parent lookup for every updated level; equal-tick lower-volume replacements remain possible |
| **C — write each bar and its complete ladder through one transactional database function** | Accept or reject the bar and whole ladder as one snapshot | Strongest bar/ladder atomicity and can define richness over the complete snapshot | Requires an ingest-path refactor, a larger migration/API contract, and broader regression work; disproportionate to this non-blocking P3 finding |

If the owner chooses A, the follow-up should only make the open-bar and tick-only assumptions explicit
in the migration/test documentation. If the owner chooses B, edit the unapplied migration and add a
database assertion that open-bar decreases still land. C should be separate work rather than folded
into this patch.

### F5 — corrected, pending fresh review

The added SETUP paragraph correctly records that a closed bar is not evaluated on re-send, but it
named a failed `strategy_setups` write as an example of dying before evaluation. The actual control
flow evaluates first, catches that carry-write failure, returns the signal rows, and then calls
`persistSignals()`.

Commit `9124b31` now limits the warning to a request that stops after storing the bar and before
evaluation or signal persistence. It also removes the unsafe implication that deleting a bar is the
ordinary recovery procedure; any repair remains owner-approved and case-specific.

### F6 — pass

`supabase/tests/20260908_signal_ingest_audit_gaps_test.sql` exercises PostgreSQL rather than the fake
client. On disposable PostgreSQL 16.13, the focused migration chain and regression passed. Dropping
`strategy_setups_one_row_per_touch` made the test fail because the duplicate insert no longer raised
SQLSTATE `23505`, proving the test does not pass when the production invariant is absent.

## Commands and raw results

```text
npx --yes deno task check
PASS — four Edge Function entrypoints

npx --yes deno task test
PASS — 234 passed, 0 failed

disposable embedded PostgreSQL 16.13
PASS — 0001, 0004, 0040, 085500, 085800, 090000, 150000 applied
PASS — supabase/tests/20260908_signal_ingest_audit_gaps_test.sql
PASS negative control — dropping strategy_setups_one_row_per_touch made the duplicate assertion fail

F4 exploratory rows:
F4_OPEN_BAR_AFTER_DECREASE       { ticks: 64, volume: 64 }
F4_EQUAL_TICKS_LOWER_VOLUME      { ticks: 64, volume: 2 }
```

The disposable database lived under ignored `supabase/.temp/` and was not connected to Supabase.
