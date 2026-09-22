. "$PSScriptRoot\Assert.ps1"
$ErrorActionPreference = 'Stop'

$modulePath = Join-Path $PSScriptRoot '..\lib\StandardBusinessOrchestrator.psm1'
Import-Module $modulePath -Force -DisableNameChecking
$moduleText=Get-Content -Raw -Encoding UTF8 -LiteralPath $modulePath
foreach($specializedSpec in @('reference-acceptance.spec.ts','inventory-application-acceptance.spec.ts','project-archive-acceptance.spec.ts')){Assert-Match $moduleText ([regex]::Escape($specializedSpec))}

$stages = @(
    'RecommendTemplate','CollectCredentials','BuildThemeProfile','ComposeDomain','AssembleResources','BuildDesktop',
    'VerifyDomain','VerifyPackagedWorkflow','CaptureDesktopScreenshots','BuildBusinessMaterials',
    'BuildWindowsInstaller','VerifyInstaller','PackageBusinessDelivery','Publish'
)
$root = Join-Path $env:TEMP ('standard-orchestrator-test-' + [guid]::NewGuid().ToString('N'))

function New-StandardTestContext([string]$Id) {
    [pscustomobject]@{
        Theme='园区资产工单'; SoftwareName='园区资产工单软件'; Version='1.0.0'; AppId='11111111-2222-4333-8444-555555555555'; RunId=$Id
        WorkspacePath=(Join-Path $root "workspace\$Id"); RequestedDeliveryPath=(Join-Path $root 'delivery\园区资产工单软件'); LogPath=(Join-Path $root "logs\$Id.log")
    }
}
function New-StandardOverrides([Collections.Generic.List[string]]$Calls,[string]$FailStage) {
    $result = @{}
    foreach ($stage in $stages) {
        $captured = $stage
        $result[$stage] = {
            param($state)
            $Calls.Add($captured)
            if ($captured -eq $FailStage) { throw ("injected-$captured " + 'gh' + 'p_' + ('A' * 36)) }
            if ($captured -eq 'AssembleResources') {
                Assert-Equal ($null -ne $state.CredentialDigests) $true
                return [pscustomobject]@{ resourcesPath='resources'; blueprint=[pscustomobject]@{ modules=@() }; receipt=[pscustomobject]@{ status='passed' } }
            }
            if ($captured -eq 'VerifyDomain') { Assert-Equal $state.Resources.resourcesPath 'resources' }
            if ($captured -eq 'VerifyPackagedWorkflow') { Assert-Equal ($null -eq $state.CredentialDigests) $true }
            if ($captured -eq 'PackageBusinessDelivery') { return (Join-Path $state.Context.WorkspacePath 'standard-publish-staging') }
            if ($captured -eq 'Publish') { return $state.Context.RequestedDeliveryPath }
            return [pscustomobject]@{ status='passed'; stage=$captured }
        }.GetNewClosure()
    }
    return $result
}

