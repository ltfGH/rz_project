Set-StrictMode -Version Latest

Import-Module (Join-Path $PSScriptRoot 'Generator.Core.psm1') -Force -DisableNameChecking

$script:StandardStages = @(
    'RecommendTemplate','CollectCredentials','BuildThemeProfile','ComposeDomain','AssembleResources','BuildDesktop',
    'VerifyDomain','VerifyPackagedWorkflow','CaptureDesktopScreenshots','BuildBusinessMaterials',
    'BuildWindowsInstaller','VerifyInstaller','PackageBusinessDelivery','Publish'
)

function ConvertTo-RedactedGenerationMessage {
    param([AllowEmptyString()][string]$Message, $Context)
    $value = $Message
    if ($null -ne $Context -and -not [string]::IsNullOrWhiteSpace([string]$Context.WorkspacePath)) { $value = $value.Replace([string]$Context.WorkspacePath, '<workspace>') }
    $value = [regex]::Replace($value, '(?i)(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})', '<redacted-token>')
    $value = [regex]::Replace($value, '(?i)(password|token)\s*[:=]\s*\S+', '$1=<redacted>')
    return $value
}

function Write-StandardGenerationLog {
    param([Parameter(Mandatory)]$Context, [Parameter(Mandatory)][string]$Message, [switch]$Initialize)
    $directory = Split-Path -Parent ([string]$Context.LogPath)
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $safe = ConvertTo-RedactedGenerationMessage -Message $Message -Context $Context
    $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'),$safe
    if ($Initialize) {
        $header = "主题：$($Context.Theme)`r`n运行编号：$($Context.RunId)`r`n$line`r`n"
        [IO.File]::WriteAllText($Context.LogPath,$header,[Text.UTF8Encoding]::new($true))
    } else { [IO.File]::AppendAllText($Context.LogPath,$line+"`r`n",[Text.UTF8Encoding]::new($false)) }
}

function Invoke-StandardStage {
    param([string]$Name,$State,[hashtable]$StageOverrides)
    Write-StandardGenerationLog -Context $State.Context -Message "[开始] $Name"
    try {
        if ($null -ne $StageOverrides -and $StageOverrides.ContainsKey($Name)) { $result = & $StageOverrides[$Name] $State }
        else { $result = Invoke-StandardDefaultAction -Stage $Name -State $State }
        Write-StandardGenerationLog -Context $State.Context -Message "[通过] $Name"
        return $result
    }
    catch {
        Write-StandardGenerationLog -Context $State.Context -Message "[失败] $Name；退出码：1；原因：$($_.Exception.Message)"
        $_.Exception.Data['GeneratorExitCode']=1; $_.Exception.Data['GeneratorStage']=$Name
        throw
    }
}

function Invoke-CheckedNative {
    param([string]$WorkingDirectory,[string]$Command,[string[]]$Arguments,[string]$FailureMessage)
    Push-Location $WorkingDirectory
    try {
        $nativeOutput = (& $Command @Arguments 2>&1 | Out-String)
        if ($LASTEXITCODE -ne 0) { throw "$FailureMessage $($nativeOutput.Trim())" }
        if (-not [string]::IsNullOrWhiteSpace($nativeOutput)) { Write-Host $nativeOutput.Trim() }
    } finally { Pop-Location }
}

function Get-StandardExecutable {
    param([string]$DesktopBuildPath)
    $application = Get-ChildItem -LiteralPath (Join-Path $DesktopBuildPath 'installers\win-unpacked') -Filter '*.exe' -File | Where-Object Name -NotLike 'Uninstall*' | Select-Object -First 1
    if ($null -eq $application) { throw 'Packaged standard executable was not found.' }
    return $application
}

