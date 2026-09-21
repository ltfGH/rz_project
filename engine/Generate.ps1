[CmdletBinding()]
param(
    [string]$GenerationMode,
    [string]$Theme,
    [string]$TemplateId,
    [switch]$NonInteractive,
    [pscustomobject]$CredentialDigests,
    [hashtable]$CredentialSecrets,
    [switch]$PreflightOnly,
    [switch]$KeepSuccessfulWorkspace,
    [hashtable]$StageOverrides
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-GenerationLog {
    param(
        [Parameter(Mandatory)][pscustomobject]$Context,
        [Parameter(Mandatory)][string]$Message,
        [switch]$Initialize
    )

    $logDirectory = Split-Path -Parent $Context.LogPath
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    if ($Initialize) {
        $header = "主题：$($Context.Theme)`r`n运行编号：$($Context.RunId)`r`n$line`r`n"
        [IO.File]::WriteAllText($Context.LogPath, $header, [Text.UTF8Encoding]::new($true))
    }
    else {
        [IO.File]::AppendAllText($Context.LogPath, $line + "`r`n", [Text.UTF8Encoding]::new($false))
    }
}

function Invoke-OrchestrationStage {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][pscustomobject]$State,
        [Parameter(Mandatory)][scriptblock]$DefaultAction,
        [hashtable]$StageOverrides
    )

    Write-GenerationLog -Context $State.Context -Message "[开始] $Name"
    try {
        $hasOverride = $null -ne $StageOverrides -and $StageOverrides.ContainsKey($Name)
        $action = if ($hasOverride) { $StageOverrides[$Name] } else { $DefaultAction }
        $result = & $action $State
        Write-GenerationLog -Context $State.Context -Message "[通过] $Name"
        return $result
    }
    catch {
        $exitCode = if ($Name -eq 'Preflight' -and -not ($null -ne $StageOverrides -and $StageOverrides.ContainsKey($Name))) { 2 } else { 1 }
        Write-GenerationLog -Context $State.Context -Message "[失败] $Name；退出码：$exitCode；原因：$($_.Exception.Message)"
        $_.Exception.Data['GeneratorExitCode'] = $exitCode
        $_.Exception.Data['GeneratorStage'] = $Name
        throw
    }
}

