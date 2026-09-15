[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ProjectRoot,
    [switch]$NoBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-MaterialsSourceFiles {
    param([Parameter(Mandatory)][string]$ProjectRoot)

    $root = [IO.Path]::GetFullPath($ProjectRoot)
    $paths = @(
        (Join-Path $root 'app\index.html')
    )
    foreach ($directory in @('app\assets', 'app\js', 'app\tests')) {
        $path = Join-Path $root $directory
        if (Test-Path -LiteralPath $path -PathType Container) {
            $paths += @(Get-ChildItem -LiteralPath $path -File -Filter $(if ($directory -eq 'app\assets') { '*.css' } else { '*.js' }) | Sort-Object Name | ForEach-Object FullName)
        }
    }
    $files = @($paths | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | ForEach-Object { Get-Item -LiteralPath $_ })
    if ($files.Count -eq 0) { throw 'No allowed application source files were found.' }
    return $files
}

function Get-MaterialsSourceLines {
    param(
        [Parameter(Mandatory)][IO.FileInfo[]]$Files,
        [Parameter(Mandatory)][string]$ProjectRoot
    )

    $root = [IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\') + '\'
    $lines = [Collections.Generic.List[object]]::new()
    foreach ($file in $Files) {
        $text = [IO.File]::ReadAllText($file.FullName, [Text.UTF8Encoding]::new($false))
        $fileLines = [Text.RegularExpressions.Regex]::Split($text, "`r`n|`n|`r")
        if ($text -match "(?:`r`n|`n|`r)$") { $fileLines = $fileLines[0..($fileLines.Count - 2)] }
        $relative = $file.FullName.Substring($root.Length).Replace('/', '\')
        for ($index = 0; $index -lt $fileLines.Count; $index++) {
            $lines.Add([pscustomobject]@{ File = $relative; Number = $index + 1; Text = $fileLines[$index] })
        }
    }
    return $lines.ToArray()
}

function Get-MaterialsSourcePagePlan {
    param([Parameter(Mandatory)][ValidateRange(1, [int]::MaxValue)][int]$PageCount)

    if ($PageCount -le 60) {
        return [pscustomobject]@{
            TrimRequired     = $false
            MiddleStartPage  = $null
            LastPartStartPage = $null
            ExpectedPageCount = $PageCount
        }
    }
    return [pscustomobject]@{
        TrimRequired      = $true
        MiddleStartPage   = 31
        LastPartStartPage = $PageCount - 29
        ExpectedPageCount = 60
    }
}

function New-MaterialsSourceHtml {
    param(
        [Parameter(Mandatory)][object[]]$Lines,
        [Parameter(Mandatory)][string]$Title,
        [Parameter(Mandatory)][string]$OutputPath
    )

    if ($Lines.Count -eq 0) { throw 'Application source files contain no lines.' }
    $builder = [Text.StringBuilder]::new()
    [void]$builder.AppendLine('<!doctype html><html><head><meta charset="UTF-8">')
    [void]$builder.AppendLine(('<title>{0}</title><style>' -f [Net.WebUtility]::HtmlEncode($Title)))
    [void]$builder.AppendLine('@page { size: A4; margin: 25.4mm 31.75mm; } html, body { margin: 0; padding: 0; } body { font-family: "Times New Roman", "SimSun", serif; font-size: 9pt; line-height: 1; } p.code-line { margin: 0; padding: 0; white-space: pre-wrap; overflow-wrap: anywhere; }</style></head><body>')
    foreach ($line in $Lines) {
        $encodedLine = [Net.WebUtility]::HtmlEncode($line.Text).Replace("`t", '    ')
        if ($encodedLine.Length -eq 0) { $encodedLine = '&#160;' }
        [void]$builder.AppendLine(('<p class="code-line">{0}</p>' -f $encodedLine))
    }
    [void]$builder.AppendLine('</body></html>')
    [IO.File]::WriteAllText($OutputPath, $builder.ToString(), [Text.UTF8Encoding]::new($false))
    return [pscustomobject]@{ SelectedLineCount = $Lines.Count }
}

function New-MaterialsPrototypeDiagrams {
    param(
        [Parameter(Mandatory)][string]$SoftwareName,
        [Parameter(Mandatory)][string]$OutputDirectory
    )

    Add-Type -AssemblyName System.Drawing
    New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
    $titleFont = [Drawing.Font]::new('Microsoft YaHei', 28, [Drawing.FontStyle]::Bold, [Drawing.GraphicsUnit]::Pixel)
    $sectionFont = [Drawing.Font]::new('Microsoft YaHei', 22, [Drawing.FontStyle]::Bold, [Drawing.GraphicsUnit]::Pixel)
    $bodyFont = [Drawing.Font]::new('Microsoft YaHei', 17, [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
    $smallFont = [Drawing.Font]::new('Microsoft YaHei', 15, [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
    $whiteBrush = [Drawing.SolidBrush]::new([Drawing.Color]::White)
    $textBrush = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(35, 45, 52))
    $mutedBrush = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(85, 96, 104))
    $linePen = [Drawing.Pen]::new([Drawing.Color]::FromArgb(73, 91, 99), 3)
    $centerFormat = [Drawing.StringFormat]::new()
    $centerFormat.Alignment = [Drawing.StringAlignment]::Center
    $centerFormat.LineAlignment = [Drawing.StringAlignment]::Center
    $outputs = [Collections.Generic.List[IO.FileInfo]]::new()
    $decode = { param([string]$Value) [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Value)) }
    $labels = @{
        Architecture = & $decode '57O757uf5oC75L2T57uT5p6E5Zu+'
        Overview = & $decode '5pWw5o2u5oC76KeI5qih5Z2X'
        OverviewDetail = & $decode '5oyH5qCH57uf6K6hIC8g54q25oCB55uR5o6n'
        Records = & $decode '5Lia5Yqh6K6w5b2V5qih5Z2X'
        RecordsDetail = & $decode '6K6w5b2V57u05oqkIC8g5p2h5Lu25qOA57Si'
        Tasks = & $decode '5Lu75Yqh5aSE55CG5qih5Z2X'
        TasksDetail = & $decode '6KeE5YiZ5Yy56YWNIC8g5Lu75Yqh5omn6KGM'
        History = & $decode '5Y6G5Y+y6L+96Liq5qih5Z2X'
        HistoryDetail = & $decode '5pel5b+X5p+l6K+iIC8g57uT5p6c6L+95rqv'
        DataAccess = & $decode '57uf5LiA5pWw5o2u6K6/6Zeu'
        Validation = & $decode '5p2D6ZmQ5LiO5qCh6aqM'
        Cooperation = & $decode '5ZCE5Yqf6IO95qih5Z2X6YCa6L+H57uf5LiA5pWw5o2u5qih5Z6L5Y2P5ZCM5bel5L2c'
        Schema = & $decode '5pWw5o2u5bqT6KGo57uT5p6E5Zu+'
        SchemaNote = & $decode 'UEvvvJrkuLvplK4gICAgRkvvvJrlpJbplK4gICAg5a2X5q6157G75Z6L55So5LqO6KGo6L6+6YC76L6R5pWw5o2u57qm5p2f'
        ErDiagram = & $decode '5pWw5o2u5bqTIEUtUiDlhbPns7vlm74='
        RecordEntity = & $decode '5Lia5Yqh6K6w5b2V'
        TaskEntity = & $decode '5aSE55CG5Lu75Yqh'
        RuleEntity = & $decode '5Lia5Yqh6KeE5YiZ'
        LogEntity = & $decode '5pON5L2c5pel5b+X'
        RelationNote = & $decode '5LiA5p2h5Lia5Yqh6K6w5b2V5Y+v5Lqn55Sf5aSa5Liq5aSE55CG5Lu75Yqh77yb5Lu75Yqh5oyJ6KeE5YiZ5omn6KGM5bm25b2i5oiQ5pON5L2c5pel5b+X'
    }

    $newCanvas = {
        param([int]$Width, [int]$Height)
        $bitmap = [Drawing.Bitmap]::new($Width, $Height, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $graphics = [Drawing.Graphics]::FromImage($bitmap)
        $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.TextRenderingHint = [Drawing.Text.TextRenderingHint]::ClearTypeGridFit
        $graphics.Clear([Drawing.Color]::White)
        return [pscustomobject]@{ Bitmap = $bitmap; Graphics = $graphics }
    }
    $drawHeader = {
        param([Drawing.Graphics]$Graphics, [int]$Width, [string]$Heading)
        $headerBrush = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(38, 55, 64))
        try {
            $Graphics.FillRectangle($headerBrush, 0, 0, $Width, 88)
            $Graphics.DrawString($Heading, $titleFont, $whiteBrush, [Drawing.RectangleF]::new(24, 0, $Width - 48, 88), $centerFormat)
        }
        finally { $headerBrush.Dispose() }
    }
    $drawCard = {
        param(
            [Drawing.Graphics]$Graphics,
            [Drawing.RectangleF]$Rectangle,
            [string]$Heading,
            [string[]]$Lines,
            [Drawing.Color]$Accent
        )
        $bodyBrush = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(246, 248, 248))
        $accentBrush = [Drawing.SolidBrush]::new($Accent)
        $borderPen = [Drawing.Pen]::new([Drawing.Color]::FromArgb(155, 164, 168), 2)
        try {
            $Graphics.FillRectangle($bodyBrush, $Rectangle)
            $Graphics.DrawRectangle($borderPen, $Rectangle.X, $Rectangle.Y, $Rectangle.Width, $Rectangle.Height)
            $Graphics.FillRectangle($accentBrush, $Rectangle.X, $Rectangle.Y, $Rectangle.Width, 58)
            $Graphics.DrawString($Heading, $sectionFont, $whiteBrush, [Drawing.RectangleF]::new($Rectangle.X + 8, $Rectangle.Y, $Rectangle.Width - 16, 58), $centerFormat)
            $lineY = $Rectangle.Y + 76
            foreach ($line in $Lines) {
                $Graphics.DrawString($line, $smallFont, $textBrush, $Rectangle.X + 18, $lineY)
                $lineY += 40
            }
        }
        finally { $bodyBrush.Dispose(); $accentBrush.Dispose(); $borderPen.Dispose() }
    }

    try {
        $canvas = & $newCanvas 1400 650
        try {
            $graphics = $canvas.Graphics
            & $drawHeader $graphics 1400 $labels.Architecture
            $rootRectangle = [Drawing.RectangleF]::new(445, 120, 510, 82)
            $rootBrush = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(26, 127, 115))
            try { $graphics.FillRectangle($rootBrush, $rootRectangle) } finally { $rootBrush.Dispose() }
            $graphics.DrawString($SoftwareName, $sectionFont, $whiteBrush, $rootRectangle, $centerFormat)
            $graphics.DrawLine($linePen, 700, 202, 700, 280)
            $graphics.DrawLine($linePen, 190, 280, 1210, 280)
            $modules = @(
                [pscustomobject]@{ X = 55; Title = $labels.Overview; Detail = $labels.OverviewDetail; Color = [Drawing.Color]::FromArgb(52, 120, 155) },
                [pscustomobject]@{ X = 385; Title = $labels.Records; Detail = $labels.RecordsDetail; Color = [Drawing.Color]::FromArgb(26, 127, 115) },
                [pscustomobject]@{ X = 715; Title = $labels.Tasks; Detail = $labels.TasksDetail; Color = [Drawing.Color]::FromArgb(194, 105, 63) },
                [pscustomobject]@{ X = 1045; Title = $labels.History; Detail = $labels.HistoryDetail; Color = [Drawing.Color]::FromArgb(112, 94, 135) }
            )
            foreach ($module in $modules) {
                $graphics.DrawLine($linePen, $module.X + 150, 280, $module.X + 150, 330)
                & $drawCard $graphics ([Drawing.RectangleF]::new($module.X, 330, 300, 190)) $module.Title @($module.Detail, $labels.DataAccess, $labels.Validation) $module.Color
            }
            $graphics.DrawString($labels.Cooperation, $bodyFont, $mutedBrush, [Drawing.RectangleF]::new(100, 555, 1200, 45), $centerFormat)
            $path = Join-Path $OutputDirectory 'system-architecture.png'
            $canvas.Bitmap.Save($path, [Drawing.Imaging.ImageFormat]::Png)
            $outputs.Add((Get-Item -LiteralPath $path))
        }
        finally { $canvas.Graphics.Dispose(); $canvas.Bitmap.Dispose() }

        $canvas = & $newCanvas 1400 720
        try {
            $graphics = $canvas.Graphics
            & $drawHeader $graphics 1400 $labels.Schema
            $tables = @(
                [pscustomobject]@{ X = 35; Name = 'biz_record'; Color = [Drawing.Color]::FromArgb(52, 120, 155); Fields = @('PK  id            BIGINT', '    record_no     VARCHAR(64)', '    record_name   VARCHAR(128)', '    record_type   VARCHAR(32)', '    status        VARCHAR(24)', '    created_at    DATETIME', '    updated_at    DATETIME') },
                [pscustomobject]@{ X = 375; Name = 'biz_task'; Color = [Drawing.Color]::FromArgb(26, 127, 115); Fields = @('PK  id            BIGINT', 'FK  record_id     BIGINT', '    task_no       VARCHAR(64)', '    priority      INT', '    task_status   VARCHAR(24)', '    executed_at   DATETIME', '    created_at    DATETIME') },
                [pscustomobject]@{ X = 715; Name = 'biz_rule'; Color = [Drawing.Color]::FromArgb(194, 105, 63); Fields = @('PK  id            BIGINT', '    rule_name     VARCHAR(128)', '    match_value   VARCHAR(255)', '    target_value  VARCHAR(255)', '    enabled       TINYINT', '    sort_no       INT', '    updated_at    DATETIME') },
                [pscustomobject]@{ X = 1055; Name = 'sys_operation_log'; Color = [Drawing.Color]::FromArgb(112, 94, 135); Fields = @('PK  id            BIGINT', 'FK  task_id       BIGINT', '    action_type   VARCHAR(32)', '    result_code   VARCHAR(24)', '    message       VARCHAR(500)', '    operator      VARCHAR(64)', '    created_at    DATETIME') }
            )
            foreach ($table in $tables) { & $drawCard $graphics ([Drawing.RectangleF]::new($table.X, 122, 310, 480)) $table.Name $table.Fields $table.Color }
            $graphics.DrawString($labels.SchemaNote, $bodyFont, $mutedBrush, [Drawing.RectangleF]::new(70, 630, 1260, 45), $centerFormat)
            $path = Join-Path $OutputDirectory 'database-schema.png'
            $canvas.Bitmap.Save($path, [Drawing.Imaging.ImageFormat]::Png)
            $outputs.Add((Get-Item -LiteralPath $path))
        }
        finally { $canvas.Graphics.Dispose(); $canvas.Bitmap.Dispose() }

        $canvas = & $newCanvas 1400 620
        try {
            $graphics = $canvas.Graphics
            & $drawHeader $graphics 1400 $labels.ErDiagram
            $record = [Drawing.RectangleF]::new(70, 240, 270, 180)
            $task = [Drawing.RectangleF]::new(455, 240, 270, 180)
            $rule = [Drawing.RectangleF]::new(1060, 125, 270, 180)
            $log = [Drawing.RectangleF]::new(1060, 365, 270, 180)
            & $drawCard $graphics $record $labels.RecordEntity @('id (PK)', 'record_no', 'record_name') ([Drawing.Color]::FromArgb(52, 120, 155))
            & $drawCard $graphics $task $labels.TaskEntity @('id (PK)', 'record_id (FK)', 'task_status') ([Drawing.Color]::FromArgb(26, 127, 115))
            & $drawCard $graphics $rule $labels.RuleEntity @('id (PK)', 'rule_name', 'target_value') ([Drawing.Color]::FromArgb(194, 105, 63))
            & $drawCard $graphics $log $labels.LogEntity @('id (PK)', 'task_id (FK)', 'result_code') ([Drawing.Color]::FromArgb(112, 94, 135))
            $graphics.DrawLine($linePen, 340, 330, 455, 330)
            $graphics.DrawString('1', $bodyFont, $textBrush, 355, 292)
            $graphics.DrawString('N', $bodyFont, $textBrush, 425, 292)
            $graphics.DrawLine($linePen, 725, 300, 1060, 215)
            $graphics.DrawString('N', $bodyFont, $textBrush, 750, 250)
            $graphics.DrawString('1', $bodyFont, $textBrush, 1020, 180)
            $graphics.DrawLine($linePen, 725, 360, 1060, 455)
            $graphics.DrawString('1', $bodyFont, $textBrush, 750, 368)
            $graphics.DrawString('N', $bodyFont, $textBrush, 1020, 438)
            $graphics.DrawString($labels.RelationNote, $bodyFont, $mutedBrush, [Drawing.RectangleF]::new(80, 555, 1240, 42), $centerFormat)
            $path = Join-Path $OutputDirectory 'database-er.png'
            $canvas.Bitmap.Save($path, [Drawing.Imaging.ImageFormat]::Png)
            $outputs.Add((Get-Item -LiteralPath $path))
        }
        finally { $canvas.Graphics.Dispose(); $canvas.Bitmap.Dispose() }
    }
    finally {
        $titleFont.Dispose(); $sectionFont.Dispose(); $bodyFont.Dispose(); $smallFont.Dispose()
        $whiteBrush.Dispose(); $textBrush.Dispose(); $mutedBrush.Dispose(); $linePen.Dispose(); $centerFormat.Dispose()
    }
    return $outputs.ToArray()
}

function New-MaterialsPrototypeHtml {
    param(
        [Parameter(Mandatory)][string]$Title,
        [Parameter(Mandatory)][string]$OutputPath,
        [Parameter(Mandatory)][ValidateCount(3, 3)][string[]]$ScreenshotPaths
    )

    $imageRoot = Join-Path (Split-Path -Parent $OutputPath) 'prototype-diagrams'
    New-Item -ItemType Directory -Path $imageRoot -Force | Out-Null
    $relativePaths = foreach ($path in $ScreenshotPaths) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Prototype screenshot was not found: $path" }
        $fileName = [IO.Path]::GetFileName($path)
        Copy-Item -LiteralPath $path -Destination (Join-Path $imageRoot $fileName) -Force
        'prototype-diagrams/' + $fileName
    }

    $encodedTitle = [Net.WebUtility]::HtmlEncode($Title)
    $html = @"
<!doctype html><html><head><meta charset="UTF-8"><title>$encodedTitle</title><style>
@page { size: A4; margin: 16mm 16mm 14mm; }
html, body { margin: 0; padding: 0; color: #111; font-family: "Microsoft YaHei", "SimSun", sans-serif; }
.prototype-page { box-sizing: border-box; width: 100%; page-break-inside: avoid; }
.prototype-page + .prototype-page { page-break-before: always; }
h1 { margin: 0 0 7mm; text-align: center; font-size: 18pt; font-weight: 600; }
h2 { margin: 0 0 4mm; font-size: 13pt; font-weight: 600; }
figure { margin: 0 0 5mm; page-break-inside: avoid; text-align: center; }
img { display: block; max-width: 100%; width: auto; height: auto; margin: 0 auto; }
p { margin: 0 0 5mm; font-family: "SimSun", serif; font-size: 10.5pt; line-height: 1.6; text-indent: 2em; }
figcaption { margin-top: 2mm; font-family: "SimSun", serif; font-size: 10.5pt; }
</style></head><body>
<section class="prototype-page primary"><h1>$encodedTitle</h1><h2>&#31995;&#32479;&#24635;&#20307;&#32467;&#26500;&#22270;</h2><p>&#31995;&#32479;&#25353;&#29031;&#25968;&#25454;&#23637;&#31034;&#12289;&#19994;&#21153;&#35760;&#24405;&#12289;&#20219;&#21153;&#22788;&#29702;&#21644;&#21382;&#21490;&#36861;&#36394;&#36827;&#34892;&#21151;&#33021;&#21010;&#20998;&#65292;&#21508;&#27169;&#22359;&#20849;&#20139;&#32479;&#19968;&#30340;&#36923;&#36753;&#25968;&#25454;&#27169;&#22411;&#12290;</p><figure><img src="$($relativePaths[0])" alt="system architecture"><figcaption>&#22270;1 &#31995;&#32479;&#24635;&#20307;&#32467;&#26500;&#22270;</figcaption></figure></section>
<section class="prototype-page secondary"><h2>&#31995;&#32479;&#31867;&#22270;&#19982;&#25968;&#25454;&#24211;&#35774;&#35745;</h2><p>&#19979;&#22270;&#23637;&#31034;&#31995;&#32479;&#26680;&#24515;&#36923;&#36753;&#34920;&#30340;&#23383;&#27573;&#32467;&#26500;&#20197;&#21450;&#20027;&#35201;&#23454;&#20307;&#20043;&#38388;&#30340;&#20851;&#32852;&#20851;&#31995;&#12290;</p><figure><img src="$($relativePaths[1])" alt="database schema"><figcaption>&#22270;2 &#25968;&#25454;&#24211;&#34920;&#32467;&#26500;&#22270;</figcaption></figure><figure><img src="$($relativePaths[2])" alt="database er"><figcaption>&#22270;3 &#25968;&#25454;&#24211; E-R &#20851;&#31995;&#22270;</figcaption></figure></section>
</body></html>
"@
    [IO.File]::WriteAllText($OutputPath, $html, [Text.UTF8Encoding]::new($false))
    return Get-Item -LiteralPath $OutputPath
}

function Get-MaterialsManualScreenshotPaths {
    param([Parameter(Mandatory)][string[]]$ScreenshotPaths)

    return @($ScreenshotPaths | Where-Object { [IO.Path]::GetFileNameWithoutExtension($_) -notmatch '-mobile$' })
}

function New-MaterialsRenderedHtml {
    param(
        [Parameter(Mandatory)][string]$InputPath,
        [Parameter(Mandatory)][string]$OutputPath,
        [Parameter(Mandatory)][string]$Title,
        [string]$SoftwareName,
        [AllowEmptyCollection()][string[]]$ScreenshotPaths = @()
    )

    $html = Get-Content -Raw -Encoding UTF8 -LiteralPath $InputPath
    $encodedTitle = [Net.WebUtility]::HtmlEncode($Title)
    $html = $html.Replace('@@SOFTWARE_TITLE@@', $encodedTitle)
    if (-not [string]::IsNullOrWhiteSpace($SoftwareName)) {
        $html = $html.Replace('@@SOFTWARE_NAME@@', [Net.WebUtility]::HtmlEncode($SoftwareName))
    }
    if (-not $html.Contains($Title)) {
        $body = [regex]::Match($html, '(?i)<body[^>]*>')
        if (-not $body.Success) { throw "Material HTML has no body element: $InputPath" }
        $html = $html.Insert($body.Index + $body.Length, "<h1>$encodedTitle</h1>")
    }

    if ($null -ne $ScreenshotPaths -and $ScreenshotPaths.Length -gt 0) {
        $figures = [Text.StringBuilder]::new('<section class="generated-screenshots"><h2>Software screenshots</h2>')
        $renderedScreenshotRoot = Join-Path (Split-Path -Parent $OutputPath) 'screenshots'
        New-Item -ItemType Directory -Path $renderedScreenshotRoot -Force | Out-Null
        foreach ($screenshotPath in $ScreenshotPaths) {
            if (-not (Test-Path -LiteralPath $screenshotPath -PathType Leaf)) { throw "Screenshot was not found: $screenshotPath" }
            $fileName = [IO.Path]::GetFileName($screenshotPath)
            Copy-Item -LiteralPath $screenshotPath -Destination (Join-Path $renderedScreenshotRoot $fileName) -Force
            $relativeSource = 'screenshots/' + $fileName
            $caption = [Net.WebUtility]::HtmlEncode([IO.Path]::GetFileNameWithoutExtension($fileName))
            Add-Type -AssemblyName System.Drawing
            $image = [Drawing.Image]::FromFile($screenshotPath)
            try {
                $displayWidth = [Math]::Min(415.0, $image.Width * 0.75)
                $displayHeight = $displayWidth * $image.Height / [double]$image.Width
            }
            finally { $image.Dispose() }
            $culture = [Globalization.CultureInfo]::InvariantCulture
            $widthText = $displayWidth.ToString('0.##', $culture)
            $heightText = $displayHeight.ToString('0.##', $culture)
            [void]$figures.Append("<figure><img src=`"$relativeSource`" alt=`"$caption`" style=`"width:${widthText}pt;height:${heightText}pt;page-break-inside:avoid`"><figcaption>$caption</figcaption></figure>")
        }
        [void]$figures.Append('</section>')
        $closingBody = $html.LastIndexOf('</body>', [StringComparison]::OrdinalIgnoreCase)
        if ($closingBody -lt 0) { throw "Material HTML has no closing body element: $InputPath" }
        $html = $html.Insert($closingBody, $figures.ToString())
    }

    [IO.File]::WriteAllText($OutputPath, $html, [Text.UTF8Encoding]::new($false))
    return Get-Item -LiteralPath $OutputPath
}

function Assert-MaterialsDocument {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][ValidateSet('Docx', 'Pdf')][string]$Kind)
    $bytes = [IO.File]::ReadAllBytes($Path)
    if ($Kind -eq 'Pdf') {
        if ($bytes.Length -lt 5 -or [Text.Encoding]::ASCII.GetString($bytes, 0, 5) -ne '%PDF-') { throw "Invalid PDF: $Path" }
        return
    }
    if ($bytes.Length -lt 4 -or $bytes[0] -ne 0x50 -or $bytes[1] -ne 0x4B) { throw "Invalid DOCX ZIP signature: $Path" }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($Path)
    try {
        if ($null -eq $archive.GetEntry('word/document.xml')) { throw "DOCX is missing word/document.xml: $Path" }
    }
    finally { $archive.Dispose() }
}

