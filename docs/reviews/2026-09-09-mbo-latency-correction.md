# MBO invalid latency correction and bounded timestamp evidence

Owner requested independent review and completion in one run. Fresh reviewer `mbo_phase_a_review`
found P1: future timestamps were clamped to zero and contributed to apparent 10ms p95. Root is
Executor/Recorder for this correction; reviewer did not author it. No empirical Phase A approval.

REV 1.6.4 changes diagnostic output only. Negative latency increments the existing future counter and
does not enter the histogram. Any future event suppresses that stream's entire window p95, including
mixed positive/future windows. New status distinguishes invalid timing, no events and provisional
positive timing whose timestamp basis remains unverified. Positive-window bucket behavior is preserved.

Each stream also exposes one last raw event timestamp per window, its DateTime.Kind, the existing UTC
interpretation, receive UTC and signed latency. This bounded sample is not retained across empty windows;
cached MBO snapshot timestamps remain excluded. No connector timezone is guessed or changed. Storage
remains constant and diagnostic sample objects are constructed only when emitting a summary.

Tests cover all-future/mixed windows, recovery, exact negative offset, Utc/Local/Unspecified raw kind,
sample reset, cached snapshot exclusion and existing collector lifecycle. Default SDK build and exact
committed artifact identity must be independently checked before the already-authorized local import.

Machine remediation attempted 2026-09-09 21:07:59 Bangkok: Start-Service W32Time failed because Windows
denied access to the service; resync was not executed and service remains stopped. Raw failure is at
`E:/atas/mbo-phase-a-final-20260909/clock-attempt.txt`. Owner was asked to run Start-Service W32Time and
w32tm /resync from administrator PowerShell; response pending. This is an OS access limit, not missing
consent to continue the authorized diagnostics.

Still required for Phase A: independent event-time provenance, synchronized clock, exact contract and
connector settings, justified active/quiet windows >=15 minutes each and deliberate toggle/restart tests.
Clock correction alone cannot establish timestamp semantics. No server deploy, DB, alerts or trading
change is included. Rollback: reimport reviewed 1.6.3 from E:/atas/mbo-build-1.6.3/AtasSignalBridge.dll,
keeping its documented invalid-latency limitation and preserving all original evidence.
