Set-StrictMode -Version Latest

function Get-InteractionReader {
    param([scriptblock]$Reader)
    if ($null -ne $Reader) { return $Reader }
    return { param([string]$Prompt) Read-Host $Prompt }
}

function Resolve-GenerationMode {
    [CmdletBinding()]
    param([AllowEmptyString()][string]$Mode, [scriptblock]$Reader)

    $value = if ([string]::IsNullOrWhiteSpace($Mode)) {
        $read = Get-InteractionReader $Reader
        [string](& $read '[mode] 1=StandardBusiness, 2=LegacyDemo (default 1)')
    } else { $Mode }
    switch ($value.Trim().ToLowerInvariant()) {
        '' { return 'StandardBusiness' }
        '1' { return 'StandardBusiness' }
        'standard' { return 'StandardBusiness' }
        'standardbusiness' { return 'StandardBusiness' }
        '2' { return 'LegacyDemo' }
        'legacy' { return 'LegacyDemo' }
        'legacydemo' { return 'LegacyDemo' }
        default { throw "GenerationMode '$value' is not supported." }
    }
}

function Select-StandardBusinessTemplate {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Theme,
        [Parameter(Mandatory)][object[]]$Templates,
        [string]$TemplateId,
        [scriptblock]$Reader,
        [switch]$NonInteractive
    )

    if (-not [string]::IsNullOrWhiteSpace($TemplateId)) {
        $matched = @($Templates | Where-Object id -CEQ $TemplateId)
        if ($matched.Count -ne 1) { throw "TemplateId '$TemplateId' is not supported." }
        return $matched[0]
    }
    if ($NonInteractive) { throw 'TemplateId is required for non-interactive standard generation.' }

    $recommendation = Get-StandardBusinessRecommendation -Theme $Theme -Templates $Templates
    $candidates = @($recommendation.candidates)
    if ($candidates.Count -eq 0) { throw 'No standard business templates are available.' }
    for ($index = 0; $index -lt $candidates.Count; $index++) {
        $candidate = $candidates[$index]
        Write-Host ('{0}. {1} [{2}] - {3}' -f ($index + 1), $candidate.name, $candidate.id, $candidate.workflowSummary)
    }

    $read = Get-InteractionReader $Reader
    while ($true) {
        $answer = [string](& $read "[template] Select 1-$($candidates.Count) or template id (default 1)")
        if ([string]::IsNullOrWhiteSpace($answer)) { return $candidates[0] }
        $number = 0
        if ([int]::TryParse($answer, [ref]$number) -and $number -ge 1 -and $number -le $candidates.Count) {
            return $candidates[$number - 1]
        }
        $byId = @($candidates | Where-Object id -CEQ $answer.Trim())
        if ($byId.Count -eq 1) { return $byId[0] }
        Write-Host 'Invalid template selection.'
    }
}

function Confirm-GenerationSummary {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Theme,
        [Parameter(Mandatory)]$Template,
        [scriptblock]$Reader,
        [switch]$NonInteractive
    )

    if ($NonInteractive) { return $true }
    Write-Host "Theme: $Theme"
    Write-Host "Template: $($Template.name) [$($Template.id)]"
    Write-Host "Entities: $($Template.primaryEntities -join ', ')"
    Write-Host "Roles: $($Template.roles -join ', ')"
    Write-Host "Workflow: $($Template.workflowSummary)"
    Write-Host "Views: $($Template.viewRange.minimum)-$($Template.viewRange.maximum)"
    $read = Get-InteractionReader $Reader
    $answer = [string](& $read '[confirm] Continue? y/N')
    if ($answer.Trim().ToLowerInvariant() -notin @('1', 'y', 'yes')) { throw 'Generation was cancelled by the user.' }
    return $true
}

function Resolve-GenerationRequest {
    [CmdletBinding()]
    param(
        [AllowEmptyString()][string]$Mode,
        [AllowEmptyString()][string]$Theme,
        [string]$TemplateId,
        [Parameter(Mandatory)][object[]]$Templates,
        [scriptblock]$Reader,
        [switch]$NonInteractive
    )

    $resolvedMode = if ($NonInteractive) {
        if ([string]::IsNullOrWhiteSpace($Mode)) { throw 'GenerationMode is required for non-interactive generation.' }
        Resolve-GenerationMode -Mode $Mode
    } else {
        Resolve-GenerationMode -Mode $Mode -Reader $Reader
    }

    $resolvedTheme = $Theme.Trim()
    if ([string]::IsNullOrWhiteSpace($resolvedTheme) -and -not $NonInteractive) {
        $read = Get-InteractionReader $Reader
        $resolvedTheme = ([string](& $read '[theme] Enter software theme')).Trim()
    }
    if ([string]::IsNullOrWhiteSpace($resolvedTheme)) { throw 'Theme is required.' }

    if ($resolvedMode -eq 'LegacyDemo') {
        return [pscustomobject]@{ mode = $resolvedMode; theme = $resolvedTheme; template = $null }
    }

    $template = Select-StandardBusinessTemplate -Theme $resolvedTheme -Templates $Templates `
        -TemplateId $TemplateId -Reader $Reader -NonInteractive:$NonInteractive
    [void](Confirm-GenerationSummary -Theme $resolvedTheme -Template $template -Reader $Reader -NonInteractive:$NonInteractive)
    return [pscustomobject]@{ mode = $resolvedMode; theme = $resolvedTheme; template = $template }
}

Export-ModuleMember -Function Resolve-GenerationMode, Select-StandardBusinessTemplate, Confirm-GenerationSummary, Resolve-GenerationRequest