function Assert-MaterialsEmbeddedMedia {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][int]$ExpectedCount
    )

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($Path)
    try {
        $mediaCount = @($archive.Entries | Where-Object { $_.FullName -like 'word/media/*' -and -not [string]::IsNullOrWhiteSpace($_.Name) }).Count
        if ($mediaCount -ne $ExpectedCount) { throw "DOCX contains $mediaCount embedded media files; expected $ExpectedCount`: $Path" }
    }
    finally { $archive.Dispose() }
}

function Set-MaterialsDocumentPrintView {
    param([Parameter(Mandatory)][string]$Path)

    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::Open($Path, [IO.Compression.ZipArchiveMode]::Update)
    try {
        $settingsEntry = $archive.GetEntry('word/settings.xml')
        if ($null -eq $settingsEntry) { throw "DOCX is missing word/settings.xml: $Path" }
        $reader = [IO.StreamReader]::new($settingsEntry.Open(), [Text.Encoding]::UTF8, $true)
        try { $settingsXml = $reader.ReadToEnd() } finally { $reader.Dispose() }

        $xml = [Xml.XmlDocument]::new()
        $xml.PreserveWhitespace = $true
        $xml.LoadXml($settingsXml)
        $wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
        $namespaces = [Xml.XmlNamespaceManager]::new($xml.NameTable)
        $namespaces.AddNamespace('w', $wordNamespace)
        $view = $xml.SelectSingleNode('/w:settings/w:view', $namespaces)
        if ($null -eq $view) {
            $view = $xml.CreateElement('w', 'view', $wordNamespace)
            [void]$xml.DocumentElement.PrependChild($view)
        }
        [void]$view.SetAttribute('val', $wordNamespace, 'print')

        $settingsEntry.Delete()
        $replacement = $archive.CreateEntry('word/settings.xml', [IO.Compression.CompressionLevel]::Optimal)
        $writerSettings = [Xml.XmlWriterSettings]::new()
        $writerSettings.Encoding = [Text.UTF8Encoding]::new($false)
        $writerSettings.Indent = $false
        $writer = [Xml.XmlWriter]::Create($replacement.Open(), $writerSettings)
        try { $xml.Save($writer) } finally { $writer.Dispose() }
    }
    finally { $archive.Dispose() }
}

