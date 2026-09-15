[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ProjectRoot,
    [Parameter(Mandatory)][string]$WorkItemsPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'build-materials.ps1') -ProjectRoot $ProjectRoot -NoBuild
Invoke-MaterialsWordWorker -WorkItemsPath $WorkItemsPath
