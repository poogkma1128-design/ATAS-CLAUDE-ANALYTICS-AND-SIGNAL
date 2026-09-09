# Independent Phase A evidence review — 2026-09-09

**Verdict: REQUEST CHANGES for the 1.6.3 diagnostic latency contract; full Phase A remains PROVISIONAL / NOT ACCEPTED.** Installed artifact identity and observed JSON logging pass the bounded checks below. This is not signal, book-completeness, latency, or production approval.

## Roles and reviewed identity

- Proposer: original GC/MBO author.
- Executor/Recorder: parent Codex session `/root`, including installation and new packet collection.
- Independent Reviewer: fresh agent `/root/mbo_phase_a_review`, not author or executor of this implementation/run.
- Owner: user; retains clock administration, authentication and production decisions.
- Read-only review checkout: `E:/atas/mbo-review-138b30a`, HEAD `41a7132` when reviewed. Indicator source is `fdce6500ce0b0084f36fba10149e90b673bf28e1`; `git diff fdce650 HEAD -- atas-indicator` was empty.
- Read `AGENTS.md`, Handoff section 00 through the anchored marker and 0AK.6.6, `EXPERIMENT_REVIEW_PROTOCOL.md`, and `SIGNAL PARAMETER.MD` Phase A. No source/runtime/server/database/trading mutation by this reviewer. Only this review report is authored; parent owns Handoff and commit/push.

## Blocking diagnostic finding

**P1 — invalid future timestamps become apparently valid low latency.** In `atas-indicator/AtasSignalBridge/MboProbe.cs:215`, `ObserveLatency` computes receive minus event time. Negative values increment the future counter, are clamped to zero at line 223, and still enter the lowest histogram bucket. `SnapshotJson` publishes `P95Upper` without a validity condition. The frozen live packet reproduces the consequence: every sampled live MBO event/trade is future, yet both p95 fields say `10` ms. A separate future count does not make that number a valid percentile of transport latency.

Minimum correction: make affected-window latency explicitly unavailable/invalid, with a reason; preserve the future count. Do not invent a timestamp timezone or subtract an observed clock offset. Require tests for all-future and mixed positive/future windows and window reset. This is a diagnostic reporting defect; it is not evidence that callbacks are intrinsically fast or that clock skew is their sole cause.

`SignalBridgeIndicator.cs:190-199` stamps callback receipt with `DateTime.UtcNow`. `MboProbe.cs:257-261` preserves UTC, converts Local, and assumes Unspecified means UTC. The payload labels that assumption but exposes no raw event time or actual `DateTime.Kind`. Clock synchronization alone therefore cannot establish the connector event-time basis. Bounded raw-time/Kind/converted-time observations would improve auditability without changing conversion semantics. The review does not prescribe a new event-time interpretation.

## Independently reparsed frozen packet

Raw files were read directly, not executor summaries. SHA256 measured afresh:

| Artifact | SHA256 |
|---|---|
| `E:/atas/mbo-install-1.6.3/probe.log` | `A6C808A7F34972FC8E52B524AF774CEC8468472BBAC04EDD4F0C37110661EEFE` |
| `E:/atas/mbo-install-1.6.3/revision.log` | `87798A712BDCC816CBFF033DE91C19412DD9E647A0DEAA78009913B9012200F3` |
| `E:/atas/mbo-logging-regression/clock-check.txt` | `90E9B348E0A9FBBBA80799EF0B16E7B57611BEA6CE12F9EC9004EDC20AB1D0ED` |
| Installed `C:/Users/Phattharakan/AppData/Roaming/ATAS/Indicators/AtasSignalBridge.dll` | `5D4FB593473855EBB10F5D7C7E0272F1F437A3331A6E2D47F88D031474CAC3DF` |

Installed hash matches the independently approved 1.6.3 candidate. Five raw revision messages report `REV 1.6.3 | commit fdce650 | built 2026-09-09 20:55`. They do not establish five concurrent instances or prove GUI identity independently.

Strict parsing succeeded: 9 raw lines, 7 JSON objects, 2 exact expected subscription-status messages, zero malformed format-error envelopes. All JSON identifies `GC` / `MBO_PROBE_V2`. Initial cache reads contain 2,856 and 2,867 orders in separate collector sessions.

| Collector session | Reason / sequence | Duration ms | Callbacks | New+Change+Delete | Future MBO | Trades | Future trades |
|---|---|---:|---:|---:|---:|---:|---:|
| `31de764dfcc3411bab9e433473305cbe` | interval / 3 | 44883.0729 | 9570 | 9702 | 9702 | 349 | 349 |
| `31de764dfcc3411bab9e433473305cbe` | dispose / 4 | 2033.6257 | 402 | 404 | 404 | 7 | 7 |
| `85f7358d05d1410eaea6b1a81aad99fd` | interval / 3 | 22184.668 | 4101 | 4168 | 4168 | 143 | 143 |

All other JSON rows are startup/cache summaries with zero live events. Each of the three nonempty rows has zero reported order-ID zeros and zero reported clock regressions; these are bounded observations, not complete feed validation. The two interval rows span only 67.0677409 seconds in total and do not satisfy either required 15-minute regime window. Disposal is recorded separately, not passed off as a scheduled interval. Snapshot callbacks are zero; initial cache reads are not reconstruction evidence.

