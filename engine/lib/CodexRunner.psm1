Set-StrictMode -Version Latest

$contractPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'config\generation-contract.md'

function New-CodexPrompt {
    param(
        [Parameter(Mandatory)][pscustomobject]$Context,
        [string]$FailureSummary
    )

    $contract = Get-Content -Raw -Encoding UTF8 -LiteralPath $contractPath
    $applicantPlaceholder = -join [char[]](0x3010, 0x7533, 0x8BF7, 0x4EBA, 0x586B, 0x5199, 0x3011)
    $prompt = @"
Generate the isolated offline project for: $($Context.SoftwareName)
Workspace: $($Context.WorkspacePath)

Follow this contract exactly:
$contract

The generated applicant-information fields must retain this exact marker: $applicantPlaceholder
app/index.html must visibly contain this exact software name: $($Context.SoftwareName)
Do not use network access or access any path outside the workspace.
"@

    if (-not [string]::IsNullOrWhiteSpace($FailureSummary)) {
        $limitedSummary = $FailureSummary.Substring(0, [Math]::Min($FailureSummary.Length, 4000))
        $prompt += @"

Repair the current project. This is the only repair attempt. Address this validation failure summary:
$limitedSummary
"@
    }

    return $prompt
}

function Invoke-CodexProcess {
    param(
        [Parameter(Mandatory)][pscustomobject]$Context,
        [Parameter(Mandatory)][string]$CodexPath,
        [string]$FailureSummary,
        [Parameter(Mandatory)][string]$OperationName
    )

    $workspacePath = [IO.Path]::GetFullPath($Context.WorkspacePath)
    if (-not (Test-Path -LiteralPath $workspacePath -PathType Container)) {
        throw "Codex workspace does not exist: $workspacePath"
    }
    if (-not (Test-Path -LiteralPath $CodexPath -PathType Leaf)) {
        throw "Codex executable does not exist: $CodexPath"
    }

    $token = [guid]::NewGuid().ToString('N')
    $promptPath = Join-Path $workspacePath "codex-$OperationName-$token.prompt.md"
    $lastMessagePath = Join-Path $workspacePath "codex-$OperationName-$token.last-message.md"
    $standardOutputPath = Join-Path $workspacePath "codex-$OperationName-$token.stdout.log"
    $standardErrorPath = Join-Path $workspacePath "codex-$OperationName-$token.stderr.log"
    $transcriptPath = Join-Path $workspacePath "codex-$OperationName-$token.transcript.log"
    $prompt = New-CodexPrompt -Context $Context -FailureSummary $FailureSummary

    [IO.File]::WriteAllText($promptPath, $prompt, [Text.UTF8Encoding]::new($false))
    try {
        $arguments = @(
            '--ask-for-approval', 'never', '--sandbox', 'workspace-write', 'exec',
            '--ephemeral', '--skip-git-repo-check', '--cd', $workspacePath,
            '--output-last-message', $lastMessagePath, '-'
        )
        $previousErrorActionPreference = $ErrorActionPreference
        $previousOutputEncoding = $OutputEncoding
        try {
            # Native CLIs routinely use stderr for diagnostics. PowerShell 5.1
            # must not promote that stream to a terminating NativeCommandError.
            $ErrorActionPreference = 'Continue'
            # PowerShell 5.1 otherwise encodes piped strings using its legacy
            # ASCII default, replacing every Chinese contract character with '?'.
            $OutputEncoding = [Text.UTF8Encoding]::new($false)
            Get-Content -Raw -Encoding UTF8 -LiteralPath $promptPath |
                & $CodexPath @arguments 1> $standardOutputPath 2> $standardErrorPath
            $nativeExitCode = Get-Variable -Name LASTEXITCODE -ValueOnly -ErrorAction SilentlyContinue
            $exitCode = if ($null -eq $nativeExitCode) { 0 } else { $nativeExitCode }
        }
        finally {
            $ErrorActionPreference = $previousErrorActionPreference
            $OutputEncoding = $previousOutputEncoding
        }

        $standardOutput = if (Test-Path -LiteralPath $standardOutputPath) {
            Get-Content -Raw -Encoding UTF8 -LiteralPath $standardOutputPath
        } else { '' }
        $standardError = if (Test-Path -LiteralPath $standardErrorPath) {
            Get-Content -Raw -Encoding UTF8 -LiteralPath $standardErrorPath
        } else { '' }
        [IO.File]::WriteAllText(
            $transcriptPath,
            "[stdout]`r`n$standardOutput`r`n[stderr]`r`n$standardError",
            [Text.UTF8Encoding]::new($false)
        )

        return [pscustomobject]@{
            ExitCode = $exitCode
            LastMessagePath = $lastMessagePath
            TranscriptPath = $transcriptPath
        }
    }
    finally {
        Remove-Item -LiteralPath $promptPath -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $standardOutputPath, $standardErrorPath -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-CodexGeneration {
    param(
        [Parameter(Mandatory)][pscustomobject]$Context,
        [Parameter(Mandatory)][string]$CodexPath
    )

    return Invoke-CodexProcess -Context $Context -CodexPath $CodexPath -OperationName 'generation'
}

function Invoke-CodexRepair {
    param(
        [Parameter(Mandatory)][pscustomobject]$Context,
        [Parameter(Mandatory)][string]$CodexPath,
        [Parameter(Mandatory)][string]$FailureSummary
    )

    return Invoke-CodexProcess -Context $Context -CodexPath $CodexPath -FailureSummary $FailureSummary -OperationName 'repair'
}

Export-ModuleMember -Function Invoke-CodexGeneration, Invoke-CodexRepair
