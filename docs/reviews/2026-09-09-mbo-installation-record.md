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