Clock raw output contains three NTP stripchart offsets of +0.7550609, +0.7701242 and +0.7679673 seconds, and service-not-started error `0x80070426`. This supports a local-clock concern, not event-time provenance. New raw `E:/atas/mbo-phase-a-final-20260909/clock-attempt.txt` records that service start was denied and resync was not executed. No successful remediation is proved by these files.

## Acceptance disposition and minimal remaining evidence

| Item | Verdict | Required boundary or remaining evidence |
|---|---|---|
| Reviewed 1.6.3 installed artifact | PASS, scoped | Fresh installed hash matches approved candidate; UI observation remains executor evidence. |
| JSON logger on observed live callbacks | PASS, scoped | Strict raw parsing and nonzero windows; absence of failures outside this packet is not claimed. |
| Bounded probe storage | PASS by source inspection | Fixed arrays/scalars; no growing retained book/event list. Does not constitute measured process memory behavior. |
| Initial cache capability | PASS, observed | Two nonempty reads. Does not prove current-book correctness. |
| Valid latency output contract | REQUEST CHANGES | Prevent future-contaminated windows reporting nominal p95; independent corrected-source tests. |
| Clock and event-time basis | UNVERIFIED | Successful reference check with uncertainty and raw connector time/Kind provenance; do not infer UTC solely from closeness. |
| Exact GCZ6@COMEX / Rithmic / Aggregated Quotes off | UNVERIFIED here | Frozen UI/settings/feed mapping to the same probe session; payload `GC` alone is insufficient. |
| Active and quiet runs | INCOMPLETE | At least 15 minutes each with continuous positive-duration summaries, timestamps and predeclared/session-supported labels. A lower count in a retrospectively selected window is not by itself a justified quiet designation. Preserve subscription/snapshot errors as well as JSON. |
| Disable/re-enable lifecycle | UNVERIFIED live | Deliberate action record and disabled/new-session evidence; no logging/collection while disabled. Existing dispose/reinitialize logs are not this test. |
| Full 1.6.3 process restart | UNVERIFIED live | Process boundary, same reviewed DLL, fresh subscription and initial-cache evidence. Hot reload is insufficient. New correction requires the corresponding installed revision. |
| Receive-age/status quality | PROVISIONAL | Assess new windows for stale receive ages and regressions under established timing; summaries alone do not implement full data-status transitions. |
| Current-book rebuild, epoch/reset boundaries, restart order deduplication | UNVERIFIED by design | Log-only collector retains no book. `bookEpoch=null` explicitly acknowledges missing boundaries. Must remain collector/replay Gate 0 work even if diagnostic collection passes. |

The runbook itself explicitly separates ultimate book/replay acceptance from what this log-only diagnostic can prove. Do not close those requirements by relabeling a collector UUID as an exchange epoch. No empirical edge, feature correctness, signal availability or trading suitability conclusion follows from this review.

## Reproduction commands

From the review checkout in PowerShell, the fresh parse used default strict `System.Text.Json` parsing before field conversion:

```powershell
git log -1 --oneline
git status --short
git diff fdce650 HEAD -- atas-indicator
$raw = Get-Content E:/atas/mbo-install-1.6.3/probe.log
$rows = @(); $status = 0
foreach ($line in $raw) {
    if ($line -notmatch '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3} \[[^\]]+\] INFO  BridgeIndicator: Signal Bridge MBO probe (?<payload>.*)$') { throw 'Unexpected prefix' }
    $payload = $Matches.payload
    if ($payload.StartsWith('{')) {
        $doc = [System.Text.Json.JsonDocument]::Parse([string]$payload)
        $rows += ($doc.RootElement.GetRawText() | ConvertFrom-Json)
        $doc.Dispose()
    } elseif ($payload -eq 'subscription active; collection=True; not a book-completeness verdict') { $status++ }
    else { throw 'Unexpected status' }
}
if (@($raw | Where-Object { $_ -match 'log4net.Error|StringFormat|FormatException' }).Count) { throw 'format errors' }
$rows | ForEach-Object {
    [pscustomobject]@{ Session=$_.sessionId; Sequence=$_.windowSequence; Reason=$_.reason;
      DurationMs=$_.windowDurationMs; Callbacks=$_.callbacks;
      Mbo=($_.updates.created+$_.updates.changed+$_.updates.deleted);
      FutureMbo=$_.futureMboEvents; Trades=$_.trades; FutureTrade=$_.futureTradeEvents }
} | ConvertTo-Json
Get-FileHash E:/atas/mbo-install-1.6.3/probe.log,E:/atas/mbo-install-1.6.3/revision.log,E:/atas/mbo-logging-regression/clock-check.txt,C:/Users/Phattharakan/AppData/Roaming/ATAS/Indicators/AtasSignalBridge.dll -Algorithm SHA256
```

No unrelated server test was rerun; no build is claimed for this current evidence-only review. Next: Codex Executor implements the bounded diagnostic correction and collects a frozen corrected packet after independent code/artifact approval; Owner handles required clock administration; this fresh Independent Reviewer can rerun the corrected source/artifact and packet because it has not authored or executed them. Parent must record these roles and unresolved gates in Handoff 00.1 before claiming handoff complete.
