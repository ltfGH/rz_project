[CmdletBinding()]
param([switch]$IncludeRepresentativeDelivery,[switch]$KeepFailedWorkspace)

. "$PSScriptRoot\Assert.ps1"
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot '..\lib\StandardBusinessCatalog.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot '..\lib\StandardBusinessSource.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot '..\lib\StandardSourceMaterial.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot '..\lib\StandardMaterialRendering.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot '..\lib\StandardBusinessDiagrams.psm1') -Force -DisableNameChecking

$engineRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$desktopRoot = Join-Path $engineRoot 'desktop-runtime'
$root = Join-Path $env:TEMP ('standard-acceptance-' + [guid]::NewGuid().ToString('N'))
$acceptanceCompleted=$false
function New-AcceptancePng([string]$Path,[int]$Index){$bitmap=[Drawing.Bitmap]::new(640,480);$graphics=[Drawing.Graphics]::FromImage($bitmap);try{$graphics.Clear([Drawing.Color]::FromArgb(255,($Index*37)%255,($Index*71)%255,($Index*109)%255));$graphics.DrawString([string]$Index,[Drawing.Font]::new('Arial',32),[Drawing.Brushes]::Black,30,30);$bitmap.Save($Path,[Drawing.Imaging.ImageFormat]::Png)}finally{$graphics.Dispose();$bitmap.Dispose()}}
function Get-AcceptanceDocxXml([string]$Path){$archive=[IO.Compression.ZipFile]::OpenRead($Path);try{$entry=$archive.GetEntry('word/document.xml');if($null-eq$entry){throw 'DOCX document.xml is missing.'};$reader=[IO.StreamReader]::new($entry.Open(),[Text.Encoding]::UTF8,$true);try{return $reader.ReadToEnd()}finally{$reader.Dispose()}}finally{$archive.Dispose()}}
function New-AcceptancePassword([string]$Role){$sha=[Security.Cryptography.SHA256]::Create();try{$hash=[BitConverter]::ToString($sha.ComputeHash([Text.UTF8Encoding]::new($false).GetBytes('standard-acceptance:'+ $Role))).Replace('-','').ToLowerInvariant();return 'Aa1!'+$hash.Substring(0,28)}finally{$sha.Dispose()}}
$testDigests=[ordered]@{
    dispatcher='scrypt$16384$8$1$ZGlzcGF0Y2hlci1zYWx0MQ==$QXkC+g8WOmnKNAtrJeN3u/VUr1oSHxVcbaXJuF8AyuA5VAWwdgvxrpk7xuMHToK0TXjz/gCY7Gbozbov/epFfg=='
    operator='scrypt$16384$8$1$b3BlcmF0b3Itc2FsdC0wMQ==$RgRfB1/ZuasinXeYj+agQRjdSxLJLmyUs+4hc7obWE+s4CyE03Kb+Gnm3OQvRDqVL3yNzmc0nYC5MYFzetFgDw=='
    reviewer='scrypt$16384$8$1$cmV2aWV3ZXItc2FsdC0wMQ==$E0nzK8Ax/fc6WHYkcKcHp4gRu9IPx/mDI95Y4tcXF5UzqZNTg0bwyjezydD6AxKr/HXr7PjWPTpQ6GKfGiZ6tA=='
    administrator='scrypt$16384$8$1$YWRtaW4tc2FsdC0wMDAxMjM0NQ==$zkr0AzJ03NzoUsSpq5N8ZEtBMxwLhmSnKpSDvQr84EqcBJVDlkrJwQXr8LBN5cJ83EwNbwojZoA/47Bx8r1aLw=='
}
try {
    New-Item -ItemType Directory -Path $root | Out-Null
    $templates = @(Get-StandardBusinessTemplates)
    Assert-Equal $templates.Count 8
    foreach($template in $templates){
        $requestPath=Join-Path $root ($template.id+'.request.json');$output=Join-Path $root ($template.id+'-resources')
        $profile=[ordered]@{softwareName=($template.name+'软件');purpose=$template.workflowSummary;industry='离线业务管理';entityAliases=[ordered]@{};moduleAliases=[ordered]@{};seedVocabulary=[ordered]@{}}
        $request=[ordered]@{
            templateId=$template.id;appId=[guid]::NewGuid().ToString()
            software=[ordered]@{id=('acceptance_'+$template.id);name=$profile.softwareName;version='1.0.0';purpose=$profile.purpose;targetUsers=@($template.roles);boundaries=@('离线桌面运行');loginMode='required'}
            profile=$profile;passwordDigests=$testDigests
            seed=[ordered]@{value=20260921;businessRows=1000;baseline='2026-09-21T00:00:00.000Z'}
        }
        [IO.File]::WriteAllText($requestPath,($request|ConvertTo-Json -Depth 20),[Text.UTF8Encoding]::new($false))
        $toolOutput=(& node (Join-Path $desktopRoot 'tools\build-standard-resources.cjs') --request $requestPath --output $output 2>&1|Out-String)
        if($LASTEXITCODE-ne 0){throw "Resource acceptance failed for $($template.id): $($toolOutput.Trim())"}
        foreach($name in @('blueprint.json','seed.json','domain-lock.json','project.lock.json','resource-manifest.json','production-runtime-catalog.cjs')){Assert-Equal (Test-Path -LiteralPath (Join-Path $output $name)-PathType Leaf) $true}
        $blueprint=Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $output 'blueprint.json')|ConvertFrom-Json
        $seed=Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $output 'seed.json')|ConvertFrom-Json
        Assert-Equal (($blueprint.plugins.id|Sort-Object)-join ',') (($template.packs|Sort-Object)-join ',')
        Assert-Equal ([int](($seed.report.counts.PSObject.Properties.Value|Measure-Object -Sum).Sum)) 1000
        Assert-Equal (@($blueprint.modules.id|Where-Object {$_ -in @('records','operation','history')}).Count) 0
    }
    foreach($spec in @('reference-acceptance.spec.ts','inventory-application-acceptance.spec.ts','project-archive-acceptance.spec.ts')){Assert-Equal (Test-Path -LiteralPath (Join-Path $desktopRoot "tests\e2e\$spec")-PathType Leaf) $true}
    $sourceContract=Get-StandardSourceManifest -RepositoryRoot (Split-Path -Parent $engineRoot) -Template $templates[0] -OutputPath (Join-Path $root 'rebuild-source-manifest.json')
    foreach($requiredSource in @(
        'engine/desktop-runtime/package-lock.json','engine/desktop-runtime/vite.config.mts','engine/desktop-runtime/vite.preload.config.mts',
        'engine/desktop-runtime/tools/build-standard-resources.cjs','engine/desktop-runtime/tools/write-builder-config.cjs','engine/desktop-runtime/tools/build-standard-desktop.ps1',
        'engine/desktop-runtime/build/icon.svg','engine/domain-packs/package-lock.json','engine/domain-packs/package.json','engine/domain-packs/tsconfig.json'
    )){Assert-Equal ($sourceContract.files.path -contains $requiredSource) $true}

    Add-Type -AssemblyName System.Drawing
    $factsRoot=Join-Path $root 'material-facts';$factsHelper=Join-Path $desktopRoot 'tests\helpers\write-material-rendering-fixtures.cjs'
    $previousNodeWarnings=$env:NODE_NO_WARNINGS
    try{$env:NODE_NO_WARNINGS='1';$factsOutput=& node $factsHelper $factsRoot 2>&1|Out-String}finally{$env:NODE_NO_WARNINGS=$previousNodeWarnings}
    if($LASTEXITCODE-ne0){throw "MaterialFacts acceptance fixture generation failed: $factsOutput"}
    $sourcePlan=Get-StandardSourcePrintPlan -RepositoryRoot (Split-Path -Parent $engineRoot) -SourceManifest $sourceContract
    foreach($template in $templates){
        $factsPath=Join-Path $factsRoot ($template.id+'.json');$facts=Get-Content -Raw -Encoding UTF8 -LiteralPath $factsPath|ConvertFrom-Json
        Assert-Equal $facts.factVersion '1.0';Assert-Equal $facts.templateId $template.id
        Assert-Equal $facts.workflows.Count 1;Assert-Equal (@($facts.workflows[0].steps).Count -gt 0) $true
        Assert-Equal ([string]::IsNullOrWhiteSpace([string]$facts.database.schemaDigest)) $false;Assert-Equal (@($facts.database.tables).Count -gt 0) $true
        Assert-Equal $facts.source.totalFiles 2;Assert-Equal $facts.source.totalLines 200
        $factsBlueprint=Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $factsRoot ($template.id+'-workspace\resources\blueprint.json'))|ConvertFrom-Json
        foreach($module in @($facts.modules)){Assert-Equal (@($factsBlueprint.modules.id|Where-Object{$_-ceq[string]$module.id}).Count) 1}
        foreach($step in @($facts.workflows[0].steps)){if($null-ne$step.PSObject.Properties['actionId']-and-not[string]::IsNullOrWhiteSpace([string]$step.actionId)){Assert-Equal (@($facts.commands.id|Where-Object{$_-ceq[string]$step.actionId}).Count) 1}}
        $renderRoot=Join-Path $root ($template.id+'-rendered');New-Item -ItemType Directory -Path $renderRoot|Out-Null
        $screenshots=Join-Path $renderRoot 'verified-input';New-Item -ItemType Directory -Path $screenshots|Out-Null;$index=0
        foreach($capture in @($facts.screenshots.captures)){$index++;$image=Join-Path $screenshots ([string]$capture.fileName);New-AcceptancePng $image $index;$capture.imageSha256=(Get-FileHash $image -Algorithm SHA256).Hash.ToLowerInvariant()}
        $diagrams=Join-Path $renderRoot 'diagrams';$diagramResults=@(New-StandardBusinessDiagrams -Facts $facts -OutputDirectory $diagrams);Assert-Equal $diagramResults.Count 5
        [void](Render-StandardIntroductionHtml -Facts $facts -OutputPath (Join-Path $renderRoot 'introduction.html'))
        [void](Render-StandardFeatureTableHtml -Facts $facts -OutputPath (Join-Path $renderRoot 'feature-table.html'))
        [void](Render-StandardManualHtml -Facts $facts -ScreenshotRoot $screenshots -OutputPath (Join-Path $renderRoot 'manual.html'))
        [void](Render-StandardDatabaseHtml -Facts $facts -DiagramRoot $diagrams -OutputPath (Join-Path $renderRoot 'database-design.html'))
        [void](Render-StandardRuntimeHtml -Facts $facts -OutputPath (Join-Path $renderRoot 'runtime.html'))
        [void](Render-StandardPrototypeHtml -Facts $facts -DiagramRoot $diagrams -OutputPath (Join-Path $renderRoot 'prototype.html'))
        [void](Render-StandardApplicantHtml -Facts $facts -OutputPath (Join-Path $renderRoot 'application-info.html'))
        [void](Write-StandardSourceHtml -Plan $sourcePlan -SoftwareName ([string]$facts.software.name) -Version ([string]$facts.software.version) -OutputPath (Join-Path $renderRoot 'source.html'))
        Assert-Equal @(Get-ChildItem -LiteralPath $renderRoot -Filter '*.html' -File).Count 8
        Assert-Equal @(Get-ChildItem -LiteralPath $diagrams -Filter '*.png' -File).Count 5
    }
    $legacyOutput=& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Publisher.Tests.ps1') 2>&1|Out-String
    if($LASTEXITCODE-ne0){throw "LegacyDemo twelve-file publisher contract failed: $legacyOutput"}

    if($IncludeRepresentativeDelivery){
        Import-Module (Join-Path $engineRoot 'lib\Generator.Core.psm1') -Force -DisableNameChecking
        Import-Module (Join-Path $engineRoot 'lib\StandardBusinessCredentials.psm1') -Force -DisableNameChecking
        Import-Module (Join-Path $engineRoot 'lib\StandardBusinessOrchestrator.psm1') -Force -DisableNameChecking
        Import-Module (Join-Path $engineRoot 'lib\Generator.Core.psm1') -Force -DisableNameChecking
        $passwords=@('dispatcher','operator','reviewer','administrator'|ForEach-Object{New-AcceptancePassword $_})
        $queue=[Collections.Generic.Queue[string]]::new();foreach($password in $passwords){$queue.Enqueue($password);$queue.Enqueue($password)}
        Assert-Equal $queue.Count 8
        $secureReader={param($role,$confirmation) ConvertTo-SecureString $queue.Dequeue() -AsPlainText -Force}.GetNewClosure()
        $bundle=Read-StandardBusinessCredentialBundle -SecureReader $secureReader
        try{
            $representatives=@(
                [pscustomobject]@{templateId='asset_inspection_rectification';theme='标准验收设备巡检整改';softwareName='标准验收设备巡检整改软件';purpose='管理设备巡检、异常整改和复核关闭';industry='设备运维';publish=$false},
                [pscustomobject]@{templateId='inventory_application_approval';theme='标准验收库存申领审批';softwareName='标准验收库存申领审批软件';purpose='管理物料批次、申领审批和库存流水';industry='库存管理';publish=$false},
                [pscustomobject]@{templateId='project_task_management';theme='标准验收业务分发';softwareName='标准验收业务分发软件';purpose='管理业务分发项目与任务闭环';industry='企业项目管理';publish=$true}
            )
            foreach($representative in $representatives){
                $template=@($templates|Where-Object id -eq $representative.templateId)[0]
                $context=New-GenerationContext -Theme $representative.theme -GeneratorRoot $root -Now (Get-Date);$context.Version='1.0.0'
                $case=$representative
                $profileStage={param($state)
                    $profile=[pscustomobject]@{softwareName=$case.softwareName;purpose=$case.purpose;industry=$case.industry;entityAliases=[pscustomobject]@{};moduleAliases=[pscustomobject]@{};seedVocabulary=[pscustomobject]@{}}
                    $path=Join-Path $state.Context.WorkspacePath 'acceptance-profile.json';[IO.File]::WriteAllText($path,($profile|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false));[pscustomobject]@{Path=$path;Profile=$profile}
                }.GetNewClosure()
                $overrides=@{BuildThemeProfile=$profileStage}
                if(-not$representative.publish){
                    $overrides.BuildWindowsInstaller={param($state)[pscustomobject]@{FullName='skipped-for-material-acceptance'}}
                    $overrides.VerifyInstaller={param($state)[pscustomobject]@{status='passed'}}
                    $overrides.PackageBusinessDelivery={param($state)(Join-Path $state.Context.WorkspacePath 'publication-skipped')}
                    $overrides.Publish={param($state)$state.Context.RequestedDeliveryPath}
                }
                $result=Invoke-StandardBusinessOrchestration -Context $context -Template $template -CredentialDigests $bundle.Digests -CredentialSecrets $bundle.Secrets -StageOverrides $overrides -KeepSuccessfulWorkspace
                Assert-Equal $result.ExitCode 0
                $materialRoot=Join-Path $context.WorkspacePath 'materials';$documentRoot=Join-Path $materialRoot 'documents'
                $receipt=Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $materialRoot 'material-receipt.json')|ConvertFrom-Json
                Assert-Equal $receipt.status 'passed';Assert-Equal $receipt.documents.Count 8
                $pageBounds=@{introduction=@(3,5);'feature-table'=@(6,10);manual=@(15,25);'database-design'=@(12,20);runtime=@(3,5);prototype=@(6,12);'application-info'=@(2,2);source=@(1,60)}
                foreach($documentReceipt in @($receipt.documents)){$bounds=$pageBounds[[string]$documentReceipt.id];Assert-Equal ([int]$documentReceipt.pages-ge[int]$bounds[0]-and[int]$documentReceipt.pages-le[int]$bounds[1]) $true}
                Assert-Equal ([int](@($receipt.documents|Where-Object id -eq 'manual')[0].mediaCount)-ge12) $true
                Assert-Equal ([int](@($receipt.documents|Where-Object id -eq 'database-design')[0].tables)-ge1) $true
                Assert-Equal ([int](@($receipt.documents|Where-Object id -eq 'prototype')[0].mediaCount)-ge5) $true
                $documents=@(Get-ChildItem -LiteralPath $documentRoot -File);Assert-Equal $documents.Count 11
                foreach($document in @($documents|Where-Object Extension -eq '.docx')){$archive=[IO.Compression.ZipFile]::OpenRead($document.FullName);try{Assert-Equal (@($archive.Entries|Where-Object FullName -eq '[Content_Types].xml').Count) 1}finally{$archive.Dispose()}}
                foreach($pdf in @($documents|Where-Object Extension -eq '.pdf')){$stream=$pdf.OpenRead();try{$bytes=New-Object byte[] 5;[void]$stream.Read($bytes,0,5);Assert-Equal ([Text.Encoding]::ASCII.GetString($bytes)) '%PDF-'}finally{$stream.Dispose()}}
                Assert-Match (Get-AcceptanceDocxXml (Join-Path $documentRoot 'manual.docx')) '完整业务流程'
                Assert-Match (Get-AcceptanceDocxXml (Join-Path $documentRoot 'application-info.docx')) 'app_software_name'
                Assert-Match (Get-AcceptanceDocxXml (Join-Path $documentRoot 'database-design.docx')) '核心数据字典'
                $screenshotManifest=Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $context.WorkspacePath 'screenshots\screenshot-manifest.json')|ConvertFrom-Json
                Assert-Equal (@($screenshotManifest.captures).Count-ge12-and@($screenshotManifest.captures).Count-le18) $true
                Assert-Equal @($screenshotManifest.captures|Where-Object scenarioId -eq 'dashboard').Count 1
                Assert-Equal @($screenshotManifest.captures.imageSha256|Sort-Object -Unique).Count @($screenshotManifest.captures).Count
                $actionCaptures=@($screenshotManifest.captures|Where-Object{$null-ne$_.actionId-and$_.controlVerified});Assert-Equal ($actionCaptures.Count-gt0) $true
                $imageFiles=@(Get-ChildItem -LiteralPath (Join-Path $context.WorkspacePath 'screenshots') -Filter '*.png' -File);Assert-Equal $imageFiles.Count @($screenshotManifest.captures).Count
                foreach($imageFile in $imageFiles){$image=[Drawing.Image]::FromFile($imageFile.FullName);try{Assert-Equal ($image.Width-ge320) $true;Assert-Equal ($image.Height-ge240) $true}finally{$image.Dispose()}}
                if($representative.templateId-eq'project_task_management'){
                    Assert-Equal (@($actionCaptures|Where-Object actionId -eq 'project.create').Count-gt0) $true
                    $delivery=@(Get-ChildItem -LiteralPath $result.DeliveryPath -File);Assert-Equal $delivery.Count 18
                    foreach($name in @("$($representative.softwareName)-软件介绍.docx","$($representative.softwareName)-功能表.docx","$($representative.softwareName)-数据库设计.docx",'业务蓝图.json','领域版本锁.json','验收报告.json')){Assert-Equal ($delivery.Name-contains$name) $true}
                    $complete=@($delivery|Where-Object Name -Like '*-完整交付包.zip')[0];$zip=[IO.Compression.ZipFile]::OpenRead($complete.FullName);try{Assert-Equal $zip.Entries.Count 17}finally{$zip.Dispose()}
                    $report=Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $result.DeliveryPath '校验报告.txt');Assert-Match $report '材料量化结果';Assert-Match $report '操作手册：页数'
                }
            }
        }finally{foreach($secret in $bundle.Secrets.Values){$secret.Dispose()}}
    }
    $acceptanceCompleted=$true
    $global:LASTEXITCODE=0
}
finally {
    if($acceptanceCompleted-or-not$KeepFailedWorkspace){if(Test-Path -LiteralPath $root){Remove-Item -LiteralPath $root -Recurse -Force}}else{Write-Host "Retained failed acceptance workspace: $root"}
}