function Assert-MaterialsSourceDocument {
    param([Parameter(Mandatory)][string]$Path)

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($Path)
    try {
        $documentEntry = $archive.GetEntry('word/document.xml')
        $reader = [IO.StreamReader]::new($documentEntry.Open(), [Text.Encoding]::UTF8, $true)
        try { $documentXml = $reader.ReadToEnd() } finally { $reader.Dispose() }
        if ($documentXml -match '<w:tbl(?:\s|>)') { throw "Source DOCX must use paragraphs, not tables: $Path" }

        $headerEntries = @($archive.Entries | Where-Object { $_.FullName -match '^word/header\d+\.xml$' })
        if ($headerEntries.Count -eq 0) { throw "Source DOCX is missing its Word header: $Path" }
        $hasPageField = $false
        foreach ($entry in $headerEntries) {
            $headerReader = [IO.StreamReader]::new($entry.Open(), [Text.Encoding]::UTF8, $true)
            try { $headerXml = $headerReader.ReadToEnd() } finally { $headerReader.Dispose() }
            if ($headerXml -match 'PAGE') { $hasPageField = $true }
        }
        if (-not $hasPageField) { throw "Source DOCX header is missing its page-number field: $Path" }

        $settingsEntry = $archive.GetEntry('word/settings.xml')
        if ($null -eq $settingsEntry) { throw "Source DOCX is missing word/settings.xml: $Path" }
        $settingsReader = [IO.StreamReader]::new($settingsEntry.Open(), [Text.Encoding]::UTF8, $true)
        try { $settingsXml = $settingsReader.ReadToEnd() } finally { $settingsReader.Dispose() }
        if ($settingsXml -notmatch '<w:view\s+[^>]*w:val="print"') { throw "Source DOCX must open in print layout: $Path" }
    }
    finally { $archive.Dispose() }
}

