param(
    [Parameter(Mandatory)][string]$ProjectRoot,
    [Parameter(Mandatory)][string]$ISCCPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function ConvertTo-InnoValue {
    param([Parameter(Mandatory)][string]$Value)
    return $Value.Replace('"', '""')
}

$projectPath = [IO.Path]::GetFullPath($ProjectRoot)
$manifestPath = Join-Path $projectPath 'project.json'
$languageSourcePath = Join-Path $PSScriptRoot '..\installer\ChineseSimplified.isl'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "Project manifest was not found: $manifestPath" }
if (-not (Test-Path -LiteralPath $ISCCPath -PathType Leaf)) { throw "Inno Setup compiler was not found: $ISCCPath" }
if (-not (Test-Path -LiteralPath $languageSourcePath -PathType Leaf)) { throw "Chinese installer language file was not found: $languageSourcePath" }

$manifest = Get-Content -Raw -Encoding utf8 -LiteralPath $manifestPath | ConvertFrom-Json
foreach ($property in @('softwareName', 'version', 'appId')) {
    if ([string]::IsNullOrWhiteSpace([string]$manifest.$property)) { throw "project.json $property is required." }
}

$softwareName = ConvertTo-InnoValue ([string]$manifest.softwareName)
$version = ConvertTo-InnoValue ([string]$manifest.version)
$appId = [Guid]::Parse([string]$manifest.appId).ToString()
$launcherPath = Join-Path $projectPath ($manifest.softwareName + '.exe')
$appPath = Join-Path $projectPath 'app'
if (-not (Test-Path -LiteralPath $launcherPath -PathType Leaf)) { throw "Launcher was not found: $launcherPath" }
if (-not (Test-Path -LiteralPath $appPath -PathType Container)) { throw "Application directory was not found: $appPath" }

$installerRoot = Join-Path $projectPath 'installer'
$outputRoot = Join-Path $installerRoot 'output'
New-Item -ItemType Directory -Path $installerRoot -Force | Out-Null
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$languagePath = Join-Path $installerRoot 'ChineseSimplified.isl'
Copy-Item -LiteralPath $languageSourcePath -Destination $languagePath -Force
$issPath = Join-Path $installerRoot ($manifest.softwareName + '.iss')
$packageSuffix = -join @(0x5B89, 0x88C5, 0x5305 | ForEach-Object { [char]$_ })
$outputName = '{0} V{1} {2}' -f $manifest.softwareName, $manifest.version, $packageSuffix

$iss = @"
[Setup]
AppId={{$appId}
AppName=$softwareName
AppVersion=$version
AppPublisher=$softwareName
DefaultDirName={localappdata}\Programs\$softwareName
DefaultGroupName=$softwareName
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=$(ConvertTo-InnoValue $outputRoot)
OutputBaseFilename=$(ConvertTo-InnoValue $outputName)
UninstallDisplayName=$softwareName
UninstallDisplayIcon={app}\$softwareName.exe
Compression=lzma
SolidCompression=yes

[Languages]
Name: "chinesesimplified"; MessagesFile: "ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "$(ConvertTo-InnoValue $launcherPath)"; DestDir: "{app}"; Flags: ignoreversion
Source: "$(ConvertTo-InnoValue (Join-Path $appPath '*'))"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\$softwareName"; Filename: "{app}\$softwareName.exe"
Name: "{autodesktop}\$softwareName"; Filename: "{app}\$softwareName.exe"; Tasks: desktopicon
"@
[IO.File]::WriteAllText($issPath, $iss, [Text.UTF8Encoding]::new($false))

$compilerOutput = (& $ISCCPath $issPath 2>&1 | Out-String)
$compilerExitCode = if (Test-Path variable:LASTEXITCODE) { $LASTEXITCODE } else { 0 }
if ($compilerExitCode -ne 0) { throw "Inno Setup compilation failed with exit code $compilerExitCode`: $($compilerOutput.Trim())" }
$installerPath = Join-Path $outputRoot ($outputName + '.exe')
if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) { throw "Inno Setup compiler did not create: $installerPath" }

Get-Item -LiteralPath $installerPath
