param(
    [switch]$IncludeInstallerIntegration,
    [switch]$SkipScreenshots
)

. "$PSScriptRoot\Assert.ps1"
$ErrorActionPreference = 'Stop'

$modulePath = Join-Path $PSScriptRoot '..\lib\BuildPipeline.psm1'
$fixtureRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'fixtures\valid-project'))
$edgePath = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$screenshotRoot = Join-Path $fixtureRoot 'materials\screenshots'

function Get-PngDimensions {
    param([Parameter(Mandatory)][IO.FileInfo]$File)

    $bytes = [IO.File]::ReadAllBytes($File.FullName)
    if ($bytes.Length -lt 24) { throw "PNG is too short: $($File.Name)" }
    Assert-Equal ([BitConverter]::ToString($bytes[0..7])) '89-50-4E-47-0D-0A-1A-0A'

    Add-Type -AssemblyName System.Drawing
    $bitmap = [Drawing.Bitmap]::new($File.FullName)
    try {
        return [pscustomobject]@{ Width = $bitmap.Width; Height = $bitmap.Height }
    }
    finally {
        $bitmap.Dispose()
    }
}

function Assert-HasNonBlankPixelSample {
    param([Parameter(Mandatory)][IO.FileInfo]$File)

    Add-Type -AssemblyName System.Drawing
    $bitmap = [Drawing.Bitmap]::new($File.FullName)
    try {
        $colorCounts = @{}
        $sampleCount = 0
        for ($x = 0; $x -lt $bitmap.Width; $x += [Math]::Max(1, [Math]::Floor($bitmap.Width / 20))) {
            for ($y = 0; $y -lt $bitmap.Height; $y += [Math]::Max(1, [Math]::Floor($bitmap.Height / 20))) {
                $color = $bitmap.GetPixel($x, $y).ToArgb().ToString()
                if ($colorCounts.ContainsKey($color)) { $colorCounts[$color]++ } else { $colorCounts[$color] = 1 }
                $sampleCount++
            }
        }
        $dominantRatio = ($colorCounts.Values | Measure-Object -Maximum).Maximum / $sampleCount
        Assert-Equal ($dominantRatio -le 0.98) $true
    }
    finally {
        $bitmap.Dispose()
    }
}

if (-not $SkipScreenshots) {
try {
    if (Test-Path -LiteralPath $screenshotRoot) {
        Remove-Item -LiteralPath $screenshotRoot -Recurse -Force
    }

    Import-Module $modulePath -Force -DisableNameChecking
    $outputs = @(Invoke-ScreenshotBuild -Context ([pscustomobject]@{ WorkspacePath = $fixtureRoot }) -EdgePath $edgePath)

    Assert-Equal $outputs.Count 5
    $expected = @(
        [pscustomobject]@{ Name = 'dashboard-desktop.png'; Width = 1440; Height = 1000 }
        [pscustomobject]@{ Name = 'records-desktop.png'; Width = 1440; Height = 1000 }
        [pscustomobject]@{ Name = 'operation-desktop.png'; Width = 1440; Height = 1000 }
        [pscustomobject]@{ Name = 'history-desktop.png'; Width = 1440; Height = 1000 }
        [pscustomobject]@{ Name = 'records-mobile.png'; Width = 390; Height = 844 }
    )
    foreach ($capture in $expected) {
        $file = Get-Item -LiteralPath (Join-Path $screenshotRoot $capture.Name)
        $dimensions = Get-PngDimensions $file
        Assert-Equal $dimensions.Width $capture.Width
        Assert-Equal $dimensions.Height $capture.Height
        Assert-HasNonBlankPixelSample $file
    }
}
finally {
    if (Test-Path -LiteralPath $screenshotRoot) {
        Remove-Item -LiteralPath $screenshotRoot -Recurse -Force
    }
}
}

$materialsToolPath = Join-Path $PSScriptRoot '..\template\tools\build-materials.ps1'
$materialOutputRoot = Join-Path $fixtureRoot 'materials\output'
$sourceTestRoot = Join-Path $env:TEMP ('materials-source-test-' + [Guid]::NewGuid().ToString('N'))

