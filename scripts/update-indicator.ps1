#Requires -Version 5.1
<#
    Download the latest production source, build AtasSignalBridge.dll, verify it,
    and copy it to the Desktop for ATAS Import.

    Run by double-clicking update-indicator.bat. The updater deliberately builds
    in a temporary detached worktree so it never switches branches, resets files,
    or overwrites unfinished work in the user's checkout.
#>

param(
    [string]$DestinationDirectory = [Environment]::GetFolderPath("Desktop"),
    [switch]$NoPause
)

# Git writes normal progress to stderr, so external commands are checked via
# LASTEXITCODE rather than by turning every stderr line into a PowerShell error.
$ErrorActionPreference = "Continue"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$ProductionBranch = "claude/form-signal-telegram-rz8am1"
$RemoteRef = "origin/$ProductionBranch"
$BuildRoot = Join-Path ([IO.Path]::GetTempPath()) ("AtasSignalBridge-build-" + [guid]::NewGuid().ToString("N"))
$WorktreeAdded = $false
$Succeeded = $false

function Step([int]$Number, [string]$Text) {
    Write-Host ""
    Write-Host "[$Number/4] $Text" -ForegroundColor Cyan
}

function Ok([string]$Text)   { Write-Host "      OK  $Text" -ForegroundColor Green }
function Note([string]$Text) { Write-Host "          $Text" -ForegroundColor DarkGray }

function Fail([string]$Problem, [string]$Fix) {
    throw "$Problem`nFIX: $Fix"
}

function Pause-IfNeeded {
    if (-not $NoPause) {
        Write-Host ""
        Read-Host "Press Enter to close this window" | Out-Null
    }
}

