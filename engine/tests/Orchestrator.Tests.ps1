. "$PSScriptRoot\Assert.ps1"
$ErrorActionPreference = 'Stop'

$scriptPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\Generate.ps1'))
$scriptText = Get-Content -Raw -Encoding utf8 -LiteralPath $scriptPath
Assert-Match $scriptText 'function\s+Invoke-GeneratorOrchestration'
Assert-Match $scriptText 'Invoke-StandardBusinessOrchestration'
Assert-Match $scriptText "modeForPreflight.*'StandardBusiness'"
Assert-Match $scriptText "request\.mode -eq 'LegacyDemo'"
Assert-Match $scriptText 'CredentialSecrets are required for non-interactive'
$readmePath = Join-Path $PSScriptRoot '..\..\README.txt'
Assert-Equal (Test-Path -LiteralPath $readmePath -PathType Leaf) $true
$readme = Get-Content -Raw -Encoding utf8 -LiteralPath $readmePath
foreach ($requiredText in @('双击', '交付结果', '申请信息', 'SmartScreen', '不保证审批结果')) { Assert-Match $readme ([regex]::Escape($requiredText)) }
$batchPath = Join-Path $PSScriptRoot '..\..\开始生成.bat'
$batchBytes = [IO.File]::ReadAllBytes($batchPath)
Assert-Equal @($batchBytes | Where-Object { $_ -gt 0x7F }).Count 0
. $scriptPath

$themeReadCount = 0
$promptedTheme = Resolve-GeneratorTheme -Theme '' -ThemeReader {
    param([string]$Prompt)
    $script:themeReadCount++
    Assert-Match $Prompt '主题'
    return '仓库设备巡检管理'
}
Assert-Equal $promptedTheme '仓库设备巡检管理'
Assert-Equal $themeReadCount 1
$explicitTheme = Resolve-GeneratorTheme -Theme '实验室耗材管理' -ThemeReader { throw 'Theme reader must not be called.' }
Assert-Equal $explicitTheme '实验室耗材管理'

$stageNames = @('Preflight', 'Initialize', 'Generate', 'Validate', 'Screenshots', 'Materials', 'Launcher', 'Installer', 'InstallTest', 'Package', 'Publish')
$testRoot = Join-Path $env:TEMP ('orchestrator-test-' + [Guid]::NewGuid().ToString('N'))

function New-TestContext {
    param([string]$Id)
    $workspace = Join-Path $testRoot "engine\工作区\$Id"
    [pscustomobject]@{
        Theme = '设备点检记录管理'
        SoftwareName = '设备点检记录管理软件'
        Version = '1.0'
        AppId = '33333333-4444-5555-6666-777777777777'
        RunId = $Id
        WorkspacePath = $workspace
        RequestedDeliveryPath = Join-Path $testRoot '交付结果\设备点检记录管理软件'
        LogPath = Join-Path $testRoot "engine\日志\$Id.log"
    }
}

function New-StageOverrides {
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][Collections.Generic.List[string]]$Calls,
        [string]$FailStage
    )
    $overrides = @{}
    foreach ($stage in $stageNames) {
        $stageName = $stage
        $overrides[$stage] = {
            param($state)
            $Calls.Add($stageName)
            if ($stageName -eq 'Initialize') {
                New-Item -ItemType Directory -Path $state.Context.WorkspacePath -Force | Out-Null
            }
            if ($stageName -eq $FailStage) { throw "injected-$stageName" }
            if ($stageName -eq 'Publish') { return $state.Context.RequestedDeliveryPath }
            return [pscustomobject]@{ Stage = $stageName }
        }.GetNewClosure()
    }
    return $overrides
}

try {
    $successCalls = [Collections.Generic.List[string]]::new()
    $successContext = New-TestContext 'success'
    $successResult = Invoke-GeneratorOrchestration -Context $successContext -StageOverrides (New-StageOverrides -Calls $successCalls) -KeepSuccessfulWorkspace
    Assert-Equal ($successCalls -join ' -> ') ($stageNames -join ' -> ')
    Assert-Equal $successResult.ExitCode 0
    Assert-Equal $successResult.DeliveryPath $successContext.RequestedDeliveryPath
    Assert-Equal (Test-Path -LiteralPath $successContext.WorkspacePath -PathType Container) $true
    $successLog = Get-Content -Raw -Encoding utf8 -LiteralPath $successContext.LogPath
    Assert-Match $successLog ([regex]::Escape($successContext.Theme))
    Assert-Match $successLog ([regex]::Escape($successContext.RunId))
    foreach ($stage in $stageNames) {
        Assert-Match $successLog ("\[开始\] $stage")
        Assert-Match $successLog ("\[通过\] $stage")
    }

    $defaultInitializeCalls = [Collections.Generic.List[string]]::new()
    $defaultInitializeOverrides = New-StageOverrides -Calls $defaultInitializeCalls
    $defaultInitializeOverrides.Remove('Initialize')
    $defaultInitializeContext = New-TestContext 'default-initialize'
    [void](Invoke-GeneratorOrchestration -Context $defaultInitializeContext -StageOverrides $defaultInitializeOverrides -KeepSuccessfulWorkspace)
    Assert-Equal (Test-Path -LiteralPath (Join-Path $defaultInitializeContext.WorkspacePath 'app\index.html') -PathType Leaf) $true

    $env:ORCHESTRATOR_SECRET_PROBE = 'must-not-appear-in-log'
    for ($failureIndex = 0; $failureIndex -lt $stageNames.Count; $failureIndex++) {
        $failedStage = $stageNames[$failureIndex]
        $failureCalls = [Collections.Generic.List[string]]::new()
        $failureContext = New-TestContext ("failure-$failureIndex")
        Assert-Throws {
            Invoke-GeneratorOrchestration -Context $failureContext -StageOverrides (New-StageOverrides -Calls $failureCalls -FailStage $failedStage)
        } "injected-$failedStage"
        Assert-Equal ($failureCalls -join '|') (@($stageNames[0..$failureIndex]) -join '|')
        Assert-Equal (Test-Path -LiteralPath $failureContext.RequestedDeliveryPath) $false
        Assert-Equal (Test-Path -LiteralPath $failureContext.WorkspacePath -PathType Container) ($failureIndex -ge 1)
        $failureLog = Get-Content -Raw -Encoding utf8 -LiteralPath $failureContext.LogPath
        Assert-Match $failureLog ("\[失败\] $failedStage")
        Assert-Match $failureLog '退出码：1'
        Assert-Equal ($failureLog.Contains($env:ORCHESTRATOR_SECRET_PROBE)) $false
    }
}
finally {
    Remove-Item Env:\ORCHESTRATOR_SECRET_PROBE -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}
