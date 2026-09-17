param([Parameter(Mandatory)][string]$InstallerPath)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$installer = [IO.Path]::GetFullPath($InstallerPath)
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {
    throw "Installer does not exist: $installer"
}
$tempRoot = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')
$testRoot = [IO.Path]::GetFullPath((Join-Path $tempRoot ('rz-installer-' + [guid]::NewGuid().ToString('N'))))
if (-not $testRoot.StartsWith($tempRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "Unsafe installer test path: $testRoot"
}
$installDirectory = Join-Path $testRoot 'app'
$userData = Join-Path $testRoot 'user-data'
$executable = $null
$uninstaller = $null

try {
    New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
    $install = Start-Process -FilePath $installer -ArgumentList @('/S', "/D=$installDirectory") `
        -Wait -PassThru -WindowStyle Hidden
    if ($install.ExitCode -ne 0) { throw "Installer exited with $($install.ExitCode)." }
    $executable = Get-ChildItem -LiteralPath $installDirectory -Filter '*.exe' -File |
        Where-Object Name -NotLike 'Uninstall*' |
        Select-Object -First 1
    if ($null -eq $executable) { throw 'Installed executable was not found.' }
    $uninstaller = Get-ChildItem -LiteralPath $installDirectory -Filter 'Uninstall*.exe' -File |
        Select-Object -First 1
    if ($null -eq $uninstaller) { throw 'Uninstaller was not found.' }

    $previousUserData = $env:RZ_RUNTIME_USER_DATA
    try {
        $env:RZ_RUNTIME_USER_DATA = $userData
        $verify = Start-Process -FilePath $executable.FullName -ArgumentList '--verify' `
            -Wait -PassThru -WindowStyle Hidden
    }
    finally {
        if ($null -eq $previousUserData) { Remove-Item Env:\RZ_RUNTIME_USER_DATA -ErrorAction SilentlyContinue }
        else { $env:RZ_RUNTIME_USER_DATA = $previousUserData }
    }
    if ($verify.ExitCode -ne 0) { throw "Installed executable verification exited with $($verify.ExitCode)." }
    $databasePath = Join-Path $userData 'runtime.sqlite'
    if (-not (Test-Path -LiteralPath $databasePath -PathType Leaf)) {
        throw "Installed application did not create its database: $databasePath"
    }

    $uninstall = Start-Process -FilePath $uninstaller.FullName -ArgumentList '/S' `
        -Wait -PassThru -WindowStyle Hidden
    if ($uninstall.ExitCode -ne 0) { throw "Uninstaller exited with $($uninstall.ExitCode)." }
    if (Test-Path -LiteralPath $executable.FullName) { throw 'Installed executable remains after uninstall.' }
    if (-not (Test-Path -LiteralPath $databasePath -PathType Leaf)) {
        throw 'User database was removed by uninstall.'
    }
    'Installer lifecycle verification passed.'
}
finally {
    if ($null -ne $uninstaller -and (Test-Path -LiteralPath $uninstaller.FullName)) {
        try { Start-Process -FilePath $uninstaller.FullName -ArgumentList '/S' -Wait -WindowStyle Hidden } catch { }
    }
    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}
