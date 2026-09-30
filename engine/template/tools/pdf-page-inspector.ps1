[CmdletBinding()]
param([Parameter(Mandatory)][string]$PdfPath)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$stage='start';$memory=$null;$random=$null;$task=$null;$pdf=$null;$exitCode=1
try{
    $resolved=[IO.Path]::GetFullPath($PdfPath);if(-not(Test-Path -LiteralPath $resolved -PathType Leaf)){throw 'PDF_MISSING'}
    $stage='load-runtime';Add-Type -AssemblyName System.Runtime.WindowsRuntime;Add-Type -AssemblyName System.Drawing;[void][Windows.Data.Pdf.PdfDocument,Windows.Data.Pdf,ContentType=WindowsRuntime];[void][Windows.Data.Pdf.PdfPageRenderOptions,Windows.Data.Pdf,ContentType=WindowsRuntime];[void][Windows.Storage.Streams.InMemoryRandomAccessStream,Windows.Storage.Streams,ContentType=WindowsRuntime]
    $genericTask=[System.WindowsRuntimeSystemExtensions].GetMethods()|Where-Object{$_.Name-eq'AsTask'-and$_.IsGenericMethodDefinition-and$_.GetGenericArguments().Count-eq1-and$_.GetParameters().Count-eq1-and$_.ReturnType.Name-eq'Task`1'}|Select-Object -First 1
    $actionTask=[System.WindowsRuntimeSystemExtensions].GetMethods()|Where-Object{$_.Name-eq'AsTask'-and-not$_.IsGenericMethodDefinition-and$_.GetParameters().Count-eq1}|Select-Object -First 1
    $stage='open-pdf';$memory=[IO.MemoryStream]::new([IO.File]::ReadAllBytes($resolved),$false);$random=[System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($memory);$operation=[Windows.Data.Pdf.PdfDocument]::LoadFromStreamAsync($random);$task=$genericTask.MakeGenericMethod([Windows.Data.Pdf.PdfDocument]).Invoke($null,@($operation));$task.Wait();$pdf=[Windows.Data.Pdf.PdfDocument]$task.Result
    $pageDigests=[Collections.Generic.List[string]]::new();$nonblank=$true
    for($pageIndex=0;$pageIndex-lt$pdf.PageCount;$pageIndex++){
        $stage='render-page';$page=$null;$renderStream=$null;$renderTask=$null;$netStream=$null;$rendered=$null;$imageStream=$null;$bitmap=$null
        try{
            $page=$pdf.GetPage($pageIndex);$renderStream=New-Object Windows.Storage.Streams.InMemoryRandomAccessStream;$options=New-Object Windows.Data.Pdf.PdfPageRenderOptions;$options.DestinationWidth=256;$renderOperation=$page.RenderToStreamAsync($renderStream,$options);$renderTask=$actionTask.Invoke($null,@($renderOperation));$renderTask.Wait();$renderStream.Seek(0);$netStream=[System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($renderStream);$rendered=[IO.MemoryStream]::new();$netStream.CopyTo($rendered);$renderedBytes=$rendered.ToArray();$imageStream=[IO.MemoryStream]::new($renderedBytes,$false);$bitmap=[Drawing.Bitmap]::new($imageStream)
            $nonWhite=0;for($x=0;$x-lt$bitmap.Width;$x+=[Math]::Max(1,[Math]::Floor($bitmap.Width/32))){for($y=0;$y-lt$bitmap.Height;$y+=[Math]::Max(1,[Math]::Floor($bitmap.Height/32))){$color=$bitmap.GetPixel($x,$y);if($color.A-gt10-and($color.R-lt245-or$color.G-lt245-or$color.B-lt245)){$nonWhite++}}};if($nonWhite-lt1){$nonblank=$false};$sha=[Security.Cryptography.SHA256]::Create();try{$pageDigests.Add(([BitConverter]::ToString($sha.ComputeHash($renderedBytes))).Replace('-','').ToLowerInvariant())}finally{$sha.Dispose()}
        }finally{if($null-ne$bitmap){$bitmap.Dispose()};if($null-ne$imageStream){$imageStream.Dispose()};if($null-ne$rendered){$rendered.Dispose()};if($null-ne$netStream){$netStream.Dispose()};if($null-ne$renderTask){$renderTask.Dispose()};if($null-ne$renderStream){$renderStream.Dispose()};if($null-ne$page){$page.Dispose()}}
    }
    [Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject ([pscustomobject]@{ok=$true;pages=[int]$pdf.PageCount;nonblank=$nonblank;pageDigests=$pageDigests.ToArray()})));$exitCode=0
}catch{[Console]::Error.WriteLine(('PDF_PAGE_INSPECTION_FAILED:{0}:{1}:{2}'-f$stage,$_.Exception.GetType().Name,$_.Exception.HResult))}
finally{if($null-ne$pdf){try{$pdf.Dispose()}catch{}};if($null-ne$task){try{$task.Dispose()}catch{}};if($null-ne$random){try{$random.Dispose()}catch{}};if($null-ne$memory){$memory.Dispose()}}
[Environment]::Exit($exitCode)
