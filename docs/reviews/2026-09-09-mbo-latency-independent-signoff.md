# Independent review: MBO 1.6.4 latency diagnostic correction

**APPROVE**, limited to the exact diagnostic source and local-import candidate below. This closes the 1.6.3 future-event percentile reporting finding in `2026-09-09-mbo-phase-a-final-review.md`. It does not approve event timestamp provenance, measured latency, Phase A completion, book correctness, signals, or production changes.

Reviewer: fresh independent agent `/root/mbo_phase_a_review`, not correction author, builder of the supplied candidate, installation executor, or live collector. Parent `/root` is Executor/Recorder. Owner retains authentication, clock administration and production decisions. The reviewer previously identified the defect and requested its bounded correction; it did not implement the change or execute the empirical run. Independent review took place in detached checkout `E:/atas/mbo-time-independent-d92607d` at exact source `d92607df0538db46403459d96d97e46d4f30641e`.

## Source assessment

Inspected the exact parent-to-commit diff and traced the existing callback-to-probe-to-JSON path. Runtime changes affect only `MboProbe.cs` and project version 1.6.4; tests/documentation are the remaining changes. No ingestion, signal, alert, trading, subscription or lifecycle behavior changes are present.

- Negative receive-minus-event observations increment the corresponding future counter and return without entering a histogram bucket.
- Any future observation in a window suppresses that stream's whole-window p95 as `unavailable`, including mixed valid/future windows. Status is `invalid:future_events`.
- A subsequent nonempty positive window reports the existing histogram percentile as `provisional:timestamp_basis_unverified`. An empty successor reports `unavailable:no_live_events`; invalidity does not persist across windows.
- Each stream retains only its last raw `DateTime` in the current window. The emitted raw time, actual Kind, interpreted UTC, receipt time and signed difference refer to that same last observation. Snapshot-only MBO callbacks do not populate these live samples; samples reset when window counters drain. Storage remains bounded.
- Existing UTC/Local/Unspecified conversion semantics are unchanged. Seeing `Unspecified` and an approximately plausible difference would not prove the UTC assumption. The positive-window status correctly retains this limitation.

No blocking finding for this bounded correction. Runtime data-status, actual feed epochs/rebuild, timing provenance and empirical acceptance remain separate requirements.

## Independent verification

These commands were executed afresh, after reading the external SDK logging harness, not copied from executor output:

```powershell
git worktree add --detach E:/atas/mbo-time-independent-d92607d d92607d
# Remaining git/build commands from that detached checkout:
git diff d92607d^ d92607d -- atas-indicator
dotnet build atas-indicator/AtasSignalBridge/AtasSignalBridge.csproj
dotnet run --project atas-indicator/AtasSignalBridge.ProbeTests/AtasSignalBridge.ProbeTests.csproj
dotnet run --project E:/atas/mbo-logging-regression/Logging.csproj
git diff d92607d^ d92607d --check
git status --short
Get-FileHash E:/atas/mbo-build-1.6.4/AtasSignalBridge.dll -Algorithm SHA256
$asm = [System.Reflection.Assembly]::LoadFile('E:/atas/mbo-build-1.6.4/AtasSignalBridge.dll')
$asm.GetName().FullName
$asm.GetType('AtasSignalBridge.BuildInfo').GetFields() | ForEach-Object { '{0}={1}' -f $_.Name,$_.GetRawConstantValue() }
```

Observed independent results:

```text
Build succeeded.
    0 Warning(s)
    0 Error(s)
Time Elapsed 00:00:12.94
PASS: 46 probe/lifecycle assertions (actual ATAS SDK types; no live feed)
PASS: actual Utils.Common logger reproduces JSON format error; corrected call emits exact JSON unchanged
git diff --check: exit 0
git status --short: empty
```

The logger regression intentionally invokes the old overload, observes its malformed `log4net.Error`/`FormatException` envelope, then verifies the corrected `LogInfo("{0}", payload)` overload emits nested JSON unchanged. The expected old-path error is not a failure of the correction. Meaningful new assertions cover all-future and mixed windows for both MBO/trades, future counts/statuses, signed raw samples, actual UTC/Local/Unspecified Kind and conversion visibility, sample reset, recovery, and exclusion of cached snapshot timestamps. Existing lifecycle assertions still pass. These tests use actual installed SDK types but no live connector.

Rechecked harness/SDK hashes:

| File | SHA256 |
|---|---|
| `E:/atas/mbo-logging-regression/Program.cs` | `067B05321AA3094624BA962807DC1C54171356AB66E43C47F7C70804AC42AAAB` |
| `E:/atas/mbo-logging-regression/Logging.csproj` | `C96EA8AF707D7261DE70DA377AD3066B292AD4E70AF47AA65DB199ABE9272EC4` |
| Installed SDK `Utils.Common.dll` | `126E147BD54A951D99852EAA42C6859AD59EEE044630FF090AC8FCC16F58D1EC` |
| Installed SDK `log4net.dll` | `12A03C155C906547D242D6D05DD80728C2DC643D7C43292709C03F9CBAD5BF5E` |

