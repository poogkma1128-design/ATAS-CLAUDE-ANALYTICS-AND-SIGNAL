param(
    [Parameter(Mandatory=$true)][string]$OutputDirectory,
    [string]$Config = 'config_v1.json'
)
$ErrorActionPreference = 'Stop'
# This script runs the SELECT and saves the reply. It deliberately does NOT parse the
# result: the CLI has shipped several wrappers around the same column, and Windows
# PowerShell 5.1 and PowerShell 7 disagree about large JSON documents, which broke the
# export twice. research/hybrid_ml/extract_snapshot.py does the parsing and validation
# instead - one implementation, covered by tests. Run it second; the command is printed
# at the end and also written into next_step.txt.
$researchRepo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$snapshotDir = [IO.Path]::GetFullPath($OutputDirectory)
if ($snapshotDir.Equals($researchRepo, [StringComparison]::OrdinalIgnoreCase) -or
    $snapshotDir.StartsWith($researchRepo + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Raw snapshot must be stored outside the repository.'
}
if (Test-Path -LiteralPath $snapshotDir) { throw 'Refusing to overwrite a snapshot directory.' }
# Only the config is parsed here, and it is a few kilobytes: it names the scope, and the
# query follows from it, so a reply can never be exported under one scope and trained
# under another.
$configFile = if (Test-Path -LiteralPath $Config) { (Resolve-Path -LiteralPath $Config).Path }
              else { Join-Path $PSScriptRoot $Config }
if (-not (Test-Path -LiteralPath $configFile)) { throw "Config not found: $Config" }
$configJson = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
switch ($configJson.schema_version) {
    'hybrid-ml-exploratory-v1' { $queryRelative = 'docs/queries/hybrid_ml_training_export_v1.sql' }
    'hybrid-ml-exploratory-v2' { $queryRelative = $configJson.export_query }
    default { throw "Unknown config schema_version: $($configJson.schema_version)" }
}
$queryFile = Join-Path $researchRepo $queryRelative
if (-not (Test-Path -LiteralPath $queryFile)) { throw "Export query not found: $queryFile" }
New-Item -ItemType Directory -Path $snapshotDir | Out-Null
Copy-Item -LiteralPath $queryFile -Destination (Join-Path $snapshotDir 'export.sql')
Copy-Item -LiteralPath $configFile -Destination (Join-Path $snapshotDir 'config_before_export.json')
$replyFile = Join-Path $snapshotDir 'cli-output.json'
$capture = & npx --yes supabase@2.116.0 db query --linked --project-ref sckdriuwfyittcybnbhz --file $queryFile -o json
$exitCode = $LASTEXITCODE
# Save the reply before judging it, so a failed attempt still leaves evidence to read.
[IO.File]::WriteAllText($replyFile, ($capture -join [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
if ($exitCode -ne 0) {
    throw "SELECT failed (exit $exitCode). The CLI reply is saved as $replyFile; this directory records an unsuccessful export attempt."
}
$size = (Get-Item -LiteralPath $replyFile).Length
if ($size -eq 0) {
    throw "The CLI returned no output. Check that it is logged in and linked to sckdriuwfyittcybnbhz. Empty reply saved at $replyFile."
}
$nextStep = "python -m research.hybrid_ml.extract_snapshot --cli-output `"$replyFile`" --config `"$configFile`" --output-directory `"$snapshotDir`""
[IO.File]::WriteAllText((Join-Path $snapshotDir 'next_step.txt'), $nextStep, [Text.UTF8Encoding]::new($false))
Write-Host ""
Write-Host "SELECT succeeded. Saved $size bytes to $replyFile"
Write-Host "Nothing is validated yet. Run this next, from the repository root, with the venv python:"
Write-Host ""
Write-Host "  $nextStep"
Write-Host ""
