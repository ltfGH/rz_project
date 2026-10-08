Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'

function Get-SourceMaterialHash([byte[]]$Bytes){return [BitConverter]::ToString(([Security.Cryptography.SHA256]::Create().ComputeHash($Bytes))).Replace('-','').ToLowerInvariant()}
function Get-SourceMaterialTextHash([string]$Text){return Get-SourceMaterialHash ([Text.UTF8Encoding]::new($false).GetBytes($Text))}
function ConvertTo-SourceHtml([AllowNull()]$Value){if($null-eq$Value){return''};return [Security.SecurityElement]::Escape([string]$Value)}
function Get-LogicalSourceLineCount([string]$Text){if($Text.Length-eq0){return 0};$count=[regex]::Matches($Text,"`r`n|`n|`r").Count;if($Text-notmatch"(?:`r`n|`n|`r)$"){$count++};return $count}
function Get-DisplaySegments([string]$Text,[int]$Width){
    if($Text.Length-eq0){return ,''};$segments=[Collections.Generic.List[string]]::new();$current=[Text.StringBuilder]::new();$enumerator=[Globalization.StringInfo]::GetTextElementEnumerator($Text);$count=0
    while($enumerator.MoveNext()){if($count-eq$Width){$segments.Add($current.ToString());[void]$current.Clear();$count=0};[void]$current.Append([string]$enumerator.Current);$count++};if($current.Length-gt0){$segments.Add($current.ToString())};return $segments.ToArray()
}
function Assert-SafeSourceRelativePath([string]$Relative){
    if([string]::IsNullOrWhiteSpace($Relative)-or[IO.Path]::IsPathRooted($Relative)-or$Relative.Contains('\')-or$Relative.StartsWith('/')-or$Relative.Contains([char]0)){throw 'Source manifest contains an unsafe path.'};$segments=@($Relative.Split('/'));if($segments.Count-eq0-or@($segments|Where-Object{[string]::IsNullOrWhiteSpace($_)-or$_-in@('.','..')}).Count){throw 'Source manifest contains an unsafe path.'};return $segments
}
function Assert-SourceMaterialRoot([string]$RepositoryRoot){
    if([string]::IsNullOrWhiteSpace($RepositoryRoot)-or-not[IO.Path]::IsPathRooted($RepositoryRoot)){throw 'Source repository root must be absolute.'};$root=[IO.Path]::GetFullPath($RepositoryRoot).TrimEnd('\')
    if(-not(Test-Path -LiteralPath $root -PathType Container)){throw 'Source repository root was not found.'};$item=Get-Item -LiteralPath $root -Force;if(($item.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0){throw 'Source repository root cannot be a reparse point.'};return $root
}

function Get-StandardSourcePrintPlan {
    [CmdletBinding()]param([Parameter(Mandatory)][string]$RepositoryRoot,[Parameter(Mandatory)]$SourceManifest)
    $root=Assert-SourceMaterialRoot $RepositoryRoot
    if([string]$SourceManifest.manifestVersion-ne'1.0'-or[string]$SourceManifest.sha256-notmatch'^[0-9a-f]{64}$'){throw 'Source manifest is invalid.'}
    $files=@($SourceManifest.files|Sort-Object path);if($files.Count-eq0-or$files.Count-ne[int]$SourceManifest.totalFiles){throw 'Source manifest file count is invalid.'}
    $seen=@{};$manifestCanonical=[Collections.Generic.List[string]]::new();$printLines=[Collections.Generic.List[object]]::new();$logicalTotal=0;$rootPrefix=$root+'\'
    foreach($entry in $files){
        $relative=[string]$entry.path;$segments=@(Assert-SafeSourceRelativePath $relative);if($seen.ContainsKey($relative)){throw 'Source manifest contains an unsafe or duplicate path.'};$seen[$relative]=$true
        $current=$root;foreach($segment in $segments){$current=Join-Path $current $segment;if(-not(Test-Path -LiteralPath $current)){throw "Source manifest file was not found: $relative"};$ancestor=Get-Item -LiteralPath $current -Force;if(($ancestor.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0){throw "Source manifest path cannot contain a reparse point: $relative"}}
        $path=[IO.Path]::GetFullPath($current);if(-not$path.StartsWith($rootPrefix,[StringComparison]::OrdinalIgnoreCase)-or-not(Test-Path -LiteralPath $path -PathType Leaf)){throw "Source manifest file was not found: $relative"};$item=Get-Item -LiteralPath $path -Force
        $actualHash=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant();if($actualHash-cne[string]$entry.sha256-or$item.Length-ne[long]$entry.bytes){throw "Source manifest file changed: $relative"}
        $text=[IO.File]::ReadAllText($path,[Text.UTF8Encoding]::new($false));$lineCount=Get-LogicalSourceLineCount $text;if($lineCount-ne[int]$entry.lines){throw "Source manifest line count changed: $relative"};$logicalTotal+=$lineCount
        $manifestCanonical.Add(('{0}|{1}|{2}|{3}'-f$relative,$entry.lines,$entry.bytes,$entry.sha256))
        $logicalLines=@();if($text.Length-gt0){$logicalLines=@([regex]::Split($text,"`r`n|`n|`r"));if($text-match"(?:`r`n|`n|`r)$"){$logicalLines=if($logicalLines.Count-gt1){@($logicalLines[0..($logicalLines.Count-2)])}else{@()}}};$logicalLines=@($logicalLines)
        for($lineIndex=0;$lineIndex-lt$logicalLines.Count;$lineIndex++){$displaySegments=@(Get-DisplaySegments ([string]$logicalLines[$lineIndex]) 55);for($segmentIndex=0;$segmentIndex-lt$displaySegments.Count;$segmentIndex++){$printLines.Add([pscustomobject]@{path=$relative;lineNumber=$lineIndex+1;continuation=$segmentIndex;text=[string]$displaySegments[$segmentIndex]})}}
    }
    if($logicalTotal-ne[int]$SourceManifest.totalLines){throw 'Source manifest total line count is invalid.'};$manifestDigest=Get-SourceMaterialTextHash ($manifestCanonical-join"`n");if($manifestDigest-cne[string]$SourceManifest.sha256){throw 'Source manifest canonical digest mismatch.'};if($printLines.Count-eq0){throw 'Source manifest contains no printable lines.'}
    $linesPerPage=50;$allPages=[Collections.Generic.List[object]]::new();$cursor=0;$sourcePageNumber=0
    while($cursor-lt$printLines.Count){$take=[Math]::Min($linesPerPage,$printLines.Count-$cursor);$candidate=@($printLines.GetRange($cursor,$take));$mappingPaths=@($candidate|ForEach-Object{[string]$_.path}|Select-Object -Unique);$mappingRows=[Collections.Generic.List[object]]::new();foreach($mappingPath in $mappingPaths){$pathSegments=@(Get-DisplaySegments $mappingPath 48);for($part=0;$part-lt$pathSegments.Count;$part++){$mappingRows.Add([pscustomobject]@{path=$mappingPath;part=$part;text=[string]$pathSegments[$part]})}};$sourcePageNumber++;$allPages.Add([pscustomobject]@{sourcePage=$sourcePageNumber;mappings=$mappingRows.ToArray();lines=$candidate});$cursor+=$take}
    $totalPages=$allPages.Count;$sourcePages=if($totalPages-le60){@(1..$totalPages)}else{@(1..30)+@(($totalPages-29)..$totalPages)};$pages=[Collections.Generic.List[object]]::new();$selectedFiles=[Collections.Generic.List[string]]::new();$selectionCanonical=[Collections.Generic.List[string]]::new();$selectedLineCount=0;$outputPage=0
    foreach($sourcePage in $sourcePages){$outputPage++;$sourcePageData=$allPages[$sourcePage-1];$pageLines=@($sourcePageData.lines);foreach($line in $pageLines){if(-not$selectedFiles.Contains([string]$line.path)){$selectedFiles.Add([string]$line.path)};$selectionCanonical.Add(('{0}|{1}|{2}|{3}|{4}'-f$sourcePage,$line.path,$line.lineNumber,$line.continuation,(Get-SourceMaterialTextHash ([string]$line.text))))};$selectedLineCount+=$pageLines.Count;$pages.Add([pscustomobject]@{outputPage=$outputPage;sourcePage=$sourcePage;mappings=$sourcePageData.mappings;lines=$pageLines})}
    $trimRequired=$totalPages-gt60;$firstRange=if($trimRequired){'1-30'}else{'1-'+$totalPages};$lastRange=if($trimRequired){($totalPages-29).ToString()+'-'+$totalPages}else{$null}
    $selectionMetadata=([string]$SourceManifest.sha256+'|50|55|'+$files.Count+'|'+$logicalTotal+'|'+$printLines.Count+'|'+$totalPages+'|'+$trimRequired+'|'+$firstRange+'|'+[string]$lastRange+'|'+($sourcePages-join','))
    $selectionDigest=Get-SourceMaterialTextHash ($selectionMetadata+"`n"+($selectionCanonical-join"`n"))
    return [pscustomobject]@{planVersion='1.0';linesPerPage=$linesPerPage;displayWidth=55;sourceManifestSha256=[string]$SourceManifest.sha256;selectionSha256=$selectionDigest;totalFiles=$files.Count;totalLogicalLines=$logicalTotal;totalPrintLines=$printLines.Count;totalSourcePages=$totalPages;trimRequired=$trimRequired;expectedPageCount=$pages.Count;firstRange=$firstRange;lastRange=$lastRange;selectedLineCount=$selectedLineCount;selectedFiles=$selectedFiles.ToArray();pages=$pages.ToArray()}
}

function Write-StandardSourceHtml {
    [CmdletBinding()]param([Parameter(Mandatory)]$Plan,[Parameter(Mandatory)][string]$SoftwareName,[Parameter(Mandatory)][string]$Version,[Parameter(Mandatory)][string]$OutputPath)
    if([string]$Plan.planVersion-ne'1.0'-or[int]$Plan.expectedPageCount-ne@($Plan.pages).Count-or@($Plan.pages).Count-eq0){throw 'Source print plan is invalid.'};$target=[IO.Path]::GetFullPath($OutputPath);if(Test-Path -LiteralPath $target){throw 'Refusing to overwrite source material.'};$parent=Split-Path -Parent $target;if(-not(Test-Path -LiteralPath $parent)){New-Item -ItemType Directory -Path $parent -Force|Out-Null}
    $builder=[Text.StringBuilder]::new();[void]$builder.Append('<!doctype html><html><head><meta charset="UTF-8"><title>').Append((ConvertTo-SourceHtml ($SoftwareName+' V'+$Version+' 源程序材料'))).Append('</title><style>')
    [void]$builder.Append('@page{size:A4;margin:16mm 14mm 14mm}.source-page{font-family:"Consolas","SimSun",monospace;color:#111}.source-page-marker{page-break-before:always;break-before:page;font-size:1pt;line-height:1pt;color:#fff;margin:0}.source-lines{font-family:"Consolas","SimSun",monospace;font-size:7.2pt;line-height:1.15;white-space:pre;margin:0;overflow:hidden}.source-line{white-space:pre}</style></head><body data-source-manifest-sha256="').Append((ConvertTo-SourceHtml $Plan.sourceManifestSha256)).Append('" data-selection-sha256="').Append((ConvertTo-SourceHtml $Plan.selectionSha256)).Append('">')
    foreach($page in @($Plan.pages)){if([int]$page.outputPage-gt1){[void]$builder.Append('<p class="source-page-marker" style="font-size:1pt;line-height:1pt;color:#fff;margin:0">SOURCE_PAGE_BREAK_').Append(([int]$page.outputPage).ToString('D4')).Append('</p>')};[void]$builder.Append('<section class="source-page" data-output-page="').Append($page.outputPage).Append('" data-source-page="').Append($page.sourcePage).Append('"><pre class="source-lines">');foreach($line in @($page.lines)){[void]$builder.Append('<span class="source-line">').Append((ConvertTo-SourceHtml ([string]$line.text))).Append('</span><br>')};[void]$builder.Append('</pre></section>')}
    [void]$builder.Append('</body></html>');$html=$builder.ToString();[IO.File]::WriteAllText($target,$html,[Text.UTF8Encoding]::new($false));return $html
}

Export-ModuleMember -Function Get-StandardSourcePrintPlan,Write-StandardSourceHtml
