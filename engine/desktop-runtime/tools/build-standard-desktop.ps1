[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$RequestPath,
    [Parameter(Mandatory)][string]$OutputRoot,
    [switch]$UnpackedOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$request = [IO.Path]::GetFullPath($RequestPath)
$output = [IO.Path]::GetFullPath($OutputRoot)
if (-not (Test-Path -LiteralPath $request -PathType Leaf)) { throw 'Standard project request does not exist.' }
if (Test-Path -LiteralPath $output) { throw 'Standard desktop output already exists.' }
foreach ($required in @('dist\runtime\main\index.js', 'dist\renderer\index.html', 'build\icon.svg')) {
    if (-not (Test-Path -LiteralPath (Join-Path $root $required) -PathType Leaf)) {
        throw "Desktop runtime build is missing '$required'; run npm run build first."
    }
}
$parent = Split-Path -Parent $output
New-Item -ItemType Directory -Path $parent -Force | Out-Null
$staging = Join-Path $parent ('.' + (Split-Path -Leaf $output) + '.staging-' + [guid]::NewGuid().ToString('N'))
$resources = Join-Path $staging 'resources'
$installers = Join-Path $staging 'installers'
$config = Join-Path $staging 'electron-builder.yml'
try {
    New-Item -ItemType Directory -Path $staging | Out-Null
    & node (Join-Path $PSScriptRoot 'build-standard-resources.cjs') --request $request --output $resources
    if ($LASTEXITCODE -ne 0) { throw 'Standard resource assembly failed.' }
    & node (Join-Path $PSScriptRoot 'write-builder-config.cjs') --resources $resources --output $config --installers $installers --app-root $root
    if ($LASTEXITCODE -ne 0) { throw 'Electron builder config generation failed.' }
    $arguments = @('electron-builder', '--config', $config, '--win')
    if ($UnpackedOnly) { $arguments += '--dir' } else { $arguments += @('nsis', '--x64') }
    Push-Location $root
    try { & npx.cmd @arguments } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { throw 'Standard desktop packaging failed.' }
    $application = Get-ChildItem -LiteralPath (Join-Path $installers 'win-unpacked') -Filter '*.exe' -File |
        Where-Object Name -NotLike 'Uninstall*' | Select-Object -First 1
    if ($null -eq $application) { throw 'Packaged application executable was not found.' }
    $manifest = Join-Path $installers 'win-unpacked\resources\runtime-resources\resource-manifest.json'
    if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { throw 'Packaged resource manifest was not found.' }
    $installer = Get-ChildItem -LiteralPath $installers -Filter '*安装包.exe' -File | Select-Object -First 1
    $receipt = [ordered]@{
        receiptVersion = '1.0'
        unpackedDirectory = 'installers/win-unpacked'
        executableName = $application.Name
        executableSha256 = (Get-FileHash -LiteralPath $application.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        resourceManifestSha256 = (Get-FileHash -LiteralPath $manifest -Algorithm SHA256).Hash.ToLowerInvariant()
        installerName = if ($null -eq $installer) { $null } else { $installer.Name }
        installerSha256 = if ($null -eq $installer) { $null } else { (Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
    }
    $receipt | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $staging 'build-receipt.json') -Encoding UTF8
    Move-Item -LiteralPath $staging -Destination $output
    Write-Host "Standard desktop output: $output"
}
catch {
    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
    throw
}
