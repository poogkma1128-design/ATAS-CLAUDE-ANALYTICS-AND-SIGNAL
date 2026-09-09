# Independent signoff: Windows MBO build stamp — 2026-09-09

## Verdict and exact scope

**APPROVE** the build-stamp correction and the identified installation candidate. No blocking finding was found in this correction. This reviewer did not author or execute the correction and independently created a clean detached worktree, rebuilt the source, reran tests, and read the candidate binary. No source fixes, installation, restart, production mutation, or live probe was performed by this reviewer.

- Reviewed repository head: `f12fc3b64c8bbed9220f3cc30b7ad45f90136acf`.
- Compared base: `ef4f2a2`; implementation commit: `5e23e168b9f96a61c8ed72dc01e91103fd579d4f`.
- Candidate: `E:/atas/mbo-build-1.6.2-5e23e16/AtasSignalBridge.dll`.
- Independently measured candidate SHA256: `A3E1B971F442B954D98AFC5D69E3A3B6ED536988C0587BBCCAD36E8C39B1F36C` (matches the submitted value).
- Independent worktree: `E:/atas/mbo-stamp-independent-f12fc3b`.
- Raw rerun evidence: `E:/atas/mbo-stamp-independent-evidence-f12fc3b/` (`build.log`, `probes.log`, `rev-check.log`, generated `BuildInfo.g.cs`, `artifact-identity.json`).

The owner has authorized progressing to installation after review, as conveyed in the task. This approval clears the correction/artifact review gate only. The installing executor must verify the exact hash at the destination and the loaded About/Revision. Live Phase A and production cutover remain separate gates.

## Inspection

Read repository `AGENTS.md`, current Handoff section 00 through its anchored closing marker, sections 0AK.6.3–0AK.6.4, the correction report, and the Phase A implementation/operator section in `SIGNAL PARAMETER.MD`.

`git diff ef4f2a2..f12fc3b` contains four files: the indicator project file and three documentation files. The project change is limited to REV `1.6.1` → `1.6.2`, replacing the percent-format Git command with `git rev-list -1 --abbrev=7 --abbrev-commit HEAD -- .`, and its explanatory comment. The no-git fallback and directory scope remain present. No runtime C#, probe lifecycle, signal, database, API, or trading logic changed. `5e23e16..f12fc3b` changes only the correction report.

The indicator uses `BuildInfo.Summary` for both its class Description and public Revision property (`SignalBridgeIndicator.cs`). Consequently the generated stamp is the value intended for About/Revision; actual GUI display/load is still UNVERIFIED in this review.

## Actual reruns

From `E:/atas/mbo-review-138b30a`:

```powershell
git worktree add --detach E:/atas/mbo-stamp-independent-f12fc3b f12fc3b64c8bbed9220f3cc30b7ad45f90136acf
```

From the new detached worktree, without MSBuild property overrides:

```powershell
dotnet build atas-indicator/AtasSignalBridge/AtasSignalBridge.csproj --no-incremental
dotnet run --project atas-indicator/AtasSignalBridge.ProbeTests/AtasSignalBridge.ProbeTests.csproj
$env:DENO_DIR='E:/atas/mbo-review-evidence-138b30a/deno-cache'
& E:/atas/mbo-review-evidence-138b30a/npm-cache/_npx/7a40be787520bede/node_modules/@deno/win32-x64/deno.exe task rev:check
git -C atas-indicator/AtasSignalBridge log -1 --format=%H -- .
git -C atas-indicator/AtasSignalBridge rev-list -1 --abbrev=7 --abbrev-commit HEAD -- .
git diff ef4f2a2..f12fc3b --check
git status --porcelain
```

| Check | Observed result |
|---|---|
| Default Windows build, actual installed ATAS SDK | PASS; 0 warnings, 0 errors; no overrides |
| Existing ProbeTests against production probe/lifecycle classes and actual SDK types | PASS: 33 probe/lifecycle assertions |
| REV check | PASS: indicator 1.6.2; web 1.3.2 |
| Independent Git history query | Last indicator commit `5e23e168b9f96a61c8ed72dc01e91103fd579d4f`; new command returns `5e23e16` |
| New generated `atas-indicator/AtasSignalBridge/obj/Debug/BuildInfo.g.cs` | `Version = "1.6.2"`; `Commit = "5e23e16"`; summary `REV 1.6.2 | commit 5e23e16 | built 2026-09-09 19:52` |
| Newly built binary stamp, read directly from DLL UTF-16 string data | Same `REV 1.6.2 | commit 5e23e16 | built 2026-09-09 19:52` |
| Candidate binary stamp, independently read from DLL UTF-16 string data | `REV 1.6.2 | commit 5e23e16 | built 2026-09-09 19:43` |
| Candidate retained generated BuildInfo | Matches candidate binary summary |
| Candidate file/product version | `1.6.2.0` / `1.6.2+5e23e168b9f96a61c8ed72dc01e91103fd579d4f` |
| Diff whitespace and isolated source status | PASS; no whitespace diagnostics and no tracked/untracked source changes |

Artifact hashes were computed using PowerShell `Get-FileHash -Algorithm SHA256 -LiteralPath`. Binary stamps were extracted by reading the DLL with `System.IO.File.ReadAllBytes`, decoding with `System.Text.Encoding.Unicode`, and matching `REV 1\.6\.2 \| commit [a-z0-9-]+ \| built [0-9 :-]+`. File/product versions were read with `System.Diagnostics.FileVersionInfo.GetVersionInfo`.

The independent DLL is `E:/atas/mbo-stamp-independent-f12fc3b/atas-indicator/AtasSignalBridge/bin/Debug/AtasSignalBridge.dll`, SHA256 `D27B6224C40D5080CD543DEE495B829482A59EB19283E82AFB3C6014F1804411`. It is not byte-identical to the candidate: its generated time is 19:52 instead of 19:43, and automatic ProductVersion metadata contains repository head `f12fc3b...`, while the candidate contains `5e23e16...`. Both About/Revision stamps correctly identify the unchanged indicator source as `5e23e16`. This review does not claim reproducible binary byte equivalence or a full IL equivalence audit.

## Limits and next gate

The 33 assertions are engineering regression tests with synthetic events, independently rerun. They do not establish live Rithmic behavior, signal quality, profitability, or an empirical research result. Server/SQL/full staging/RLS suites were not rerun for this project-file-only correction; no new certification of those surfaces is made.

ATAS loading/About, correct GCZ6@COMEX 5m and Rithmic L2 settings, Aggregated Quotes disabled, immediate `MBO_PROBE_V2` enabled/subscription-active evidence, initial cache reads, active/quiet 15-minute windows, disable/re-enable, restart, feed errors, clock/latency health, and live disk readiness remain UNVERIFIED by this reviewer. The existing explicit gaps for true exchange/feed epochs, book rebuild/completeness, and deterministic replay remain open even after a successful log-only collection.

The installing executor may now proceed with the owner's authorized installation of the exact candidate, preserving backups and verifying its destination hash. The executor/owner then collects raw Phase A logs; an independent reviewer must assess that packet before advancing the relevant gates. The parent task will integrate this signoff with installation evidence into Handoff section 00 and the detailed section, commit, and push. This report alone does not declare the complete MBO task done. No shared Handoff was changed by this reviewer.

Rollback remains restoration of the previously installed DLL(s) from the installation executor's verified backups, followed by the appropriate ATAS restart/load verification. Do not substitute the superseded no-git artifact.
