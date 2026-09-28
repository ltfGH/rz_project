Set-StrictMode -Version Latest

$script:ThemeValidatorPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'theme-profile\validator.cjs'
$script:ThemeContractPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'config\theme-profile-contract.md'
$script:SeedVocabularyTargets = [ordered]@{
    asset_names = 'asset'
    material_names = 'material'
    project_names = 'project'
    application_titles = 'application'
    inspection_titles = 'inspection_task'
    work_order_titles = 'work_order'
    findings = 'inspection_item'
}

function Get-AllowedThemeSeedVocabularyKeys {
    param([Parameter(Mandatory)]$Template)
    $entities = @($Template.aliasableEntities)
    return @($script:SeedVocabularyTargets.Keys | Where-Object { $entities -ccontains $script:SeedVocabularyTargets[$_] })
}

function Invoke-ThemeValidatorProcess {
    param([Parameter(Mandatory)][string]$ProfilePath)

    $node = (Get-Command node -ErrorAction Stop).Source
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $node
    $start.Arguments = ('"{0}" --profile "{1}"' -f $script:ThemeValidatorPath, $ProfilePath)
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.StandardOutputEncoding = [Text.UTF8Encoding]::new($false)
    $start.StandardErrorEncoding = [Text.UTF8Encoding]::new($false)
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $start
    try {
        if (-not $process.Start()) { throw 'Theme profile validator did not start.' }
        $stdout = $process.StandardOutput.ReadToEnd()
        [void]$process.StandardError.ReadToEnd()
        $process.WaitForExit()
        if ($process.ExitCode -notin @(0, 1)) { throw 'Theme profile validator invocation failed.' }
        try { return $stdout | ConvertFrom-Json -ErrorAction Stop }
        catch { throw 'Theme profile validator returned invalid JSON.' }
    }
    finally { $process.Dispose() }
}

function Test-ThemeProfile {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)]$Template)

    if (-not [IO.Path]::IsPathRooted($Path)) { throw 'Theme profile path must be absolute.' }
    $profilePath = [IO.Path]::GetFullPath($Path)
    if (-not (Test-Path -LiteralPath $profilePath -PathType Leaf)) { throw 'Theme profile file does not exist.' }
    $result = Invoke-ThemeValidatorProcess $profilePath
    $issues = [Collections.Generic.List[string]]::new()
    foreach ($issue in @($result.issues)) { $issues.Add([string]$issue) }
    if ([bool]$result.valid) {
        $allowedEntities = @($Template.aliasableEntities)
        foreach ($id in @($result.profile.entityAliases.PSObject.Properties | ForEach-Object Name)) {
            if ($allowedEntities -cnotcontains $id) { $issues.Add("entityAliases/${id}: alias id is not allowed for this template") }
        }
        $allowedModules = @($Template.aliasableModules)
        foreach ($id in @($result.profile.moduleAliases.PSObject.Properties | ForEach-Object Name)) {
            if ($allowedModules -cnotcontains $id) { $issues.Add("moduleAliases/${id}: alias id is not allowed for this template") }
        }
        $allowedVocabulary = @(Get-AllowedThemeSeedVocabularyKeys -Template $Template)
        foreach ($id in @($result.profile.seedVocabulary.PSObject.Properties | ForEach-Object Name)) {
            if ($allowedVocabulary -cnotcontains $id) { $issues.Add("seedVocabulary/${id}: vocabulary key is not allowed for this template") }
        }
    }
    $passed = [bool]$result.valid -and $issues.Count -eq 0
    return [pscustomobject]@{
        Passed = $passed
        Profile = if ($passed) { $result.profile } else { $null }
        Issues = @($issues | Sort-Object -Unique)
    }
}

function New-ThemeProfilePrompt {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Context, [Parameter(Mandatory)]$Template, [string]$FailureSummary)

    $contract = Get-Content -Raw -Encoding UTF8 -LiteralPath $script:ThemeContractPath
    $allowedVocabulary = @(Get-AllowedThemeSeedVocabularyKeys -Template $Template)
    $vocabularyLine = if ($allowedVocabulary.Count -eq 0) {
        'Allowed seed vocabulary keys: none. Use an empty object.'
    }
    else {
        $exampleKey = $allowedVocabulary[0]
        'Allowed seed vocabulary keys: {0}. Valid shape example: "seedVocabulary":{{"{1}":["Example Name"]}}' -f ($allowedVocabulary -join ', '),$exampleKey
    }
    $prompt = @"
Create the presentation profile for this supported standard business application.
Theme: $($Context.Theme)
Software name: $($Context.SoftwareName)
Template id: $($Template.id)
Allowed entity alias ids: $($Template.aliasableEntities -join ', ')
Allowed module alias ids: $($Template.aliasableModules -join ', ')
$vocabularyLine