function Invoke-GeneratorOrchestration {
    param(
        [Parameter(Mandatory)][pscustomobject]$Context,
        [hashtable]$StageOverrides,
        [switch]$KeepSuccessfulWorkspace
    )

    $libraryRoot = Join-Path $PSScriptRoot 'lib'
    # Modules that depend on Generator.Core use -Force internally, so import the core
    # module last to keep its public commands available to the orchestrator scope.
    foreach ($module in @('Dependencies.psm1', 'CodexRunner.psm1', 'ProjectValidation.psm1', 'BuildPipeline.psm1', 'Publisher.psm1', 'Generator.Core.psm1')) {
        Import-Module (Join-Path $libraryRoot $module) -Force -DisableNameChecking
    }

    $state = [pscustomobject]@{
        Context = $Context
        Dependencies = $null
        Generation = $null
        Validation = $null
        Screenshots = @()
        Materials = @()
        Launcher = $null
        Installer = $null
        InstallTest = $null
        SourceArchive = $null
        StagingPath = $null
        DeliveryPath = $null
    }
    Write-GenerationLog -Context $Context -Message '生成任务已创建。' -Initialize
    $completed = $false
    try {
        $state.Dependencies = Invoke-OrchestrationStage -Name 'Preflight' -State $state -StageOverrides $StageOverrides -DefaultAction {
            param($s)
            Test-GeneratorDependencies -AllowInnoInstall
        }
        [void](Invoke-OrchestrationStage -Name 'Initialize' -State $state -StageOverrides $StageOverrides -DefaultAction {
            param($s)
            Initialize-ProjectWorkspace -Context $s.Context
        })
        $state.Generation = Invoke-OrchestrationStage -Name 'Generate' -State $state -StageOverrides $StageOverrides -DefaultAction {
            param($s)
            $result = Invoke-CodexGeneration -Context $s.Context -CodexPath $s.Dependencies.CodexPath
            if ($result.ExitCode -ne 0) { throw "Codex 生成失败，退出码：$($result.ExitCode)。" }
            return $result
        }
        $state.Validation = Invoke-OrchestrationStage -Name 'Validate' -State $state -StageOverrides $StageOverrides -DefaultAction {
            param($s)
            $result = Test-GeneratedProject -WorkspacePath $s.Context.WorkspacePath -NodePath $s.Dependencies.NodePath
            if (-not $result.Passed) {
                $repair = Invoke-CodexRepair -Context $s.Context -CodexPath $s.Dependencies.CodexPath -FailureSummary $result.Summary
                if ($repair.ExitCode -ne 0) { throw "Codex 修复失败，退出码：$($repair.ExitCode)。" }
                $result = Test-GeneratedProject -WorkspacePath $s.Context.WorkspacePath -NodePath $s.Dependencies.NodePath
            }
            if (-not $result.Passed) { throw "项目验证失败：$($result.Summary)" }
            return $result
        }
        $state.Screenshots = @(Invoke-OrchestrationStage -Name 'Screenshots' -State $state -StageOverrides $StageOverrides -DefaultAction {
            param($s)
            Invoke-ScreenshotBuild -Context $s.Context -EdgePath $s.Dependencies.EdgePath
        })
        $state.Materials = @(Invoke-OrchestrationStage -Name 'Materials' -State $state -StageOverrides $StageOverrides -DefaultAction {
            param($s)
            Invoke-MaterialsBuild -Context $s.Context
        })
        $state.Launcher = Invoke-OrchestrationStage -Name 'Launcher' -State $state -StageOverrides $StageOverrides -DefaultAction {
            param($s)
            Invoke-LauncherBuild -Context $s.Context
        }
        $state.Installer = Invoke-OrchestrationStage -Name 'Installer' -State $state -StageOverrides $StageOverrides -DefaultAction {
            param($s)
            Invoke-InstallerBuild -Context $s.Context -ISCCPath $s.Dependencies.ISCCPath
        }
        $state.InstallTest = Invoke-OrchestrationStage -Name 'InstallTest' -State $state -StageOverrides $StageOverrides -DefaultAction {
            param($s)
            Test-InstallerLifecycle -Context $s.Context -InstallerPath $s.Installer.FullName
        }
        $packageResult = Invoke-OrchestrationStage -Name 'Package' -State $state -StageOverrides $StageOverrides -DefaultAction {
            param($s)
            $sourceArchive = New-SourceArchive -Context $s.Context
            $artifacts = @($s.Materials) + @($s.Installer) + @($sourceArchive)
            $stagingPath = New-DeliveryStaging -Context $s.Context -Artifacts $artifacts
            return [pscustomobject]@{ SourceArchive = $sourceArchive; StagingPath = $stagingPath }
        }
        if ($null -ne $StageOverrides -and $StageOverrides.ContainsKey('Package')) {
            $state.StagingPath = [string]$packageResult
        }
        else {
            $state.SourceArchive = $packageResult.SourceArchive
            $state.StagingPath = $packageResult.StagingPath
        }
        $state.DeliveryPath = [string](Invoke-OrchestrationStage -Name 'Publish' -State $state -StageOverrides $StageOverrides -DefaultAction {
            param($s)
            Publish-Delivery -Context $s.Context -StagingPath $s.StagingPath
        })
        $completed = $true
        Write-GenerationLog -Context $Context -Message "生成完成；退出码：0；交付目录：$($state.DeliveryPath)"
        return [pscustomobject]@{ ExitCode = 0; DeliveryPath = $state.DeliveryPath; LogPath = $Context.LogPath }
    }
    finally {
        if ($completed -and -not $KeepSuccessfulWorkspace -and (Test-Path -LiteralPath $Context.WorkspacePath)) {
            $workspaceParent = Split-Path -Parent $Context.WorkspacePath
            $safeWorkspace = Assert-SafeChildPath -Root $workspaceParent -Candidate $Context.WorkspacePath
            Remove-Item -LiteralPath $safeWorkspace -Recurse -Force
        }
    }
}

