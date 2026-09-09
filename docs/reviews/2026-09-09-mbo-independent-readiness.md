# Independent MBO readiness review — 2026-09-09

Reviewed source: `138b30a14842370c36a5d3853ddc1f976c1bab31` (PR #114).
Base: `5ca966557c62b0de18674f6d31524bc4b5512ca0`.
Reviewer: fresh Codex session, not author/proposer/executor of this patch.
Owner requested “ทำเลย อนมุติ” for the next MBO work. This authorizes progressing the MBO readiness work; it is not recorded as an override of missing live evidence or authorization to enable MBO trading signals.

## Result

Engineering checks below pass. **HOLD installation / production; Phase A remains incomplete.**
No new blocker was found in the reviewed probe counters/lifecycle or tick-unit correction. This is a bounded engineering review, not full staging/RLS approval, feed-capability approval, or a production GO.

### Installation blocker: build provenance

The default Windows build completes with zero warnings/errors but generates `REV 1.6.1 | commit no-git`.
MSBuild `GenerateBuildInfo` runs `git ... log -1 --abbrev=7 --format=%h -- .` and reports:

```text
fatal: invalid --pretty format: h
_GitExitCode=128
```

Direct PowerShell `git log -1 --format=%h -- atas-indicator/AtasSignalBridge` returns `b8e607e`.
This is in the existing build target (not introduced by PR #114), but blocks the runbook's About/commit identity check. An implementation session should repair Windows command escaping with the minimum change and rebuild; a different reviewer must verify that correction. This review did not change implementation or manually relabel an unverified DLL.

## Fresh checks

- Deno 2.9.6: **255 passed / 0 failed**.
- Four normal entrypoints and maintenance/checker/cutover source typecheck: PASS.
- REV checker: indicator 1.6.1, web 1.3.2 PASS.
- Actual ATAS SDK C# probe/lifecycle tests: **33 assertions PASS**.
- Indicator no-incremental build: 0 warnings, 0 errors; stamp limitation above.
- PGlite 0.5.8 / PostgreSQL 18.3: checked-in tick guard, original scorer/setup_stats and legacy missing/v1 immutability replay PASS.
- Disposable native PostgreSQL **16.13**: same focused SQL/scorer checks and legacy missing/v1 annotation/immutability checks PASS. This is independently rerun on a different version, not a repetition of the executor's PostgreSQL 18.4 claim.
- Native concurrency: blocking observed in both orders at READ COMMITTED, REPEATABLE READ and SERIALIZABLE. Signal-first held the row share lock; subsequent tick mutation failed 23514. Metadata-first performed a permitted tick_value update: insert completed at READ COMMITTED and failed 40001 at the two stronger isolation levels. Six cases, no observed deadlock. This does not claim all production interleavings.
- Actual pre-fix ingest with mocked delayed DB/Telegram: mute alone still sends; admission/drain decision waits; zero sends after simulated cutover PASS. No network calls.
- New maintenance/checker script lint PASS. Format check reports five CRLF-only differences under local `core.autocrlf=true`; no claim of a passing format check.
- `git diff --check origin/main...HEAD`: PASS.

Raw local artifacts and reproducible native runner: `E:/atas/mbo-review-evidence-138b30a/`.
DLL held for review, **not installation**: `build-for-review/AtasSignalBridge.dll`.
SHA256: `D620B25C28F2A5DEF17D0CC336B9B6EB50E42EF34AF9950A0D7D99778D7EB1D7`.
Native runner, native output, Deno test log and build-stamp diagnostic are retained outside Git.

## Remaining work and owners

1. **Implementation session:** fix the pre-existing Windows build stamp; preserve all trading/streaming behavior. Then independent reviewer verifies source identity in generated BuildInfo and DLL.
2. **Owner:** provide at least 10 GB free on the ATAS data volume before collection. This review measured C free space at 2,753,523,712 bytes (about 2.56 GiB); ATAS data folders are on C. No files were deleted/moved to free space.
3. **Owner:** start ATAS and complete installation/GUI About check, Rithmic Level 2/aggregated-quotes setup, immediate enabled/subscription_active logs, 15-minute active and quiet samples, disable/re-enable and restart checks. No ATAS/OFT process was found in the process snapshot. GUI control is unavailable in this task.
4. **Independent Reviewer:** assess raw Phase A logs, including error 13, initial cache, stale/latency fields. Feed epochs, completeness, deterministic replay and full Gate 0 remain UNVERIFIED. Phase B–E are not started.
5. **Production operator after separate gates:** full staging migration-chain/RLS, actual admission/drain, raw-data recovery and exact-commit owner GO remain pending. No migration/deploy/Telegram/rule/auth changes or trading orders were performed.

No runtime changes; rollback is unnecessary for this review. Do not install the held no-git artifact. Existing main checkout remains on 5ca9665. This review branch contains documentation only beyond the reviewed PR head.
