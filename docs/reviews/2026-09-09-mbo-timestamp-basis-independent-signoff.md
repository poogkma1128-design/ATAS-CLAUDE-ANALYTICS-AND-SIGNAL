# Independent signoff: MBO timestamp-basis correction — 2026-09-09

**APPROVE**, scoped to source commit `f7128ab5b7a1ad2e79fd6e2b619e879918c711fa` and the candidate below.
The correction is diagnostic-only. It does not confirm a connector event-time basis, valid latency, or
Phase A acceptance.

## Roles and scope

- **Executor/Recorder:** parent Codex session, which implemented `f7128ab`.
- **Independent Reviewer:** `/root/timestamp_commit_review`, which did not author the change.
- **Owner:** user. The already-recorded authorization covers local diagnostic DLL import only; it does not
  authorize a signal, Telegram, database, server, or order change.

The reviewer used a detached worktree at `E:/atas/mbo-time-independent-f7128ab` on the exact commit. No
ATAS UI, DLL destination, production service, database, Telegram state, or source file was changed by the
reviewer.

## Finding

The former probe silently converted `DateTimeKind.Unspecified` values to UTC. In live GC MBO logs these
timestamps have no documented timezone/offset contract. `f7128ab` now preserves `rawTime` and `kind`, emits
`timeBasis="unresolved"` with null interpreted UTC and signed latency, counts unresolved MBO/trade events,
and makes p95 unavailable for the affected window. Explicit `Utc` and `Local` values retain their declared
conversion paths; declared future values remain separately visible. The JSON schema is bumped to
`MBO_PROBE_V3`.

The reviewed diff touches only the probe, its actual-SDK tests, indicator revision, and documentation. It
does not modify sender, Supabase, rules, Telegram, network payloads, or order behavior.

## Independent checks

Executed from the detached worktree:

```powershell
git diff --check HEAD^ HEAD
git diff --check
dotnet build .\AtasSignalBridge\AtasSignalBridge.csproj -c Release --nologo
dotnet run --project .\AtasSignalBridge.ProbeTests\AtasSignalBridge.ProbeTests.csproj -c Release
dotnet run --project .\AtasSignalBridge.PropertyTests\AtasSignalBridge.PropertyTests.csproj -c Release -- <candidate DLL>
git status --short
```

Results: both diff checks passed; detached worktree was clean; indicator build had **0 warnings / 0 errors**;
`ProbeTests` passed **52** actual-ATAS-SDK assertions; compiled-indicator `PropertyTests` passed **12**
assertions without sender startup or a live feed.

## Approved candidate

```text
File: E:/atas/mbo-time-independent-f7128ab/atas-indicator/AtasSignalBridge/bin/Release/AtasSignalBridge.dll
SHA256: 77E1B909CAAD102EB1C3D2FFC8AC0040BE25F89897431482D5FF993B1D38C36C
Assembly/FileVersion: 1.6.6.0
ProductVersion: 1.6.6+f7128ab5b7a1ad2e79fd6e2b619e879918c711fa
Build stamp: REV 1.6.6 | commit f7128ab | built 2026-09-09 23:54
```

The build timestamp is embedded, so a later rebuild may have a different hash. Import only the file above
or a newly independently reviewed artifact.

## Remaining runtime gate

The executor may perform the owner-authorized local diagnostic import after a backup, then verify that ATAS
logs `MBO_PROBE_V3`, records unresolved time counters for the current connector, and does not claim a valid
p95. A fresh independent raw-log reparse remains required before treating any event-time source as proven.
