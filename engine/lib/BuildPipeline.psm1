Set-StrictMode -Version Latest

Import-Module (Join-Path $PSScriptRoot 'Generator.Core.psm1') -Force -DisableNameChecking

function Remove-IsolatedEdgeProfile {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$TempRoot
    )

    if (-not (Test-Path -LiteralPath $Path)) { return }

    $resolvedPath = [IO.Path]::GetFullPath($Path)
    $resolvedTempRoot = [IO.Path]::GetFullPath($TempRoot).TrimEnd('\') + '\'
    if (-not $resolvedPath.StartsWith($resolvedTempRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clean an unexpected Edge profile path: $resolvedPath"
    }

    $lastError = $null
    for ($attempt = 1; $attempt -le 5; $attempt++) {
        try {
            Remove-Item -LiteralPath $resolvedPath -Recurse -Force -ErrorAction Stop
            return
        }
        catch {
            $lastError = $_
            Start-Sleep -Milliseconds (200 * $attempt)
        }
    }
    throw "Could not clean isolated Edge profile '$resolvedPath': $($lastError.Exception.Message)"
}

function Assert-ScreenshotFile {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][int]$Width,
        [Parameter(Mandatory)][int]$Height
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Edge exited successfully but did not create: $Path"
    }
    $bytes = [IO.File]::ReadAllBytes($Path)
    $signature = [byte[]](0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
    $hasPngSignature = $bytes.Length -ge 8
    for ($index = 0; $hasPngSignature -and $index -lt $signature.Length; $index++) {
        $hasPngSignature = $bytes[$index] -eq $signature[$index]
    }
    if ($bytes.Length -lt 24 -or -not $hasPngSignature) {
        throw "Screenshot is not a PNG: $Path"
    }
    $actualWidth = [Net.IPAddress]::NetworkToHostOrder([BitConverter]::ToInt32($bytes, 16))
    $actualHeight = [Net.IPAddress]::NetworkToHostOrder([BitConverter]::ToInt32($bytes, 20))
    if ($actualWidth -ne $Width -or $actualHeight -ne $Height) {
        throw "Screenshot dimensions for $Path were ${actualWidth}x${actualHeight}; expected ${Width}x${Height}."
    }

    Add-Type -AssemblyName System.Drawing
    $bitmap = [Drawing.Bitmap]::new($Path)
    try {
        $colorCounts = @{}
        $sampleCount = 0
        for ($x = 0; $x -lt $bitmap.Width; $x += [Math]::Max(1, [Math]::Floor($bitmap.Width / 20))) {
            for ($y = 0; $y -lt $bitmap.Height; $y += [Math]::Max(1, [Math]::Floor($bitmap.Height / 20))) {
                $color = $bitmap.GetPixel($x, $y).ToArgb().ToString()
                if ($colorCounts.ContainsKey($color)) { $colorCounts[$color]++ } else { $colorCounts[$color] = 1 }
                $sampleCount++
            }
        }
        $dominantRatio = ($colorCounts.Values | Measure-Object -Maximum).Maximum / $sampleCount
        if ($dominantRatio -gt 0.98) { throw "Screenshot has a mostly blank pixel sample: $Path" }
    }
    finally {
        $bitmap.Dispose()
    }
}

