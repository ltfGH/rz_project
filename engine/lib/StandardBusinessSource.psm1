Set-StrictMode -Version Latest

function Get-SourceLineCount {
    param([Parameter(Mandatory)][string]$Path)
    $text = [IO.File]::ReadAllText($Path, [Text.UTF8Encoding]::new($false))
    if ($text.Length -eq 0) { return 0 }
    $count = [regex]::Matches($text, "`r`n|`n|`r").Count
    if ($text -notmatch "(?:`r`n|`n|`r)$") { $count++ }
    return $count
}

function Get-StandardSourceManifest {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [Parameter(Mandatory)]$Template,
        [Parameter(Mandatory)][string]$OutputPath
    )

    $root = [IO.Path]::GetFullPath($RepositoryRoot).TrimEnd('\')
    if (-not (Test-Path -LiteralPath $root -PathType Container)) { throw "Repository root was not found: $root" }
    if ([string]::IsNullOrWhiteSpace([string]$Template.id) -or @($Template.packs).Count -eq 0) { throw 'Template id and packs are required.' }

    $includeDirectories = @(
        'engine\desktop-runtime\src',
        'engine\desktop-runtime\build',
        'engine\desktop-runtime\tools',
        'engine\desktop-runtime\standard-templates',
        'engine\domain-packs\src',
        'engine\domain-packs\tools'
    )
    foreach ($packId in @($Template.packs)) {
        if ([string]$packId -notmatch '^[a-z][a-z0-9_]+$') { throw 'Template contains an invalid pack id.' }
        $includeDirectories += "engine\domain-packs\packs\$packId"
    }
    $includeFiles = @(
        'engine\desktop-runtime\package.json',
        'engine\desktop-runtime\package-lock.json',
        'engine\desktop-runtime\index.html',
        'engine\desktop-runtime\tsconfig.json',
        'engine\desktop-runtime\tsconfig.renderer.json',
        'engine\desktop-runtime\vite.config.mts',
        'engine\desktop-runtime\vite.preload.config.mts',
        'engine\domain-packs\package.json',
        'engine\domain-packs\package-lock.json',
        'engine\domain-packs\tsconfig.json',
        'engine\domain-packs\tsconfig.build.json'
    )
    $allowedExtensions = @('.ts','.tsx','.js','.cjs','.mjs','.json','.ps1','.psm1','.html','.css','.sql','.svg','.md')
    $resolved = [Collections.Generic.List[IO.FileInfo]]::new()
    foreach ($relativeDirectory in $includeDirectories) {
        $directory = Join-Path $root $relativeDirectory
        if (-not (Test-Path -LiteralPath $directory -PathType Container)) { continue }
        foreach ($file in Get-ChildItem -LiteralPath $directory -File -Recurse | Sort-Object FullName) {
            if ($allowedExtensions -ccontains $file.Extension.ToLowerInvariant()) { $resolved.Add($file) }
        }
    }
    foreach ($relativeFile in $includeFiles) {
        $filePath = Join-Path $root $relativeFile
        if (Test-Path -LiteralPath $filePath -PathType Leaf) { $resolved.Add((Get-Item -LiteralPath $filePath)) }
    }
    $rootPrefix = $root + '\'
    $entries = @($resolved | Sort-Object FullName -Unique | ForEach-Object {
        if (-not $_.FullName.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Source file escaped the repository root.' }
        $relative = $_.FullName.Substring($rootPrefix.Length).Replace('\','/')
        if ($relative -match '(^|/)(node_modules|dist|test-results|coverage|\.git)(/|$)') { throw "Disallowed source path: $relative" }
        [pscustomobject]@{
            path = $relative
            lines = Get-SourceLineCount -Path $_.FullName
            bytes = $_.Length
            sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    })
    if ($entries.Count -eq 0) { throw 'No standard application source files were found.' }
    $totalLines = [int](($entries | Measure-Object -Property lines -Sum).Sum)
    $canonical = ($entries | ForEach-Object { '{0}|{1}|{2}|{3}' -f $_.path,$_.lines,$_.bytes,$_.sha256 }) -join "`n"
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes($canonical)
    $digest = [BitConverter]::ToString(([Security.Cryptography.SHA256]::Create().ComputeHash($bytes))).Replace('-','').ToLowerInvariant()
    $manifest = [pscustomobject]@{
        manifestVersion = '1.0'
        templateId = [string]$Template.id
        totalFiles = $entries.Count
        totalLines = $totalLines
        sha256 = $digest
        files = $entries
    }
    $parent = Split-Path -Parent ([IO.Path]::GetFullPath($OutputPath))
    if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    [IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputPath), ($manifest | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
    return $manifest
}

Export-ModuleMember -Function Get-StandardSourceManifest
