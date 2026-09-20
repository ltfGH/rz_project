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
$appData = Join-Path $testRoot 'app-data'
$localAppData = Join-Path $testRoot 'local-app-data'
$executable = $null
$uninstaller = $null
$previousUserData = $env:RZ_RUNTIME_USER_DATA
$previousAppData = $env:APPDATA
$previousLocalAppData = $env:LOCALAPPDATA

try {
    New-Item -ItemType Directory -Path $testRoot, $appData, $localAppData -Force | Out-Null
    $env:RZ_RUNTIME_USER_DATA = $userData
    $env:APPDATA = $appData
    $env:LOCALAPPDATA = $localAppData
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

    $verify = Start-Process -FilePath $executable.FullName -ArgumentList '--verify' `
        -Wait -PassThru -WindowStyle Hidden
    if ($verify.ExitCode -ne 0) { throw "Installed executable verification exited with $($verify.ExitCode)." }
    $databasePath = Join-Path $userData 'runtime.sqlite'
    if (-not (Test-Path -LiteralPath $databasePath -PathType Leaf)) {
        throw "Installed application did not create its database: $databasePath"
    }

    $uninstall = Start-Process -FilePath $uninstaller.FullName -ArgumentList @('/S', '/KEEP_APP_DATA', '/currentuser', "_?=$installDirectory") `
        -Wait -PassThru -WindowStyle Hidden
    if ($uninstall.ExitCode -ne 0) { throw "Uninstaller exited with $($uninstall.ExitCode)." }
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    while ((Test-Path -LiteralPath $executable.FullName) -and [DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 200
    }
    if (Test-Path -LiteralPath $executable.FullName) { throw 'Installed executable remains after uninstall.' }
    if (-not (Test-Path -LiteralPath $databasePath -PathType Leaf)) {
        throw 'User database was removed by uninstall.'
    }
    $reportDirectory = Join-Path (Split-Path -Parent $PSScriptRoot) 'dist\reports'
    New-Item -ItemType Directory -Path $reportDirectory -Force | Out-Null
    [ordered]@{
        status = 'passed'
        installerName = [IO.Path]::GetFileName($installer)
        installerSha256 = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
        verifiedAt = [DateTime]::UtcNow.ToString('o')
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $reportDirectory 'installer-verification.json') -Encoding UTF8
    'Installer lifecycle verification passed.'
}
finally {
    if ($null -ne $uninstaller -and (Test-Path -LiteralPath $uninstaller.FullName)) {
        try { Start-Process -FilePath $uninstaller.FullName -ArgumentList @('/S', '/KEEP_APP_DATA', '/currentuser', "_?=$installDirectory") -Wait -WindowStyle Hidden } catch { }
    }
    if ($null -eq $previousUserData) { Remove-Item Env:\RZ_RUNTIME_USER_DATA -ErrorAction SilentlyContinue } else { $env:RZ_RUNTIME_USER_DATA = $previousUserData }
    if ($null -eq $previousAppData) { Remove-Item Env:\APPDATA -ErrorAction SilentlyContinue } else { $env:APPDATA = $previousAppData }
    if ($null -eq $previousLocalAppData) { Remove-Item Env:\LOCALAPPDATA -ErrorAction SilentlyContinue } else { $env:LOCALAPPDATA = $previousLocalAppData }
    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}
