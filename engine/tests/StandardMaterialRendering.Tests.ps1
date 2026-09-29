. "$PSScriptRoot\Assert.ps1"
$ErrorActionPreference='Stop'
$modulePath=Join-Path $PSScriptRoot '..\lib\StandardMaterialRendering.psm1'
Import-Module $modulePath -Force -DisableNameChecking

function New-Facts {
    $commands=@(
        [pscustomobject]@{id='project.create';label='创建项目';permission='projects.create_project';moduleId='projects';entityId='project'},
        [pscustomobject]@{id='project.activate';label='激活项目';permission='projects.activate';moduleId='projects';entityId='project'},
        [pscustomobject]@{id='project.task.create';label='创建任务';permission='project_tasks.create_task';moduleId='project_tasks';entityId='project_task'},
        [pscustomobject]@{id='project.task.progress';label='填写进展';permission='project_tasks.progress';moduleId='project_tasks';entityId='project_task'},
        [pscustomobject]@{id='project.risk.create';label='登记风险';permission='project_risks.create_risk';moduleId='project_risks';entityId='project_risk'},
        [pscustomobject]@{id='project.deliverable.submit';label='提交交付成果';permission='deliverables.submit';moduleId='deliverables';entityId='deliverable'}
    )
    $inputMap=@{'project.create'=@('项目名称','项目经理账号','计划开始日期','计划结束日期');'project.activate'=@();'project.task.create'=@('任务标题','负责人账号','任务权重');'project.task.progress'=@('进展说明');'project.risk.create'=@('风险标题','风险说明','风险等级');'project.deliverable.submit'=@('交付物名称','业务版本','文件摘要')}
    foreach($command in $commands){$command|Add-Member -NotePropertyName inputLabels -NotePropertyValue $inputMap[[string]$command.id];$command|Add-Member -NotePropertyName precondition -NotePropertyValue '当前记录、登录岗位和业务状态满足操作要求';$command|Add-Member -NotePropertyName result -NotePropertyValue ('完成“'+$command.label+'”并保存业务结果');$command|Add-Member -NotePropertyName failure -NotePropertyValue '输入、权限、状态或版本不符合要求时拒绝写入'}
    $entities=@(
        [pscustomobject]@{id='project';name='分发项目';retention='protected';history=$true;fields=@([pscustomobject]@{id='name';name='项目名称';type='text';required=$true;unique=$false},[pscustomobject]@{id='manager_id';name='项目经理';type='text';required=$true;unique=$false},[pscustomobject]@{id='status';name='项目状态';type='enum';required=$true;unique=$false},[pscustomobject]@{id='progress';name='项目进度';type='integer';required=$true;unique=$false})},
        [pscustomobject]@{id='project_task';name='分发任务';retention='protected';history=$true;fields=@([pscustomobject]@{id='title';name='任务标题';type='text';required=$true;unique=$false},[pscustomobject]@{id='assignee_id';name='负责人';type='text';required=$true;unique=$false},[pscustomobject]@{id='weight';name='任务权重';type='integer';required=$true;unique=$false},[pscustomobject]@{id='status';name='任务状态';type='enum';required=$true;unique=$false})},
        [pscustomobject]@{id='project_risk';name='项目风险';retention='protected';history=$true;fields=@([pscustomobject]@{id='title';name='风险标题';type='text';required=$true;unique=$false},[pscustomobject]@{id='level';name='风险等级';type='enum';required=$true;unique=$false},[pscustomobject]@{id='disposition';name='处置说明';type='text';required=$false;unique=$false})},
        [pscustomobject]@{id='deliverable';name='交付版本';retention='protected';history=$true;fields=@([pscustomobject]@{id='name';name='交付物名称';type='text';required=$true;unique=$false},[pscustomobject]@{id='business_version';name='业务版本';type='text';required=$true;unique=$false},[pscustomobject]@{id='status';name='验收状态';type='enum';required=$true;unique=$false})}
    )
    [pscustomobject]@{
        factVersion='1.0';templateId='project_task_management'
        software=[pscustomobject]@{id='edge_distribution';name='边缘云智能业务分发平台软件';version='1.0.0';buildDate='2026-09-21';materialGeneratedOn='2026-09-29';purpose='对离线环境中的分发项目、执行任务、风险事项和交付版本进行闭环管理';targetUsers=@('项目管理人员','项目成员','复核人员','系统管理员');boundaries=@('离线桌面运行','数据保存在当前用户本机','不依赖互联网服务')}
        modules=@(
            [pscustomobject]@{id='projects';name='分发项目';entityId='project';purpose='管理项目立项、激活、进度汇总和关闭复核';operations=@('project.create','project.activate')},
            [pscustomobject]@{id='project_tasks';name='分发任务';entityId='project_task';purpose='管理任务分派、执行进展、提交验收和结果复核';operations=@('project.task.create','project.task.progress')},
            [pscustomobject]@{id='project_risks';name='项目风险';entityId='project_risk';purpose='登记风险等级、处置过程和关闭结果';operations=@('project.risk.create')},
            [pscustomobject]@{id='deliverables';name='交付版本';entityId='deliverable';purpose='维护交付版本、文件摘要、验收意见和最终状态';operations=@('project.deliverable.submit')}
        )
        entities=$entities
        roles=@(
            [pscustomobject]@{id='operations_dispatcher';name='项目管理人员';visibleOperations=@('project.create','project.activate','project.task.create','project.risk.create')},
            [pscustomobject]@{id='operations_operator';name='项目成员';visibleOperations=@('project.task.progress','project.deliverable.submit')},
            [pscustomobject]@{id='operations_reviewer';name='复核人员';visibleOperations=@()},
            [pscustomobject]@{id='operations_admin';name='系统管理员';visibleOperations=@('project.create')}
        )
        commands=$commands
        workflows=@([pscustomobject]@{id='project_task_management_primary';name='核心业务流程';steps=@(
            [pscustomobject]@{id='project';label='项目立项';moduleId='projects';entityId='project';actionId='project.create';prerequisite='项目名称、负责人和计划日期完整';result='形成草稿项目和唯一项目编码';failure='日期或负责人无效时拒绝立项'},
            [pscustomobject]@{id='activate';label='激活项目';moduleId='projects';entityId='project';actionId='project.activate';prerequisite='项目处于草稿且计划信息完整';result='项目进入进行中状态';failure='状态或版本不符时拒绝激活'},
            [pscustomobject]@{id='task';label='任务执行';moduleId='project_tasks';entityId='project_task';actionId='project.task.create';prerequisite='项目已激活且负责人有效';result='任务进入执行与进展记录阶段';failure='权重或负责人无效时拒绝创建'},
            [pscustomobject]@{id='risk';label='风险处置';moduleId='project_risks';entityId='project_risk';actionId='project.risk.create';prerequisite='项目进行中且风险说明完整';result='风险进入登记、缓解和关闭链路';failure='项目关闭后不能新增风险'},
            [pscustomobject]@{id='deliverable';label='交付验收';moduleId='deliverables';entityId='deliverable';actionId='project.deliverable.submit';prerequisite='交付版本信息和文件摘要完整';result='形成待复核交付版本';failure='版本重复时拒绝提交'},
            [pscustomobject]@{id='close';label='关闭复核';moduleId='projects';entityId='project';actionId=$null;prerequisite='任务、风险和交付条件均已满足';result='项目经独立复核后关闭';failure='存在未完成条件时保持进行中状态'}
        )})
        database=[pscustomobject]@{schemaVersion=1;schemaDigest=('d'*64);tables=@([pscustomobject]@{name='biz_project'},[pscustomobject]@{name='biz_project_task'},[pscustomobject]@{name='biz_project_risk'},[pscustomobject]@{name='biz_deliverable'},[pscustomobject]@{name='sys_audit_event'})}
        runtime=[pscustomobject]@{desktop='1.0.0';electron='44.4.1';node='22.21.0';sqlite='3.50.4';databaseSchemaVersion=1;buildTarget='win-nsis-x64';platform='Windows 10/11 x64';installationMode='当前用户安装';dataPolicy='业务数据存放在当前 Windows 用户的应用数据目录';backupPolicy='系统管理员通过数据与备份模块创建和恢复校验后的数据库快照';offline=$true}
        source=[pscustomobject]@{totalFiles=120;totalLines=14877;sha256=('s'*64)}
        evidence=[pscustomobject]@{status='passed';businessRows=1000;resourceManifestSha256=('r'*64);blueprintSha256=('b'*64);executableSha256=('e'*64)}
        constraints=[pscustomobject]@{validationNotes=@('所有状态变化均校验当前记录版本','项目关闭前检查必需任务、风险和交付条件');unsupportedClaims=@('不包含互联网在线协同或云同步','不包含外部代码仓库和持续集成接口')}
    }
}
function VisibleText([string]$Html){return [regex]::Replace([regex]::Replace($Html,'<style[\s\S]*?</style>',''),'<'+'[^>]+>',' ') -replace '&[^;]+;',' '}
function NonSpace([string]$Text){return ([regex]::Replace($Text,'\s','')).Length}

