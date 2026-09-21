. "$PSScriptRoot\Assert.ps1"
$ErrorActionPreference = 'Stop'

$materialsModule = Join-Path $PSScriptRoot '..\lib\StandardBusinessMaterials.psm1'
$sourceModule = Join-Path $PSScriptRoot '..\lib\StandardBusinessSource.psm1'
Import-Module $materialsModule -Force -DisableNameChecking
Import-Module $sourceModule -Force -DisableNameChecking

$fixtureRoot = Join-Path $env:TEMP ('standard-materials-test-' + [guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Path (Join-Path $fixtureRoot 'engine\desktop-runtime\src') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $fixtureRoot 'engine\domain-packs\packs\asset_registry') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $fixtureRoot 'engine\domain-packs\packs\inventory_batch') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $fixtureRoot 'engine\desktop-runtime\node_modules\ignored') -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $fixtureRoot 'engine\desktop-runtime\src\runtime.ts'), "export const runtime = true;`n", [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $fixtureRoot 'engine\domain-packs\packs\asset_registry\index.ts'), "export const asset = true;`n", [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $fixtureRoot 'engine\domain-packs\packs\inventory_batch\index.ts'), "export const inventory = true;`n", [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $fixtureRoot 'engine\desktop-runtime\node_modules\ignored\index.js'), "throw new Error('ignored');`n", [Text.UTF8Encoding]::new($false))

    $template = [pscustomobject]@{ id = 'asset_work_order_operations'; packs = @('asset_registry') }
    $manifestPath = Join-Path $fixtureRoot 'source-manifest.json'
    $manifest = Get-StandardSourceManifest -RepositoryRoot $fixtureRoot -Template $template -OutputPath $manifestPath
    Assert-Equal $manifest.files.Count 2
    Assert-Equal (($manifest.files.path | Sort-Object) -join ',') 'engine/desktop-runtime/src/runtime.ts,engine/domain-packs/packs/asset_registry/index.ts'
    Assert-Equal ($manifest.files.path -contains 'engine/domain-packs/packs/inventory_batch/index.ts') $false
    Assert-Equal ($manifest.totalLines -gt 0) $true
    Assert-Match $manifest.sha256 '^[0-9a-f]{64}$'

    $blueprint = [pscustomobject]@{
        software = [pscustomobject]@{ name = '园区资产工单软件'; version = '1.0.0'; purpose = '管理园区资产与工单闭环'; boundaries = @('离线桌面运行') }
        modules = @(
            [pscustomobject]@{ id = 'assets'; name = '资产台账'; entity = 'asset'; route = 'assets'; actions = @('list','view','change_status') },
            [pscustomobject]@{ id = 'work_orders'; name = '工单管理'; entity = 'work_order'; route = 'work_orders'; actions = @('list','view','dispatch','accept','review') }
        )
        workflows = @([pscustomobject]@{ id = 'work_order_lifecycle'; name = '工单闭环'; states = @('pending','closed') })
        roles = @(
            [pscustomobject]@{ id = 'operations_dispatcher'; name = '调度人员'; permissions = @('work_orders.dispatch') },
            [pscustomobject]@{ id = 'operations_admin'; name = '系统管理员'; permissions = @('assets.list','assets.change_status','work_orders.list') }
        )
        materials = [pscustomobject]@{ industry = '园区运维'; technicalFeatures = @('Electron离线运行','SQLite事务') }
    }
    $plan = @(Get-StandardScreenshotPlan -Blueprint $blueprint)
    Assert-Equal $plan[0].kind 'dashboard'
    Assert-Equal (@($plan | Where-Object kind -eq 'list').Count -gt 0) $true
    Assert-Equal (@($plan | Where-Object kind -eq 'detail').Count -gt 0) $true
    Assert-Equal (@($plan | Where-Object kind -eq 'action').Count -gt 0) $true
    $actionCapture = @($plan | Where-Object kind -eq 'action')[0]
    Assert-Equal $actionCapture.roleId 'operations_admin'
    Assert-Equal (@($plan | Where-Object moduleId -eq 'inventory_batches').Count) 0

    $screenshots = @($plan | ForEach-Object {
        [pscustomobject]@{ id = $_.id; kind = $_.kind; moduleId = $_.moduleId; actionId = $_.actionId; path = ($_.id + '.png'); sha256 = ('a' * 64) }
    })
    $outputRoot = Join-Path $fixtureRoot 'materials-output'
    $result = Build-StandardBusinessMaterials -OutputDirectory $outputRoot -Blueprint $blueprint `
        -Template $template -Profile ([pscustomobject]@{ softwareName='园区资产工单软件'; purpose='管理园区资产与工单闭环'; industry='园区运维' }) `
        -ProjectLock ([pscustomobject]@{ desktopRuntimeVersion='1.0.0'; electronVersion='44.4.1'; databaseSchemaVersion=1 }) `
        -ScreenshotManifest ([pscustomobject]@{ captures=$screenshots }) -SourceManifest $manifest `
        -VerificationReceipt ([pscustomobject]@{ status='passed'; businessRows=1000 }) -SkipDocumentExport

    Assert-Equal $result.html.Count 4
    $allHtml = ($result.html | ForEach-Object { Get-Content -Raw -Encoding utf8 -LiteralPath $_ }) -join "`n"
    Assert-Match $allHtml '资产台账'
    Assert-Match $allHtml '工单管理'
    Assert-Equal ($allHtml -match '库存批次') $false
    Assert-Match $allHtml '【申请人填写】'
    Assert-Match $allHtml '【生成时按实际源码统计填写】'
    Assert-Equal ($allHtml -match [regex]::Escape($fixtureRoot)) $false
    Assert-Equal ($allHtml -match 'ghp_[A-Za-z0-9]+') $false
    Assert-Equal ($allHtml -match 'StrongPass123!') $false

    $screenshotRoot = Join-Path $fixtureRoot 'screenshots'
    New-Item -ItemType Directory -Path $screenshotRoot | Out-Null
    $verifiedCaptures = @($plan | ForEach-Object {
        $fileName = $_.id + '.png'
        $filePath = Join-Path $screenshotRoot $fileName
        [IO.File]::WriteAllBytes($filePath, [Text.UTF8Encoding]::new($false).GetBytes('fixture-' + $_.id))
        [pscustomobject]@{ id=$_.id; kind=$_.kind; moduleId=$_.moduleId; actionId=$_.actionId; path=$fileName; sha256=(Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant() }
    })
    $fakeWorker = Join-Path $fixtureRoot 'fake-word-worker.ps1'
    [IO.File]::WriteAllText($fakeWorker, @'
param([string]$ProjectRoot,[string]$WorkItemsPath)
$item=Get-Content -Raw -Encoding UTF8 -LiteralPath $WorkItemsPath|ConvertFrom-Json
[IO.File]::WriteAllText([string]$item.DocxPath,'fixture-docx',[Text.UTF8Encoding]::new($false))
if(-not [string]::IsNullOrWhiteSpace([string]$item.PdfPath)){[IO.File]::WriteAllText([string]$item.PdfPath,'fixture-pdf',[Text.UTF8Encoding]::new($false))}
'@, [Text.UTF8Encoding]::new($true))
    $formal = Build-StandardBusinessMaterials -OutputDirectory (Join-Path $fixtureRoot 'formal-materials') -Blueprint $blueprint `
        -Template $template -Profile ([pscustomobject]@{ softwareName='园区资产工单软件'; purpose='管理园区资产与工单闭环'; industry='园区运维' }) `
        -ProjectLock ([pscustomobject]@{ desktopRuntimeVersion='1.0.0'; electronVersion='44.4.1'; databaseSchemaVersion=1 }) `
        -ScreenshotManifest ([pscustomobject]@{ captures=$verifiedCaptures }) -SourceManifest $manifest `
        -VerificationReceipt ([pscustomobject]@{ status='passed'; businessRows=1000 }) -RepositoryRoot $fixtureRoot `
        -ScreenshotRoot $screenshotRoot -WordWorkerPath $fakeWorker
    Assert-Equal $formal.documents.Count 8
    Assert-Equal @($formal.documents | Where-Object { Test-Path -LiteralPath $_ }).Count 8
}
finally {
    if (Test-Path -LiteralPath $fixtureRoot) { Remove-Item -LiteralPath $fixtureRoot -Recurse -Force }
}
