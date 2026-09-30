[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ProjectRoot,
    [Parameter(Mandatory)][string]$WorkItemsPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$resolvedProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
$resolvedWorkItems = [IO.Path]::GetFullPath($WorkItemsPath)
if (-not (Test-Path -LiteralPath $resolvedProjectRoot -PathType Container)) { throw 'Material project root was not found.' }
if (-not (Test-Path -LiteralPath $resolvedWorkItems -PathType Leaf)) { throw 'Material work item file was not found.' }
if ((Get-Item -LiteralPath $resolvedWorkItems).Length -gt 64KB) { throw 'Material work item file is too large.' }

. (Join-Path $PSScriptRoot 'build-materials.ps1') -ProjectRoot $resolvedProjectRoot -NoBuild
try { Invoke-MaterialsWordWorker -WorkItemsPath $resolvedWorkItems }
catch {
    $message = [string]$_.Exception.Message
    if ($message -match '(?i)gh[pousr]_|github_pat_|password|token|[A-Z]:\\') { $message = 'Material Word export failed with a redacted error.' }
    [Console]::Error.WriteLine('MATERIAL_WORD_EXPORT_FAILED: ' + $message)
    exit 1
}
