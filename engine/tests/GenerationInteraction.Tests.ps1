. "$PSScriptRoot\Assert.ps1"
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot '..\lib\StandardBusinessCatalog.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot '..\lib\GenerationInteraction.psm1') -Force -DisableNameChecking

$templates = @(Get-StandardBusinessTemplates)

$default = Resolve-GenerationMode -Mode '' -Reader { param($prompt) '' }
Assert-Equal $default 'StandardBusiness'

$legacy = Resolve-GenerationMode -Mode '' -Reader { param($prompt) '2' }
Assert-Equal $legacy 'LegacyDemo'
Assert-Equal (Resolve-GenerationMode -Mode 'StandardBusiness') 'StandardBusiness'
Assert-Throws { Resolve-GenerationMode -Mode 'UnknownMode' } 'GenerationMode'

$inventoryTheme = -join [char[]](0x5B9E,0x9A8C,0x5BA4,0x8017,0x6750,0x7533,0x9886)
$selected = Select-StandardBusinessTemplate -Theme $inventoryTheme -Templates $templates -Reader { param($prompt) '' }
Assert-Equal $selected.id 'inventory_application_approval'

$unknownTheme = -join [char[]](0x7EFC,0x5408,0x7BA1,0x7406,0x5E73,0x53F0)
$manual = Select-StandardBusinessTemplate -Theme $unknownTheme -Templates $templates -Reader { param($prompt) '6' }
Assert-Equal $manual.id 'inventory_application_approval'
Assert-Throws {
    Select-StandardBusinessTemplate -Theme $unknownTheme -Templates $templates -NonInteractive
} 'TemplateId'

$explicit = Select-StandardBusinessTemplate -Theme $unknownTheme -Templates $templates `
    -TemplateId 'project_task_management' -NonInteractive
Assert-Equal $explicit.id 'project_task_management'
Assert-Throws {
    Select-StandardBusinessTemplate -Theme $unknownTheme -Templates $templates `
        -TemplateId 'missing_template' -NonInteractive
} 'not supported'

$calls = [Collections.Generic.List[string]]::new()
$assetTheme = -join [char[]](0x8BBE,0x5907,0x70B9,0x68C0,0x6574,0x6539)
$request = Resolve-GenerationRequest -Mode '' -Theme $assetTheme -Templates $templates -Reader {
    param($prompt)
    $calls.Add($prompt)
    if ($prompt -like '[[]confirm[]]*') { return 'y' }
    return ''
}
Assert-Equal $request.mode 'StandardBusiness'
Assert-Equal $request.theme $assetTheme
Assert-Equal $request.template.id 'asset_inspection_rectification'
Assert-Equal $calls.Count 3
Assert-Match $calls[0] '^\[mode\]'
Assert-Match $calls[1] '^\[template\]'
Assert-Match $calls[2] '^\[confirm\]'

$legacyRequest = Resolve-GenerationRequest -Mode 'LegacyDemo' -Theme 'legacy-theme' -Templates $templates -NonInteractive
Assert-Equal $legacyRequest.mode 'LegacyDemo'
Assert-Equal $legacyRequest.theme 'legacy-theme'
Assert-Equal $null $legacyRequest.template

$automated = Resolve-GenerationRequest -Mode 'StandardBusiness' -Theme 'project-theme' `
    -TemplateId 'project_task_management' -Templates $templates -NonInteractive
Assert-Equal $automated.template.id 'project_task_management'

Assert-Throws {
    Resolve-GenerationRequest -Mode 'StandardBusiness' -Theme '' -TemplateId 'project_task_management' `
        -Templates $templates -NonInteractive
} 'Theme'
Assert-Throws {
    Confirm-GenerationSummary -Theme $assetTheme -Template $request.template -Reader { param($prompt) 'n' }
} 'cancelled'
