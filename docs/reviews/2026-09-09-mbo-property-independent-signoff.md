# Independent review: MBO 1.6.5 property/lifecycle correction

**APPROVE**, scoped to exact source `d4d5449da945d19fbed959d96e6daf138ba94079` and the candidate identity below. The missing property-to-lifecycle wiring is corrected and independently regression-tested. Live GUI lifecycle behavior, installation, clock/timestamp provenance and full Phase A remain **UNVERIFIED** by this source review.

## Independence and scope

Reviewer: `/root/mbo_phase_a_review`, not the author or executor of the correction. Parent `/root` is Executor/Recorder; the user is Owner. The reviewer previously identified the missing notification path from source and primary SDK documentation, but did not implement the correction. Reviewed repository `AGENTS.md`, current Handoff section 00 through the anchored `END-OPEN-WORK` marker and 0AK.6.8. Existing experiment role-separation rules remain applicable.

Independent detached checkout: `E:/atas/mbo-property-independent-d4d5449`. Parent checkout: `E:/atas/mbo-review-138b30a`. Reviewer changed no implementation, candidate, settings, ATAS UI, clock, server, database, alert or trading state; only this report is written in the parent checkout. No commit/push by reviewer.

## Finding and correction assessment

In 1.6.4, `EnableMboProbe` and `MboProbeLogIntervalSeconds` were auto-properties. Their values reached the lifecycle only during initialization or recalculation; a normal setter call did not itself update collection. ATAS documentation distinguishes exposing a public property from explicitly requesting recalculation when it changes. [ATAS customizing guide](https://docs.atas.net/en/md_DataFeedsCore_2Docs_2en_20020__CustomizingOurIndicator.html). `OnRecalculate` is the hook before a new calculation, not a guaranteed notification for arbitrary property assignment. [ATAS BaseIndicator reference](https://docs.atas.net/en/classATAS_1_1Indicators_1_1BaseIndicator.html).

Exact runtime diff changes only these two properties to backing-field setters calling `_mboProbeLifecycle?.ApplySettings(...)`, and increments the version to 1.6.5. Existing `OnInitialize`/`OnRecalculate` calls remain. The properties retain public names, types, attributes and defaults (false and 60 seconds). Null-conditional calls are safe before lifecycle construction; lifecycle's existing initialized/disposed checks prevent early subscription and revival after disposal. Existing controller serialization, clamping, timer replacement and subscription reuse are unchanged.

No `RecalculateValues()` call was added, so changing this diagnostic does not request the sender/history recalculation path. The setters assign stored values before applying the complete current settings pair. Repeated assignments intentionally still reach the idempotent lifecycle (also preserving subscription-retry opportunity). The diff contains no timestamp conversion, ingestion, sender, signal or trading changes. No blocking source finding.

## Independent positive and negative controls

Read the new PropertyTests source before executing it. It loads the actual candidate DLL and installed ATAS SDK dependencies, constructs the actual compiled `SignalBridgeIndicator`, replaces its private lifecycle field via reflection with a real lifecycle using fake subscription/timer/log hooks, and sets the real public properties through reflection. It does not start the indicator's sender or use a live feed. Thus it covers the missing compiled setter wiring; it does not claim an end-to-end ATAS property editor test. Initialization of the injected lifecycle is explicit, while unchanged indicator initialization wiring was inspected in source.

Commands freshly executed from the detached checkout unless otherwise noted:

```powershell
# From parent checkout:
git worktree add --detach E:/atas/mbo-property-independent-d4d5449 d4d5449
# From detached checkout:
git diff d4d5449^ d4d5449 -- atas-indicator
dotnet build atas-indicator/AtasSignalBridge/AtasSignalBridge.csproj
dotnet run --project atas-indicator/AtasSignalBridge.ProbeTests/AtasSignalBridge.ProbeTests.csproj
dotnet run --project atas-indicator/AtasSignalBridge.PropertyTests/AtasSignalBridge.PropertyTests.csproj -- E:/atas/mbo-build-1.6.5/AtasSignalBridge.dll
dotnet run --no-build --project atas-indicator/AtasSignalBridge.PropertyTests/AtasSignalBridge.PropertyTests.csproj -- E:/atas/mbo-build-1.6.4/AtasSignalBridge.dll
git diff d4d5449^ d4d5449 --check
git status --short
Get-FileHash E:/atas/mbo-build-1.6.5/AtasSignalBridge.dll,E:/atas/mbo-build-1.6.4/AtasSignalBridge.dll -Algorithm SHA256
$asm = [System.Reflection.Assembly]::LoadFile('E:/atas/mbo-build-1.6.5/AtasSignalBridge.dll')
$asm.GetName().FullName
$asm.GetType('AtasSignalBridge.BuildInfo').GetFields() | ForEach-Object { '{0}={1}' -f $_.Name,$_.GetRawConstantValue() }
```

Fresh independent results:

```text
Build succeeded.
    0 Warning(s)
    0 Error(s)
Time Elapsed 00:00:11.26
PASS: 46 probe/lifecycle assertions (actual ATAS SDK types; no live feed)
PASS: 12 actual indicator property/lifecycle assertions; no live feed or sender startup
```

Both test commands above exit 0 for corrected source/candidate. Property assertions cover defaults, setting values before initialization without starting a subscription, disable/removing the existing timer, repeated false idempotence, re-enable/new collector UUID without duplicate subscription, changing the interval/replacing its timer, repeated current settings, and no revival after disposal. Original probe/lifecycle tests independently retain the previous diagnostic and lifetime checks.

**Negative control passed by failing at the intended regression:** the identical built PropertyTests harness against frozen 1.6.4 exits **1**:

```text
Unhandled exception. System.Exception: actual property disables lifecycle
   at Program.Check(Boolean ok, String label) ... Program.cs:line 17
   at Program.Main(String[] args) ... Program.cs:line 60
```

This is the expected old-candidate failure, not a failure of 1.6.5. The 1.6.4 control SHA256 was freshly measured as `D950FD03D55EEAB93C022A8B847CF581B2702CD7AA1135B7D37AC4D891818482`, matching the previously reviewed artifact. `git diff --check` exits 0 and detached `git status --short` is empty. No unrelated server tests were run or claimed.

## Approved candidate and remaining runtime gate

```text
File: E:/atas/mbo-build-1.6.5/AtasSignalBridge.dll
SHA256: 5F9CEFE21E56431E2E79E939A443053207C6D21D5FAB8F5B22BCF07A0AC4087A
Assembly: AtasSignalBridge, Version=1.6.5.0, Culture=neutral, PublicKeyToken=null
Version=1.6.5
Commit=d4d5449
BuiltAt=2026-09-09 21:40
Summary=REV 1.6.5 | commit d4d5449 | built 2026-09-09 21:40
```

Reviewer independently read the candidate hash/stamp and tested its compiled properties. Independent rebuild has a new build timestamp; byte-for-byte deterministic rebuild parity is not claimed. Approval does not transfer to any different candidate/hash or broader source change.

Next role: parent Executor may perform the already owner-authorized local import, preserving rollback, then record installed destination hash/Revision and actual existing-indicator off/on logs. Required runtime evidence is a disabled summary and cessation of collection, then a new enabled collector session with cache evidence, interval-setting behavior, and a separate full ATAS process restart. GUI checkbox appearance or successful helper tests alone cannot close those items. A fresh frozen packet must be independently reparsed before empirical acceptance. Clock precision/event-time semantics, exact current feed mapping, both required active/quiet windows and book/epoch/replay gaps remain open. Parent owns Handoff 00.1/0AK.6.8 updates, commit and push.