## Approved candidate and next role

```text
File: E:/atas/mbo-build-1.6.4/AtasSignalBridge.dll
SHA256: D950FD03D55EEAB93C022A8B847CF581B2702CD7AA1135B7D37AC4D891818482
Assembly: AtasSignalBridge, Version=1.6.4.0, Culture=neutral, PublicKeyToken=null
Version=1.6.4
Commit=d92607d
BuiltAt=2026-09-09 21:13
Summary=REV 1.6.4 | commit d92607d | built 2026-09-09 21:13
```

Artifact hash/stamp were read from the supplied candidate independently. The independent build uses its own timestamp; byte-for-byte reproducible rebuild parity is not claimed. Approval applies to this candidate identity and source scope only.

Parent Executor may proceed with the already authorized local import and freeze destination hash/revision/live JSON evidence, preserving rollback. The new fields must be checked in raw runtime output; build tests do not prove live timestamp validity. Clock synchronization should be independently checked, followed by a fresh collector session to avoid spanning a clock adjustment in one measurement window. Exact contract/settings, both 15-minute regimes and deliberate toggle/full process restart remain required. Gate 0 book/replay gaps remain explicit.

The reviewer performed no GUI, clock, installation, server, database or trading action and made no source changes. Parent must update Handoff 00.1/0AK.6.6 with this scoped approval, subsequent installation outcome, and the Independent Reviewer role for the frozen live packet; commit/push documentation through its authorized workflow. This report is not self-approval of that future execution.

## Independent post-install raw verification — 2026-09-09

**PASS for exact installed 1.6.4 identity and corrected diagnostic output on the frozen live packet. Full Phase A remains PROVISIONAL / NOT ACCEPTED.** This closes the engineering finding and its observed live regression only. Parent performed import/UI/collection; reviewer rehashed the installed DLL and reparsed the frozen raw packet read-only. No new build was necessary because the source/candidate above is unchanged.

Fresh hashes:

| Artifact | SHA256 |
|---|---|
| Installed `C:/Users/Phattharakan/AppData/Roaming/ATAS/Indicators/AtasSignalBridge.dll` | `D950FD03D55EEAB93C022A8B847CF581B2702CD7AA1135B7D37AC4D891818482` |
| `E:/atas/mbo-install-1.6.4/probe.log` | `8E3C21063B5EA5A5E0723C55C047C6738B03B874AE8D8DCBAE39E26D8CAEE617` |
| Same directory `revision.log` | `9991B559FAB9BC579D8E9C4A16743FD99BF9F2D5BCF3CFA35C728723AB87BDF7` |
| Same directory `install-state.json` | `F6383939C4A23EE661185DB444CF04812A67B721FF1D516109F189A20683EE2B` |
| `E:/atas/mbo-phase-a-final-20260909/connector-settings-redacted.json` | `90601E3090136AF8A9664B55FC4B903622CEA107109F54338B3D97A0B6CB5178` |
| Same directory `chart-contract-redacted.json` | `3E3FA2F5E2A7769CF5823447F261E191CB8178EB7B555327CBA07B084C3DD506` |
| Same directory `contract-subscriptions.log` | `41DCBBAC2CE5B2369F0122F814AED00D14CCC3E116DB9C687FB1FC6C2C02E2C5` |

Installed hash equals the reviewed candidate. Four raw revision lines at local 21:17:08.571 through 21:17:16.689 identify `REV 1.6.4 | commit d92607d | built 2026-09-09 21:13`; they do not prove instance count. `install-state.json` records executor UI confirmation/import time and packet freeze at `2026-09-09T21:24:16.7348494+07:00`. Reviewer did not independently inspect UI, so that remains attributed executor evidence.

All four raw probe lines strictly parsed as JSON with the expected log prefix, `MBO_PROBE_V2`, `symbol=GC`, and `counterScope=window`. There is one collector session, `2c0834474f9b458a88dad3df8dd72ad6`: enabled sequence 1, subscription_active sequence 2 with one cache read/2,827 orders, followed by these intervals:

| Sequence | Duration ms | Callbacks | New+Change+Delete | Future MBO | Trades | Future trades | Last signed MBO / trade ms |
|---|---:|---:|---:|---:|---:|---:|---|
| 3 | 331159.5671 | 43580 | 43932 | 42605 | 861 | 840 | -645.1589 / -638.4204 |
| 4 | 59998.262 | 6785 | 6805 | 6579 | 92 | 88 | -646.7726 / -614.2149 |

Both streams in both intervals correctly report `invalid:future_events` and `unavailable` p95. All four last-event samples have `kind=Unspecified`; raw timestamps have no timezone suffix, while interpreted timestamps have `Z`. Independently recomputed signed differences and all four window durations agree with the emitted fields within 0.0001 ms. This proves the correction reports the observed invalid timing honestly; it does not prove the connector's true event timezone, a transport latency, or that clock skew is the sole cause. The samples are last-event observations, not offset distributions.

