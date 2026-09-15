Set-StrictMode -Version Latest

$forbiddenNetworkPattern = '(?i)\bfetch\s*\(|XMLHttpRequest|WebSocket|https?://|<script[^>]+src\s*=\s*["'']\s*//'
$applicantMarker = -join [char[]](0x3010, 0x7533, 0x8BF7, 0x4EBA, 0x586B, 0x5199, 0x3011)

function Get-AllowedProjectFiles {
    param([Parameter(Mandatory)][string]$WorkspacePath)

    $patterns = @(
        'app\index.html',
        'app\assets\*.css',
        'app\js\*.js',
        'app\tests\*.js',
        'materials\content\*.html'
    )
    foreach ($pattern in $patterns) {
        Get-ChildItem -LiteralPath $WorkspacePath -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object {
                $relative = $_.FullName.Substring($WorkspacePath.TrimEnd('\').Length).TrimStart('\')
                $relative -like $pattern
            }
    }
}

function New-ValidationResult {
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][string[]]$Failures,
        [Parameter(Mandatory)][int]$NodeExitCode,
        [string]$NodeOutput = ''
    )

    $summaryParts = @($Failures)
    if (-not [string]::IsNullOrWhiteSpace($NodeOutput)) {
        $summaryParts += $NodeOutput.Trim()
    }
    $summary = ($summaryParts -join [Environment]::NewLine)
    if ($summary.Length -gt 12000) {
        $summary = $summary.Substring(0, 12000)
    }

    return [pscustomobject]@{
        Passed = $Failures.Count -eq 0
        Failures = @($Failures)
        NodeExitCode = $NodeExitCode
        Summary = $summary
    }
}