function Invoke-StandardDefaultAction {
    param([Parameter(Mandatory)][string]$Stage,[Parameter(Mandatory)]$State)
    $engineRoot = Split-Path -Parent $PSScriptRoot
    $generatorRoot = Split-Path -Parent $engineRoot
    $desktopRoot = Join-Path $engineRoot 'desktop-runtime'
    switch ($Stage) {
        'RecommendTemplate' {
            if ([string]::IsNullOrWhiteSpace([string]$State.Template.id)) { throw 'A confirmed standard template is required.' }
            return [pscustomobject]@{ status='passed'; templateId=[string]$State.Template.id }
        }
        'CollectCredentials' {
            $names=@($State.CredentialDigests.PSObject.Properties.Name|Sort-Object)
            if (($names -join ',') -cne 'administrator,dispatcher,operator,reviewer') { throw 'Exactly four credential digests are required.' }
            foreach($name in $names){ if([string]$State.CredentialDigests.$name -notmatch '^scrypt\$16384\$8\$1\$'){throw "Credential digest is invalid for role '$name'."} }
            return [pscustomobject]@{ status='passed'; roles=$names }
        }
        'BuildThemeProfile' {
            Import-Module (Join-Path $PSScriptRoot 'Dependencies.psm1') -Force -DisableNameChecking
            Import-Module (Join-Path $PSScriptRoot 'ThemeProfile.psm1') -Force -DisableNameChecking
            $State.Dependencies=Test-StandardBusinessDependencies
            return Invoke-ThemeProfileGeneration -Context $State.Context -Template $State.Template -CodexPath $State.Dependencies.CodexPath
        }
        'ComposeDomain' {
            $profile=$State.Profile.Profile
            $softwareId=('generated_'+[string]$State.Template.id)
            $request=[ordered]@{
                templateId=[string]$State.Template.id; appId=[string]$State.Context.AppId
                software=[ordered]@{ id=$softwareId; name=[string]$profile.softwareName; version='1.0.0'; purpose=[string]$profile.purpose; targetUsers=@($State.Template.roles); boundaries=@('离线桌面运行','不连接外部业务系统'); loginMode='required' }
                profile=$profile; passwordDigests=$State.CredentialDigests
                seed=[ordered]@{ value=20260921; businessRows=1000; baseline='2026-09-21T00:00:00.000Z' }
            }
            $requestPath=Join-Path $State.Context.WorkspacePath 'standard-project-request.json'
            [IO.File]::WriteAllText($requestPath,($request|ConvertTo-Json -Depth 20),[Text.UTF8Encoding]::new($false))
            Copy-Item -LiteralPath $State.Profile.Path -Destination (Join-Path $State.Context.WorkspacePath 'theme-profile.json')
            return [pscustomobject]@{ status='passed'; requestPath=$requestPath }
        }
        'AssembleResources' {
            $output=Join-Path $State.Context.WorkspacePath 'resources'
            Invoke-CheckedNative -WorkingDirectory $desktopRoot -Command 'node' -Arguments @('tools/build-standard-resources.cjs','--request',$State.Composition.requestPath,'--output',$output) -FailureMessage 'Standard resource assembly failed.'
            return [pscustomobject]@{
                status='passed'; resourcesPath=$output
                blueprint=(Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $output 'blueprint.json')|ConvertFrom-Json)
                domainLock=(Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $output 'domain-lock.json')|ConvertFrom-Json)
                projectLock=(Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $output 'project.lock.json')|ConvertFrom-Json)
                resourceManifest=(Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $output 'resource-manifest.json')|ConvertFrom-Json)
            }
        }
        'BuildDesktop' {
            Invoke-CheckedNative -WorkingDirectory $desktopRoot -Command 'npm.cmd' -Arguments @('run','build') -FailureMessage 'Desktop runtime build failed.'
            $output=Join-Path $State.Context.WorkspacePath 'desktop-build'
            & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $desktopRoot 'tools\build-standard-desktop.ps1') -RequestPath $State.Composition.requestPath -OutputRoot $output | Out-Host
            if($LASTEXITCODE-ne 0){throw 'Standard desktop packaging failed.'}
            $receipt=Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $output 'build-receipt.json')|ConvertFrom-Json
            return [pscustomobject]@{ status='passed'; path=$output; receipt=$receipt }
        }
        'VerifyDomain' {
            Invoke-CheckedNative -WorkingDirectory $desktopRoot -Command 'npm.cmd' -Arguments @('run','typecheck') -FailureMessage 'Desktop typecheck failed.'
            Invoke-CheckedNative -WorkingDirectory $desktopRoot -Command 'npm.cmd' -Arguments @('run','test:unit') -FailureMessage 'Desktop unit tests failed.'
            Invoke-CheckedNative -WorkingDirectory $desktopRoot -Command 'npm.cmd' -Arguments @('run','test:integration') -FailureMessage 'Desktop integration tests failed.'
            $unpacked=Join-Path $State.DesktopBuild.path 'installers\win-unpacked'
            Invoke-CheckedNative -WorkingDirectory $desktopRoot -Command 'node' -Arguments @('tools/verify-package.cjs','--unpacked',$unpacked) -FailureMessage 'Packaged application verification failed.'
            $executable=Get-StandardExecutable $State.DesktopBuild.path
            $manifest=Join-Path $unpacked 'resources\runtime-resources\resource-manifest.json'
            return [pscustomobject]@{
                status='passed'; executableSha256=(Get-FileHash $executable.FullName -Algorithm SHA256).Hash.ToLowerInvariant(); resourceManifestSha256=(Get-FileHash $manifest -Algorithm SHA256).Hash.ToLowerInvariant()
                blueprintSha256=(Get-FileHash (Join-Path $State.Resources.resourcesPath 'blueprint.json') -Algorithm SHA256).Hash.ToLowerInvariant(); domainLockSha256=(Get-FileHash (Join-Path $State.Resources.resourcesPath 'domain-lock.json') -Algorithm SHA256).Hash.ToLowerInvariant()
            }
        }
        'VerifyPackagedWorkflow' {
            $executable=Get-StandardExecutable $State.DesktopBuild.path
            if($null-eq $State.CredentialSecrets){throw 'Secure credentials are required for packaged workflow verification.'}
            Import-Module (Join-Path $PSScriptRoot 'StandardBusinessCredentials.psm1') -Force -DisableNameChecking
            $receiptPath=Join-Path $State.Context.WorkspacePath 'acceptance-report.json'
            $names=@('RZ_E2E_EXECUTABLE_PATH','RZ_E2E_RECEIPT_PATH','RZ_E2E_TEMPLATE_ID');$previous=@{}
            foreach($name in $names){$previous[$name]=[Environment]::GetEnvironmentVariable($name)}
            try{
                $env:RZ_E2E_EXECUTABLE_PATH=$executable.FullName;$env:RZ_E2E_RECEIPT_PATH=$receiptPath;$env:RZ_E2E_TEMPLATE_ID=[string]$State.Template.id
                Use-StandardBusinessCredentialEnvironment -CredentialSecrets $State.CredentialSecrets -Action {
                    Invoke-CheckedNative -WorkingDirectory $desktopRoot -Command 'npx.cmd' -Arguments @('playwright','test','tests/e2e/standard-template-smoke.spec.ts') -FailureMessage 'Packaged standard workflow verification failed.'
                }
            }finally{foreach($name in $names){[Environment]::SetEnvironmentVariable($name,$previous[$name])}}
            $receipt=Get-Content -Raw -Encoding UTF8 -LiteralPath $receiptPath|ConvertFrom-Json
            if([string]$receipt.executableSha256-cne[string]$State.DomainReceipt.executableSha256-or[string]$receipt.resourceManifestSha256-cne[string]$State.DomainReceipt.resourceManifestSha256){throw 'Packaged workflow receipt hash mismatch.'}
            return $receipt
        }
        'CaptureDesktopScreenshots' {
            $executable=Get-StandardExecutable $State.DesktopBuild.path
            $output=Join-Path $State.Context.WorkspacePath 'screenshots'
            if($null-eq $State.CredentialSecrets){throw 'Secure credentials are required for screenshot capture.'}
            Import-Module (Join-Path $PSScriptRoot 'StandardBusinessCredentials.psm1') -Force -DisableNameChecking
            Use-StandardBusinessCredentialEnvironment -CredentialSecrets $State.CredentialSecrets -Action {
                & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $desktopRoot 'tools\capture-standard-screenshots.ps1') -ExecutablePath $executable.FullName -BlueprintPath (Join-Path $State.Resources.resourcesPath 'blueprint.json') -OutputDirectory $output | Out-Host
                if($LASTEXITCODE-ne 0){throw 'Standard desktop screenshot capture failed.'}
            }
            return Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $output 'screenshot-manifest.json')|ConvertFrom-Json
        }
        'BuildBusinessMaterials' {
            Import-Module (Join-Path $PSScriptRoot 'StandardBusinessSource.psm1') -Force -DisableNameChecking
            Import-Module (Join-Path $PSScriptRoot 'StandardBusinessMaterials.psm1') -Force -DisableNameChecking
            $sourceManifestPath=Join-Path $State.Context.WorkspacePath 'source-manifest.json'
            $sourceManifest=Get-StandardSourceManifest -RepositoryRoot $generatorRoot -Template $State.Template -OutputPath $sourceManifestPath
            $materialOutput=Join-Path $State.Context.WorkspacePath 'materials'
            $built=Build-StandardBusinessMaterials -OutputDirectory $materialOutput -Blueprint $State.Resources.blueprint -Template $State.Template -Profile $State.Profile.Profile `
                -ProjectLock $State.Resources.projectLock -ScreenshotManifest $State.ScreenshotManifest -SourceManifest $sourceManifest -VerificationReceipt $State.AcceptanceReceipt `
                -RepositoryRoot $generatorRoot -ScreenshotRoot (Join-Path $State.Context.WorkspacePath 'screenshots')
            $State.SourceManifest=$sourceManifest
            $State.MaterialReceipt=[pscustomobject]@{status='passed';executableSha256=$State.DomainReceipt.executableSha256;resourceManifestSha256=$State.DomainReceipt.resourceManifestSha256;sourceManifestSha256=$sourceManifest.sha256}
            return $built
        }
        'BuildWindowsInstaller' {
            $installer=Get-ChildItem -LiteralPath (Join-Path $State.DesktopBuild.path 'installers') -Filter '*安装包.exe' -File|Select-Object -First 1
            if($null-eq $installer){throw 'Windows installer was not produced.'}; return $installer
        }
        'VerifyInstaller' {
            & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $desktopRoot 'tools\verify-installer.ps1') -InstallerPath $State.Installer.FullName | Out-Host
            if($LASTEXITCODE-ne 0){throw 'Installer lifecycle verification failed.'}
            $receiptPath=Join-Path $desktopRoot 'dist\reports\installer-verification.json'
            $receipt=Get-Content -Raw -Encoding UTF8 -LiteralPath $receiptPath|ConvertFrom-Json
            if([string]$receipt.executableSha256-cne[string]$State.DomainReceipt.executableSha256-or[string]$receipt.resourceManifestSha256-cne[string]$State.DomainReceipt.resourceManifestSha256){throw 'Installer verification receipt hash mismatch.'}
            return $receipt
        }
        'PackageBusinessDelivery' {
            Import-Module (Join-Path $PSScriptRoot 'StandardBusinessPublisher.psm1') -Force -DisableNameChecking
            $generated=@{
                'standard-project-request.json'=$State.Composition.requestPath;'theme-profile.json'=(Join-Path $State.Context.WorkspacePath 'theme-profile.json')
                'blueprint.json'=(Join-Path $State.Resources.resourcesPath 'blueprint.json');'domain-lock.json'=(Join-Path $State.Resources.resourcesPath 'domain-lock.json')
                'project.lock.json'=(Join-Path $State.Resources.resourcesPath 'project.lock.json');'resource-manifest.json'=(Join-Path $State.Resources.resourcesPath 'resource-manifest.json')
            }
            $sourceArchive=New-StandardSourceArchive -Context $State.Context -RepositoryRoot $generatorRoot -SourceManifest $State.SourceManifest -SourceManifestPath (Join-Path $State.Context.WorkspacePath 'source-manifest.json') -GeneratedFiles $generated
            $artifactRoot=Join-Path $State.Context.WorkspacePath 'delivery-artifacts';New-Item -ItemType Directory -Path $artifactRoot|Out-Null
            $copyMap=[ordered]@{
                $State.Installer.FullName="$($State.Context.SoftwareName) V$($State.Context.Version) 安装包.exe"
                (Join-Path $State.Context.WorkspacePath 'materials\documents\manual.docx')="$($State.Context.SoftwareName)-操作手册.docx"
                (Join-Path $State.Context.WorkspacePath 'materials\documents\manual.pdf')="$($State.Context.SoftwareName)-操作手册.pdf"
                (Join-Path $State.Context.WorkspacePath 'materials\documents\source.docx')="$($State.Context.SoftwareName)-源码.docx"
                (Join-Path $State.Context.WorkspacePath 'materials\documents\source.pdf')="$($State.Context.SoftwareName)-源码.pdf"
                (Join-Path $State.Context.WorkspacePath 'materials\documents\application-info.docx')="$($State.Context.SoftwareName)-申请表.docx"
                (Join-Path $State.Context.WorkspacePath 'materials\documents\application-info.pdf')="$($State.Context.SoftwareName)-申请表.pdf"
                (Join-Path $State.Context.WorkspacePath 'materials\documents\runtime.docx')="$($State.Context.SoftwareName)-运行环境.docx"
                (Join-Path $State.Context.WorkspacePath 'materials\documents\prototype.docx')="$($State.Context.SoftwareName)-原型设计图.docx"
                (Join-Path $State.Resources.resourcesPath 'blueprint.json')='业务蓝图.json';(Join-Path $State.Resources.resourcesPath 'domain-lock.json')='领域版本锁.json'
                (Join-Path $State.Context.WorkspacePath 'acceptance-report.json')='验收报告.json'
            }
            $artifacts=[Collections.Generic.List[IO.FileInfo]]::new()
            foreach($source in $copyMap.Keys){if(-not(Test-Path -LiteralPath $source -PathType Leaf)){throw "Delivery artifact is missing: $source"};$target=Join-Path $artifactRoot $copyMap[$source];Copy-Item -LiteralPath $source -Destination $target;$artifacts.Add((Get-Item $target))}
            $artifacts.Add($sourceArchive)
            $receipts=[pscustomobject]@{Installer=$State.InstallerReceipt;Package=$State.DomainReceipt;E2E=$State.AcceptanceReceipt;Materials=$State.MaterialReceipt}
            $staging=New-StandardDeliveryStaging -Context $State.Context -Artifacts $artifacts.ToArray() -Receipts $receipts -SourceManifest $State.SourceManifest
            return [pscustomobject]@{StagingPath=$staging;SourceArchive=$sourceArchive}
        }
        'Publish' {
            Import-Module (Join-Path $PSScriptRoot 'StandardBusinessPublisher.psm1') -Force -DisableNameChecking
            return Publish-StandardDelivery -Context $State.Context -StagingPath $State.StagingPath
        }
        default { throw "Unknown standard stage '$Stage'." }
    }
}