function Invoke-GeneratorMain {
    param(
        [string]$GenerationMode,
        [string]$Theme,
        [string]$TemplateId,
        [switch]$NonInteractive,
        [pscustomobject]$CredentialDigests,
        [hashtable]$CredentialSecrets,
        [switch]$PreflightOnly,
        [switch]$KeepSuccessfulWorkspace,
        [hashtable]$StageOverrides,
        [scriptblock]$Reader,
        [scriptblock]$SecureReader,
        [scriptblock]$DigestInvoker
    )

    $context = $null
    $ownedSecrets = $null
    try {
        Import-Module (Join-Path $PSScriptRoot 'lib\Generator.Core.psm1') -Force -DisableNameChecking
        Import-Module (Join-Path $PSScriptRoot 'lib\GenerationInteraction.psm1') -Force -DisableNameChecking
        Import-Module (Join-Path $PSScriptRoot 'lib\StandardBusinessCatalog.psm1') -Force -DisableNameChecking
        $modeForPreflight = if ([string]::IsNullOrWhiteSpace($GenerationMode)) { 'StandardBusiness' } else { Resolve-GenerationMode -Mode $GenerationMode }
        if ($PreflightOnly) {
            if ([string]::IsNullOrWhiteSpace($Theme)) { throw 'Theme is required for prompt-free preflight.' }
            Import-Module (Join-Path $PSScriptRoot 'lib\Dependencies.psm1') -Force -DisableNameChecking
            if ($modeForPreflight -eq 'LegacyDemo') { Test-GeneratorDependencies | Format-List }
            else { Test-StandardBusinessDependencies | Format-List }
            return 0
        }
        $templates = @(Get-StandardBusinessTemplates)
        $request = Resolve-GenerationRequest -Mode $GenerationMode -Theme $Theme -TemplateId $TemplateId -Templates $templates -Reader $Reader -NonInteractive:$NonInteractive
        $generatorRoot = Split-Path -Parent $PSScriptRoot
        $context = New-GenerationContext -Theme $request.theme -GeneratorRoot $generatorRoot -Now (Get-Date)
        if ($request.mode -eq 'LegacyDemo') {
            $result = Invoke-GeneratorOrchestration -Context $context -StageOverrides $StageOverrides -KeepSuccessfulWorkspace:$KeepSuccessfulWorkspace
        }
        else {
            $context.Version = '1.0.0'
            if ($null -eq $CredentialDigests) {
                if ($NonInteractive) { throw 'CredentialDigests are required for non-interactive standard generation.' }
                Import-Module (Join-Path $PSScriptRoot 'lib\StandardBusinessCredentials.psm1') -Force -DisableNameChecking
                $bundle = Read-StandardBusinessCredentialBundle -SecureReader $SecureReader -DigestInvoker $DigestInvoker
                $CredentialDigests = $bundle.Digests
                $CredentialSecrets = $bundle.Secrets
                $ownedSecrets = $bundle.Secrets
            }
            Import-Module (Join-Path $PSScriptRoot 'lib\StandardBusinessOrchestrator.psm1') -Force -DisableNameChecking
            $result = Invoke-StandardBusinessOrchestration -Context $context -Template $request.template -CredentialDigests $CredentialDigests `
                -CredentialSecrets $CredentialSecrets -StageOverrides $StageOverrides -KeepSuccessfulWorkspace:$KeepSuccessfulWorkspace
        }
        Write-Host "生成完成：$($result.DeliveryPath)"
        Write-Host "日志：$($result.LogPath)"
        return 0
    }
    catch {
        $exitCode = 2
        if ($_.Exception.Data.Contains('GeneratorExitCode')) { $exitCode = [int]$_.Exception.Data['GeneratorExitCode'] }
        [Console]::Error.WriteLine($_.Exception.Message)
        if ($null -ne $context) {
            [Console]::Error.WriteLine("工作区已保留：$($context.WorkspacePath)")
            [Console]::Error.WriteLine("日志：$($context.LogPath)")
        }
        return $exitCode
    }
    finally {
        if ($null -ne $ownedSecrets) { foreach ($secret in $ownedSecrets.Values) { if ($null -ne $secret) { $secret.Dispose() } } }
    }
}

function Resolve-GeneratorTheme {
    param(
        [AllowEmptyString()][string]$Theme,
        [scriptblock]$ThemeReader
    )

    if (-not [string]::IsNullOrWhiteSpace($Theme)) { return $Theme }
    if ($null -eq $ThemeReader) {
        $ThemeReader = { param([string]$Prompt) Read-Host $Prompt }
    }
    $prompt = -join [char[]](0x8BF7, 0x8F93, 0x5165, 0x8F6F, 0x4EF6, 0x4E3B, 0x9898, 0xFF1A)
    return [string](& $ThemeReader $prompt)
}

if ($MyInvocation.InvocationName -ne '.') {
    exit (Invoke-GeneratorMain -GenerationMode $GenerationMode -Theme $Theme -TemplateId $TemplateId -NonInteractive:$NonInteractive `
        -CredentialDigests $CredentialDigests -CredentialSecrets $CredentialSecrets -PreflightOnly:$PreflightOnly `
        -KeepSuccessfulWorkspace:$KeepSuccessfulWorkspace -StageOverrides $StageOverrides)
}
