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

Export-ModuleMember -Function Render-StandardIntroductionHtml,Render-StandardFeatureTableHtml,Render-StandardRuntimeHtml
