Set-StrictMode -Version Latest

$script:ContractPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'config\standard-material-contract.json'
$script:TemplateRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'template-standard\materials\content'

function ConvertTo-MaterialHtmlText {
    param($Value)
    return [Net.WebUtility]::HtmlEncode([string]$Value)
}

function Assert-SafeMaterialText {
    param([Parameter(Mandatory)][string]$Value, [Parameter(Mandatory)][string]$Name)
    if ($Value -match '(?i)gh[pousr]_[A-Za-z0-9_]{16,}' -or $Value -match '(?i)(password|token)\s*[:=]\s*\S+' -or
        $Value -match '(?i)([A-Z]:\\|file://|https?://|\\\\[^\\]+\\)') {
        throw "Unsafe value was rejected for material field '$Name'."
    }
}

function ConvertTo-HtmlList {
    param([object[]]$Items, [scriptblock]$Renderer)
    if (@($Items).Count -eq 0) { return '<p>无。</p>' }
    return '<ul>' + ((@($Items) | ForEach-Object { '<li>' + (& $Renderer $_) + '</li>' }) -join '') + '</ul>'
}

function Get-StandardScreenshotPlan {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Blueprint)

    $modules = @($Blueprint.modules | Where-Object { $_.id -ne 'maintenance' })
    if ($modules.Count -eq 0) { throw 'Blueprint has no business modules for screenshots.' }
    $primary = @($modules | Where-Object { @($_.actions) -contains 'view' })[0]
    if ($null -eq $primary) { $primary = $modules[0] }
    $actionModule = @($modules | Where-Object { @($_.actions | Where-Object { $_ -notin @('list','view','create','update') }).Count -gt 0 })[0]
    if ($null -eq $actionModule) { $actionModule = $primary }
    $action = @($actionModule.actions | Where-Object { $_ -notin @('list','view','create','update') })[0]
    if ([string]::IsNullOrWhiteSpace([string]$action)) { $action = @($actionModule.actions)[0] }
    $secondary = @($modules | Where-Object id -ne $primary.id)[0]
    if ($null -eq $secondary) { $secondary = $primary }

    return @(
        [pscustomobject]@{ id='dashboard'; kind='dashboard'; moduleId=$null; actionId=$null; fileName='dashboard-desktop.png'; viewport='desktop' },
        [pscustomobject]@{ id=('list-' + $primary.id); kind='list'; moduleId=[string]$primary.id; actionId='list'; fileName='records-desktop.png'; viewport='desktop' },
        [pscustomobject]@{ id=('detail-' + $primary.id); kind='detail'; moduleId=[string]$primary.id; actionId='view'; fileName='detail-desktop.png'; viewport='desktop' },
        [pscustomobject]@{ id=('action-' + $actionModule.id + '-' + $action); kind='action'; moduleId=[string]$actionModule.id; actionId=[string]$action; fileName='operation-desktop.png'; viewport='desktop' },
        [pscustomobject]@{ id=('mobile-' + $secondary.id); kind='list'; moduleId=[string]$secondary.id; actionId='list'; fileName='records-mobile.png'; viewport='mobile' }
    )
}

function New-RenderedMaterialHtml {
    param(
        [Parameter(Mandatory)][string]$TemplatePath,
        [Parameter(Mandatory)][hashtable]$Values,
        [Parameter(Mandatory)][string]$OutputPath
    )
    $content = [IO.File]::ReadAllText($TemplatePath, [Text.UTF8Encoding]::new($false))
    foreach ($key in $Values.Keys) { $content = $content.Replace('{{' + $key + '}}', [string]$Values[$key]) }
    $unresolved = [regex]::Match($content, '\{\{[A-Z_]+\}\}')
    if ($unresolved.Success) { throw "Material template contains unresolved token '$($unresolved.Value)'." }
    [IO.File]::WriteAllText($OutputPath, $content, [Text.UTF8Encoding]::new($false))
    return $OutputPath
}