Do not change stable ids, fields, permissions, states, transitions, migrations, commands or transactions.

$contract
"@
    if (-not [string]::IsNullOrWhiteSpace($FailureSummary)) {
        $limited = $FailureSummary.Substring(0, [Math]::Min(2000, $FailureSummary.Length))
        $prompt += "`nRepair the existing theme-profile.json using only these validation issues:`n$limited`n"
    }
    return $prompt
}

function Invoke-DefaultThemeProfileCodex {
    param($Context, $Template, [string]$OutputPath, [string]$FailureSummary, [string]$CodexPath)

    if (-not [IO.Path]::IsPathRooted($CodexPath) -or -not (Test-Path -LiteralPath $CodexPath -PathType Leaf)) {
        throw 'Codex executable does not exist.'
    }
    $staging = Split-Path -Parent $OutputPath
    $token = [guid]::NewGuid().ToString('N')
    $promptPath = Join-Path $Context.WorkspacePath "theme-profile-$token.prompt.md"
    $lastMessagePath = Join-Path $Context.WorkspacePath "theme-profile-$token.last-message.md"
    $stdoutPath = Join-Path $Context.WorkspacePath "theme-profile-$token.stdout.log"
    $stderrPath = Join-Path $Context.WorkspacePath "theme-profile-$token.stderr.log"
    [IO.File]::WriteAllText($promptPath, (New-ThemeProfilePrompt -Context $Context -Template $Template -FailureSummary $FailureSummary), [Text.UTF8Encoding]::new($false))
    try {
        $arguments = @(
            '--ask-for-approval', 'never', '--sandbox', 'workspace-write', 'exec', '--ephemeral',
            '--skip-git-repo-check', '--cd', $staging, '--output-last-message', $lastMessagePath, '-'
        )
        $previousPreference = $ErrorActionPreference
        $previousEncoding = $OutputEncoding
        try {
            $ErrorActionPreference = 'Continue'
            $OutputEncoding = [Text.UTF8Encoding]::new($false)
            Get-Content -Raw -Encoding UTF8 -LiteralPath $promptPath |
                & $CodexPath @arguments 1> $stdoutPath 2> $stderrPath
            $nativeExit = Get-Variable -Name LASTEXITCODE -ValueOnly -ErrorAction SilentlyContinue
            if ($null -eq $nativeExit) { return 0 }
            return [int]$nativeExit
        }
        finally {
            $ErrorActionPreference = $previousPreference
            $OutputEncoding = $previousEncoding
        }
    }
    finally {
        Remove-Item -LiteralPath $promptPath, $lastMessagePath, $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-ThemeProfileGeneration {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]$Context,
        [Parameter(Mandatory)]$Template,
        [Parameter(Mandatory)][string]$CodexPath,
        [scriptblock]$CodexInvoker
    )

    if (-not (Test-Path -LiteralPath $Context.WorkspacePath -PathType Container)) { throw 'Theme profile workspace does not exist.' }
    if ($null -eq $CodexInvoker) { $CodexInvoker = ${function:Invoke-DefaultThemeProfileCodex} }
    $staging = Join-Path $Context.WorkspacePath ('theme-profile-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $staging | Out-Null
    $outputPath = Join-Path $staging 'theme-profile.json'
    $failureSummary = ''
    try {
        for ($attempt = 0; $attempt -lt 2; $attempt++) {
            Remove-Item -LiteralPath $outputPath -Force -ErrorAction SilentlyContinue
            $exitCode = [int](& $CodexInvoker $Context $Template $outputPath $failureSummary $CodexPath)
            if ($exitCode -ne 0) { throw 'Theme profile generation failed.' }
            $unexpected = @(Get-ChildItem -LiteralPath $staging -Force | Where-Object Name -cne 'theme-profile.json')
            if ($unexpected.Count -gt 0) { throw 'Theme profile generation created unexpected files.' }
            $validation = Test-ThemeProfile -Path $outputPath -Template $Template
            if ($validation.Passed) {
                return [pscustomobject]@{ Path = $outputPath; Profile = $validation.Profile; Issues = @() }
            }
            $failureSummary = (@($validation.Issues) -join '; ').Replace([string]$Context.WorkspacePath, '<workspace>')
            if ($failureSummary.Length -gt 2000) { $failureSummary = $failureSummary.Substring(0, 2000) }
        }
        throw "Theme profile validation failed after one repair attempt: $failureSummary"
    }
    catch {
        Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
        throw
    }
}

Export-ModuleMember -Function Test-ThemeProfile, New-ThemeProfilePrompt, Invoke-ThemeProfileGeneration
