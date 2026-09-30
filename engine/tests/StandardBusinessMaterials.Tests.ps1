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
        workflows = @([pscustomobject]@{ id = 'asset_lifecycle'; name = '资产生命周期'; entity='asset'; states = @('active','inactive'); transitions=@([pscustomobject]@{id='deactivate';name='停用资产';permission='assets.change_status'}) })
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
    Assert-Equal $actionCapture.actionLabel '停用资产'
    Assert-Equal (@($plan | Where-Object moduleId -eq 'inventory_batches').Count) 0

    $projectBlueprint = [pscustomobject]@{
        modules = @(
            [pscustomobject]@{ id='projects';name='分发项目';entity='project';route='projects';actions=@('list','view','create_project','activate') },
            [pscustomobject]@{ id='project_tasks';name='分发任务';entity='project_task';route='project_tasks';actions=@('list','view','start') }
        )
        workflows = @()
        roles = @(
            [pscustomobject]@{id='operations_dispatcher';permissions=@('projects.list','projects.view','projects.create_project','projects.activate')},
            [pscustomobject]@{id='operations_admin';permissions=@('projects.list','projects.view')}
        )
    }
    $projectPlan = @(Get-StandardScreenshotPlan -Blueprint $projectBlueprint)
    $projectAction = @($projectPlan | Where-Object kind -eq 'action')[0]
    Assert-Equal $projectAction.moduleId 'projects'
    Assert-Equal $projectAction.actionId 'project.create'
    Assert-Equal $projectAction.actionLabel '创建项目'
    Assert-Equal $projectAction.actionType 'domain'
    Assert-Equal $projectAction.actionScope 'module'
    Assert-Equal $projectAction.roleId 'operations_dispatcher'

    $factsFixtureRoot = Join-Path $fixtureRoot 'facts-fixtures'
    $factsHelper = Join-Path $PSScriptRoot '..\desktop-runtime\tests\helpers\write-material-rendering-fixtures.cjs'
    $previousNodeWarnings = $env:NODE_NO_WARNINGS
    try { $env:NODE_NO_WARNINGS='1'; $factsOutput = & node $factsHelper $factsFixtureRoot 2>&1 | Out-String }
    finally { $env:NODE_NO_WARNINGS=$previousNodeWarnings }
    if ($LASTEXITCODE -ne 0) { throw "Material facts fixture generation failed: $factsOutput" }
    $factsInput = Join-Path $fixtureRoot 'facts-input.json'
    $facts = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $factsFixtureRoot 'asset_work_order_operations.json') | ConvertFrom-Json
    $screenshotRoot = Join-Path $fixtureRoot 'screenshots'
    New-Item -ItemType Directory -Path $screenshotRoot | Out-Null
    foreach ($capture in @($facts.screenshots.captures)) {
        $filePath = Join-Path $screenshotRoot ([string]$capture.fileName)
        [IO.File]::WriteAllBytes($filePath, [Text.UTF8Encoding]::new($false).GetBytes('verified-screenshot-' + [string]$capture.scenarioId))
        $capture.imageSha256 = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    [IO.File]::WriteAllText($factsInput, ($facts | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
    $resources = Join-Path $factsFixtureRoot 'asset_work_order_operations-workspace\resources'
    $screenshotManifestPath = Join-Path $fixtureRoot 'screenshot-manifest.json'
    $acceptancePath = Join-Path $fixtureRoot 'acceptance-report.json'
    [IO.File]::WriteAllText($screenshotManifestPath, ($facts.screenshots | ConvertTo-Json -Depth 10), [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText($acceptancePath, '{}', [Text.UTF8Encoding]::new($false))
    $fakeFactsTool = Join-Path $fixtureRoot 'fake-material-facts.cjs'
    [IO.File]::WriteAllText($fakeFactsTool, @'
const fs=require('node:fs');const path=require('node:path');
const args=Object.fromEntries(Array.from({length:(process.argv.length-2)/2},(_,i)=>[process.argv[2+i*2],process.argv[3+i*2]]));
for(const name of ['--resources','--source-manifest','--screenshots','--acceptance','--template','--output'])if(!args[name])throw new Error('missing '+name);
if(args['--template']!=='asset_work_order_operations'||fs.existsSync(args['--output']))throw new Error('invalid material facts request');
fs.copyFileSync(path.join(__dirname,'facts-input.json'),args['--output']);process.stdout.write('{"ok":true,"output":"material-facts.json"}\n');
'@, [Text.UTF8Encoding]::new($false))
    $fakeWorker = Join-Path $fixtureRoot 'fake-word-worker.ps1'
    [IO.File]::WriteAllText($fakeWorker, @'
param([string]$ProjectRoot,[string]$WorkItemsPath)
$item=Get-Content -Raw -Encoding UTF8 -LiteralPath $WorkItemsPath|ConvertFrom-Json
$id=[IO.Path]::GetFileNameWithoutExtension($WorkItemsPath)
if($id-eq'application-info.work'){
    if(-not[bool]$item.ApplicationDocument){throw 'application-info must use the application document exporter'}
    if(-not(Test-Path -LiteralPath ([string]$item.ApplicationTemplatePath) -PathType Leaf)){throw 'application-info template path is missing'}
    $applicationHtml=Get-Content -Raw -Encoding UTF8 -LiteralPath ([string]$item.HtmlPath)
    $applicationFields=@([regex]::Matches($applicationHtml,'(?is)<td\b(?=[^>]*\bdata-field\s*=\s*["''](?<name>[a-z0-9_]+)["''])'))
    if($applicationFields.Count-ne19-or@($applicationFields|ForEach-Object{$_.Groups['name'].Value}|Sort-Object -Unique).Count-ne19){throw 'application-info must provide 19 unique data fields'}
}elseif([bool]$item.ApplicationDocument){throw 'only application-info may use the application document exporter'}
if($id-eq'source.work'){
    if(-not[bool]$item.ExplicitSourceDocument-or-not(Test-Path -LiteralPath ([string]$item.SourcePlanPath) -PathType Leaf)){throw 'source must use the explicit source print plan'}
    foreach($name in @('SourceManifestSha256','SelectionSha256','SourceHtmlSha256')){if([string]$item.$name-notmatch'^[0-9a-f]{64}$'){throw "source work item has invalid $name"}}
    if([int]$item.SourceTotalFiles-lt1-or[int]$item.SourceTotalLogicalLines-lt1-or[int]$item.SourceTotalPrintLines-lt1){throw 'source work item is missing manifest totals'}
    if((Get-FileHash -LiteralPath ([string]$item.HtmlPath) -Algorithm SHA256).Hash.ToLowerInvariant()-cne[string]$item.SourceHtmlSha256){throw 'source HTML hash mismatch'}
}
[IO.File]::WriteAllText([string]$item.DocxPath,'fixture-docx',[Text.UTF8Encoding]::new($false))
if(-not [string]::IsNullOrWhiteSpace([string]$item.PdfPath)){[IO.File]::WriteAllText([string]$item.PdfPath,'fixture-pdf',[Text.UTF8Encoding]::new($false))}
'@, [Text.UTF8Encoding]::new($true))
    $fakeQualityModule = Join-Path $fixtureRoot 'fake-quality.psm1'
    [IO.File]::WriteAllText($fakeQualityModule, @'
function Test-StandardDocumentSet {
    param($Facts,[string]$DocumentRoot,[string[]]$ExpectedScreenshots,$SourcePlan)
    $definitions=@(
        @{id='introduction';docx='introduction.docx';pdf=$null;pages=4;characters=1800;tables=0;media=0},@{id='feature-table';docx='feature-table.docx';pdf=$null;pages=8;characters=3200;tables=8;media=0},
        @{id='manual';docx='manual.docx';pdf='manual.pdf';pages=20;characters=5000;tables=2;media=12},@{id='database-design';docx='database-design.docx';pdf=$null;pages=16;characters=4500;tables=12;media=1},
        @{id='runtime';docx='runtime.docx';pdf=$null;pages=4;characters=1200;tables=2;media=0},@{id='prototype';docx='prototype.docx';pdf=$null;pages=8;characters=1200;tables=1;media=5},
        @{id='application-info';docx='application-info.docx';pdf='application-info.pdf';pages=2;characters=900;tables=3;media=0},@{id='source';docx='source.docx';pdf='source.pdf';pages=[int]$SourcePlan.expectedPageCount;characters=30000;tables=0;media=0}
    )
    if($ExpectedScreenshots.Count-lt12-or$ExpectedScreenshots.Count-gt18){throw 'expected twelve to eighteen screenshots'}
    $documents=@($definitions|ForEach-Object{$d=$_;$docx=Join-Path $DocumentRoot $d.docx;if(-not(Test-Path -LiteralPath $docx -PathType Leaf)){throw 'missing document'};$pdf=if($null-eq$d.pdf){$null}else{$path=Join-Path $DocumentRoot $d.pdf;if(-not(Test-Path -LiteralPath $path -PathType Leaf)){throw 'missing pdf'};[pscustomobject]@{fileName=$d.pdf;sha256=(Get-FileHash $path -Algorithm SHA256).Hash.ToLowerInvariant();pages=$d.pages;nonblank=$true}};[pscustomobject]@{id=$d.id;fileName=$d.docx;sha256=(Get-FileHash $docx -Algorithm SHA256).Hash.ToLowerInvariant();pages=$d.pages;characters=$d.characters;paragraphs=100;tables=$d.tables;mediaCount=$d.media;mediaSha256=@(1..$d.media|ForEach-Object{if($d.media-gt0){'{0:x64}'-f$_}});pdf=$pdf}})
    [pscustomobject]@{receiptVersion='1.0';status='passed';factsSha256=('1'*64);executableSha256=$Facts.evidence.executableSha256;resourceManifestSha256=$Facts.evidence.resourceManifestSha256;blueprintSha256=$Facts.evidence.blueprintSha256;sourceManifestSha256=$Facts.source.sha256;sourceSelectionSha256=$SourcePlan.selectionSha256;screenshotManifestSha256=$Facts.evidence.screenshotManifestSha256;screenshotSha256=('2'*64);documents=$documents}
}
Export-ModuleMember -Function Test-StandardDocumentSet
'@, [Text.UTF8Encoding]::new($true))
    $outputRoot = Join-Path $fixtureRoot 'formal-materials'
    $formal = Build-StandardBusinessMaterials -OutputDirectory $outputRoot -Template $template -ResourceDirectory $resources `
        -SourceManifestPath $manifestPath -ScreenshotManifestPath $screenshotManifestPath -AcceptanceReceiptPath $acceptancePath `
        -RepositoryRoot $fixtureRoot -ScreenshotRoot $screenshotRoot -MaterialFactsToolPath $fakeFactsTool `
        -WordWorkerPath $fakeWorker -DocumentQualityModulePath $fakeQualityModule
    Assert-Equal $formal.html.Count 8
    Assert-Equal $formal.documents.Count 11
    Assert-Equal @($formal.documents | Where-Object { Test-Path -LiteralPath $_ }).Count 11
    Assert-Equal $formal.receipt.status 'passed'
    Assert-Equal (Test-Path -LiteralPath $formal.factsPath -PathType Leaf) $true
    Assert-Equal (Test-Path -LiteralPath $formal.receiptPath -PathType Leaf) $true
    Assert-Equal @(Get-ChildItem -LiteralPath $fixtureRoot -Directory -Filter '.standard-materials.staging-*').Count 0

    $failingWorker = Join-Path $fixtureRoot 'failing-word-worker.ps1'
    [IO.File]::WriteAllText($failingWorker, "throw 'intentional worker failure'", [Text.UTF8Encoding]::new($true))
    $failedOutput = Join-Path $fixtureRoot 'failed-materials'
    Assert-Throws {
        Build-StandardBusinessMaterials -OutputDirectory $failedOutput -Template $template -ResourceDirectory $resources `
            -SourceManifestPath $manifestPath -ScreenshotManifestPath $screenshotManifestPath -AcceptanceReceiptPath $acceptancePath `
            -RepositoryRoot $fixtureRoot -ScreenshotRoot $screenshotRoot -MaterialFactsToolPath $fakeFactsTool `
            -WordWorkerPath $failingWorker -DocumentQualityModulePath $fakeQualityModule
    } 'Word material export failed'
    Assert-Equal (Test-Path -LiteralPath $failedOutput) $false
    Assert-Equal @(Get-ChildItem -LiteralPath $fixtureRoot -Directory -Filter '.standard-materials.staging-*').Count 0

    $directoryTarget = Join-Path $fixtureRoot 'directory-target'
    $directoryChild = Join-Path $directoryTarget 'resources-child'
    $directoryJunction = Join-Path $fixtureRoot 'directory-junction'
    New-Item -ItemType Directory -Path $directoryChild -Force | Out-Null
    New-Item -ItemType Junction -Path $directoryJunction -Target $directoryTarget | Out-Null
    Assert-Throws {
        Build-StandardBusinessMaterials -OutputDirectory (Join-Path $fixtureRoot 'junction-directory-output') -Template $template -ResourceDirectory (Join-Path $directoryJunction 'resources-child') `
            -SourceManifestPath $manifestPath -ScreenshotManifestPath $screenshotManifestPath -AcceptanceReceiptPath $acceptancePath `
            -RepositoryRoot $fixtureRoot -ScreenshotRoot $screenshotRoot -MaterialFactsToolPath $fakeFactsTool -SkipDocumentExport
    } 'reparse point'

    $fileTarget = Join-Path $fixtureRoot 'file-target'
    $fileJunction = Join-Path $fixtureRoot 'file-junction'
    New-Item -ItemType Directory -Path $fileTarget | Out-Null
    Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $fileTarget 'source-manifest.json')
    New-Item -ItemType Junction -Path $fileJunction -Target $fileTarget | Out-Null
    Assert-Throws {
        Build-StandardBusinessMaterials -OutputDirectory (Join-Path $fixtureRoot 'junction-file-output') -Template $template -ResourceDirectory $resources `
            -SourceManifestPath (Join-Path $fileJunction 'source-manifest.json') -ScreenshotManifestPath $screenshotManifestPath -AcceptanceReceiptPath $acceptancePath `
            -RepositoryRoot $fixtureRoot -ScreenshotRoot $screenshotRoot -MaterialFactsToolPath $fakeFactsTool -SkipDocumentExport
    } 'reparse point'
}
finally {
    if (Test-Path -LiteralPath $fixtureRoot) { Remove-Item -LiteralPath $fixtureRoot -Recurse -Force }
}
