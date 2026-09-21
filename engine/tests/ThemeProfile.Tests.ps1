. "$PSScriptRoot\Assert.ps1"
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot '..\lib\StandardBusinessCatalog.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot '..\lib\ThemeProfile.psm1') -Force -DisableNameChecking

$template = @(Get-StandardBusinessTemplates | Where-Object id -eq 'asset_inspection_rectification')[0]
$testRoot = Join-Path $env:TEMP ('theme-profile-test-' + [guid]::NewGuid().ToString('N'))

function Write-Profile([string]$Path, $Value) {
    [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
}

function New-ValidProfile {
    [ordered]@{
        softwareName = 'Campus Facility Inspection Software'
        purpose = 'Track facility inspections and close remediation work orders.'
        industry = 'Campus operations'
        entityAliases = [ordered]@{ asset = 'Facility'; inspection_task = 'Inspection' }
        moduleAliases = [ordered]@{ assets = 'Facilities'; inspection_tasks = 'Inspection Tasks' }
        seedVocabulary = [ordered]@{ asset_names = @('Pump', 'Valve'); findings = @('Temperature alert') }
    }
}

try {
    New-Item -ItemType Directory -Path $testRoot | Out-Null
    $validPath = Join-Path $testRoot 'valid.json'
    Write-Profile $validPath (New-ValidProfile)
    $valid = Test-ThemeProfile -Path $validPath -Template $template
    Assert-Equal $valid.Passed $true
    Assert-Equal $valid.Profile.entityAliases.asset 'Facility'
    Assert-Equal @($valid.Issues).Count 0

    $unknownAlias = New-ValidProfile
    $unknownAlias.entityAliases = [ordered]@{ unknown_entity = 'Unknown' }
    $unknownAliasPath = Join-Path $testRoot 'unknown-alias.json'
    Write-Profile $unknownAliasPath $unknownAlias
    $unknownResult = Test-ThemeProfile -Path $unknownAliasPath -Template $template
    Assert-Equal $unknownResult.Passed $false
    Assert-Match ($unknownResult.Issues -join ' ') 'unknown_entity'

    $hostileValues = @('<script>alert(1)</script>', 'https://example.invalid', 'C:\temp\payload', 'SELECT * FROM users')
    foreach ($hostile in $hostileValues) {
        $profile = New-ValidProfile
        $profile.purpose = $hostile
        $profilePath = Join-Path $testRoot ('hostile-' + [guid]::NewGuid().ToString('N') + '.json')
        Write-Profile $profilePath $profile
        $result = Test-ThemeProfile -Path $profilePath -Template $template
        Assert-Equal $result.Passed $false
        Assert-Match ($result.Issues -join ' ') 'unsafe'
    }

    $identity = New-ValidProfile
    $identity.applicant = 'Invented Applicant'
    $identityPath = Join-Path $testRoot 'identity.json'
    Write-Profile $identityPath $identity
    Assert-Equal (Test-ThemeProfile -Path $identityPath -Template $template).Passed $false

    $extra = New-ValidProfile
    $extra.extra = 'not allowed'
    $extraPath = Join-Path $testRoot 'extra.json'
    Write-Profile $extraPath $extra
    Assert-Equal (Test-ThemeProfile -Path $extraPath -Template $template).Passed $false

    $context = [pscustomobject]@{
        Theme = 'campus inspection'
        SoftwareName = 'Campus Inspection Software'
        WorkspacePath = (Join-Path $testRoot 'workspace')
    }
    New-Item -ItemType Directory -Path $context.WorkspacePath | Out-Null
    $prompt = New-ThemeProfilePrompt -Context $context -Template $template
    Assert-Match $prompt 'asset'
    Assert-Match $prompt 'assets'
    Assert-Match $prompt 'Do not change stable ids'

    $script:invocations = 0
    $script:summaries = [Collections.Generic.List[string]]::new()
    $repairingInvoker = {
        param($receivedContext, $receivedTemplate, $outputPath, $failureSummary, $codexPath)
        $script:invocations++
        $script:summaries.Add([string]$failureSummary)
        if ($script:invocations -eq 1) {
            $bad = New-ValidProfile
            $bad.entityAliases = [ordered]@{ unknown_entity = 'Unknown' }
            Write-Profile $outputPath $bad
        }
        else { Write-Profile $outputPath (New-ValidProfile) }
        return 0
    }
    $generated = Invoke-ThemeProfileGeneration -Context $context -Template $template `
        -CodexPath 'fake-codex' -CodexInvoker $repairingInvoker
    Assert-Equal $script:invocations 2
    Assert-Equal $generated.Profile.softwareName 'Campus Facility Inspection Software'
    Assert-Match $script:summaries[1] 'unknown_entity'
    Assert-Equal $script:summaries[1].Contains($testRoot) $false

    $script:failedInvocations = 0
    $alwaysInvalid = {
        param($receivedContext, $receivedTemplate, $outputPath, $failureSummary, $codexPath)
        $script:failedInvocations++
        [IO.File]::WriteAllText($outputPath, '{}', [Text.UTF8Encoding]::new($false))
        return 0
    }
    Assert-Throws {
        Invoke-ThemeProfileGeneration -Context $context -Template $template `
            -CodexPath 'fake-codex' -CodexInvoker $alwaysInvalid
    } 'validation failed'
    Assert-Equal $script:failedInvocations 2
}
finally {
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}
