[CmdletBinding()]
param(
    [string]$RepositoryRoot,
    [switch]$IncludeE2E,
    [switch]$IncludeReferenceE2E,
    [switch]$IncludeExternalPipelineTests
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($RepositoryRoot)) { $RepositoryRoot = Split-Path -Parent $PSScriptRoot }
$root = [IO.Path]::GetFullPath($RepositoryRoot)

# Some automation hosts inject both PATH and Path. Windows PowerShell 5.1
# cannot pass that environment to Start-Process, which the existing tests use.
$processPath = $env:Path
[Environment]::SetEnvironmentVariable('PATH', $null, 'Process')
[Environment]::SetEnvironmentVariable('Path', $null, 'Process')
[Environment]::SetEnvironmentVariable('Path', $processPath, 'Process')

function Invoke-Checked {
    param([string]$WorkingDirectory, [string]$Command, [string[]]$Arguments)
    Push-Location $WorkingDirectory
    try {
        & $Command @Arguments
        if ($LASTEXITCODE -ne 0) { throw "$Command $($Arguments -join ' ') failed with exit code $LASTEXITCODE." }
    }
    finally { Pop-Location }
}

& (Join-Path $PSScriptRoot 'Test-DevelopmentEnvironment.ps1') -RepositoryRoot $root -RequireDependencies
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$engineTests = Join-Path $root 'engine\tests'
if ($IncludeExternalPipelineTests) {
    Invoke-Checked $root 'powershell' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', '.\engine\tests\Run-All.ps1')
}
else {
    Get-ChildItem -LiteralPath $engineTests -Filter '*.Tests.ps1' -File |
        Where-Object Name -ne 'BuildPipeline.Tests.ps1' |
        Sort-Object Name |
        ForEach-Object {
            Invoke-Checked $root 'powershell' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $_.FullName)
        }
}
Invoke-Checked (Join-Path $root 'engine') 'npm.cmd' @('run', 'build:blueprint-validator')
Invoke-Checked (Join-Path $root 'engine') 'npm.cmd' @('run', 'test:blueprint')

$domainRoot = Join-Path $root 'engine\domain-packs'
Invoke-Checked $domainRoot 'npm.cmd' @('run', 'typecheck')
Invoke-Checked $domainRoot 'npm.cmd' @('test')
Invoke-Checked $domainRoot 'npm.cmd' @('run', 'test:combinations')
Invoke-Checked $domainRoot 'npm.cmd' @('run', 'build')
Invoke-Checked $domainRoot 'npm.cmd' @('run', 'build:runtime-catalog')

$desktopRoot = Join-Path $root 'engine\desktop-runtime'
Invoke-Checked $desktopRoot 'npm.cmd' @('run', 'typecheck')
Invoke-Checked $desktopRoot 'npm.cmd' @('run', 'test:unit')
Invoke-Checked $desktopRoot 'npm.cmd' @('run', 'test:integration')
Invoke-Checked $desktopRoot 'npm.cmd' @('run', 'build')
if ($IncludeE2E) { Invoke-Checked $desktopRoot 'npm.cmd' @('run', 'test:e2e') }
if ($IncludeReferenceE2E) { Invoke-Checked $desktopRoot 'npm.cmd' @('run', 'test:e2e:reference') }

Write-Host 'All requested checks passed.'
