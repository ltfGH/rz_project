. "$PSScriptRoot\Assert.ps1"
$ErrorActionPreference = 'Stop'

Import-Module "$PSScriptRoot\..\lib\DomainPackComposition.psm1" -Force -DisableNameChecking

$nodePath = [IO.Path]::GetFullPath((Get-Command node -ErrorAction Stop).Source)
$packPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\domain-packs\tests\fixtures\packs\asset-provider'))
$testRoot = Join-Path $env:TEMP ('domain-compose-ps-' + [guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Path $testRoot | Out-Null
    $requestPath = Join-Path $testRoot 'request.json'
    $outputPath = Join-Path $testRoot 'output'
    $request = [ordered]@{
        packs = @($packPath)
        composition = [ordered]@{
            blueprintSchemaVersion = '1.0'
            runtimeVersion = '1.0.0'
            software = [ordered]@{
                id = 'asset_app'; name = 'Asset App'; version = '1.0.0'; purpose = 'Manage assets'
                targetUsers = @('Asset manager'); boundaries = @('Offline'); loginMode = 'required'
            }
            selections = @([ordered]@{ id = 'asset_registry'; version = '1.0.0'; config = @{} })
            coverage = [ordered]@{ supported = @('Asset registry'); unsupported = @() }
            materials = [ordered]@{
                developmentPurpose = 'Manage assets'; industry = 'Enterprise management'
                technicalFeatures = @('Offline runtime')
            }
        }
    }
    [IO.File]::WriteAllText($requestPath, ($request | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))

    $result = Invoke-DomainPackComposition -RequestPath $requestPath -OutputPath $outputPath -NodePath $nodePath
    Assert-Equal $result.Passed $true
    Assert-Equal $result.CanGenerate $true
    Assert-Equal $result.ExitCode 0
    Assert-Equal (Test-Path -LiteralPath (Join-Path $outputPath 'blueprint.json') -PathType Leaf) $true
    Assert-Equal (Test-Path -LiteralPath (Join-Path $outputPath 'domain-lock.json') -PathType Leaf) $true

    Assert-Throws {
        Invoke-DomainPackComposition -RequestPath 'relative.json' -OutputPath $outputPath -NodePath $nodePath
    } 'absolute path'

    $malformedInvoker = {
        param($ResolvedNode, $Cli, $Request, $Output, $Stdout, $Stderr)
        [IO.File]::WriteAllText($Stdout, 'not-json', [Text.UTF8Encoding]::new($false))
        return 0
    }
    Assert-Throws {
        Invoke-DomainPackComposition -RequestPath $requestPath -OutputPath (Join-Path $testRoot 'other') `
            -NodePath $nodePath -ProcessInvoker $malformedInvoker
    } 'invalid JSON'

    $unexpectedInvoker = {
        param($ResolvedNode, $Cli, $Request, $Output, $Stdout, $Stderr)
        return 7
    }
    Assert-Throws {
        Invoke-DomainPackComposition -RequestPath $requestPath -OutputPath (Join-Path $testRoot 'other') `
            -NodePath $nodePath -ProcessInvoker $unexpectedInvoker
    } 'unexpected exit code 7'
}
finally {
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}
