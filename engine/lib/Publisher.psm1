Set-StrictMode -Version Latest

Import-Module (Join-Path $PSScriptRoot 'Generator.Core.psm1') -Force -DisableNameChecking
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Assert-RegularPublishFile {
    param(
        [Parameter(Mandatory)][string]$Root,
        [Parameter(Mandatory)][string]$Path
    )

    $safePath = Assert-SafeChildPath -Root $Root -Candidate $Path
    if (-not (Test-Path -LiteralPath $safePath -PathType Leaf)) { throw "发布文件不存在：$safePath" }
    $item = Get-Item -LiteralPath $safePath -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "发布文件不能是重解析点：$safePath"
    }
    return $item
}

function Add-ZipFile {
    param(
        [Parameter(Mandatory)][IO.Compression.ZipArchive]$Archive,
        [Parameter(Mandatory)][IO.FileInfo]$File,
        [Parameter(Mandatory)][string]$EntryName
    )

    $normalizedName = $EntryName.Replace('\', '/')
    $entry = $Archive.CreateEntry($normalizedName, [IO.Compression.CompressionLevel]::Optimal)
    $input = $File.OpenRead()
    $output = $entry.Open()
    try { $input.CopyTo($output) }
    finally { $output.Dispose(); $input.Dispose() }
}

function Assert-ReadableZip {
    param([Parameter(Mandatory)][string]$Path)

    $archive = [IO.Compression.ZipFile]::OpenRead($Path)
    try {
        foreach ($entry in $archive.Entries) {
            if ($entry.FullName.Contains('\')) { throw "ZIP 条目必须使用正斜杠：$($entry.FullName)" }
            $stream = $entry.Open()
            try {
                $buffer = New-Object byte[] 8192
                while ($stream.Read($buffer, 0, $buffer.Length) -gt 0) { }
            }
            finally { $stream.Dispose() }
        }
    }
    finally { $archive.Dispose() }
}

function Get-ExpectedArtifactNames {
    param([Parameter(Mandatory)][pscustomobject]$Context)

    $name = [string]$Context.SoftwareName
    $version = [string]$Context.Version
    return @(
        "$name V$version 安装包.exe",
        "$name-操作手册.docx",
        "$name-操作手册.pdf",
        "$name-源码.docx",
        "$name-源码.pdf",
        "$name-申请表.docx",
        "$name-申请表.pdf",
        "$name-运行环境.docx",
        "$name-原型设计图.docx",
        "$name-项目源码.zip"
    )
}

function New-SourceArchive {
    param([Parameter(Mandatory)][pscustomobject]$Context)

    $workspace = [IO.Path]::GetFullPath($Context.WorkspacePath)
    if (-not (Test-Path -LiteralPath $workspace -PathType Container)) { throw "源码工作区不存在：$workspace" }
    $archivePath = Assert-SafeChildPath -Root $workspace -Candidate (Join-Path $workspace ($Context.SoftwareName + '-项目源码.zip'))
    if (Test-Path -LiteralPath $archivePath) { throw "拒绝覆盖源码 ZIP：$archivePath" }

    $projectFile = Assert-RegularPublishFile -Root $workspace -Path (Join-Path $workspace 'project.json')
    $appRoot = Assert-SafeChildPath -Root $workspace -Candidate (Join-Path $workspace 'app')
    if (-not (Test-Path -LiteralPath $appRoot -PathType Container)) { throw "应用源码目录不存在：$appRoot" }
    $appItems = @(Get-ChildItem -LiteralPath $appRoot -Recurse -Force)
    foreach ($item in $appItems) {
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "源码目录不能包含重解析点：$($item.FullName)"
        }
    }
    $appFiles = @($appItems | Where-Object { -not $_.PSIsContainer } | Sort-Object FullName)
    if ($appFiles.Count -eq 0) { throw '应用源码目录为空。' }

    try {
        $archive = [IO.Compression.ZipFile]::Open($archivePath, [IO.Compression.ZipArchiveMode]::Create)
        try {
            Add-ZipFile -Archive $archive -File $projectFile -EntryName 'project.json'
            $prefix = $appRoot.TrimEnd('\') + '\'
            foreach ($file in $appFiles) {
                $safeFile = Assert-RegularPublishFile -Root $workspace -Path $file.FullName
                Add-ZipFile -Archive $archive -File $safeFile -EntryName ('app/' + $safeFile.FullName.Substring($prefix.Length).Replace('\', '/'))
            }
            $instruction = $archive.CreateEntry('重建说明.txt', [IO.Compression.CompressionLevel]::Optimal)
            $writer = [IO.StreamWriter]::new($instruction.Open(), [Text.UTF8Encoding]::new($true))
            try {
                $writer.WriteLine('本压缩包包含 project.json、离线应用源码和测试。')
                $writer.WriteLine('将 app 目录与 project.json 保持原有相对位置即可检查和修改源码。')
            }
            finally { $writer.Dispose() }
        }
        finally { $archive.Dispose() }
        Assert-ReadableZip -Path $archivePath
        return Get-Item -LiteralPath $archivePath
    }
    catch {
        if (Test-Path -LiteralPath $archivePath) { Remove-Item -LiteralPath $archivePath -Force }
        throw
    }
}

function New-DeliveryStaging {
    param(
        [Parameter(Mandatory)][pscustomobject]$Context,
        [Parameter(Mandatory)][IO.FileInfo[]]$Artifacts
    )

    $workspace = [IO.Path]::GetFullPath($Context.WorkspacePath)
    $staging = Assert-SafeChildPath -Root $workspace -Candidate (Join-Path $workspace 'publish-staging')
    if (Test-Path -LiteralPath $staging) { throw "发布暂存目录已存在：$staging" }
    $expected = @(Get-ExpectedArtifactNames -Context $Context)
    $actualNames = @($Artifacts | ForEach-Object Name)
    $missing = @($expected | Where-Object { $actualNames -cnotcontains $_ })
    $unexpected = @($actualNames | Where-Object { $expected -cnotcontains $_ })
    $duplicates = @($actualNames | Group-Object | Where-Object Count -ne 1 | ForEach-Object Name)
    if ($missing.Count -gt 0) { throw "缺少交付文件：$($missing -join '、')" }
    if ($unexpected.Count -gt 0) { throw "存在非约定交付文件：$($unexpected -join '、')" }
    if ($duplicates.Count -gt 0) { throw "交付文件名重复：$($duplicates -join '、')" }

    try {
        New-Item -ItemType Directory -Path $staging | Out-Null
        foreach ($expectedName in $expected) {
            $artifact = @($Artifacts | Where-Object Name -CEQ $expectedName)[0]
            if (-not (Test-Path -LiteralPath $artifact.FullName -PathType Leaf)) { throw "交付文件不存在：$($artifact.FullName)" }
            if (($artifact.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "交付文件不能是重解析点：$($artifact.FullName)" }
            Copy-Item -LiteralPath $artifact.FullName -Destination (Join-Path $staging $expectedName)
        }

        $reportPath = Join-Path $staging '校验报告.txt'
        $report = @(
            "软件名称：$($Context.SoftwareName)",
            "版本：V$($Context.Version)",
            "运行编号：$($Context.RunId)",
            '结果：源码、材料、安装包及安装卸载验证均已通过。'
        ) -join "`r`n"
        [IO.File]::WriteAllText($reportPath, $report, [Text.UTF8Encoding]::new($true))

        $completeName = $Context.SoftwareName + '-完整交付包.zip'
        $completePath = Join-Path $staging $completeName
        $zip = [IO.Compression.ZipFile]::Open($completePath, [IO.Compression.ZipArchiveMode]::Create)
        try {
            foreach ($file in Get-ChildItem -LiteralPath $staging -File | Where-Object Name -CNE $completeName | Sort-Object Name) {
                Add-ZipFile -Archive $zip -File $file -EntryName $file.Name
            }
        }
        finally { $zip.Dispose() }
        Assert-ReadableZip -Path $completePath

        $finalItems = @(Get-ChildItem -LiteralPath $staging -Force)
        if ($finalItems.Count -ne 12 -or @($finalItems | Where-Object PSIsContainer).Count -ne 0) {
            throw '交付暂存目录不是严格平铺的十二个文件。'
        }
        return $staging
    }
    catch {
        if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
        throw
    }
}

function Publish-Delivery {
    param(
        [Parameter(Mandatory)][pscustomobject]$Context,
        [Parameter(Mandatory)][string]$StagingPath
    )

    $workspace = [IO.Path]::GetFullPath($Context.WorkspacePath)
    $staging = Assert-SafeChildPath -Root $workspace -Candidate $StagingPath
    if (-not (Test-Path -LiteralPath $staging -PathType Container)) { throw "发布暂存目录不存在：$staging" }
    foreach ($item in Get-ChildItem -LiteralPath $staging -Force) {
        if ($item.PSIsContainer) { throw "发布暂存目录必须为平铺文件：$($item.Name)" }
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "发布文件不能是重解析点：$($item.Name)" }
    }
    $requested = [IO.Path]::GetFullPath($Context.RequestedDeliveryPath)
    $deliveryRoot = Split-Path -Parent $requested
    [void](Assert-SafeChildPath -Root $deliveryRoot -Candidate $requested)
    New-Item -ItemType Directory -Path $deliveryRoot -Force | Out-Null

    $target = $requested
    if (Test-Path -LiteralPath $target) {
        $suffix = Get-Date -Format 'yyyyMMdd-HHmmss'
        $target = "$requested-$suffix"
        $counter = 2
        while (Test-Path -LiteralPath $target) {
            $target = "$requested-$suffix-$counter"
            $counter++
        }
    }
    [void](Assert-SafeChildPath -Root $deliveryRoot -Candidate $target)
    Move-Item -LiteralPath $staging -Destination $target
    return $target
}

Export-ModuleMember -Function New-SourceArchive, New-DeliveryStaging, Publish-Delivery
