. "$PSScriptRoot\Assert.ps1"
$ErrorActionPreference = 'Stop'

$modulePath = Join-Path $PSScriptRoot '..\lib\BlueprintValidation.psm1'
Import-Module $modulePath -Force -DisableNameChecking

$nodePath = [IO.Path]::GetFullPath((Get-Command node -ErrorAction Stop).Source)
$fixtureRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'fixtures\blueprints'))
$validPath = Join-Path $fixtureRoot 'enterprise-ops.valid.json'
$unsupportedPath = Join-Path $fixtureRoot 'unsupported.invalid.json'

$valid = Test-BusinessBlueprint -BlueprintPath $validPath -NodePath $nodePath
Assert-Equal $valid.Passed $true
Assert-Equal $valid.CanGenerate $true
Assert-Equal $valid.ExitCode 0
Assert-Equal @($valid.Issues).Count 0

$unsupported = Test-BusinessBlueprint -BlueprintPath $unsupportedPath -NodePath $nodePath
Assert-Equal $unsupported.Passed $true
Assert-Equal $unsupported.CanGenerate $false
Assert-Equal $unsupported.ExitCode 1
Assert-Equal @($unsupported.Issues).Count 1
Assert-Equal $unsupported.Issues[0].code 'UNSUPPORTED_REQUIREMENT'

Assert-Throws {
    Test-BusinessBlueprint -BlueprintPath 'relative.json' -NodePath $nodePath
} 'absolute path'

Assert-Throws {
    Test-BusinessBlueprint -BlueprintPath (Join-Path $fixtureRoot 'missing.json') -NodePath $nodePath
} 'does not exist'

Assert-Throws {
    Test-BusinessBlueprint -BlueprintPath $validPath -NodePath (Join-Path $fixtureRoot 'missing-node.exe')
} 'Node'

$malformedInvoker = {
    param($ResolvedNodePath, $CliPath, $BlueprintPath, $StdoutPath, $StderrPath)
    [IO.File]::WriteAllText($StdoutPath, 'not-json', [Text.UTF8Encoding]::new($false))
    return 0
}
Assert-Throws {
    Test-BusinessBlueprint -BlueprintPath $validPath -NodePath $nodePath -ProcessInvoker $malformedInvoker
} 'invalid JSON'

$unexpectedExitInvoker = {
    param($ResolvedNodePath, $CliPath, $BlueprintPath, $StdoutPath, $StderrPath)
    [IO.File]::WriteAllText($StderrPath, 'safe child failure', [Text.UTF8Encoding]::new($false))
    return 7
}
Assert-Throws {
    Test-BusinessBlueprint -BlueprintPath $validPath -NodePath $nodePath -ProcessInvoker $unexpectedExitInvoker
} 'unexpected exit code 7'
