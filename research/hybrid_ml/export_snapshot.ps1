param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$researchRepo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$snapshotDir = [IO.Path]::GetFullPath($OutputDirectory)
if ($snapshotDir.Equals($researchRepo, [StringComparison]::OrdinalIgnoreCase) -or
    $snapshotDir.StartsWith($researchRepo + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Raw snapshot must be stored outside the repository.'
}
if (Test-Path -LiteralPath $snapshotDir) { throw 'Refusing to overwrite a snapshot directory.' }
New-Item -ItemType Directory -Path $snapshotDir | Out-Null
$queryFile = Join-Path $researchRepo 'docs\queries\hybrid_ml_training_export_v1.sql'
$queryHash = (Get-FileHash -LiteralPath $queryFile -Algorithm SHA256).Hash.ToLower()
$configFile = Join-Path $PSScriptRoot 'config_v1.json'
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
if (@($artifact.rows).Count -ne $artifact.row_count -or $artifact.row_count -eq 0) {
    throw 'Incomplete or empty snapshot.'
}
if (@($artifact.rows | Where-Object { $_.symbol -notin @('MNQU6','GC') }).Count) {
    throw 'Out-of-scope symbols in snapshot.'
}
[IO.File]::WriteAllText((Join-Path $snapshotDir 'snapshot.json'), ($artifact | ConvertTo-Json -Depth 100), [Text.UTF8Encoding]::new($false))
$metadata = [ordered]@{
    query_sha256 = $queryHash
    snapshot_sha256 = (Get-FileHash -LiteralPath (Join-Path $snapshotDir 'snapshot.json') -Algorithm SHA256).Hash.ToLower()
    config_sha256 = (Get-FileHash -LiteralPath $configFile -Algorithm SHA256).Hash.ToLower()
    row_count = $artifact.row_count
    exported_at = $artifact.executed_at
    status = 'exploratory_only'
}
[IO.File]::WriteAllText((Join-Path $snapshotDir 'export_manifest.json'), ($metadata | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
$metadata | ConvertTo-Json
