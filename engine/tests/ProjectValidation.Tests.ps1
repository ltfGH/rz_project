. "$PSScriptRoot\Assert.ps1"
$ErrorActionPreference = 'Stop'

$modulePath = Join-Path $PSScriptRoot '..\lib\ProjectValidation.psm1'
Import-Module $modulePath -Force -DisableNameChecking

$fixtureRoot = Join-Path $PSScriptRoot 'fixtures'
$nodePath = (Get-Command node -ErrorAction Stop).Source

$valid = Test-GeneratedProject -WorkspacePath (Join-Path $fixtureRoot 'valid-project') -NodePath $nodePath
Assert-Equal $valid.Passed $true
Assert-Equal $valid.NodeExitCode 0
Assert-Equal $valid.Failures.Count 0

$relativePathTestRoot = Join-Path $env:TEMP ("project-relative-test-{0}" -f [guid]::NewGuid().ToString('N'))
try {
    Copy-Item -LiteralPath (Join-Path $fixtureRoot 'valid-project') -Destination $relativePathTestRoot -Recurse
    $relativePathTest = @'
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('loads application source relative to the project root', () => {
  const source = fs.readFileSync('app/js/domain.js', 'utf8');
  assert.match(source, /use strict/);
});
'@
    [IO.File]::WriteAllText(
        (Join-Path $relativePathTestRoot 'app\tests\domain.test.js'),
        $relativePathTest,
        [Text.UTF8Encoding]::new($false)
    )
    $relativePathResult = Test-GeneratedProject -WorkspacePath $relativePathTestRoot -NodePath $nodePath
    Assert-Equal $relativePathResult.Passed $true
    Assert-Equal $relativePathResult.NodeExitCode 0
}
finally {
    if (Test-Path -LiteralPath $relativePathTestRoot) {
        Remove-Item -LiteralPath $relativePathTestRoot -Recurse -Force
    }
}

$contractTestRoot = Join-Path $env:TEMP ("project-contract-test-{0}" -f [guid]::NewGuid().ToString('N'))
try {
    Copy-Item -LiteralPath (Join-Path $fixtureRoot 'valid-project') -Destination $contractTestRoot -Recurse
    $requiredFiles = @(
        'app\index.html', 'app\assets\styles.css', 'app\js\domain.js',
        'app\js\demo-data.js', 'app\js\storage.js', 'app\js\app.js',
        'app\tests\domain.test.js', 'app\tests\storage.test.js', 'app\tests\ui-contract.test.js',
        'materials\content\manual.html', 'materials\content\application-info.html',
        'materials\content\runtime.html', 'materials\content\prototype.html'
    )
    foreach ($relativePath in $requiredFiles) {
        $fullPath = Join-Path $contractTestRoot $relativePath
        New-Item -ItemType Directory -Path (Split-Path $fullPath -Parent) -Force | Out-Null
        if (-not (Test-Path -LiteralPath $fullPath)) {
            [IO.File]::WriteAllText($fullPath, '', [Text.UTF8Encoding]::new($false))
        }
    }
    Remove-Item -LiteralPath (Join-Path $contractTestRoot 'app\js\storage.js') -Force
    $missingSupportFile = Test-GeneratedProject -WorkspacePath $contractTestRoot -NodePath $nodePath
    Assert-Equal $missingSupportFile.Passed $false
    Assert-Match $missingSupportFile.Summary ([regex]::Escape('app\js\storage.js'))
}
finally {
    if (Test-Path -LiteralPath $contractTestRoot) {
        Remove-Item -LiteralPath $contractTestRoot -Recurse -Force
    }
}

$applicantTestRoot = Join-Path $env:TEMP ("applicant-contract-test-{0}" -f [guid]::NewGuid().ToString('N'))
try {
    Copy-Item -LiteralPath (Join-Path $fixtureRoot 'valid-project') -Destination $applicantTestRoot -Recurse
    $incompleteApplicantInfo = (Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $applicantTestRoot 'materials\content\application-info.html')) + '<p>申请人：张三</p>'
    [IO.File]::WriteAllText(
        (Join-Path $applicantTestRoot 'materials\content\application-info.html'),
        $incompleteApplicantInfo,
        [Text.UTF8Encoding]::new($false)
    )
    $missingApplicantField = Test-GeneratedProject -WorkspacePath $applicantTestRoot -NodePath $nodePath
    Assert-Equal $missingApplicantField.Passed $false
    Assert-Match $missingApplicantField.Summary 'Applicant identity'
}
finally {
    if (Test-Path -LiteralPath $applicantTestRoot) {
        Remove-Item -LiteralPath $applicantTestRoot -Recurse -Force
    }
}

