[CmdletBinding()]
param(
    [string]$RepositoryRoot,
    [switch]$RequireDependencies,
    [switch]$RequireGeneratorTools
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($RepositoryRoot)) { $RepositoryRoot = Split-Path -Parent $PSScriptRoot }

try {
    $root = [IO.Path]::GetFullPath($RepositoryRoot)
    if (-not (Test-Path -LiteralPath $root -PathType Container)) {
        throw "Repository root does not exist: $root"
    }
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or [Environment]::OSVersion.Version.Major -lt 10) {
        throw 'Windows 10 or later is required.'
    }
    if (-not [Environment]::Is64BitOperatingSystem -or -not [Environment]::Is64BitProcess) {
        throw 'A 64-bit Windows and PowerShell process is required.'
    }
    if ($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -lt 1) {
        throw 'Windows PowerShell 5.1 is required.'
    }
    $versionFile = Join-Path $root '.node-version'
    if (-not (Test-Path -LiteralPath $versionFile -PathType Leaf)) { throw 'Missing .node-version.' }
    $expectedNode = (Get-Content -Raw -Encoding UTF8 -LiteralPath $versionFile).Trim()

    foreach ($commandName in @('node', 'npm', 'git', 'powershell')) {
        if ($null -eq (Get-Command $commandName -ErrorAction SilentlyContinue)) {
            throw "Required command is unavailable: $commandName"
        }
    }
    $actualNode = (& node --version).TrimStart('v')
    if ($LASTEXITCODE -ne 0 -or $actualNode -ne $expectedNode) {
        throw "Node.js $expectedNode is required; found $actualNode."
    }
    $nodeArchitecture = (& node -p 'process.arch').Trim()
    if ($LASTEXITCODE -ne 0 -or $nodeArchitecture -ne 'x64') { throw "Node.js x64 is required; found $nodeArchitecture." }
    $npmVersion = (& npm.cmd --version).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($npmVersion)) { throw 'npm is installed but unusable.' }
    $gitVersion = (& git --version).Trim()
    if ($LASTEXITCODE -ne 0 -or $gitVersion -notmatch '^git version ') { throw 'Git is installed but unusable.' }
    $childPowerShellVersion = (& powershell -NoProfile -Command '$PSVersionTable.PSVersion.ToString()').Trim()
    if ($LASTEXITCODE -ne 0 -or $childPowerShellVersion -notmatch '^5\.1\.') { throw 'Windows PowerShell 5.1 is installed but unusable.' }

    $packages = @('engine', 'engine\domain-packs', 'engine\desktop-runtime')
    foreach ($relativePath in $packages) {
        $packageRoot = Join-Path $root $relativePath
        foreach ($name in @('package.json', 'package-lock.json')) {
            if (-not (Test-Path -LiteralPath (Join-Path $packageRoot $name) -PathType Leaf)) {
                throw "Missing $relativePath\$name."
            }
        }
        if ($RequireDependencies) {
            $modules = Join-Path $packageRoot 'node_modules'
            $marker = Join-Path $modules '.rz-lock-sha256'
            if (-not (Test-Path -LiteralPath $modules -PathType Container) -or -not (Test-Path -LiteralPath $marker -PathType Leaf)) {
                throw "Dependencies are not installed in $relativePath; run .\setup-dev.bat."
            }
            $expectedLockHash = (Get-FileHash -LiteralPath (Join-Path $packageRoot 'package-lock.json') -Algorithm SHA256).Hash.ToLowerInvariant()
            $installedLockHash = (Get-Content -Raw -Encoding ASCII -LiteralPath $marker).Trim()
            if ($installedLockHash -ne $expectedLockHash) {
                throw "Dependencies in $relativePath do not match package-lock.json; run .\setup-dev.bat."
            }
            $null = & npm.cmd --prefix $packageRoot ls --depth=0 --silent 2>&1
            if ($LASTEXITCODE -ne 0) { throw "npm dependency validation failed in $relativePath; run .\setup-dev.bat." }
        }
    }

    if ($RequireGeneratorTools) {
        $preflight = Join-Path $root 'engine\Generate.ps1'
        & powershell -NoProfile -ExecutionPolicy Bypass -File $preflight -PreflightOnly -Theme 'environment-check'
        if ($LASTEXITCODE -ne 0) { throw 'Generator tool preflight failed.' }
    }

    Write-Host "Development environment is ready (Node.js $actualNode)."
    exit 0
}
catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 2
}
