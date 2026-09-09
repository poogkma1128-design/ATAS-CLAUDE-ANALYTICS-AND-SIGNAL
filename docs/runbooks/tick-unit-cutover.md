# Tick-unit cutover: stop admission, drain old senders, then migrate

Status: prepared source/runbook, **not executed in production**. Independent review and Thanongsak's
written GO to the exact pushed commit are prerequisites. The implementation session cannot approve itself.
This procedure changes neither authentication credentials nor historical evidence.

## Why mute is insufficient

An old ingest request may already have loaded `telegram_enabled=true` and committed its signal, while the
DB response/Telegram send is still pending. Updating the rule does not change that cached object, and a new
insert trigger cannot reject a row committed before migration. `scripts/test-tick-cutover.ts` reproduces
that interleaving using actual pre-fix ingest source and mocked transport.

## 1. Prepare recovery and close admission

1. Record the reviewed full SHA, current remote function versions/deployment IDs, existing JWT verification
   settings, every ingest caller/region, scheduled outcome-notify caller, rule mute state, and the last
   complete bar per instrument/timeframe. Preserve existing function settings; do not rotate tokens.
2. Owner pauses callers at a bar boundary and preserves source market data for the maintenance interval.
   The existing bridge retries only four times and does not offer a durable outage spool. A 503 is **not**
   a promise of later delivery. Record how raw bars/footprints will be recovered before continuing; verify
   the missing timestamp window after resume. Do not rely on a settings recalculation to reseed history.
3. Mute affected Telegram rules as defense in depth, recording the exact prior values for restoration.
4. Through the existing approved function deployment workflow, replace the **existing `ingest` function**
   with the maintenance bundle below, preserving the recorded gateway/JWT settings. Also replace the
   **existing `outcome-notify` function**, which is another Telegram sender. Do not create an unrelated
   function named `tick-unit-cutover`: that would leave the real routes open.

   | Bundle file | Repository source |
   |---|---|
   | `index.ts` (entrypoint) | `ops/tick-unit-cutover/index.ts` |
   | `handler.ts` | `ops/tick-unit-cutover/handler.ts` |

   This artifact always returns 503, `accepted=false`, marker `TICK_UNIT_CUTOVER_V1`, and `no-store`. It has
   no database/Telegram I/O, request-body reads, secrets, or background task. New invocations cannot persist
   or send through it. Deployment of this artifact is itself owner-gated and is **not** done by the tests.
5. Verify remote deployment completion and both exact returned versions. Probe the actual existing routes
   using the callers' existing authorization from each configured calling region; require HTTP 503 and the
   exact marker/body. Record server UTC timestamps, deployment IDs and responses. 401/404/timeout or an old
   success response is not gate evidence. An uncertain/partial rollout is NO-GO; keep callers paused.

## 2. Drain old work before the migration boundary

Keep both maintenance routes in place. Deploying a replacement is **not** proof that an already-running
old worker has stopped. Do not apply the tick migration yet.