$template = [pscustomobject]@{ id='asset_work_order_operations'; packs=@('asset_registry','work_order_service'); primaryEntities=@('asset','work_order') }
$digests = [pscustomobject]@{ dispatcher='scrypt$16384$8$1$a$b'; operator='scrypt$16384$8$1$c$d'; reviewer='scrypt$16384$8$1$e$f'; administrator='scrypt$16384$8$1$g$h' }
try {
    $calls = [Collections.Generic.List[string]]::new()
    $context = New-StandardTestContext 'success'
    $result = Invoke-StandardBusinessOrchestration -Context $context -Template $template -CredentialDigests $digests -StageOverrides (New-StandardOverrides $calls '') -KeepSuccessfulWorkspace
    Assert-Equal ($calls -join ' -> ') ($stages -join ' -> ')
    Assert-Equal $result.ExitCode 0
    Assert-Equal $result.DeliveryPath $context.RequestedDeliveryPath
    Assert-Equal (Test-Path -LiteralPath $context.WorkspacePath -PathType Container) $true
    $log = Get-Content -Raw -Encoding UTF8 -LiteralPath $context.LogPath
    foreach ($stage in $stages) { Assert-Match $log ("\[通过\] $stage") }

    $defaultCalls = [Collections.Generic.List[string]]::new()
    $defaultContext = New-StandardTestContext 'default-entry-stages'
    $defaultOverrides = New-StandardOverrides $defaultCalls 'BuildThemeProfile'
    $defaultOverrides.Remove('RecommendTemplate')
    $defaultOverrides.Remove('CollectCredentials')
    Assert-Throws {
        Invoke-StandardBusinessOrchestration -Context $defaultContext -Template $template -CredentialDigests $digests -StageOverrides $defaultOverrides
    } 'injected-BuildThemeProfile'
    $defaultLog = Get-Content -Raw -Encoding UTF8 -LiteralPath $defaultContext.LogPath
    Assert-Match $defaultLog '\[通过\] RecommendTemplate'
    Assert-Match $defaultLog '\[通过\] CollectCredentials'

    Import-Module (Join-Path $PSScriptRoot '..\lib\StandardBusinessCatalog.psm1') -Force -DisableNameChecking
    $realTemplate = @(Get-StandardBusinessTemplates | Where-Object id -eq 'asset_work_order_operations')[0]
    $resourceContext = New-StandardTestContext 'real-resource-handoff'
    $resourceCalls = [Collections.Generic.List[string]]::new()
    $resourceOverrides = New-StandardOverrides $resourceCalls ''
    $resourceOverrides.Remove('ComposeDomain')
    $resourceOverrides.Remove('AssembleResources')
    $resourceOverrides['BuildThemeProfile'] = {
        param($state)
        $profile = [pscustomobject]@{ softwareName='园区资产工单软件'; purpose='管理园区资产与工单闭环'; industry='园区运维'; entityAliases=[pscustomobject]@{}; moduleAliases=[pscustomobject]@{}; seedVocabulary=[pscustomobject]@{} }
        $path = Join-Path $state.Context.WorkspacePath 'profile-fixture.json'
        [IO.File]::WriteAllText($path,($profile|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
        [pscustomobject]@{Path=$path;Profile=$profile}
    }
    $resourceOverrides['BuildDesktop'] = { param($state) throw 'stop-after-real-resources' }
    Assert-Throws {
        Invoke-StandardBusinessOrchestration -Context $resourceContext -Template $realTemplate -CredentialDigests $digests -StageOverrides $resourceOverrides
    } 'stop-after-real-resources'
    foreach($file in @('blueprint.json','seed.json','domain-lock.json','project.lock.json','resource-manifest.json')) {
        Assert-Equal (Test-Path -LiteralPath (Join-Path $resourceContext.WorkspacePath "resources\$file") -PathType Leaf) $true
    }

    for ($index=0; $index -lt $stages.Count; $index++) {
        $calls = [Collections.Generic.List[string]]::new()
        $context = New-StandardTestContext ('failure-' + $index)
        Assert-Throws {
            Invoke-StandardBusinessOrchestration -Context $context -Template $template -CredentialDigests $digests -StageOverrides (New-StandardOverrides $calls $stages[$index])
        } "injected-$($stages[$index])"
        Assert-Equal ($calls -join '|') (@($stages[0..$index]) -join '|')
        Assert-Equal (Test-Path -LiteralPath $context.RequestedDeliveryPath) $false
        Assert-Equal (Test-Path -LiteralPath $context.WorkspacePath -PathType Container) ($index -ge 2)
        $failureLog = Get-Content -Raw -Encoding UTF8 -LiteralPath $context.LogPath
        Assert-Match $failureLog ("\[失败\] $($stages[$index])")
        Assert-Equal ($failureLog -match 'ghp_[A-Za-z0-9]+') $false
        Assert-Match $failureLog '<redacted-token>'
    }
}
finally {
    if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}
