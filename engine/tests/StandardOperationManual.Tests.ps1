$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot '..\lib\StandardMaterialRendering.psm1') -Force

function Assert-Equal($Actual,$Expected,[string]$Message=''){
    if($Actual-ne$Expected){throw "Assertion failed. Expected [$Expected], actual [$Actual]. $Message"}
}
function Assert-Match([string]$Actual,[string]$Pattern,[string]$Message=''){
    if($Actual-notmatch$Pattern){throw "Assertion failed. Pattern [$Pattern] was not found. $Message"}
}
function Visible-Text([string]$Html){
    $withoutStyle=[regex]::Replace($Html,'(?is)<style\b[^>]*>.*?</style>',' ')
    return [Net.WebUtility]::HtmlDecode([regex]::Replace($withoutStyle,'(?s)<[^>]+>',' '))
}
function Non-Space-Length([string]$Text){return ([regex]::Replace($Text,'\s','')).Length}
function Get-Sha256([string]$Path){return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()}
function Get-ExceptionMessage([scriptblock]$Action){
    try{& $Action;return ''}catch{return $_.Exception.Message}
}

function New-VerifiedScreenshotFixture($Facts,[string]$Root){
    New-Item -ItemType Directory -Path $Root -Force|Out-Null
    $index=0
    foreach($capture in @($Facts.screenshots.captures)){
        $index++
        $path=Join-Path $Root ([string]$capture.fileName)
        [IO.File]::WriteAllBytes($path,[Text.Encoding]::UTF8.GetBytes("verified screenshot $index for $($Facts.templateId)"))
        $capture.imageSha256=Get-Sha256 $path
    }
}

