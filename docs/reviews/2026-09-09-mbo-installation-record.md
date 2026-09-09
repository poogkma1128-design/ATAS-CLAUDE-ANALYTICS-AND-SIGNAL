# MBO probe installation authorization and execution record

Owner: Thanongsak. Latest instruction: “ทำเลยอนุญาต”, following the specific proposal to obtain independent
review and install the reviewed REV 1.6.2 MBO probe. Scope: local ATAS DLL import and Phase A diagnostic
collection after review. Exact candidate source indicator commit 5e23e16, repository f12fc3b64c8bbed9220f3cc30b7ad45f90136acf;
DLL SHA256 A3E1B971F442B954D98AFC5D69E3A3B6ED536988C0587BBCCAD36E8C39B1F36C.
No authorization is inferred for server deployment, database migration, MBO trading signals, Telegram
configuration, account/credential changes, or order execution.

Lifecycle: original author remains Proposer; current parent is Executor/Recorder; fresh subagent
mbo_stamp_review is Independent Reviewer of the build-stamp correction. It did not author the patch.
Its raw-rerun report will be recorded separately; no installation before its verdict.

Pre-install backup: E:/atas/mbo-install-1.6.2/backup-manifest.json and backup/ preserve actual installed
AtasSignalBridge assemblies 1.3.0 and 1.5.0 from Roaming/ATAS/Indicators, including original paths and SHA256.
No original file was deleted or replaced. Candidate hash reverified. C free: 19,263,680,512 bytes.

Computer Use is available through node_repl + @oai/sky; earlier reports that GUI control was unavailable
were incomplete tool-discovery results and are superseded. sky.list_windows currently finds only ATAS
“Authorization”, so the owner must sign in manually. Authentication dialogs must not be automated.
The owner has been asked to report when signed in. No credentials were read/entered, and no DLL imported.

Rollback: stop diagnostic collection and retain/restore the backed-up local assembly via the verified ATAS
import workflow if installation fails; do not change server tick metadata/guards/rules. Preserve all logs.
The source build remains a diagnostic capability; live feed epoch, book completeness, Gate 0 and profitability
are not established by installing it.

## Independent gate cleared; execution resumed

Fresh reviewer completed its report before the session's usage-limit interruption. The actual written
report exists at docs/reviews/2026-09-09-mbo-stamp-independent-signoff.md and records APPROVE of the exact
candidate above based on isolated raw reruns. The usage interruption did not revoke that scoped verdict.
Owner logged in and confirmed “เข้าแล้ว”; current ATAS GC main window is reachable. The candidate hash
was reverified again after fetching Git; remote implementation remains f12fc3b. Installation is now proceeding
under the existing explicit local authorization. Production cutover and trading remain outside scope.

## Installation completed (2026-09-09 20:42 Bangkok / 13:42 UTC)

Imported the reviewed DLL through ATAS Indicators > Add custom indicator > Open, using the exact candidate
path. ATAS replaced its existing Roaming/ATAS/Indicators/AtasSignalBridge.dll, resolved the assembly to
v1.6.2.0 and reloaded the existing Signal Bridge instances. No duplicate producer was added and connection
credentials were not changed. Destination SHA256 exactly equals the approved candidate hash above.
UI Revision displayed `REV 1.6.2 | commit 5e23e16 | built 2026-09-09 19:43`. Runtime log confirms four
instances loaded that revision from 20:42:31 through 20:42:39 local time. Installation evidence retained at
E:/atas/mbo-install-1.6.2/installation.log and install-state.json.

On the existing GC chart Signal Bridge, filtered properties to MBO, enabled the checkbox and pressed Apply.
No immediate enabled log was observed before restart. A mistakenly opened Save Template dialog was canceled;
no new template was saved. Then saved the existing GC workspace and gracefully restarted ATAS to initialize
from persisted settings. Owner handled Authorization manually and confirmed login. We are now checking the
post-restart probe; installation success must not be confused with live collection success.

## Reviewed 1.6.3 installed; clean runtime logging verified

Post-login 1.6.2 session began 13:48:54 UTC and read 2,870 initial orders. It exposed an SDK formatted-logger
defect: JSON braces became log4net error envelopes. The executor repaired only the logger call, bumped the
indicator to 1.6.3, and obtained fresh scoped APPROVE from `mbo_logger_review` before import. See
`2026-09-09-mbo-logger-independent-signoff.md` for independent reruns and limitations.

Exact source: `fdce6500ce0b0084f36fba10149e90b673bf28e1`.
Candidate: `E:/atas/mbo-build-1.6.3/AtasSignalBridge.dll`.
SHA256: `5D4FB593473855EBB10F5D7C7E0272F1F437A3331A6E2D47F88D031474CAC3DF`.
At 20:59:49 Bangkok, ATAS loaded 1.6.3 through its Import workflow. Installed destination hash matches;
UI Revision displays `REV 1.6.3 | commit fdce650 | built 2026-09-09 20:55`. Existing configured instances
reloaded; no extra producer was added. The indicators dialog was closed after read-only version inspection.

Frozen raw runtime packet: `E:/atas/mbo-install-1.6.3/probe.log`, SHA256
`A6C808A7F34972FC8E52B524AF774CEC8468472BBAC04EDD4F0C37110661EEFE`.
It contains seven clean JSON summaries, two interval summaries, and zero log4net error envelopes. The first
1.6.3 subscription read 2,856 initial orders. Closing the dialog reinitialized the chart's configured probe;
the subsequent session `85f7358d05d1410eaea6b1a81aad99fd` read 2,867 initial orders. Its first 22.185-second
interval has 4,101 callbacks, 4,168 live MBO updates and 143 trades. This is a short diagnostic smoke check,
not an accepted 15-minute active/quiet run. All 4,168 events and 143 trades in that interval were counted
as future timestamps; reported 10ms percentile values must not be used as valid latency evidence.

Read-only clock check: W32Time is Stopped/Manual; `w32tm /query /status` returns service-not-started
0x80070426. Three NTP stripchart samples against time.windows.com show +0.755, +0.770 and +0.768 seconds
(the local clock trails that reference). Raw output: `E:/atas/mbo-logging-regression/clock-check.txt`.
This supports a clock-skew concern, but does not prove the connector's event timestamp basis. No system
clock/service setting was changed. The UI showed #GCZ6 while probe payload says GC; exact feed/contract
mapping and Aggregated Quotes setting have not been independently verified for the acceptance run.

Current runtime: reviewed 1.6.3 installed and diagnostic probe enabled. Full Phase A remains incomplete:
establish synchronized clocks and event-time provenance, verify exact contract/settings, repeat both
15-minute windows, and separately verify deliberate disable/re-enable plus full 1.6.3 process restart.
Hot reload and chart reinitialization do not replace those lifecycle checks. Book epoch remains unavailable.
Executor must gather the corrected raw packet; a fresh independent empirical reviewer must assess it.
No server deployment, migration, alert setting, account/credential or trading action occurred.

Rollback copy of installed 1.6.2 is at `E:/atas/mbo-install-1.6.3/backup/AtasSignalBridge.dll`, hash
`A3E1B971F442B954D98AFC5D69E3A3B6ED536988C0587BBCCAD36E8C39B1F36C`.
Import that reviewed backup only if rollback is needed; preserve logs and its known malformed-logger caveat.
