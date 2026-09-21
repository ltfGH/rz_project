Set-StrictMode -Version Latest

$script:DefaultCatalogPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'config\standard-business-templates.json'
$script:MinimumScore = 5
$script:CloseScoreDelta = 2
$script:ProductionPacks = @(
    'application_archive', 'asset_inspection_bridge', 'asset_registry', 'asset_work_order_bridge',
    'domain_document_bridge', 'inspection_rectification', 'inspection_work_order_bridge',
    'inventory_application_bridge', 'inventory_batch', 'project_archive_bridge', 'project_task',
    'work_order_service'
)
$script:ExpectedTemplateIds = @(
    'application_approval_archive', 'asset_inspection_management', 'asset_inspection_rectification',
    'asset_work_order_operations', 'inspection_rectification_orders', 'inventory_application_approval',
    'project_delivery_archive', 'project_task_management'
)

function Assert-ExactProperties {
    param([Parameter(Mandatory)]$Value, [Parameter(Mandatory)][string[]]$Allowed, [Parameter(Mandatory)][string]$Path)
    $actual = @($Value.PSObject.Properties.Name)
    foreach ($name in $actual) {
        if ($Allowed -cnotcontains $name) { throw "$Path has unknown property '$name'." }
    }
    foreach ($name in $Allowed) {
        if ($actual -cnotcontains $name) { throw "$Path is missing property '$name'." }
    }
}

function Assert-NonEmptyText {
    param($Value, [string]$Path)
    if ($Value -isnot [string] -or [string]::IsNullOrWhiteSpace($Value)) { throw "$Path must be non-empty text." }
}

function Get-StandardBusinessTemplates {
    [CmdletBinding()]
    param([string]$CatalogPath = $script:DefaultCatalogPath)

    $path = [IO.Path]::GetFullPath($CatalogPath)
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Template catalog does not exist: $path" }
    try { $catalog = Get-Content -Raw -Encoding UTF8 -LiteralPath $path | ConvertFrom-Json -ErrorAction Stop }
    catch { throw "Template catalog is invalid JSON: $($_.Exception.Message)" }
    Assert-ExactProperties $catalog @('catalogVersion', 'minimumScore', 'closeScoreDelta', 'templates') 'catalog'
    if ($catalog.catalogVersion -cne '1.0') { throw 'Template catalog version must be 1.0.' }
    if ($catalog.minimumScore -isnot [int] -or $catalog.minimumScore -lt 1) { throw 'minimumScore must be a positive integer.' }
    if ($catalog.closeScoreDelta -isnot [int] -or $catalog.closeScoreDelta -lt 0) { throw 'closeScoreDelta must be a non-negative integer.' }
    $script:MinimumScore = [int]$catalog.minimumScore
    $script:CloseScoreDelta = [int]$catalog.closeScoreDelta

    $templates = @($catalog.templates)
    if ($templates.Count -ne 8) { throw 'Template catalog must contain exactly eight templates.' }
    $seenIds = @{}
    foreach ($template in $templates) {
        $pathPrefix = "template[$($template.id)]"
        Assert-ExactProperties $template @('id', 'name', 'packs', 'keywords', 'primaryEntities', 'aliasableEntities', 'aliasableModules', 'roles', 'workflowSummary', 'viewRange') $pathPrefix
        Assert-NonEmptyText $template.id "$pathPrefix.id"
        if ($template.id -notmatch '^[a-z][a-z0-9_]{2,63}$') { throw "$pathPrefix.id is invalid." }
        if ($seenIds.ContainsKey($template.id)) { throw "Duplicate template id '$($template.id)'." }
        $seenIds[$template.id] = $true
        Assert-NonEmptyText $template.name "$pathPrefix.name"
        Assert-NonEmptyText $template.workflowSummary "$pathPrefix.workflowSummary"

        $packs = @($template.packs)
        if ($packs.Count -eq 0 -or @($packs | Sort-Object -Unique).Count -ne $packs.Count) { throw "$pathPrefix.packs must be non-empty and unique." }
        foreach ($pack in $packs) {
            if ($script:ProductionPacks -cnotcontains $pack) { throw "$pathPrefix references non-production pack '$pack'." }
        }

        $keywords = @($template.keywords)
        if ($keywords.Count -eq 0) { throw "$pathPrefix.keywords must not be empty." }
        $seenKeywords = @{}
        foreach ($keyword in $keywords) {
            Assert-ExactProperties $keyword @('value', 'weight') "$pathPrefix.keyword"
            Assert-NonEmptyText $keyword.value "$pathPrefix.keyword.value"
            $normalizedKeyword = $keyword.value.Trim().ToLowerInvariant()
            if ($seenKeywords.ContainsKey($normalizedKeyword)) { throw "$pathPrefix has duplicate keyword '$normalizedKeyword'." }
            $seenKeywords[$normalizedKeyword] = $true
            if ($keyword.weight -isnot [int] -or $keyword.weight -le 0 -or $keyword.weight -gt 100) { throw "$pathPrefix keyword weight is invalid." }
        }

        foreach ($collectionName in @('primaryEntities', 'aliasableEntities', 'aliasableModules', 'roles')) {
            $values = @($template.$collectionName)
            if ($values.Count -eq 0 -or @($values | Sort-Object -Unique).Count -ne $values.Count) { throw "$pathPrefix.$collectionName must be non-empty and unique." }
            foreach ($value in $values) {
                Assert-NonEmptyText $value "$pathPrefix.$collectionName"
                if ($collectionName -ne 'roles' -and $value -notmatch '^[a-z][a-z0-9_]{1,63}$') {
                    throw "$pathPrefix.$collectionName contains an invalid id."
                }
            }
        }

        Assert-ExactProperties $template.viewRange @('minimum', 'maximum') "$pathPrefix.viewRange"
        if ($template.viewRange.minimum -isnot [int] -or $template.viewRange.maximum -isnot [int] -or
            $template.viewRange.minimum -lt 1 -or $template.viewRange.maximum -lt $template.viewRange.minimum) {
            throw "$pathPrefix.viewRange is invalid."
        }
    }

    $sorted = @($templates | Sort-Object id)
    if (($sorted.id -join ',') -cne ($script:ExpectedTemplateIds -join ',')) { throw 'Template catalog ids do not match the supported template set.' }
    return $sorted
}

