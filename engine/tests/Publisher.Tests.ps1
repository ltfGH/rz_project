. "$PSScriptRoot\Assert.ps1"
$ErrorActionPreference = 'Stop'

$modulePath = Join-Path $PSScriptRoot '..\lib\Publisher.psm1'
$testRoot = Join-Path $env:TEMP ('publisher-test-' + [Guid]::NewGuid().ToString('N'))
$softwareName = '设备点检记录管理软件'
$workspace = Join-Path $testRoot 'engine\工作区\run-1'
$deliveryRoot = Join-Path $testRoot '交付结果'
$requestedDelivery = Join-Path $deliveryRoot $softwareName

function Get-ZipEntryNames {
    param([Parameter(Mandatory)][string]$Path)
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($Path)
    try {
        foreach ($entry in $archive.Entries) {
            $stream = $entry.Open()
            try { [void]$stream.ReadByte() } finally { $stream.Dispose() }
            $entry.FullName
        }
    }
    finally { $archive.Dispose() }
}

try {
    New-Item -ItemType Directory -Path (Join-Path $workspace 'app\assets') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $workspace 'app\js') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $workspace 'app\tests') -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $workspace 'project.json'), '{"softwareName":"设备点检记录管理软件","version":"1.0"}', [Text.UTF8Encoding]::new($false))
    foreach ($relative in @('app\index.html', 'app\assets\styles.css', 'app\js\app.js', 'app\tests\app.test.js')) {
        [IO.File]::WriteAllText((Join-Path $workspace $relative), $relative, [Text.UTF8Encoding]::new($false))
    }
    New-Item -ItemType Directory -Path (Join-Path $workspace 'temp') -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $workspace 'temp\secret.txt'), 'must not ship')

    $context = [pscustomobject]@{
        WorkspacePath = $workspace
        SoftwareName = $softwareName
        Version = '1.0'
        RequestedDeliveryPath = $requestedDelivery
        RunId = 'run-1'
    }

    Import-Module $modulePath -Force -DisableNameChecking
    Assert-Equal (Get-Command New-SourceArchive).CommandType 'Function'
    Assert-Equal (Get-Command New-DeliveryStaging).CommandType 'Function'
    Assert-Equal (Get-Command Publish-Delivery).CommandType 'Function'

    $sourceArchive = New-SourceArchive -Context $context
    Assert-Equal $sourceArchive.GetType().FullName 'System.IO.FileInfo'
    $sourceEntries = @(Get-ZipEntryNames -Path $sourceArchive.FullName | Sort-Object)
    Assert-Equal ($sourceEntries -join '|') ((@(
        'app/assets/styles.css',
        'app/index.html',
        'app/js/app.js',
        'app/tests/app.test.js',
        'project.json',
        '重建说明.txt'
    ) | Sort-Object) -join '|')
    Assert-Equal (($sourceEntries -join '|') -match 'secret|temp') $false

    $artifactRoot = Join-Path $workspace 'test-artifacts'
    New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null
    $artifactNames = @(
        "$softwareName V1.0 安装包.exe",
        "$softwareName-操作手册.docx",
        "$softwareName-操作手册.pdf",
        "$softwareName-源码.docx",
        "$softwareName-源码.pdf",
        "$softwareName-申请表.docx",
        "$softwareName-申请表.pdf",
        "$softwareName-运行环境.docx",
        "$softwareName-原型设计图.docx"
    )
    $artifacts = @($artifactNames | ForEach-Object {
        $path = Join-Path $artifactRoot $_
        [IO.File]::WriteAllText($path, $_, [Text.UTF8Encoding]::new($false))
        Get-Item -LiteralPath $path
    }) + @($sourceArchive)

    $staging = New-DeliveryStaging -Context $context -Artifacts $artifacts
    $expectedNames = @($artifactNames + @(
        "$softwareName-项目源码.zip",
        "$softwareName-完整交付包.zip",
        '校验报告.txt'
    ) | Sort-Object)
    $stagedItems = @(Get-ChildItem -LiteralPath $staging -Force)
    Assert-Equal $stagedItems.Count 12
    Assert-Equal (@($stagedItems | Where-Object { $_.PSIsContainer }).Count) 0
    Assert-Equal ((@($stagedItems.Name | Sort-Object) -join '|')) ($expectedNames -join '|')

    $completeZip = Join-Path $staging "$softwareName-完整交付包.zip"
    $completeEntries = @(Get-ZipEntryNames -Path $completeZip | Sort-Object)
    Assert-Equal $completeEntries.Count 11
    Assert-Equal ($completeEntries -contains "$softwareName-完整交付包.zip") $false
    Assert-Equal (($completeEntries + "$softwareName-完整交付包.zip" | Sort-Object) -join '|') ($expectedNames -join '|')

    $published = Publish-Delivery -Context $context -StagingPath $staging
    Assert-Equal $published $requestedDelivery
    Assert-Equal (Test-Path -LiteralPath $published -PathType Container) $true
    Assert-Equal (Test-Path -LiteralPath $staging) $false

    $secondStaging = New-DeliveryStaging -Context $context -Artifacts $artifacts
    $secondPublished = Publish-Delivery -Context $context -StagingPath $secondStaging
    Assert-Equal $secondPublished.StartsWith($requestedDelivery + '-', [StringComparison]::OrdinalIgnoreCase) $true
    Assert-Equal (Test-Path -LiteralPath $published -PathType Container) $true

    $nestedStaging = Join-Path $workspace 'nested-publish-staging'
    New-Item -ItemType Directory -Path (Join-Path $nestedStaging 'unexpected-directory') -Force | Out-Null
    Assert-Throws { Publish-Delivery -Context $context -StagingPath $nestedStaging } '平铺文件'
    Assert-Equal (Test-Path -LiteralPath $nestedStaging -PathType Container) $true

    $failureContext = [pscustomobject]@{
        WorkspacePath = $workspace
        SoftwareName = $softwareName
        Version = '1.0'
        RequestedDeliveryPath = Join-Path $deliveryRoot '不得出现的软件'
        RunId = 'run-1'
    }
    Assert-Throws { New-DeliveryStaging -Context $failureContext -Artifacts @($artifacts | Select-Object -Skip 1) } '缺少交付文件'
    Assert-Equal (Test-Path -LiteralPath $failureContext.RequestedDeliveryPath) $false
    Assert-Equal (Test-Path -LiteralPath (Join-Path $workspace 'publish-staging')) $false
}
finally {
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}