- Verify the hosted platform's maximum worker lifetime at execution time. On 2026-09-09, the published
  [Supabase limits](https://supabase.com/docs/guides/functions/limits) are 150 seconds for Free and 400 seconds
  for paid plans. Use at least **400 seconds plus 60 seconds margin** after the later of verified admission
  closure and the last old-deployment activity. A 150-second HTTP idle timeout does not prove termination.
- Preserve deployment/invocation/shutdown and Telegram completion evidence for the old versions. Confirm
  they are no longer routed and their workers have terminated; account for old pending send attempts and
  their outcomes. Any later old-version activity resets the drain start. No pending/unknown old sends may
  remain when declaring the boundary. Lack of recent log lines alone is not proof; use complete invocation
  records/termination evidence and the verified runtime bound. If evidence is missing, stay in maintenance.
- Recheck both route markers and current versions at the end. Clock disagreement, custom lifetime limits,
  a self-hosted runtime without a verified bound, an unexpected caller/sender or rollout uncertainty means
  NO-GO. Keep the admission gate in place; resolve the uncertainty before migration.

Record these fields from the evidence packet (timestamps are UTC epoch milliseconds, not guessed values):

```json
{
  "admissionGateVerified": false,
  "oldWorkersTerminated": false,
  "pendingOldSends": null,
  "verifiedMaxWorkerLifetimeMs": null,
  "gateVerifiedAtMs": null,
  "lastOldActivityAtMs": null
}
```

`lastOldActivityAtMs=0` is allowed only if the complete artifact proves there was no old activity after
gate verification. Null/unknown fields deliberately fail the checker. Keep the JSON with links to the
deployment/invocation/send artifacts and the owner approval; booleans without those artifacts are not proof.

```text
deno run --allow-read scripts/check-tick-cutover.ts <evidence.json>
```

The checker is read-only/offline: it rejects missing evidence, pending work, invalid clocks/bounds, and a
short drain interval. It cannot inspect the remote system, attest the operator's fields, apply a migration,
or grant owner approval. Tests prove the admission handler and decision logic, not a production drain.

## 3. Cut over under the closed gate

1. Only after both review/owner GO and the verified drain: apply the reviewed
   `20260909120000_guard_signal_tick_units.sql`. No unrelated pending migrations are included.
2. Keep callers paused and rules muted. Deploy the reviewed normal `ingest` artifact and verify its remote
   version/full source SHA; check the guard is installed before any controlled ingestion resumes.
3. Owner authorizes controlled raw-data recovery/observation and checks fresh v2 Entry/SL/TP, tick/cash/R
   parity plus the missing raw-data window. Older evidence is not rewritten or silently reclassified.
   Existing closed bars remain replay-idempotent; maintenance time is recorded, not hidden as signal-free
   market evidence. Verify that legacy/missing/v1 `executionUnits` remain exactly unchanged while a non-unit
   annotation and Telegram delivery bookkeeping can still be written. Newly discovered instruments remain
   unable to signal until explicitly curated/locked.
4. Keep `outcome-notify` in maintenance until its old pending notification backlog has been reviewed and its
   restore is owner-approved; normal ingest also flushes outcomes, so inspect that backlog **before step 3**.
   This patch does not authorize deletion, rescore, or bulk re-announcement of old outcomes. Unknown backlog
   disposition means remain paused. Restore only the reviewed notifier artifact and recorded settings.
5. Only the owner decides when to restore callers and Telegram rule values after forward checks. DLL
   installation/ATAS Phase A collection is a separate owner step; no Gate 0 or profitability approval follows.

## Rollback / failed gate

- Before migration, remain in maintenance if gate/drain proof fails. Do not restore the pre-fix sender just
  to end downtime. Preserve raw source data and all invocation/notification evidence.
- After migration or during verification, pause callers and reinstate the maintenance bundle on both routes;
  drain again. Keep rules muted. Retain the tick guards, instrument metadata and historical evidence.
- Resume only using an independently reviewed unit-compatible application artifact with written owner GO.
  An old executable can retain cached enabled rules; the rollback procedure therefore includes admission
  closure and drain, not only another database mute. Do not restore chart-row tick metadata or drop guards.

## Reproducible local checks

```text
deno task test
deno task check
deno task rev:check
deno check ops/tick-unit-cutover/index.ts scripts/check-tick-cutover.ts scripts/test-tick-cutover.ts
deno run --allow-read --allow-env --allow-run=git scripts/test-tick-cutover.ts
deno run --allow-read --allow-env scripts/test-signal-tick-guard.ts
```

Run the focused SQL on a disposable native PostgreSQL too, including both lock orders and all three
isolation levels. Full staging migration-chain/RLS and the actual maintenance deployment/drain remain
UNVERIFIED until separately executed; no test connects to production.
