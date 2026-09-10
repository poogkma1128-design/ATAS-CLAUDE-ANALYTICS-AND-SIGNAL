# MBO diagnostic logger correction

Owner authorized continued local installation and Phase A diagnostics; executor is Codex.
Independent review of this new correction is pending; the earlier 1.6.2 approval does not cover it.

Live 1.6.2 was installed successfully and started GC probe session
`20bf0b42b552410c9da6b1b38408d97e` at 2026-09-09T13:48:54.1690671Z after owner login.
The initial snapshot read contained 2,870 orders. ATAS `LogInfo` treats its first argument as a format
string: embedded JSON braces produced a log4net StringFormat error envelope instead of clean probe lines.
The JSON remains in the envelope but does not satisfy the intended log extraction contract.

Minimum correction: pass the complete message as the argument to a literal `{0}` format string in
SignalBridgeIndicator. Increment REV to 1.6.3 to distinguish the artifact. No probe counters, timestamps,
subscription logic, market data, ingestion, alerts, server state or trading behavior changes.

Verification before source commit: default indicator build 0 warnings/errors; existing ProbeTests pass
33 assertions. A separate executable using the installed actual Utils.Common and log4net assemblies
reproduces the old format exception and verifies the corrected call emits the exact message, including
nested JSON. Source, project, result and original live lines are retained at
`E:/atas/mbo-logging-regression/`. This is an SDK logger regression check, not a live-feed simulation.

Live evidence limitation: the first interval counted 627 MBO events and four trades as future events.
Latency percentiles are therefore unusable for a capability conclusion. Timestamp origin/kind and local
clock alignment require evidence before changing conversion. Book epoch/completeness, active/quiet windows
and full Phase A acceptance remain UNVERIFIED. No Phase B-E authorization is inferred.

Next: fresh Independent Reviewer reruns raw SDK regression and build, reviews exact source/artifact;
Executor installs only after scoped approval, then verifies clean runtime lines and records DLL hash.
Rollback: import the backed-up reviewed 1.6.2 candidate if 1.6.3 fails; preserve original logs. The 1.6.2
logger defect remains known, so do not use that fallback's latency output as accepted Phase A evidence.
