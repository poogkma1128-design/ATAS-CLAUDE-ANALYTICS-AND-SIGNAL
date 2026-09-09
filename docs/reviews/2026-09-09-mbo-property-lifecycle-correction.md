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
