# MBO Probe V3: live-capture evidence and post-restart blocker — 2026-09-10

## Scope and evidence source

This is an executor record of the owner-authorized diagnostic MBO probe only. It neither approves the
runtime evidence nor authorizes changes to signals, Telegram, database, server, rules, credentials, or
orders. It supplements the artifact import record at
`docs/reviews/2026-09-10-mbo-timestamp-basis-installation-record.md`.

Raw evidence was read from
`C:/Users/Thanongsak/AppData/Roaming/ATAS/Logs/app_20260910.log`; a fresh Independent Reviewer must parse
that raw log directly and must not accept this summary as the review.

## Pre-restart V3 runtime evidence

After the owner completed manual login, the process that began before 10:29 wrote 34 `MBO_PROBE_V3` packets
for GC (log lines 3117–3159; first at 09:56:54 and last at 10:28:59 Bangkok). It includes `enabled` and
`subscription_active`, then 30 live interval packets with the following summed window counters:

| Event | Count |
|---|---:|
| MBO create | 25,502 |
| MBO change | 25,526 |
| MBO delete | 25,501 |
| Trade | 1,275 |

This demonstrates that REV 1.6.6 V3 received live callbacks and MBO/trade events in that process. It does
not demonstrate full book completeness, a connector timestamp timezone contract, valid latency, Phase A
acceptance, or production readiness.

For all 30 live intervals, both MBO and trade samples have `DateTimeKind.Unspecified`,
`timeBasis:"unresolved"`, null `interpretedUtc`, and null `signedLatencyMs`. Every interval reports
`invalid:unresolved_event_time_basis` with p95 `unavailable`. This is the required fail-closed behavior:
there is no supported numerical latency result or source-time interpretation.

## Post-restart blocker

ATAS restarted at 10:29. At 10:29:46, the serialization binder logged five failures to resolve persisted
`SignalBridgeIndicator` instances because the workspace references
`AtasSignalBridge, Version=1.4.0.0` while the installed DLL is 1.6.6.0. ATAS skipped those instances.

The current process (`OFT.Platform`, started 10:29:21) successfully reconnects Rithmic paper repository,
market data, trading, and PnL. Those connector logins do not prove that V3 is loaded or capturing. Do not
claim current-process V3 capture until a new `MBO_PROBE_V3` packet is observed after recovery.

Read-only verification of the installed destination confirms the independently approved current-host
artifact:

- SHA256: `D1F4F3996A9A5093F53A4E17821C12533A28BBE3D6034455EB83896DB6289064`
- ProductVersion: `1.6.6+f7128ab5b7a1ad2e79fd6e2b619e879918c711fa`
- Preserved old DLL: `E:/ATAS/mbo-install-1.6.6-20260910-0825/AtasSignalBridge-1.4.0-backup.dll`

## Required owner decision (L2)

Choose one path before any runtime/workspace mutation:

1. Commission a reviewed assembly-identity compatibility change for the persisted 1.4.0.0 reference.
2. Authorize re-adding and configuring the reviewed 1.6.6 indicator in the ATAS GUI, with screenshots/log
   evidence and the existing rollback preserved.

The original diagnostic DLL import does not choose either path. Path 1 changes a binary compatibility
contract; path 2 changes saved workspace configuration. Once the authorized recovery produces a fresh V3
packet in the current process, freeze the raw log and give it to a fresh Independent Reviewer for reparse.