try {
    Write-Host "Update ATAS Signal Bridge from production" -ForegroundColor White
    Note "Repository: $RepoRoot"
    Note "Production branch: $ProductionBranch"

    # --- 1. Prerequisites ----------------------------------------------------
    Step 1 "Check required tools"

    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        Fail "Git was not found." "Install Git from https://git-scm.com/download/win, then run this updater again."
    }
    Ok "git"

    if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
        Fail ".NET SDK was not found." "Install .NET 10 SDK from https://dotnet.microsoft.com/download/dotnet/10.0, then run this updater again."
    }
    Ok ".NET SDK $(dotnet --version)"

    if (-not (Test-Path (Join-Path $RepoRoot ".git"))) {
        Fail "This script is not inside a Git checkout." "Clone the repository from GitHub and run scripts\update-indicator.bat from that checkout."
    }

    # --- 2. Fetch production without changing the current checkout ----------
    Step 2 "Fetch the latest production source from GitHub"

    $OriginUrl = (git -C $RepoRoot remote get-url origin 2>$null)
    if ($LASTEXITCODE -ne 0 -or -not $OriginUrl) {
        Fail "Git remote 'origin' was not found." "Add the GitHub repository as origin, then run this updater again."
    }
    Note "Origin: $OriginUrl"

    # An explicit refspec guarantees that the production remote-tracking branch
    # is refreshed even when this clone has a narrow/custom fetch configuration.
    $FetchRefSpec = "+refs/heads/${ProductionBranch}:refs/remotes/origin/${ProductionBranch}"
    git -C $RepoRoot fetch --prune origin $FetchRefSpec
    if ($LASTEXITCODE -ne 0) {
        Fail "GitHub fetch failed." "Check the internet connection and GitHub access, then run this updater again."
    }

    $ProductionHead = (git -C $RepoRoot rev-parse --short=7 $RemoteRef 2>$null)
    if ($LASTEXITCODE -ne 0 -or -not $ProductionHead) {
        Fail "The production branch '$ProductionBranch' was not found after fetch." "Do not build from main. Send this whole window to the project maintainer."
    }
    $ProductionHead = $ProductionHead.Trim()

    git -C $RepoRoot worktree add --quiet --detach $BuildRoot $RemoteRef
    if ($LASTEXITCODE -ne 0) {
        Fail "Could not create the isolated build worktree." "Close other Git operations and run this updater again."
    }
    $WorktreeAdded = $true

    $Project = Join-Path $BuildRoot "atas-indicator\AtasSignalBridge\AtasSignalBridge.csproj"
    $BuiltDll = Join-Path $BuildRoot "atas-indicator\AtasSignalBridge\bin\Release\AtasSignalBridge.dll"
    if (-not (Test-Path $Project)) {
        Fail "The indicator project is missing from production." "Send this whole window to the project maintainer."
    }

    $Commit = (git -C $BuildRoot log -1 --abbrev=7 --format=%h -- atas-indicator)
    if ($LASTEXITCODE -ne 0 -or -not $Commit) {
        Fail "Could not determine the latest indicator commit." "Send this whole window to the project maintainer."
    }
    $Commit = $Commit.Trim()

    $ProjectText = Get-Content -LiteralPath $Project -Raw
    $Rev = [regex]::Match($ProjectText, '<Version>([^<]+)</Version>').Groups[1].Value
    if (-not $Rev) {
        Fail "The indicator REV is missing from the project file." "Send this whole window to the project maintainer."
    }

    $LatestSubject = (git -C $BuildRoot log -1 --format=%s)
    Ok "Production source ready: $LatestSubject"
    Note "Production HEAD: $ProductionHead"
    Note "Indicator REV: $Rev (indicator commit $Commit)"
    Note "Your current branch and local files were not changed."

    # --- 3. Build and verify -------------------------------------------------
    Step 3 "Build and verify the DLL (the first run can take 1-2 minutes)"

    dotnet build $Project -c Release --nologo
    if ($LASTEXITCODE -ne 0) {
        Fail "The indicator build failed." "Read the red error above. If it mentions ATAS.Indicators.dll, install/update ATAS and check docs/SETUP.md."
    }
    if (-not (Test-Path $BuiltDll)) {
        Fail "The build succeeded but AtasSignalBridge.dll was not found." "Send this whole window to the project maintainer."
    }

    try {
        $AssemblyVersion = [System.Reflection.AssemblyName]::GetAssemblyName($BuiltDll).Version.ToString(3)
    } catch {
        Fail "The built DLL could not be read as a .NET assembly." "Send this whole window to the project maintainer."
    }
    if ($AssemblyVersion -ne $Rev) {
        Fail "Version verification failed: source says $Rev but DLL says $AssemblyVersion." "Do not Import this DLL. Send this whole window to the project maintainer."
    }
    $SourceHash = (Get-FileHash -LiteralPath $BuiltDll -Algorithm SHA256).Hash
    Ok "Build passed; DLL version verified as $AssemblyVersion"

    # --- 4. Copy and verify --------------------------------------------------
    Step 4 "Copy the verified DLL to the selected folder"

    if (-not (Test-Path -LiteralPath $DestinationDirectory)) {
        New-Item -ItemType Directory -Path $DestinationDirectory -Force -ErrorAction Stop | Out-Null
    }
    $Target = Join-Path $DestinationDirectory "AtasSignalBridge.dll"
    Copy-Item -LiteralPath $BuiltDll -Destination $Target -Force -ErrorAction Stop
    $TargetHash = (Get-FileHash -LiteralPath $Target -Algorithm SHA256).Hash
    if ($TargetHash -ne $SourceHash) {
        Fail "The copied DLL failed SHA-256 verification." "Do not Import this DLL. Delete it and run the updater again."
    }

    Ok $Target
    Ok "SHA-256 copy verification passed"
    Note "File date: $((Get-Item -LiteralPath $Target).LastWriteTime)"
    Note "SHA-256: $TargetHash"

    Write-Host ""
    Write-Host "Finished. Next steps in ATAS:" -ForegroundColor White
    Write-Host "  1. Fully close ATAS (including the system tray), then reopen it."
    Write-Host "  2. Remove the old Signal Bridge from the chart."
    Write-Host "  3. Right-click chart -> Indicators -> Import."
    Write-Host "  4. Select AtasSignalBridge.dll from: $DestinationDirectory"
    Write-Host "  5. Find Signal Bridge under Custom -> Add."
    Write-Host ""
    Write-Host "Verify the About tab shows:" -ForegroundColor White
    Write-Host "  REV $Rev | commit $Commit" -ForegroundColor Green
    Write-Host "  Built from production HEAD $ProductionHead" -ForegroundColor Green
    Write-Host ""
    Write-Host "The web REV is separate and does not need to match this indicator REV." -ForegroundColor DarkGray
    $Succeeded = $true
}
catch {
    Write-Host ""
    Write-Host "UPDATE STOPPED" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Yellow
}
finally {
    if ($WorktreeAdded) {
        git -C $RepoRoot worktree remove --force $BuildRoot 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Host ""
            Write-Host "Warning: temporary worktree cleanup failed:" -ForegroundColor Yellow
            Write-Host "  $BuildRoot" -ForegroundColor Yellow
        }
        git -C $RepoRoot worktree prune 2>$null
    }
}

Pause-IfNeeded
if (-not $Succeeded) { exit 1 }
exit 0
