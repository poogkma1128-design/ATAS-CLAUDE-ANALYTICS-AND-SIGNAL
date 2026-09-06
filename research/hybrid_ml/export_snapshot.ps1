param(
    [Parameter(Mandatory=$true)][string]$OutputDirectory,
    [string]$Config = 'config_v1.json'
)
$ErrorActionPreference = 'Stop'
$researchRepo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$snapshotDir = [IO.Path]::GetFullPath($OutputDirectory)
if ($snapshotDir.Equals($researchRepo, [StringComparison]::OrdinalIgnoreCase) -or
    $snapshotDir.StartsWith($researchRepo + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Raw snapshot must be stored outside the repository.'
}
if (Test-Path -LiteralPath $snapshotDir) { throw 'Refusing to overwrite a snapshot directory.' }
# The config decides the scope; the query and the expected schema follow from it, so a
# snapshot can never be exported under one scope and trained under another.
$configFile = if (Test-Path -LiteralPath $Config) { (Resolve-Path -LiteralPath $Config).Path }
              else { Join-Path $PSScriptRoot $Config }
if (-not (Test-Path -LiteralPath $configFile)) { throw "Config not found: $Config" }
$configJson = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
$expectedSymbols = @($configJson.target_symbols)
switch ($configJson.schema_version) {
    'hybrid-ml-exploratory-v1' { $queryRelative = 'docs\queries\hybrid_ml_training_export_v1.sql'
                                 $expectedSchema = 'hybrid-ml-training-export-v1' }
    'hybrid-ml-exploratory-v2' { $queryRelative = $configJson.export_query -replace '/', '\'
                                 $expectedSchema = 'hybrid-ml-training-export-v2' }
    default { throw "Unknown config schema_version: $($configJson.schema_version)" }
}
New-Item -ItemType Directory -Path $snapshotDir | Out-Null
$queryFile = Join-Path $researchRepo $queryRelative
$queryHash = (Get-FileHash -LiteralPath $queryFile -Algorithm SHA256).Hash.ToLower()
Copy-Item -LiteralPath $queryFile -Destination (Join-Path $snapshotDir 'export.sql')
Copy-Item -LiteralPath $configFile -Destination (Join-Path $snapshotDir 'config_before_export.json')
$capture = & npx --yes supabase@2.116.0 db query --linked --project-ref sckdriuwfyittcybnbhz --file $queryFile -o json
if ($LASTEXITCODE -ne 0) { throw 'SELECT failed; this directory records an unsuccessful export attempt.' }
$raw = $capture -join [Environment]::NewLine
[IO.File]::WriteAllText((Join-Path $snapshotDir 'cli-output.json'), $raw, [Text.UTF8Encoding]::new($false))
$parsed = $raw | ConvertFrom-Json
if (@($parsed.rows).Count -ne 1 -or -not $parsed.rows[0].hybrid_ml_training_export) {
    throw 'Unexpected SELECT result; inspect saved wrapper locally.'
}
$artifact = $parsed.rows[0].hybrid_ml_training_export
if ($artifact.schema_version -ne $expectedSchema) {
    throw "Snapshot schema $($artifact.schema_version) does not match config $($configJson.schema_version)."
}
if (@($artifact.rows).Count -ne $artifact.row_count -or $artifact.row_count -eq 0) {
    throw 'Incomplete or empty snapshot.'
}
if (@($artifact.rows | Where-Object { $_.symbol -notin $expectedSymbols }).Count) {
    throw 'Out-of-scope symbols in snapshot.'
}
$missing = @($expectedSymbols | Where-Object { $_ -notin @($artifact.rows.symbol | Select-Object -Unique) })
if ($missing.Count) { throw "Snapshot is missing rows for: $($missing -join ', ')" }
if ($artifact.development_start -ne $configJson.development_start -or
    $artifact.development_end_exclusive -ne $configJson.development_end_exclusive) {
    throw 'Snapshot window does not match the config window.'
}
[IO.File]::WriteAllText((Join-Path $snapshotDir 'snapshot.json'), ($artifact | ConvertTo-Json -Depth 100), [Text.UTF8Encoding]::new($false))
$metadata = [ordered]@{
    config = Split-Path -Leaf $configFile
    schema_version = $artifact.schema_version
    target_symbols = $expectedSymbols
    query_sha256 = $queryHash
    snapshot_sha256 = (Get-FileHash -LiteralPath (Join-Path $snapshotDir 'snapshot.json') -Algorithm SHA256).Hash.ToLower()
    config_sha256 = (Get-FileHash -LiteralPath $configFile -Algorithm SHA256).Hash.ToLower()
    row_count = $artifact.row_count
    exported_at = $artifact.executed_at
    status = 'exploratory_only'
}
[IO.File]::WriteAllText((Join-Path $snapshotDir 'export_manifest.json'), ($metadata | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
$metadata | ConvertTo-Json