function Get-StandardBusinessRecommendation {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Theme,
        [Parameter(Mandatory)][object[]]$Templates
    )

    $normalizedTheme = ($Theme.Trim().ToLowerInvariant() -replace '\s+', '')
    if ([string]::IsNullOrWhiteSpace($normalizedTheme)) { throw 'Theme must not be empty.' }
    $ranked = @($Templates | ForEach-Object {
        $template = $_
        $matches = @($template.keywords | Where-Object { $normalizedTheme.Contains($_.value.Trim().ToLowerInvariant()) })
        $score = 0
        foreach ($match in $matches) { $score += [int]$match.weight }
        [pscustomobject]@{
            template = $template
            score = $score
            matchCount = $matches.Count
            packCount = @($template.packs).Count
            keywords = @($matches | ForEach-Object value)
        }
    } | Sort-Object @{ Expression = 'score'; Descending = $true }, @{ Expression = 'matchCount'; Descending = $true }, @{ Expression = 'packCount'; Descending = $true }, @{ Expression = { $_.template.id }; Descending = $false })

    $scores = @($ranked | ForEach-Object { [pscustomobject]@{ id = $_.template.id; score = $_.score } })
    if ($ranked.Count -eq 0 -or $ranked[0].score -lt $script:MinimumScore) {
        return [pscustomobject]@{
            candidates = @($Templates | Sort-Object id)
            matched = $false
            scores = $scores
            reasons = @()
        }
    }

    $candidateRows = @($ranked[0])
    if ($ranked.Count -gt 1 -and $ranked[1].score -ge $script:MinimumScore -and
        ($ranked[0].score - $ranked[1].score) -le $script:CloseScoreDelta) {
        $candidateRows += $ranked[1]
    }
    return [pscustomobject]@{
        candidates = @($candidateRows | ForEach-Object template)
        matched = $true
        scores = $scores
        reasons = @($candidateRows[0].keywords | ForEach-Object { "keyword:$_" })
    }
}

Export-ModuleMember -Function Get-StandardBusinessTemplates, Get-StandardBusinessRecommendation
