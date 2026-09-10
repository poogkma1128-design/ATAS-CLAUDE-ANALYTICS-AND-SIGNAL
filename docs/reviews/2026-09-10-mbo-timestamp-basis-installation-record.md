# MBO timestamp-basis correction: local import record — 2026-09-10

## Scope and authorization

This records only the owner-authorized local diagnostic DLL import for the timestamp-basis correction.
It does not authorize or perform a signal, Telegram, database, server, rule, account, credential, or order
change. The correction is diagnostic-only and does not establish valid event-time provenance or latency.

## Reviewed source and imported artifact

- Source commit: `f7128ab5b7a1ad2e79fd6e2b619e879918c711fa`
- Independent review: `docs/reviews/2026-09-09-mbo-timestamp-basis-independent-signoff.md`
- Imported source artifact:
  `E:/atas/mbo-time-independent-f7128ab/atas-indicator/AtasSignalBridge/bin/Release/AtasSignalBridge.dll`
- Expected/imported SHA256:
  `77E1B909CAAD102EB1C3D2FFC8AC0040BE25F89897431482D5FF993B1D38C36C`
- Version: `1.6.6.0`; build stamp: `REV 1.6.6 | commit f7128ab | built 2026-09-09 23:54`
- Destination:
  `C:/Users/Phattharakan/AppData/Roaming/ATAS/Indicators/AtasSignalBridge.dll`

Before replacing the destination, the importer rechecked the approved source-artifact hash. The installed
destination hash then matched the expected SHA256 exactly.

## Rollback preserved

The former REV `1.6.5` DLL is retained at:

```text
E:/atas/mbo-install-1.6.6-20260910-000230/AtasSignalBridge-1.6.5-backup.dll
SHA256: 5F9CEFE21E56431E2E79E939A443053207C6D21D5FAB8F5B22BCF07A0AC4087A
```

The same directory contains the rechecked approved artifact and `manifest.txt`. No backup file was deleted.

## Current runtime state

At `2026-09-10 00:02:30 +07:00`, `app_20260910.log` records that ATAS detected the changed library.
At `00:02:31`, it requested an indicator reload from the main-window status bar. Subsequent packets still
come from the already-loaded REV `1.6.5` instance and are `MBO_PROBE_V2`; this proves neither reload nor
V3 behavior.

The next runtime check must begin only after the changed library is reloaded. It must find a fresh
`MBO_PROBE_V3` packet with:

- `mboTimeSample.timeBasis` and `tradeTimeSample.timeBasis` equal to `unresolved` for the current connector
  when their `kind` is `Unspecified`;
- null `interpretedUtc` and `signedLatencyMs` for those samples;
- nonzero `unresolvedMboTimeEvents` and/or `unresolvedTradeTimeEvents` during live activity;
- `invalid:unresolved_event_time_basis` (or the mixed future/unresolved status) and p95 `unavailable`.

That runtime check demonstrates fail-closed behavior only. A fresh Independent Reviewer must reparse the
raw post-reload log before anyone makes a source-time or latency claim.

## Current-host reconciliation at 08:02 +07:00

The current execution host does not expose the recorded `C:/Users/Phattharakan` profile or the approved
artifact path above. It exposes `C:/Users/Thanongsak`, where the installed indicator is still REV
`1.4.0+d52da914` with SHA256
`A27E49E3578F5A61F4578E4EF9B8B3D9BA94890F272AAB34738F9E865AAA6DD2`. ATAS was not running, and
the current `app_20260910.log` contains no `MBO_PROBE_V3` packet. The earlier import record is retained as
historical evidence for its original host; it must not be treated as the current-host runtime state.

Executor rebuilt exact commit `f7128ab5b7a1ad2e79fd6e2b619e879918c711fa` in detached worktree
`E:/ATAS/.codex-tmp/mbo-f7128ab-current`. Build passed with 0 warnings/errors, ProbeTests passed 52
actual-SDK assertions, and PropertyTests passed 12 compiled-indicator assertions. The resulting REV 1.6.6
candidate has SHA256 `D1F4F3996A9A5093F53A4E17821C12533A28BBE3D6034455EB83896DB6289064` and build stamp
`REV 1.6.6 | commit f7128ab | built 2026-09-10 08:01`.

Because the build timestamp is embedded, this hash differs from the previously approved candidate. The
new artifact therefore requires fresh independent artifact review before import. No destination DLL was
replaced and no runtime, server, database, Telegram, rule, credential, or order state was changed.