$testRoot=Join-Path ([IO.Path]::GetTempPath()) ('standard-manual-'+[guid]::NewGuid().ToString('N'))
try{
    $factsRoot=Join-Path $testRoot 'facts'
    $helper=Join-Path $PSScriptRoot '..\desktop-runtime\tests\helpers\write-material-rendering-fixtures.cjs'
    $nodeOutput=& node $helper $factsRoot
    if($LASTEXITCODE-ne0){throw "Failed to create production material facts fixtures: $nodeOutput"}
    $factFiles=@(Get-ChildItem -LiteralPath $factsRoot -Filter '*.json' -File|Sort-Object Name)
    Assert-Equal $factFiles.Count 8 'All standard templates must be covered.'

    foreach($factFile in $factFiles){
        $facts=Get-Content -LiteralPath $factFile.FullName -Raw -Encoding UTF8|ConvertFrom-Json
        $caseRoot=Join-Path $testRoot ([IO.Path]::GetFileNameWithoutExtension($factFile.Name))
        $screenshotRoot=Join-Path $caseRoot 'source-screenshots'
        $outputPath=Join-Path $caseRoot 'manual.html'
        New-VerifiedScreenshotFixture $facts $screenshotRoot

        $html=Render-StandardManualHtml -Facts $facts -ScreenshotRoot $screenshotRoot -OutputPath $outputPath
        Assert-Equal (Test-Path -LiteralPath $outputPath -PathType Leaf) $true 'The renderer must publish the manual.'
        Assert-Equal ([IO.File]::ReadAllText($outputPath,[Text.Encoding]::UTF8)) $html 'Returned and published HTML must match.'
        $visible=Visible-Text $html

        foreach($required in @('操作手册','安装与首次启动','登录','角色与权限','导航与共用操作','核心业务模块','完整业务流程','备份与恢复','常见问题与处理','卸载与数据保留')){
            Assert-Match $visible ([regex]::Escape($required)) "Missing required manual section for $($facts.templateId)."
        }
        Assert-Equal ((Non-Space-Length $visible)-ge3000) $true "Manual is too thin for $($facts.templateId)."
        Assert-Match $html '<ol class="workflow-steps">' 'The primary flow must be explicitly numbered.'
        foreach($module in @($facts.modules)){Assert-Match $visible ([regex]::Escape([string]$module.name))}
        foreach($step in @($facts.workflows|ForEach-Object{@($_.steps)})){
            Assert-Match $visible ([regex]::Escape([string]$step.label))
            foreach($field in @('prerequisite','result','failure')){Assert-Match $visible ([regex]::Escape([string]$step.$field))}
        }

        $imageMatches=@([regex]::Matches($html,'<img\s+[^>]*src="([^"]+)"[^>]*>'))
        Assert-Equal ($imageMatches.Count-ge12-and$imageMatches.Count-le18) $true 'The manual must contain 12-18 screenshots.'
        Assert-Equal @($imageMatches|ForEach-Object{$_.Groups[1].Value}|Sort-Object -Unique).Count $imageMatches.Count 'Screenshot paths must be distinct.'
        $figureBlocks=@([regex]::Matches($html,'(?s)<div class="manual-figure">.*?</div>'))
        $imageParagraphs=@([regex]::Matches($html,'(?s)<p class="figure-image">\s*<img\s+[^>]+>\s*</p>'))
        $captionParagraphs=@([regex]::Matches($html,'(?s)<p class="figure-caption">[^<]+</p>'))
        Assert-Equal $figureBlocks.Count $imageMatches.Count 'Every screenshot must have its own figure block.'
        Assert-Equal $imageParagraphs.Count $imageMatches.Count 'Every screenshot must have its own image paragraph.'
        Assert-Equal $captionParagraphs.Count $imageMatches.Count 'Every screenshot must have its own caption paragraph.'
        foreach($block in $figureBlocks){Assert-Equal ([regex]::Matches($block.Value,'<img\s').Count) 1 'A figure block must not contain multiple screenshots.'}
        foreach($capture in @($facts.screenshots.captures)){
            $relative='screenshots/'+[string]$capture.fileName
            Assert-Equal @($imageMatches|Where-Object{$_.Groups[1].Value-eq$relative}).Count 1 "Screenshot $relative must be bound once."
            $published=Join-Path $caseRoot ('screenshots\'+[string]$capture.fileName)
            Assert-Equal (Get-Sha256 $published) ([string]$capture.imageSha256) 'Published screenshot hash changed.'
            Assert-Equal ($visible-cmatch ('(?<![A-Za-z0-9_])'+[regex]::Escape([string]$capture.scenarioId)+'(?![A-Za-z0-9_])')) $false 'Captions must not expose scenario IDs.'
            Assert-Equal ($visible-cmatch ('(?<![A-Za-z0-9_])'+[regex]::Escape([string]$capture.stepId)+'(?![A-Za-z0-9_])')) $false 'Captions must not expose capture step IDs.'
        }
        foreach($command in @($facts.commands)){
            Assert-Match $visible ([regex]::Escape([string]$command.label))
            Assert-Equal ($visible-cmatch ('(?<![A-Za-z0-9_\.])'+[regex]::Escape([string]$command.id)+'(?![A-Za-z0-9_\.])')) $false 'Stable action IDs must not be visible.'
        }
    }

    $tamperedFacts=Get-Content -LiteralPath $factFiles[0].FullName -Raw -Encoding UTF8|ConvertFrom-Json
    $tamperedRoot=Join-Path $testRoot 'tampered-source'
    New-VerifiedScreenshotFixture $tamperedFacts $tamperedRoot
    $tamperedFacts.screenshots.captures[3].imageSha256='f'*64
    $tamperedOutput=Join-Path $testRoot 'tampered-output\manual.html'
    $message=Get-ExceptionMessage {Render-StandardManualHtml -Facts $tamperedFacts -ScreenshotRoot $tamperedRoot -OutputPath $tamperedOutput|Out-Null}
    Assert-Equal $message 'Screenshot evidence hash mismatch.' 'A screenshot hash mismatch must stop rendering.'
    Assert-Equal (Test-Path -LiteralPath $tamperedOutput) $false 'A failed render must not publish HTML.'
    Assert-Equal (Test-Path -LiteralPath (Join-Path (Split-Path -Parent $tamperedOutput) 'screenshots')) $false 'A failed render must not leave copied screenshots.'

    $unboundFacts=Get-Content -LiteralPath $factFiles[0].FullName -Raw -Encoding UTF8|ConvertFrom-Json
    $unboundRoot=Join-Path $testRoot 'unbound-source'
    New-VerifiedScreenshotFixture $unboundFacts $unboundRoot
    $workflowSteps=@($unboundFacts.workflows|ForEach-Object{@($_.steps)})
    $missingStep=[string]$workflowSteps[-1].id;$replacementStep=[string]$workflowSteps[0].id
    foreach($capture in @($unboundFacts.screenshots.captures)){if([string]$capture.workflowStepId-eq$missingStep){$capture.workflowStepId=$replacementStep}}
    $unboundOutput=Join-Path $testRoot 'unbound-output\manual.html'
    $unboundHtml=Render-StandardManualHtml -Facts $unboundFacts -ScreenshotRoot $unboundRoot -OutputPath $unboundOutput
    $unboundVisible=Visible-Text $unboundHtml
    foreach($step in $workflowSteps){Assert-Match $unboundVisible ([regex]::Escape([string]$step.label)) 'Workflow text must remain complete when screenshots sample key steps.'}
    Assert-Equal @([regex]::Matches($unboundHtml,'<img\s+[^>]*src="([^"]+)"[^>]*>')).Count @($unboundFacts.screenshots.captures).Count 'Every supplied screenshot must still be rendered once.'

    $mismatchFacts=Get-Content -LiteralPath $factFiles[0].FullName -Raw -Encoding UTF8|ConvertFrom-Json
    $mismatchRoot=Join-Path $testRoot 'mismatch-source'
    New-VerifiedScreenshotFixture $mismatchFacts $mismatchRoot
    $boundCapture=@($mismatchFacts.screenshots.captures|Where-Object{$null-ne$_.workflowStepId-and$null-ne$_.moduleId})[0]
    $otherModule=@($mismatchFacts.modules|Where-Object{[string]$_.id-ne[string]$boundCapture.moduleId})[0]
    $boundCapture.moduleId=[string]$otherModule.id
    $mismatchOutput=Join-Path $testRoot 'mismatch-output\manual.html'
    $message=Get-ExceptionMessage {Render-StandardManualHtml -Facts $mismatchFacts -ScreenshotRoot $mismatchRoot -OutputPath $mismatchOutput|Out-Null}
    Assert-Equal $message 'Screenshot evidence does not match its workflow or command.' 'Known IDs with inconsistent ownership must be rejected.'
    Assert-Equal (Test-Path -LiteralPath $mismatchOutput) $false 'Mismatched references must not publish HTML.'
}
finally{
    if(Test-Path -LiteralPath $testRoot){Remove-Item -LiteralPath $testRoot -Recurse -Force}
}
