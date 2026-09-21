[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ExecutablePath,
    [Parameter(Mandatory)][string]$BlueprintPath,
    [Parameter(Mandatory)][string]$OutputDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$executable = [IO.Path]::GetFullPath($ExecutablePath)
$blueprintFile = [IO.Path]::GetFullPath($BlueprintPath)
$output = [IO.Path]::GetFullPath($OutputDirectory)
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw "Packaged executable was not found: $executable" }
if (-not (Test-Path -LiteralPath $blueprintFile -PathType Leaf)) { throw "Verified blueprint was not found: $blueprintFile" }
foreach ($role in @('DISPATCHER','OPERATOR','REVIEWER','ADMINISTRATOR')) {
    $name = "RZ_E2E_${role}_PASSWORD"
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) { throw "Credential environment variable is required for role $role." }
}
if (Test-Path -LiteralPath $output) { throw "Refusing to overwrite screenshot output: $output" }
New-Item -ItemType Directory -Path $output -Force | Out-Null
$planPath = Join-Path $output '.capture-plan.json'
$modulePath = Join-Path $PSScriptRoot '..\..\lib\StandardBusinessMaterials.psm1'
$captureScript = Join-Path $PSScriptRoot 'capture-standard-screenshots.cjs'
try {
    Import-Module $modulePath -Force -DisableNameChecking
    $blueprint = Get-Content -Raw -Encoding UTF8 -LiteralPath $blueprintFile | ConvertFrom-Json
    $plan = @(Get-StandardScreenshotPlan -Blueprint $blueprint)
    [IO.File]::WriteAllText($planPath, ($plan | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
    & node $captureScript --executable $executable --blueprint $blueprintFile --plan $planPath --output $output
    if ($LASTEXITCODE -ne 0) { throw "Packaged screenshot capture failed with exit code $LASTEXITCODE." }
    $manifestPath = Join-Path $output 'screenshot-manifest.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'Screenshot capture did not create its manifest.' }
    Get-Item -LiteralPath $manifestPath
}
catch {
    if (Test-Path -LiteralPath $output) { Remove-Item -LiteralPath $output -Recurse -Force }
    throw
}
finally {
    if (Test-Path -LiteralPath $planPath) { Remove-Item -LiteralPath $planPath -Force }
}
