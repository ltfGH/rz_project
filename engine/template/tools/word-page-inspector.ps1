[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$DocxPath,
    [string]$ReferencePdfPath
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$word=$null;$document=$null;$stage='start'
try{
    $resolved=[IO.Path]::GetFullPath($DocxPath);if(-not(Test-Path -LiteralPath $resolved -PathType Leaf)){throw 'DOCX_MISSING'}
    $stage='create-word';$word=New-Object -ComObject Word.Application;$stage='configure-word';$word.Visible=$false;$word.DisplayAlerts=0;$stage='open-document';$document=$word.Documents.Open($resolved,$false,$true);$stage='paginate';$document.Repaginate();$pages=[int]$document.ComputeStatistics(2)
    if(-not[string]::IsNullOrWhiteSpace($ReferencePdfPath)){$stage='export-pdf';$target=[IO.Path]::GetFullPath($ReferencePdfPath);if(Test-Path -LiteralPath $target){throw 'PDF_TARGET_EXISTS'};$document.ExportAsFixedFormat($target,17)}
    [Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject ([pscustomobject]@{ok=$true;pages=$pages})))
}
catch{[Console]::Error.WriteLine(('WORD_PAGE_INSPECTION_FAILED:{0}:{1}:{2}' -f $stage,$_.Exception.GetType().Name,$_.Exception.HResult));exit 1}
finally{if($null-ne$document){try{$document.Close($false)}catch{};try{[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($document)}catch{}};if($null-ne$word){try{$word.Quit()}catch{};try{[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($word)}catch{}};[GC]::Collect();[GC]::WaitForPendingFinalizers()}
