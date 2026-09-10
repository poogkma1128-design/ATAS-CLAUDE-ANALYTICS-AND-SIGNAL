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

## Exact artifact and installation

Independent correction review APPROVE: `2026-09-09-mbo-latency-independent-signoff.md`.
Source `d92607df0538db46403459d96d97e46d4f30641e`; default build 0 warnings/errors and 46 assertions
passed independently. Candidate `E:/atas/mbo-build-1.6.4/AtasSignalBridge.dll`, SHA256
`D950FD03D55EEAB93C022A8B847CF581B2702CD7AA1135B7D37AC4D891818482`.
Imported through ATAS at 21:17:08 Bangkok under the existing local authorization. Installed hash matches;
UI Revision `REV 1.6.4 | commit d92607d | built 2026-09-09 21:13` also matches. Backup of 1.6.3 retained in
`E:/atas/mbo-install-1.6.4/backup/AtasSignalBridge.dll`, hash
`5D4FB593473855EBB10F5D7C7E0272F1F437A3331A6E2D47F88D031474CAC3DF`.

Frozen runtime packet `E:/atas/mbo-install-1.6.4/probe.log` at 21:24:16 Bangkok contains four JSON rows;
SHA256 `8E3C21063B5EA5A5E0723C55C047C6738B03B874AE8D8DCBAE39E26D8CAEE617`.
Initial cache read 2,827 orders. Session `2c0834474f9b458a88dad3df8dd72ad6` emits raw Kind=Unspecified
and signed receive-minus-event samples about -645ms MBO/-638ms trade in its first interval. The new
invalid status and unavailable p95 are present in real logs. This exposes the unknown time basis;
it does not resolve it. A 331-second first interval occurred while operating the Indicators modal;
its cause is unverified, and 60-second timer compliance is not claimed.

Lifecycle attempt: unchecked the existing GC bridge MBO setting and pressed Apply at about 21:19 Bangkok.
No disabled summary or fresh session appeared; subsequent logs still collect on the same session. Do not
mark off/on lifecycle PASS from those UI actions. Later accessibility recovery timed out and the dialog
closed; the main ATAS chart remains open. No extra Signal Bridge was added. Final collection state is
evidenced by continuing session logs; persistence of the attempted checkbox change is UNVERIFIED.

Additional read-only feed evidence is retained under `E:/atas/mbo-phase-a-final-20260909/`:
allowlisted connector settings show Phidias Propfirm Rithmic AggregatedQuotes=false; live Connections UI
shows that connector connected. Saved GC 5m chart refers to contract ID 5118, Rithmic connector, M5 and
IsContinious=false. Exact GCZ6@COMEX MBO subscription lines were extracted from the same ATAS process log.
These support feed mapping; they are not evidence for a book reset delimiter or timestamp timezone.

Windows Time remains Stopped/Manual at packet freeze. The owner administrator-sync response is still
pending. No accepted synchronized active/quiet pair or full 1.6.4 process restart has been collected.
Next executor must verify settings application/lifecycle, perform a fresh session after successful clock
sync, and collect the specified regimes. Independent Reviewer then checks the raw packet; full Phase A
must remain HOLD. No production server, database, alert setting or trade was changed.

Primary-reference cross-check: the ATAS [MarketByOrder API documentation](https://docs.atas.net/en/classATAS_1_1DataFeedsCore_1_1MarketByOrder.html)
and [data processing guide](https://docs.atas.net/en/md_DataFeedsCore_2Docs_2en_20025__ReceivingProcessingData.html)
describe Time as the entry's date/time, but do not establish UTC semantics for this connector's
Unspecified values. Those pages therefore do not close the observed timestamp-provenance gap.
