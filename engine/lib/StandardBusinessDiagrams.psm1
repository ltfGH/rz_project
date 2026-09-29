Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'

function Assert-DiagramFacts($Facts){
    if($null-eq$Facts-or[string]$Facts.factVersion-ne'1.0'-or@($Facts.modules).Count-eq0-or@($Facts.entities|Where-Object{$_.isCore}).Count-eq0){throw 'Standard diagram facts are incomplete.'}
    $steps=@($Facts.workflows|ForEach-Object{@($_.steps)})
    if(@($Facts.modules).Count-gt6-or@($Facts.roles).Count-gt4-or@($Facts.entities|Where-Object{$_.isCore}).Count-gt4-or$steps.Count-gt8){throw 'Material facts exceed fixed diagram capacity.'}
}
function New-DrawingFont([float]$Size,[Drawing.FontStyle]$Style=[Drawing.FontStyle]::Regular){return [Drawing.Font]::new('Microsoft YaHei',$Size,$Style,[Drawing.GraphicsUnit]::Pixel)}
function Add-DrawingText($Graphics,[string]$Text,$Font,$Brush,[Drawing.RectangleF]$Bounds,[Drawing.StringAlignment]$Alignment=[Drawing.StringAlignment]::Near){
    $format=[Drawing.StringFormat]::new();$drawFont=$Font;$ownedFont=$null
    try{
        $measured=$Graphics.MeasureString($Text,$Font,[Math]::Max(1,[int]$Bounds.Width))
        if($measured.Height-gt$Bounds.Height-and$Font.Size-gt10){$scaled=[Math]::Max(10,[Math]::Floor($Font.Size*($Bounds.Height/$measured.Height)));$ownedFont=[Drawing.Font]::new($Font.FontFamily,$scaled,$Font.Style,[Drawing.GraphicsUnit]::Pixel);$drawFont=$ownedFont}
        $format.Alignment=$Alignment;$format.LineAlignment=[Drawing.StringAlignment]::Center;$format.Trimming=[Drawing.StringTrimming]::EllipsisWord;$Graphics.DrawString($Text,$drawFont,$Brush,$Bounds,$format)
    }
    finally{if($null-ne$ownedFont){$ownedFont.Dispose()};$format.Dispose()}
}
function Add-DrawingBox($Graphics,[Drawing.RectangleF]$Bounds,[Drawing.Color]$Fill,[Drawing.Color]$Border,[string]$Title,[string]$Detail){
    $fillBrush=[Drawing.SolidBrush]::new($Fill);$borderPen=[Drawing.Pen]::new($Border,2);$titleFont=New-DrawingFont 22 ([Drawing.FontStyle]::Bold);$detailFont=New-DrawingFont 15;$textBrush=[Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(29,39,48))
    try{$Graphics.FillRectangle($fillBrush,$Bounds);$Graphics.DrawRectangle($borderPen,$Bounds.X,$Bounds.Y,$Bounds.Width,$Bounds.Height);Add-DrawingText $Graphics $Title $titleFont $textBrush ([Drawing.RectangleF]::new($Bounds.X+12,$Bounds.Y+8,$Bounds.Width-24,38));Add-DrawingText $Graphics $Detail $detailFont $textBrush ([Drawing.RectangleF]::new($Bounds.X+12,$Bounds.Y+48,$Bounds.Width-24,$Bounds.Height-58))}finally{$fillBrush.Dispose();$borderPen.Dispose();$titleFont.Dispose();$detailFont.Dispose();$textBrush.Dispose()}
}
function Add-DiagramHeading($Graphics,[string]$Title,[string]$Subtitle,[int]$Width){
    $titleFont=New-DrawingFont 34 ([Drawing.FontStyle]::Bold);$subFont=New-DrawingFont 17;$dark=[Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(29,39,48));$muted=[Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(82,99,109))
    try{Add-DrawingText $Graphics $Title $titleFont $dark ([Drawing.RectangleF]::new(48,22,$Width-96,52));Add-DrawingText $Graphics $Subtitle $subFont $muted ([Drawing.RectangleF]::new(48,72,$Width-96,36))}finally{$titleFont.Dispose();$subFont.Dispose();$dark.Dispose();$muted.Dispose()}
}
function Save-Diagram([string]$Path,[int]$Width,[int]$Height,[scriptblock]$Painter){
    $bitmap=[Drawing.Bitmap]::new($Width,$Height,[Drawing.Imaging.PixelFormat]::Format32bppArgb);$graphics=[Drawing.Graphics]::FromImage($bitmap)
    try{$graphics.SmoothingMode=[Drawing.Drawing2D.SmoothingMode]::AntiAlias;$graphics.TextRenderingHint=[Drawing.Text.TextRenderingHint]::AntiAliasGridFit;$graphics.Clear([Drawing.Color]::White);& $Painter $graphics $Width $Height;$bitmap.Save($Path,[Drawing.Imaging.ImageFormat]::Png)}finally{$graphics.Dispose();$bitmap.Dispose()}
}
function Add-Arrow($Graphics,[float]$X1,[float]$Y1,[float]$X2,[float]$Y2){
    $pen=[Drawing.Pen]::new([Drawing.Color]::FromArgb(50,108,140),3);$cap=[Drawing.Drawing2D.AdjustableArrowCap]::new(6,7);try{$pen.CustomEndCap=$cap;$Graphics.DrawLine($pen,$X1,$Y1,$X2,$Y2)}finally{$pen.Dispose();$cap.Dispose()}
}
function Add-DiagramLegend($Graphics,[string]$Text,[int]$Width,[int]$Height){
    $font=New-DrawingFont 13;$brush=[Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(82,99,109));$pen=[Drawing.Pen]::new([Drawing.Color]::FromArgb(174,184,190),1)
    try{$Graphics.DrawLine($pen,50,$Height-52,$Width-50,$Height-52);Add-DrawingText $Graphics ('图例：'+$Text+'；事实来源：MaterialFacts 已验证模块、流程与 SQLite 结构。') $font $brush ([Drawing.RectangleF]::new(55,$Height-48,$Width-110,36))}finally{$font.Dispose();$brush.Dispose();$pen.Dispose()}
}

