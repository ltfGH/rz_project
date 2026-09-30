Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot 'StandardSourceMaterial.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'StandardMaterialRendering.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'StandardBusinessDiagrams.psm1') -Force -DisableNameChecking

$script:ContractPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'config\standard-material-contract.json'
$script:DefaultMaterialFactsTool = Join-Path (Split-Path -Parent $PSScriptRoot) 'desktop-runtime\tools\build-material-facts.cjs'
$script:DefaultWordWorker = Join-Path (Split-Path -Parent $PSScriptRoot) 'template\tools\word-export-worker.ps1'
$script:DefaultQualityModule = Join-Path $PSScriptRoot 'StandardDocumentQuality.psm1'
$script:DomainScreenshotActions = [ordered]@{
    'projects.create_project' = [pscustomobject]@{ DomainActionId='project.create'; Label='创建项目'; Scope='module' }
}

function Get-StandardScreenshotPlan {
    [CmdletBinding()]param([Parameter(Mandatory)]$Blueprint)
    $modules = @($Blueprint.modules | Where-Object { $_.id -ne 'maintenance' })
    if ($modules.Count -eq 0) { throw 'Blueprint has no business modules for screenshots.' }
    $primary = @($modules | Where-Object { @($_.actions) -contains 'view' })[0]; if ($null -eq $primary) { $primary = $modules[0] }
    $workflowRows = @($Blueprint.workflows | Where-Object { @($_.transitions).Count -gt 0 })
    $actionModule=$null;$action='';$actionLabel='';$actionType='';$actionScope='';$actionPermission=''
    if ($workflowRows.Count -gt 0) {
        $workflow=$workflowRows[0];$actionModule=@($modules|Where-Object entity -eq $workflow.entity)[0]
        if($null-eq$actionModule){throw "Workflow '$($workflow.id)' has no visible module."}
        $transition=@($workflow.transitions)[0];$action=[string]$transition.id;$actionLabel=[string]$transition.name;$actionPermission=[string]$transition.permission;$actionType='workflow';$actionScope='record'
    } else {
        foreach($module in $modules){foreach($moduleAction in @($module.actions)){$key='{0}.{1}'-f$module.id,$moduleAction;if($script:DomainScreenshotActions.Contains($key)){$definition=$script:DomainScreenshotActions[$key];$actionModule=$module;$action=[string]$definition.DomainActionId;$actionLabel=[string]$definition.Label;$actionPermission=$key;$actionType='domain';$actionScope=[string]$definition.Scope;break}};if($null-ne$actionModule){break}}
        if($null-eq$actionModule){throw 'Blueprint has no supported action for a screenshot.'}
    }
    $actionRole=$null
    foreach($roleId in @('operations_dispatcher','operations_operator','operations_reviewer','operations_admin')){$matchedRole=@($Blueprint.roles|Where-Object{$_.id-eq$roleId-and@($_.permissions)-contains$actionPermission});if($matchedRole.Count-eq1){$actionRole=$matchedRole[0];break}}
    if($null-eq$actionRole){throw "No composite role can display action '$actionPermission'."}
    $secondary=@($modules|Where-Object id -ne $primary.id)[0];if($null-eq$secondary){$secondary=$primary}
    return @(
        [pscustomobject]@{id='dashboard';kind='dashboard';moduleId=$null;actionId=$null;roleId='operations_admin';fileName='dashboard-desktop.png';viewport='desktop'},
        [pscustomobject]@{id=('list-'+$primary.id);kind='list';moduleId=[string]$primary.id;actionId='list';roleId='operations_admin';fileName='records-desktop.png';viewport='desktop'},
        [pscustomobject]@{id=('detail-'+$primary.id);kind='detail';moduleId=[string]$primary.id;actionId='view';roleId='operations_admin';fileName='detail-desktop.png';viewport='desktop'},
        [pscustomobject]@{id=('action-'+$actionModule.id+'-'+$action);kind='action';moduleId=[string]$actionModule.id;actionId=[string]$action;actionLabel=$actionLabel;actionType=$actionType;actionScope=$actionScope;roleId=[string]$actionRole.id;fileName='operation-desktop.png';viewport='desktop'},
        [pscustomobject]@{id=('mobile-'+$secondary.id);kind='list';moduleId=[string]$secondary.id;actionId='list';roleId='operations_admin';fileName='records-mobile.png';viewport='mobile'}
    )
}