$facts=New-Facts
$intro=Render-StandardIntroductionHtml -Facts $facts
$feature=Render-StandardFeatureTableHtml -Facts $facts
$runtime=Render-StandardRuntimeHtml -Facts $facts
foreach($html in @($intro,$feature,$runtime)){Assert-Match $html '<!doctype html>';Assert-Match $html '【申请人填写】';Assert-Match $html '边缘云智能业务分发平台软件';Assert-Equal ($html -match '<script') $false}
foreach($heading in @('建设目的','适用用户','业务范围','完整业务流程','数据特征','技术架构','能力边界')){Assert-Match $intro $heading}
Assert-Equal ((NonSpace (VisibleText $intro)) -ge 1200) $true
foreach($module in $facts.modules){Assert-Match $intro ([regex]::Escape($module.name));Assert-Match $feature ([regex]::Escape($module.name))}
Assert-Equal (([regex]::Matches($feature,'<table')).Count -ge ($facts.modules.Count+2)) $true
Assert-Equal ((NonSpace (VisibleText $feature)) -ge 2500) $true
foreach($heading in @('安装准备','运行时组成','本地数据','备份与恢复','离线边界','构建版本','启动与退出','卸载与数据保留')){Assert-Match $runtime $heading}
Assert-Equal (([regex]::Matches($runtime,'<table')).Count -ge 2) $true
Assert-Equal ((NonSpace (VisibleText $runtime)) -ge 800) $true
$visible=(VisibleText ($intro+$feature+$runtime))
foreach($internal in @('project.create','project.task.create','manager_id','business_version','operations_dispatcher')){Assert-Equal ($visible -match [regex]::Escape($internal)) $false}
Assert-Equal (Render-StandardIntroductionHtml -Facts $facts) $intro