function New-NavigationDiagram($Facts,[string]$Path){Save-Diagram $Path 1400 900 {
    param($g,$w,$h);Add-DiagramHeading $g '导航层级图' ([string]$Facts.software.name) $w
    Add-DrawingBox $g ([Drawing.RectangleF]::new(55,130,250,700)) ([Drawing.Color]::FromArgb(231,238,241)) ([Drawing.Color]::FromArgb(91,112,123)) '业务导航' '登录后按岗位展示已授权模块'
    $count=@($Facts.modules).Count;$boxHeight=[Math]::Min(125,[Math]::Floor(620/[Math]::Max(1,$count)));$i=0
    foreach($module in @($Facts.modules)){$y=145+$i*($boxHeight+12);Add-DrawingBox $g ([Drawing.RectangleF]::new(345,$y,350,$boxHeight)) ([Drawing.Color]::FromArgb(224,240,234)) ([Drawing.Color]::FromArgb(55,126,92)) ([string]$module.name) ([string]$module.purpose);Add-Arrow $g 305 ($y+$boxHeight/2) 345 ($y+$boxHeight/2);$i++}
    Add-DrawingBox $g ([Drawing.RectangleF]::new(760,170,570,190)) ([Drawing.Color]::FromArgb(237,242,247)) ([Drawing.Color]::FromArgb(66,106,148)) '列表视图' '查询、筛选、排序、分页与记录选择'
    Add-DrawingBox $g ([Drawing.RectangleF]::new(760,410,570,190)) ([Drawing.Color]::FromArgb(249,239,226)) ([Drawing.Color]::FromArgb(166,105,38)) '详情视图' '字段信息、关联记录、状态与版本'
    Add-DrawingBox $g ([Drawing.RectangleF]::new(760,650,570,180)) ([Drawing.Color]::FromArgb(247,232,233)) ([Drawing.Color]::FromArgb(151,68,74)) '领域操作' '按权限和状态开放明确业务动作'
    Add-Arrow $g 695 330 760 265;Add-Arrow $g 695 430 760 505;Add-Arrow $g 695 535 760 740;Add-DiagramLegend $g '绿色为业务模块，蓝色箭头表示导航方向' $w $h
}}
function New-InterfaceDiagram($Facts,[string]$Path){Save-Diagram $Path 1400 900 {
    param($g,$w,$h);$module=@($Facts.modules)[0];$entity=@($Facts.entities|Where-Object{[string]$_.id-eq[string]$module.entityId})[0]
    Add-DiagramHeading $g '列表、详情与表单线框图' (([string]$module.name)+' / '+([string]$entity.name)) $w
    $nl=[Environment]::NewLine
    Add-DrawingBox $g ([Drawing.RectangleF]::new(50,135,560,690)) ([Drawing.Color]::FromArgb(237,242,247)) ([Drawing.Color]::FromArgb(66,106,148)) '记录列表' ('查询条件'+$nl+(@($entity.fields|Select-Object -First 4|ForEach-Object{[string]$_.name})-join ' | ')+$nl+$nl+'分页记录区'+$nl+'选择一条记录进入详情')
    Add-DrawingBox $g ([Drawing.RectangleF]::new(650,135,700,310)) ([Drawing.Color]::FromArgb(224,240,234)) ([Drawing.Color]::FromArgb(55,126,92)) '记录详情' ((@($entity.fields|ForEach-Object{[string]$_.name})-join ' / ')+$nl+'状态、版本与关联信息来自持久化记录')
    $labels=@($module.operations|ForEach-Object{$id=[string]$_;@($Facts.commands|Where-Object{[string]$_.id-eq$id})[0].label}|Where-Object{$_});Add-DrawingBox $g ([Drawing.RectangleF]::new(650,485,700,340)) ([Drawing.Color]::FromArgb(249,239,226)) ([Drawing.Color]::FromArgb(166,105,38)) '操作表单' (($(if($labels.Count){$labels-join ' / '}else{'查看记录'})+$nl+'必填、类型、状态、权限和版本校验'+$nl+'提交成功后刷新列表与详情'))
    Add-Arrow $g 610 290 650 290;Add-Arrow $g 1000 445 1000 485;Add-DiagramLegend $g '蓝色为列表，绿色为详情，橙色为操作表单' $w $h
}}
function New-RoleDiagram($Facts,[string]$Path){Save-Diagram $Path 1400 900 {
    param($g,$w,$h);Add-DiagramHeading $g '角色操作矩阵' '岗位与已验证业务操作的对应关系' $w
    $roles=@($Facts.roles);$commands=@($Facts.commands);$rowHeight=[Math]::Min(150,[Math]::Floor(680/[Math]::Max(1,$roles.Count)));$i=0
    foreach($role in $roles){$ids=@($role.visibleOperations);$labels=@($commands|Where-Object{$ids-contains[string]$_.id}|ForEach-Object{[string]$_.label});$detail=if($labels.Count){$labels-join '、'}else{'查看授权信息或承担复核职责'};$color=if($i%2-eq0){[Drawing.Color]::FromArgb(237,242,247)}else{[Drawing.Color]::FromArgb(224,240,234)};Add-DrawingBox $g ([Drawing.RectangleF]::new(70,135+$i*($rowHeight+14),1260,$rowHeight)) $color ([Drawing.Color]::FromArgb(71,104,122)) ([string]$role.name) $detail;$i++};Add-DiagramLegend $g '每行表示一个组合岗位及其可见操作' $w $h
}}
function New-WorkflowDiagram($Facts,[string]$Path){Save-Diagram $Path 1600 900 {
    param($g,$w,$h);Add-DiagramHeading $g '业务流程图' ([string]@($Facts.workflows)[0].name) $w
    $steps=@($Facts.workflows|ForEach-Object{@($_.steps)});$columns=[Math]::Min(4,[Math]::Max(1,$steps.Count));$boxWidth=[Math]::Floor(($w-120-($columns-1)*35)/$columns);$i=0
    foreach($step in $steps){$row=[Math]::Floor($i/$columns);$column=$i%$columns;$x=60+$column*($boxWidth+35);$y=150+$row*315;$detail='前置：'+[string]$step.prerequisite+[Environment]::NewLine+'结果：'+[string]$step.result;$fill=if($row%2-eq0){[Drawing.Color]::FromArgb(224,240,234)}else{[Drawing.Color]::FromArgb(249,239,226)};Add-DrawingBox $g ([Drawing.RectangleF]::new($x,$y,$boxWidth,220)) $fill ([Drawing.Color]::FromArgb(55,112,100)) (($i+1).ToString()+'. '+[string]$step.label) $detail;if($i-gt0){$previousColumn=($i-1)%$columns;$previousRow=[Math]::Floor(($i-1)/$columns);if($previousRow-eq$row){Add-Arrow $g ($x-35) ($y+110) $x ($y+110)}else{Add-Arrow $g ($w-75) ($y-55) 75 ($y-55)}};$i++};Add-DiagramLegend $g '编号表示处理顺序，箭头表示下一业务环节' $w $h
}}
function New-RelationshipDiagram($Facts,[string]$Path){Save-Diagram $Path 1600 1000 {
    param($g,$w,$h);Add-DiagramHeading $g '实体关系概览图' '仅展示材料范围内的核心业务实体' $w
    $entities=@($Facts.entities|Where-Object{$_.isCore});$tables=@($Facts.database.tables);$positions=@{};$boxes=@{};$tableByEntity=@{};$columns=2;$boxWidth=650;$boxHeight=250;$i=0
    foreach($entity in $entities){$row=[Math]::Floor($i/$columns);$column=$i%$columns;$x=90+$column*770;$y=145+$row*330;$table=@($tables|Where-Object{[string]$_.entityId-eq[string]$entity.id})[0];$bounds=[Drawing.RectangleF]::new($x,$y,$boxWidth,$boxHeight);$positions[[string]$table.name]=[Drawing.PointF]::new($x+$boxWidth/2,$y+$boxHeight/2);$boxes[[string]$entity.id]=$bounds;$tableByEntity[[string]$entity.id]=$table;$i++}
    foreach($entity in $entities){$table=@($tables|Where-Object{[string]$_.entityId-eq[string]$entity.id})[0];if($null-eq$table){continue};foreach($fk in @($table.foreignKeys)){if($positions.ContainsKey([string]$fk.targetTable)){$from=$positions[[string]$table.name];$to=$positions[[string]$fk.targetTable];Add-Arrow $g $from.X $from.Y $to.X $to.Y}}}
    foreach($entity in $entities){$table=$tableByEntity[[string]$entity.id];$fields=@($entity.fields|ForEach-Object{[string]$_.name})-join '、';Add-DrawingBox $g $boxes[[string]$entity.id] ([Drawing.Color]::FromArgb(237,242,247)) ([Drawing.Color]::FromArgb(66,106,148)) ([string]$entity.name) (([string]$table.name)+[Environment]::NewLine+$fields)};Add-DiagramLegend $g '矩形表示核心实体，连线表示已编译外键关系' $w $h
}}

