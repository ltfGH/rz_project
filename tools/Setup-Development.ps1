[CmdletBinding()]
param([string]$RepositoryRoot)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($RepositoryRoot)) { $RepositoryRoot = Split-Path -Parent $PSScriptRoot }
$root = [IO.Path]::GetFullPath($RepositoryRoot)

& (Join-Path $PSScriptRoot 'Test-DevelopmentEnvironment.ps1') -RepositoryRoot $root
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

foreach ($relativePath in @('engine', 'engine\domain-packs', 'engine\desktop-runtime')) {
    $packageRoot = Join-Path $root $relativePath
    Write-Host "Installing locked dependencies: $relativePath"
    & npm.cmd --prefix $packageRoot ci
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $lockHash = (Get-FileHash -LiteralPath (Join-Path $packageRoot 'package-lock.json') -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText((Join-Path $packageRoot 'node_modules\.rz-lock-sha256'), $lockHash + "`n", [Text.Encoding]::ASCII)
}

& (Join-Path $PSScriptRoot 'Test-DevelopmentEnvironment.ps1') -RepositoryRoot $root -RequireDependencies
exit $LASTEXITCODE