function Invoke-ScreenshotBuild {
    param(
        [Parameter(Mandatory)][pscustomobject]$Context,
        [Parameter(Mandatory)][string]$EdgePath
    )

    $projectRoot = [IO.Path]::GetFullPath($Context.WorkspacePath)
    $manifestPath = Join-Path $projectRoot 'project.json'
    $indexPath = Join-Path $projectRoot 'app\index.html'
    if (-not (Test-Path -LiteralPath $EdgePath -PathType Leaf)) { throw "Microsoft Edge was not found: $EdgePath" }
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "Project manifest was not found: $manifestPath" }
    if (-not (Test-Path -LiteralPath $indexPath -PathType Leaf)) { throw "Application entry point was not found: $indexPath" }

    $manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $manifestPath | ConvertFrom-Json
    $expectedRoutes = @('dashboard', 'records', 'operation', 'history')
    if ((@($manifest.routes) -join ',') -cne ($expectedRoutes -join ',')) {
        throw 'project.json must declare routes: dashboard, records, operation, history.'
    }

    $captures = @(
        [pscustomobject]@{ Name = 'dashboard-desktop.png'; Route = $manifest.routes[0]; Width = 1440; Height = 1000 }
        [pscustomobject]@{ Name = 'records-desktop.png'; Route = $manifest.routes[1]; Width = 1440; Height = 1000 }
        [pscustomobject]@{ Name = 'operation-desktop.png'; Route = $manifest.routes[2]; Width = 1440; Height = 1000 }
        [pscustomobject]@{ Name = 'history-desktop.png'; Route = $manifest.routes[3]; Width = 1440; Height = 1000 }
        [pscustomobject]@{ Name = 'records-mobile.png'; Route = $manifest.routes[1]; Width = 390; Height = 844 }
    )
    $screenshotRoot = Join-Path $projectRoot 'materials\screenshots'
    $tempRoot = Join-Path $projectRoot 'temp'
    $profilePath = Join-Path $tempRoot (('edge-capture-{0}-{1}' -f $PID, [Guid]::NewGuid().ToString('N')))
    New-Item -ItemType Directory -Path $screenshotRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $profilePath -Force | Out-Null
    $outputs = [Collections.Generic.List[IO.FileInfo]]::new()

    try {
        $pageUri = ([Uri]::new($indexPath)).AbsoluteUri
        foreach ($capture in $captures) {
            $outputPath = Join-Path $screenshotRoot $capture.Name
            if (Test-Path -LiteralPath $outputPath) { Remove-Item -LiteralPath $outputPath -Force }
            $url = '{0}?capture=1#{1}' -f $pageUri, $capture.Route
            $arguments = @('--headless=new', '--disable-gpu', '--force-device-scale-factor=1', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--run-all-compositor-stages-before-draw', '--virtual-time-budget=2000', ('--window-size={0},{1}' -f $capture.Width, $capture.Height), ('--user-data-dir={0}' -f $profilePath), ('--screenshot={0}' -f $outputPath), $url)
            $edgeProcess = Start-Process -FilePath $EdgePath -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru
            if ($edgeProcess.ExitCode -ne 0) { throw "Edge failed for $($capture.Name) with exit code $($edgeProcess.ExitCode)." }
            $deadline = [DateTime]::UtcNow.AddSeconds(10)
            while ((-not (Test-Path -LiteralPath $outputPath -PathType Leaf)) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
            Assert-ScreenshotFile -Path $outputPath -Width $capture.Width -Height $capture.Height
            $outputs.Add((Get-Item -LiteralPath $outputPath))
        }
    }
    finally {
        Remove-IsolatedEdgeProfile -Path $profilePath -TempRoot $tempRoot
    }

    return $outputs.ToArray()
}

function Invoke-MaterialsBuild {
    param([Parameter(Mandatory)][pscustomobject]$Context)

    $projectRoot = [IO.Path]::GetFullPath($Context.WorkspacePath)
    $toolPath = Join-Path $PSScriptRoot '..\template\tools\build-materials.ps1'
    if (-not (Test-Path -LiteralPath $toolPath -PathType Leaf)) { throw "Materials build tool was not found: $toolPath" }
    if (-not (Test-Path -LiteralPath $projectRoot -PathType Container)) { throw "Materials workspace was not found: $projectRoot" }

    $toolOutput = (& powershell -NoProfile -ExecutionPolicy Bypass -File $toolPath -ProjectRoot $projectRoot 2>&1 | Out-String)
    $toolExitCode = $LASTEXITCODE
    if ($toolExitCode -ne 0) { throw "Materials build tool failed with exit code $toolExitCode`: $($toolOutput.Trim())" }

    $outputRoot = Join-Path $projectRoot 'materials\output'
    $outputs = @(Get-ChildItem -LiteralPath $outputRoot -File | Sort-Object Name)
    if ($outputs.Count -ne 8) { throw "Materials build produced $($outputs.Count) files; expected exactly 8." }
    return $outputs
}

function Invoke-LauncherBuild {
    param([Parameter(Mandatory)][pscustomobject]$Context)

    $projectRoot = [IO.Path]::GetFullPath($Context.WorkspacePath)
    $toolPath = Join-Path $PSScriptRoot '..\template\tools\build-launcher.ps1'
    if (-not (Test-Path -LiteralPath $projectRoot -PathType Container)) { throw "Launcher workspace was not found: $projectRoot" }
    if (-not (Test-Path -LiteralPath $toolPath -PathType Leaf)) { throw "Launcher build tool was not found: $toolPath" }

    $powershellPath = Join-Path $PSHome 'powershell.exe'
    $toolOutput = (& $powershellPath -NoProfile -ExecutionPolicy Bypass -File $toolPath -ProjectRoot $projectRoot 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) { throw "Launcher build tool failed with exit code $LASTEXITCODE`: $($toolOutput.Trim())" }

    $manifest = Get-Content -Raw -Encoding utf8 -LiteralPath (Join-Path $projectRoot 'project.json') | ConvertFrom-Json
    $outputPath = Join-Path $projectRoot ($manifest.softwareName + '.exe')
    if (-not (Test-Path -LiteralPath $outputPath -PathType Leaf)) { throw "Launcher build did not create: $outputPath" }
    return Get-Item -LiteralPath $outputPath
}

function Invoke-InstallerBuild {
    param(
        [Parameter(Mandatory)][pscustomobject]$Context,
        [Parameter(Mandatory)][string]$ISCCPath
    )

    $projectRoot = [IO.Path]::GetFullPath($Context.WorkspacePath)
    $toolPath = Join-Path $PSScriptRoot '..\template\tools\build-installer.ps1'
    if (-not (Test-Path -LiteralPath $projectRoot -PathType Container)) { throw "Installer workspace was not found: $projectRoot" }
    if (-not (Test-Path -LiteralPath $toolPath -PathType Leaf)) { throw "Installer build tool was not found: $toolPath" }

    $powershellPath = Join-Path $PSHome 'powershell.exe'
    $toolOutput = (& $powershellPath -NoProfile -ExecutionPolicy Bypass -File $toolPath -ProjectRoot $projectRoot -ISCCPath $ISCCPath 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) { throw "Installer build tool failed with exit code $LASTEXITCODE`: $($toolOutput.Trim())" }

    $manifest = Get-Content -Raw -Encoding utf8 -LiteralPath (Join-Path $projectRoot 'project.json') | ConvertFrom-Json
    $packageSuffix = -join @(0x5B89, 0x88C5, 0x5305 | ForEach-Object { [char]$_ })
    $outputPath = Join-Path $projectRoot ('installer\output\{0} V{1} {2}.exe' -f $manifest.softwareName, $manifest.version, $packageSuffix)
    if (-not (Test-Path -LiteralPath $outputPath -PathType Leaf)) { throw "Installer build did not create: $outputPath" }
    return Get-Item -LiteralPath $outputPath
}

function Test-InstallerLifecycle {
    param(
        [Parameter(Mandatory)][pscustomobject]$Context,
        [Parameter(Mandatory)][string]$InstallerPath,
        [scriptblock]$ProcessRunner,
        [scriptblock]$RegistryReader
    )

    if ($null -eq $ProcessRunner) {
        $ProcessRunner = {
            param([string]$FilePath, [string[]]$Arguments)
            $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -WindowStyle Hidden -Wait -PassThru
            return [pscustomobject]@{ ExitCode = $process.ExitCode }
        }
    }
    if ($null -eq $RegistryReader) {
        $RegistryReader = {
            param([string]$KeyPath)
            return Test-Path -LiteralPath $KeyPath
        }
    }

    $workspacePath = [IO.Path]::GetFullPath($Context.WorkspacePath)
    if (-not (Test-Path -LiteralPath $workspacePath -PathType Container)) {
        throw "Installer lifecycle workspace was not found: $workspacePath"
    }
    $manifestPath = Join-Path $workspacePath 'project.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "Installer lifecycle manifest was not found: $manifestPath"
    }
    $resolvedInstallerPath = [IO.Path]::GetFullPath($InstallerPath)
    if (-not (Test-Path -LiteralPath $resolvedInstallerPath -PathType Leaf)) {
        throw "Installer was not found: $resolvedInstallerPath"
    }
    $manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $manifestPath | ConvertFrom-Json
    foreach ($property in @('softwareName', 'appId')) {
        if ([string]::IsNullOrWhiteSpace([string]$manifest.$property)) {
            throw "project.json $property is required for installer lifecycle validation."
        }
    }

    $appId = [Guid]::Parse([string]$manifest.appId).ToString()
    $uninstallKey = 'Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall\{0}_is1' -f ('{' + $appId + '}')
    $installerTestRoot = Assert-SafeChildPath -Root $workspacePath -Candidate (Join-Path $workspacePath 'installer-test')
    $isolatedPath = Assert-SafeChildPath -Root $installerTestRoot -Candidate (Join-Path $installerTestRoot ('install-' + [Guid]::NewGuid().ToString('N')))
    New-Item -ItemType Directory -Path $installerTestRoot -Force | Out-Null

    $result = [pscustomobject]@{
        InstallExitCode     = $null
        InstalledFiles      = $false
        RegistrationCreated = $false
        LauncherExitCode    = $null
        UninstallExitCode   = $null
        CleanupComplete     = $false
    }
    $installSucceeded = $false
    $uninstallAttempted = $false
    $primaryError = $null

    try {
        $installArguments = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', ('/DIR=' + $isolatedPath), '/MERGETASKS=!desktopicon')
        $installResult = & $ProcessRunner $resolvedInstallerPath $installArguments
        $result.InstallExitCode = [int]$installResult.ExitCode
        if ($result.InstallExitCode -ne 0) {
            throw "Installer failed with exit code $($result.InstallExitCode)."
        }
        $installSucceeded = $true

        $requiredFiles = @(
            ($manifest.softwareName + '.exe'),
            'app\index.html',
            'app\assets\styles.css',
            'app\js\domain.js',
            'app\js\demo-data.js',
            'app\js\storage.js',
            'app\js\app.js'
        )
        foreach ($relativePath in $requiredFiles) {
            $installedPath = Join-Path $isolatedPath $relativePath
            if (-not (Test-Path -LiteralPath $installedPath -PathType Leaf)) {
                throw "Installed application file is missing: $relativePath"
            }
        }
        $result.InstalledFiles = $true

        if (-not (& $RegistryReader $uninstallKey)) {
            throw "Uninstall registration was not created: $uninstallKey"
        }
        $result.RegistrationCreated = $true

        $launcherPath = Join-Path $isolatedPath ($manifest.softwareName + '.exe')
        $launcherResult = & $ProcessRunner $launcherPath @('--verify')
        $result.LauncherExitCode = [int]$launcherResult.ExitCode
        if ($result.LauncherExitCode -ne 0) {
            throw "Launcher self-check failed with exit code $($result.LauncherExitCode)."
        }

        $uninstallerPath = Join-Path $isolatedPath 'unins000.exe'
        if (-not (Test-Path -LiteralPath $uninstallerPath -PathType Leaf)) {
            throw "Installed uninstaller is missing: $uninstallerPath"
        }
        $uninstallAttempted = $true
        $uninstallResult = & $ProcessRunner $uninstallerPath @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART')
        $result.UninstallExitCode = [int]$uninstallResult.ExitCode
        if ($result.UninstallExitCode -ne 0) {
            throw "Uninstaller failed with exit code $($result.UninstallExitCode)."
        }
        if ((Test-Path -LiteralPath $isolatedPath) -or (& $RegistryReader $uninstallKey)) {
            throw 'Uninstall cleanup was incomplete.'
        }
        $result.CleanupComplete = $true
        return $result
    }
    catch {
        $primaryError = $_
        throw
    }
    finally {
        $uninstallerPath = Join-Path $isolatedPath 'unins000.exe'
        if ($installSucceeded -and -not $uninstallAttempted -and (Test-Path -LiteralPath $uninstallerPath -PathType Leaf)) {
            try {
                $uninstallAttempted = $true
                $uninstallResult = & $ProcessRunner $uninstallerPath @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART')
                $result.UninstallExitCode = [int]$uninstallResult.ExitCode
            }
            catch {
                if ($null -eq $primaryError) { throw }
            }
        }
        try {
            if (Test-Path -LiteralPath $isolatedPath) {
                $safeCleanupPath = Assert-SafeChildPath -Root $installerTestRoot -Candidate $isolatedPath
                Remove-Item -LiteralPath $safeCleanupPath -Recurse -Force -ErrorAction Stop
            }
        }
        catch {
            if ($null -eq $primaryError) { throw }
        }
        if ((Test-Path -LiteralPath $installerTestRoot -PathType Container) -and
            $null -eq (Get-ChildItem -LiteralPath $installerTestRoot -Force | Select-Object -First 1)) {
            Remove-Item -LiteralPath $installerTestRoot -Force -ErrorAction SilentlyContinue
        }
    }
}

Export-ModuleMember -Function Invoke-ScreenshotBuild, Invoke-MaterialsBuild, Invoke-LauncherBuild, Invoke-InstallerBuild, Test-InstallerLifecycle
