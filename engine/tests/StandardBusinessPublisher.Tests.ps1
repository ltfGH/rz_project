. "$PSScriptRoot\Assert.ps1"
$ErrorActionPreference = 'Stop'

$modulePath = Join-Path $PSScriptRoot '..\lib\StandardBusinessPublisher.psm1'
Import-Module $modulePath -Force -DisableNameChecking
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Get-TestHash([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Get-TestZipNames([string]$Path) {
    $archive = [IO.Compression.ZipFile]::OpenRead($Path)
    try { @($archive.Entries | ForEach-Object FullName) } finally { $archive.Dispose() }
}
function Set-TestZipEntryText([string]$Path,[string]$Name,[string]$Text) {
    $archive=[IO.Compression.ZipFile]::Open($Path,[IO.Compression.ZipArchiveMode]::Update)
    try{$entry=$archive.GetEntry($Name);if($null-eq$entry){throw "Fixture ZIP entry is missing: $Name"};$entry.Delete();$replacement=$archive.CreateEntry($Name);$writer=[IO.StreamWriter]::new($replacement.Open(),[Text.UTF8Encoding]::new($false));try{$writer.Write($Text)}finally{$writer.Dispose()}}finally{$archive.Dispose()}
}
function ConvertTo-TestCanonicalJson($Value) {
    if ($null -eq $Value) { return 'null' }
    if ($Value -is [bool]) { return $(if($Value){'true'}else{'false'}) }
    if ($Value -is [string] -or $Value -is [char]) { return ConvertTo-Json ([string]$Value) -Compress }
    if ($Value -is [byte] -or $Value -is [int16] -or $Value -is [int32] -or $Value -is [int64] -or $Value -is [single] -or $Value -is [double] -or $Value -is [decimal]) { return [Convert]::ToString($Value,[Globalization.CultureInfo]::InvariantCulture) }
    if ($Value -is [Collections.IDictionary]) { $names=@($Value.Keys|ForEach-Object{[string]$_}|Sort-Object);return '{'+(@($names|ForEach-Object{(ConvertTo-Json $_ -Compress)+':'+(ConvertTo-TestCanonicalJson $Value[$_])})-join',')+'}' }
    if ($Value -is [Collections.IEnumerable] -and $Value -isnot [string]) { return '['+(@($Value|ForEach-Object{ConvertTo-TestCanonicalJson $_})-join',')+']' }
    $properties=@($Value.PSObject.Properties|Where-Object MemberType -in @('NoteProperty','Property')|Sort-Object Name);return '{'+(@($properties|ForEach-Object{(ConvertTo-Json $_.Name -Compress)+':'+(ConvertTo-TestCanonicalJson $_.Value)})-join',')+'}'
}
function Get-TestTextHash([string]$Text) { $sha=[Security.Cryptography.SHA256]::Create();try{[BitConverter]::ToString($sha.ComputeHash([Text.UTF8Encoding]::new($false).GetBytes($Text))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()} }

$root = Join-Path $env:TEMP ('standard-publisher-test-' + [guid]::NewGuid().ToString('N'))
$crossDeliveryRoot = $null
try {
    $repository = Join-Path $root 'repository'
    $workspace = Join-Path $root 'workspace'
    $artifactRoot = Join-Path $workspace 'artifacts'
    New-Item -ItemType Directory -Path (Join-Path $repository 'engine\desktop-runtime\src') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $repository 'engine\domain-packs\packs\asset_registry') -Force | Out-Null
    New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null
    $sourceFiles = @('engine/desktop-runtime/src/main.ts','engine/domain-packs/packs/asset_registry/index.ts')
    foreach ($relative in $sourceFiles) {
        $path = Join-Path $repository $relative.Replace('/','\')
        [IO.File]::WriteAllText($path, "export const value = true;`n", [Text.UTF8Encoding]::new($false))
    }
    $entries = @($sourceFiles | ForEach-Object {
        $path = Join-Path $repository $_.Replace('/','\')
        [pscustomobject]@{ path=$_; lines=1; bytes=(Get-Item $path).Length; sha256=Get-TestHash $path }
    })
    $canonical = ($entries | Sort-Object path | ForEach-Object { '{0}|{1}|{2}|{3}' -f $_.path,$_.lines,$_.bytes,$_.sha256 }) -join "`n"
    $canonicalBytes = [Text.UTF8Encoding]::new($false).GetBytes($canonical)
    $sourceDigest = [BitConverter]::ToString(([Security.Cryptography.SHA256]::Create().ComputeHash($canonicalBytes))).Replace('-','').ToLowerInvariant()
    $sourceManifest = [pscustomobject]@{ manifestVersion='1.0'; templateId='asset_work_order_operations'; totalFiles=2; totalLines=2; sha256=$sourceDigest; files=$entries }
    $sourceManifestPath = Join-Path $workspace 'source-manifest.json'
    [IO.File]::WriteAllText($sourceManifestPath, ($sourceManifest | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
    $sourcePlan = [pscustomobject]@{ sourceManifestSha256=$sourceDigest; selectionSha256=('4'*64) }
    $screenshotRoot = Join-Path $workspace 'screenshots'
    New-Item -ItemType Directory -Path $screenshotRoot | Out-Null
    $captures = @(0..11 | ForEach-Object {
        $fileName = 'scene-' + $_ + '.png'; $filePath = Join-Path $screenshotRoot $fileName
        [IO.File]::WriteAllBytes($filePath,[Text.UTF8Encoding]::new($false).GetBytes('screenshot-'+$_))
        [pscustomobject]@{ scenarioId=('scene_'+$_); fileName=$fileName; imageSha256=(Get-TestHash $filePath) }
    })
    $expectedBlueprintHash = Get-TestTextHash '{"file":"blueprint.json"}'
    $expectedResourceHash = Get-TestTextHash '{"file":"resource-manifest.json"}'
    $screenshotManifest = [pscustomobject]@{ manifestVersion='2.0'; templateId='asset_work_order_operations'; executableSha256=('1'*64); blueprintSha256=$expectedBlueprintHash; captures=$captures }
    $screenshotManifestPath = Join-Path $workspace 'screenshot-manifest.json'
    [IO.File]::WriteAllText($screenshotManifestPath,($screenshotManifest|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
    $screenshotManifestHash = Get-TestTextHash (ConvertTo-TestCanonicalJson $screenshotManifest)
    $facts = [pscustomobject]@{ factVersion='1.0'; templateId='asset_work_order_operations'; evidence=[pscustomobject]@{ status='passed'; executableSha256=('1'*64); resourceManifestSha256=$expectedResourceHash; blueprintSha256=$expectedBlueprintHash; sourceSha256=$sourceDigest; screenshotManifestSha256=$screenshotManifestHash }; screenshots=$screenshotManifest; source=$sourceManifest }
    $materialFactsPath = Join-Path $workspace 'material-facts.json'
    [IO.File]::WriteAllText($materialFactsPath,(ConvertTo-TestCanonicalJson $facts),[Text.UTF8Encoding]::new($false))
    $factsHash = Get-TestTextHash (ConvertTo-TestCanonicalJson $facts)
    $screenshotDigest = Get-TestTextHash ((@($captures.imageSha256|Sort-Object)-join"`n"))

    $generated = @{}
    foreach ($name in @('standard-project-request.json','theme-profile.json','blueprint.json','domain-lock.json','project.lock.json','resource-manifest.json')) {
        $path = Join-Path $workspace $name
        [IO.File]::WriteAllText($path, ('{"file":"' + $name + '"}'), [Text.UTF8Encoding]::new($false))
        $generated[$name] = $path
    }
    $context = [pscustomobject]@{ WorkspacePath=$workspace; SoftwareName='园区资产工单软件'; Version='1.0.0'; RunId='run-standard-1'; RequestedDeliveryPath=(Join-Path $root 'delivery\园区资产工单软件') }
    $sourceArchive = New-StandardSourceArchive -Context $context -RepositoryRoot $repository -SourceManifest $sourceManifest -SourceManifestPath $sourceManifestPath -GeneratedFiles $generated
    $sourceZipNames = @(Get-TestZipNames $sourceArchive.FullName | Sort-Object)
    foreach ($relative in $sourceFiles) { Assert-Equal ($sourceZipNames -contains $relative) $true }
    foreach ($name in $generated.Keys) { Assert-Equal ($sourceZipNames -contains ('generated/' + $name)) $true }
    Assert-Equal ($sourceZipNames -contains 'source-manifest.json') $true
    Assert-Equal ($sourceZipNames -contains '重建说明.txt') $true
    Assert-Equal (($sourceZipNames -join '|') -match 'node_modules|dist|\.sqlite|secret|[A-Z]:') $false

    $expected = @(Get-ExpectedStandardArtifactNames -Context $context)
    Assert-Equal $expected.Count 18
    foreach ($name in @(
        "$($context.SoftwareName)-软件介绍.docx",
        "$($context.SoftwareName)-功能表.docx",
        "$($context.SoftwareName)-数据库设计.docx"
    )) { Assert-Equal ($expected -ccontains $name) $true }
    $providedNames = @($expected | Where-Object { $_ -notin @('校验报告.txt', "$($context.SoftwareName)-完整交付包.zip") })
    $artifacts = [Collections.Generic.List[IO.FileInfo]]::new()
    foreach ($name in $providedNames) {
        if ($name -eq "$($context.SoftwareName)-项目源码.zip") { $artifacts.Add($sourceArchive); continue }
        $path = Join-Path $artifactRoot $name
        if ($name -eq '业务蓝图.json') { Copy-Item -LiteralPath $generated['blueprint.json'] -Destination $path }
        elseif ($name -eq '领域版本锁.json') { Copy-Item -LiteralPath $generated['domain-lock.json'] -Destination $path }
        else { [IO.File]::WriteAllText($path, ('artifact:' + $name), [Text.UTF8Encoding]::new($false)) }
        $artifacts.Add((Get-Item -LiteralPath $path))
    }
    $installer = @($artifacts | Where-Object Name -Like '*安装包.exe')[0]
    $blueprint = @($artifacts | Where-Object Name -EQ '业务蓝图.json')[0]
    $domainLock = @($artifacts | Where-Object Name -EQ '领域版本锁.json')[0]
    $acceptance = @($artifacts | Where-Object Name -EQ '验收报告.json')[0]
    $executableHash = '1' * 64; $resourceHash = Get-TestHash $generated['resource-manifest.json']; $sourceHash = $sourceManifest.sha256
    $materialDefinitions = @(
        [pscustomobject]@{ id='introduction'; docx='introduction.docx'; artifactDocx="$($context.SoftwareName)-软件介绍.docx"; pdf=$null; artifactPdf=$null; pages=4; characters=1800; tables=0; mediaCount=0 },
        [pscustomobject]@{ id='feature-table'; docx='feature-table.docx'; artifactDocx="$($context.SoftwareName)-功能表.docx"; pdf=$null; artifactPdf=$null; pages=8; characters=3200; tables=8; mediaCount=0 },
        [pscustomobject]@{ id='manual'; docx='manual.docx'; artifactDocx="$($context.SoftwareName)-操作手册.docx"; pdf='manual.pdf'; artifactPdf="$($context.SoftwareName)-操作手册.pdf"; pages=20; characters=5000; tables=2; mediaCount=12 },
        [pscustomobject]@{ id='database-design'; docx='database-design.docx'; artifactDocx="$($context.SoftwareName)-数据库设计.docx"; pdf=$null; artifactPdf=$null; pages=16; characters=4500; tables=12; mediaCount=1 },
        [pscustomobject]@{ id='runtime'; docx='runtime.docx'; artifactDocx="$($context.SoftwareName)-运行环境.docx"; pdf=$null; artifactPdf=$null; pages=4; characters=1200; tables=2; mediaCount=0 },
        [pscustomobject]@{ id='prototype'; docx='prototype.docx'; artifactDocx="$($context.SoftwareName)-原型设计图.docx"; pdf=$null; artifactPdf=$null; pages=8; characters=1200; tables=1; mediaCount=5 },
        [pscustomobject]@{ id='application-info'; docx='application-info.docx'; artifactDocx="$($context.SoftwareName)-申请表.docx"; pdf='application-info.pdf'; artifactPdf="$($context.SoftwareName)-申请表.pdf"; pages=2; characters=900; tables=3; mediaCount=0 },
        [pscustomobject]@{ id='source'; docx='source.docx'; artifactDocx="$($context.SoftwareName)-源码.docx"; pdf='source.pdf'; artifactPdf="$($context.SoftwareName)-源码.pdf"; pages=60; characters=30000; tables=0; mediaCount=0 }
    )
    $materialDocuments = @($materialDefinitions | ForEach-Object {
        $definition = $_
        $docxArtifact = @($artifacts | Where-Object Name -CEQ $definition.artifactDocx)[0]
        $pdfReceipt = if ($null -eq $definition.pdf) { $null } else {
            $pdfArtifact = @($artifacts | Where-Object Name -CEQ $definition.artifactPdf)[0]
            [pscustomobject]@{ fileName=$definition.pdf; sha256=(Get-TestHash $pdfArtifact.FullName); pages=$definition.pages; nonblank=$true }
        }
        $mediaHashes = if ($definition.mediaCount -eq 0) { @() } else { @(1..$definition.mediaCount | ForEach-Object { '{0:x64}' -f $_ }) }
        [pscustomobject]@{ id=$definition.id; fileName=$definition.docx; sha256=(Get-TestHash $docxArtifact.FullName); pages=$definition.pages; characters=$definition.characters; paragraphs=100; tables=$definition.tables; mediaCount=$definition.mediaCount; mediaSha256=$mediaHashes; pdf=$pdfReceipt }
    })
    $receipts = [pscustomobject]@{
        Installer=[pscustomobject]@{ status='passed'; executableSha256=$executableHash; resourceManifestSha256=$resourceHash; installerSha256=(Get-TestHash $installer.FullName) }
        Package=[pscustomobject]@{ status='passed'; executableSha256=$executableHash; resourceManifestSha256=$resourceHash; blueprintSha256=(Get-TestHash $blueprint.FullName); domainLockSha256=(Get-TestHash $domainLock.FullName) }
        E2E=[pscustomobject]@{ status='passed'; executableSha256=$executableHash; resourceManifestSha256=$resourceHash }
        Materials=[pscustomobject]@{ receiptVersion='1.0'; status='passed'; factsSha256=$factsHash; executableSha256=$executableHash; resourceManifestSha256=$resourceHash; blueprintSha256=(Get-TestHash $blueprint.FullName); sourceManifestSha256=$sourceHash; sourceSelectionSha256=$sourcePlan.selectionSha256; screenshotManifestSha256=$screenshotManifestHash; screenshotSha256=$screenshotDigest; documents=$materialDocuments }
        SourceArchive=[pscustomobject]@{ status='passed'; sha256=(Get-TestHash $sourceArchive.FullName) }
    }
    [IO.File]::WriteAllText($acceptance.FullName, ($receipts.E2E | ConvertTo-Json), [Text.UTF8Encoding]::new($false))

    $evidenceParameters = @{ Receipts=$receipts; SourceManifest=$sourceManifest; MaterialFactsPath=$materialFactsPath; SourcePlan=$sourcePlan; ScreenshotManifestPath=$screenshotManifestPath; ScreenshotRoot=$screenshotRoot }
    $sourceArchiveBytes = [IO.File]::ReadAllBytes($sourceArchive.FullName)
    Set-TestZipEntryText $sourceArchive.FullName 'generated/project.lock.json' '{"changed":true}'
    Assert-Throws { New-StandardDeliveryStaging -Context $context -Artifacts $artifacts.ToArray() @evidenceParameters } 'source archive'
    [IO.File]::WriteAllBytes($sourceArchive.FullName,$sourceArchiveBytes)
    $staging = New-StandardDeliveryStaging -Context $context -Artifacts $artifacts.ToArray() @evidenceParameters
    $staged = @(Get-ChildItem -LiteralPath $staging -Force)
    Assert-Equal $staged.Count 18
    Assert-Equal @($staged | Where-Object PSIsContainer).Count 0
    Assert-Equal (($staged.Name | Sort-Object) -join '|') (($expected | Sort-Object) -join '|')
    $complete = Join-Path $staging "$($context.SoftwareName)-完整交付包.zip"
    $completeNames = @(Get-TestZipNames $complete)
    Assert-Equal $completeNames.Count 17
    Assert-Equal ($completeNames -contains "$($context.SoftwareName)-完整交付包.zip") $false
    $report = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $staging '校验报告.txt')
    Assert-Match $report $executableHash
    Assert-Match $report $resourceHash
    Assert-Match $report $sourceHash
    Assert-Match $report '软件介绍：页数 4；字符 1800；表格 0；图片 0'
    Assert-Match $report '操作手册：页数 20；字符 5000；表格 2；图片 12'
    Assert-Match $report '原型设计图：页数 8；字符 1200；表格 1；图片 5'
    Assert-Equal ($report -match '材料验证均已通过') $false
    Assert-Equal ($report -match 'ghp_|password|token|[A-Z]:\\') $false

    $stagedSourceArchive = Join-Path $staging "$($context.SoftwareName)-项目源码.zip"
    Set-TestZipEntryText $stagedSourceArchive '重建说明.txt' 'changed rebuild instructions'
    Assert-Throws { Publish-StandardDelivery -Context $context -StagingPath $staging @evidenceParameters } 'source archive'
    [IO.File]::WriteAllBytes($stagedSourceArchive,$sourceArchiveBytes)
    $requiredPath = Join-Path $staging "$($context.SoftwareName)-软件介绍.docx"
    $requiredBackup = [IO.File]::ReadAllBytes($requiredPath)
    Remove-Item -LiteralPath $requiredPath -Force
    Assert-Throws { Publish-StandardDelivery -Context $context -StagingPath $staging @evidenceParameters } 'contract'
    [IO.File]::WriteAllBytes($requiredPath,$requiredBackup)
    $unexpectedStaged = Join-Path $staging 'unexpected.txt'; [IO.File]::WriteAllText($unexpectedStaged,'unexpected')
    Assert-Throws { Publish-StandardDelivery -Context $context -StagingPath $staging @evidenceParameters } 'contract'
    Remove-Item -LiteralPath $unexpectedStaged -Force
    [IO.File]::WriteAllText($requiredPath,'changed',[Text.UTF8Encoding]::new($false))
    Assert-Throws { Publish-StandardDelivery -Context $context -StagingPath $staging @evidenceParameters } 'hash'
    [IO.File]::WriteAllBytes($requiredPath,$requiredBackup)
    Assert-Throws {
        Publish-StandardDelivery -Context $context -StagingPath $staging @evidenceParameters -CopyFileAction {
            param($Source,$Destination,$Index)
            if($Index-eq2){throw 'injected-copy-failure'}
            Copy-Item -LiteralPath $Source -Destination $Destination
        }
    } 'injected-copy-failure'
    Assert-Equal (Test-Path -LiteralPath $context.RequestedDeliveryPath) $false
    Assert-Equal @(Get-ChildItem -LiteralPath (Split-Path -Parent $context.RequestedDeliveryPath) -Directory -Filter '.standard-delivery.staging-*').Count 0

    $published = Publish-StandardDelivery -Context $context -StagingPath $staging @evidenceParameters
    Assert-Equal $published $context.RequestedDeliveryPath
    Assert-Equal (Test-Path -LiteralPath $published -PathType Container) $true

    $badReceipts = $receipts | ConvertTo-Json -Depth 8 | ConvertFrom-Json
    $badReceipts.E2E.executableSha256 = '9' * 64
    $badEvidenceParameters = $evidenceParameters.Clone(); $badEvidenceParameters.Receipts = $badReceipts
    Assert-Throws { New-StandardDeliveryStaging -Context $context -Artifacts $artifacts.ToArray() @badEvidenceParameters } 'hash'

    $missingArtifacts = @($artifacts | Where-Object Name -CNE "$($context.SoftwareName)-软件介绍.docx")
    Assert-Throws { New-StandardDeliveryStaging -Context $context -Artifacts $missingArtifacts @evidenceParameters } 'names'
    $extraPath = Join-Path $artifactRoot '额外材料.txt'
    [IO.File]::WriteAllText($extraPath, 'extra', [Text.UTF8Encoding]::new($false))
    Assert-Throws { New-StandardDeliveryStaging -Context $context -Artifacts (@($artifacts.ToArray()) + (Get-Item $extraPath)) @evidenceParameters } 'names'
    Assert-Throws { New-StandardDeliveryStaging -Context $context -Artifacts (@($artifacts.ToArray()) + $artifacts[0]) @evidenceParameters } 'names'
    $oldFifteen = @($artifacts | Where-Object Name -NotIn @("$($context.SoftwareName)-软件介绍.docx","$($context.SoftwareName)-功能表.docx","$($context.SoftwareName)-数据库设计.docx"))
    Assert-Equal $oldFifteen.Count 13
    Assert-Throws { New-StandardDeliveryStaging -Context $context -Artifacts $oldFifteen @evidenceParameters } 'names'

    $junctionTarget = Join-Path $root 'junction-target'
    $junctionPath = Join-Path $artifactRoot 'junction'
    New-Item -ItemType Directory -Path $junctionTarget | Out-Null
    $introduction = @($artifacts | Where-Object Name -CEQ "$($context.SoftwareName)-软件介绍.docx")[0]
    Copy-Item -LiteralPath $introduction.FullName -Destination (Join-Path $junctionTarget $introduction.Name)
    New-Item -ItemType Junction -Path $junctionPath -Target $junctionTarget | Out-Null
    $reparseArtifacts = @($artifacts | Where-Object Name -CNE $introduction.Name) + (Get-Item -LiteralPath (Join-Path $junctionPath $introduction.Name))
    Assert-Throws { New-StandardDeliveryStaging -Context $context -Artifacts $reparseArtifacts @evidenceParameters } 'reparse'

    $staleMaterials = $receipts | ConvertTo-Json -Depth 12 | ConvertFrom-Json
    $staleMaterials.Materials.documents[0].sha256 = '9' * 64
    $staleEvidenceParameters = $evidenceParameters.Clone(); $staleEvidenceParameters.Receipts = $staleMaterials
    Assert-Throws { New-StandardDeliveryStaging -Context $context -Artifacts $artifacts.ToArray() @staleEvidenceParameters } 'material'

    $factsBytes = [IO.File]::ReadAllBytes($materialFactsPath)
    $changedFacts = Get-Content -Raw -Encoding UTF8 -LiteralPath $materialFactsPath | ConvertFrom-Json
    $changedFacts.factVersion = '9.9'
    [IO.File]::WriteAllText($materialFactsPath,($changedFacts|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
    Assert-Throws { New-StandardDeliveryStaging -Context $context -Artifacts $artifacts.ToArray() @evidenceParameters } 'facts hash'
    [IO.File]::WriteAllBytes($materialFactsPath,$factsBytes)

    $screenshotBytes = [IO.File]::ReadAllBytes($screenshotManifestPath)
    $changedManifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $screenshotManifestPath | ConvertFrom-Json
    $changedManifest.captures[0].imageSha256 = '9' * 64
    [IO.File]::WriteAllText($screenshotManifestPath,($changedManifest|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
    Assert-Throws { New-StandardDeliveryStaging -Context $context -Artifacts $artifacts.ToArray() @evidenceParameters } 'manifest hash'
    [IO.File]::WriteAllBytes($screenshotManifestPath,$screenshotBytes)

    $changedImage = Join-Path $screenshotRoot $captures[0].fileName
    $imageBytes = [IO.File]::ReadAllBytes($changedImage)
    [IO.File]::WriteAllText($changedImage,'changed-image',[Text.UTF8Encoding]::new($false))
    Assert-Throws { New-StandardDeliveryStaging -Context $context -Artifacts $artifacts.ToArray() @evidenceParameters } 'image hash'
    [IO.File]::WriteAllBytes($changedImage,$imageBytes)

    $changedPlan = $sourcePlan | ConvertTo-Json | ConvertFrom-Json
    $changedPlan.selectionSha256 = '9' * 64
    $changedPlanParameters = $evidenceParameters.Clone(); $changedPlanParameters.SourcePlan = $changedPlan
    Assert-Throws { New-StandardDeliveryStaging -Context $context -Artifacts $artifacts.ToArray() @changedPlanParameters } 'selection hash'

    $repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
    if ([IO.Path]::GetPathRoot($repositoryRoot) -cne [IO.Path]::GetPathRoot($root)) {
        $crossDeliveryRoot = Join-Path $repositoryRoot ('.standard-publisher-cross-volume-' + [guid]::NewGuid().ToString('N'))
        $crossContext = [pscustomobject]@{ WorkspacePath=$workspace; SoftwareName=$context.SoftwareName; Version=$context.Version; RunId='run-cross-volume'; RequestedDeliveryPath=(Join-Path $crossDeliveryRoot $context.SoftwareName) }
        $crossStaging = New-StandardDeliveryStaging -Context $crossContext -Artifacts $artifacts.ToArray() @evidenceParameters
        $crossPublished = Publish-StandardDelivery -Context $crossContext -StagingPath $crossStaging @evidenceParameters
        Assert-Equal $crossPublished $crossContext.RequestedDeliveryPath
        Assert-Equal (Test-Path -LiteralPath $crossPublished -PathType Container) $true
        Assert-Equal @(Get-ChildItem -LiteralPath $crossDeliveryRoot -Directory -Filter '.standard-delivery.staging-*').Count 0
    }
}
finally {
    if ($null -ne $crossDeliveryRoot -and (Test-Path -LiteralPath $crossDeliveryRoot)) { Remove-Item -LiteralPath $crossDeliveryRoot -Recurse -Force }
    if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}
