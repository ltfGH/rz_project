. "$PSScriptRoot\Assert.ps1"
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot '..\lib\StandardBusinessDiagrams.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot '..\lib\StandardMaterialRendering.psm1') -Force -DisableNameChecking
Add-Type -AssemblyName System.Drawing

function Visible-Text([string]$Html){
    $withoutStyle=[regex]::Replace($Html,'(?is)<style\b[^>]*>.*?</style>',' ')
    return [Net.WebUtility]::HtmlDecode([regex]::Replace($withoutStyle,'(?s)<[^>]+>',' '))
}
function Non-Space-Length([string]$Text){return ([regex]::Replace($Text,'\s','')).Length}
function Assert-NonblankPng([string]$Path,[int]$Width,[int]$Height){
    Assert-Equal (Test-Path -LiteralPath $Path -PathType Leaf) $true
    $bitmap=[Drawing.Bitmap]::new($Path)
    try{
        Assert-Equal $bitmap.Width $Width;Assert-Equal $bitmap.Height $Height
        $colors=@{}
        for($x=0;$x-lt$bitmap.Width;$x+=[Math]::Max(1,[Math]::Floor($bitmap.Width/24))){
            for($y=0;$y-lt$bitmap.Height;$y+=[Math]::Max(1,[Math]::Floor($bitmap.Height/18))){$colors[$bitmap.GetPixel($x,$y).ToArgb()]=$true}
        }
        Assert-Equal ($colors.Count-ge4) $true
    }
    finally{$bitmap.Dispose()}
}