The two intervals total **391.1578291 seconds**, below a single 15-minute runbook window. Sequence 3 lasted 331 seconds while the executor reports interacting with a modal UI; this packet does not prove regular 60-second scheduling or the cause of that long window. Sequence 4 is approximately 60 seconds. Neither is labeled active/quiet by the reviewer. No `disabled` summary, second session, or full process-restart boundary exists. The attempted checkbox operation reported by the executor is not accepted lifecycle evidence.

### Connector evidence boundary

The supplied allowlisted settings JSON contains a `Phidias Propfirm Rithmic` configuration of type `OFT.Rithmic.PropRithmicConnectorSettings` with `aggregatedQuotes=false`, `marketDataEnabled=true` and `allowMarketData=true`. A separate ordinary Rithmic entry also has aggregated quotes false. `serverTimeZone=Central Standard Time` is a connector setting; it is not documentation that `MarketByOrder.Time` or `MarketDataArg.Time` uses that timezone. No conversion change follows from it.

Saved chart JSON identifies `GC 5m Chart`, contract/AtasId `5118`, `isContinuous=false`, `timeFrame=m5`, and a Rithmic connector name. Historical raw subscription lines on that connector name record `GCZ6@COMEX` for `MarketByOrder` and GCZ6 Prints/Best/Quotes/MarketByOrder/Summary, most recently at local 20:48:53. These corroborate exact-contract MBO access and saved unaggregated Rithmic configuration. However, the chart JSON does not map numeric AtasId 5118 to a symbol, the newest subscription precedes the 21:17 1.6.4 session, and probe JSON lacks exact contract/connector identity. Current run linkage is therefore not independently complete from these artifacts alone. The parent's live UI connection observation remains executor evidence. Do not replace this boundary with the stronger claim that the reviewer verified all live feed settings directly.

### Reproduction and final disposition

Fresh PowerShell checks used `Get-FileHash -Algorithm SHA256` on each path in the table, `Get-Content` on the raw logs/allowlisted JSON, and this strict parsing/invariant logic (field conversion preserves date strings):

```powershell
$raw = Get-Content E:/atas/mbo-install-1.6.4/probe.log
$rows = @()
foreach ($line in $raw) {
    if ($line -notmatch '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3} \[[^\]]+\] INFO  BridgeIndicator: Signal Bridge MBO probe (?<payload>\{.*)$') { throw 'Unexpected prefix' }
    $doc = [System.Text.Json.JsonDocument]::Parse([string]$Matches.payload)
    $rows += ($doc.RootElement.GetRawText() | ConvertFrom-Json -DateKind String)
    $doc.Dispose()
}
if ($rows.Count -ne 4) { throw 'Unexpected row count' }
if (@($rows | Where-Object reason -eq interval).Count -ne 2) { throw 'Unexpected interval count' }
foreach ($r in $rows) {
    if ($r.version -ne 'MBO_PROBE_V2' -or $r.counterScope -ne 'window' -or $r.symbol -ne 'GC') { throw 'Unexpected schema' }
    if ($r.futureMboEvents -gt 0 -and ($r.mboLatencyP95UpperMs -ne 'unavailable' -or $r.mboLatencyStatus -ne 'invalid:future_events')) { throw 'False MBO percentile' }
    if ($r.futureTradeEvents -gt 0 -and ($r.tradeLatencyP95UpperMs -ne 'unavailable' -or $r.tradeLatencyStatus -ne 'invalid:future_events')) { throw 'False trade percentile' }
    foreach ($key in @('mboTimeSample','tradeTimeSample')) {
        $sample = $r.$key
        if ($null -ne $sample) {
            $delta = ([datetimeoffset]::Parse($sample.receivedAtUtc)-[datetimeoffset]::Parse($sample.interpretedUtc)).TotalMilliseconds
            if ([Math]::Abs($delta-$sample.signedLatencyMs) -gt 0.0001) { throw 'Wrong signed delta' }
            if ($sample.kind -ne 'Unspecified') { throw 'Unexpected sample kind' }
        }
    }
    $duration = ([datetimeoffset]::Parse($r.observedAtUtc)-[datetimeoffset]::Parse($r.windowStartUtc)).TotalMilliseconds
    if ([Math]::Abs($duration-$r.windowDurationMs) -gt 0.0001) { throw 'Wrong window duration' }
}
```

Execution exited 0: strict JSON, future percentile/status invariants, signed sample deltas and durations passed. Four exact-prefixed JSON lines also establish there is no malformed logger envelope in this frozen packet; failures outside the packet are not excluded. Raw artifacts were not altered.

**Closed:** reviewed correction, build/tests, supplied/installed identity, clean observed JSON, future-contaminated p95 suppression and raw timestamp visibility. **Still open:** successful clock/reference verification and timestamp provenance; complete current-run contract/settings linkage; 15-minute active plus 15-minute quiet collection; successful deliberate off/on and full process restart; stable scheduling/status evidence; book rebuild/epoch/reset/replay acceptance (unsupported by the log-only probe). Owner must resolve the administrator clock action; Executor then collects the complete frozen evidence and an Independent Reviewer evaluates it. Parent must carry these unresolved items and role separation in Handoff. The diagnostic engineering fix is complete; full Phase A is not.
