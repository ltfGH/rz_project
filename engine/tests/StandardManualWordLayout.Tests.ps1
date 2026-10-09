. "$PSScriptRoot\Assert.ps1"
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root=Join-Path ([IO.Path]::GetTempPath()) ('standard-manual-word-layout-'+[guid]::NewGuid().ToString('N'))
try{
    New-Item -ItemType Directory -Path $root -Force|Out-Null
    foreach($item in @(@('one.png',[Drawing.Color]::SteelBlue),@('two.png',[Drawing.Color]::SeaGreen))){
        $path=Join-Path $root $item[0];$bitmap=[Drawing.Bitmap]::new(640,400);$graphics=[Drawing.Graphics]::FromImage($bitmap)
        try{$graphics.Clear($item[1]);$bitmap.Save($path,[Drawing.Imaging.ImageFormat]::Png)}finally{$graphics.Dispose();$bitmap.Dispose()}
    }
    $htmlPath=Join-Path $root 'manual.html';$docxPath=Join-Path $root 'manual.docx'
    $html=@'
<!doctype html><html><head><meta charset="UTF-8"><style>
@page{size:A4;margin:22mm 18mm 20mm}.figure-image{text-align:center}.figure-caption{text-align:center}
</style></head><body>
<h1>操作手册</h1>
<div class="manual-figure"><p class="figure-image"><img src="one.png"></p><p class="figure-caption">图一</p></div>
<div class="manual-figure"><p class="figure-image"><img src="two.png"></p><p class="figure-caption">图二</p></div>
<h2>&#19971;&#12289;&#22791;&#20221;&#19982;&#24674;&#22797;</h2><p>备份说明。</p>
</body></html>
'@
    [IO.File]::WriteAllText($htmlPath,$html,[Text.UTF8Encoding]::new($false))
    $work=@([pscustomobject]@{HtmlPath=$htmlPath;DocxPath=$docxPath;PdfPath=$null;SourceDocument=$false;PrototypeDocument=$false;ApplicationDocument=$false;DocumentId='manual';SoftwareName='版式测试软件';Version='1.0.0'})
    $workPath=Join-Path $root 'work.json';[IO.File]::WriteAllText($workPath,($work|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
    $repo=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
    . (Join-Path $PSScriptRoot '..\template\tools\build-materials.ps1') -ProjectRoot $repo -NoBuild
    Invoke-MaterialsWordWorker -WorkItemsPath $workPath

    $zip=[IO.Compression.ZipFile]::OpenRead($docxPath)
    try{$entry=$zip.GetEntry('word/document.xml');$reader=[IO.StreamReader]::new($entry.Open());try{[xml]$xml=$reader.ReadToEnd()}finally{$reader.Dispose()}}
    finally{$zip.Dispose()}
    $ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';$manager=[Xml.XmlNamespaceManager]::new($xml.NameTable);$manager.AddNamespace('w',$ns)
    $imageParagraphs=@($xml.SelectNodes('//w:body/w:p[.//w:pict or .//w:drawing]',$manager))
    Assert-Equal $imageParagraphs.Count 2
    foreach($paragraph in $imageParagraphs){$keep=$paragraph.SelectSingleNode('./w:pPr/w:keepNext',$manager);$value=if($null-eq$keep){'0'}else{[string]$keep.GetAttribute('val',$ns)};Assert-Equal ($null-ne$keep-and$value-notin@('0','false','off')) $true}
}
finally{if(Test-Path -LiteralPath $root){Remove-Item -LiteralPath $root -Recurse -Force}}