try {
    . $materialsToolPath -ProjectRoot $fixtureRoot -NoBuild

    $sourceFiles = @(Get-MaterialsSourceFiles -ProjectRoot $fixtureRoot)
    Assert-Equal (($sourceFiles | ForEach-Object { $_.FullName.Replace($fixtureRoot, '').TrimStart('\') }) -join '|') (
        'app\index.html|app\assets\styles.css|app\js\app.js|app\js\demo-data.js|app\js\domain.js|app\js\storage.js|app\tests\domain.test.js|app\tests\project.test.js|app\tests\storage.test.js|app\tests\ui-contract.test.js'
    )

    $sourceLines = @(Get-MaterialsSourceLines -Files $sourceFiles -ProjectRoot $fixtureRoot)
    $shortPagePlan = Get-MaterialsSourcePagePlan -PageCount 54
    Assert-Equal $shortPagePlan.TrimRequired $false
    Assert-Equal $shortPagePlan.ExpectedPageCount 54
    $longPagePlan = Get-MaterialsSourcePagePlan -PageCount 61
    Assert-Equal $longPagePlan.TrimRequired $true
    Assert-Equal $longPagePlan.MiddleStartPage 31
    Assert-Equal $longPagePlan.LastPartStartPage 32
    Assert-Equal $longPagePlan.ExpectedPageCount 60
    Assert-Equal (Get-Command Export-MaterialsHtml -ErrorAction Stop).CommandType 'Function'

    $workerContractPath = Join-Path $sourceTestRoot 'worker-items.json'
    New-Item -ItemType Directory -Path $sourceTestRoot -Force | Out-Null
    $sourceHtmlProbe = Join-Path $sourceTestRoot 'source-paragraphs.html'
    [void](New-MaterialsSourceHtml -Lines $sourceLines -Title 'Fixture Software V1.0' -OutputPath $sourceHtmlProbe)
    $sourceHtml = Get-Content -Raw -Encoding utf8 -LiteralPath $sourceHtmlProbe
    Assert-Equal ($sourceHtml -notmatch '(?i)<table|<tr|<td') $true
    Assert-Equal ([regex]::Matches($sourceHtml, '<p class="code-line">').Count) $sourceLines.Count
    Assert-Match $sourceHtml '@page\s*\{[^}]*size:\s*A4;[^}]*margin:\s*25\.4mm\s+31\.75mm;'
    Assert-Match $sourceHtml 'font-size:\s*9pt'
    Assert-Match $sourceHtml 'font-family:\s*"Times New Roman",\s*"SimSun",\s*serif'
    Assert-Match $sourceHtml '<p class="code-line">&#160;</p>'

    $printViewDocx = Join-Path $sourceTestRoot 'print-view.docx'
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $printViewArchive = [IO.Compression.ZipFile]::Open($printViewDocx, [IO.Compression.ZipArchiveMode]::Create)
    try {
        $settingsEntry = $printViewArchive.CreateEntry('word/settings.xml')
        $writer = [IO.StreamWriter]::new($settingsEntry.Open(), [Text.UTF8Encoding]::new($false))
        try { $writer.Write('<?xml version="1.0" encoding="UTF-8"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:view w:val="web"/></w:settings>') }
        finally { $writer.Dispose() }
    }
    finally { $printViewArchive.Dispose() }
    Set-MaterialsDocumentPrintView -Path $printViewDocx
    $printViewArchive = [IO.Compression.ZipFile]::OpenRead($printViewDocx)
    try {
        $reader = [IO.StreamReader]::new($printViewArchive.GetEntry('word/settings.xml').Open())
        try { $printViewXml = $reader.ReadToEnd() } finally { $reader.Dispose() }
    }
    finally { $printViewArchive.Dispose() }
    Assert-Match $printViewXml '<w:view w:val="print"'
    Assert-Equal ($printViewXml -match '<w:view w:val="web"') $false
    [IO.File]::WriteAllText($workerContractPath, '[{"HtmlPath":"one.html"},{"HtmlPath":"two.html"}]', [Text.UTF8Encoding]::new($false))
    $workerItems = @(Get-MaterialsWorkItems -WorkItemsPath $workerContractPath)
    Assert-Equal $workerItems.Count 2
    Assert-Equal $workerItems[0].HtmlPath 'one.html'
    Assert-Equal $workerItems[1].HtmlPath 'two.html'

    $renderInput = Join-Path $sourceTestRoot 'render-input.html'
    $renderOutput = Join-Path $sourceTestRoot 'render-output.html'
    [IO.File]::WriteAllText($renderInput, '<html><body><h1>@@SOFTWARE_TITLE@@</h1></body></html>', [Text.UTF8Encoding]::new($false))
    [void](New-MaterialsRenderedHtml -InputPath $renderInput -OutputPath $renderOutput -Title 'Fixture Software V1.0')
    $renderedHtml = Get-Content -Raw -Encoding UTF8 -LiteralPath $renderOutput
    Assert-Match $renderedHtml 'Fixture Software V1\.0'
    Assert-Equal ($renderedHtml -notmatch '@@SOFTWARE_TITLE@@') $true
    [void](New-MaterialsRenderedHtml -InputPath $renderInput -OutputPath $renderOutput -Title 'Fixture Software V1.0' -ScreenshotPaths $null)

    Add-Type -AssemblyName System.Drawing
    $screenshotPaths = @(1..5 | ForEach-Object {
        $path = Join-Path $sourceTestRoot ("screen-$_.png")
        $width = if ($_ -eq 5) { 390 } else { 1440 }
        $height = if ($_ -eq 5) { 844 } else { 1000 }
        $bitmap = [Drawing.Bitmap]::new($width, $height)
        try { $bitmap.Save($path, [Drawing.Imaging.ImageFormat]::Png) }
        finally { $bitmap.Dispose() }
        $path
    })
    $manualScreenshotPaths = @(Get-MaterialsManualScreenshotPaths -ScreenshotPaths @(
        $screenshotPaths[0..3]
        (Join-Path $sourceTestRoot 'records-mobile.png')
    ))
    Assert-Equal $manualScreenshotPaths.Count 4
    Assert-Equal (($manualScreenshotPaths | ForEach-Object { [IO.Path]::GetFileName($_) }) -join '|') 'screen-1.png|screen-2.png|screen-3.png|screen-4.png'
    [void](New-MaterialsRenderedHtml -InputPath $renderInput -OutputPath $renderOutput -Title 'Fixture Software V1.0' -ScreenshotPaths $screenshotPaths)
    $renderedHtml = Get-Content -Raw -Encoding UTF8 -LiteralPath $renderOutput
    Assert-Equal ([regex]::Matches($renderedHtml, '<img ').Count) 5
    Assert-Match $renderedHtml 'src="screenshots/screen-1\.png"'
    Assert-Match $renderedHtml 'src="screenshots/screen-1\.png"[^>]*width:415pt;height:288\.19pt'
    Assert-Match $renderedHtml 'src="screenshots/screen-5\.png"[^>]*width:292\.5pt;height:633pt'
    Assert-Equal @(Get-ChildItem -LiteralPath (Join-Path $sourceTestRoot 'screenshots') -File).Count 5

    $diagramRoot = Join-Path $sourceTestRoot 'diagram-assets'
    $diagramPaths = @(New-MaterialsPrototypeDiagrams -SoftwareName 'Fixture Software' -OutputDirectory $diagramRoot)
    Assert-Equal $diagramPaths.Count 3
    Assert-Equal (($diagramPaths | ForEach-Object Name) -join '|') 'system-architecture.png|database-schema.png|database-er.png'
    foreach ($diagram in $diagramPaths) {
        $dimensions = Get-PngDimensions -File $diagram
        Assert-Equal ($dimensions.Width -ge 1200) $true
        Assert-Equal ($dimensions.Height -ge 600) $true
        Assert-HasNonBlankPixelSample -File $diagram
    }

    $prototypeOutput = Join-Path $sourceTestRoot 'prototype-images.html'
    [void](New-MaterialsPrototypeHtml -Title 'Fixture Software V1.0' -OutputPath $prototypeOutput -ScreenshotPaths @($diagramPaths.FullName))
    $prototypeHtml = Get-Content -Raw -Encoding UTF8 -LiteralPath $prototypeOutput
    Assert-Equal ([regex]::Matches($prototypeHtml, '<section class="prototype-page').Count) 2
    Assert-Equal ([regex]::Matches($prototypeHtml, '<img ').Count) 3
    Assert-Match $prototypeHtml 'page-break-before:\s*always'
    Assert-Match $prototypeHtml '&#31995;&#32479;&#24635;&#20307;&#32467;&#26500;&#22270;'
    Assert-Match $prototypeHtml '&#25968;&#25454;&#24211;&#34920;&#32467;&#26500;&#22270;'
    Assert-Match $prototypeHtml 'E-R'
    Assert-Equal ($prototypeHtml -match '&#36719;&#20214;&#30028;&#38754;') $false
    Assert-Match $prototypeHtml 'src="prototype-diagrams/system-architecture\.png"'
    Assert-Equal ($prototypeHtml -match 'prototype-screenshots/') $false
    Assert-Equal @(Get-ChildItem -LiteralPath (Join-Path $sourceTestRoot 'prototype-diagrams') -File).Count 3

    New-Item -ItemType Directory -Path (Join-Path $sourceTestRoot 'app\assets') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $sourceTestRoot 'app\js') -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $sourceTestRoot 'app\index.html') -Value @(1..1501 | ForEach-Object { 'index' }) -Encoding utf8
    Set-Content -LiteralPath (Join-Path $sourceTestRoot 'app\assets\styles.css') -Value @(1..1500 | ForEach-Object { 'css' }) -Encoding utf8
    Set-Content -LiteralPath (Join-Path $sourceTestRoot 'app\js\app.js') -Value @('js', 'js') -Encoding utf8
    $largeLines = @(Get-MaterialsSourceLines -Files @(Get-MaterialsSourceFiles -ProjectRoot $sourceTestRoot) -ProjectRoot $sourceTestRoot)
    Assert-Equal $largeLines.Count 3003
    $largeSourceHtml = Join-Path $sourceTestRoot 'large-source.html'
    [void](New-MaterialsSourceHtml -Lines $largeLines -Title 'Large Fixture V1.0' -OutputPath $largeSourceHtml)
    Assert-Equal ([regex]::Matches((Get-Content -Raw -Encoding utf8 -LiteralPath $largeSourceHtml), '<p class="code-line">').Count) 3003

    $applicationInfo = Get-Content -Raw -Encoding utf8 (Join-Path (Split-Path -Parent $materialsToolPath) '..\materials\content\application-info.html')
    $applicantMarker = -join @(0x3010, 0x7533, 0x8BF7, 0x4EBA, 0x586B, 0x5199, 0x3011 | ForEach-Object { [char]$_ })
    Assert-Equal ([regex]::Matches($applicationInfo, '<tr(?:\s|>)').Count) 16
    Assert-Equal (([regex]::Matches($applicationInfo, 'rowspan\s*=').Count -ge 2)) $true
    Assert-Equal (([regex]::Matches($applicationInfo, 'colspan\s*=').Count -ge 2)) $true
    $developmentToolsLabel = -join @(0x8F6F, 0x4EF6, 0x5F00, 0x53D1, 0x73AF, 0x5883, 0x2F, 0x5F00, 0x53D1, 0x5DE5, 0x5177 | ForEach-Object { [char]$_ })
    $sourceQuantityLabel = -join @(0x6E90, 0x7A0B, 0x5E8F, 0x91CF | ForEach-Object { [char]$_ })
    Assert-Match $applicationInfo $developmentToolsLabel
    Assert-Match $applicationInfo $sourceQuantityLabel
    Assert-Match $applicationInfo ([regex]::Escape($applicantMarker))

    $applicationTemplatePath = Join-Path (Split-Path -Parent $materialsToolPath) '..\materials\application-form-template.docx'
    Assert-Equal (Test-Path -LiteralPath $applicationTemplatePath -PathType Leaf) $true
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $applicationArchive = [IO.Compression.ZipFile]::OpenRead($applicationTemplatePath)
    try {
        $appEntry = $applicationArchive.GetEntry('docProps/app.xml')
        $appReader = [IO.StreamReader]::new($appEntry.Open())
        try { [xml]$appXml = $appReader.ReadToEnd() } finally { $appReader.Dispose() }
        Assert-Equal ([int]$appXml.Properties.Pages) 2

        $documentEntry = $applicationArchive.GetEntry('word/document.xml')
        $documentReader = [IO.StreamReader]::new($documentEntry.Open())
        try { [xml]$applicationXml = $documentReader.ReadToEnd() } finally { $documentReader.Dispose() }
        $wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
        $namespaceManager = [Xml.XmlNamespaceManager]::new($applicationXml.NameTable)
        $namespaceManager.AddNamespace('w', $wordNamespace)
        $gridWidths = @($applicationXml.SelectNodes('//w:tbl[1]/w:tblGrid/w:gridCol', $namespaceManager) | ForEach-Object { $_.GetAttribute('w', $wordNamespace) })
        Assert-Equal ($gridWidths -join ',') '426,114,1388,52,3720,1029,831,370,1454,36'
        $rowHeights = @($applicationXml.SelectNodes('//w:tbl[1]/w:tr/w:trPr/w:trHeight', $namespaceManager) | ForEach-Object { $_.GetAttribute('val', $wordNamespace) })
        Assert-Equal ($rowHeights -join ',') '768,932,611,611,610,1555,1377,928,928,928,928,928,1262,1327,3417,3417'
        $pageMargins = $applicationXml.SelectSingleNode('//w:sectPr/w:pgMar', $namespaceManager)
        Assert-Equal (($pageMargins.GetAttribute('top', $wordNamespace), $pageMargins.GetAttribute('bottom', $wordNamespace), $pageMargins.GetAttribute('left', $wordNamespace), $pageMargins.GetAttribute('right', $wordNamespace)) -join ',') '1440,1440,1800,1800'
        $bookmarkNames = @($applicationXml.SelectNodes('//w:bookmarkStart', $namespaceManager) | ForEach-Object { $_.GetAttribute('name', $wordNamespace) } | Where-Object { $_ -like 'app_*' } | Sort-Object)
        $expectedBookmarks = @(
            'app_category', 'app_classification', 'app_company_date', 'app_completion_date',
            'app_development_hardware', 'app_development_os', 'app_development_purpose',
            'app_development_tools', 'app_industry', 'app_language', 'app_main_functions',
            'app_runtime_hardware', 'app_runtime_platform', 'app_runtime_support',
            'app_short_name', 'app_software_name', 'app_source_quantity',
            'app_technical_features', 'app_version'
        ) | Sort-Object
        Assert-Equal ($bookmarkNames -join ',') ($expectedBookmarks -join ',')
    }
    finally {
        $applicationArchive.Dispose()
    }

    Import-Module $modulePath -Force -DisableNameChecking
    Assert-Equal (Get-Command Invoke-MaterialsBuild -ErrorAction Stop).CommandType 'Function'
    Assert-Throws { Invoke-MaterialsBuild -Context ([pscustomobject]@{ WorkspacePath = (Join-Path $sourceTestRoot 'missing-workspace') }) } 'Materials workspace was not found'

    function global:powershell {
        param([Parameter(ValueFromRemainingArguments = $true)][object[]]$Arguments)
        New-Item -ItemType Directory -Path $materialOutputRoot -Force | Out-Null
        1..8 | ForEach-Object { [IO.File]::WriteAllText((Join-Path $materialOutputRoot ("material-$_.docx")), 'fixture') }
        $global:LASTEXITCODE = 0
        'child process progress that must not escape'
    }
    try {
        $materialResults = @(Invoke-MaterialsBuild -Context ([pscustomobject]@{ WorkspacePath = $fixtureRoot }))
        Assert-Equal $materialResults.Count 8
        Assert-Equal @($materialResults | Where-Object { $_ -isnot [IO.FileInfo] }).Count 0
    }
    finally {
        Remove-Item Function:\global:powershell -Force -ErrorAction SilentlyContinue
    }
}
finally {
    if (Test-Path -LiteralPath $sourceTestRoot) {
        Remove-Item -LiteralPath $sourceTestRoot -Recurse -Force
    }
    if (Test-Path -LiteralPath $materialOutputRoot) {
        Remove-Item -LiteralPath $materialOutputRoot -Recurse -Force
    }
}

$launcherToolPath = Join-Path $PSScriptRoot '..\template\tools\build-launcher.ps1'
$installerToolPath = Join-Path $PSScriptRoot '..\template\tools\build-installer.ps1'
$launcherSourcePath = Join-Path $PSScriptRoot '..\template\tools\Launcher.cs'
$installerLanguagePath = Join-Path $PSScriptRoot '..\template\installer\ChineseSimplified.isl'
$buildTestRoot = Join-Path $env:TEMP ('launcher-installer-test-' + [Guid]::NewGuid().ToString('N'))

try {
    $workspacePath = Join-Path $buildTestRoot 'workspace'
    Copy-Item -LiteralPath $fixtureRoot -Destination $workspacePath -Recurse
    $manifestPath = Join-Path $workspacePath 'project.json'
    $manifest = Get-Content -Raw -Encoding utf8 -LiteralPath $manifestPath | ConvertFrom-Json
    $manifest.softwareName = 'Fixture Software'
    $manifest.version = '2.5'
    $manifest.appId = '11111111-2222-3333-4444-555555555555'
    $manifest | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding utf8

    Import-Module $modulePath -Force -DisableNameChecking
    Assert-Equal (Get-Command Invoke-LauncherBuild -ErrorAction Stop).CommandType 'Function'
    Assert-Equal (Get-Command Invoke-InstallerBuild -ErrorAction Stop).CommandType 'Function'

    $launcherSource = Get-Content -Raw -Encoding utf8 -LiteralPath $launcherSourcePath
    Assert-Equal ($launcherSource -match 'AppDomain\.CurrentDomain\.BaseDirectory') $true
    Assert-Equal ($launcherSource -match 'GetManifestResourceStream|ZipArchive|Extract') $false
    Assert-Equal ((Get-Content -Raw -Encoding utf8 -LiteralPath $launcherToolPath) -match '/resource:') $false
    Assert-Equal (Test-Path -LiteralPath $installerLanguagePath -PathType Leaf) $true

    $launcherResult = Invoke-LauncherBuild -Context ([pscustomobject]@{ WorkspacePath = $workspacePath })
    Assert-Equal $launcherResult.GetType().FullName 'System.IO.FileInfo'
    Assert-Equal $launcherResult.Name 'Fixture Software.exe'
    $previousBrowserOverride = $env:SOFTWARE_LAUNCHER_BROWSER
    try {
        $env:SOFTWARE_LAUNCHER_BROWSER = Join-Path $buildTestRoot 'missing-browser.exe'
        $browserVerification = Start-Process -FilePath $launcherResult.FullName -ArgumentList '--verify' -Wait -PassThru -WindowStyle Hidden
        Assert-Equal $browserVerification.ExitCode 1
    }
    finally {
        $env:SOFTWARE_LAUNCHER_BROWSER = $previousBrowserOverride
    }

    $fakeIsccPath = Join-Path $buildTestRoot 'fake-iscc.ps1'
    Set-Content -LiteralPath $fakeIsccPath -Encoding utf8 -Value @'
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$CompilerArguments)
$issPath = $CompilerArguments[-1]
$iss = Get-Content -Raw -Encoding utf8 -LiteralPath $issPath
$outputDir = [regex]::Match($iss, '(?m)^OutputDir=(.+)$').Groups[1].Value.Trim()
$outputBase = [regex]::Match($iss, '(?m)^OutputBaseFilename=(.+)$').Groups[1].Value.Trim()
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $outputDir ($outputBase + '.exe')), 'installer')
'iscc output that must not escape'
'@
    $installerResult = Invoke-InstallerBuild -Context ([pscustomobject]@{ WorkspacePath = $workspacePath }) -ISCCPath $fakeIsccPath
    Assert-Equal $installerResult.GetType().FullName 'System.IO.FileInfo'
    $packageSuffix = -join @(0x5B89, 0x88C5, 0x5305 | ForEach-Object { [char]$_ })
    Assert-Equal $installerResult.Name ('Fixture Software V2.5 {0}.exe' -f $packageSuffix)

    $issPath = Join-Path $workspacePath 'installer\Fixture Software.iss'
    $iss = Get-Content -Raw -Encoding utf8 -LiteralPath $issPath
    Assert-Match $iss 'AppId=\{\{11111111-2222-3333-4444-555555555555\}'
    Assert-Match $iss 'PrivilegesRequired=lowest'
    Assert-Match $iss 'DefaultDirName=\{localappdata\}\\Programs\\Fixture Software'
    Assert-Match $iss '\[Icons\]'
    Assert-Match $iss 'Tasks: desktopicon'
    Assert-Match $iss 'UninstallDisplayName='
    Assert-Match $iss 'ChineseSimplified\.isl'
}
finally {
    if (Test-Path -LiteralPath $buildTestRoot) {
        Remove-Item -LiteralPath $buildTestRoot -Recurse -Force
    }
}

