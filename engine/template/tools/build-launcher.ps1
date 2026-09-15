param(
    [Parameter(Mandatory)][string]$ProjectRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectPath = [IO.Path]::GetFullPath($ProjectRoot)
$manifestPath = Join-Path $projectPath 'project.json'
$sourcePath = Join-Path $PSScriptRoot 'Launcher.cs'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "Project manifest was not found: $manifestPath" }
if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { throw "Launcher source was not found: $sourcePath" }

$manifest = Get-Content -Raw -Encoding utf8 -LiteralPath $manifestPath | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace([string]$manifest.softwareName)) { throw 'project.json softwareName is required.' }
$outputPath = Join-Path $projectPath ($manifest.softwareName + '.exe')
$compilerPath = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compilerPath -PathType Leaf)) { throw "C# compiler was not found: $compilerPath" }

if (Test-Path -LiteralPath $outputPath) { Remove-Item -LiteralPath $outputPath -Force }
$compilerOutput = (& $compilerPath '/nologo' '/target:winexe' (('/out:"{0}"' -f $outputPath)) '/r:System.dll' '/r:System.Windows.Forms.dll' $sourcePath 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0) { throw "Launcher compilation failed with exit code $LASTEXITCODE`: $($compilerOutput.Trim())" }
if (-not (Test-Path -LiteralPath $outputPath -PathType Leaf)) { throw "Launcher compiler did not create: $outputPath" }

Get-Item -LiteralPath $outputPath