function Assert-StandardMaterialNoReparseAncestors($Item,[string]$Name) {
    $current=$Item
    while($null -ne $current){if(($current.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw "Material input '$Name' path must not contain a reparse point."};$current=if($current -is [IO.FileInfo]){$current.Directory}else{$current.Parent}}
}
function Assert-StandardMaterialFile {
    param([Parameter(Mandatory)][string]$Path,[Parameter(Mandatory)][string]$Name)
    if(-not[IO.Path]::IsPathRooted($Path)-or-not(Test-Path -LiteralPath $Path -PathType Leaf)){throw "Material input '$Name' is missing or not absolute."}
    $item=Get-Item -LiteralPath $Path -Force;Assert-StandardMaterialNoReparseAncestors $item $Name;return $item.FullName
}
function Assert-StandardMaterialDirectory {
    param([Parameter(Mandatory)][string]$Path,[Parameter(Mandatory)][string]$Name)
    if(-not[IO.Path]::IsPathRooted($Path)-or-not(Test-Path -LiteralPath $Path -PathType Container)){throw "Material input '$Name' is missing or not absolute."}
    $item=Get-Item -LiteralPath $Path -Force;Assert-StandardMaterialNoReparseAncestors $item $Name;return $item.FullName
}

function Invoke-StandardMaterialFactsBuilder {
    param([string]$ToolPath,[string]$ResourceDirectory,[string]$SourceManifestPath,[string]$ScreenshotManifestPath,[string]$AcceptanceReceiptPath,[string]$TemplateId,[string]$OutputPath)
    $previous=$ErrorActionPreference
    try{$ErrorActionPreference='Continue';$builderOutput=& node $ToolPath '--resources' $ResourceDirectory '--source-manifest' $SourceManifestPath '--screenshots' $ScreenshotManifestPath '--acceptance' $AcceptanceReceiptPath '--template' $TemplateId '--output' $OutputPath 2>&1|Out-String;$exitCode=$LASTEXITCODE}finally{$ErrorActionPreference=$previous}
    if($exitCode-ne0-or-not(Test-Path -LiteralPath $OutputPath -PathType Leaf)){throw 'Material facts builder failed.'}
    try{$result=$builderOutput.Trim()|ConvertFrom-Json -ErrorAction Stop}catch{throw 'Material facts builder returned an invalid result.'}
    if($result.ok-ne$true-or[string]$result.output-cne'material-facts.json'){throw 'Material facts builder returned an invalid result.'}
}

function Get-StandardMaterialDocumentDefinitions {
    return @(
        [pscustomobject]@{id='introduction';html='introduction.html';pdf=$false;source=$false;application=$false},
        [pscustomobject]@{id='feature-table';html='feature-table.html';pdf=$false;source=$false;application=$false},
        [pscustomobject]@{id='manual';html='manual.html';pdf=$true;source=$false;application=$false},
        [pscustomobject]@{id='database-design';html='database-design.html';pdf=$false;source=$false;application=$false},
        [pscustomobject]@{id='runtime';html='runtime.html';pdf=$false;source=$false;application=$false},
        [pscustomobject]@{id='prototype';html='prototype.html';pdf=$false;source=$false;application=$false},
        [pscustomobject]@{id='application-info';html='application-info.html';pdf=$true;source=$false;application=$true},
        [pscustomobject]@{id='source';html='source.html';pdf=$true;source=$true;application=$false}
    )
}

function Invoke-StandardMaterialWordExport {
    param([string]$WorkerPath,[string]$ProjectRoot,[string]$WorkPath,$WorkItem)
    $completed=$false
    for($attempt=1;$attempt-le3;$attempt++){
        foreach($path in @($WorkItem.DocxPath,$WorkItem.PdfPath)){if($null-ne$path-and(Test-Path -LiteralPath $path)){Remove-Item -LiteralPath $path -Force}}
        $previous=$ErrorActionPreference
        try{$ErrorActionPreference='Continue';$workerOutput=& powershell -NoProfile -ExecutionPolicy Bypass -File $WorkerPath -ProjectRoot $ProjectRoot -WorkItemsPath $WorkPath 2>&1|Out-String;$exitCode=$LASTEXITCODE}finally{$ErrorActionPreference=$previous}
        if($exitCode-eq0){$completed=$true;break}
    }
    if(-not$completed){throw 'Word material export failed.'}
}

function Build-StandardBusinessMaterials {
    [CmdletBinding()]param(
        [Parameter(Mandatory)][string]$OutputDirectory,[Parameter(Mandatory)]$Template,
        [Parameter(Mandatory)][string]$ResourceDirectory,[Parameter(Mandatory)][string]$SourceManifestPath,
        [Parameter(Mandatory)][string]$ScreenshotManifestPath,[Parameter(Mandatory)][string]$AcceptanceReceiptPath,
        [Parameter(Mandatory)][string]$RepositoryRoot,[Parameter(Mandatory)][string]$ScreenshotRoot,
        [switch]$SkipDocumentExport,[string]$MaterialFactsToolPath=$script:DefaultMaterialFactsTool,
        [string]$WordWorkerPath=$script:DefaultWordWorker,[string]$DocumentQualityModulePath=$script:DefaultQualityModule)
    $contract=Get-Content -Raw -Encoding UTF8 -LiteralPath $script:ContractPath|ConvertFrom-Json
    if([string]$contract.contractVersion-ne'2.0'){throw 'Unsupported standard material contract.'}
    $output=[IO.Path]::GetFullPath($OutputDirectory);if(Test-Path -LiteralPath $output){throw 'Refusing to overwrite material output.'}
    $parent=Split-Path -Parent $output;if(-not(Test-Path -LiteralPath $parent -PathType Container)){New-Item -ItemType Directory -Path $parent -Force|Out-Null};[void](Assert-StandardMaterialDirectory $parent 'output parent')
    $stage=Join-Path $parent ('.standard-materials.staging-'+[guid]::NewGuid().ToString('N'))
    $resources=Assert-StandardMaterialDirectory $ResourceDirectory 'resources';$repository=Assert-StandardMaterialDirectory $RepositoryRoot 'repository';$screenshots=Assert-StandardMaterialDirectory $ScreenshotRoot 'screenshots'
    $sourceInput=Assert-StandardMaterialFile $SourceManifestPath 'source manifest';$screenshotInput=Assert-StandardMaterialFile $ScreenshotManifestPath 'screenshot manifest';$acceptanceInput=Assert-StandardMaterialFile $AcceptanceReceiptPath 'acceptance receipt';$factsTool=Assert-StandardMaterialFile $MaterialFactsToolPath 'material facts tool'
    if(-not$SkipDocumentExport){$wordWorker=Assert-StandardMaterialFile $WordWorkerPath 'Word worker';$qualityModule=Assert-StandardMaterialFile $DocumentQualityModulePath 'document quality module'}
    try{
        New-Item -ItemType Directory -Path $stage|Out-Null;$renderRoot=Join-Path $stage 'rendered';$documentRoot=Join-Path $stage 'documents';New-Item -ItemType Directory -Path $renderRoot|Out-Null;New-Item -ItemType Directory -Path $documentRoot|Out-Null
        $factsPath=Join-Path $stage 'material-facts.json';Invoke-StandardMaterialFactsBuilder $factsTool $resources $sourceInput $screenshotInput $acceptanceInput ([string]$Template.id) $factsPath
        $facts=Get-Content -Raw -Encoding UTF8 -LiteralPath $factsPath|ConvertFrom-Json -ErrorAction Stop
        if([string]$facts.factVersion-ne'1.0'-or[string]$facts.templateId-cne[string]$Template.id){throw 'Material facts do not match the selected template.'}
        $diagramRoot=Join-Path $renderRoot 'diagrams';$diagramResults=@(New-StandardBusinessDiagrams -Facts $facts -OutputDirectory $diagramRoot)
        $htmlNames=@('introduction.html','feature-table.html','manual.html','database-design.html','runtime.html','prototype.html','application-info.html','source.html')
        [void](Render-StandardIntroductionHtml -Facts $facts -OutputPath (Join-Path $renderRoot 'introduction.html'))
        [void](Render-StandardFeatureTableHtml -Facts $facts -OutputPath (Join-Path $renderRoot 'feature-table.html'))
        [void](Render-StandardManualHtml -Facts $facts -ScreenshotRoot $screenshots -OutputPath (Join-Path $renderRoot 'manual.html'))
        [void](Render-StandardDatabaseHtml -Facts $facts -DiagramRoot $diagramRoot -OutputPath (Join-Path $renderRoot 'database-design.html'))
        [void](Render-StandardRuntimeHtml -Facts $facts -OutputPath (Join-Path $renderRoot 'runtime.html'))
        [void](Render-StandardPrototypeHtml -Facts $facts -DiagramRoot $diagramRoot -OutputPath (Join-Path $renderRoot 'prototype.html'))
        [void](Render-StandardApplicantHtml -Facts $facts -OutputPath (Join-Path $renderRoot 'application-info.html'))
        $sourceManifest=Get-Content -Raw -Encoding UTF8 -LiteralPath $sourceInput|ConvertFrom-Json -ErrorAction Stop;$sourcePlan=Get-StandardSourcePrintPlan -RepositoryRoot $repository -SourceManifest $sourceManifest
        $sourcePlanPath=Join-Path $renderRoot 'source-plan.json';[IO.File]::WriteAllText($sourcePlanPath,($sourcePlan|ConvertTo-Json -Depth 20),[Text.UTF8Encoding]::new($false));$sourceHtml=Join-Path $renderRoot 'source.html';[void](Write-StandardSourceHtml -Plan $sourcePlan -SoftwareName ([string]$facts.software.name) -Version ([string]$facts.software.version) -OutputPath $sourceHtml)
        $receipt=$null
        if(-not$SkipDocumentExport){
            $applicationTemplate=Assert-StandardMaterialFile (Join-Path (Split-Path -Parent $PSScriptRoot) 'template\materials\application-form-template.docx') 'application form template'
            foreach($definition in Get-StandardMaterialDocumentDefinitions){
                $docx=Join-Path $documentRoot ($definition.id+'.docx');$pdf=if($definition.pdf){Join-Path $documentRoot ($definition.id+'.pdf')}else{$null};$isSource=[bool]$definition.source
                $workItem=[pscustomobject]@{HtmlPath=(Join-Path $renderRoot $definition.html);DocxPath=$docx;PdfPath=$pdf;SourceDocument=$isSource;ExplicitSourceDocument=$isSource;SourcePlanPath=if($isSource){$sourcePlanPath}else{$null};ExpectedSourcePages=if($isSource){[int]$sourcePlan.expectedPageCount}else{0};SourceManifestSha256=if($isSource){[string]$sourcePlan.sourceManifestSha256}else{$null};SelectionSha256=if($isSource){[string]$sourcePlan.selectionSha256}else{$null};SourceHtmlSha256=if($isSource){(Get-FileHash $sourceHtml -Algorithm SHA256).Hash.ToLowerInvariant()}else{$null};SourceTotalFiles=if($isSource){[int]$sourcePlan.totalFiles}else{0};SourceTotalLogicalLines=if($isSource){[int]$sourcePlan.totalLogicalLines}else{0};SourceTotalPrintLines=if($isSource){[int]$sourcePlan.totalPrintLines}else{0};PrototypeDocument=$false;ApplicationDocument=[bool]$definition.application;ApplicationTemplatePath=if($definition.application){$applicationTemplate}else{$null};SoftwareName=[string]$facts.software.name;Version=[string]$facts.software.version}
                $workPath=Join-Path $renderRoot ($definition.id+'.work.json');[IO.File]::WriteAllText($workPath,($workItem|ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false));Invoke-StandardMaterialWordExport $wordWorker $repository $workPath $workItem
            }
            Import-Module $qualityModule -Force -DisableNameChecking;$expectedScreenshots=@($facts.screenshots.captures|ForEach-Object{Join-Path $screenshots ([string]$_.fileName)});$receipt=Test-StandardDocumentSet -Facts $facts -DocumentRoot $documentRoot -ExpectedScreenshots $expectedScreenshots -SourcePlan $sourcePlan
            [IO.File]::WriteAllText((Join-Path $stage 'material-receipt.json'),($receipt|ConvertTo-Json -Depth 20),[Text.UTF8Encoding]::new($false))
        }
        try{[IO.Directory]::Move($stage,$output)}catch [IO.IOException]{if(Test-Path -LiteralPath $output){throw 'Refusing to overwrite material output.'};throw}
        $documentPaths=if($SkipDocumentExport){@()}else{@(Get-StandardMaterialDocumentDefinitions|ForEach-Object{Join-Path $output ('documents\'+$_.id+'.docx');if($_.pdf){Join-Path $output ('documents\'+$_.id+'.pdf')}})}
        return [pscustomobject]@{root=$output;factsPath=(Join-Path $output 'material-facts.json');receiptPath=if($SkipDocumentExport){$null}else{Join-Path $output 'material-receipt.json'};html=@($htmlNames|ForEach-Object{Join-Path $output ('rendered\'+$_)});diagrams=@($diagramResults|ForEach-Object{Join-Path $output ('rendered\diagrams\'+$_.fileName)});documents=$documentPaths;sourcePlan=$sourcePlan;receipt=$receipt}
    }finally{if(Test-Path -LiteralPath $stage){Remove-Item -LiteralPath $stage -Recurse -Force}}
}

Export-ModuleMember -Function Get-StandardScreenshotPlan,Build-StandardBusinessMaterials
