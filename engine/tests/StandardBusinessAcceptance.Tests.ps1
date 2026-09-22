[CmdletBinding()]
param([switch]$IncludeRepresentativeDelivery)

. "$PSScriptRoot\Assert.ps1"
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot '..\lib\StandardBusinessCatalog.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot '..\lib\StandardBusinessSource.psm1') -Force -DisableNameChecking

$engineRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$desktopRoot = Join-Path $engineRoot 'desktop-runtime'
$root = Join-Path $env:TEMP ('standard-acceptance-' + [guid]::NewGuid().ToString('N'))
$testDigests=[ordered]@{
    dispatcher='scrypt$16384$8$1$ZGlzcGF0Y2hlci1zYWx0MQ==$QXkC+g8WOmnKNAtrJeN3u/VUr1oSHxVcbaXJuF8AyuA5VAWwdgvxrpk7xuMHToK0TXjz/gCY7Gbozbov/epFfg=='
    operator='scrypt$16384$8$1$b3BlcmF0b3Itc2FsdC0wMQ==$RgRfB1/ZuasinXeYj+agQRjdSxLJLmyUs+4hc7obWE+s4CyE03Kb+Gnm3OQvRDqVL3yNzmc0nYC5MYFzetFgDw=='
    reviewer='scrypt$16384$8$1$cmV2aWV3ZXItc2FsdC0wMQ==$E0nzK8Ax/fc6WHYkcKcHp4gRu9IPx/mDI95Y4tcXF5UzqZNTg0bwyjezydD6AxKr/HXr7PjWPTpQ6GKfGiZ6tA=='
    administrator='scrypt$16384$8$1$YWRtaW4tc2FsdC0wMDAxMjM0NQ==$zkr0AzJ03NzoUsSpq5N8ZEtBMxwLhmSnKpSDvQr84EqcBJVDlkrJwQXr8LBN5cJ83EwNbwojZoA/47Bx8r1aLw=='
}
try {
    New-Item -ItemType Directory -Path $root | Out-Null
    $templates = @(Get-StandardBusinessTemplates)
    Assert-Equal $templates.Count 8
    foreach($template in $templates){
        $requestPath=Join-Path $root ($template.id+'.request.json');$output=Join-Path $root ($template.id+'-resources')
        $profile=[ordered]@{softwareName=($template.name+'软件');purpose=$template.workflowSummary;industry='离线业务管理';entityAliases=[ordered]@{};moduleAliases=[ordered]@{};seedVocabulary=[ordered]@{}}
        $request=[ordered]@{
            templateId=$template.id;appId=[guid]::NewGuid().ToString()
            software=[ordered]@{id=('acceptance_'+$template.id);name=$profile.softwareName;version='1.0.0';purpose=$profile.purpose;targetUsers=@($template.roles);boundaries=@('离线桌面运行');loginMode='required'}
            profile=$profile;passwordDigests=$testDigests
            seed=[ordered]@{value=20260921;businessRows=1000;baseline='2026-09-21T00:00:00.000Z'}
        }
        [IO.File]::WriteAllText($requestPath,($request|ConvertTo-Json -Depth 20),[Text.UTF8Encoding]::new($false))
        $toolOutput=(& node (Join-Path $desktopRoot 'tools\build-standard-resources.cjs') --request $requestPath --output $output 2>&1|Out-String)
        if($LASTEXITCODE-ne 0){throw "Resource acceptance failed for $($template.id): $($toolOutput.Trim())"}
        foreach($name in @('blueprint.json','seed.json','domain-lock.json','project.lock.json','resource-manifest.json','production-runtime-catalog.cjs')){Assert-Equal (Test-Path -LiteralPath (Join-Path $output $name)-PathType Leaf) $true}
        $blueprint=Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $output 'blueprint.json')|ConvertFrom-Json
        $seed=Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $output 'seed.json')|ConvertFrom-Json
        Assert-Equal (($blueprint.plugins.id|Sort-Object)-join ',') (($template.packs|Sort-Object)-join ',')
        Assert-Equal ([int](($seed.report.counts.PSObject.Properties.Value|Measure-Object -Sum).Sum)) 1000
        Assert-Equal (@($blueprint.modules.id|Where-Object {$_ -in @('records','operation','history')}).Count) 0
    }
    foreach($spec in @('reference-acceptance.spec.ts','inventory-application-acceptance.spec.ts','project-archive-acceptance.spec.ts')){Assert-Equal (Test-Path -LiteralPath (Join-Path $desktopRoot "tests\e2e\$spec")-PathType Leaf) $true}
    $sourceContract=Get-StandardSourceManifest -RepositoryRoot (Split-Path -Parent $engineRoot) -Template $templates[0] -OutputPath (Join-Path $root 'rebuild-source-manifest.json')
    foreach($requiredSource in @(
        'engine/desktop-runtime/package-lock.json','engine/desktop-runtime/vite.config.mts','engine/desktop-runtime/vite.preload.config.mts',
        'engine/desktop-runtime/tools/build-standard-resources.cjs','engine/desktop-runtime/tools/write-builder-config.cjs','engine/desktop-runtime/tools/build-standard-desktop.ps1',
        'engine/desktop-runtime/build/icon.svg','engine/domain-packs/package-lock.json','engine/domain-packs/package.json','engine/domain-packs/tsconfig.json'
    )){Assert-Equal ($sourceContract.files.path -contains $requiredSource) $true}

    if($IncludeRepresentativeDelivery){
        Import-Module (Join-Path $engineRoot 'lib\Generator.Core.psm1') -Force -DisableNameChecking
        Import-Module (Join-Path $engineRoot 'lib\StandardBusinessCredentials.psm1') -Force -DisableNameChecking
        Import-Module (Join-Path $engineRoot 'lib\StandardBusinessOrchestrator.psm1') -Force -DisableNameChecking
        Import-Module (Join-Path $engineRoot 'lib\Generator.Core.psm1') -Force -DisableNameChecking
        $passwords=@()
        $passwords+=([guid]::NewGuid().ToString('N')+'!Aa1');$passwords+=([guid]::NewGuid().ToString('N')+'!Bb2')
        $passwords+=([guid]::NewGuid().ToString('N')+'!Cc3');$passwords+=([guid]::NewGuid().ToString('N')+'!Dd4')
        $queue=[Collections.Generic.Queue[string]]::new();foreach($password in $passwords){$queue.Enqueue($password);$queue.Enqueue($password)}
        Assert-Equal $queue.Count 8
        $secureReader={param($role,$confirmation) ConvertTo-SecureString $queue.Dequeue() -AsPlainText -Force}.GetNewClosure()
        $bundle=Read-StandardBusinessCredentialBundle -SecureReader $secureReader
        try{
            $template=@($templates|Where-Object id -eq 'asset_inspection_rectification')[0]
            $context=New-GenerationContext -Theme '标准验收资产工单' -GeneratorRoot $root -Now (Get-Date);$context.Version='1.0.0'
            $overrides=@{BuildThemeProfile={param($state)
                $profile=[pscustomobject]@{softwareName='标准验收资产工单软件';purpose='管理资产报修与工单闭环';industry='企业运维';entityAliases=[pscustomobject]@{};moduleAliases=[pscustomobject]@{};seedVocabulary=[pscustomobject]@{}}
                $path=Join-Path $state.Context.WorkspacePath 'acceptance-profile.json';[IO.File]::WriteAllText($path,($profile|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false));[pscustomobject]@{Path=$path;Profile=$profile}
            }}
            $result=Invoke-StandardBusinessOrchestration -Context $context -Template $template -CredentialDigests $bundle.Digests -CredentialSecrets $bundle.Secrets -StageOverrides $overrides -KeepSuccessfulWorkspace
            Assert-Equal $result.ExitCode 0
            $delivery=@(Get-ChildItem -LiteralPath $result.DeliveryPath -File)
            Assert-Equal $delivery.Count 15
            Assert-Equal ($delivery.Name -contains '业务蓝图.json') $true
            Assert-Equal ($delivery.Name -contains '领域版本锁.json') $true
            Assert-Equal ($delivery.Name -contains '验收报告.json') $true
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            foreach($document in @($delivery|Where-Object Extension -eq '.docx')){
                $archive=[IO.Compression.ZipFile]::OpenRead($document.FullName)
                try{Assert-Equal (@($archive.Entries|Where-Object FullName -eq '[Content_Types].xml').Count) 1}finally{$archive.Dispose()}
            }
            foreach($pdf in @($delivery|Where-Object Extension -eq '.pdf')){
                $stream=$pdf.OpenRead();try{$bytes=New-Object byte[] 5;[void]$stream.Read($bytes,0,5);Assert-Equal ([Text.Encoding]::ASCII.GetString($bytes)) '%PDF-'}finally{$stream.Dispose()}
            }
            $complete=@($delivery|Where-Object Name -Like '*-完整交付包.zip')[0]
            $zip=[IO.Compression.ZipFile]::OpenRead($complete.FullName);try{Assert-Equal $zip.Entries.Count 14}finally{$zip.Dispose()}
            Add-Type -AssemblyName System.Drawing
            $imageFiles=@(Get-ChildItem -LiteralPath (Join-Path $context.WorkspacePath 'screenshots') -Filter '*.png' -File);Assert-Equal $imageFiles.Count 5
            foreach($imageFile in $imageFiles){
                $image=[Drawing.Image]::FromFile($imageFile.FullName);try{Assert-Equal ($image.Width -ge 400) $true;Assert-Equal ($image.Height -ge 800) $true}finally{$image.Dispose()}
            }
        }finally{foreach($secret in $bundle.Secrets.Values){$secret.Dispose()}}
    }
}
finally {
    if(Test-Path -LiteralPath $root){Remove-Item -LiteralPath $root -Recurse -Force}
}