function Test-GeneratedProject {
    param(
        [Parameter(Mandatory)][string]$WorkspacePath,
        [Parameter(Mandatory)][string]$NodePath
    )

    $failures = [Collections.Generic.List[string]]::new()
    $nodeExitCode = -1
    $nodeOutput = ''
    $workspace = [IO.Path]::GetFullPath($WorkspacePath)
    if (-not (Test-Path -LiteralPath $workspace -PathType Container)) {
        $failures.Add("Workspace does not exist: $workspace")
        return New-ValidationResult -Failures $failures.ToArray() -NodeExitCode $nodeExitCode
    }
    if (-not [IO.Path]::IsPathRooted($NodePath) -or -not (Test-Path -LiteralPath $NodePath -PathType Leaf)) {
        $failures.Add("Node path must be an existing absolute file: $NodePath")
        return New-ValidationResult -Failures $failures.ToArray() -NodeExitCode $nodeExitCode
    }

    $manifestPath = Join-Path $workspace 'project.json'
    $manifest = $null
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        $failures.Add('Missing required file: project.json')
    }
    else {
        try {
            $manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $manifestPath | ConvertFrom-Json
        }
        catch {
            $failures.Add("project.json is invalid JSON: $($_.Exception.Message)")
        }
    }

    $requiredFiles = @(
        'app\index.html',
        'app\assets\styles.css',
        'app\js\domain.js',
        'app\js\demo-data.js',
        'app\js\storage.js',
        'app\js\app.js',
        'app\tests\domain.test.js',
        'app\tests\storage.test.js',
        'app\tests\ui-contract.test.js',
        'materials\content\manual.html',
        'materials\content\application-info.html',
        'materials\content\runtime.html',
        'materials\content\prototype.html'
    )
    foreach ($relativePath in $requiredFiles) {
        if (-not (Test-Path -LiteralPath (Join-Path $workspace $relativePath) -PathType Leaf)) {
            $failures.Add("Missing required file: $relativePath")
        }
    }

    $indexPath = Join-Path $workspace 'app\index.html'
    $indexText = if (Test-Path -LiteralPath $indexPath -PathType Leaf) {
        Get-Content -Raw -Encoding UTF8 -LiteralPath $indexPath
    } else { '' }

    $expectedRoutes = @('dashboard', 'records', 'operation', 'history')
    if ($null -eq $manifest -or $null -eq $manifest.routes -or @($manifest.routes).Count -ne 4 -or
        (@($manifest.routes) -join ',') -cne ($expectedRoutes -join ',')) {
        $failures.Add('project.json must declare the four fixed routes: dashboard, records, operation, history.')
    }
    foreach ($route in $expectedRoutes) {
        if ($indexText -notmatch ([regex]::Escape("#$route"))) {
            $failures.Add("Missing required route in app/index.html: #$route")
        }
    }

    if ($null -eq $manifest -or [string]::IsNullOrWhiteSpace([string]$manifest.softwareName)) {
        $failures.Add('project.json must contain softwareName.')
    }
    elseif ($indexText -notlike "*$($manifest.softwareName)*") {
        $failures.Add("Software name mismatch: app/index.html must contain '$($manifest.softwareName)'.")
    }

    $allowedFiles = @(Get-AllowedProjectFiles -WorkspacePath $workspace)
    foreach ($file in $allowedFiles) {
        $relative = $file.FullName.Substring($workspace.TrimEnd('\').Length).TrimStart('\')
        if ($relative -like 'app\tests\*.js') { continue }
        $content = Get-Content -Raw -Encoding UTF8 -LiteralPath $file.FullName
        if ($content -match $forbiddenNetworkPattern) {
            $failures.Add("Forbidden network access found in $relative.")
        }
    }

    $applicationInfoPath = Join-Path $workspace 'materials\content\application-info.html'
    if (-not (Test-Path -LiteralPath $applicationInfoPath -PathType Leaf)) {
        $failures.Add('Missing required file: materials\content\application-info.html')
    }
    else {
        $applicationInfo = Get-Content -Raw -Encoding UTF8 -LiteralPath $applicationInfoPath
        if ($applicationInfo -notlike "*$applicantMarker*") {
            $failures.Add('Applicant information must retain the applicant-fill-in marker.')
        }
        $plainApplicantInfo = [Net.WebUtility]::HtmlDecode([regex]::Replace($applicationInfo, '<[^>]+>', "`n"))
        $requiredApplicationFields = @(
            '软件名称', '版本号', '软件简称', '分类号', '开发完成日期', '公司成立日期',
            '软件分类', '开发的硬件环境', '运行的硬件环境', '开发该软件的操作系统',
            '软件开发环境/开发工具', '该软件的运行平台/操作系统',
            '软件运行支撑环境/支持软件', '编程语言', '源程序量', '开发目的',
            '面向领域/行业', '软件的主要功能', '软件的技术特点'
        )
        foreach ($field in $requiredApplicationFields) {
            if ($plainApplicantInfo -notlike "*$field*") {
                $failures.Add("示例申请表格式缺少字段：$field")
            }
        }
        $tableCount = [regex]::Matches($applicationInfo, '(?i)<table(?:\s|>)').Count
        $rowCount = [regex]::Matches($applicationInfo, '(?i)<tr(?:\s|>)').Count
        $rowspanCount = [regex]::Matches($applicationInfo, '(?i)rowspan\s*=').Count
        $colspanCount = [regex]::Matches($applicationInfo, '(?i)colspan\s*=').Count
        if ($tableCount -ne 1 -or $rowCount -ne 16 -or $rowspanCount -lt 2 -or $colspanCount -lt 2) {
            $failures.Add('示例申请表格式必须包含一个16行表格以及分区合并单元格。')
        }
        $requiredDataFields = @(
            'software_name', 'version', 'short_name', 'classification', 'completion_date',
            'company_date', 'category', 'development_hardware', 'runtime_hardware',
            'development_os', 'development_tools', 'runtime_platform', 'runtime_support',
            'language', 'source_quantity', 'development_purpose', 'industry',
            'main_functions', 'technical_features'
        )
        foreach ($dataField in $requiredDataFields) {
            if ($applicationInfo -notmatch ('(?i)data-field\s*=\s*["'']{0}["'']' -f [regex]::Escape($dataField))) {
                $failures.Add("示例申请表格式缺少数据字段：$dataField")
            }
        }
        $identityFields = @('申请人(?:名称)?', '证件号码', '统一社会信用代码', '联系人', '联系(?:方式|电话|邮箱)')
        foreach ($identityField in $identityFields) {
            if ($plainApplicantInfo -match "(?:$identityField)\s*[：:]") {
                $identityPattern = '(?s)(?:{0})\s*(?:[：:]\s*)?{1}' -f $identityField, [regex]::Escape($applicantMarker)
                if ($plainApplicantInfo -notmatch $identityPattern) {
                    $failures.Add('Applicant identity and contact information must retain the applicant-fill-in marker.')
                }
            }
        }
    }

    $runtimePath = Join-Path $workspace 'materials\content\runtime.html'
    if (Test-Path -LiteralPath $runtimePath -PathType Leaf) {
        $runtimeHtml = Get-Content -Raw -Encoding UTF8 -LiteralPath $runtimePath
        $runtimeText = [Net.WebUtility]::HtmlDecode([regex]::Replace($runtimeHtml, '<[^>]+>', ' '))
        if ($runtimeText -notmatch '无需外部数据库') {
            $failures.Add('Runtime material must state that the offline application needs no external database (无需外部数据库).')
        }
        if ($runtimeText -match '(?i)\bMySQL\b|\bMariaDB\b|\bPostgreSQL\b|\bSQL\s*Server\b|\bOracle\b') {
            $failures.Add('Runtime material must not claim an external database product for the offline application.')
        }
    }

    $prototypePath = Join-Path $workspace 'materials\content\prototype.html'
    if (Test-Path -LiteralPath $prototypePath -PathType Leaf) {
        $prototypeHtml = Get-Content -Raw -Encoding UTF8 -LiteralPath $prototypePath
        $prototypeText = [Net.WebUtility]::HtmlDecode([regex]::Replace($prototypeHtml, '<[^>]+>', ' '))
        $describesDataModel = $prototypeText -match '数据库|数据表|表结构|实体关系|ER\s*图'
        if ($describesDataModel -and $prototypeText -notmatch '逻辑数据模型') {
            $failures.Add('Prototype database or table diagrams must be labeled as 逻辑数据模型.')
        }
    }

    $testDirectory = Join-Path $workspace 'app\tests'
    $testFiles = @()
    if (Test-Path -LiteralPath $testDirectory -PathType Container) {
        $testFiles = @(Get-ChildItem -LiteralPath $testDirectory -Recurse -File -Filter '*.test.js')
    }
    if ($testFiles.Count -eq 0) {
        $failures.Add('Node tests failed: no app/tests/*.test.js files were found.')
    }
    else {
        Push-Location -LiteralPath $workspace
        try {
            $nodeOutput = (& $NodePath --test @($testFiles.FullName) 2>&1 | Out-String)
            $nodeExitCode = $LASTEXITCODE
        }
        finally {
            Pop-Location
        }
        if ($nodeExitCode -ne 0) {
            $failures.Add("Node tests failed with exit code $nodeExitCode.")
        }
    }

    return New-ValidationResult -Failures $failures.ToArray() -NodeExitCode $nodeExitCode -NodeOutput $nodeOutput
}

function Invoke-GenerationWithRepair {
    param(
        [Parameter(Mandatory)][pscustomobject]$Context,
        [Parameter(Mandatory)][string]$CodexPath,
        [Parameter(Mandatory)][string]$NodePath,
        [scriptblock]$GenerationInvoker,
        [scriptblock]$RepairInvoker,
        [scriptblock]$Validator
    )

    if ($null -eq $GenerationInvoker -or $null -eq $RepairInvoker) {
        Import-Module (Join-Path $PSScriptRoot 'CodexRunner.psm1') -Force -DisableNameChecking
        if ($null -eq $GenerationInvoker) { $GenerationInvoker = { param($context, $path) Invoke-CodexGeneration -Context $context -CodexPath $path } }
        if ($null -eq $RepairInvoker) { $RepairInvoker = { param($context, $path, $summary) Invoke-CodexRepair -Context $context -CodexPath $path -FailureSummary $summary } }
    }
    if ($null -eq $Validator) { $Validator = { param($workspace, $node) Test-GeneratedProject -WorkspacePath $workspace -NodePath $node } }

    $states = [Collections.Generic.List[string]]::new()
    $states.Add('Generated')
    $generation = & $GenerationInvoker $Context $CodexPath
    if ($generation.ExitCode -ne 0) {
        return [pscustomobject]@{ Passed = $false; Failures = @("Codex generation failed with exit code $($generation.ExitCode)."); NodeExitCode = -1; Summary = "Codex generation failed with exit code $($generation.ExitCode)."; CodexCallCount = 1; States = $states.ToArray() }
    }

    $firstValidation = & $Validator $Context.WorkspacePath $NodePath
    if ($firstValidation.Passed) {
        $states.Add('Validated')
        return [pscustomobject]@{ Passed = $true; Failures = $firstValidation.Failures; NodeExitCode = $firstValidation.NodeExitCode; Summary = $firstValidation.Summary; CodexCallCount = 1; States = $states.ToArray() }
    }

    $states.Add('Repairing')
    $repair = & $RepairInvoker $Context $CodexPath $firstValidation.Summary
    if ($repair.ExitCode -ne 0) {
        return [pscustomobject]@{ Passed = $false; Failures = @("Codex repair failed with exit code $($repair.ExitCode)."); NodeExitCode = $firstValidation.NodeExitCode; Summary = "Codex repair failed with exit code $($repair.ExitCode)."; CodexCallCount = 2; States = $states.ToArray() }
    }

    $secondValidation = & $Validator $Context.WorkspacePath $NodePath
    $states.Add('Validated')
    return [pscustomobject]@{ Passed = $secondValidation.Passed; Failures = $secondValidation.Failures; NodeExitCode = $secondValidation.NodeExitCode; Summary = $secondValidation.Summary; CodexCallCount = 2; States = $states.ToArray() }
}

Export-ModuleMember -Function Test-GeneratedProject, Invoke-GenerationWithRepair
