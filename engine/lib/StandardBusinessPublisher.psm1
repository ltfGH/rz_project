Set-StrictMode -Version Latest

Import-Module (Join-Path $PSScriptRoot 'Generator.Core.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'Publisher.psm1') -Force -DisableNameChecking
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Get-LowerFileHash {
    param([Parameter(Mandatory)][string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-SourceManifestContentHash {
    param([Parameter(Mandatory)]$SourceManifest)
    $canonical = (@($SourceManifest.files | Sort-Object path) | ForEach-Object { '{0}|{1}|{2}|{3}' -f $_.path,$_.lines,$_.bytes,$_.sha256 }) -join "`n"
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes($canonical)
    return [BitConverter]::ToString(([Security.Cryptography.SHA256]::Create().ComputeHash($bytes))).Replace('-','').ToLowerInvariant()
}

function ConvertTo-CanonicalStandardJson($Value) {
    if ($null -eq $Value) { return 'null' }
    if ($Value -is [bool]) { return $(if($Value){'true'}else{'false'}) }
    if ($Value -is [string] -or $Value -is [char]) { return ConvertTo-Json ([string]$Value) -Compress }
    if ($Value -is [byte] -or $Value -is [int16] -or $Value -is [int32] -or $Value -is [int64] -or $Value -is [single] -or $Value -is [double] -or $Value -is [decimal]) { return [Convert]::ToString($Value,[Globalization.CultureInfo]::InvariantCulture) }
    if ($Value -is [Collections.IDictionary]) { $names=@($Value.Keys|ForEach-Object{[string]$_}|Sort-Object);return '{'+(@($names|ForEach-Object{(ConvertTo-Json $_ -Compress)+':'+(ConvertTo-CanonicalStandardJson $Value[$_])})-join',')+'}' }
    if ($Value -is [Collections.IEnumerable] -and $Value -isnot [string]) { return '['+(@($Value|ForEach-Object{ConvertTo-CanonicalStandardJson $_})-join',')+']' }
    $properties=@($Value.PSObject.Properties|Where-Object MemberType -in @('NoteProperty','Property')|Sort-Object Name)
    return '{'+(@($properties|ForEach-Object{(ConvertTo-Json $_.Name -Compress)+':'+(ConvertTo-CanonicalStandardJson $_.Value)})-join',')+'}'
}

function Get-StandardTextHash([string]$Text) {
    $sha=[Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash([Text.UTF8Encoding]::new($false).GetBytes($Text))).Replace('-','').ToLowerInvariant() }
    finally { $sha.Dispose() }
}

function Assert-StandardNoReparseAncestors($Item,[string]$DisplayName) {
    $current=$Item
    while($null -ne $current){if(($current.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw "Delivery path must not contain a reparse point: $DisplayName"};$current=if($current -is [IO.FileInfo]){$current.Directory}else{$current.Parent}}
}

function Assert-StandardRegularDirectory([string]$Path,[string]$DisplayName) {
    if(-not(Test-Path -LiteralPath $Path -PathType Container)){throw "Required delivery directory was not found: $DisplayName"}
    $item=Get-Item -LiteralPath $Path -Force;Assert-StandardNoReparseAncestors $item $DisplayName;return $item
}

function Get-StandardMaterialArtifactBindings {
    param([Parameter(Mandatory)]$Context)
    $name = [string]$Context.SoftwareName
    return @(
        [pscustomobject]@{ id='introduction'; label='软件介绍'; docx='introduction.docx'; artifactDocx="$name-软件介绍.docx"; pdf=$null; artifactPdf=$null },
        [pscustomobject]@{ id='feature-table'; label='功能表'; docx='feature-table.docx'; artifactDocx="$name-功能表.docx"; pdf=$null; artifactPdf=$null },
        [pscustomobject]@{ id='manual'; label='操作手册'; docx='manual.docx'; artifactDocx="$name-操作手册.docx"; pdf='manual.pdf'; artifactPdf="$name-操作手册.pdf" },
        [pscustomobject]@{ id='database-design'; label='数据库设计'; docx='database-design.docx'; artifactDocx="$name-数据库设计.docx"; pdf=$null; artifactPdf=$null },
        [pscustomobject]@{ id='runtime'; label='运行环境'; docx='runtime.docx'; artifactDocx="$name-运行环境.docx"; pdf=$null; artifactPdf=$null },
        [pscustomobject]@{ id='prototype'; label='原型设计图'; docx='prototype.docx'; artifactDocx="$name-原型设计图.docx"; pdf=$null; artifactPdf=$null },
        [pscustomobject]@{ id='application-info'; label='申请表'; docx='application-info.docx'; artifactDocx="$name-申请表.docx"; pdf='application-info.pdf'; artifactPdf="$name-申请表.pdf" },
        [pscustomobject]@{ id='source'; label='源码'; docx='source.docx'; artifactDocx="$name-源码.docx"; pdf='source.pdf'; artifactPdf="$name-源码.pdf" }
    )
}

function Assert-StandardRegularFile {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Required delivery file was not found: $Path" }
    $item = Get-Item -LiteralPath $Path -Force
    Assert-StandardNoReparseAncestors $item $item.Name
    return $item
}

function Add-StandardZipEntry {
    param([Parameter(Mandatory)]$Archive, [Parameter(Mandatory)][IO.FileInfo]$File, [Parameter(Mandatory)][string]$Name)
    $entryName = $Name.Replace('\','/')
    if ($entryName.StartsWith('/') -or $entryName.Contains('../') -or $entryName -match '^[A-Za-z]:') { throw "Unsafe ZIP entry name: $entryName" }
    $entry = $Archive.CreateEntry($entryName, [IO.Compression.CompressionLevel]::Optimal)
    $input = $File.OpenRead(); $output = $entry.Open()
    try { $input.CopyTo($output) } finally { $output.Dispose(); $input.Dispose() }
}

function Assert-StandardZipReadable {
    param([Parameter(Mandatory)][string]$Path)
    $zip = [IO.Compression.ZipFile]::OpenRead($Path)
    try {
        foreach ($entry in $zip.Entries) {
            if ($entry.FullName.Contains('\') -or $entry.FullName.Contains('../')) { throw 'ZIP contains an unsafe entry.' }
            $stream = $entry.Open()
            try { $buffer = New-Object byte[] 8192; while ($stream.Read($buffer,0,$buffer.Length) -gt 0) {} } finally { $stream.Dispose() }
        }
    } finally { $zip.Dispose() }
}

function Assert-StandardCompleteArchive {
    param([Parameter(Mandatory)]$Context,[Parameter(Mandatory)][string]$Directory)
    $completeName="$($Context.SoftwareName)-完整交付包.zip";$completePath=Join-Path $Directory $completeName
    [void](Assert-StandardRegularFile $completePath);$expected=@(Get-ExpectedStandardArtifactNames -Context $Context|Where-Object{$_-cne$completeName}|Sort-Object)
    $archive=[IO.Compression.ZipFile]::OpenRead($completePath)
    try{
        $entries=@($archive.Entries);$actual=@($entries|ForEach-Object FullName|Sort-Object)
        if($entries.Count -ne 17 -or @($entries|Group-Object FullName|Where-Object Count -ne 1).Count -or (($actual-join"`n") -cne ($expected-join"`n"))){throw 'Complete archive does not match the seventeen-file contract.'}
        foreach($entry in $entries){if($entry.FullName.Contains('/') -or $entry.FullName.Contains('\')){throw 'Complete archive must contain flat regular entries.'};$stream=$entry.Open();$sha=[Security.Cryptography.SHA256]::Create();try{$entryHash=[BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose();$stream.Dispose()};if($entryHash -cne (Get-LowerFileHash (Join-Path $Directory $entry.FullName))){throw "Complete archive entry hash mismatch: $($entry.FullName)"}}
    }finally{$archive.Dispose()}
}

function Get-ExpectedStandardArtifactNames {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Context)
    $name = [string]$Context.SoftwareName; $version = [string]$Context.Version
    if ([string]::IsNullOrWhiteSpace($name) -or [string]::IsNullOrWhiteSpace($version)) { throw 'Software name and version are required.' }
    $result = [Collections.Generic.List[string]]::new()
    $result.Add("$name V$version 安装包.exe")
    foreach ($binding in Get-StandardMaterialArtifactBindings -Context $Context) {
        $result.Add([string]$binding.artifactDocx)
        if ($null -ne $binding.pdf) { $result.Add([string]$binding.artifactPdf) }
    }
    foreach ($artifact in @("$name-项目源码.zip",'业务蓝图.json','领域版本锁.json','验收报告.json','校验报告.txt',"$name-完整交付包.zip")) { $result.Add($artifact) }
    return $result.ToArray()
}

function New-StandardSourceArchive {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]$Context,
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [Parameter(Mandatory)]$SourceManifest,
        [Parameter(Mandatory)][string]$SourceManifestPath,
        [Parameter(Mandatory)][hashtable]$GeneratedFiles
    )
    $workspace = [IO.Path]::GetFullPath([string]$Context.WorkspacePath)
    $repository = [IO.Path]::GetFullPath($RepositoryRoot).TrimEnd('\')
    $archivePath = Assert-SafeChildPath -Root $workspace -Candidate (Join-Path $workspace ($Context.SoftwareName + '-项目源码.zip'))
    if (Test-Path -LiteralPath $archivePath) { throw "Refusing to overwrite source archive: $archivePath" }
    $manifestFile = Assert-StandardRegularFile -Path ([IO.Path]::GetFullPath($SourceManifestPath))
    $allowedGenerated = @('standard-project-request.json','theme-profile.json','blueprint.json','domain-lock.json','project.lock.json','resource-manifest.json')
    if ($GeneratedFiles.Count -ne $allowedGenerated.Count) { throw 'Generated source archive files do not match the contract.' }
    foreach ($name in $allowedGenerated) { if (-not $GeneratedFiles.ContainsKey($name)) { throw "Generated source archive is missing '$name'." } }
    $sourceItems = [Collections.Generic.List[object]]::new()
    foreach ($entry in @($SourceManifest.files | Sort-Object path)) {
        if ([string]$entry.path -match '(^|/)(node_modules|dist|test-results|coverage|\.git)(/|$)|\.(sqlite3?|db|log)$') { throw "Forbidden source manifest path: $($entry.path)" }
        $fullPath = [IO.Path]::GetFullPath((Join-Path $repository ([string]$entry.path).Replace('/','\')))
        if (-not $fullPath.StartsWith($repository + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Source manifest path escaped the repository.' }
        $file = Assert-StandardRegularFile -Path $fullPath
        if ((Get-LowerFileHash $file.FullName) -cne [string]$entry.sha256 -or $file.Length -ne [long]$entry.bytes) { throw "Source manifest hash or size mismatch: $($entry.path)" }
        $sourceItems.Add([pscustomobject]@{ File=$file; Name=[string]$entry.path })
    }
    if ($sourceItems.Count -ne [int]$SourceManifest.totalFiles) { throw 'Source manifest file count mismatch.' }
    if ((Get-SourceManifestContentHash -SourceManifest $SourceManifest) -cne [string]$SourceManifest.sha256) { throw 'Source manifest content hash mismatch.' }
    try {
        $archive = [IO.Compression.ZipFile]::Open($archivePath, [IO.Compression.ZipArchiveMode]::Create)
        try {
            foreach ($source in $sourceItems) { Add-StandardZipEntry -Archive $archive -File $source.File -Name $source.Name }
            Add-StandardZipEntry -Archive $archive -File $manifestFile -Name 'source-manifest.json'
            foreach ($name in $allowedGenerated) {
                $file = Assert-StandardRegularFile -Path ([IO.Path]::GetFullPath([string]$GeneratedFiles[$name]))
                Add-StandardZipEntry -Archive $archive -File $file -Name ('generated/' + $name)
            }
            $instructions = $archive.CreateEntry('重建说明.txt', [IO.Compression.CompressionLevel]::Optimal)
            $writer = [IO.StreamWriter]::new($instructions.Open(), [Text.UTF8Encoding]::new($true))
            try {
                $writer.WriteLine('本压缩包包含标准桌面运行时、所选生产领域包、锁定生成配置、构建工具和资源清单。')
                $writer.WriteLine('解压后在 engine/domain-packs 与 engine/desktop-runtime 分别执行 npm ci。')
                $writer.WriteLine('在 engine/desktop-runtime 执行 npm run build，再执行：')
                $writer.WriteLine('powershell -NoProfile -ExecutionPolicy Bypass -File tools/build-standard-desktop.ps1 -RequestPath <generated/standard-project-request.json 的绝对路径> -OutputRoot <新的绝对输出目录>')
            } finally { $writer.Dispose() }
        } finally { $archive.Dispose() }
        Assert-StandardZipReadable -Path $archivePath
        return Get-Item -LiteralPath $archivePath
    }
    catch {
        if (Test-Path -LiteralPath $archivePath) { Remove-Item -LiteralPath $archivePath -Force }
        throw
    }
}

function Get-StandardArchiveEntryHash($Entry) {
    $stream=$Entry.Open();$sha=[Security.Cryptography.SHA256]::Create()
    try{return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','').ToLowerInvariant()}
    finally{$sha.Dispose();$stream.Dispose()}
}

function Assert-StandardSourceArchiveEvidence {
    param([Parameter(Mandatory)]$Context,[Parameter(Mandatory)][IO.FileInfo[]]$Artifacts,[Parameter(Mandatory)]$Receipts,[Parameter(Mandatory)]$SourceManifest)
    $archiveName="$($Context.SoftwareName)-项目源码.zip";$matches=@($Artifacts|Where-Object Name -CEQ $archiveName)
    if($matches.Count -ne 1){throw 'Project source archive is missing.'}
    $archiveFile=Assert-StandardRegularFile $matches[0].FullName
    if($null-eq$Receipts.PSObject.Properties['SourceArchive']-or[string]$Receipts.SourceArchive.status-ne'passed'-or[string]$Receipts.SourceArchive.sha256-notmatch'^[0-9a-f]{64}$'-or(Get-LowerFileHash $archiveFile.FullName)-cne[string]$Receipts.SourceArchive.sha256){throw 'Project source archive receipt hash mismatch.'}
    $generated=@('standard-project-request.json','theme-profile.json','blueprint.json','domain-lock.json','project.lock.json','resource-manifest.json')
    $expected=@($SourceManifest.files|ForEach-Object{[string]$_.path})+@('source-manifest.json','重建说明.txt')+@($generated|ForEach-Object{'generated/'+$_})
    try{
        $archive=[IO.Compression.ZipFile]::OpenRead($archiveFile.FullName)
        try{
            $entries=@($archive.Entries);$actual=@($entries|ForEach-Object FullName|Sort-Object);$sortedExpected=@($expected|Sort-Object)
            if($entries.Count-ne$expected.Count-or@($entries|Group-Object FullName|Where-Object Count -ne 1).Count-or(($actual-join"`n")-cne($sortedExpected-join"`n"))){throw 'SOURCE_ARCHIVE_ENTRIES'}
            foreach($entry in $entries){if($entry.FullName.Contains('\')-or$entry.FullName.StartsWith('/')-or$entry.FullName.Contains('../')-or$entry.FullName-match'^[A-Za-z]:'){throw 'SOURCE_ARCHIVE_PATH'}}
            $manifestEntry=$archive.GetEntry('source-manifest.json');$reader=[IO.StreamReader]::new($manifestEntry.Open(),[Text.Encoding]::UTF8,$true)
            try{$archivedManifest=$reader.ReadToEnd()|ConvertFrom-Json -ErrorAction Stop}finally{$reader.Dispose()}
            if((ConvertTo-CanonicalStandardJson $archivedManifest)-cne(ConvertTo-CanonicalStandardJson $SourceManifest)-or(Get-SourceManifestContentHash $archivedManifest)-cne[string]$SourceManifest.sha256){throw 'SOURCE_ARCHIVE_MANIFEST'}
            foreach($source in @($SourceManifest.files)){$entry=$archive.GetEntry([string]$source.path);if($null-eq$entry-or$entry.Length-ne[long]$source.bytes-or(Get-StandardArchiveEntryHash $entry)-cne[string]$source.sha256){throw 'SOURCE_ARCHIVE_SOURCE'}}
            foreach($binding in @(@('generated/blueprint.json',[string]$Receipts.Package.blueprintSha256),@('generated/domain-lock.json',[string]$Receipts.Package.domainLockSha256),@('generated/resource-manifest.json',[string]$Receipts.Materials.resourceManifestSha256))){$entry=$archive.GetEntry($binding[0]);if($null-eq$entry-or(Get-StandardArchiveEntryHash $entry)-cne$binding[1]){throw 'SOURCE_ARCHIVE_GENERATED'}}
        }finally{$archive.Dispose()}
    }catch{throw 'Project source archive evidence is invalid.'}
}

function Assert-StandardMaterialEvidence {
    param(
        [Parameter(Mandatory)]$Receipts,[Parameter(Mandatory)]$SourceManifest,
        [Parameter(Mandatory)][string]$MaterialFactsPath,[Parameter(Mandatory)]$SourcePlan,
        [Parameter(Mandatory)][string]$ScreenshotManifestPath,[Parameter(Mandatory)][string]$ScreenshotRoot
    )
    $material=$Receipts.Materials
    $factsFile=Assert-StandardRegularFile ([IO.Path]::GetFullPath($MaterialFactsPath))
    $screenshotFile=Assert-StandardRegularFile ([IO.Path]::GetFullPath($ScreenshotManifestPath))
    $screenshotDirectory=Assert-StandardRegularDirectory ([IO.Path]::GetFullPath($ScreenshotRoot)) 'screenshots'
    try{$facts=Get-Content -Raw -Encoding UTF8 -LiteralPath $factsFile.FullName|ConvertFrom-Json -ErrorAction Stop}catch{throw 'Material facts evidence is invalid JSON.'}
    try{$screenshotManifest=Get-Content -Raw -Encoding UTF8 -LiteralPath $screenshotFile.FullName|ConvertFrom-Json -ErrorAction Stop}catch{throw 'Screenshot manifest evidence is invalid JSON.'}
    if((Get-StandardTextHash (ConvertTo-CanonicalStandardJson $facts))-cne[string]$material.factsSha256){throw 'Material facts hash mismatch.'}
    foreach($hashName in @('executableSha256','resourceManifestSha256','blueprintSha256')){if([string]$facts.evidence.$hashName-cne[string]$material.$hashName){throw "Material facts $hashName binding mismatch."}}
    $manifestHash=Get-StandardTextHash (ConvertTo-CanonicalStandardJson $screenshotManifest)
    if($manifestHash-cne[string]$material.screenshotManifestSha256-or[string]$facts.evidence.screenshotManifestSha256-cne$manifestHash-or(Get-StandardTextHash (ConvertTo-CanonicalStandardJson $facts.screenshots))-cne$manifestHash){throw 'Screenshot manifest hash mismatch.'}
    if([string]$facts.source.sha256-cne[string]$SourceManifest.sha256-or[string]$facts.evidence.sourceSha256-cne[string]$SourceManifest.sha256-or[string]$SourcePlan.sourceManifestSha256-cne[string]$SourceManifest.sha256){throw 'Material source manifest evidence mismatch.'}
    if([string]$SourcePlan.selectionSha256-cne[string]$material.sourceSelectionSha256){throw 'Material source selection hash mismatch.'}
    $factCaptures=@($facts.screenshots.captures);$manifestCaptures=@($screenshotManifest.captures)
    if($manifestCaptures.Count -lt 12 -or $manifestCaptures.Count -gt 18 -or $factCaptures.Count -ne $manifestCaptures.Count){throw 'Screenshot evidence set is invalid.'}
    $imageHashes=[Collections.Generic.List[string]]::new();$names=[Collections.Generic.List[string]]::new()
    foreach($capture in $manifestCaptures){
        $name=[string]$capture.fileName
        if($name-notmatch'^[a-z0-9][a-z0-9_-]*\.png$'-or$names.Contains($name)){throw 'Screenshot evidence file name is invalid.'};$names.Add($name)
        $factCapture=@($factCaptures|Where-Object{[string]$_.fileName-ceq$name})
        if($factCapture.Count -ne 1 -or [string]$factCapture[0].imageSha256 -cne [string]$capture.imageSha256){throw 'Screenshot facts binding mismatch.'}
        $path=[IO.Path]::GetFullPath((Join-Path $screenshotDirectory.FullName $name))
        if(-not$path.StartsWith($screenshotDirectory.FullName.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Screenshot evidence path escaped its root.'}
        $file=Assert-StandardRegularFile $path;$hash=Get-LowerFileHash $file.FullName
        if($hash-cne[string]$capture.imageSha256){throw 'Screenshot image hash mismatch.'};$imageHashes.Add($hash)
    }
    if((Get-StandardTextHash (@($imageHashes|Sort-Object)-join"`n"))-cne[string]$material.screenshotSha256){throw 'Screenshot image set digest mismatch.'}
}

function Assert-ReceiptHashSet {
    param([Parameter(Mandatory)]$Context, [Parameter(Mandatory)]$Receipts, [Parameter(Mandatory)]$SourceManifest, [Parameter(Mandatory)][IO.FileInfo[]]$Artifacts)
    foreach ($name in @('Installer','Package','E2E','Materials')) {
        $property = $Receipts.PSObject.Properties[$name]
        if ($null -eq $property -or [string]$property.Value.status -ne 'passed') { throw "Receipt '$name' is missing or did not pass." }
        foreach ($hashName in @('executableSha256','resourceManifestSha256')) {
            if ([string]$property.Value.$hashName -notmatch '^[0-9a-f]{64}$') { throw "Receipt '$name' has an invalid $hashName hash." }
        }
    }
    $executableHashes = @($Receipts.Installer.executableSha256,$Receipts.Package.executableSha256,$Receipts.E2E.executableSha256,$Receipts.Materials.executableSha256 | Sort-Object -Unique)
    $resourceHashes = @($Receipts.Installer.resourceManifestSha256,$Receipts.Package.resourceManifestSha256,$Receipts.E2E.resourceManifestSha256,$Receipts.Materials.resourceManifestSha256 | Sort-Object -Unique)
    if ($executableHashes.Count -ne 1 -or $resourceHashes.Count -ne 1) { throw 'Evidence hash mismatch between receipts.' }
    if ([string]$Receipts.Materials.sourceManifestSha256 -cne [string]$SourceManifest.sha256) { throw 'Source manifest hash mismatch between materials and publishing.' }
    Assert-StandardSourceArchiveEvidence -Context $Context -Artifacts $Artifacts -Receipts $Receipts -SourceManifest $SourceManifest
    $installer = @($Artifacts | Where-Object Name -Like '*安装包.exe')
    if ($installer.Count -ne 1 -or (Get-LowerFileHash $installer[0].FullName) -cne [string]$Receipts.Installer.installerSha256) { throw 'Installer artifact hash mismatch.' }
    foreach ($binding in @(@('业务蓝图.json','blueprintSha256'),@('领域版本锁.json','domainLockSha256'))) {
        $file = @($Artifacts | Where-Object Name -CEQ $binding[0])
        if ($file.Count -ne 1 -or (Get-LowerFileHash $file[0].FullName) -cne [string]$Receipts.Package.($binding[1])) { throw "$($binding[0]) artifact hash mismatch." }
    }
    $acceptanceFile = @($Artifacts | Where-Object Name -CEQ '验收报告.json')
    if ($acceptanceFile.Count -ne 1) { throw 'Acceptance report artifact is missing.' }
    try { $acceptance = Get-Content -Raw -Encoding UTF8 -LiteralPath $acceptanceFile[0].FullName | ConvertFrom-Json -ErrorAction Stop }
    catch { throw 'Acceptance report is invalid JSON.' }
    if ([string]$acceptance.status -ne 'passed' -or [string]$acceptance.executableSha256 -cne [string]$Receipts.E2E.executableSha256 -or
        [string]$acceptance.resourceManifestSha256 -cne [string]$Receipts.E2E.resourceManifestSha256) { throw 'Acceptance report hash mismatch.' }

    $material = $Receipts.Materials
    if ([string]$material.receiptVersion -ne '1.0') { throw 'Material receipt version is invalid.' }
    foreach ($hashName in @('factsSha256','blueprintSha256','sourceSelectionSha256','screenshotManifestSha256','screenshotSha256')) {
        if ([string]$material.$hashName -notmatch '^[0-9a-f]{64}$') { throw "Material receipt has an invalid $hashName hash." }
    }
    if ([string]$material.blueprintSha256 -cne [string]$Receipts.Package.blueprintSha256) { throw 'Material receipt blueprint hash mismatch.' }
    $bindings = @(Get-StandardMaterialArtifactBindings -Context $Context)
    $documents = @($material.documents)
    if ($documents.Count -ne $bindings.Count -or @($documents | Group-Object id | Where-Object Count -ne 1).Count -gt 0) { throw 'Material receipt document set is invalid.' }
    foreach ($binding in $bindings) {
        $document = @($documents | Where-Object { [string]$_.id -ceq [string]$binding.id })
        if ($document.Count -ne 1 -or [string]$document[0].fileName -cne [string]$binding.docx) { throw 'Material receipt document set is invalid.' }
        $document = $document[0]
        $artifact = @($Artifacts | Where-Object Name -CEQ ([string]$binding.artifactDocx))
        if ($artifact.Count -ne 1 -or [string]$document.sha256 -notmatch '^[0-9a-f]{64}$' -or (Get-LowerFileHash $artifact[0].FullName) -cne [string]$document.sha256) { throw "Material document hash mismatch: $($binding.id)." }
        try { $pages=[int]$document.pages; $characters=[int]$document.characters; $paragraphs=[int]$document.paragraphs; $tables=[int]$document.tables; $mediaCount=[int]$document.mediaCount } catch { throw "Material document metrics are invalid: $($binding.id)." }
        if ($pages -lt 1 -or $characters -lt 0 -or $paragraphs -lt 1 -or $tables -lt 0 -or $mediaCount -lt 0) { throw "Material document metrics are invalid: $($binding.id)." }
        $mediaHashes = @($document.mediaSha256)
        if ($mediaHashes.Count -ne $mediaCount -or @($mediaHashes | Where-Object { [string]$_ -notmatch '^[0-9a-f]{64}$' }).Count -gt 0 -or @($mediaHashes | Sort-Object -Unique).Count -ne $mediaHashes.Count) { throw "Material document media hashes are invalid: $($binding.id)." }
        if ($null -eq $binding.pdf) {
            if ($null -ne $document.pdf) { throw "Material document PDF binding is invalid: $($binding.id)." }
        }
        else {
            $pdfArtifact = @($Artifacts | Where-Object Name -CEQ ([string]$binding.artifactPdf))
            if ($null -eq $document.pdf -or [string]$document.pdf.fileName -cne [string]$binding.pdf -or $pdfArtifact.Count -ne 1 -or
                [string]$document.pdf.sha256 -notmatch '^[0-9a-f]{64}$' -or (Get-LowerFileHash $pdfArtifact[0].FullName) -cne [string]$document.pdf.sha256 -or
                [int]$document.pdf.pages -ne $pages -or $document.pdf.nonblank -ne $true) { throw "Material document PDF binding is invalid: $($binding.id)." }
        }
    }
    return [pscustomobject]@{ executable=$executableHashes[0]; resource=$resourceHashes[0]; source=[string]$SourceManifest.sha256; documents=$documents }
}

function Assert-StandardDeliverySet {
    param(
        [Parameter(Mandatory)]$Context,[Parameter(Mandatory)][string]$Directory,[Parameter(Mandatory)]$Receipts,
        [Parameter(Mandatory)]$SourceManifest,[Parameter(Mandatory)][string]$MaterialFactsPath,[Parameter(Mandatory)]$SourcePlan,
        [Parameter(Mandatory)][string]$ScreenshotManifestPath,[Parameter(Mandatory)][string]$ScreenshotRoot
    )
    $directoryItem=Assert-StandardRegularDirectory $Directory 'delivery staging'
    $expected=@(Get-ExpectedStandardArtifactNames -Context $Context|Sort-Object);$items=@(Get-ChildItem -LiteralPath $directoryItem.FullName -Force)
    $actual=@($items|ForEach-Object Name|Sort-Object)
    if($items.Count -ne 18 -or @($items|Where-Object PSIsContainer).Count -or (($actual-join"`n") -cne ($expected-join"`n"))){throw 'Standard delivery staging does not match the eighteen-file contract.'}
    foreach($item in $items){[void](Assert-StandardRegularFile $item.FullName)}
    [void](Assert-ReceiptHashSet -Context $Context -Receipts $Receipts -SourceManifest $SourceManifest -Artifacts @($items))
    Assert-StandardMaterialEvidence -Receipts $Receipts -SourceManifest $SourceManifest -MaterialFactsPath $MaterialFactsPath -SourcePlan $SourcePlan -ScreenshotManifestPath $ScreenshotManifestPath -ScreenshotRoot $ScreenshotRoot
    Assert-StandardCompleteArchive -Context $Context -Directory $directoryItem.FullName
}

function New-StandardDeliveryStaging {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]$Context,[Parameter(Mandatory)][IO.FileInfo[]]$Artifacts,[Parameter(Mandatory)]$Receipts,
        [Parameter(Mandatory)]$SourceManifest,[Parameter(Mandatory)][string]$MaterialFactsPath,[Parameter(Mandatory)]$SourcePlan,
        [Parameter(Mandatory)][string]$ScreenshotManifestPath,[Parameter(Mandatory)][string]$ScreenshotRoot)
    $workspace = [IO.Path]::GetFullPath([string]$Context.WorkspacePath)
    $staging = Assert-SafeChildPath -Root $workspace -Candidate (Join-Path $workspace 'standard-publish-staging')
    if (Test-Path -LiteralPath $staging) { throw "Publishing staging already exists: $staging" }
    $expected = @(Get-ExpectedStandardArtifactNames -Context $Context)
    $completeName = "$($Context.SoftwareName)-完整交付包.zip"
    $providedExpected = @($expected | Where-Object { $_ -notin @('校验报告.txt',$completeName) })
    $actualNames = @($Artifacts | ForEach-Object Name)
    $missing = @($providedExpected | Where-Object { $actualNames -cnotcontains $_ })
    $unexpected = @($actualNames | Where-Object { $providedExpected -cnotcontains $_ })
    if ($missing.Count -gt 0 -or $unexpected.Count -gt 0 -or @($actualNames | Group-Object | Where-Object Count -ne 1).Count -gt 0) { throw 'Standard delivery artifact names do not match the contract.' }
    foreach ($artifact in $Artifacts) { [void](Assert-StandardRegularFile -Path $artifact.FullName) }
    $hashes = Assert-ReceiptHashSet -Context $Context -Receipts $Receipts -SourceManifest $SourceManifest -Artifacts $Artifacts
    Assert-StandardMaterialEvidence -Receipts $Receipts -SourceManifest $SourceManifest -MaterialFactsPath $MaterialFactsPath -SourcePlan $SourcePlan -ScreenshotManifestPath $ScreenshotManifestPath -ScreenshotRoot $ScreenshotRoot
    try {
        New-Item -ItemType Directory -Path $staging | Out-Null
        foreach ($name in $providedExpected) {
            $artifact = @($Artifacts | Where-Object Name -CEQ $name)[0]
            Copy-Item -LiteralPath $artifact.FullName -Destination (Join-Path $staging $name)
        }
        $reportLines = [Collections.Generic.List[string]]::new()
        foreach ($line in @(
            "软件名称：$($Context.SoftwareName)", "版本：V$($Context.Version)", "运行编号：$($Context.RunId)",
            '结果：安装包、桌面程序、资源、领域测试、打包态登录、持久化、截图和文档逐项验证通过。',
            "程序 SHA-256：$($hashes.executable)", "资源清单 SHA-256：$($hashes.resource)", "源码清单 SHA-256：$($hashes.source)"
        )) { $reportLines.Add($line) }
        $reportLines.Add('材料量化结果：')
        foreach ($binding in Get-StandardMaterialArtifactBindings -Context $Context) {
            $document = @($hashes.documents | Where-Object { [string]$_.id -ceq [string]$binding.id })[0]
            $reportLines.Add(('{0}：页数 {1}；字符 {2}；表格 {3}；图片 {4}' -f $binding.label,$document.pages,$document.characters,$document.tables,$document.mediaCount))
        }
        $report = $reportLines -join "`r`n"
        if ($report -match '(?i)gh[pousr]_|github_pat_|password|token|[A-Z]:\\') { throw 'Validation report contains forbidden content.' }
        [IO.File]::WriteAllText((Join-Path $staging '校验报告.txt'), $report, [Text.UTF8Encoding]::new($true))
        $completePath = Join-Path $staging $completeName
        $archive = [IO.Compression.ZipFile]::Open($completePath, [IO.Compression.ZipArchiveMode]::Create)
        try {
            foreach ($file in Get-ChildItem -LiteralPath $staging -File | Where-Object Name -CNE $completeName | Sort-Object Name) { Add-StandardZipEntry -Archive $archive -File $file -Name $file.Name }
        } finally { $archive.Dispose() }
        Assert-StandardZipReadable -Path $completePath
        Assert-StandardDeliverySet -Context $Context -Directory $staging -Receipts $Receipts -SourceManifest $SourceManifest -MaterialFactsPath $MaterialFactsPath -SourcePlan $SourcePlan -ScreenshotManifestPath $ScreenshotManifestPath -ScreenshotRoot $ScreenshotRoot
        return $staging
    }
    catch {
        if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
        throw
    }
}

function Publish-StandardDelivery {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]$Context,[Parameter(Mandatory)][string]$StagingPath,[Parameter(Mandatory)]$Receipts,
        [Parameter(Mandatory)]$SourceManifest,[Parameter(Mandatory)][string]$MaterialFactsPath,[Parameter(Mandatory)]$SourcePlan,
        [Parameter(Mandatory)][string]$ScreenshotManifestPath,[Parameter(Mandatory)][string]$ScreenshotRoot,
        [scriptblock]$CopyFileAction)
    $workspace=[IO.Path]::GetFullPath([string]$Context.WorkspacePath)
    $staging=Assert-SafeChildPath -Root $workspace -Candidate ([IO.Path]::GetFullPath($StagingPath))
    Assert-StandardDeliverySet -Context $Context -Directory $staging -Receipts $Receipts -SourceManifest $SourceManifest -MaterialFactsPath $MaterialFactsPath -SourcePlan $SourcePlan -ScreenshotManifestPath $ScreenshotManifestPath -ScreenshotRoot $ScreenshotRoot
    $requested=[IO.Path]::GetFullPath([string]$Context.RequestedDeliveryPath);$deliveryRoot=Split-Path -Parent $requested
    [void](Assert-SafeChildPath -Root $deliveryRoot -Candidate $requested)
    if(-not(Test-Path -LiteralPath $deliveryRoot)){New-Item -ItemType Directory -Path $deliveryRoot -Force|Out-Null}
    [void](Assert-StandardRegularDirectory $deliveryRoot 'delivery root')
    $target=$requested
    if(Test-Path -LiteralPath $target){$suffix=Get-Date -Format 'yyyyMMdd-HHmmss';$target="$requested-$suffix";$counter=2;while(Test-Path -LiteralPath $target){$target="$requested-$suffix-$counter";$counter++}}
    [void](Assert-SafeChildPath -Root $deliveryRoot -Candidate $target)
    $publishStage=Join-Path $deliveryRoot ('.standard-delivery.staging-'+[guid]::NewGuid().ToString('N'))
    try{
        New-Item -ItemType Directory -Path $publishStage|Out-Null
        $index=0
        foreach($file in Get-ChildItem -LiteralPath $staging -File|Sort-Object Name){$index++;$destination=Join-Path $publishStage $file.Name;if($null-eq$CopyFileAction){Copy-Item -LiteralPath $file.FullName -Destination $destination}else{& $CopyFileAction $file.FullName $destination $index}}
        Assert-StandardDeliverySet -Context $Context -Directory $publishStage -Receipts $Receipts -SourceManifest $SourceManifest -MaterialFactsPath $MaterialFactsPath -SourcePlan $SourcePlan -ScreenshotManifestPath $ScreenshotManifestPath -ScreenshotRoot $ScreenshotRoot
        [IO.Directory]::Move($publishStage,$target)
        try{Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction Stop}catch{}
        return $target
    }finally{if(Test-Path -LiteralPath $publishStage){Remove-Item -LiteralPath $publishStage -Recurse -Force}}
}

Export-ModuleMember -Function Get-ExpectedStandardArtifactNames, New-StandardSourceArchive, New-StandardDeliveryStaging, Publish-StandardDelivery