function New-StandardBusinessDiagrams {
    [CmdletBinding()]param([Parameter(Mandatory)]$Facts,[Parameter(Mandatory)][string]$OutputDirectory)
    Assert-DiagramFacts $Facts
    if(-not[IO.Path]::IsPathRooted($OutputDirectory)){throw 'Diagram output directory must be absolute.'}
    $target=[IO.Path]::GetFullPath($OutputDirectory);if(Test-Path -LiteralPath $target){throw 'Refusing to overwrite diagram output.'}
    $parent=Split-Path -Parent $target;if(-not(Test-Path -LiteralPath $parent)){New-Item -ItemType Directory -Path $parent -Force|Out-Null}
    $stage=Join-Path $parent ('.diagrams-staging-'+[guid]::NewGuid().ToString('N'))
    $definitions=@([pscustomobject]@{id='navigation';width=1400;height=900},[pscustomobject]@{id='interface';width=1400;height=900},[pscustomobject]@{id='roles';width=1400;height=900},[pscustomobject]@{id='workflow';width=1600;height=900},[pscustomobject]@{id='relationships';width=1600;height=1000})
    try{
        Add-Type -AssemblyName System.Drawing;New-Item -ItemType Directory -Path $stage|Out-Null
        New-NavigationDiagram $Facts (Join-Path $stage 'navigation.png');New-InterfaceDiagram $Facts (Join-Path $stage 'interface.png');New-RoleDiagram $Facts (Join-Path $stage 'roles.png');New-WorkflowDiagram $Facts (Join-Path $stage 'workflow.png');New-RelationshipDiagram $Facts (Join-Path $stage 'relationships.png')
        try{[IO.Directory]::Move($stage,$target)}catch [IO.IOException]{if(Test-Path -LiteralPath $target){throw 'Refusing to overwrite diagram output.'};throw}
        return @($definitions|ForEach-Object{[pscustomobject]@{id=$_.id;fileName=($_.id+'.png');width=$_.width;height=$_.height}})
    }
    catch{throw}
    finally{if(Test-Path -LiteralPath $stage){Remove-Item -LiteralPath $stage -Recurse -Force}}
}

Export-ModuleMember -Function New-StandardBusinessDiagrams
