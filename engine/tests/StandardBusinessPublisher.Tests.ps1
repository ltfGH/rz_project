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

$root = Join-Path $env:TEMP ('standard-publisher-test-' + [guid]::NewGuid().ToString('N'))
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
    Assert-Equal $expected.Count 15
    $providedNames = @($expected | Where-Object { $_ -notin @('校验报告.txt', "$($context.SoftwareName)-完整交付包.zip") })
    $artifacts = [Collections.Generic.List[IO.FileInfo]]::new()
    foreach ($name in $providedNames) {
        if ($name -eq "$($context.SoftwareName)-项目源码.zip") { $artifacts.Add($sourceArchive); continue }
        $path = Join-Path $artifactRoot $name
        [IO.File]::WriteAllText($path, ('artifact:' + $name), [Text.UTF8Encoding]::new($false))
        $artifacts.Add((Get-Item -LiteralPath $path))
    }
    $installer = @($artifacts | Where-Object Name -Like '*安装包.exe')[0]
    $blueprint = @($artifacts | Where-Object Name -EQ '业务蓝图.json')[0]
    $domainLock = @($artifacts | Where-Object Name -EQ '领域版本锁.json')[0]
    $acceptance = @($artifacts | Where-Object Name -EQ '验收报告.json')[0]
    $executableHash = '1' * 64; $resourceHash = '2' * 64; $sourceHash = $sourceManifest.sha256
    $receipts = [pscustomobject]@{
        Installer=[pscustomobject]@{ status='passed'; executableSha256=$executableHash; resourceManifestSha256=$resourceHash; installerSha256=(Get-TestHash $installer.FullName) }
        Package=[pscustomobject]@{ status='passed'; executableSha256=$executableHash; resourceManifestSha256=$resourceHash; blueprintSha256=(Get-TestHash $blueprint.FullName); domainLockSha256=(Get-TestHash $domainLock.FullName) }
        E2E=[pscustomobject]@{ status='passed'; executableSha256=$executableHash; resourceManifestSha256=$resourceHash }
        Materials=[pscustomobject]@{ status='passed'; executableSha256=$executableHash; resourceManifestSha256=$resourceHash; sourceManifestSha256=$sourceHash }
    }
    [IO.File]::WriteAllText($acceptance.FullName, ($receipts.E2E | ConvertTo-Json), [Text.UTF8Encoding]::new($false))

    $staging = New-StandardDeliveryStaging -Context $context -Artifacts $artifacts.ToArray() -Receipts $receipts -SourceManifest $sourceManifest
    $staged = @(Get-ChildItem -LiteralPath $staging -Force)
    Assert-Equal $staged.Count 15
    Assert-Equal @($staged | Where-Object PSIsContainer).Count 0
    Assert-Equal (($staged.Name | Sort-Object) -join '|') (($expected | Sort-Object) -join '|')
    $complete = Join-Path $staging "$($context.SoftwareName)-完整交付包.zip"
    $completeNames = @(Get-TestZipNames $complete)
    Assert-Equal $completeNames.Count 14
    Assert-Equal ($completeNames -contains "$($context.SoftwareName)-完整交付包.zip") $false
    $report = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $staging '校验报告.txt')
    Assert-Match $report $executableHash
    Assert-Match $report $resourceHash
    Assert-Match $report $sourceHash
    Assert-Equal ($report -match 'ghp_|password|token|[A-Z]:\\') $false

    $published = Publish-StandardDelivery -Context $context -StagingPath $staging
    Assert-Equal $published $context.RequestedDeliveryPath
    Assert-Equal (Test-Path -LiteralPath $published -PathType Container) $true

    $badReceipts = $receipts | ConvertTo-Json -Depth 8 | ConvertFrom-Json
    $badReceipts.E2E.executableSha256 = '9' * 64
    Assert-Throws { New-StandardDeliveryStaging -Context $context -Artifacts $artifacts.ToArray() -Receipts $badReceipts -SourceManifest $sourceManifest } 'hash'
}
finally {
    if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}