function New-InstallerLifecycleFixture {
    param([Parameter(Mandatory)][string]$Root, [string]$Mode = 'Success')

    New-Item -ItemType Directory -Path $Root -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $Root 'fixture-installer.exe'), 'installer')
    $workspacePath = Join-Path $Root 'workspace'
    Copy-Item -LiteralPath $fixtureRoot -Destination $workspacePath -Recurse
    $manifestPath = Join-Path $workspacePath 'project.json'
    $manifest = Get-Content -Raw -Encoding utf8 -LiteralPath $manifestPath | ConvertFrom-Json
    $manifest.softwareName = 'Lifecycle Fixture'
    $manifest.appId = '22222222-3333-4444-5555-666666666666'
    $manifest | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding utf8

    $state = [pscustomobject]@{
        Registered       = $false
        InstallArguments = @()
        InstallPath      = $null
        UninstallCalls   = 0
    }
    $runner = {
        param([string]$FilePath, [string[]]$Arguments)

        if ($FilePath -like '*fixture-installer.exe') {
            $state.InstallArguments = @($Arguments)
            if ($Mode -eq 'InstallFailure') { return [pscustomobject]@{ ExitCode = 9 } }

            $directoryArgument = @($Arguments | Where-Object { $_ -like '/DIR=*' })[0]
            $state.InstallPath = $directoryArgument.Substring(5)
            New-Item -ItemType Directory -Path $state.InstallPath -Force | Out-Null
            [IO.File]::WriteAllText((Join-Path $state.InstallPath 'Lifecycle Fixture.exe'), 'launcher')
            [IO.File]::WriteAllText((Join-Path $state.InstallPath 'unins000.exe'), 'uninstaller')
            foreach ($relativePath in @('app\index.html', 'app\assets\styles.css', 'app\js\domain.js', 'app\js\demo-data.js', 'app\js\storage.js', 'app\js\app.js')) {
                $path = Join-Path $state.InstallPath $relativePath
                New-Item -ItemType Directory -Path (Split-Path -Parent $path) -Force | Out-Null
                [IO.File]::WriteAllText($path, 'content')
            }
            if ($Mode -eq 'MissingInstalledFile') { Remove-Item -LiteralPath (Join-Path $state.InstallPath 'app\js\app.js') -Force }
            $state.Registered = $Mode -ne 'MissingRegistration'
            return [pscustomobject]@{ ExitCode = 0 }
        }

        if ($FilePath -like '*Lifecycle Fixture.exe') {
            return [pscustomobject]@{ ExitCode = $(if ($Mode -eq 'LauncherFailure') { 7 } else { 0 }) }
        }

        if ($FilePath -like '*unins000.exe') {
            $state.UninstallCalls++
            if ($Mode -ne 'ResidualDirectory') { Remove-Item -LiteralPath $state.InstallPath -Recurse -Force }
            if ($Mode -ne 'ResidualRegistration') { $state.Registered = $false }
            return [pscustomobject]@{ ExitCode = 0 }
        }

        throw "Unexpected lifecycle process: $FilePath"
    }.GetNewClosure()
    $registryReader = { param([string]$KeyPath) return $state.Registered }.GetNewClosure()
    [pscustomobject]@{
        Context        = [pscustomobject]@{ WorkspacePath = $workspacePath }
        InstallerPath  = (Join-Path $Root 'fixture-installer.exe')
        State          = $state
        ProcessRunner  = $runner
        RegistryReader = $registryReader
    }
}