$root=Join-Path ([IO.Path]::GetTempPath()) ('standard-diagrams-'+[guid]::NewGuid().ToString('N'))
try{
    $factsRoot=Join-Path $root 'facts';$helper=Join-Path $PSScriptRoot '..\desktop-runtime\tests\helpers\write-material-rendering-fixtures.cjs'
    $oldWarnings=$env:NODE_NO_WARNINGS;$env:NODE_NO_WARNINGS='1'
    try{$helperOutput=& node $helper $factsRoot 2>&1|Out-String}finally{$env:NODE_NO_WARNINGS=$oldWarnings}
    if($LASTEXITCODE-ne0){throw "Failed to create production facts: $helperOutput"}
    $factFiles=@(Get-ChildItem -LiteralPath $factsRoot -Filter '*.json' -File|Sort-Object Name);Assert-Equal $factFiles.Count 8
    $expected=[ordered]@{navigation=@(1400,900);interface=@(1400,900);roles=@(1400,900);workflow=@(1600,900);relationships=@(1600,1000)}

    foreach($factFile in $factFiles){
        $facts=Get-Content -Raw -Encoding UTF8 -LiteralPath $factFile.FullName|ConvertFrom-Json
        $caseRoot=Join-Path $root ([IO.Path]::GetFileNameWithoutExtension($factFile.Name));$diagramRoot=Join-Path $caseRoot 'diagrams'
        $diagrams=@(New-StandardBusinessDiagrams -Facts $facts -OutputDirectory $diagramRoot)
        Assert-Equal ($diagrams.id-join ',') (($expected.Keys)-join ',')
        foreach($diagram in $diagrams){
            $size=$expected[[string]$diagram.id];Assert-Equal ([string]$diagram.fileName) ([string]$diagram.id+'.png')
            Assert-NonblankPng (Join-Path $diagramRoot ([string]$diagram.fileName)) $size[0] $size[1]
        }
        Assert-Throws {New-StandardBusinessDiagrams -Facts $facts -OutputDirectory $diagramRoot|Out-Null} 'Refusing to overwrite diagram output'

        $prototypePath=Join-Path $caseRoot 'prototype.html';$databasePath=Join-Path $caseRoot 'database.html'
        $prototype=Render-StandardPrototypeHtml -Facts $facts -DiagramRoot $diagramRoot -OutputPath $prototypePath
        $database=Render-StandardDatabaseHtml -Facts $facts -DiagramRoot $diagramRoot -OutputPath $databasePath
        Assert-Throws {Render-StandardPrototypeHtml -Facts $facts -DiagramRoot $diagramRoot -OutputPath (Join-Path $caseRoot 'elsewhere\prototype.html')|Out-Null} 'Diagram root must be the diagrams directory beside the rendered document'
        Assert-Equal ([IO.File]::ReadAllText($prototypePath,[Text.Encoding]::UTF8)) $prototype
        Assert-Equal ([IO.File]::ReadAllText($databasePath,[Text.Encoding]::UTF8)) $database
        $prototypeVisible=Visible-Text $prototype;$databaseVisible=Visible-Text $database
        foreach($heading in @('导航层级','列表、详情与表单','角色操作矩阵','业务流程','实体关系')){Assert-Match $prototypeVisible ([regex]::Escape($heading))}
        foreach($heading in @('数据库设计','存储与版本策略','表分类','实体关系','核心数据字典','键与约束','事务边界','种子与版本迁移','备份与恢复')){Assert-Match $databaseVisible ([regex]::Escape($heading))}
        Assert-Equal ([regex]::Matches($prototype,'<img\s').Count) 5
        Assert-Equal ((Non-Space-Length $prototypeVisible)-ge1800) $true
        Assert-Equal ((Non-Space-Length $databaseVisible)-ge3500) $true

        $coreEntities=@($facts.entities|Where-Object{$_.isCore});$selectedIds=@($facts.entities|ForEach-Object{[string]$_.id});$allowedTableNames=@($facts.database.tables|Where-Object{$_.kind-eq'system'-or$selectedIds-contains[string]$_.entityId}|ForEach-Object{[string]$_.name})
        foreach($entity in $coreEntities){
            Assert-Match $prototypeVisible ([regex]::Escape([string]$entity.name))
            Assert-Match $databaseVisible ([regex]::Escape([string]$entity.name))
            $tables=@($facts.database.tables|Where-Object{[string]$_.entityId-eq[string]$entity.id});Assert-Equal $tables.Count 1
            $table=$tables[0];Assert-Match $databaseVisible ('(?<![A-Za-z0-9_])'+[regex]::Escape([string]$table.name)+'(?![A-Za-z0-9_])')
            $allowedForeignKeys=@($table.foreignKeys|Where-Object{$allowedTableNames-contains[string]$_.targetTable})
            Assert-Match $databaseVisible ([regex]::Escape(('该表共有 '+@($table.columns).Count+' 列、'+@($table.indexes).Count+' 个已登记索引和 '+$allowedForeignKeys.Count+' 条外键关系')))
            foreach($column in @($table.columns)){Assert-Match $databaseVisible ('(?<![A-Za-z0-9_])'+[regex]::Escape([string]$column.name)+'(?![A-Za-z0-9_])')}
            foreach($index in @($table.indexes)){Assert-Match $databaseVisible ('(?<![A-Za-z0-9_])'+[regex]::Escape([string]$index.name)+'(?![A-Za-z0-9_])')}
            foreach($foreignKey in @($table.foreignKeys|Where-Object{$allowedTableNames-contains[string]$_.targetTable})){
                foreach($value in @($foreignKey.targetTable,$foreignKey.fromColumn,$foreignKey.toColumn)){Assert-Match $databaseVisible ('(?<![A-Za-z0-9_])'+[regex]::Escape([string]$value)+'(?![A-Za-z0-9_])')}
            }
        }
        foreach($table in @($facts.database.tables|Where-Object{$_.kind-eq'business'-and$selectedIds-notcontains[string]$_.entityId})){
            if($databaseVisible-cmatch ('(?<![A-Za-z0-9_])'+[regex]::Escape([string]$table.name)+'(?![A-Za-z0-9_])')){throw "Unselected table $($table.name) leaked for $($facts.templateId)."}
        }
    }

    $raceParent=Join-Path $root 'concurrent-publish';New-Item -ItemType Directory -Path $raceParent|Out-Null
    $raceTarget=Join-Path $raceParent 'diagrams';$marker=Join-Path $raceTarget 'other-producer.txt'
    $watcher=[IO.FileSystemWatcher]::new($raceParent,'.diagrams-staging-*');$watcher.NotifyFilter=[IO.NotifyFilters]::DirectoryName;$watcher.EnableRaisingEvents=$true
    $eventJob=Register-ObjectEvent -InputObject $watcher -EventName Created -MessageData ([pscustomobject]@{target=$raceTarget;marker=$marker}) -Action {[IO.Directory]::CreateDirectory($event.MessageData.target)|Out-Null;[IO.File]::WriteAllText($event.MessageData.marker,'owned by another producer')}
    try{Assert-Throws {New-StandardBusinessDiagrams -Facts $facts -OutputDirectory $raceTarget|Out-Null} 'Refusing to overwrite diagram output'}
    finally{Unregister-Event -SourceIdentifier $eventJob.Name -ErrorAction SilentlyContinue;Remove-Job -Job $eventJob -Force -ErrorAction SilentlyContinue;$watcher.Dispose()}
    Assert-Equal (Test-Path -LiteralPath $marker -PathType Leaf) $true
    Assert-Equal ([IO.File]::ReadAllText($marker)) 'owned by another producer'
    $oversized=$facts|ConvertTo-Json -Depth 100|ConvertFrom-Json
    $oversized.modules=@($oversized.modules)+@($oversized.modules[0],$oversized.modules[0])
    Assert-Throws {New-StandardBusinessDiagrams -Facts $oversized -OutputDirectory (Join-Path $root 'oversized-diagrams')|Out-Null} 'exceed fixed diagram capacity'
    $tooManyRoles=$facts|ConvertTo-Json -Depth 100|ConvertFrom-Json
    $tooManyRoles.roles=@($tooManyRoles.roles)+@($tooManyRoles.roles[0])
    Assert-Throws {New-StandardBusinessDiagrams -Facts $tooManyRoles -OutputDirectory (Join-Path $root 'too-many-roles-diagrams')|Out-Null} 'exceed fixed diagram capacity'
}
finally{if(Test-Path -LiteralPath $root){Remove-Item -LiteralPath $root -Recurse -Force}}
