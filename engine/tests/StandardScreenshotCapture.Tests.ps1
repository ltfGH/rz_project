. "$PSScriptRoot\Assert.ps1"
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$root=Join-Path $env:TEMP ('standard-screenshot-capture-'+[guid]::NewGuid().ToString('N'))
$originalPath=$env:Path
$secrets=$null
try{
    $bin=Join-Path $root 'bin';New-Item -ItemType Directory -Path $bin -Force|Out-Null
    $fakeNode=Join-Path $bin 'node.cmd'
    @'
@echo off
echo synthetic first-window timeout 1>&2
exit /b 7
'@|Set-Content -LiteralPath $fakeNode -Encoding ASCII
    $executable=Join-Path $root 'fixture.exe';$blueprint=Join-Path $root 'blueprint.json'
    [IO.File]::WriteAllBytes($executable,[byte[]](1,2,3));[IO.File]::WriteAllText($blueprint,'{}',[Text.UTF8Encoding]::new($false))
    $output=Join-Path $root 'screenshots';$diagnostic=$output+'.error.log'
    foreach($role in @('DISPATCHER','OPERATOR','REVIEWER','ADMINISTRATOR')){[Environment]::SetEnvironmentVariable("RZ_E2E_${role}_PASSWORD",'FixturePassword1!','Process')}
    $env:Path=$bin+';'+$originalPath
    $script=Join-Path $PSScriptRoot '..\desktop-runtime\tools\capture-standard-screenshots.ps1'
    $result=''
    try{& $script -ExecutablePath $executable -BlueprintPath $blueprint -TemplateId 'project_task_management' -OutputDirectory $output|Out-Null}
    catch{$result=$_.Exception.Message}
    Assert-Equal (-not[string]::IsNullOrWhiteSpace($result)) $true
    Assert-Equal (Test-Path -LiteralPath $diagnostic -PathType Leaf) $true
    Assert-Match $result 'synthetic first-window timeout'
    Assert-Match (Get-Content -Raw -Encoding UTF8 -LiteralPath $diagnostic) 'synthetic first-window timeout'

    $nestedMarker=Join-Path $root 'nested-powershell.marker'
    $env:NESTED_POWERSHELL_MARKER=$nestedMarker
    @'
@echo off
echo invoked>"%NESTED_POWERSHELL_MARKER%"
exit /b 9
'@|Set-Content -LiteralPath (Join-Path $bin 'powershell.cmd') -Encoding ASCII
    Import-Module (Join-Path $PSScriptRoot '..\lib\StandardBusinessOrchestrator.psm1') -Force -DisableNameChecking
    $desktopBuild=Join-Path $root 'desktop-build';$winUnpacked=Join-Path $desktopBuild 'installers\win-unpacked';$resources=Join-Path $root 'resources';$workspace=Join-Path $root 'workspace'
    New-Item -ItemType Directory -Path $winUnpacked,$resources,$workspace -Force|Out-Null
    Copy-Item -LiteralPath $executable -Destination (Join-Path $winUnpacked 'fixture.exe');Copy-Item -LiteralPath $blueprint -Destination (Join-Path $resources 'blueprint.json')
    $secrets=@{};foreach($role in @('dispatcher','operator','reviewer','administrator')){$secure=ConvertTo-SecureString 'FixturePassword1!' -AsPlainText -Force;$secure.MakeReadOnly();$secrets[$role]=$secure}
    $state=[pscustomobject]@{DesktopBuild=[pscustomobject]@{path=$desktopBuild};Resources=[pscustomobject]@{resourcesPath=$resources};Context=[pscustomobject]@{WorkspacePath=$workspace};Template=[pscustomobject]@{id='project_task_management'};CredentialSecrets=$secrets}
    $orchestrator=Get-Module StandardBusinessOrchestrator
    Assert-Throws {& $orchestrator {param($value)Invoke-StandardDefaultAction -Stage 'CaptureDesktopScreenshots' -State $value} $state|Out-Null} 'screenshot capture'
    Assert-Equal (Test-Path -LiteralPath $nestedMarker) $false
}
finally{
    $env:Path=$originalPath
    Remove-Item Env:\NESTED_POWERSHELL_MARKER -ErrorAction SilentlyContinue
    if($null-ne$secrets){foreach($secret in $secrets.Values){$secret.Dispose()}}
    foreach($role in @('DISPATCHER','OPERATOR','REVIEWER','ADMINISTRATOR')){[Environment]::SetEnvironmentVariable("RZ_E2E_${role}_PASSWORD",$null,'Process')}
    if(Test-Path -LiteralPath $root){Remove-Item -LiteralPath $root -Recurse -Force}
}
