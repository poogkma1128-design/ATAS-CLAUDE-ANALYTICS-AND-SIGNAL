# MBO build-stamp correction — 2026-09-09

Owner requested “ทำที่ยังค้าเลย Drive C เพิ่มแล้ว”. The prior reviewer is now Executor/Recorder for this
specific correction. The earlier review of 138b30a remains historical evidence; this correction still needs
a fresh independent reviewer. It is not self-approved.

## Change and verification

`AtasSignalBridge.csproj` replaces `git log ... --format=%h` in MSBuild with
`git rev-list -1 --abbrev=7 --abbrev-commit HEAD -- .` and bumps REV 1.6.1 to **1.6.2**.
The new command avoids percent parsing across MSBuild/Windows command execution while still identifying
the most recent commit touching the indicator directory. Existing no-git fallback remains for source exports.
No runtime C# or signal/business logic changed.

- Default `dotnet build ... --no-incremental`: PASS, zero warnings/errors, no property overrides.
- Generated BuildInfo now contains actual Git identity, not no-git.
- Existing ProbeTests using actual ATAS SDK: **33 assertions PASS** this turn.
- Server tests were not rerun for this build-only change. The previous 255-test result applies to 138b30a.
- Disk gate cleared: C free 19,279,126,528 bytes (~17.96 GiB).
- OFT.Platform running; inspected current Roaming ATAS log file is empty. Actual live probe remains UNVERIFIED.
- Final committed build/hash and REV-check result will be appended after committing the source correction.

## Standalone independent-review prompt

ROLE: Independent Reviewer. You must not be the author/executor of this correction.
OBJECTIVE: Verify that the corrected Windows build identifies the exact indicator source and preserves MBO behavior.
PROBLEM: The prior default build succeeded but produced no-git because MSBuild's percent-format Git command failed.
CURRENT CONTEXT: Repository E:/atas/mbo-review-138b30a; PR #114 branch claude/signal-handoff-docs-x26vdd.
Read AGENTS.md, HANDOFF section 00, sections 0AK.6.3–0AK.6.4, this report and SIGNAL PARAMETER.MD Phase A.
IN SCOPE: Review build command/version correction, rerun a default build, verify generated and binary stamp,
compare stamp with the last commit touching the indicator directory, run ProbeTests and REV check.
OUT OF SCOPE: Runtime implementation, thresholds, signals, production migration/deploy, Telegram, auth, secrets,
historical rewrite, DLL installation and trading orders.
CONSTRAINTS: Raw rerun is mandatory; no narrative-only approval or empirical/live-readiness claim.
TASK: Fetch exact pushed head, inspect base ef4f2a2..head, reproduce build and stamp, inspect artifact hash,
verify any remaining installation gates, return APPROVE or REQUEST CHANGES scoped to the correction.
IMPLEMENTATION RULES: Do not fix your own finding; report it for an executor. Preserve existing behavior.
DELIVERABLES: Exact reviewed SHA, commands/results, artifact identity, verdict and limitations in HANDOFF.
ACCEPTANCE CRITERIA: Default Windows build 0 errors, REV 1.6.2, binary About stamp equals the actual indicator
commit, 33 probe assertions pass, no unexpected runtime changes.
DEFINITION OF DONE: Review is committed/pushed with explicit owner GUI/live steps; live Phase A and production
remain separately gated. Owner already authorized continuing MBO work; do not ask again about cleared disk work.

## Owner collection step after review

Use the reviewed artifact; verify About shows REV 1.6.2 and its actual indicator commit. On GCZ6@COMEX 5m,
Rithmic L2 with Aggregated Quotes disabled, enable MBO Probe and Apply. Require immediate MBO_PROBE_V2 enabled
and subscription_active evidence, collect 15-minute active and quiet windows, and check disable/re-enable and
restart as specified in SIGNAL PARAMETER.MD. Preserve raw logs and errors for independent assessment.
Native GUI control is unavailable in this task. No DLL installation or platform restart was performed.
Rollback: leave the current installation intact; do not install the held earlier no-git artifact.
