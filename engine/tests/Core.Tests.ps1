. "$PSScriptRoot\Assert.ps1"
$ErrorActionPreference = 'Stop'
Import-Module "$PSScriptRoot\..\lib\Generator.Core.psm1" -Force -DisableNameChecking

Assert-Equal (Normalize-SoftwareName '仓库消防巡检管理') '仓库消防巡检管理软件'
Assert-Equal (Normalize-SoftwareName '仓库消防巡检管理软件') '仓库消防巡检管理软件'
Assert-Throws { Normalize-SoftwareName '  ' } '主题不能为空'
Assert-Throws { Normalize-SoftwareName '仓库/巡检' } '非法字符'

$root = [IO.Path]::GetFullPath((Join-Path $env:TEMP 'generator-root'))
Assert-Throws { Assert-SafeChildPath $root (Join-Path $root '..\outside') } '必须位于'

$context = New-GenerationContext '仓库消防巡检管理' 'D:\generator' ([datetime]'2026-08-28T12:34:56')
Assert-Equal $context.SoftwareName '仓库消防巡检管理软件'
Assert-Equal $context.Version '1.0'
Assert-Match $context.RunId '^20260828-123456-[0-9a-f]{8}$'

$generateScript = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\Generate.ps1'))
$invalidThemeProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', $generateScript,
    '-Theme', '仓库/巡检'
) -Wait -PassThru -WindowStyle Hidden
Assert-Equal $invalidThemeProcess.ExitCode 2

$workspaceTestRoot = Join-Path $env:TEMP ("generator-workspace-test-{0}" -f [guid]::NewGuid().ToString('N'))
try {
    $firstContext = New-GenerationContext '仓库消防巡检管理' $workspaceTestRoot ([datetime]'2026-08-28T13:00:00')
    $secondContext = New-GenerationContext '设备维护管理' $workspaceTestRoot ([datetime]'2026-08-28T13:00:01')
    $templateRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\template'))
    $templateBeforeRuns = Get-ChildItem -LiteralPath $templateRoot -Recurse -File |
        Sort-Object FullName |
        ForEach-Object { "{0}`n{1}" -f $_.FullName, (Get-Content -Raw -Encoding UTF8 -LiteralPath $_.FullName) }

    $firstWorkspace = Initialize-ProjectWorkspace $firstContext
    Assert-Equal $firstWorkspace $firstContext.WorkspacePath
    Assert-Equal (Test-Path -LiteralPath (Join-Path $firstWorkspace 'app\index.html') -PathType Leaf) $true

    $manifest = Get-Content -Raw -Encoding UTF8 (Join-Path $firstWorkspace 'project.json') | ConvertFrom-Json
    Assert-Equal $manifest.theme $firstContext.Theme
    Assert-Equal $manifest.softwareName $firstContext.SoftwareName
    Assert-Equal $manifest.version '1.0'
    Assert-Equal $manifest.appId $firstContext.AppId
    Assert-Equal ($manifest.routes -join ',') 'dashboard,records,operation,history'
    Assert-Match $manifest.createdAt '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}'

    $workspaceText = Get-ChildItem -LiteralPath $firstWorkspace -Recurse -File |
        ForEach-Object { Get-Content -Raw -Encoding UTF8 -LiteralPath $_.FullName }
    Assert-Equal (($workspaceText -join "`n") -match '实验室耗材') $false

    $manifestBeforeRetry = Get-Content -Raw -Encoding UTF8 (Join-Path $firstWorkspace 'project.json')
    Assert-Throws { Initialize-ProjectWorkspace $firstContext } '已存在'
    Assert-Equal (Get-Content -Raw -Encoding UTF8 (Join-Path $firstWorkspace 'project.json')) $manifestBeforeRetry

    $secondWorkspace = Initialize-ProjectWorkspace $secondContext
    $secondManifest = Get-Content -Raw -Encoding UTF8 (Join-Path $secondWorkspace 'project.json') | ConvertFrom-Json
    $templateAfterRuns = Get-ChildItem -LiteralPath $templateRoot -Recurse -File |
        Sort-Object FullName |
        ForEach-Object { "{0}`n{1}" -f $_.FullName, (Get-Content -Raw -Encoding UTF8 -LiteralPath $_.FullName) }

    Assert-Equal ($secondWorkspace -cne $firstWorkspace) $true
    Assert-Equal ($secondContext.AppId -cne $firstContext.AppId) $true
    Assert-Equal $secondManifest.appId $secondContext.AppId
    Assert-Equal ($templateAfterRuns -join "`n") ($templateBeforeRuns -join "`n")
}
finally {
    if (Test-Path -LiteralPath $workspaceTestRoot) {
        Remove-Item -LiteralPath $workspaceTestRoot -Recurse -Force
    }
}

