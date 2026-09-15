Set-StrictMode -Version Latest

function Normalize-SoftwareName {
    param([Parameter(Mandatory)][string]$Theme)

    $value = $Theme.Trim()
    if ($value.Length -eq 0) { throw '主题不能为空。' }
    if ($value.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0) {
        throw '主题包含 Windows 文件名非法字符。'
    }
    if (-not $value.EndsWith('软件', [StringComparison]::Ordinal)) { $value += '软件' }
    return $value
}

function Assert-SafeChildPath {
    param(
        [Parameter(Mandatory)][string]$Root,
        [Parameter(Mandatory)][string]$Candidate
    )

    $rootPath = [IO.Path]::GetFullPath($Root).TrimEnd('\')
    $candidatePath = [IO.Path]::GetFullPath($Candidate)
    if (-not $candidatePath.StartsWith($rootPath + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "路径必须位于 $rootPath 内。"
    }
    return $candidatePath
}

function New-GenerationContext {
    param(
        [Parameter(Mandatory)][string]$Theme,
        [Parameter(Mandatory)][string]$GeneratorRoot,
        [Parameter(Mandatory)][datetime]$Now
    )

    $rootPath = [IO.Path]::GetFullPath($GeneratorRoot)
    $softwareName = Normalize-SoftwareName $Theme
    $runId = '{0}-{1}' -f $Now.ToString('yyyyMMdd-HHmmss'), ([guid]::NewGuid().ToString('N').Substring(0, 8))

    [pscustomobject]@{
        Theme                 = $Theme.Trim()
        SoftwareName          = $softwareName
        Version               = '1.0'
        AppId                 = [guid]::NewGuid().ToString()
        RunId                 = $runId
        WorkspacePath         = Assert-SafeChildPath $rootPath (Join-Path $rootPath "engine\工作区\$runId")
        RequestedDeliveryPath = Assert-SafeChildPath $rootPath (Join-Path $rootPath "交付结果\$softwareName")
        LogPath               = Assert-SafeChildPath $rootPath (Join-Path $rootPath "engine\日志\$runId.log")
    }
}

function Initialize-ProjectWorkspace {
    param([Parameter(Mandatory)][pscustomobject]$Context)

    $workspacePath = [IO.Path]::GetFullPath($Context.WorkspacePath)
    if (Test-Path -LiteralPath $workspacePath) {
        throw "工作区已存在：$workspacePath"
    }

    $templatePath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\template'))
    if (-not (Test-Path -LiteralPath $templatePath -PathType Container)) {
        throw "模板目录不存在：$templatePath"
    }

    New-Item -ItemType Directory -Path $workspacePath -ErrorAction Stop | Out-Null
    Get-ChildItem -LiteralPath $templatePath -Force | Copy-Item -Destination $workspacePath -Recurse -Force

    $manifestPath = Join-Path $workspacePath 'project.json'
    $manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $manifestPath | ConvertFrom-Json
    $manifest.theme = $Context.Theme
    $manifest.softwareName = $Context.SoftwareName
    $manifest.version = $Context.Version
    $manifest.appId = $Context.AppId
    $manifest.routes = @('dashboard', 'records', 'operation', 'history')
    $manifest.createdAt = (Get-Date).ToUniversalTime().ToString('o')
    $manifest | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 -LiteralPath $manifestPath

    return $workspacePath
}

Export-ModuleMember -Function Normalize-SoftwareName, Assert-SafeChildPath, New-GenerationContext, Initialize-ProjectWorkspace