$lifecycleTestRoot = Join-Path $env:TEMP ('installer-lifecycle-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $lifecycleTestRoot -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $lifecycleTestRoot 'fixture-installer.exe'), 'installer')

try {
    Import-Module $modulePath -Force -DisableNameChecking
    Assert-Equal (Get-Command Test-InstallerLifecycle -ErrorAction Stop).CommandType 'Function'

    $missingInstaller = New-InstallerLifecycleFixture -Root (Join-Path $lifecycleTestRoot 'missing-installer')
    Assert-Throws {
        Test-InstallerLifecycle -Context $missingInstaller.Context -InstallerPath (Join-Path $missingInstaller.Context.WorkspacePath 'missing.exe') -ProcessRunner $missingInstaller.ProcessRunner -RegistryReader $missingInstaller.RegistryReader
    } 'Installer was not found'

    # Removing the immediate install-failure return would make this test fail.
    $installFailure = New-InstallerLifecycleFixture -Root (Join-Path $lifecycleTestRoot 'install-failure') -Mode 'InstallFailure'
    Assert-Throws {
        Test-InstallerLifecycle -Context $installFailure.Context -InstallerPath $installFailure.InstallerPath -ProcessRunner $installFailure.ProcessRunner -RegistryReader $installFailure.RegistryReader
    } 'Installer failed with exit code 9'
    Assert-Equal $installFailure.State.UninstallCalls 0

    # Removing installed-file validation would make this test fail.
    $missingFile = New-InstallerLifecycleFixture -Root (Join-Path $lifecycleTestRoot 'missing-file') -Mode 'MissingInstalledFile'
    Assert-Throws {
        Test-InstallerLifecycle -Context $missingFile.Context -InstallerPath $missingFile.InstallerPath -ProcessRunner $missingFile.ProcessRunner -RegistryReader $missingFile.RegistryReader
    } 'Installed application file is missing'
    Assert-Equal $missingFile.State.UninstallCalls 1

    # Removing HKCU uninstall registration validation would make this test fail.
    $missingRegistration = New-InstallerLifecycleFixture -Root (Join-Path $lifecycleTestRoot 'missing-registration') -Mode 'MissingRegistration'
    Assert-Throws {
        Test-InstallerLifecycle -Context $missingRegistration.Context -InstallerPath $missingRegistration.InstallerPath -ProcessRunner $missingRegistration.ProcessRunner -RegistryReader $missingRegistration.RegistryReader
    } 'Uninstall registration was not created'
    Assert-Equal $missingRegistration.State.UninstallCalls 1

    # Ignoring the installed launcher exit code would make this test fail.
    $launcherFailure = New-InstallerLifecycleFixture -Root (Join-Path $lifecycleTestRoot 'launcher-failure') -Mode 'LauncherFailure'
    Assert-Throws {
        Test-InstallerLifecycle -Context $launcherFailure.Context -InstallerPath $launcherFailure.InstallerPath -ProcessRunner $launcherFailure.ProcessRunner -RegistryReader $launcherFailure.RegistryReader
    } 'Launcher self-check failed with exit code 7'
    Assert-Equal $launcherFailure.State.UninstallCalls 1

    # Checking cleanup only after forced cleanup would make this test fail.
    foreach ($mode in @('ResidualDirectory', 'ResidualRegistration')) {
        $residual = New-InstallerLifecycleFixture -Root (Join-Path $lifecycleTestRoot $mode) -Mode $mode
        Assert-Throws {
            Test-InstallerLifecycle -Context $residual.Context -InstallerPath $residual.InstallerPath -ProcessRunner $residual.ProcessRunner -RegistryReader $residual.RegistryReader
        } 'Uninstall cleanup was incomplete'
        Assert-Equal $residual.State.UninstallCalls 1
    }

    $success = New-InstallerLifecycleFixture -Root (Join-Path $lifecycleTestRoot 'success')
    $result = Test-InstallerLifecycle -Context $success.Context -InstallerPath $success.InstallerPath -ProcessRunner $success.ProcessRunner -RegistryReader $success.RegistryReader
    Assert-Equal $result.InstallExitCode 0
    Assert-Equal $result.InstalledFiles $true
    Assert-Equal $result.RegistrationCreated $true
    Assert-Equal $result.LauncherExitCode 0
    Assert-Equal $result.UninstallExitCode 0
    Assert-Equal $result.CleanupComplete $true
    Assert-Equal (@($success.State.InstallArguments) -join '|') ('/VERYSILENT|/SUPPRESSMSGBOXES|/NORESTART|/DIR=' + $success.State.InstallPath + '|/MERGETASKS=!desktopicon')
    Assert-Equal $success.State.InstallPath.StartsWith((Join-Path $success.Context.WorkspacePath 'installer-test\'), [StringComparison]::OrdinalIgnoreCase) $true
    Assert-Equal (Test-Path -LiteralPath (Join-Path $success.Context.WorkspacePath 'installer-test')) $false
}
finally {
    if (Test-Path -LiteralPath $lifecycleTestRoot) {
        Remove-Item -LiteralPath $lifecycleTestRoot -Recurse -Force
    }
}

if ($IncludeInstallerIntegration) {
    $integrationWorkspace = $env:INSTALLER_LIFECYCLE_WORKSPACE
    $integrationInstaller = $env:INSTALLER_LIFECYCLE_INSTALLER_PATH
    if ([string]::IsNullOrWhiteSpace($integrationWorkspace) -or [string]::IsNullOrWhiteSpace($integrationInstaller)) {
        throw 'Set INSTALLER_LIFECYCLE_WORKSPACE and INSTALLER_LIFECYCLE_INSTALLER_PATH before requesting installer integration.'
    }
    $integrationResult = Test-InstallerLifecycle -Context ([pscustomobject]@{ WorkspacePath = $integrationWorkspace }) -InstallerPath $integrationInstaller
    Assert-Equal $integrationResult.CleanupComplete $true
}
