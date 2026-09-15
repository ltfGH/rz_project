Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$testFiles = Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.Tests.ps1' -File |
    Sort-Object -Property Name

$failed = $false
foreach ($testFile in $testFiles) {
    & $testFile.FullName
    if (-not $?) {
        $failed = $true
    }
}

if ($failed) {
    exit 1
}

