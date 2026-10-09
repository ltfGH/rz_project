[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ExecutablePath,
    [Parameter(Mandatory)][string]$BlueprintPath,
    [Parameter(Mandatory)][ValidatePattern('^[a-z][a-z0-9_]{1,63}$')][string]$TemplateId,
    [Parameter(Mandatory)][string]$OutputDirectory,
    [string]$WorkflowCaptureDirectory
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
$parent = Split-Path -Parent $output
if (-not (Test-Path -LiteralPath $parent -PathType Container)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
$staging = Join-Path $parent ('.' + (Split-Path -Leaf $output) + '.staging-' + [guid]::NewGuid().ToString('N'))
$diagnostic = $output + '.error.log'
$captureScript = Join-Path $PSScriptRoot 'capture-standard-screenshots.cjs'
try {
    New-Item -ItemType Directory -Path $staging | Out-Null
    $arguments = @($captureScript,'--executable',$executable,'--blueprint',$blueprintFile,'--template',$TemplateId,'--output',$staging)
    if (-not [string]::IsNullOrWhiteSpace($WorkflowCaptureDirectory)) {
        $workflowRoot = [IO.Path]::GetFullPath($WorkflowCaptureDirectory)
        if (-not (Test-Path -LiteralPath $workflowRoot -PathType Container)) { throw 'Workflow capture directory was not found.' }
        $arguments += @('--workflow-captures',$workflowRoot)
    }
    $previousPreference=$ErrorActionPreference
    try{$ErrorActionPreference='Continue';$nativeOutput=(& node @arguments 2>&1|Out-String);$nativeExit=$LASTEXITCODE}
    finally{$ErrorActionPreference=$previousPreference}
    if ($nativeExit -ne 0) {
        $safe=[string]$nativeOutput
        foreach($role in @('DISPATCHER','OPERATOR','REVIEWER','ADMINISTRATOR')){$secret=[Environment]::GetEnvironmentVariable("RZ_E2E_${role}_PASSWORD");if(-not[string]::IsNullOrEmpty($secret)){$safe=$safe.Replace($secret,'<redacted-password>')}}
        $safe=[regex]::Replace($safe,'(?i)(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})','<redacted-token>').Trim()
        if([string]::IsNullOrWhiteSpace($safe)){$safe='Screenshot capture process returned no diagnostic output.'}
        if($safe.Length-gt4000){$safe=$safe.Substring(0,4000)}
        [IO.File]::WriteAllText($diagnostic,$safe,[Text.UTF8Encoding]::new($false))
        throw "Packaged screenshot capture failed with exit code $nativeExit. $safe"
    }
    $manifestPath = Join-Path $staging 'screenshot-manifest.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'Screenshot capture did not create its manifest.' }
    Move-Item -LiteralPath $staging -Destination $output
    if(Test-Path -LiteralPath $diagnostic){Remove-Item -LiteralPath $diagnostic -Force}
    Get-Item -LiteralPath (Join-Path $output 'screenshot-manifest.json')
}
catch {
    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
    throw
}
