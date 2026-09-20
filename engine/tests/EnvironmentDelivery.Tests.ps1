. "$PSScriptRoot\Assert.ps1"
$ErrorActionPreference = 'Stop'

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$requiredFiles = @(
    '.node-version',
    '.env.example',
    'README.md',
    'setup-dev.bat',
    'verify-dev.bat',
    'tools\Test-DevelopmentEnvironment.ps1',
    'tools\Setup-Development.ps1',
    'tools\Test-All.ps1'
)
foreach ($relativePath in $requiredFiles) {
    Assert-Equal (Test-Path -LiteralPath (Join-Path $repositoryRoot $relativePath) -PathType Leaf) $true
}

Assert-Equal ((Get-Content -Raw -Encoding UTF8 (Join-Path $repositoryRoot '.node-version')).Trim()) '22.21.0'

$readme = Get-Content -Raw -Encoding UTF8 (Join-Path $repositoryRoot 'README.md')
$startBatch = '.\' + (-join [char[]](0x5F00, 0x59CB, 0x751F, 0x6210)) + '.bat'
foreach ($requiredText in @(
    'Node.js 22.21.0',
    '.\setup-dev.bat',
    '.\verify-dev.bat',
    $startBatch,
    'Generate.ps1 -PreflightOnly',
    'npm run test:e2e:reference',
    'IncludeExternalPipelineTests',
    'RZ_REFERENCE_DISPATCHER_PASSWORD_DIGEST'
)) {
    Assert-Match $readme ([regex]::Escape($requiredText))
}

$environmentExample = Get-Content -Raw -Encoding UTF8 (Join-Path $repositoryRoot '.env.example')
foreach ($name in @(
    'RZ_REFERENCE_DISPATCHER_PASSWORD_DIGEST',
    'RZ_REFERENCE_OPERATOR_PASSWORD_DIGEST',
    'RZ_REFERENCE_REVIEWER_PASSWORD_DIGEST',
    'RZ_REFERENCE_ADMINISTRATOR_PASSWORD_DIGEST'
)) {
    Assert-Match $environmentExample ("(?m)^{0}=<scrypt-digest>$" -f $name)
}
Assert-Equal ($environmentExample -match 'ghp_|github_pat_') $false

$environmentScript = Join-Path $repositoryRoot 'tools\Test-DevelopmentEnvironment.ps1'
$quotedEnvironmentScript = '"' + $environmentScript + '"'
$quotedRepositoryRoot = '"' + $repositoryRoot + '"'
$check = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $quotedEnvironmentScript,
    '-RepositoryRoot', $quotedRepositoryRoot
) -Wait -PassThru -WindowStyle Hidden
Assert-Equal $check.ExitCode 0

$missingRoot = Join-Path $env:TEMP ("missing-generator-root-{0}" -f [guid]::NewGuid().ToString('N'))
$quotedMissingRoot = '"' + $missingRoot + '"'
$missing = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $quotedEnvironmentScript,
    '-RepositoryRoot', $quotedMissingRoot
) -Wait -PassThru -WindowStyle Hidden
Assert-Equal ($missing.ExitCode -ne 0) $true
