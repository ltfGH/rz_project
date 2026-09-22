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

function Assert-StandardRegularFile {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Required delivery file was not found: $Path" }
    $item = Get-Item -LiteralPath $Path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Delivery file must not be a reparse point: $($item.Name)" }
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

function Get-ExpectedStandardArtifactNames {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Context)
    $name = [string]$Context.SoftwareName; $version = [string]$Context.Version
    if ([string]::IsNullOrWhiteSpace($name) -or [string]::IsNullOrWhiteSpace($version)) { throw 'Software name and version are required.' }
    return @(
        "$name V$version 安装包.exe",
        "$name-操作手册.docx", "$name-操作手册.pdf",
        "$name-源码.docx", "$name-源码.pdf",
        "$name-申请表.docx", "$name-申请表.pdf",
        "$name-运行环境.docx", "$name-原型设计图.docx",
        "$name-项目源码.zip",
        '业务蓝图.json', '领域版本锁.json', '验收报告.json', '校验报告.txt',
        "$name-完整交付包.zip"
    )
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

function Assert-ReceiptHashSet {
    param([Parameter(Mandatory)]$Receipts, [Parameter(Mandatory)]$SourceManifest, [Parameter(Mandatory)][IO.FileInfo[]]$Artifacts)
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
    return [pscustomobject]@{ executable=$executableHashes[0]; resource=$resourceHashes[0]; source=[string]$SourceManifest.sha256 }
}

function New-StandardDeliveryStaging {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Context, [Parameter(Mandatory)][IO.FileInfo[]]$Artifacts, [Parameter(Mandatory)]$Receipts, [Parameter(Mandatory)]$SourceManifest)
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
    $hashes = Assert-ReceiptHashSet -Receipts $Receipts -SourceManifest $SourceManifest -Artifacts $Artifacts
    try {
        New-Item -ItemType Directory -Path $staging | Out-Null
        foreach ($name in $providedExpected) {
            $artifact = @($Artifacts | Where-Object Name -CEQ $name)[0]
            Copy-Item -LiteralPath $artifact.FullName -Destination (Join-Path $staging $name)
        }
        $report = @(
            "软件名称：$($Context.SoftwareName)", "版本：V$($Context.Version)", "运行编号：$($Context.RunId)",
            '结果：安装包、桌面程序、资源、领域测试、打包态登录、持久化、截图和材料验证均已通过。',
            "程序 SHA-256：$($hashes.executable)", "资源清单 SHA-256：$($hashes.resource)", "源码清单 SHA-256：$($hashes.source)"
        ) -join "`r`n"
        if ($report -match '(?i)gh[pousr]_|github_pat_|password|token|[A-Z]:\\') { throw 'Validation report contains forbidden content.' }
        [IO.File]::WriteAllText((Join-Path $staging '校验报告.txt'), $report, [Text.UTF8Encoding]::new($true))
        $completePath = Join-Path $staging $completeName
        $archive = [IO.Compression.ZipFile]::Open($completePath, [IO.Compression.ZipArchiveMode]::Create)
        try {
            foreach ($file in Get-ChildItem -LiteralPath $staging -File | Where-Object Name -CNE $completeName | Sort-Object Name) { Add-StandardZipEntry -Archive $archive -File $file -Name $file.Name }
        } finally { $archive.Dispose() }
        Assert-StandardZipReadable -Path $completePath
        $items = @(Get-ChildItem -LiteralPath $staging -Force)
        if ($items.Count -ne $expected.Count -or @($items | Where-Object PSIsContainer).Count -ne 0) { throw 'Standard delivery staging must contain exactly fifteen flat files.' }
        return $staging
    }
    catch {
        if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
        throw
    }
}

function Publish-StandardDelivery {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Context, [Parameter(Mandatory)][string]$StagingPath)
    return Publish-Delivery -Context $Context -StagingPath $StagingPath
}

Export-ModuleMember -Function Get-ExpectedStandardArtifactNames, New-StandardSourceArchive, New-StandardDeliveryStaging, Publish-StandardDelivery
