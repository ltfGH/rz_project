[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ProjectRoot,
    [string]$EdgePath = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot '..\..\lib\BuildPipeline.psm1') -Force -DisableNameChecking
Invoke-ScreenshotBuild -Context ([pscustomobject]@{ WorkspacePath = $ProjectRoot }) -EdgePath $EdgePath | ForEach-Object {
    Write-Host ("Captured {0}" -f $_.Name)
}
