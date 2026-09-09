# MBO property-to-lifecycle correction

Owner completed administrator Start-Service W32Time and w32tm /resync successfully. Read-only verification
shows W32Time Running, last successful sync 21:31:52 Bangkok, source time.windows.com. Measured offset
still approximately +0.75 to +0.80 seconds at 21:32-21:39; status is Hold with phase offset 0.765 seconds.
The administrator access blocker is resolved, but precise clock convergence is not established.
Raw clock evidence is retained under `E:/atas/mbo-post-sync-20260909/`.

During the requested continued independent review, the actual existing GC bridge settings showed MBO
unchecked after the earlier Apply, while the same collector session still emitted intervals. The owner-
authorized executor re-enabled the checkbox, verified its checked state and pressed Apply before this
correction. These UI observations do not establish successful lifecycle transitions.

Independent reviewer `mbo_phase_a_review` traced the missing path: auto-properties only update values;
the lifecycle receives them in OnInitialize/OnRecalculate. The [ATAS customization guide](https://docs.atas.net/en/md_DataFeedsCore_2Docs_2en_20020__CustomizingOurIndicator.html)
requires explicit recalculation when a setting changes; it is not an automatic consequence of a public
property edit. Thus the previous direct helper tests could pass while actual property wiring failed.

REV 1.6.5 replaces only the two diagnostic auto-properties with backing fields and setters that call
the existing lifecycle ApplySettings. Defaults remain false/60. A null guard covers constructor ordering;
existing initialized/disposed gates prevent early or late activity. OnRecalculate remains an idempotent
fallback. No full RecalculateValues call is introduced, avoiding unrelated historical sender replay.
No ingestion, signal, market-data conversion, logger, timer implementation or production server change.

A new standalone PropertyTests executable loads the actual compiled indicator and ATAS SDK. It constructs
the real indicator without calling OnInitialize/starting HttpSender, injects a lifecycle with fake SDK
subscribe/timer hooks, then invokes actual public property setters. It covers pre-initialization writes,
defaults, disable/re-enable/new session, idempotence, interval replacement and disposal. The reviewed
1.6.4 DLL fails `actual property disables lifecycle`; the corrected build passes 12 assertions. Existing
46 probe/lifecycle tests also remain required. This is stronger wiring evidence than directly testing
the lifecycle helper, but GUI behavior and full restart remain separate live checks.

Parent is Executor/Recorder; fresh reviewer retains independent correction/artifact review before local
import. No source author self-approval. Rollback is the backed-up reviewed 1.6.4 DLL, retaining its known
settings/lifecycle limitation. After import, explicitly verify disabled/enabled/session/cache evidence,
interval changes and process restart, then gather synchronized, independently classified active/quiet
windows. Full Phase A and book reset/replay remain unapproved until their evidence is complete.

## Local installation and GUI evidence (22:02–22:06 Bangkok)

Independent source/artifact approval is recorded separately in
`docs/reviews/2026-09-09-mbo-property-independent-signoff.md`. Only after that approval, the executor
backed up the installed 1.6.4 DLL at `E:/atas/mbo-install-1.6.5/backup/` and used ATAS's Import UI for
the approved candidate. The installed destination SHA256 is
`5F9CEFE21E56431E2E79E939A443053207C6D21D5FAB8F5B22BCF07A0AC4087A`, matching the reviewed artifact.

Runtime log evidence records revision 1.6.5, old-session dispose, then enabled session
`c3649470f6c04167a0df3096dcade51f` with `initialSnapshotReads=1` and 2,329 initial orders. In the
actual existing indicator's property editor, clearing **Enable MBO probe** and applying emitted
`reason:"disabled"` on that same session. Setting it back and applying emitted a different enabled
session `84f653feb41f4ace947d30581c1854d7`, with `initialSnapshotReads=1` and 3,022 initial orders.
This is live evidence for the corrected setting-to-lifecycle transition and cache read, not a claim of
book completeness or latency validity.

ATAS then exited at 22:06 after a generic WPF dispatcher exception while the property editor was being
used. The inspected log contains no Signal Bridge exception, so its relationship to the DLL is
**UNVERIFIED**. Relaunch reaches Authorization and requires owner login; no automated login is allowed.
The required fresh-process lifecycle verification, interval-change test, independent raw reparse,
clock/event-time validation, and active/quiet windows remain open. The Windows clock remains about
0.77–0.80 seconds offset from time.windows.com, therefore all latency percentile conclusions remain
unaccepted.

## Interval-setting live check and restored operator state (22:50–22:53 Bangkok)

After owner login, the executor used the existing Signal Bridge property's UI to change **Probe log
interval (seconds)** from 60 to 15 and applied it. The running session
`c150d8aa3b044b9f9f903c73a1fa82e6` emitted `reason:"interval_changed"` at 22:50:09, followed by a
15,001 ms interval with live callbacks. The executor then restored 60 seconds and applied it. A second
`interval_changed` emitted at 22:51:44; one previously scheduled short tick occurred at 22:51:59, and
the next full interval at 22:52:59 was 60,003 ms with live callbacks. ATAS process responsiveness was
checked after the operation.

The operator state is restored to **Enable MBO probe=true** and **Probe log interval=60**. This validates
actual timer replacement through the ATAS UI without changing any signal behavior, service, database,
Telegram setting, order, or trading state. The owner accepts the collected timing only for
non-authoritative diagnostic/signal observation. The raw records remain `invalid:future_events`, their
event time is `Unspecified`, and p95 is unavailable; this test makes no latency or book-completeness
claim. Independent raw reparse and all Phase A empirical gates remain open.