$hostile=New-Facts;$hostile.software.name='<script>alert(1)</script>'
$escaped=Render-StandardIntroductionHtml -Facts $hostile
Assert-Equal ($escaped -match '<script>alert') $false
Assert-Match $escaped '&lt;script&gt;alert\(1\)&lt;/script&gt;'

$css=Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $PSScriptRoot '..\template-standard\materials\layout\base.css')
foreach($required in @('@page','Microsoft YaHei','SimSun','thead','page-break','figcaption')){Assert-Match $css ([regex]::Escape($required))}
Assert-Equal ($css -match 'letter-spacing\s*:\s*-') $false
Assert-Equal ($css -match 'margin-(top|right|bottom|left)\s*:\s*-') $false

$productionRoot=Join-Path $env:TEMP ('standard-rendering-facts-'+[guid]::NewGuid().ToString('N'))
try{
    $helper=Join-Path $PSScriptRoot '..\desktop-runtime\tests\helpers\write-material-rendering-fixtures.cjs'
    $previousNodeWarnings=$env:NODE_NO_WARNINGS;$env:NODE_NO_WARNINGS='1'
    try{$helperOutput=& node $helper $productionRoot 2>&1|Out-String}finally{$env:NODE_NO_WARNINGS=$previousNodeWarnings}
    if($LASTEXITCODE-ne0){throw "Production material fact fixtures failed: $helperOutput"}
    $factFiles=@(Get-ChildItem -LiteralPath $productionRoot -Filter '*.json' -File|Sort-Object Name)
    Assert-Equal $factFiles.Count 8
    foreach($factFile in $factFiles){
        $productionFacts=Get-Content -Raw -Encoding UTF8 -LiteralPath $factFile.FullName|ConvertFrom-Json
        $productionIntro=Render-StandardIntroductionHtml -Facts $productionFacts
        $productionFeature=Render-StandardFeatureTableHtml -Facts $productionFacts
        $productionRuntime=Render-StandardRuntimeHtml -Facts $productionFacts
        Assert-Equal ((NonSpace (VisibleText $productionIntro))-ge1200) $true
        Assert-Equal ((NonSpace (VisibleText $productionFeature))-ge2500) $true
        Assert-Equal ((NonSpace (VisibleText $productionRuntime))-ge800) $true
        $commandMap=@{};foreach($command in @($productionFacts.commands)){$commandMap[[string]$command.id]=$command}
        $moduleIndex=0
        foreach($module in @($productionFacts.modules)){
            $moduleIndex++;Assert-Match $productionIntro ([regex]::Escape([string]$module.name));Assert-Match $productionFeature ([regex]::Escape([string]$module.name))
            $heading='<h2>'+($moduleIndex+1)+'. '+[Security.SecurityElement]::Escape([string]$module.name)+'</h2>'
            $start=$productionFeature.IndexOf($heading,[StringComparison]::Ordinal);Assert-Equal ($start-ge0) $true
            $next=$productionFeature.IndexOf('<h2>',$start+$heading.Length,[StringComparison]::Ordinal);if($next-lt0){$next=$productionFeature.Length};$section=$productionFeature.Substring($start,$next-$start)
            foreach($commandId in @($module.operations)){Assert-Match $section ([regex]::Escape([string]$commandMap[[string]$commandId].label))}
        }
        $productionVisible=VisibleText ($productionIntro+$productionFeature+$productionRuntime)
        $structuredIds=@($productionFacts.modules.id)+@($productionFacts.entities.id)+@($productionFacts.commands.id)+@($productionFacts.roles.id)
        $fieldIds=@($productionFacts.entities|ForEach-Object{@($_.fields.id)})
        $internalIds=@($structuredIds|Where-Object{[string]$_ -match '[_.]'})+@($fieldIds)
        foreach($internalId in @($internalIds|Sort-Object -Unique)){Assert-Equal ($productionVisible-cmatch ('(?<![A-Za-z0-9_\.])'+[regex]::Escape([string]$internalId)+'(?![A-Za-z0-9_\.])')) $false}
    }
}
finally{if(Test-Path -LiteralPath $productionRoot){Remove-Item -LiteralPath $productionRoot -Recurse -Force}}
