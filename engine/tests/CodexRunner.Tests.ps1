. "$PSScriptRoot\Assert.ps1"
$ErrorActionPreference = 'Stop'

$modulePath = Join-Path $PSScriptRoot '..\lib\CodexRunner.psm1'
Import-Module $modulePath -Force -DisableNameChecking

$testRoot = Join-Path $env:TEMP ("codex-runner-test-{0}" -f [guid]::NewGuid().ToString('N'))
try {
    $workspacePath = Join-Path $testRoot 'workspace'
    $fakeRoot = Join-Path $testRoot 'fake-observation'
    New-Item -ItemType Directory -Path $workspacePath, $fakeRoot -Force | Out-Null

    $fakeCodexPath = Join-Path $testRoot 'fake-codex.ps1'
$fakeCodexScript = @'
param()

$ErrorActionPreference = 'Continue'

$receivedArgs = [string]::Join("`n", $args)
[IO.File]::WriteAllText((Join-Path $env:FAKE_CODEX_ROOT 'arguments.txt'), $receivedArgs, [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $env:FAKE_CODEX_ROOT 'stdin.txt'), ($input | Out-String), [Text.UTF8Encoding]::new($false))

$lastMessageIndex = [Array]::IndexOf($args, '--output-last-message')
if ($lastMessageIndex -ge 0) {
    [IO.File]::WriteAllText($args[$lastMessageIndex + 1], 'fake last message', [Text.UTF8Encoding]::new($false))
}

Write-Output 'fake standard output'
Write-Error 'fake standard error'
'@
    $fakeCodexScript | Set-Content -LiteralPath $fakeCodexPath -Encoding UTF8

    $context = [pscustomobject]@{
        Theme = '设备点检记录管理'
        SoftwareName = '设备点检记录管理软件'
        RunId = 'runner-test'
        WorkspacePath = $workspacePath
    }

    $env:FAKE_CODEX_ROOT = $fakeRoot
    $generation = Invoke-CodexGeneration -Context $context -CodexPath $fakeCodexPath
    Assert-Equal $generation.ExitCode 0
    Assert-Equal (Test-Path -LiteralPath $generation.LastMessagePath -PathType Leaf) $true
    Assert-Equal (Test-Path -LiteralPath $generation.TranscriptPath -PathType Leaf) $true

    $generationArguments = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $fakeRoot 'arguments.txt')
    $expectedGenerationArguments = @(
        '--ask-for-approval', 'never', '--sandbox', 'workspace-write', 'exec',
        '--ephemeral', '--skip-git-repo-check', '--cd', $workspacePath, '--output-last-message',
        $generation.LastMessagePath, '-'
    )
    Assert-Equal (($generationArguments.TrimEnd("`r", "`n") -split "`r?`n") -join '|') ($expectedGenerationArguments -join '|')
    $generationPrompt = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $fakeRoot 'stdin.txt')
    Assert-Match $generationPrompt '设备点检记录管理软件'
    Assert-Match $generationPrompt '#dashboard'
    Assert-Match $generationPrompt '#records'
    Assert-Match $generationPrompt '#operation'
    Assert-Match $generationPrompt '#history'
    Assert-Match $generationPrompt 'Do not use network access'
    $applicantPlaceholder = -join [char[]](0x3010, 0x7533, 0x8BF7, 0x4EBA, 0x586B, 0x5199, 0x3011)
    Assert-Match $generationPrompt $applicantPlaceholder
    Assert-Match $generationPrompt 'app/index\.html must visibly contain this exact software name: 设备点检记录管理软件'
    Assert-Match $generationPrompt 'app/index.html'
    Assert-Match $generationPrompt 'node --test app/tests/domain.test.js app/tests/storage.test.js app/tests/ui-contract.test.js'
    $generationTranscript = Get-Content -Raw -Encoding UTF8 -LiteralPath $generation.TranscriptPath
    Assert-Match $generationTranscript 'fake standard output'
    Assert-Match $generationTranscript 'fake standard error'

    Remove-Item -LiteralPath (Join-Path $fakeRoot 'arguments.txt'), (Join-Path $fakeRoot 'stdin.txt') -Force
    $failureSummary = 'x' * 5000
    $repair = Invoke-CodexRepair -Context $context -CodexPath $fakeCodexPath -FailureSummary $failureSummary
    Assert-Equal $repair.ExitCode 0
    $repairArguments = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $fakeRoot 'arguments.txt')
    $expectedRepairArguments = @(
        '--ask-for-approval', 'never', '--sandbox', 'workspace-write', 'exec',
        '--ephemeral', '--skip-git-repo-check', '--cd', $workspacePath, '--output-last-message',
        $repair.LastMessagePath, '-'
    )
    Assert-Equal (($repairArguments.TrimEnd("`r", "`n") -split "`r?`n") -join '|') ($expectedRepairArguments -join '|')
    $repairPrompt = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $fakeRoot 'stdin.txt')
    Assert-Match $repairPrompt 'Repair the current project'
    Assert-Match $repairPrompt ('x' * 4000)
    $overlongSummary = [string]::new([char]120, 4001)
    Assert-Equal ($repairPrompt.Contains($overlongSummary)) $false

    $nativeCodexPath = Join-Path $testRoot 'native-codex.cmd'
    @'
@echo off
echo native diagnostic 1>&2
exit /b 7
'@ | Set-Content -LiteralPath $nativeCodexPath -Encoding ASCII
    $nativeResult = Invoke-CodexGeneration -Context $context -CodexPath $nativeCodexPath
    Assert-Equal $nativeResult.ExitCode 7
    Assert-Match (Get-Content -Raw -Encoding utf8 -LiteralPath $nativeResult.TranscriptPath) 'native diagnostic'

    $env:NATIVE_CODEX_STDIN_PATH = Join-Path $testRoot 'native-stdin.txt'
    $nativeStdinCodexPath = Join-Path $testRoot 'native-stdin-codex.cmd'
    @'
const fs = require('node:fs');
fs.writeFileSync(process.env.NATIVE_CODEX_STDIN_PATH, fs.readFileSync(0));
'@ | Set-Content -LiteralPath (Join-Path $testRoot 'capture-stdin.js') -Encoding ASCII
    @'
@echo off
node "%~dp0capture-stdin.js"
'@ | Set-Content -LiteralPath $nativeStdinCodexPath -Encoding ASCII
    $nativeStdinResult = Invoke-CodexGeneration -Context $context -CodexPath $nativeStdinCodexPath
    Assert-Equal $nativeStdinResult.ExitCode 0
    $nativePromptBytes = [IO.File]::ReadAllBytes($env:NATIVE_CODEX_STDIN_PATH)
    $nativePrompt = [Text.UTF8Encoding]::new($false, $true).GetString($nativePromptBytes)
    Assert-Match $nativePrompt '设备点检记录管理软件'
    Assert-Match $nativePrompt '【申请人填写】'
}
finally {
    Remove-Item Env:\FAKE_CODEX_ROOT -ErrorAction SilentlyContinue
    Remove-Item Env:\NATIVE_CODEX_STDIN_PATH -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}
