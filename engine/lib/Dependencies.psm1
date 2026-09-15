Set-StrictMode -Version Latest

$engineRoot = Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $PSScriptRoot 'Generator.Core.psm1') -Force -DisableNameChecking

function Resolve-CommandPath {
    param([Parameter(Mandatory)][string]$Name)

    $command = Get-Command -Name $Name -ErrorAction SilentlyContinue
    if ($null -eq $command) { return $null }
    if (-not [string]::IsNullOrWhiteSpace($command.Path)) { return [IO.Path]::GetFullPath($command.Path) }
    if (-not [string]::IsNullOrWhiteSpace($command.Source)) { return [IO.Path]::GetFullPath($command.Source) }
    return $null
}

function Resolve-EdgePath {
    $candidates = @(
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return [IO.Path]::GetFullPath($candidate)
        }
    }
    return $null
}

function Test-WordProbe {
    $word = $null
    try {
        $word = New-Object -ComObject Word.Application
        return (Join-Path $word.Path 'WINWORD.EXE')
    }
    catch {
        return $null
    }
    finally {
        if ($null -ne $word) {
            try { $word.Quit() } catch { }
        }
    }
}

function Resolve-InnoSetupPath {
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'),
        (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe')
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return [IO.Path]::GetFullPath($candidate)
        }
    }
    return $null
}

function Format-DependencyStatus {
    param([string]$Name, [string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) { return "$Name=缺失" }
    return "$Name=$Path"
}

function Install-VerifiedInnoSetup {
    param([Parameter(Mandatory)][string]$CacheRoot)

    $safeCacheRoot = Assert-SafeChildPath $engineRoot $CacheRoot
    New-Item -ItemType Directory -Path $safeCacheRoot -Force | Out-Null
    $config = Get-Content -LiteralPath (Join-Path $engineRoot 'config\dependencies.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $installerPath = Assert-SafeChildPath $safeCacheRoot (Join-Path $safeCacheRoot "innosetup-$($config.innoSetup.version).exe")

    try {
        Invoke-WebRequest -Uri $config.innoSetup.url -OutFile $installerPath
        $signature = Get-AuthenticodeSignature -FilePath $installerPath
        $subject = [string]$signature.SignerCertificate.Subject
        if ($signature.Status -ne 'Valid' -or -not $subject.Contains($config.innoSetup.publisherSubjectContains)) {
            throw 'Inno Setup 安装包签名无效或发布者不匹配。'
        }

        $process = Start-Process -FilePath $installerPath -ArgumentList @($config.innoSetup.installArguments) -Wait -PassThru -WindowStyle Hidden
        if ($process.ExitCode -ne 0) { throw "Inno Setup 安装失败，退出码：$($process.ExitCode)。" }
    }
    catch {
        if (Test-Path -LiteralPath $installerPath) {
            Remove-Item -LiteralPath $installerPath -Force
        }
        throw
    }

    $isccPath = Resolve-InnoSetupPath
    if ([string]::IsNullOrWhiteSpace($isccPath)) { throw 'Inno Setup 安装后未找到 ISCC.exe。' }
    return $isccPath
}

function Test-GeneratorDependencies {
    param(
        [switch]$AllowInnoInstall,
        [scriptblock]$CommandResolver,
        [scriptblock]$WordProbe,
        [scriptblock]$InnoResolver
    )

    if ($null -eq $CommandResolver) {
        $CommandResolver = {
            param([string]$Name)
            if ($Name -eq 'edge') { return Resolve-EdgePath }
            return Resolve-CommandPath $Name
        }
    }
    if ($null -eq $WordProbe) { $WordProbe = { Test-WordProbe } }
    if ($null -eq $InnoResolver) { $InnoResolver = { Resolve-InnoSetupPath } }

    $codexPath = & $CommandResolver 'codex'
    $nodePath = & $CommandResolver 'node'
    $edgePath = & $CommandResolver 'edge'
    $wordPath = & $WordProbe
    $isccPath = & $InnoResolver

    $missing = @()
    if ([string]::IsNullOrWhiteSpace($codexPath)) { $missing += 'codex' }
    if ([string]::IsNullOrWhiteSpace($nodePath)) { $missing += 'node' }
    if ([string]::IsNullOrWhiteSpace($edgePath)) { $missing += 'Microsoft Edge' }
    if ([string]::IsNullOrWhiteSpace($wordPath)) { $missing += 'Microsoft Word' }
    if ([string]::IsNullOrWhiteSpace($isccPath) -and -not $AllowInnoInstall) { $missing += 'Inno Setup' }
    if ($missing.Count -gt 0) {
        $status = @(
            (Format-DependencyStatus 'codex' $codexPath),
            (Format-DependencyStatus 'node' $nodePath),
            (Format-DependencyStatus 'Microsoft Edge' $edgePath),
            (Format-DependencyStatus 'Microsoft Word' $wordPath),
            (Format-DependencyStatus 'Inno Setup' $isccPath)
        ) -join '; '
        throw "缺少依赖：$($missing -join '、')。预检状态：$status"
    }
    if ([string]::IsNullOrWhiteSpace($isccPath)) {
        $isccPath = Install-VerifiedInnoSetup (Join-Path $engineRoot '工作区\依赖缓存')
    }

    [pscustomobject]@{
        CodexPath = [IO.Path]::GetFullPath($codexPath)
        NodePath  = [IO.Path]::GetFullPath($nodePath)
        EdgePath  = [IO.Path]::GetFullPath($edgePath)
        WordPath  = [IO.Path]::GetFullPath($wordPath)
        ISCCPath  = [IO.Path]::GetFullPath($isccPath)
    }
}

Export-ModuleMember -Function Test-GeneratorDependencies, Install-VerifiedInnoSetup


