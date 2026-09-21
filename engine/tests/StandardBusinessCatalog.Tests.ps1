. "$PSScriptRoot\Assert.ps1"
$ErrorActionPreference = 'Stop'

$modulePath = Join-Path $PSScriptRoot '..\lib\StandardBusinessCatalog.psm1'
Import-Module $modulePath -Force -DisableNameChecking

$templates = @(Get-StandardBusinessTemplates)
Assert-Equal $templates.Count 8
Assert-Equal (($templates | ForEach-Object id) -join ',') `
    'application_approval_archive,asset_inspection_management,asset_inspection_rectification,asset_work_order_operations,inspection_rectification_orders,inventory_application_approval,project_delivery_archive,project_task_management'

$reference = @($templates | Where-Object id -eq 'asset_inspection_rectification')[0]
Assert-Equal ($reference.packs -join ',') `
    'asset_registry,inspection_rectification,work_order_service,asset_inspection_bridge,asset_work_order_bridge,inspection_work_order_bridge'
Assert-Equal ($reference.primaryEntities -join ',') 'asset,inspection_task,work_order'
Assert-Equal $reference.viewRange.minimum 12
Assert-Equal $reference.viewRange.maximum 13

foreach ($template in $templates) {
    Assert-Equal (@($template.packs | Sort-Object -Unique).Count) $template.packs.Count
    Assert-Equal (@($template.keywords.value | Sort-Object -Unique).Count) $template.keywords.Count
    Assert-Equal (@($template.keywords | Where-Object weight -le 0).Count) 0
    Assert-Equal ($template.viewRange.minimum -le $template.viewRange.maximum) $true
}

$assetTheme = -join [char[]](0x6821,0x56ED,0x6D88,0x9632,0x8BBE,0x65BD,0x5DE1,0x68C0,0x6574,0x6539)
$asset = Get-StandardBusinessRecommendation -Theme $assetTheme -Templates $templates
Assert-Equal $asset.matched $true
Assert-Equal $asset.candidates.Count 1
Assert-Equal $asset.candidates[0].id 'asset_inspection_rectification'
$inspectionKeyword = -join [char[]](0x5DE1,0x68C0)
Assert-Match ($asset.reasons -join ' ') $inspectionKeyword

$inventoryTheme = -join [char[]](0x5B9E,0x9A8C,0x5BA4,0x8017,0x6750,0x7533,0x9886)
$inventory = Get-StandardBusinessRecommendation -Theme $inventoryTheme -Templates $templates
Assert-Equal $inventory.candidates[0].id 'inventory_application_approval'

$closeTheme = -join [char[]](0x9879,0x76EE,0x5F52,0x6863,0x5BA1,0x6279)
$close = Get-StandardBusinessRecommendation -Theme $closeTheme -Templates $templates
Assert-Equal $close.matched $true
Assert-Equal $close.candidates.Count 2
Assert-Equal $close.candidates[0].id 'project_delivery_archive'
Assert-Equal $close.candidates[1].id 'application_approval_archive'

$unknownTheme = -join [char[]](0x7EFC,0x5408,0x7BA1,0x7406,0x5E73,0x53F0)
$unknown = Get-StandardBusinessRecommendation -Theme $unknownTheme -Templates $templates
Assert-Equal $unknown.matched $false
Assert-Equal $unknown.candidates.Count 8
Assert-Equal (($unknown.candidates | ForEach-Object id) -join ',') (($templates | ForEach-Object id) -join ',')

$testRoot = Join-Path $env:TEMP ('standard-catalog-test-' + [guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Path $testRoot | Out-Null
    $invalidCatalog = Join-Path $testRoot 'invalid.json'
    [IO.File]::WriteAllText($invalidCatalog, '{"catalogVersion":"1.0","minimumScore":5,"closeScoreDelta":2,"unexpected":true,"templates":[]}', [Text.UTF8Encoding]::new($false))
    Assert-Throws { Get-StandardBusinessTemplates -CatalogPath $invalidCatalog } 'unknown property'

    $badPackCatalog = Join-Path $testRoot 'bad-pack.json'
    $validCatalogText = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $PSScriptRoot '..\config\standard-business-templates.json')
    $badPackText = [regex]::Replace($validCatalogText, '"application_archive"', '"unknown_pack"', 1)
    [IO.File]::WriteAllText($badPackCatalog, $badPackText, [Text.UTF8Encoding]::new($false))
    Assert-Throws { Get-StandardBusinessTemplates -CatalogPath $badPackCatalog } 'production pack'
}
finally {
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}