function Invoke-StandardBusinessOrchestration {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]$Context,[Parameter(Mandatory)]$Template,[Parameter(Mandatory)]$CredentialDigests,
        [hashtable]$CredentialSecrets,[hashtable]$StageOverrides,[switch]$KeepSuccessfulWorkspace
    )
    $state=[pscustomobject]@{
        Context=$Context; Template=$Template; CredentialDigests=$CredentialDigests; CredentialSecrets=$CredentialSecrets
        Dependencies=$null; Recommendation=$null; CredentialReceipt=$null; Profile=$null; Composition=$null; Resources=$null; DesktopBuild=$null
        DomainReceipt=$null; AcceptanceReceipt=$null; ScreenshotManifest=$null; Materials=$null; MaterialReceipt=$null; Installer=$null; InstallerReceipt=$null
        SourceManifest=$null; SourceArchive=$null; StagingPath=$null; DeliveryPath=$null
    }
    Write-StandardGenerationLog -Context $Context -Message '标准业务生成任务已创建。' -Initialize
    $completed=$false
    try {
        foreach($stage in $script:StandardStages){
            if($stage-eq 'BuildThemeProfile' -and -not(Test-Path -LiteralPath $Context.WorkspacePath)) { New-Item -ItemType Directory -Path $Context.WorkspacePath -Force|Out-Null }
            $result=Invoke-StandardStage -Name $stage -State $state -StageOverrides $StageOverrides
            switch($stage){
                'RecommendTemplate'{$state.Recommendation=$result};'CollectCredentials'{$state.CredentialReceipt=$result}
                'BuildThemeProfile'{
                    $state.Profile=$result
                    if($null-ne $result.PSObject.Properties['Profile']-and $null-ne $result.Profile){
                        $softwareName=Normalize-SoftwareName ([string]$result.Profile.softwareName)
                        $state.Context.SoftwareName=$softwareName
                        $deliveryRoot=Split-Path -Parent $state.Context.RequestedDeliveryPath
                        $state.Context.RequestedDeliveryPath=Assert-SafeChildPath -Root $deliveryRoot -Candidate (Join-Path $deliveryRoot $softwareName)
                    }
                }
                'ComposeDomain'{$state.Composition=$result};'AssembleResources'{$state.Resources=$result;$state.CredentialDigests=$null};'BuildDesktop'{$state.DesktopBuild=$result}
                'VerifyDomain'{$state.DomainReceipt=$result};'VerifyPackagedWorkflow'{$state.AcceptanceReceipt=$result};'CaptureDesktopScreenshots'{$state.ScreenshotManifest=$result}
                'BuildBusinessMaterials'{$state.Materials=$result};'BuildWindowsInstaller'{$state.Installer=$result};'VerifyInstaller'{$state.InstallerReceipt=$result}
                'PackageBusinessDelivery'{$state.StagingPath=if($result-is[string]){$result}else{$result.StagingPath};$state.SourceArchive=if($result-isnot[string]){$result.SourceArchive}else{$null}}
                'Publish'{$state.DeliveryPath=[string]$result}
            }
        }
        $completed=$true
        Write-StandardGenerationLog -Context $Context -Message "生成完成；退出码：0；交付目录：$($state.DeliveryPath)"
        return [pscustomobject]@{ExitCode=0;DeliveryPath=$state.DeliveryPath;LogPath=$Context.LogPath}
    }
    finally {
        if($completed-and-not $KeepSuccessfulWorkspace-and(Test-Path -LiteralPath $Context.WorkspacePath)){
            $parent=Split-Path -Parent $Context.WorkspacePath;$safe=Assert-SafeChildPath -Root $parent -Candidate $Context.WorkspacePath;Remove-Item -LiteralPath $safe -Recurse -Force
        }
    }
}

Export-ModuleMember -Function Invoke-StandardBusinessOrchestration