function New-SourceMaterialHtml {
    param(
        [Parameter(Mandatory)]$SourceManifest,
        [Parameter(Mandatory)][string]$Title,
        [Parameter(Mandatory)][string]$OutputPath,
        [string]$RepositoryRoot
    )
    $builder = [Text.StringBuilder]::new('<!doctype html><html><head><meta charset="UTF-8"><title>')
    [void]$builder.Append((ConvertTo-MaterialHtmlText $Title)).Append('</title></head><body><h1>').Append((ConvertTo-MaterialHtmlText $Title)).Append(' 源程序清单</h1>')
    [void]$builder.Append('<p>以下内容来自生成与源码归档共同使用的确定性清单。</p>')
    foreach ($file in @($SourceManifest.files)) {
        [void]$builder.Append('<h2>').Append((ConvertTo-MaterialHtmlText $file.path)).Append('</h2>')
        if ([string]::IsNullOrWhiteSpace($RepositoryRoot)) {
            [void]$builder.Append('<p class="code-line">').Append((ConvertTo-MaterialHtmlText ('{0} lines | sha256:{1}' -f $file.lines,$file.sha256))).Append('</p>')
            continue
        }
        $root = [IO.Path]::GetFullPath($RepositoryRoot).TrimEnd('\')
        $sourcePath = [IO.Path]::GetFullPath((Join-Path $root ([string]$file.path).Replace('/','\')))
        if (-not $sourcePath.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Source manifest path escaped the repository root.' }
        if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { throw "Manifest source file is missing: $($file.path)" }
        $actualHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actualHash -cne [string]$file.sha256) { throw "Manifest source file changed: $($file.path)" }
        $lineNumber = 0
        foreach ($line in [IO.File]::ReadAllLines($sourcePath, [Text.UTF8Encoding]::new($false))) {
            $lineNumber++
            [void]$builder.Append('<p class="code-line">').Append((ConvertTo-MaterialHtmlText ('{0,5}  {1}' -f $lineNumber,$line))).Append('</p>')
        }
    }
    [void]$builder.Append('</body></html>')
    [IO.File]::WriteAllText($OutputPath, $builder.ToString(), [Text.UTF8Encoding]::new($false))
}

function Build-StandardBusinessMaterials {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$OutputDirectory,
        [Parameter(Mandatory)]$Blueprint,
        [Parameter(Mandatory)]$Template,
        [Parameter(Mandatory)]$Profile,
        [Parameter(Mandatory)]$ProjectLock,
        [Parameter(Mandatory)]$ScreenshotManifest,
        [Parameter(Mandatory)]$SourceManifest,
        [Parameter(Mandatory)]$VerificationReceipt,
        [switch]$SkipDocumentExport,
        [string]$RepositoryRoot,
        [string]$ScreenshotRoot,
        [string]$WordWorkerPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'template\tools\word-export-worker.ps1')
    )

    $contract = Get-Content -Raw -Encoding UTF8 -LiteralPath $script:ContractPath | ConvertFrom-Json
    if ($contract.contractVersion -ne '1.0') { throw 'Unsupported standard material contract.' }
    if ([string]$VerificationReceipt.status -ne 'passed') { throw 'Materials require a passed verification receipt.' }
    $modules = @($Blueprint.modules)
    $moduleIds = @($modules | ForEach-Object id)
    $captures = @($ScreenshotManifest.captures)
    foreach ($kind in @($contract.requiredCaptureKinds)) {
        if (@($captures | Where-Object kind -eq $kind).Count -eq 0) { throw "Screenshot manifest is missing '$kind'." }
    }
    if ($captures.Count -gt [int]$contract.captureLimit) { throw 'Screenshot manifest exceeds the capture limit.' }
    foreach ($capture in $captures) {
        if ($null -ne $capture.moduleId -and $moduleIds -cnotcontains [string]$capture.moduleId) { throw "Screenshot references unknown module '$($capture.moduleId)'." }
        if ([string]$capture.sha256 -notmatch '^[0-9a-f]{64}$') { throw 'Screenshot hash is invalid.' }
    }
    foreach ($pair in @(
        @('softwareName',[string]$Profile.softwareName), @('purpose',[string]$Profile.purpose), @('industry',[string]$Profile.industry),
        @('software.name',[string]$Blueprint.software.name), @('software.version',[string]$Blueprint.software.version)
    )) { Assert-SafeMaterialText -Name $pair[0] -Value $pair[1] }

    $output = [IO.Path]::GetFullPath($OutputDirectory)
    if (Test-Path -LiteralPath $output) { throw "Refusing to overwrite material output: $output" }
    $renderRoot = Join-Path $output 'rendered'
    $documentRoot = Join-Path $output 'documents'
    New-Item -ItemType Directory -Path $renderRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $documentRoot -Force | Out-Null
    try {
        $moduleHtml = ConvertTo-HtmlList $modules { param($item) (ConvertTo-MaterialHtmlText ('{0}（{1}）：{2}' -f $item.name,$item.id,(@($item.actions) -join '、'))) }
        $workflowHtml = ConvertTo-HtmlList @($Blueprint.workflows) { param($item) (ConvertTo-MaterialHtmlText ('{0}：{1}' -f $item.name,(@($item.states) -join ' → '))) }
        $roleHtml = ConvertTo-HtmlList @($Blueprint.roles) { param($item) (ConvertTo-MaterialHtmlText ('{0}（{1}）' -f $item.name,$item.id)) }
        $boundaryHtml = ConvertTo-HtmlList @($Blueprint.software.boundaries) { param($item) (ConvertTo-MaterialHtmlText $item) }
        $captureItems = [Collections.Generic.List[string]]::new()
        if (-not $SkipDocumentExport) {
            if ([string]::IsNullOrWhiteSpace($ScreenshotRoot)) { throw 'ScreenshotRoot is required for document export.' }
            $screenshotOutput = Join-Path $renderRoot 'screenshots'
            New-Item -ItemType Directory -Path $screenshotOutput -Force | Out-Null
            $captureRoot = [IO.Path]::GetFullPath($ScreenshotRoot).TrimEnd('\')
            foreach ($capture in $captures) {
                $sourcePath = [IO.Path]::GetFullPath((Join-Path $captureRoot ([string]$capture.path)))
                if (-not $sourcePath.StartsWith($captureRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { throw 'Screenshot manifest contains an invalid path.' }
                if ((Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant() -cne [string]$capture.sha256) { throw "Screenshot changed after capture: $($capture.id)" }
                $name = [IO.Path]::GetFileName($sourcePath)
                Copy-Item -LiteralPath $sourcePath -Destination (Join-Path $screenshotOutput $name)
                $caption = ConvertTo-MaterialHtmlText ('{0} / module={1} / action={2}' -f $capture.id,$capture.moduleId,$capture.actionId)
                $captureItems.Add(('<figure><img src="screenshots/{0}" style="max-width:100%"><figcaption>{1}</figcaption></figure>' -f (ConvertTo-MaterialHtmlText $name),$caption))
            }
        }
        else {
            foreach ($capture in $captures) { $captureItems.Add((ConvertTo-MaterialHtmlText ('{0} / module={1} / action={2}' -f $capture.id,$capture.moduleId,$capture.actionId))) }
        }
        $captureHtml = if ($SkipDocumentExport) { '<ul>' + (($captureItems | ForEach-Object { '<li>' + $_ + '</li>' }) -join '') + '</ul>' } else { $captureItems -join '' }
        $values = @{
            TITLE=ConvertTo-MaterialHtmlText $Blueprint.software.name; VERSION=ConvertTo-MaterialHtmlText $Blueprint.software.version
            PURPOSE=ConvertTo-MaterialHtmlText $Profile.purpose; INDUSTRY=ConvertTo-MaterialHtmlText $Profile.industry
            MODULES=$moduleHtml; WORKFLOWS=$workflowHtml; ROLES=$roleHtml; BOUNDARIES=$boundaryHtml
            SCREENSHOTS=$captureHtml; SCREENSHOT_PLAN=$captureHtml; SOURCE_LINES=[string]$SourceManifest.totalLines; SOURCE_FILES=[string]$SourceManifest.totalFiles
            RUNTIME_VERSION=ConvertTo-MaterialHtmlText $ProjectLock.desktopRuntimeVersion; ELECTRON_VERSION=ConvertTo-MaterialHtmlText $ProjectLock.electronVersion
            DATABASE_VERSION=ConvertTo-MaterialHtmlText $ProjectLock.databaseSchemaVersion; VERIFICATION_STATUS='passed'; BUSINESS_ROWS=ConvertTo-MaterialHtmlText $VerificationReceipt.businessRows
        }
        $html = [Collections.Generic.List[string]]::new()
        foreach ($name in @('manual','application-info','runtime','prototype')) {
            $path = Join-Path $renderRoot ($name + '.html')
            [void]$html.Add((New-RenderedMaterialHtml -TemplatePath (Join-Path $script:TemplateRoot ($name + '.html')) -Values $values -OutputPath $path))
        }
        $sourceHtml = Join-Path $renderRoot 'source.html'
        if (-not $SkipDocumentExport -and [string]::IsNullOrWhiteSpace($RepositoryRoot)) { throw 'RepositoryRoot is required for source document export.' }
        New-SourceMaterialHtml -SourceManifest $SourceManifest -Title ([string]$Blueprint.software.name) -OutputPath $sourceHtml -RepositoryRoot $RepositoryRoot
        if ($SkipDocumentExport) { return [pscustomobject]@{ html=$html.ToArray(); documents=@(); sourceHtml=$sourceHtml } }

        if (-not (Test-Path -LiteralPath $WordWorkerPath -PathType Leaf)) { throw 'Word material worker was not found.' }
        $definitions = @(
            [pscustomobject]@{ id='manual'; html=(Join-Path $renderRoot 'manual.html'); pdf=$true; source=$false },
            [pscustomobject]@{ id='source'; html=$sourceHtml; pdf=$true; source=$true },
            [pscustomobject]@{ id='application-info'; html=(Join-Path $renderRoot 'application-info.html'); pdf=$true; source=$false },
            [pscustomobject]@{ id='runtime'; html=(Join-Path $renderRoot 'runtime.html'); pdf=$false; source=$false },
            [pscustomobject]@{ id='prototype'; html=(Join-Path $renderRoot 'prototype.html'); pdf=$false; source=$false }
        )
        $documents = [Collections.Generic.List[string]]::new()
        foreach ($definition in $definitions) {
            $docx = Join-Path $documentRoot ($definition.id + '.docx')
            $pdf = if ($definition.pdf) { Join-Path $documentRoot ($definition.id + '.pdf') } else { $null }
            $workItem = [pscustomobject]@{ HtmlPath=$definition.html; DocxPath=$docx; PdfPath=$pdf; SourceDocument=$definition.source; PrototypeDocument=$false; ApplicationDocument=$false; SoftwareName=[string]$Blueprint.software.name; Version=[string]$Blueprint.software.version }
            $workPath = Join-Path $renderRoot ($definition.id + '.work.json')
            [IO.File]::WriteAllText($workPath, ($workItem | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
            $workerOutput = (& powershell -NoProfile -ExecutionPolicy Bypass -File $WordWorkerPath -ProjectRoot $output -WorkItemsPath $workPath 2>&1 | Out-String)
            if ($LASTEXITCODE -ne 0) { throw "Word material export failed for $($definition.id): $($workerOutput.Trim())" }
            [void]$documents.Add($docx); if ($null -ne $pdf) { [void]$documents.Add($pdf) }
        }
        foreach ($path in $documents) { if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Material document is missing: $path" } }
        return [pscustomobject]@{ html=$html.ToArray(); documents=$documents.ToArray(); sourceHtml=$sourceHtml }
    }
    catch {
        if (Test-Path -LiteralPath $output) { Remove-Item -LiteralPath $output -Recurse -Force }
        throw
    }
}

Export-ModuleMember -Function Get-StandardScreenshotPlan, Build-StandardBusinessMaterials