function Close-MaterialsWordSession {
    param(
        [object]$Word,
        [Parameter(Mandatory)][AllowEmptyCollection()][Collections.Generic.List[object]]$OpenDocuments
    )

    foreach ($document in $OpenDocuments) {
        try { $document.Close($false) } catch { }
        try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($document) } catch { }
    }
    if ($null -ne $Word) {
        try { $Word.Quit() } catch { }
        try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($Word) } catch { }
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}

function Get-MaterialsApplicationFormValues {
    param([Parameter(Mandatory)][string]$HtmlPath)

    $html = Get-Content -Raw -Encoding UTF8 -LiteralPath $HtmlPath
    $pattern = @'
(?is)<td\b(?=[^>]*\bdata-field\s*=\s*["'](?<name>[a-z0-9_]+)["'])[^>]*>(?<value>.*?)</td>
'@
    $values = @{}
    foreach ($match in [regex]::Matches($html, $pattern.Trim())) {
        $name = $match.Groups['name'].Value
        $valueHtml = [regex]::Replace($match.Groups['value'].Value, '(?i)<br\s*/?>', "`r")
        $valueText = [Net.WebUtility]::HtmlDecode([regex]::Replace($valueHtml, '<[^>]+>', ''))
        $values[$name] = $valueText.Trim()
    }
    if ($values.Count -ne 19) {
        throw "Application form HTML must provide 19 data-field values; found $($values.Count)."
    }
    return $values
}

function Export-MaterialsApplicationForm {
    param(
        [Parameter(Mandatory)][object]$Word,
        [Parameter(Mandatory)][AllowEmptyCollection()][Collections.Generic.List[object]]$OpenDocuments,
        [Parameter(Mandatory)][string]$HtmlPath,
        [Parameter(Mandatory)][string]$TemplatePath,
        [Parameter(Mandatory)][string]$DocxPath,
        [string]$PdfPath
    )

    if (-not (Test-Path -LiteralPath $TemplatePath -PathType Leaf)) {
        throw "Application form template was not found: $TemplatePath"
    }
    $values = Get-MaterialsApplicationFormValues -HtmlPath $HtmlPath
    $document = $Word.Documents.Open((Resolve-Path -LiteralPath $TemplatePath).Path, $false, $true)
    $OpenDocuments.Add($document)
    foreach ($fieldName in $values.Keys) {
        $bookmarkName = "app_$fieldName"
        if (-not $document.Bookmarks.Exists($bookmarkName)) {
            throw "Application form template is missing bookmark: $bookmarkName"
        }
        $range = $document.Bookmarks.Item($bookmarkName).Range
        $range.Text = [string]$values[$fieldName]
        [void]$document.Bookmarks.Add($bookmarkName, $range)
    }
    $document.Repaginate()
    $pageCount = [int]$document.ComputeStatistics(2)
    if ($pageCount -ne 2) {
        throw "Application form has $pageCount pages after filling the sample template; expected 2."
    }
    $document.SaveAs2($DocxPath, 12)
    if (-not [string]::IsNullOrWhiteSpace($PdfPath)) { $document.ExportAsFixedFormat($PdfPath, 17) }
}

function Export-MaterialsHtml {
    param(
        [Parameter(Mandatory)][object]$Word,
        [Parameter(Mandatory)][AllowEmptyCollection()][Collections.Generic.List[object]]$OpenDocuments,
        [Parameter(Mandatory)][string]$HtmlPath,
        [Parameter(Mandatory)][string]$DocxPath,
        [string]$PdfPath,
        [switch]$SourceDocument,
        [switch]$PrototypeDocument,
        [switch]$ApplicationDocument,
        [string]$ApplicationTemplatePath,
        [string]$SoftwareName,
        [string]$Version
    )

    if ($ApplicationDocument) {
        Export-MaterialsApplicationForm -Word $Word -OpenDocuments $OpenDocuments -HtmlPath $HtmlPath -TemplatePath $ApplicationTemplatePath -DocxPath $DocxPath -PdfPath $PdfPath
        return
    }
    $document = $Word.Documents.Open((Resolve-Path -LiteralPath $HtmlPath).Path, $false, $true)
    $OpenDocuments.Add($document)
    if ($SourceDocument) {
        $eastAsianFont = -join @([char]0x5B8B, [char]0x4F53)
        if ([string]::IsNullOrWhiteSpace($SoftwareName) -or [string]::IsNullOrWhiteSpace($Version)) { throw 'Source document export requires software name and version.' }
        if ($document.Tables.Count -ne 0) { throw 'Source document HTML unexpectedly produced a Word table.' }

        $document.PageSetup.PageWidth = 595.3
        $document.PageSetup.PageHeight = 841.9
        $document.PageSetup.TopMargin = 72
        $document.PageSetup.BottomMargin = 72
        $document.PageSetup.LeftMargin = 90
        $document.PageSetup.RightMargin = 90
        $document.PageSetup.HeaderDistance = 42.55
        $document.PageSetup.FooterDistance = 49.6
        $document.Content.Font.Name = 'Times New Roman'
        $document.Content.Font.NameFarEast = $eastAsianFont
        $document.Content.Font.Size = 9
        $document.Content.ParagraphFormat.SpaceBefore = 0
        $document.Content.ParagraphFormat.SpaceAfter = 0
        $document.Content.ParagraphFormat.LineSpacingRule = 0
        $document.Content.ParagraphFormat.WidowControl = 0

        $header = $document.Sections.Item(1).Headers.Item(1)
        $document.Sections.Item(1).Footers.Item(1).Exists = $false
        $pagePrefix = -join @([char]0x7B2C)
        $pageSuffix = -join @([char]0x9875)
        $header.Range.Text = "$SoftwareName`t$pagePrefix PAGE_PLACEHOLDER $pageSuffix`tV$Version"
        $pageFieldRange = $header.Range.Duplicate
        if (-not $pageFieldRange.Find.Execute('PAGE_PLACEHOLDER')) { throw 'Could not create the source document page-number field.' }
        $pageFieldRange.Text = ''
        [void]$header.Range.Fields.Add($pageFieldRange, -1, 'PAGE', $true)
        $header.Range.Font.Name = 'Times New Roman'
        $header.Range.Font.NameFarEast = $eastAsianFont
        $header.Range.Font.Size = 9
        $headerParagraph = $header.Range.Paragraphs.Item(1)
        $headerParagraph.Format.TabStops.ClearAll()
        $usableWidth = $document.PageSetup.PageWidth - $document.PageSetup.LeftMargin - $document.PageSetup.RightMargin
        [void]$headerParagraph.Format.TabStops.Add($usableWidth / 2, 1, 0)
        [void]$headerParagraph.Format.TabStops.Add($usableWidth, 2, 0)
        $headerParagraph.Borders.Item(-3).LineStyle = 7
        $headerParagraph.Borders.Item(-3).LineWidth = 4
        $document.Repaginate()
        $pagePlan = Get-MaterialsSourcePagePlan -PageCount ([int]$document.ComputeStatistics(2))
        if ($pagePlan.TrimRequired) {
            $middleStart = $document.GoTo(1, 1, $pagePlan.MiddleStartPage)
            $lastPartStart = $document.GoTo(1, 1, $pagePlan.LastPartStartPage)
            $middleRange = $document.Range($middleStart.Start, $lastPartStart.Start)
            $middleRange.Delete()
            $document.Repaginate()
        }
        $actualPageCount = [int]$document.ComputeStatistics(2)
        if ($actualPageCount -ne $pagePlan.ExpectedPageCount) {
            throw "Source document has $actualPageCount pages after formatting; expected $($pagePlan.ExpectedPageCount)."
        }
        foreach ($field in $header.Range.Fields) { [void]$field.Update() }
    }
    if ($PrototypeDocument) {
        $document.PageSetup.PageWidth = 595.3
        $document.PageSetup.PageHeight = 841.9
        $document.PageSetup.TopMargin = 45.35
        $document.PageSetup.BottomMargin = 39.7
        $document.PageSetup.LeftMargin = 45.35
        $document.PageSetup.RightMargin = 45.35
        $prototypeImagePaths = [Collections.Generic.List[string]]::new()
        for ($fieldIndex = 1; $fieldIndex -le $document.Fields.Count; $fieldIndex++) {
            $field = $document.Fields.Item($fieldIndex)
            if ($field.Code.Text -match 'INCLUDEPICTURE') {
                $pathMatch = [regex]::Match($field.Code.Text, '"([^"]+)"')
                if (-not $pathMatch.Success) { throw "Could not read prototype image path from field $fieldIndex." }
                $prototypeImagePaths.Add($pathMatch.Groups[1].Value)
            }
        }
        for ($fieldIndex = $document.Fields.Count; $fieldIndex -ge 1; $fieldIndex--) {
            $field = $document.Fields.Item($fieldIndex)
            if ($field.Code.Text -match 'INCLUDEPICTURE') { $field.Unlink() }
        }
        if ($prototypeImagePaths.Count -ne 3 -or $document.InlineShapes.Count -ne 3) { throw "Prototype document must contain exactly three image fields." }
        for ($imageIndex = 1; $imageIndex -le 3; $imageIndex++) {
            $shape = $document.InlineShapes.Item($imageIndex)
            $sourcePath = $prototypeImagePaths[$imageIndex - 1]
            $imageRange = $shape.Range.Duplicate
            $imageStart = $imageRange.Start
            $shape.Delete()
            $imageRange.SetRange($imageStart, $imageStart)
            $shape = $document.InlineShapes.AddPicture($sourcePath, $false, $true, $imageRange)
            Add-Type -AssemblyName System.Drawing
            $image = [Drawing.Image]::FromFile($sourcePath)
            try { $aspectRatio = $image.Height / [double]$image.Width } finally { $image.Dispose() }
            $targetWidth = if ($imageIndex -eq 1) { 500.0 } else { 470.0 }
            $shape.LockAspectRatio = 0
            $shape.Width = $targetWidth
            $shape.Height = $targetWidth * $aspectRatio
            $shape.LockAspectRatio = -1
        }
        $document.Repaginate()
        $prototypePages = [int]$document.ComputeStatistics(2)
        if ($prototypePages -ne 2) { throw "Prototype document has $prototypePages pages; expected 2." }
    }
    $document.SaveAs2($DocxPath, 12)
    if (-not [string]::IsNullOrWhiteSpace($PdfPath)) { $document.ExportAsFixedFormat($PdfPath, 17) }
}

function Get-MaterialsWorkItems {
    param([Parameter(Mandatory)][string]$WorkItemsPath)

    $parsed = Get-Content -Raw -Encoding UTF8 -LiteralPath $WorkItemsPath | ConvertFrom-Json
    if ($parsed -is [Array]) { return $parsed | ForEach-Object { $_ } }
    return ,$parsed
}

function Invoke-MaterialsWordWorker {
    param([Parameter(Mandatory)][string]$WorkItemsPath)

    $items = @(Get-MaterialsWorkItems -WorkItemsPath $WorkItemsPath)
    if ($items.Count -eq 0 -or $items.Count -gt 2) { throw 'A Word worker must receive one or two material items.' }
    $word = $null
    $openDocuments = [Collections.Generic.List[object]]::new()
    try {
        $word = New-Object -ComObject Word.Application
        $word.Visible = $false
        $word.DisplayAlerts = 0
        foreach ($item in $items) {
            $parameters = @{
                Word = $word
                OpenDocuments = $openDocuments
                HtmlPath = [string]$item.HtmlPath
                DocxPath = [string]$item.DocxPath
                PdfPath = if ($null -eq $item.PdfPath) { $null } else { [string]$item.PdfPath }
            }
            if ([bool]$item.SourceDocument) { $parameters.SourceDocument = $true }
            if ($null -ne $item.PSObject.Properties['PrototypeDocument'] -and [bool]$item.PrototypeDocument) { $parameters.PrototypeDocument = $true }
            if ($null -ne $item.PSObject.Properties['ApplicationDocument'] -and [bool]$item.ApplicationDocument) {
                $parameters.ApplicationDocument = $true
                $parameters.ApplicationTemplatePath = [string]$item.ApplicationTemplatePath
            }
            if ($null -ne $item.PSObject.Properties['SoftwareName']) { $parameters.SoftwareName = [string]$item.SoftwareName }
            if ($null -ne $item.PSObject.Properties['Version']) { $parameters.Version = [string]$item.Version }
            Export-MaterialsHtml @parameters
        }
    }
    finally {
        Close-MaterialsWordSession -Word $word -OpenDocuments $openDocuments
    }
    foreach ($item in $items) {
        if ([bool]$item.SourceDocument -or ($null -ne $item.PSObject.Properties['PrototypeDocument'] -and [bool]$item.PrototypeDocument)) {
            Set-MaterialsDocumentPrintView -Path ([string]$item.DocxPath)
        }
    }
}

function ConvertFrom-CodePoints { param([int[]]$Values) return -join @($Values | ForEach-Object { [char]$_ }) }

function Invoke-MaterialsToolBuild {
    $root = [IO.Path]::GetFullPath($ProjectRoot)
    $manifestPath = Join-Path $root 'project.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "Project manifest was not found: $manifestPath" }
    $manifest = Get-Content -Raw -Encoding utf8 -LiteralPath $manifestPath | ConvertFrom-Json
    if ([string]::IsNullOrWhiteSpace($manifest.softwareName) -or [string]::IsNullOrWhiteSpace($manifest.version)) { throw 'project.json must contain softwareName and version.' }
    $contentRoot = Join-Path $root 'materials\content'
    $outputRoot = Join-Path $root 'materials\output'
    $renderRoot = Join-Path $root ('temp\materials-render-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $renderRoot -Force | Out-Null
    $sourceHtml = Join-Path $renderRoot 'source-material.html'
    $title = '{0} V{1}' -f $manifest.softwareName, $manifest.version
    $manual = ConvertFrom-CodePoints @(0x64CD,0x4F5C,0x624B,0x518C)
    $source = ConvertFrom-CodePoints @(0x6E90,0x7801)
    $application = ConvertFrom-CodePoints @(0x7533,0x8BF7,0x8868)
    $runtime = ConvertFrom-CodePoints @(0x8FD0,0x884C,0x73AF,0x5883)
    $prototype = ConvertFrom-CodePoints @(0x539F,0x578B,0x8BBE,0x8BA1,0x56FE)
    $exports = @(
        [pscustomobject]@{ Html = 'manual.html'; Name = $manual; Pdf = $true },
        [pscustomobject]@{ Html = 'source-material.html'; Name = $source; Pdf = $true },
        [pscustomobject]@{ Html = 'application-info.html'; Name = $application; Pdf = $true },
        [pscustomobject]@{ Html = 'runtime.html'; Name = $runtime; Pdf = $false },
        [pscustomobject]@{ Html = 'prototype.html'; Name = $prototype; Pdf = $false }
    )
    foreach ($export in $exports) { if (-not (Test-Path -LiteralPath (Join-Path $contentRoot $export.Html) -PathType Leaf) -and $export.Html -ne 'source-material.html') { throw "Material input was not found: $($export.Html)" } }
    New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
    $created = [Collections.Generic.List[string]]::new()
    try {
        $sourceLines = @(Get-MaterialsSourceLines -Files @(Get-MaterialsSourceFiles -ProjectRoot $root) -ProjectRoot $root)
        [void](New-MaterialsSourceHtml -Lines $sourceLines -Title $title -OutputPath $sourceHtml)
        $prototypeAssets = @(New-MaterialsPrototypeDiagrams -SoftwareName ([string]$manifest.softwareName) -OutputDirectory (Join-Path $renderRoot 'prototype-assets'))
        $expectedScreenshots = @('dashboard-desktop.png', 'records-desktop.png', 'operation-desktop.png', 'history-desktop.png', 'records-mobile.png')
        $screenshotPaths = @($expectedScreenshots | ForEach-Object { Join-Path $root "materials\screenshots\$_" })
        $existingScreenshotCount = @($screenshotPaths | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf }).Count
        if ($existingScreenshotCount -ne $expectedScreenshots.Count) { throw "Expected all five screenshots; found $existingScreenshotCount." }
        foreach ($export in $exports | Where-Object { $_.Html -ne 'source-material.html' }) {
            $renderedPath = Join-Path $renderRoot $export.Html
            if ($export.Html -eq 'prototype.html') {
                [void](New-MaterialsPrototypeHtml -Title $title -OutputPath $renderedPath -ScreenshotPaths @($prototypeAssets.FullName))
            }
            else {
                $images = if ($export.Html -eq 'manual.html') { @(Get-MaterialsManualScreenshotPaths -ScreenshotPaths $screenshotPaths) } else { @() }
                [void](New-MaterialsRenderedHtml -InputPath (Join-Path $contentRoot $export.Html) -OutputPath $renderedPath -Title $title -SoftwareName ([string]$manifest.softwareName) -ScreenshotPaths $images)
            }
        }
        $preparedExports = [Collections.Generic.List[object]]::new()
        foreach ($export in $exports) {
            $base = Join-Path $outputRoot ('{0}-{1}' -f $manifest.softwareName, $export.Name)
            $docx = "$base.docx"; $pdf = if ($export.Pdf) { "$base.pdf" } else { $null }
            if (Test-Path -LiteralPath $docx) { throw "Refusing to overwrite existing material output: $docx" }
            if ($null -ne $pdf -and (Test-Path -LiteralPath $pdf)) { throw "Refusing to overwrite existing material output: $pdf" }
            $created.Add($docx); if ($null -ne $pdf) { $created.Add($pdf) }
            $preparedExports.Add([pscustomobject]@{ Definition = $export; Docx = $docx; Pdf = $pdf })
        }

        $workerPath = Join-Path $PSScriptRoot 'word-export-worker.ps1'
        if (-not (Test-Path -LiteralPath $workerPath -PathType Leaf)) { throw "Word worker was not found: $workerPath" }
        $workerRoot = Join-Path $root ('temp\materials-worker-' + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $workerRoot -Force | Out-Null
        try {
            for ($batchStart = 0; $batchStart -lt $preparedExports.Count; $batchStart++) {
                $batchEnd = $batchStart
                $workItems = @()
                for ($index = $batchStart; $index -le $batchEnd; $index++) {
                    $prepared = $preparedExports[$index]
                    $export = $prepared.Definition
                    Write-Host ("Building material: {0}" -f $export.Name)
                    $workItems += [pscustomobject]@{
                        HtmlPath = Join-Path $renderRoot $export.Html
                        DocxPath = $prepared.Docx
                        PdfPath = $prepared.Pdf
                        SourceDocument = $export.Name -eq $source
                        PrototypeDocument = $export.Name -eq $prototype
                        ApplicationDocument = $export.Name -eq $application
                        ApplicationTemplatePath = Join-Path $root 'materials\application-form-template.docx'
                        SoftwareName = [string]$manifest.softwareName
                        Version = [string]$manifest.version
                    }
                }
                $workItemsPath = Join-Path $workerRoot ("batch-{0}.json" -f $batchStart)
                [IO.File]::WriteAllText($workItemsPath, ($workItems | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
                $batchCompleted = $false
                $lastWorkerOutput = ''
                for ($attempt = 1; $attempt -le 3; $attempt++) {
                    $lastWorkerOutput = (& powershell -NoProfile -ExecutionPolicy Bypass -File $workerPath -ProjectRoot $root -WorkItemsPath $workItemsPath 2>&1 | Out-String)
                    if ($LASTEXITCODE -eq 0) { $batchCompleted = $true; break }
                    foreach ($item in $workItems) {
                        foreach ($partialPath in @($item.DocxPath, $item.PdfPath)) {
                            if ($null -ne $partialPath -and (Test-Path -LiteralPath $partialPath)) { Remove-Item -LiteralPath $partialPath -Force }
                        }
                    }
                    if ($attempt -lt 3) { Start-Sleep -Milliseconds 2500 }
                }
                if (-not $batchCompleted) { throw "Word material batch failed after 3 attempts: $($lastWorkerOutput.Trim())" }
            }
        }
        finally {
            if (Test-Path -LiteralPath $workerRoot) { Remove-Item -LiteralPath $workerRoot -Recurse -Force }
        }

        foreach ($path in $created) {
            $kind = if ([IO.Path]::GetExtension($path) -ieq '.pdf') { 'Pdf' } else { 'Docx' }
            Assert-MaterialsDocument -Path $path -Kind $kind
        }
        Assert-MaterialsSourceDocument -Path (Join-Path $outputRoot ('{0}-{1}.docx' -f $manifest.softwareName, $source))
        Assert-MaterialsEmbeddedMedia -Path (Join-Path $outputRoot ('{0}-{1}.docx' -f $manifest.softwareName, $manual)) -ExpectedCount 4
        Assert-MaterialsEmbeddedMedia -Path (Join-Path $outputRoot ('{0}-{1}.docx' -f $manifest.softwareName, $prototype)) -ExpectedCount 3
        return @($created | ForEach-Object { Get-Item -LiteralPath $_ })
    }
    catch {
        foreach ($path in $created) { if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force } }
        throw
    }
    finally {
        if (Test-Path -LiteralPath $renderRoot) { Remove-Item -LiteralPath $renderRoot -Recurse -Force }
    }
}

if (-not $NoBuild) { Invoke-MaterialsToolBuild }
