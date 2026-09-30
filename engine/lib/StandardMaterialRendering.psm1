Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$script:MaterialTemplateRoot=Join-Path (Split-Path -Parent $PSScriptRoot) 'template-standard\materials'

function ConvertTo-StandardHtmlText {
    param([AllowNull()]$Value)
    if($null-eq $Value){return ''}
    return [Security.SecurityElement]::Escape([string]$Value)
}
function Add-Html([Text.StringBuilder]$Builder,[string]$Value){[void]$Builder.Append($Value)}
function Get-CommandMap($Facts){$map=@{};foreach($command in @($Facts.commands)){$map[[string]$command.id]=$command};return $map}
function Get-EntityMap($Facts){$map=@{};foreach($entity in @($Facts.entities)){$map[[string]$entity.id]=$entity};return $map}
function Get-ModuleMap($Facts){$map=@{};foreach($module in @($Facts.modules)){$map[[string]$module.id]=$module};return $map}
function Get-WorkflowSteps($Facts){return @(@($Facts.workflows)|ForEach-Object{@($_.steps)})}
function Get-CommandLabel($CommandMap,[string]$Id){if($CommandMap.ContainsKey($Id)){return [string]$CommandMap[$Id].label};return ''}
function Get-RoleNamesForCommand($Facts,[string]$CommandId){
    $names=@($Facts.roles|Where-Object{@($_.visibleOperations)-contains $CommandId}|ForEach-Object{[string]$_.name})
    if($names.Count-eq 0){return '具备对应业务权限的岗位'}
    return ($names-join '、')
}
function Get-StepForCommand($Facts,[string]$CommandId){$matched=@(Get-WorkflowSteps $Facts|Where-Object{[string]$_.actionId-eq $CommandId}|Select-Object -First 1);if($matched.Count){return $matched[0]};return $null}
function Get-TypeLabel([string]$Type){
    $labels=@{text='文本';integer='整数';decimal='数值';boolean='是/否';date='日期';datetime='日期时间';enum='选项';reference='关联记录'}
    if($labels.ContainsKey($Type)){return $labels[$Type]};return '业务数据'
}
function Get-RetentionLabel([string]$Value){switch($Value){'append_only'{return '仅追加留痕'}'protected'{return '受保护维护'}default{return '受控维护'}}}
function Assert-RenderingFacts($Facts){
    if($null-eq $Facts-or[string]$Facts.factVersion-ne'1.0'){throw 'Standard material facts version is invalid.'}
    if([string]::IsNullOrWhiteSpace([string]$Facts.software.name)-or@($Facts.modules).Count-eq 0-or@($Facts.entities).Count-eq 0){throw 'Standard material facts are incomplete.'}
}
function New-CoverHtml($Facts,[string]$DocumentName){
    $name=ConvertTo-StandardHtmlText $Facts.software.name;$version=ConvertTo-StandardHtmlText $Facts.software.version;$date=ConvertTo-StandardHtmlText $Facts.software.materialGeneratedOn;$document=ConvertTo-StandardHtmlText $DocumentName
    return "<section class=`"cover`"><div class=`"document-type`">软件著作权登记配套材料</div><h1>$name</h1><h2>$document</h2><table><tbody><tr><th class=`"label`">软件版本</th><td>V$version</td></tr><tr><th class=`"label`">编制单位</th><td>【申请人填写】</td></tr><tr><th class=`"label`">生成日期</th><td>$date</td></tr><tr><th class=`"label`">材料状态</th><td>依据已验证软件事实生成</td></tr></tbody></table></section>"
}
function Complete-DocumentHtml($Facts,[string]$TemplateName,[string]$DocumentName,[Text.StringBuilder]$Body,[string]$OutputPath){
    $templatePath=Join-Path $script:MaterialTemplateRoot ('content\'+$TemplateName+'.html');$stylePath=Join-Path $script:MaterialTemplateRoot 'layout\base.css'
    if(-not(Test-Path -LiteralPath $templatePath -PathType Leaf)-or-not(Test-Path -LiteralPath $stylePath -PathType Leaf)){throw 'Standard material layout files are missing.'}
    $template=[IO.File]::ReadAllText($templatePath,[Text.UTF8Encoding]::new($false));$style=[IO.File]::ReadAllText($stylePath,[Text.UTF8Encoding]::new($false))
    $title=ConvertTo-StandardHtmlText (([string]$Facts.software.name)+' '+$DocumentName)
    $html=$template.Replace('{{DOC_TITLE}}',$title).Replace('{{STYLE}}',$style).Replace('{{BODY}}',$Body.ToString())
    if($html-match '\{\{[A-Z_]+\}\}'){throw 'Standard material template has unresolved tokens.'}
    if(-not[string]::IsNullOrWhiteSpace($OutputPath)){$target=[IO.Path]::GetFullPath($OutputPath);if(Test-Path -LiteralPath $target){throw 'Refusing to overwrite rendered material.'};$parent=Split-Path -Parent $target;if(-not(Test-Path -LiteralPath $parent)){New-Item -ItemType Directory -Path $parent -Force|Out-Null};[IO.File]::WriteAllText($target,$html,[Text.UTF8Encoding]::new($false))}
    return $html
}

function Render-StandardIntroductionHtml {
    [CmdletBinding()]param([Parameter(Mandatory)]$Facts,[string]$OutputPath)
    Assert-RenderingFacts $Facts;$commands=Get-CommandMap $Facts;$entities=Get-EntityMap $Facts;$body=[Text.StringBuilder]::new();Add-Html $body (New-CoverHtml $Facts '软件简介')
    $name=ConvertTo-StandardHtmlText $Facts.software.name;$purpose=ConvertTo-StandardHtmlText $Facts.software.purpose
    Add-Html $body "<h1>软件简介</h1><p class=`"document-note`">本文档说明 $name 已实现的业务目标、适用岗位、核心模块、流程、数据特征、技术架构和能力边界。所有内容均来自锁定蓝图、运行时动作、数据库结构及验收证据，不对未实现能力作扩展描述。</p>"
    Add-Html $body "<h2>一、建设目的</h2><p>$name 的建设目的为：$purpose。软件以可长期使用的离线桌面程序为交付对象，将分散的业务登记、执行、复核和归档活动组织为可追踪流程，并通过角色权限、版本校验、数据库事务和审计记录保持处理结果一致。软件不是静态演示页面，用户完成的操作会写入本机数据库，重新启动后仍可继续查询和处理。</p><p>系统把业务对象、处理动作和结果状态放在同一事实边界内。创建类操作形成唯一业务记录，执行类操作依据当前状态和权限推进，复核类操作由独立岗位完成，失败分支则保留原状态并返回明确原因。该方式便于日常重复使用，也便于申请材料与实际软件相互核对。</p>"
    Add-Html $body '<h2>二、适用用户</h2><p>软件面向下列已经在运行蓝图中配置的岗位。不同岗位看到的操作由组合权限决定，界面不会仅凭前端显示结果绕过主进程授权。</p><ul>'
    foreach($role in @($Facts.roles)){ $ops=@($role.visibleOperations|ForEach-Object{Get-CommandLabel $commands ([string]$_)}|Where-Object{-not[string]::IsNullOrWhiteSpace($_)});$summary=if($ops.Count){$ops-join '、'}else{'查看授权范围内的信息并承担流程复核职责'};Add-Html $body ('<li><strong>'+ (ConvertTo-StandardHtmlText $role.name) +'：</strong>'+ (ConvertTo-StandardHtmlText $summary) +'。</li>') }
    Add-Html $body '</ul><h2>三、业务范围</h2><p>当前版本的业务范围由以下核心模块构成。模块名称采用主题化显示名称，模块职责和可用操作均与已激活领域能力对应。</p>'
    $index=0;foreach($module in @($Facts.modules)){$index++;$entity=if($entities.ContainsKey([string]$module.entityId)){$entities[[string]$module.entityId]}else{$null};$fieldNames=if($null-ne$entity){@($entity.fields|ForEach-Object{[string]$_.name})-join '、'}else{'已验证业务字段'};$labels=@($module.operations|ForEach-Object{Get-CommandLabel $commands ([string]$_)}|Where-Object{$_});$operations=if($labels.Count){$labels-join '、'}else{'查询、查看和业务信息呈现'};Add-Html $body ("<h3>3.$index "+(ConvertTo-StandardHtmlText $module.name)+"</h3><p>"+(ConvertTo-StandardHtmlText $module.purpose)+"。该模块围绕"+(ConvertTo-StandardHtmlText ($entity.name))+"组织信息，主要呈现"+(ConvertTo-StandardHtmlText $fieldNames)+"等业务内容；已验证操作包括"+(ConvertTo-StandardHtmlText $operations)+"。所有写入均经后端权限与输入校验处理，列表、详情和动作结果来自同一持久化记录。</p>")}
    Add-Html $body '<h2>四、完整业务流程</h2><p>核心流程按下列顺序连接多个业务对象。每一步均列明前置条件、成功结果和失败行为，使操作手册、功能表与实际状态转换保持一致。</p><ol>'
    foreach($step in Get-WorkflowSteps $Facts){Add-Html $body ('<li><strong>'+(ConvertTo-StandardHtmlText $step.label)+'。</strong>前置条件：'+(ConvertTo-StandardHtmlText $step.prerequisite)+'；处理结果：'+(ConvertTo-StandardHtmlText $step.result)+'；失败行为：'+(ConvertTo-StandardHtmlText $step.failure)+'。</li>')}
    Add-Html $body '</ol><h2>五、数据特征</h2><p>软件采用本机 SQLite 数据库保存业务记录和系统记录。业务实体通过明确字段、关联关系、状态值与版本号参与事务处理，系统表用于迁移、用户、会话、审计、备份及流程事件。当前数据库事实如下：</p><ul>'
    foreach($entity in @($Facts.entities)){$required=@($entity.fields|Where-Object required).Count;$names=@($entity.fields|ForEach-Object{[string]$_.name})-join '、';Add-Html $body ('<li><strong>'+(ConvertTo-StandardHtmlText $entity.name)+'：</strong>采用'+(ConvertTo-StandardHtmlText (Get-RetentionLabel ([string]$entity.retention)))+'策略，共'+$entity.fields.Count+'个主题字段，其中'+$required+'个为必填字段，主要包括'+(ConvertTo-StandardHtmlText $names)+'。'+$(if($entity.history){'该实体保留历史或事件追踪信息。'}else{'该实体按当前有效记录维护。'})+'</li>')}
    Add-Html $body ('</ul><p>经迁移后数据库共包含 '+$Facts.database.tables.Count+' 张业务或系统表，结构版本为 '+(ConvertTo-StandardHtmlText $Facts.database.schemaVersion)+'。源码清单记录 '+(ConvertTo-StandardHtmlText $Facts.source.totalFiles)+' 个文件、'+(ConvertTo-StandardHtmlText $Facts.source.totalLines)+' 行源码；验收数据量为 '+(ConvertTo-StandardHtmlText $Facts.evidence.businessRows)+' 条业务记录。上述数字来自生成证据，不作为性能承诺。</p>')
    Add-Html $body ('<h2>六、技术架构</h2><p>软件采用 Electron 桌面容器、Node.js 主进程、React 渲染界面和 SQLite 本地数据库组成离线运行架构。桌面运行时版本为 '+(ConvertTo-StandardHtmlText $Facts.runtime.desktop)+'，Electron 版本为 '+(ConvertTo-StandardHtmlText $Facts.runtime.electron)+'，Node.js 版本为 '+(ConvertTo-StandardHtmlText $Facts.runtime.node)+'，SQLite 版本为 '+(ConvertTo-StandardHtmlText $Facts.runtime.sqlite)+'。渲染界面通过受限预加载接口调用主进程服务，领域动作、权限检查、事务和审计均在可信运行边界内完成。</p><p>安装目标为 '+(ConvertTo-StandardHtmlText $Facts.runtime.platform)+'，构建交付采用 '+(ConvertTo-StandardHtmlText $Facts.runtime.installationMode)+'。业务数据遵循“'+(ConvertTo-StandardHtmlText $Facts.runtime.dataPolicy)+'”的策略，备份与恢复遵循“'+(ConvertTo-StandardHtmlText $Facts.runtime.backupPolicy)+'”的策略。程序不依赖外部数据库服务，断开互联网后仍可完成已实现业务流程。</p>')
    Add-Html $body '<h2>七、能力边界</h2><p>当前版本以锁定模块、动作、数据表和验收流程为功能边界。未出现在事实清单中的模块、外部接口、网络服务和性能指标均不构成实现声明。</p><h3>已验证边界</h3><ul>'
    foreach($boundary in @($Facts.software.boundaries)){Add-Html $body ('<li>'+(ConvertTo-StandardHtmlText $boundary)+'</li>')};foreach($note in @($Facts.constraints.validationNotes)){Add-Html $body ('<li>'+(ConvertTo-StandardHtmlText $note)+'</li>')}
    Add-Html $body '</ul><h3>未包含能力</h3><ul>';foreach($claim in @($Facts.constraints.unsupportedClaims)){Add-Html $body ('<li>'+(ConvertTo-StandardHtmlText $claim)+'</li>')};Add-Html $body '</ul><p class="footer-note">本简介用于说明已交付软件的真实范围。申请人名称及登记主体信息仍由申请人在正式申报时填写。</p>'
    return Complete-DocumentHtml $Facts 'introduction' '软件简介' $body $OutputPath
}

function Render-StandardFeatureTableHtml {
    [CmdletBinding()]param([Parameter(Mandatory)]$Facts,[string]$OutputPath)
    Assert-RenderingFacts $Facts;$commands=Get-CommandMap $Facts;$entities=Get-EntityMap $Facts;$body=[Text.StringBuilder]::new();Add-Html $body (New-CoverHtml $Facts '软件功能表')
    Add-Html $body '<h1>软件功能表</h1><p class="document-note">本功能表按核心模块列出用户可见功能、适用岗位、输入信息、处理结果、验证规则和数据字段。表中使用界面中文名称，不展示内部动作标识、权限标识或数据库字段标识。</p><h2>一、功能总览</h2><table><thead><tr><th class="number">序号</th><th>模块</th><th>模块职责</th><th>业务对象</th><th>可见操作数量</th></tr></thead><tbody>'
    $index=0;foreach($module in @($Facts.modules)){$index++;$entity=$entities[[string]$module.entityId];Add-Html $body ('<tr><td class="number">'+$index+'</td><td>'+(ConvertTo-StandardHtmlText $module.name)+'</td><td>'+(ConvertTo-StandardHtmlText $module.purpose)+'</td><td>'+(ConvertTo-StandardHtmlText $entity.name)+'</td><td>'+@($module.operations).Count+'</td></tr>')};Add-Html $body '</tbody></table>'
    $moduleIndex=0;foreach($module in @($Facts.modules)){$moduleIndex++;$entity=$entities[[string]$module.entityId];$pageClass=if($moduleIndex-gt1){' class="page-break-before"'}else{''};Add-Html $body ("<section$pageClass><h2>"+($moduleIndex+1)+'. '+(ConvertTo-StandardHtmlText $module.name)+'</h2><p>'+(ConvertTo-StandardHtmlText $module.purpose)+'。该模块以'+(ConvertTo-StandardHtmlText $entity.name)+'为主要业务对象，通过列表、详情和经授权的领域操作完成日常处理。界面提交的数据先经过类型、必填、状态、角色和版本检查，再在事务中写入数据库；检查失败时保留原记录，避免形成部分成功的数据。</p>')
        Add-Html $body '<h3>用户可见功能</h3><table><thead><tr><th>功能名称</th><th>适用岗位</th><th>输入与前置条件</th><th>处理结果</th><th>失败与验证规则</th></tr></thead><tbody>'
        $moduleCommands=@($module.operations|ForEach-Object{$commands[[string]$_]}|Where-Object{$null-ne$_})
        if($moduleCommands.Count-eq0){
            Add-Html $body ('<tr><td>查询与查看</td><td>具备模块查看权限的岗位</td><td>输入查询关键词或选择列表记录</td><td>展示'+(ConvertTo-StandardHtmlText $entity.name)+'的列表和详情信息</td><td>无权限或记录不存在时不返回受保护内容</td></tr>')
        }
        else{
            foreach($command in $moduleCommands){
                $inputNames=@($command.inputLabels);$inputs=if($inputNames.Count){$inputNames-join '、'}else{'无需额外表单输入，由当前记录和登录岗位确定'}
                $before=[string]$command.precondition;$result=[string]$command.result;$failure=[string]$command.failure
                Add-Html $body ('<tr><td>'+(ConvertTo-StandardHtmlText $command.label)+'</td><td>'+(ConvertTo-StandardHtmlText (Get-RoleNamesForCommand $Facts ([string]$command.id)))+'</td><td>'+(ConvertTo-StandardHtmlText $before)+'；输入：'+(ConvertTo-StandardHtmlText $inputs)+'</td><td>'+(ConvertTo-StandardHtmlText $result)+'</td><td>'+(ConvertTo-StandardHtmlText $failure)+'</td></tr>')
            }
        }
        Add-Html $body '</tbody></table><h3>业务字段</h3><table class="compact"><thead><tr><th class="number">序号</th><th>字段名称</th><th>数据类型</th><th>填写要求</th><th>业务用途</th></tr></thead><tbody>'
        $fieldIndex=0;foreach($field in @($entity.fields)){$fieldIndex++;$requirement=if($field.required){'必填，保存前校验'}else{'可选，按业务场景填写'};$unique=if($field.unique){'，并执行唯一性检查'}else{''};Add-Html $body ('<tr><td class="number">'+$fieldIndex+'</td><td>'+(ConvertTo-StandardHtmlText $field.name)+'</td><td>'+(ConvertTo-StandardHtmlText (Get-TypeLabel ([string]$field.type)))+'</td><td>'+$requirement+$unique+'</td><td>用于描述'+(ConvertTo-StandardHtmlText $entity.name)+'的'+(ConvertTo-StandardHtmlText $field.name)+'，在列表、详情或业务动作中参与展示和校验。</td></tr>')}
        Add-Html $body ('</tbody></table><p><strong>数据控制：</strong>'+(ConvertTo-StandardHtmlText $entity.name)+'采用'+(ConvertTo-StandardHtmlText (Get-RetentionLabel ([string]$entity.retention)))+'策略。'+$(if($entity.history){'系统保留相关历史或事件记录，便于追踪前后状态。'}else{'系统维护当前有效记录，并通过审计事件追踪关键操作。'})+'模块的操作结果必须与数据库事务结果一致，界面刷新后展示持久化状态。</p></section>')
    }
    $roleSection=@($Facts.modules).Count+2;$workflowSection=$roleSection+1;$validationSection=$roleSection+2
    Add-Html $body ('<section class="page-break-before"><h2>'+$roleSection+'. 角色与功能对应</h2><table><thead><tr><th>岗位</th><th>已验证可见功能</th><th>权限控制说明</th></tr></thead><tbody>')
    foreach($role in @($Facts.roles)){$labels=@($role.visibleOperations|ForEach-Object{Get-CommandLabel $commands ([string]$_)}|Where-Object{$_});$text=if($labels.Count){$labels-join '、'}else{'查看授权信息及承担复核职责'};Add-Html $body ('<tr><td>'+(ConvertTo-StandardHtmlText $role.name)+'</td><td>'+(ConvertTo-StandardHtmlText $text)+'</td><td>登录身份由会话确定，主进程按该岗位的组合权限校验每次请求，界面传入的身份信息不能替代服务端判断。</td></tr>')}
    Add-Html $body ('</tbody></table><h2>'+$workflowSection+'. 流程步骤与验证</h2><table><thead><tr><th class="number">步骤</th><th>业务环节</th><th>前置条件</th><th>成功结果</th><th>失败处理</th></tr></thead><tbody>')
    $stepIndex=0;foreach($step in Get-WorkflowSteps $Facts){$stepIndex++;Add-Html $body ('<tr><td class="number">'+$stepIndex+'</td><td>'+(ConvertTo-StandardHtmlText $step.label)+'</td><td>'+(ConvertTo-StandardHtmlText $step.prerequisite)+'</td><td>'+(ConvertTo-StandardHtmlText $step.result)+'</td><td>'+(ConvertTo-StandardHtmlText $step.failure)+'</td></tr>')};Add-Html $body ('</tbody></table><h2>'+$validationSection+'. 共性验证与范围说明</h2><ul>')
    foreach($note in @($Facts.constraints.validationNotes)){Add-Html $body ('<li>'+(ConvertTo-StandardHtmlText $note)+'。验证失败时不发布部分写入结果，并保留可诊断的业务状态。</li>')};foreach($claim in @($Facts.constraints.unsupportedClaims)){Add-Html $body ('<li>'+(ConvertTo-StandardHtmlText $claim)+'，因此本功能表不列出相关菜单、输入或处理结果。</li>')};Add-Html $body '</ul><p class="footer-note">功能名称和岗位名称均取自已验证运行事实。正式申报主体仍由申请人填写。</p></section>'
    return Complete-DocumentHtml $Facts 'feature-table' '软件功能表' $body $OutputPath
}

function Render-StandardRuntimeHtml {
    [CmdletBinding()]param([Parameter(Mandatory)]$Facts,[string]$OutputPath)
    Assert-RenderingFacts $Facts;$body=[Text.StringBuilder]::new();Add-Html $body (New-CoverHtml $Facts '运行环境说明')
    Add-Html $body ('<h1>运行环境说明</h1><p class="document-note">本文档描述 '+(ConvertTo-StandardHtmlText $Facts.software.name)+' 的安装目标、桌面运行时、本地数据、备份恢复、离线边界、构建版本及卸载后的数据处理原则。内容来自项目锁、数据库事实和已验证维护能力。</p>')
    Add-Html $body '<h2>一、安装准备</h2><p>软件面向 Windows x64 桌面环境交付，采用当前用户安装方式。安装前应确认当前 Windows 用户对自己的应用数据目录具有正常读写权限，并预留程序文件、数据库及备份快照所需空间。软件包含所需桌面运行时，不要求用户单独安装 Node.js、SQLite 服务或浏览器。</p><p>安装包启动后按向导完成部署。首次启动时，程序读取随包发布并经过摘要校验的蓝图、领域版本锁、种子数据和运行目录清单，随后在当前用户范围内创建数据库。若资源摘要、插件版本或数据库迁移不一致，程序停止启动，避免在不确定结构上继续运行。</p>'
    Add-Html $body '<h2>二、运行时组成</h2><table><thead><tr><th>项目</th><th>已验证值</th><th>作用</th></tr></thead><tbody>'
    foreach($row in @(@('目标平台',$Facts.runtime.platform,'承载离线桌面程序和本地用户数据'),@('桌面运行时',$Facts.runtime.desktop,'提供主进程、预加载接口和业务服务'),@('Electron',$Facts.runtime.electron,'封装桌面窗口与隔离渲染环境'),@('Node.js',$Facts.runtime.node,'执行本地服务、摘要校验和数据库访问'),@('SQLite',$Facts.runtime.sqlite,'保存业务记录、审计事件和迁移版本'),@('数据库结构版本',$Facts.runtime.databaseSchemaVersion,'约束当前程序可读取的数据结构'))){Add-Html $body ('<tr><td>'+(ConvertTo-StandardHtmlText $row[0])+'</td><td>'+(ConvertTo-StandardHtmlText $row[1])+'</td><td>'+(ConvertTo-StandardHtmlText $row[2])+'</td></tr>')};Add-Html $body '</tbody></table><p>渲染界面启用上下文隔离并关闭直接 Node.js 访问，只能通过预加载层公开的固定业务接口发起请求。主进程负责会话、权限、领域命令、事务、审计和备份，因而界面显示与数据库写入之间具有清晰边界。</p>'
    Add-Html $body ('<h2>三、本地数据</h2><p>'+(ConvertTo-StandardHtmlText $Facts.runtime.dataPolicy)+'。数据库引擎为 SQLite，当前结构版本为 '+(ConvertTo-StandardHtmlText $Facts.runtime.databaseSchemaVersion)+'，迁移后共有 '+$Facts.database.tables.Count+' 张业务及系统表。数据库不要求独立服务进程，也不会把业务数据自动发送到互联网。</p><table><thead><tr><th>数据类别</th><th>保存内容</th><th>控制方式</th></tr></thead><tbody><tr><td>业务数据</td><td>核心模块的登记信息、状态、版本和关联关系</td><td>字段校验、外键关系、乐观版本和事务</td></tr><tr><td>身份与会话</td><td>本地用户、密码摘要、角色及有效会话</td><td>随机盐摘要、失败锁定和主进程授权</td></tr><tr><td>审计与事件</td><td>关键动作、流程变化、执行结果和操作岗位</td><td>仅追加记录，不向普通界面提供改写入口</td></tr><tr><td>备份清单</td><td>快照文件名、摘要、结构版本和创建信息</td><td>恢复前核对应用、版本及文件摘要</td></tr></tbody></table>')
    Add-Html $body ('<h2>四、备份与恢复</h2><p>'+(ConvertTo-StandardHtmlText $Facts.runtime.backupPolicy)+'。创建备份时，系统生成独立数据库快照和清单摘要，避免直接复制正在写入的数据库。恢复时先检查备份所属应用、数据库结构版本和文件摘要，并要求用户明确确认；替换后若数据库不能重新打开，程序保留原数据库并报告失败。</p><p>备份文件应由申请人按照单位制度保存到受控介质。软件不会自动上传备份，也不会在未确认的情况下覆盖现有数据库。恢复操作完成后应重新登录并抽查关键模块、业务状态和审计记录。</p>')
    Add-Html $body '<h2>五、离线边界</h2><p>当前版本按离线桌面方式运行，核心流程、角色权限、SQLite 事务、查询、审计、备份与恢复均在本机完成。软件不依赖互联网连接，不声明云同步、在线协作、短信推送或第三方平台接口。断网不会影响已实现的本地业务操作，但外部文件传递、异地备份和申报提交仍由用户在软件边界之外完成。</p><ul>'
    foreach($boundary in @($Facts.software.boundaries)){Add-Html $body ('<li>'+(ConvertTo-StandardHtmlText $boundary)+'</li>')};foreach($claim in @($Facts.constraints.unsupportedClaims)){Add-Html $body ('<li>'+(ConvertTo-StandardHtmlText $claim)+'</li>')};Add-Html $body '</ul>'
    Add-Html $body ('<h2>六、构建版本</h2><table><thead><tr><th>构建项目</th><th>事实值</th></tr></thead><tbody><tr><td>软件版本</td><td>V'+(ConvertTo-StandardHtmlText $Facts.software.version)+'</td></tr><tr><td>桌面运行时版本</td><td>'+(ConvertTo-StandardHtmlText $Facts.runtime.desktop)+'</td></tr><tr><td>Electron 版本</td><td>'+(ConvertTo-StandardHtmlText $Facts.runtime.electron)+'</td></tr><tr><td>Node.js 版本</td><td>'+(ConvertTo-StandardHtmlText $Facts.runtime.node)+'</td></tr><tr><td>SQLite 版本</td><td>'+(ConvertTo-StandardHtmlText $Facts.runtime.sqlite)+'</td></tr><tr><td>构建目标</td><td>Windows x64 当前用户安装包</td></tr><tr><td>事实基准日期</td><td>'+(ConvertTo-StandardHtmlText $Facts.software.buildDate)+'</td></tr></tbody></table><p>版本值取自锁定项目资源。材料生成、安装包验证和业务验收均应引用同一资源摘要，若重新构建导致摘要变化，应重新执行相应验证，旧回执不能继续使用。</p>')
    Add-Html $body '<h2>七、启动与退出</h2><p>安装完成后从开始菜单或安装目录启动软件。启动阶段依次验证资源、加载插件、执行数据库迁移并打开登录界面。用户使用分配的本地账号登录后，仅能看到权限允许的模块和操作。正常退出可使用界面右上角的退出登录按钮结束会话，再关闭桌面窗口；关闭窗口不会删除数据库。</p><p>若启动失败，应先保留生成日志和工作区，核对资源摘要、数据库版本和本机文件权限。不得通过手工修改数据库或替换锁文件绕过校验。</p>'
    Add-Html $body '<h2>八、卸载与数据保留</h2><p>卸载操作移除程序文件，但业务数据是否保留应按交付版本的当前用户数据策略和申请人制度处理。正式卸载前应由系统管理员创建并验证备份，记录备份位置和摘要。需要彻底移除数据时，应在确认备份可恢复且符合单位留存要求后，由有权限的人员处理当前用户应用数据目录。</p><p>重新安装同版本软件后，如需恢复历史数据，应使用软件内的恢复入口并通过应用标识、结构版本和摘要校验。不同项目、不同软件版本或来源不明的数据库不得直接替换当前数据库。</p><p class="footer-note">本说明不包含申请人设备型号或性能承诺。申请人应结合实际终端配置填写正式申报材料。</p>'
    return Complete-DocumentHtml $Facts 'runtime' '运行环境说明' $body $OutputPath
}

function Get-ManualCapturePresentation($Capture,$CommandMap,$ModuleMap,$WorkflowStepMap,[int]$Ordinal){
    $actionId=[string]$Capture.actionId;$workflowStepId=[string]$Capture.workflowStepId;$moduleId=[string]$Capture.moduleId
    if(-not[string]::IsNullOrWhiteSpace($actionId)-and$CommandMap.ContainsKey($actionId)){
        $label=[string]$CommandMap[$actionId].label
        return [pscustomobject]@{caption=($label+'操作界面');alt=($label+'操作截图')}
    }
    if(-not[string]::IsNullOrWhiteSpace($workflowStepId)-and$WorkflowStepMap.ContainsKey($workflowStepId)){
        $label=[string]$WorkflowStepMap[$workflowStepId].label
        return [pscustomobject]@{caption=($label+'处理界面');alt=($label+'处理截图')}
    }
    if(-not[string]::IsNullOrWhiteSpace($moduleId)-and$ModuleMap.ContainsKey($moduleId)){
        $label=[string]$ModuleMap[$moduleId].name
        return [pscustomobject]@{caption=($label+'业务界面');alt=($label+'界面截图')}
    }
    $commonLabels=@('用户登录界面','业务总览界面','窄屏导航界面','系统维护界面')
    $common=$commonLabels[($Ordinal-1)%$commonLabels.Count]
    return [pscustomobject]@{caption=$common;alt=($common+'截图')}
}

function Add-ManualFigure($Body,$Capture,$Presentation){
    $source='screenshots/'+[uri]::EscapeDataString([string]$Capture.fileName)
    Add-Html $Body ('<figure><img src="'+(ConvertTo-StandardHtmlText $source)+'" alt="'+(ConvertTo-StandardHtmlText $Presentation.alt)+'"><figcaption>'+(ConvertTo-StandardHtmlText $Presentation.caption)+'</figcaption></figure>')
}

function Get-VerifiedManualCaptures($Facts,[string]$ScreenshotRoot){
    if([string]::IsNullOrWhiteSpace($ScreenshotRoot)-or-not[IO.Path]::IsPathRooted($ScreenshotRoot)){throw 'Screenshot root must be an absolute directory.'}
    $root=[IO.Path]::GetFullPath($ScreenshotRoot)
    if(-not(Test-Path -LiteralPath $root -PathType Container)){throw 'Screenshot root does not exist.'}
    $rootItem=Get-Item -LiteralPath $root -Force
    if(($rootItem.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0){throw 'Screenshot root cannot be a reparse point.'}
    $captures=@($Facts.screenshots.captures)
    if($captures.Count-lt12-or$captures.Count-gt18){throw 'Operation manual requires 12 to 18 screenshot facts.'}
    $seen=@{};$verified=@();$rootPrefix=$root.TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar)+[IO.Path]::DirectorySeparatorChar
    foreach($capture in $captures){
        $fileName=[string]$capture.fileName
        if($fileName-notmatch'^[a-z0-9][a-z0-9_-]*\.png$'-or[IO.Path]::GetFileName($fileName)-ne$fileName){throw 'Screenshot file name is invalid.'}
        if($seen.ContainsKey($fileName)){throw 'Screenshot file names must be unique.'};$seen[$fileName]=$true
        $source=[IO.Path]::GetFullPath((Join-Path $root $fileName))
        if(-not$source.StartsWith($rootPrefix,[StringComparison]::OrdinalIgnoreCase)-or-not(Test-Path -LiteralPath $source -PathType Leaf)){throw 'Screenshot evidence file is missing.'}
        $item=Get-Item -LiteralPath $source -Force
        if(($item.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0){throw 'Screenshot evidence cannot be a reparse point.'}
        $expectedHash=([string]$capture.imageSha256).ToLowerInvariant()
        if($expectedHash-notmatch'^[0-9a-f]{64}$'){throw 'Screenshot evidence hash is invalid.'}
        $verified+=,[pscustomobject]@{capture=$capture;source=$source;expectedHash=$expectedHash}
    }
    return $verified
}

function Render-StandardManualHtml {
    [CmdletBinding()]param(
        [Parameter(Mandatory)]$Facts,
        [Parameter(Mandatory)][string]$ScreenshotRoot,
        [Parameter(Mandatory)][string]$OutputPath
    )
    Assert-RenderingFacts $Facts
    if([string]::IsNullOrWhiteSpace($OutputPath)){throw 'Operation manual output path is required.'}
    $target=[IO.Path]::GetFullPath($OutputPath)
    if(Test-Path -LiteralPath $target){throw 'Refusing to overwrite rendered material.'}
    $parent=Split-Path -Parent $target;$imageTarget=Join-Path $parent 'screenshots'
    if(Test-Path -LiteralPath $imageTarget){throw 'Refusing to overwrite rendered screenshots.'}
    $verified=Get-VerifiedManualCaptures $Facts $ScreenshotRoot
    $commands=Get-CommandMap $Facts;$entities=Get-EntityMap $Facts;$modules=Get-ModuleMap $Facts
    $workflowSteps=@(Get-WorkflowSteps $Facts);$workflowStepMap=@{};foreach($step in $workflowSteps){$workflowStepMap[[string]$step.id]=$step}
    $scenarioIds=@{};$captureStepIds=@{}
    foreach($item in $verified){
        $capture=$item.capture;$scenarioId=[string]$capture.scenarioId;$captureStepId=[string]$capture.stepId;$moduleId=[string]$capture.moduleId;$workflowStepId=[string]$capture.workflowStepId;$actionId=[string]$capture.actionId
        if([string]::IsNullOrWhiteSpace($scenarioId)-or$scenarioIds.ContainsKey($scenarioId)-or[string]::IsNullOrWhiteSpace($captureStepId)-or$captureStepIds.ContainsKey($captureStepId)){throw 'Screenshot scenario and step references must be unique.'}
        $scenarioIds[$scenarioId]=$true;$captureStepIds[$captureStepId]=$true
        if(-not[string]::IsNullOrWhiteSpace($workflowStepId)-and-not$workflowStepMap.ContainsKey($workflowStepId)){throw 'Screenshot evidence contains an unknown workflow reference.'}
        if(-not[string]::IsNullOrWhiteSpace($actionId)-and$commands.ContainsKey($actionId)-and[string]$commands[$actionId].moduleId-ne$moduleId){throw 'Screenshot evidence does not match its workflow or command.'}
        if(-not[string]::IsNullOrWhiteSpace($workflowStepId)){
            $workflowStep=$workflowStepMap[$workflowStepId];$workflowActionId=if($null-ne$workflowStep.PSObject.Properties['actionId']){[string]$workflowStep.actionId}else{''}
            $expectedModuleId=if(-not[string]::IsNullOrWhiteSpace($workflowActionId)){[string]$commands[$workflowActionId].moduleId}else{[string]$workflowStep.moduleId}
            if($moduleId-ne$expectedModuleId-or(-not[string]::IsNullOrWhiteSpace($actionId)-and$actionId-ne$workflowActionId)){throw 'Screenshot evidence does not match its workflow or command.'}
        }
    }
    $presentations=@{};$ordinal=0
    foreach($item in $verified){$ordinal++;$presentations[[string]$item.capture.fileName]=Get-ManualCapturePresentation $item.capture $commands $modules $workflowStepMap $ordinal}

    $body=[Text.StringBuilder]::new();Add-Html $body (New-CoverHtml $Facts '操作手册')
    Add-Html $body ('<h1>操作手册</h1><p class="document-note">本手册用于指导已授权用户安装、登录并操作 '+(ConvertTo-StandardHtmlText $Facts.software.name)+'。章节中的模块、岗位、字段、业务动作、流程结果和截图均来自同一份已验证事实；截图文件在发布前按摘要逐一核对。手册只说明当前版本已经验证的离线能力。</p>')
    Add-Html $body ('<h2>一、安装与首次启动</h2><p>本软件适用于 '+(ConvertTo-StandardHtmlText $Facts.runtime.platform)+'，交付方式为'+(ConvertTo-StandardHtmlText $Facts.runtime.installationMode)+'。运行安装包后按安装向导完成部署，程序已包含 Electron、Node.js 和 SQLite 所需运行组件，普通业务用户不需要另行安装数据库服务。安装前应确认当前 Windows 用户对其应用数据目录具有读写权限，并为程序、业务数据库和备份快照保留足够空间。</p><p>首次启动时，程序会校验随包发布的项目资源和版本锁，加载领域模块，执行结构版本 '+(ConvertTo-StandardHtmlText $Facts.runtime.databaseSchemaVersion)+' 对应的数据库迁移，然后显示登录界面。若资源摘要、模块版本或数据库结构不一致，启动将停止；此时应保留现场并联系交付人员核对安装包，不应手工替换锁文件或直接修改数据库。</p>')
    Add-Html $body '<h2>二、登录</h2><p>启动完成后，在登录界面输入交付时分配的本地账号和密码并提交。登录成功后，会话只开放该账号角色已获授权的模块与操作；登录失败时应先核对账号、密码和输入法，不要连续尝试未知凭据。手册和截图不记录任何明文密码。</p><p>完成工作后，应使用界面中的退出登录入口结束当前会话，再关闭桌面窗口。关闭窗口不会删除业务数据库；再次启动仍需使用有效本地账号登录。</p>'
    $commonCaptures=@($verified|Where-Object{[string]::IsNullOrWhiteSpace([string]$_.capture.moduleId)})
    foreach($item in $commonCaptures){Add-ManualFigure $body $item.capture $presentations[[string]$item.capture.fileName]}

    Add-Html $body '<h2>三、角色与权限</h2><p>权限由登录身份和后台角色共同决定。界面是否显示按钮只是操作提示，真正的授权判断在主进程中执行；因此用户不能通过修改界面参数扩大权限。各岗位经验证的职责如下：</p><table><thead><tr><th>岗位</th><th>可执行操作</th><th>使用要求</th></tr></thead><tbody>'
    foreach($role in @($Facts.roles)){$labels=@($role.visibleOperations|ForEach-Object{Get-CommandLabel $commands ([string]$_)}|Where-Object{$_});$operations=if($labels.Count){$labels-join '、'}else{'查看授权范围内的信息并承担复核职责'};Add-Html $body ('<tr><td>'+(ConvertTo-StandardHtmlText $role.name)+'</td><td>'+(ConvertTo-StandardHtmlText $operations)+'</td><td>仅在本人职责和当前记录状态允许时操作；无权操作由系统拒绝并保持原数据不变。</td></tr>')}
    Add-Html $body '</tbody></table><p>多人轮流使用同一终端时，前一位用户必须先退出登录。涉及复核、关闭或恢复数据的操作，应由对应岗位在核对业务记录后执行，不应借用其他账号代办。</p>'

    Add-Html $body '<h2>四、导航与共用操作</h2><p>登录后的主界面由模块导航、列表区域、详情区域和业务操作区组成。先从导航中选择业务模块，再通过列表定位记录；选中记录后可查看详情，并在当前状态和岗位权限允许时打开操作表单。列表与详情来自同一持久化数据，完成操作后应刷新或重新选择记录，核对状态、版本和结果字段是否已经更新。</p><h3>4.1 查询与查看</h3><ol><li>进入目标模块，等待列表加载完成。</li><li>使用界面提供的关键词或筛选条件缩小范围。</li><li>选择目标记录并核对编号、名称、状态及关联对象。</li><li>需要继续处理时，在详情区域选择已授权操作；只需查看时不要提交表单。</li></ol><h3>4.2 表单与结果反馈</h3><p>带必填标记的字段应完整填写，日期、数量、选项和关联记录必须符合界面要求。提交后以系统返回的成功结果和持久化状态为准。若出现必填、格式、权限、状态或版本错误，系统不会把未完成的变更当作成功结果；用户应按提示修正输入，或重新加载最新记录后再决定是否操作。</p>'

    Add-Html $body '<section class="page-break-before"><h2>五、核心业务模块</h2><p>以下内容按已交付模块逐一说明业务对象、字段和操作方法。每项领域操作均给出前置条件、编号步骤、预期结果和失败行为，不能用通用新增、修改按钮替代明确的状态转换。</p>'
    $moduleIndex=0
    foreach($module in @($Facts.modules)){
        $moduleIndex++;$entity=$entities[[string]$module.entityId]
        $fieldNames=@($entity.fields|ForEach-Object{[string]$_.name})-join '、'
        Add-Html $body ('<h3>5.'+$moduleIndex+' '+(ConvertTo-StandardHtmlText $module.name)+'</h3><p><strong>模块职责：</strong>'+(ConvertTo-StandardHtmlText $module.purpose)+'。该模块以'+(ConvertTo-StandardHtmlText $entity.name)+'为主要业务对象，界面呈现'+(ConvertTo-StandardHtmlText $fieldNames)+'等信息。记录采用'+(ConvertTo-StandardHtmlText (Get-RetentionLabel ([string]$entity.retention)))+'策略；'+$(if($entity.history){'关键处理保留历史或事件信息。'}else{'当前有效内容由审计事件补充追踪。'})+'</p>')
        $moduleCommands=@($module.operations|ForEach-Object{$commands[[string]$_]}|Where-Object{$null-ne$_})
        if($moduleCommands.Count-eq0){Add-Html $body ('<p><strong>查看方法：</strong>进入'+(ConvertTo-StandardHtmlText $module.name)+'，通过列表选择'+(ConvertTo-StandardHtmlText $entity.name)+'，再核对详情字段。若没有查看权限或记录不存在，系统不展示受保护内容。</p>')}
        foreach($command in $moduleCommands){
            $inputs=@($command.inputLabels);$inputText=if($inputs.Count){$inputs-join '、'}else{'当前记录及登录岗位信息'}
            Add-Html $body ('<div class="keep-together"><p><strong>'+(ConvertTo-StandardHtmlText $command.label)+'</strong></p><p><strong>前置条件：</strong>'+(ConvertTo-StandardHtmlText $command.precondition)+'。执行岗位：'+(ConvertTo-StandardHtmlText (Get-RoleNamesForCommand $Facts ([string]$command.id)))+'。</p><ol><li>进入'+(ConvertTo-StandardHtmlText $module.name)+'并定位需要处理的'+(ConvertTo-StandardHtmlText $entity.name)+'。</li><li>核对当前状态、版本和关联信息，打开“'+(ConvertTo-StandardHtmlText $command.label)+'”操作。</li><li>按界面要求确认或填写'+(ConvertTo-StandardHtmlText $inputText)+'，检查无误后提交。</li><li>返回列表或详情，重新核对状态和处理结果。</li></ol><p><strong>预期结果：</strong>'+(ConvertTo-StandardHtmlText $command.result)+'。</p><p><strong>失败行为：</strong>'+(ConvertTo-StandardHtmlText $command.failure)+'。发生失败时不要把按钮点击视为完成，应保持原记录并根据提示修正。</p></div>')
        }
        foreach($item in @($verified|Where-Object{[string]$_.capture.moduleId-eq[string]$module.id})){Add-ManualFigure $body $item.capture $presentations[[string]$item.capture.fileName]}
    }
    $coreModuleIds=@($Facts.modules|ForEach-Object{[string]$_.id});$auxiliaryCaptures=@($verified|Where-Object{-not[string]::IsNullOrWhiteSpace([string]$_.capture.moduleId)-and$coreModuleIds-cnotcontains[string]$_.capture.moduleId})
    if($auxiliaryCaptures.Count){Add-Html $body ('<h3>5.'+($moduleIndex+1)+' 辅助页面与维护界面</h3><p>以下截图展示主流程使用的辅助表单、维护入口或窄屏导航。它们已经由运行蓝图和截图证据验证，但不作为独立核心业务模块扩展功能范围。</p>');foreach($item in $auxiliaryCaptures){Add-ManualFigure $body $item.capture $presentations[[string]$item.capture.fileName]}}
    Add-Html $body '</section>'

    Add-Html $body '<section class="page-break-before"><h2>六、完整业务流程</h2><p>下列编号流程是本版本经验证的主业务链路。应从第一步开始按实际状态推进；若某一步失败，先处理该步原因，不要跳过状态或直接修改数据库。流程截图在前述模块章节中按其所属环节展示。</p><ol class="workflow-steps">'
    $stepIndex=0
    foreach($step in $workflowSteps){
        $stepIndex++;$stepActionId=if($null-ne$step.PSObject.Properties['actionId']){[string]$step.actionId}else{''};$actionLabel=if(-not[string]::IsNullOrWhiteSpace($stepActionId)){Get-CommandLabel $commands $stepActionId}else{[string]$step.label}
        $related=@($verified|Where-Object{[string]$_.capture.workflowStepId-eq[string]$step.id}|ForEach-Object{[string]$presentations[[string]$_.capture.fileName].caption}|Sort-Object -Unique)
        $evidence=if($related.Count){'对应截图：'+($related-join '、')+'。'}else{'该环节通过相邻业务记录和状态结果进行核对。'}
        Add-Html $body ('<li><h3>步骤 '+$stepIndex+'：'+(ConvertTo-StandardHtmlText $step.label)+'</h3><p><strong>前置条件：</strong>'+(ConvertTo-StandardHtmlText $step.prerequisite)+'。</p><ol><li>进入承担该环节的业务模块，定位当前待处理记录。</li><li>核对记录状态、关联对象及当前岗位权限。</li><li>执行“'+(ConvertTo-StandardHtmlText $actionLabel)+'”，按界面要求填写或确认信息后提交。</li><li>重新加载记录，并与预期结果逐项核对。</li></ol><p><strong>预期结果：</strong>'+(ConvertTo-StandardHtmlText $step.result)+'。</p><p><strong>失败行为：</strong>'+(ConvertTo-StandardHtmlText $step.failure)+'。若失败，应保留原状态，检查输入、权限、业务状态和记录版本后再处理。</p><p>'+(ConvertTo-StandardHtmlText $evidence)+'</p></li>')
    }
    Add-Html $body '</ol></section>'

    Add-Html $body ('<section class="page-break-before"><h2>七、备份与恢复</h2><p>'+(ConvertTo-StandardHtmlText $Facts.runtime.backupPolicy)+'。执行前应由系统管理员确认当前业务操作已经结束，并记录备份用途。创建备份后，应在维护界面核对快照时间、数据库结构版本和摘要信息；不得把正在写入的数据库文件当作已验证备份。</p><h3>7.1 创建备份</h3><ol><li>使用系统管理员账号登录，进入数据与备份相关维护模块。</li><li>确认没有正在提交的业务表单，选择创建备份。</li><li>等待系统生成数据库快照及清单，并核对成功反馈。</li><li>按单位制度将备份保存到受控介质，记录保管位置。</li></ol><h3>7.2 恢复数据</h3><ol><li>确认待恢复快照属于本软件，并核对应用标识、结构版本和文件摘要。</li><li>在维护入口选择恢复并阅读确认信息。</li><li>明确确认后执行恢复，等待数据库重新打开。</li><li>重新登录，抽查核心模块、流程状态和审计信息。</li></ol><p>快照校验不通过、结构版本不兼容或数据库不能重新打开时，恢复必须停止并保留原数据库。软件不会自动把备份上传到网络，也不应使用来源不明的数据库文件替换当前数据。</p></section>')

    Add-Html $body '<h2>八、常见问题与处理</h2><table><thead><tr><th>现象</th><th>核对内容</th><th>处理方法</th></tr></thead><tbody><tr><td>无法启动或停在资源检查</td><td>安装包完整性、当前用户目录权限、资源与版本锁</td><td>保留现场并重新使用已验证安装包；不要修改锁文件绕过校验。</td></tr><tr><td>无法登录</td><td>本地账号、密码输入、账号当前状态</td><td>核对交付账号和输入法；未知凭据不要反复尝试，由系统管理员按既定账号管理流程处理。</td></tr><tr><td>看不到模块或操作</td><td>当前登录岗位、模块权限、记录状态</td><td>先确认是否登录了正确账号；无权操作应由对应岗位完成，不借用账号。</td></tr><tr><td>表单无法提交</td><td>必填字段、日期和数量格式、关联记录、当前状态</td><td>按界面提示修正输入；提交失败时原数据保持不变。</td></tr><tr><td>提示状态或版本冲突</td><td>记录是否已被其他步骤更新</td><td>重新加载最新记录，核对当前状态后重新决定操作，不使用旧页面重复提交。</td></tr><tr><td>备份或恢复失败</td><td>快照摘要、应用标识、结构版本、文件权限</td><td>停止恢复并保留原数据库，改用经校验且与当前软件匹配的快照。</td></tr></tbody></table><p>若问题无法按上述方法处理，应记录发生时间、登录岗位、模块、操作名称和界面提示。诊断信息不得包含明文密码；也不要通过直接编辑 SQLite 数据库来伪造成功状态。</p>'

    Add-Html $body ('<h2>九、卸载与数据保留</h2><p>'+(ConvertTo-StandardHtmlText $Facts.runtime.dataPolicy)+'。卸载程序前，应由系统管理员创建并验证最新备份，确认单位的数据留存要求和后续恢复安排。卸载操作以移除程序文件为目的，不能据此推定业务数据已经销毁；当前用户应用数据目录中的数据库和备份应由有权限人员按制度单独处理。</p><p>需要继续保留历史业务时，应妥善保存已验证快照及其摘要。重新安装同一软件后，如需恢复数据，应从软件内的恢复入口执行并通过应用标识、数据库结构版本和摘要校验。需要彻底清理时，必须先确认备份可用、留存期限已经满足，再由授权人员处理本地数据，避免误删不可恢复的业务记录。</p><h3>9.1 数据留存原则</h3><ul>')
    foreach($entity in @($Facts.entities)){Add-Html $body ('<li><strong>'+(ConvertTo-StandardHtmlText $entity.name)+'：</strong>'+(ConvertTo-StandardHtmlText (Get-RetentionLabel ([string]$entity.retention)))+'；'+$(if($entity.history){'相关历史或事件信息应随业务数据一并备份和留存。'}else{'当前有效记录应按申请人制度确定留存期限。'})+'</li>')}
    Add-Html $body '</ul><p class="footer-note">本手册不声明事实清单之外的联网、导出或密码变更能力。申请人应结合本单位账号、终端和介质管理制度使用软件。</p>'

    if(-not(Test-Path -LiteralPath $parent)){New-Item -ItemType Directory -Path $parent -Force|Out-Null}
    $stage=Join-Path $parent ('.m-'+[guid]::NewGuid().ToString('N').Substring(0,16));$stageImages=Join-Path $stage 'screenshots';$stageHtml=Join-Path $stage ([IO.Path]::GetFileName($target));$imagesPublished=$false
    try{
        New-Item -ItemType Directory -Path $stageImages -Force|Out-Null
        foreach($item in $verified){
            $stagedImage=Join-Path $stageImages ([string]$item.capture.fileName)
            Copy-Item -LiteralPath $item.source -Destination $stagedImage
            $stagedHash=(Get-FileHash -LiteralPath $stagedImage -Algorithm SHA256).Hash.ToLowerInvariant()
            if($stagedHash-ne[string]$item.expectedHash){throw 'Screenshot evidence hash mismatch.'}
        }
        $html=Complete-DocumentHtml $Facts 'manual' '操作手册' $body $stageHtml
        Move-Item -LiteralPath $stageImages -Destination $imageTarget;$imagesPublished=$true
        Move-Item -LiteralPath $stageHtml -Destination $target
        return $html
    }
    catch{
        if($imagesPublished-and(Test-Path -LiteralPath $imageTarget)){Remove-Item -LiteralPath $imageTarget -Recurse -Force}
        if(Test-Path -LiteralPath $target){Remove-Item -LiteralPath $target -Force}
        throw
    }
    finally{if(Test-Path -LiteralPath $stage){Remove-Item -LiteralPath $stage -Recurse -Force}}
}

function Get-StandardDiagramDefinitions {
    return @([pscustomobject]@{id='navigation';fileName='navigation.png';width=1400;height=900;title='导航层级图'},[pscustomobject]@{id='interface';fileName='interface.png';width=1400;height=900;title='列表、详情与表单线框图'},[pscustomobject]@{id='roles';fileName='roles.png';width=1400;height=900;title='角色操作矩阵图'},[pscustomobject]@{id='workflow';fileName='workflow.png';width=1600;height=900;title='业务流程图'},[pscustomobject]@{id='relationships';fileName='relationships.png';width=1600;height=1000;title='实体关系概览图'})
}
function Assert-StandardDiagramRoot([string]$DiagramRoot){
    if([string]::IsNullOrWhiteSpace($DiagramRoot)-or-not[IO.Path]::IsPathRooted($DiagramRoot)){throw 'Diagram root must be an absolute directory.'}
    $root=[IO.Path]::GetFullPath($DiagramRoot);if(-not(Test-Path -LiteralPath $root -PathType Container)){throw 'Diagram root does not exist.'}
    $rootItem=Get-Item -LiteralPath $root -Force;if(($rootItem.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0){throw 'Diagram root cannot be a reparse point.'}
    Add-Type -AssemblyName System.Drawing
    foreach($definition in Get-StandardDiagramDefinitions){$path=Join-Path $root $definition.fileName;if(-not(Test-Path -LiteralPath $path -PathType Leaf)){throw 'A required standard diagram is missing.'};$item=Get-Item -LiteralPath $path -Force;if(($item.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0){throw 'Standard diagrams cannot be reparse points.'};$bitmap=[Drawing.Bitmap]::new($path);try{if($bitmap.Width-ne$definition.width-or$bitmap.Height-ne$definition.height){throw 'Standard diagram dimensions are invalid.'}}finally{$bitmap.Dispose()}}
    return $root
}
function Assert-StandardDiagramDocumentBinding([string]$DiagramRoot,[string]$OutputPath){
    if([string]::IsNullOrWhiteSpace($OutputPath)){return}
    $expected=[IO.Path]::GetFullPath((Join-Path (Split-Path -Parent ([IO.Path]::GetFullPath($OutputPath))) 'diagrams'))
    if(-not$DiagramRoot.Equals($expected,[StringComparison]::OrdinalIgnoreCase)){throw 'Diagram root must be the diagrams directory beside the rendered document.'}
}
function Add-StandardDiagramFigure($Body,[string]$Id,[string]$Caption){
    $definition=@(Get-StandardDiagramDefinitions|Where-Object id -eq $Id)[0]
    Add-Html $Body ('<figure><img src="diagrams/'+(ConvertTo-StandardHtmlText $definition.fileName)+'" alt="'+(ConvertTo-StandardHtmlText $definition.title)+'"><figcaption>'+(ConvertTo-StandardHtmlText $Caption)+'</figcaption></figure>')
}
function Get-CoreEntityFacts($Facts){return @($Facts.entities|Where-Object{$_.isCore})}
function Get-SelectedDatabaseTables($Facts){$selected=@($Facts.entities|ForEach-Object{[string]$_.id});return @($Facts.database.tables|Where-Object{$_.kind-eq'system'-or$selected-contains[string]$_.entityId})}

function Render-StandardPrototypeHtml {
    [CmdletBinding()]param([Parameter(Mandatory)]$Facts,[Parameter(Mandatory)][string]$DiagramRoot,[string]$OutputPath)
    Assert-RenderingFacts $Facts;$validatedDiagramRoot=Assert-StandardDiagramRoot $DiagramRoot;Assert-StandardDiagramDocumentBinding $validatedDiagramRoot $OutputPath;$commands=Get-CommandMap $Facts;$entities=Get-EntityMap $Facts;$body=[Text.StringBuilder]::new();Add-Html $body (New-CoverHtml $Facts '原型设计图')
    Add-Html $body ('<h1>原型设计图</h1><p class="document-note">本文档依据 '+(ConvertTo-StandardHtmlText $Facts.software.name)+' 的已验证模块、岗位、领域操作、工作流程和核心实体生成。五张图分别说明导航、列表详情表单、角色操作、业务流程和实体关系，不使用普通运行截图代替结构设计。</p><h2>一、设计目标与范围</h2><p>原型以离线桌面业务软件为对象，界面结构服务于可重复的日常登记、处理、复核和归档。用户从登录后的业务导航进入授权模块，通过列表定位记录，在详情中核对字段与状态，再使用明确的领域操作推进流程。界面只负责呈现和采集输入，权限、状态、版本、事务与持久化结果由可信运行边界校验。</p><p>本设计覆盖当前事实中 '+@($Facts.modules).Count+' 个业务模块、'+@(Get-CoreEntityFacts $Facts).Count+' 个核心实体、'+@($Facts.roles).Count+' 个组合岗位和 '+@($Facts.commands).Count+' 项可见业务操作。图中不扩展未锁定模块、在线服务、云同步或外部接口。</p>')
    Add-Html $body '<section class="page-break-before"><h2>二、导航层级</h2><p>导航采用“业务模块、记录列表、记录详情、领域操作”的稳定层级。模块入口按当前登录岗位过滤，列表和详情共享同一持久化记录，操作区只显示当前状态允许且岗位有权执行的动作。用户完成操作后返回详情核对状态，再继续后续环节。</p><table><thead><tr><th>模块</th><th>业务对象</th><th>模块职责</th><th>主要操作</th></tr></thead><tbody>'
    foreach($module in @($Facts.modules)){$entity=$entities[[string]$module.entityId];$labels=@($module.operations|ForEach-Object{Get-CommandLabel $commands ([string]$_)}|Where-Object{$_});Add-Html $body ('<tr><td>'+(ConvertTo-StandardHtmlText $module.name)+'</td><td>'+(ConvertTo-StandardHtmlText $entity.name)+'</td><td>'+(ConvertTo-StandardHtmlText $module.purpose)+'</td><td>'+(ConvertTo-StandardHtmlText ($(if($labels.Count){$labels-join '、'}else{'查询与查看'})))+'</td></tr>')}
    Add-Html $body '</tbody></table>';Add-StandardDiagramFigure $body 'navigation' '图 1 导航层级：从授权模块进入列表、详情和领域操作。';Add-Html $body '</section>'
    Add-Html $body '<section class="page-break-before"><h2>三、列表、详情与表单</h2><p>代表性业务页面采用左侧或主区域列表、记录详情和动作表单的组合。列表用于查询、筛选、排序、分页和选择；详情呈现当前记录字段、状态、版本及关联信息；表单根据具体领域动作收集输入。提交失败时保留原记录，成功后刷新详情，避免把按钮点击误认为业务完成。</p>'
    foreach($entity in Get-CoreEntityFacts $Facts){$required=@($entity.fields|Where-Object{$_.required}|ForEach-Object{[string]$_.name});$optional=@($entity.fields|Where-Object{-not$_.required}|ForEach-Object{[string]$_.name});Add-Html $body ('<h3>'+(ConvertTo-StandardHtmlText $entity.name)+'</h3><p>该页面组展示 '+(ConvertTo-StandardHtmlText (@($entity.fields|ForEach-Object{[string]$_.name})-join '、'))+'。必填信息包括 '+(ConvertTo-StandardHtmlText ($(if($required.Count){$required-join '、'}else{'无额外必填主题字段'})))+'；'+$(if($optional.Count){'可选信息包括 '+(ConvertTo-StandardHtmlText ($optional-join '、'))+'。'}else{'其余处理信息由系统状态或关联记录确定。'})+'列表选择、详情查看和表单提交围绕同一实体标识执行。</p>')}
    Add-StandardDiagramFigure $body 'interface' '图 2 列表、详情与表单：以代表性核心实体说明页面结构。';Add-Html $body '</section>'
    Add-Html $body '<section class="page-break-before"><h2>四、角色操作矩阵</h2><p>组合岗位决定用户可见模块和可执行操作。前端矩阵用于解释职责，不替代主进程权限判断；任何请求均以当前会话身份、动作权限和记录状态重新校验。</p><table><thead><tr><th>岗位</th><th>已验证操作</th><th>交互约束</th></tr></thead><tbody>'
    foreach($role in @($Facts.roles)){$labels=@($role.visibleOperations|ForEach-Object{Get-CommandLabel $commands ([string]$_)}|Where-Object{$_});Add-Html $body ('<tr><td>'+(ConvertTo-StandardHtmlText $role.name)+'</td><td>'+(ConvertTo-StandardHtmlText ($(if($labels.Count){$labels-join '、'}else{'查看授权信息并承担复核职责'})))+'</td><td>操作入口随权限与状态呈现，服务端再次校验后才允许写入。</td></tr>')}
    Add-Html $body '</tbody></table>';Add-StandardDiagramFigure $body 'roles' '图 3 角色操作矩阵：岗位与已验证业务动作的对应关系。';Add-Html $body '</section>'
    Add-Html $body '<section class="page-break-before"><h2>五、业务流程</h2><p>主流程按编号连接多个模块和实体。每一步从前置状态开始，经授权操作产生可核对结果；输入、权限、状态或版本不符合要求时停止该步，不发布部分成功结果。</p><ol>'
    $stepIndex=0;foreach($step in Get-WorkflowSteps $Facts){$stepIndex++;Add-Html $body ('<li><strong>步骤 '+$stepIndex+'：'+(ConvertTo-StandardHtmlText $step.label)+'</strong><br>前置条件：'+(ConvertTo-StandardHtmlText $step.prerequisite)+'；预期结果：'+(ConvertTo-StandardHtmlText $step.result)+'；失败行为：'+(ConvertTo-StandardHtmlText $step.failure)+'。</li>')};Add-Html $body '</ol>';Add-StandardDiagramFigure $body 'workflow' '图 4 业务流程：展示主要业务环节及其先后关系。';Add-Html $body '</section>'
    Add-Html $body '<section class="page-break-before"><h2>六、实体关系</h2><p>实体关系图只展示本次材料范围内的核心业务实体。关系来源于已迁移 SQLite 结构，图外不推断额外业务对象。页面、流程和数据库设计使用同一实体中文名称，便于从界面操作追溯到持久化记录。</p><ul>'
    foreach($entity in Get-CoreEntityFacts $Facts){Add-Html $body ('<li><strong>'+(ConvertTo-StandardHtmlText $entity.name)+'：</strong>包含 '+@($entity.fields).Count+' 个主题字段，采用 '+(ConvertTo-StandardHtmlText (Get-RetentionLabel ([string]$entity.retention)))+'策略；'+$(if($entity.history){'保留历史或事件信息。'}else{'维护当前有效记录。'})+'</li>')};Add-Html $body '</ul>';Add-StandardDiagramFigure $body 'relationships' '图 5 实体关系概览：核心实体及数据库外键形成的已验证关系。';Add-Html $body '<h2>七、交互一致性说明</h2><p>导航入口、列表数据源、详情字段、表单动作、岗位权限、流程步骤和实体关系均由同一事实集合生成。原型图用于说明页面结构和信息层级，不承诺像素级皮肤或未验证交互。实际软件在最小窗口、常规桌面窗口和离线环境中保持相同业务语义。</p><p class="footer-note">本原型不包含事实清单之外的联网协作、批量导出或外部系统集成。</p></section>'
    return Complete-DocumentHtml $Facts 'prototype' '原型设计图' $body $OutputPath
}

function Render-StandardDatabaseHtml {
    [CmdletBinding()]param([Parameter(Mandatory)]$Facts,[Parameter(Mandatory)][string]$DiagramRoot,[string]$OutputPath)
    Assert-RenderingFacts $Facts;$validatedDiagramRoot=Assert-StandardDiagramRoot $DiagramRoot;Assert-StandardDiagramDocumentBinding $validatedDiagramRoot $OutputPath;$entities=Get-EntityMap $Facts;$core=Get-CoreEntityFacts $Facts;$tables=Get-SelectedDatabaseTables $Facts;$allowedTableNames=@($tables|ForEach-Object{[string]$_.name});$body=[Text.StringBuilder]::new();Add-Html $body (New-CoverHtml $Facts '数据库设计说明书')
    Add-Html $body ('<h1>数据库设计说明书</h1><p class="document-note">本文档完全依据已迁移 SQLite 数据库事实生成。所有表名、列名、类型、主键、外键和索引均来自结构版本 '+(ConvertTo-StandardHtmlText $Facts.database.schemaVersion)+' 的编译结果，不根据叙述推测数据库对象。</p><h2>一、数据库目的</h2><p>数据库为 '+(ConvertTo-StandardHtmlText $Facts.software.name)+' 的离线业务流程提供持久化基础，保存核心业务记录、关联关系、状态与版本，以及用户、会话、审计、迁移和备份等系统信息。领域命令在事务边界内检查输入、权限、状态和版本，成功后统一提交，失败时回滚本次变更。</p><h2>二、存储与版本策略</h2><table><thead><tr><th>项目</th><th>事实值</th><th>设计说明</th></tr></thead><tbody><tr><td>数据库引擎</td><td>SQLite '+(ConvertTo-StandardHtmlText $Facts.runtime.sqlite)+'</td><td>随桌面程序在本机运行，不要求独立数据库服务。</td></tr><tr><td>结构版本</td><td>'+(ConvertTo-StandardHtmlText $Facts.database.schemaVersion)+'</td><td>启动时按迁移记录核对，拒绝直接读取更高版本结构。</td></tr><tr><td>数据策略</td><td>'+(ConvertTo-StandardHtmlText $Facts.runtime.dataPolicy)+'</td><td>程序文件与业务数据分离，由当前用户范围内的目录承载。</td></tr><tr><td>离线边界</td><td>'+$(if($Facts.runtime.offline){'离线运行'}else{'按运行事实配置'})+'</td><td>核心业务读写不依赖外部数据库或互联网服务。</td></tr></tbody></table>')
    Add-Html $body '<h2>三、表分类</h2><p>设计文档只展开材料范围内的业务实体；系统表按真实结构列出用途类别。未进入本次材料事实的其他业务表不在下表和数据字典中呈现。</p><table><thead><tr><th>表名</th><th>类别</th><th>关联对象</th><th>列数</th><th>索引数</th></tr></thead><tbody>'
    foreach($table in $tables){$entityName=if(-not[string]::IsNullOrWhiteSpace([string]$table.entityId)-and$entities.ContainsKey([string]$table.entityId)){[string]$entities[[string]$table.entityId].name}else{'系统运行数据'};Add-Html $body ('<tr><td>'+(ConvertTo-StandardHtmlText $table.name)+'</td><td>'+$(if($table.kind-eq'business'){'业务表'}else{'系统表'})+'</td><td>'+(ConvertTo-StandardHtmlText $entityName)+'</td><td>'+@($table.columns).Count+'</td><td>'+@($table.indexes).Count+'</td></tr>')};Add-Html $body '</tbody></table>'
    Add-Html $body '<section class="page-break-before"><h2>四、实体关系</h2><p>关系图以核心业务实体为节点，以真实外键为关系依据。没有外键事实的实体不会被绘制为直接数据库关系；业务流程中的先后顺序与数据库外键是两个不同维度。</p>';Add-StandardDiagramFigure $body 'relationships' '图 1 数据库实体关系：只展示核心业务实体及真实外键关系。';Add-Html $body '</section>'
    Add-Html $body '<h2>五、核心数据字典</h2>'
    $entityIndex=0;foreach($entity in $core){$entityIndex++;$matched=@($Facts.database.tables|Where-Object{[string]$_.entityId-eq[string]$entity.id});if($matched.Count-ne1){throw 'Each core entity must map to exactly one database table.'};$table=$matched[0];$allowedForeignKeys=@($table.foreignKeys|Where-Object{$allowedTableNames-contains[string]$_.targetTable});Add-Html $body ('<section class="page-break-before"><h3>5.'+$entityIndex+' '+(ConvertTo-StandardHtmlText $entity.name)+'（'+(ConvertTo-StandardHtmlText $table.name)+'）</h3><p>'+(ConvertTo-StandardHtmlText $entity.name)+'采用'+(ConvertTo-StandardHtmlText (Get-RetentionLabel ([string]$entity.retention)))+'策略。该表共有 '+@($table.columns).Count+' 列、'+@($table.indexes).Count+' 个已登记索引和 '+$allowedForeignKeys.Count+' 条外键关系。'+$(if(@($table.foreignKeys).Count-gt$allowedForeignKeys.Count){'另有指向材料范围外业务对象的结构关系，本说明不展开其表名与约束。'}else{''})+$(if($entity.history){'实体保留历史或事件信息，关键状态变化可追踪。'}else{'实体维护当前有效记录，关键操作由系统审计补充追踪。'})+'</p><table class="compact"><thead><tr><th>序号</th><th>列名</th><th>SQLite 类型</th><th>非空</th><th>主键</th><th>默认值</th><th>说明</th></tr></thead><tbody>')
        $columnIndex=0;foreach($column in @($table.columns)){$columnIndex++;$field=@($entity.fields|Where-Object{[string]$_.id-eq[string]$column.name}|Select-Object -First 1);$purpose=if($field.Count){'保存'+[string]$field[0].name+'，供列表、详情、校验或业务操作使用'}else{switch -Regex ([string]$column.name){'^id$'{'保存记录唯一标识';break}'status|state'{'保存当前业务状态，供领域命令校验';break}'version'{'保存乐观版本，防止旧页面覆盖新记录';break}'created|updated|time|date'{'保存记录时间信息，支持追踪处理顺序';break}default{'保存数据库运行或关联所需的受控字段'}}};$default=if($null-eq$column.defaultValue){'无'}else{[string]$column.defaultValue};Add-Html $body ('<tr><td>'+$columnIndex+'</td><td>'+(ConvertTo-StandardHtmlText $column.name)+'</td><td>'+(ConvertTo-StandardHtmlText $column.type)+'</td><td>'+$(if($column.notNull){'是'}else{'否'})+'</td><td>'+$(if([int]$column.primaryKeyPosition-gt0){'是，第 '+$column.primaryKeyPosition+' 位'}else{'否'})+'</td><td>'+(ConvertTo-StandardHtmlText $default)+'</td><td>'+(ConvertTo-StandardHtmlText $purpose)+'。该说明依据列结构与实体字段映射，不改变 SQLite 约束定义。</td></tr>')};Add-Html $body '</tbody></table>'
        Add-Html $body '<h3>键与约束</h3><table class="compact"><thead><tr><th>类型</th><th>名称或列</th><th>目标与组成</th><th>约束说明</th></tr></thead><tbody>'
        $constraintRows=0;foreach($index in @($table.indexes)){$constraintRows++;Add-Html $body ('<tr><td>索引</td><td>'+(ConvertTo-StandardHtmlText $index.name)+'</td><td>'+(ConvertTo-StandardHtmlText (@($index.columns)-join '、'))+'</td><td>'+$(if($index.unique){'唯一索引，阻止重复键值'}else{'普通索引，服务于已定义查询路径'})+'；来源 '+(ConvertTo-StandardHtmlText $index.origin)+'；'+$(if($index.partial){'部分索引'}else{'完整索引'})+'。</td></tr>')};foreach($foreignKey in $allowedForeignKeys){$constraintRows++;Add-Html $body ('<tr><td>外键</td><td>'+(ConvertTo-StandardHtmlText $foreignKey.fromColumn)+'</td><td>'+(ConvertTo-StandardHtmlText $foreignKey.targetTable)+'.'+(ConvertTo-StandardHtmlText $foreignKey.toColumn)+'</td><td>更新规则 '+(ConvertTo-StandardHtmlText $foreignKey.onUpdate)+'，删除规则 '+(ConvertTo-StandardHtmlText $foreignKey.onDelete)+'，匹配方式 '+(ConvertTo-StandardHtmlText $foreignKey.match)+'。写入时由 SQLite 外键检查维护引用完整性。</td></tr>')};if($constraintRows-eq0){Add-Html $body '<tr><td>表级结构</td><td>主键与非空列</td><td>见字段字典</td><td>当前材料范围未登记额外索引或可展示外键，仍按字段主键与非空属性校验。</td></tr>'};Add-Html $body '</tbody></table></section>'
    }
    Add-Html $body '<section class="page-break-before"><h2>六、键与约束总览</h2><p>主键位置、非空属性、默认值、唯一索引和外键规则均以迁移后 SQLite 查询结果为准。应用层校验不会替代数据库约束：表单先检查用户输入，领域模块再检查权限、状态和版本，SQLite 最终执行主键、唯一性、非空和引用完整性约束。任一层失败时，事务不得提交部分结果。</p><h3>6.1 状态与版本字段</h3><ul>'
    foreach($entity in $core){$table=@($Facts.database.tables|Where-Object{[string]$_.entityId-eq[string]$entity.id})[0];$stateColumns=@($table.columns|Where-Object{[string]$_.name-match'status|state|version'}|ForEach-Object{[string]$_.name});Add-Html $body ('<li><strong>'+(ConvertTo-StandardHtmlText $entity.name)+'：</strong>'+$(if($stateColumns.Count){'结构中用于状态或并发控制的列为 '+(ConvertTo-StandardHtmlText ($stateColumns-join '、'))+'。'}else{'当前表未以通用状态或版本名称登记列，状态控制由已编译实体结构和领域命令共同确定。'})+'</li>')};Add-Html $body '</ul></section>'
    Add-Html $body '<h2>七、事务边界</h2><p>每个可见业务动作都通过主进程服务进入领域模块。模块读取当前记录和登录岗位，校验前置条件及输入，再在单一事务中写入业务表、关系表、事件或审计记录。任何后续写入失败都会回滚该动作，界面只在事务完成后显示成功结果。</p><table><thead><tr><th>业务操作</th><th>所属模块</th><th>事务前置条件</th><th>提交结果</th><th>失败行为</th></tr></thead><tbody>'
    $moduleMap=Get-ModuleMap $Facts;foreach($command in @($Facts.commands)){Add-Html $body ('<tr><td>'+(ConvertTo-StandardHtmlText $command.label)+'</td><td>'+(ConvertTo-StandardHtmlText $moduleMap[[string]$command.moduleId].name)+'</td><td>'+(ConvertTo-StandardHtmlText $command.precondition)+'</td><td>'+(ConvertTo-StandardHtmlText $command.result)+'</td><td>'+(ConvertTo-StandardHtmlText $command.failure)+'</td></tr>')};Add-Html $body '</tbody></table>'
    Add-Html $body ('<h2>八、种子与版本迁移</h2><p>验收事实记录了 '+(ConvertTo-StandardHtmlText $Facts.evidence.businessRows)+' 条业务数据，用于验证结构、关联和流程，不代表生产容量承诺。种子数据通过锁定资源生成，软件启动时按数据库结构版本顺序执行迁移；已经应用的迁移不重复执行，更高版本数据库不得由低版本程序直接打开。</p><p>当前结构摘要用于绑定编译结果与材料事实。重新编译实体、字段、索引或外键会改变结构事实，必须重新生成数据库设计、执行迁移验证并更新相关验收回执，不能沿用旧材料描述新结构。</p>')
    Add-Html $body ('<h2>九、备份与恢复</h2><p>'+(ConvertTo-StandardHtmlText $Facts.runtime.backupPolicy)+'。创建备份时生成独立数据库快照和清单，恢复前核对应用标识、结构版本和文件摘要。校验失败、版本不兼容或替换后数据库不能打开时，应停止恢复并保留原数据库。</p><p>备份介质、留存期限和异地保管由申请人制度确定。软件不把备份自动上传到互联网，也不允许以来源不明的数据库直接覆盖当前数据。恢复完成后应重新登录，抽查核心表对应模块、关键状态和审计记录。</p><h2>十、设计边界</h2><p>本文只描述材料事实中选定实体及真实系统表。没有出现在 SQLite 结构中的表、列、索引和外键不构成实现声明；没有进入本次材料范围的业务实体不在数据字典中展开。数据库结构说明不等同于允许用户直接编辑数据库，所有日常写入均应通过软件提供的领域操作完成。</p><p class="footer-note">数据库结构版本、运行时版本和备份策略均取自锁定项目事实。</p>')
    return Complete-DocumentHtml $Facts 'database-design' '数据库设计说明书' $body $OutputPath
}

function Get-ApplicantLanguageText($Facts){
    $labels=[Collections.Generic.List[string]]::new()
    foreach($file in @($Facts.source.files)){
        switch -Regex ([IO.Path]::GetExtension([string]$file.path).ToLowerInvariant()){
            '^\.tsx?$'{if(-not$labels.Contains('TypeScript')){$labels.Add('TypeScript')};break}
            '^\.(js|cjs|mjs)$'{if(-not$labels.Contains('JavaScript')){$labels.Add('JavaScript')};break}
            '^\.html?$'{if(-not$labels.Contains('HTML')){$labels.Add('HTML')};break}
            '^\.css$'{if(-not$labels.Contains('CSS')){$labels.Add('CSS')};break}
            '^\.ps1$'{if(-not$labels.Contains('PowerShell')){$labels.Add('PowerShell')};break}
        }
    }
    if($labels.Count-eq0){return '以源码清单所列文件类型为准'}
    return $labels-join '、'
}
function Add-ApplicantCell($Body,[string]$Field,[string]$Value,[string]$Attributes=''){
    Add-Html $Body ('<td data-field="'+$Field+'"'+$Attributes+'>'+(ConvertTo-StandardHtmlText $Value)+'</td>')
}
function Render-StandardApplicantHtml {
    [CmdletBinding()]param([Parameter(Mandatory)]$Facts,[string]$OutputPath)
    Assert-RenderingFacts $Facts
    $language=Get-ApplicantLanguageText $Facts;$moduleNames=@($Facts.modules|ForEach-Object{[string]$_.name});$workflowLabels=@(Get-WorkflowSteps $Facts|ForEach-Object{[string]$_.label})
    $mainFunctions='软件包含'+($moduleNames-join '、')+'等业务模块，按“'+($workflowLabels-join '、')+'”流程完成登记、处理、复核和结果留痕。'
    $industry='【申请人填写】'
    $runtimeSupport='Electron '+[string]$Facts.runtime.electron+'、Node.js '+[string]$Facts.runtime.node+'、SQLite '+[string]$Facts.runtime.sqlite+'；运行组件随安装包交付，无需外部数据库服务'
    $technical='Electron 桌面容器与隔离渲染界面，Node.js 主进程执行权限、领域事务和审计，SQLite 本地持久化；数据库结构版本 '+[string]$Facts.runtime.databaseSchemaVersion+'；'+[string]$Facts.runtime.dataPolicy+'；核心流程支持离线运行。'
    $hardware='【申请人按实际设备填写】；交付目标为 '+[string]$Facts.runtime.platform
    $developmentEnvironment='【申请人按实际开发环境填写】；交付目标为 '+[string]$Facts.runtime.platform
    $developmentTools='【申请人按实际开发工具填写】；源码清单证明使用 '+$language+'，运行时包含 Node.js '+[string]$Facts.runtime.node
    $sourceQuantity='【生成时按实际源码统计填写】（清单统计 '+[string]$Facts.source.totalLines+' 行，'+[string]$Facts.source.totalFiles+' 个文件）'
    $body=[Text.StringBuilder]::new();Add-Html $body '<h1>计算机软件著作权登记申请信息</h1><p class="document-note">本页十九项技术与功能信息来自已验证软件事实；简称、分类号、法定日期、开发设备和开发环境由申请人结合真实情况确认。</p><table class="compact"><tbody>'
    Add-Html $body '<tr><td class="section-title" rowspan="2">软件基本信息</td><td class="label">软件名称</td>';Add-ApplicantCell $body 'software_name' ([string]$Facts.software.name);Add-Html $body '<td class="label">版本号</td>';Add-ApplicantCell $body 'version' ('V'+[string]$Facts.software.version);Add-Html $body '</tr><tr><td class="label">软件简称</td>';Add-ApplicantCell $body 'short_name' '【申请人填写】';Add-Html $body '<td class="label">分类号</td>';Add-ApplicantCell $body 'classification' '【申请人填写】';Add-Html $body '</tr>'
    Add-Html $body '<tr><td class="label" colspan="2">开发完成日期</td>';Add-ApplicantCell $body 'completion_date' '【申请人填写】' ' colspan="3"';Add-Html $body '</tr><tr><td class="label" colspan="2">组织成立日期</td>';Add-ApplicantCell $body 'company_date' '【申请人填写】' ' colspan="3"';Add-Html $body '</tr><tr><td class="label" colspan="2">软件分类</td>';Add-ApplicantCell $body 'category' '☑应用软件　□中间件　□嵌入式软件　□操作系统' ' colspan="3"';Add-Html $body '</tr>'
    Add-Html $body '<tr><td class="section-title" rowspan="11">软件功能和技术特点</td><td class="label">开发的硬件环境</td>';Add-ApplicantCell $body 'development_hardware' $hardware ' colspan="3"';Add-Html $body '</tr><tr><td class="label">运行的硬件环境</td>';Add-ApplicantCell $body 'runtime_hardware' $hardware ' colspan="3"';Add-Html $body '</tr><tr><td class="label">开发该软件的操作系统</td>';Add-ApplicantCell $body 'development_os' $developmentEnvironment ' colspan="3"';Add-Html $body '</tr><tr><td class="label">软件开发环境/开发工具</td>';Add-ApplicantCell $body 'development_tools' $developmentTools ' colspan="3"';Add-Html $body '</tr><tr><td class="label">该软件的运行平台/操作系统</td>';Add-ApplicantCell $body 'runtime_platform' ([string]$Facts.runtime.platform) ' colspan="3"';Add-Html $body '</tr><tr><td class="label">软件运行支撑环境/支持软件</td>';Add-ApplicantCell $body 'runtime_support' $runtimeSupport ' colspan="3"';Add-Html $body '</tr><tr><td class="label">编程语言</td>';Add-ApplicantCell $body 'language' $language;Add-Html $body '<td class="label">源程序量</td>';Add-ApplicantCell $body 'source_quantity' $sourceQuantity;Add-Html $body '</tr><tr><td class="label">开发目的</td>';Add-ApplicantCell $body 'development_purpose' ([string]$Facts.software.purpose) ' colspan="3"';Add-Html $body '</tr><tr><td class="label">面向领域/行业</td>';Add-ApplicantCell $body 'industry' $industry ' colspan="3"';Add-Html $body '</tr><tr><td class="label">软件的主要功能</td>';Add-ApplicantCell $body 'main_functions' $mainFunctions ' class="long-text" colspan="3"';Add-Html $body '</tr><tr><td class="label">软件的技术特点</td>';Add-ApplicantCell $body 'technical_features' $technical ' class="long-text" colspan="3"';Add-Html $body '</tr></tbody></table><p class="footer-note">申请人应在正式申报前核对所有【申请人填写】项目，并以最终提交源程序材料确认源程序量。</p>'
    return Complete-DocumentHtml $Facts 'application-info' '软件著作权申请信息' $body $OutputPath
}

Export-ModuleMember -Function Render-StandardIntroductionHtml,Render-StandardFeatureTableHtml,Render-StandardRuntimeHtml,Render-StandardManualHtml,Render-StandardPrototypeHtml,Render-StandardDatabaseHtml,Render-StandardApplicantHtml
