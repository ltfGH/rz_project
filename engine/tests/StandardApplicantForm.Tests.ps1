. "$PSScriptRoot\Assert.ps1"
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot '..\lib\StandardMaterialRendering.psm1') -Force -DisableNameChecking

function Get-ApplicationValues([string]$Html){
    $values=[ordered]@{};$pattern='(?is)<td\b(?=[^>]*\bdata-field\s*=\s*["''](?<name>[a-z0-9_]+)["''])[^>]*>(?<value>.*?)</td>'
    foreach($match in [regex]::Matches($Html,$pattern)){$name=$match.Groups['name'].Value;if($values.Contains($name)){throw "Duplicate application field: $name"};$valueHtml=[regex]::Replace($match.Groups['value'].Value,'(?i)<br\s*/?>',"`r");$values[$name]=[Net.WebUtility]::HtmlDecode([regex]::Replace($valueHtml,'<[^>]+>','')).Trim()}
    return $values
}
function Get-DocxBookmarkNames([string]$Path){
    Add-Type -AssemblyName System.IO.Compression;Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive=[IO.Compression.ZipFile]::OpenRead($Path)
    try{$entry=$archive.GetEntry('word/document.xml');$reader=[IO.StreamReader]::new($entry.Open());try{[xml]$xml=$reader.ReadToEnd()}finally{$reader.Dispose()};$ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';$manager=[Xml.XmlNamespaceManager]::new($xml.NameTable);$manager.AddNamespace('w',$ns);return @($xml.SelectNodes('//w:bookmarkStart',$manager)|ForEach-Object{$_.GetAttribute('name',$ns)}|Where-Object{$_-like'app_*'}|Sort-Object)}finally{$archive.Dispose()}
}
function Get-DocxTableCount([string]$Path){
    Add-Type -AssemblyName System.IO.Compression;Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive=[IO.Compression.ZipFile]::OpenRead($Path)
    try{$entry=$archive.GetEntry('word/document.xml');$reader=[IO.StreamReader]::new($entry.Open());try{[xml]$xml=$reader.ReadToEnd()}finally{$reader.Dispose()};$manager=[Xml.XmlNamespaceManager]::new($xml.NameTable);$manager.AddNamespace('w','http://schemas.openxmlformats.org/wordprocessingml/2006/main');return @($xml.SelectNodes('//w:tbl',$manager)).Count}finally{$archive.Dispose()}
}
function Get-PdfPageCount([string]$Path){
    $text=[Text.Encoding]::GetEncoding(28591).GetString([IO.File]::ReadAllBytes($Path));$objects=@{}
    foreach($match in [regex]::Matches($text,'(?ms)(?<id>\d+)\s+\d+\s+obj\s*(?<body>.*?)\s*endobj')){$objects[$match.Groups['id'].Value]=$match.Groups['body'].Value}
    $catalog=@($objects.GetEnumerator()|Where-Object{[string]$_.Value-match'/Type\s*/Catalog\b'}|Select-Object -First 1);if($catalog.Count-ne1-or[string]$catalog[0].Value-notmatch'/Pages\s+(?<id>\d+)\s+\d+\s+R'){throw 'PDF catalog does not reference a readable page tree.'}
    $pagesId=$Matches['id'];if(-not$objects.ContainsKey($pagesId)-or[string]$objects[$pagesId]-notmatch'/Type\s*/Pages\b'-or[string]$objects[$pagesId]-notmatch'/Count\s+(?<count>\d+)'){throw 'PDF page tree does not contain a readable count.'};return [int]$Matches['count']
}

$expectedFields=@('category','classification','company_date','completion_date','development_hardware','development_os','development_purpose','development_tools','industry','language','main_functions','runtime_hardware','runtime_platform','runtime_support','short_name','software_name','source_quantity','technical_features','version')|Sort-Object
$root=Join-Path ([IO.Path]::GetTempPath()) ('standard-applicant-'+[guid]::NewGuid().ToString('N'))
try{
    $templatePath=(Resolve-Path (Join-Path $PSScriptRoot '..\template\materials\application-form-template.docx')).Path
    Assert-Equal ((Get-DocxBookmarkNames $templatePath)-join',') ((@($expectedFields|ForEach-Object{'app_'+$_}))-join',')
    Assert-Equal ((Get-DocxTableCount $templatePath)-ge1) $true
    $factsRoot=Join-Path $root 'facts';$helper=Join-Path $PSScriptRoot '..\desktop-runtime\tests\helpers\write-material-rendering-fixtures.cjs';$oldWarnings=$env:NODE_NO_WARNINGS;$env:NODE_NO_WARNINGS='1'
    try{$helperOutput=& node $helper $factsRoot 2>&1|Out-String}finally{$env:NODE_NO_WARNINGS=$oldWarnings};if($LASTEXITCODE-ne0){throw "Failed to create production facts: $helperOutput"}
    $factFiles=@(Get-ChildItem -LiteralPath $factsRoot -Filter '*.json' -File|Sort-Object Name);Assert-Equal $factFiles.Count 8
    $applicationCases=[Collections.Generic.List[object]]::new()
    foreach($factFile in $factFiles){
        $facts=Get-Content -Raw -Encoding UTF8 -LiteralPath $factFile.FullName|ConvertFrom-Json;$caseRoot=Join-Path $root ([IO.Path]::GetFileNameWithoutExtension($factFile.Name));$htmlPath=Join-Path $caseRoot 'application-info.html'
        $html=Render-StandardApplicantHtml -Facts $facts -OutputPath $htmlPath;$values=Get-ApplicationValues $html
        Assert-Equal $values.Count 19;Assert-Equal (($values.Keys|Sort-Object)-join',') ($expectedFields-join',')
        Assert-Equal $values.software_name ([string]$facts.software.name);Assert-Equal $values.version ('V'+[string]$facts.software.version)
        foreach($field in @('short_name','classification','completion_date','company_date')){Assert-Equal $values[$field] '【申请人填写】'}
        Assert-Match $values.source_quantity ([regex]::Escape('【生成时按实际源码统计填写】'));Assert-Match $values.source_quantity ([regex]::Escape([string]$facts.source.totalLines));Assert-Match $values.source_quantity ([regex]::Escape([string]$facts.source.totalFiles))
        Assert-Match $values.runtime_support ([regex]::Escape([string]$facts.runtime.electron));Assert-Match $values.runtime_support ([regex]::Escape([string]$facts.runtime.sqlite));Assert-Match $values.language 'TypeScript'
        Assert-Equal $values.industry '【申请人填写】'
        Assert-Match $values.development_purpose ([regex]::Escape([string]$facts.software.purpose));foreach($module in @($facts.modules)){Assert-Match $values.main_functions ([regex]::Escape([string]$module.name))}
        $allValues=$values.Values-join' ';foreach($internal in @($facts.commands.id)+@($facts.roles.id)){Assert-Equal ($allValues-cmatch ('(?<![A-Za-z0-9_\.])'+[regex]::Escape([string]$internal)+'(?![A-Za-z0-9_\.])')) $false}
        Assert-Equal ($allValues-match'浏览器存储|Google Chrome|Visual Studio Code') $false
        $applicationCases.Add([pscustomobject]@{id=[string]$facts.templateId;facts=$facts;htmlPath=$htmlPath})
    }
    Assert-Equal $applicationCases.Count 8
    $worker=Join-Path $PSScriptRoot '..\template\tools\word-export-worker.ps1';$repoRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
    $workItems=[Collections.Generic.List[object]]::new()
    foreach($case in $applicationCases){$workItems.Add([pscustomobject]@{HtmlPath=$case.htmlPath;DocxPath=(Join-Path $root ($case.id+'.docx'));PdfPath=(Join-Path $root ($case.id+'.pdf'));SourceDocument=$false;PrototypeDocument=$false;ApplicationDocument=$true;ApplicationTemplatePath=$templatePath;SoftwareName=[string]$case.facts.software.name;Version=[string]$case.facts.software.version})}
    for($offset=0;$offset-lt$workItems.Count;$offset+=2){$batch=@($workItems[$offset..([Math]::Min($offset+1,$workItems.Count-1))]);$workPath=Join-Path $root ('application-'+$offset+'.work.json');[IO.File]::WriteAllText($workPath,(ConvertTo-Json -InputObject $batch -Depth 5),[Text.UTF8Encoding]::new($false));$workerOutput=& powershell -NoProfile -ExecutionPolicy Bypass -File $worker -ProjectRoot $repoRoot -WorkItemsPath $workPath 2>&1|Out-String;if($LASTEXITCODE-ne0){throw "Application Word export failed: $workerOutput"}}
    foreach($work in $workItems){Assert-Equal (Test-Path -LiteralPath $work.DocxPath -PathType Leaf) $true;Assert-Equal (Test-Path -LiteralPath $work.PdfPath -PathType Leaf) $true;Assert-Equal ((Get-DocxBookmarkNames $work.DocxPath)-join',') ((@($expectedFields|ForEach-Object{'app_'+$_}))-join',');Assert-Equal ((Get-DocxTableCount $work.DocxPath)-ge1) $true;Assert-Equal (Get-PdfPageCount $work.PdfPath) 2}
    foreach($work in $workItems){$word=$null;$document=$null;try{$word=New-Object -ComObject Word.Application;$word.Visible=$false;$word.DisplayAlerts=0;$document=$word.Documents.Open($work.DocxPath,$false,$true);$document.Repaginate();Assert-Equal ([int]$document.ComputeStatistics(2)) 2}finally{if($null-ne$document){try{$document.Close($false)}catch{};try{[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($document)}catch{}};if($null-ne$word){try{$word.Quit()}catch{};try{[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($word)}catch{}};[GC]::Collect();[GC]::WaitForPendingFinalizers()}}
}
finally{if(Test-Path -LiteralPath $root){Remove-Item -LiteralPath $root -Recurse -Force}}