$semanticApplicantRoot = Join-Path $env:TEMP ("semantic-applicant-test-{0}" -f [guid]::NewGuid().ToString('N'))
try {
    Copy-Item -LiteralPath (Join-Path $fixtureRoot 'valid-project') -Destination $semanticApplicantRoot -Recurse
    $semanticApplicantInfo = (Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $semanticApplicantRoot 'materials\content\application-info.html')) + '<p>联系人：【申请人填写】</p>'
    [IO.File]::WriteAllText((Join-Path $semanticApplicantRoot 'materials\content\application-info.html'), $semanticApplicantInfo, [Text.UTF8Encoding]::new($false))
    $offlineAssertion = @'
const test = require('node:test');
const assert = require('node:assert/strict');
test('asserts that runtime text has no URL', () => assert.doesNotMatch('offline', /https?:\/\//));
'@
    [IO.File]::WriteAllText((Join-Path $semanticApplicantRoot 'app\tests\ui-contract.test.js'), $offlineAssertion, [Text.UTF8Encoding]::new($false))
    $semanticApplicantResult = Test-GeneratedProject -WorkspacePath $semanticApplicantRoot -NodePath $nodePath
    Assert-Equal $semanticApplicantResult.Passed $true
}
finally {
    if (Test-Path -LiteralPath $semanticApplicantRoot) { Remove-Item -LiteralPath $semanticApplicantRoot -Recurse -Force }
}

$simplifiedApplicationRoot = Join-Path $env:TEMP ("simplified-application-test-{0}" -f [guid]::NewGuid().ToString('N'))
try {
    Copy-Item -LiteralPath (Join-Path $fixtureRoot 'valid-project') -Destination $simplifiedApplicationRoot -Recurse
    $simplifiedApplication = '<table><tr><td>软件全称</td><td>示例软件</td></tr><tr><td>申请人</td><td>【申请人填写】</td></tr></table>'
    [IO.File]::WriteAllText(
        (Join-Path $simplifiedApplicationRoot 'materials\content\application-info.html'),
        $simplifiedApplication,
        [Text.UTF8Encoding]::new($false)
    )
    $simplifiedApplicationResult = Test-GeneratedProject -WorkspacePath $simplifiedApplicationRoot -NodePath $nodePath
    Assert-Equal $simplifiedApplicationResult.Passed $false
    Assert-Match $simplifiedApplicationResult.Summary '示例申请表'
}
finally {
    if (Test-Path -LiteralPath $simplifiedApplicationRoot) { Remove-Item -LiteralPath $simplifiedApplicationRoot -Recurse -Force }
}

$misleadingDatabaseRoot = Join-Path $env:TEMP ("misleading-database-test-{0}" -f [guid]::NewGuid().ToString('N'))
try {
    Copy-Item -LiteralPath (Join-Path $fixtureRoot 'valid-project') -Destination $misleadingDatabaseRoot -Recurse
    $misleadingRuntime = '<h1>运行环境</h1><p>服务器端数据库采用 MySQL 8.0。</p>'
    [IO.File]::WriteAllText(
        (Join-Path $misleadingDatabaseRoot 'materials\content\runtime.html'),
        $misleadingRuntime,
        [Text.UTF8Encoding]::new($false)
    )
    $misleadingDatabaseResult = Test-GeneratedProject -WorkspacePath $misleadingDatabaseRoot -NodePath $nodePath
    Assert-Equal $misleadingDatabaseResult.Passed $false
    Assert-Match $misleadingDatabaseResult.Summary '外部数据库'
}
finally {
    if (Test-Path -LiteralPath $misleadingDatabaseRoot) { Remove-Item -LiteralPath $misleadingDatabaseRoot -Recurse -Force }
}

$unlabeledDataModelRoot = Join-Path $env:TEMP ("unlabeled-data-model-test-{0}" -f [guid]::NewGuid().ToString('N'))
try {
    Copy-Item -LiteralPath (Join-Path $fixtureRoot 'valid-project') -Destination $unlabeledDataModelRoot -Recurse
    $unlabeledPrototype = '<h1>原型设计说明</h1><p>下图展示数据库表结构与实体关系。</p>'
    [IO.File]::WriteAllText(
        (Join-Path $unlabeledDataModelRoot 'materials\content\prototype.html'),
        $unlabeledPrototype,
        [Text.UTF8Encoding]::new($false)
    )
    $unlabeledDataModelResult = Test-GeneratedProject -WorkspacePath $unlabeledDataModelRoot -NodePath $nodePath
    Assert-Equal $unlabeledDataModelResult.Passed $false
    Assert-Match $unlabeledDataModelResult.Summary '逻辑数据模型'
}
finally {
    if (Test-Path -LiteralPath $unlabeledDataModelRoot) { Remove-Item -LiteralPath $unlabeledDataModelRoot -Recurse -Force }
}

$invalidCases = @{
    'missing-file' = 'required file';
    'software-name-mismatch' = 'software name';
    'missing-route' = 'four fixed routes';
    'forbidden-fetch' = 'network access';
    'invented-applicant' = 'applicant information must retain';
    'node-test-failure' = 'Node tests failed';
}
foreach ($case in $invalidCases.GetEnumerator()) {
    $result = Test-GeneratedProject -WorkspacePath (Join-Path $fixtureRoot "invalid-project\$($case.Key)") -NodePath $nodePath
    Assert-Equal $result.Passed $false
    Assert-Match $result.Summary $case.Value
}

$callCount = 0
$validatorResults = [Collections.Generic.Queue[object]]::new()
$validatorResults.Enqueue([pscustomobject]@{ Passed = $true; Failures = @(); NodeExitCode = 0; Summary = '' })
$firstPass = Invoke-GenerationWithRepair -Context ([pscustomobject]@{ WorkspacePath = 'C:\fake' }) -CodexPath 'C:\fake\codex.exe' -NodePath $nodePath `
    -GenerationInvoker { param($context, $path) $script:callCount++; [pscustomobject]@{ ExitCode = 0 } } `
    -RepairInvoker { param($context, $path, $summary) $script:callCount++; [pscustomobject]@{ ExitCode = 0 } } `
    -Validator { param($workspace, $node) $validatorResults.Dequeue() }
Assert-Equal $firstPass.Passed $true
Assert-Equal $firstPass.CodexCallCount 1
Assert-Equal $callCount 1
Assert-Equal ($firstPass.States -join ',') 'Generated,Validated'

$callCount = 0
$validatorResults = [Collections.Generic.Queue[object]]::new()
$validatorResults.Enqueue([pscustomobject]@{ Passed = $false; Failures = @('first'); NodeExitCode = 1; Summary = 'first' })
$validatorResults.Enqueue([pscustomobject]@{ Passed = $true; Failures = @(); NodeExitCode = 0; Summary = '' })
$repairPass = Invoke-GenerationWithRepair -Context ([pscustomobject]@{ WorkspacePath = 'C:\fake' }) -CodexPath 'C:\fake\codex.exe' -NodePath $nodePath `
    -GenerationInvoker { param($context, $path) $script:callCount++; [pscustomobject]@{ ExitCode = 0 } } `
    -RepairInvoker { param($context, $path, $summary) $script:callCount++; Assert-Equal $summary 'first'; [pscustomobject]@{ ExitCode = 0 } } `
    -Validator { param($workspace, $node) $validatorResults.Dequeue() }
Assert-Equal $repairPass.Passed $true
Assert-Equal $repairPass.CodexCallCount 2
Assert-Equal $callCount 2
Assert-Equal ($repairPass.States -join ',') 'Generated,Repairing,Validated'

$callCount = 0
$validatorResults = [Collections.Generic.Queue[object]]::new()
$validatorResults.Enqueue([pscustomobject]@{ Passed = $false; Failures = @('first'); NodeExitCode = 1; Summary = 'first' })
$validatorResults.Enqueue([pscustomobject]@{ Passed = $false; Failures = @('second'); NodeExitCode = 1; Summary = 'second' })
$repairFailure = Invoke-GenerationWithRepair -Context ([pscustomobject]@{ WorkspacePath = 'C:\fake' }) -CodexPath 'C:\fake\codex.exe' -NodePath $nodePath `
    -GenerationInvoker { param($context, $path) $script:callCount++; [pscustomobject]@{ ExitCode = 0 } } `
    -RepairInvoker { param($context, $path, $summary) $script:callCount++; [pscustomobject]@{ ExitCode = 0 } } `
    -Validator { param($workspace, $node) $validatorResults.Dequeue() }
Assert-Equal $repairFailure.Passed $false
Assert-Equal $repairFailure.CodexCallCount 2
Assert-Equal $callCount 2
Assert-Equal ($repairFailure.States -join ',') 'Generated,Repairing,Validated'
