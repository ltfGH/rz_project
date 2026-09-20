Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
function New-StrongPassword { [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N') + '!Aa1' }
function Get-Digest([string]$Password) {
    $env:RZ_PASSWORD = $Password
    $digest = & node (Join-Path $PSScriptRoot 'hash-password.cjs')
    if ($LASTEXITCODE -ne 0) { throw 'Password digest generation failed.' }
    $digest.Trim()
}

$names = @(
    'RZ_PASSWORD', 'RZ_REFERENCE_DISPATCHER_PASSWORD_DIGEST', 'RZ_REFERENCE_OPERATOR_PASSWORD_DIGEST',
    'RZ_REFERENCE_REVIEWER_PASSWORD_DIGEST', 'RZ_REFERENCE_ADMINISTRATOR_PASSWORD_DIGEST',
    'RZ_E2E_DISPATCHER_PASSWORD', 'RZ_E2E_OPERATOR_PASSWORD', 'RZ_E2E_REVIEWER_PASSWORD',
    'RZ_E2E_ADMINISTRATOR_PASSWORD', 'RZ_E2E_EXECUTABLE_PATH', 'ELECTRON_MIRROR',
    'ELECTRON_BUILDER_BINARIES_MIRROR'
)
$previous = @{}
foreach ($name in $names) { $previous[$name] = [Environment]::GetEnvironmentVariable($name) }

try {
    Remove-Item -LiteralPath (Join-Path $root 'test-results\reference-acceptance-status.json') -Force -ErrorAction SilentlyContinue
    $dispatcher = New-StrongPassword
    $operator = New-StrongPassword
    $reviewer = New-StrongPassword
    $administrator = New-StrongPassword
    if (-not $env:ELECTRON_MIRROR) { $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/' }
    if (-not $env:ELECTRON_BUILDER_BINARIES_MIRROR) { $env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/' }
    $env:RZ_REFERENCE_DISPATCHER_PASSWORD_DIGEST = Get-Digest $dispatcher
    $env:RZ_REFERENCE_OPERATOR_PASSWORD_DIGEST = Get-Digest $operator
    $env:RZ_REFERENCE_REVIEWER_PASSWORD_DIGEST = Get-Digest $reviewer
    $env:RZ_REFERENCE_ADMINISTRATOR_PASSWORD_DIGEST = Get-Digest $administrator

    & node (Join-Path $PSScriptRoot 'clean-installers.cjs')
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & npm run build:reference:release
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & npx electron-builder --config electron-builder.reference.yml --win dir --x64
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    $env:RZ_E2E_DISPATCHER_PASSWORD = $dispatcher
    $env:RZ_E2E_OPERATOR_PASSWORD = $operator
    $env:RZ_E2E_REVIEWER_PASSWORD = $reviewer
    $env:RZ_E2E_ADMINISTRATOR_PASSWORD = $administrator
    $application = Get-ChildItem -LiteralPath '.\dist\installers\win-unpacked' -Filter '*.exe' -File |
        Where-Object Name -NotLike 'Uninstall*' |
        Select-Object -First 1
    if ($null -eq $application) { throw 'Packaged application executable was not found.' }
    $env:RZ_E2E_EXECUTABLE_PATH = $application.FullName
    & npx playwright test tests/e2e/reference-acceptance.spec.ts
    exit $LASTEXITCODE
}
finally {
    foreach ($name in $names) {
        [Environment]::SetEnvironmentVariable($name, $previous[$name])
        if ($null -eq $previous[$name]) { Remove-Item "Env:\$name" -ErrorAction SilentlyContinue }
        else { Set-Item "Env:\$name" $previous[$name] }
    }
}
