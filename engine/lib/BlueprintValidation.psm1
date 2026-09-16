Set-StrictMode -Version Latest

function Test-BusinessBlueprint {
    param(
        [Parameter(Mandatory)][string]$BlueprintPath,
        [Parameter(Mandatory)][string]$NodePath,
        [scriptblock]$ProcessInvoker
    )

    if (-not [IO.Path]::IsPathRooted($BlueprintPath)) {
        throw 'Blueprint path must be an absolute path.'
    }
    $resolvedBlueprint = [IO.Path]::GetFullPath($BlueprintPath)
    if (-not (Test-Path -LiteralPath $resolvedBlueprint -PathType Leaf)) {
        throw "Blueprint path does not exist: $resolvedBlueprint"
    }
    if (-not [IO.Path]::IsPathRooted($NodePath)) {
        throw 'Node path must be an absolute path.'
    }
    $resolvedNode = [IO.Path]::GetFullPath($NodePath)
    if (-not (Test-Path -LiteralPath $resolvedNode -PathType Leaf)) {
        throw "Node executable does not exist: $resolvedNode"
    }

    $cliPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\blueprint\cli.cjs'))
    if (-not (Test-Path -LiteralPath $cliPath -PathType Leaf)) {
        throw "Blueprint CLI does not exist: $cliPath"
    }
    if ($null -eq $ProcessInvoker) {
        $ProcessInvoker = {
            param($InvokerNodePath, $InvokerCliPath, $InvokerBlueprintPath, $StdoutPath, $StderrPath)
            $arguments = @(
                ('"{0}"' -f $InvokerCliPath),
                '--input',
                ('"{0}"' -f $InvokerBlueprintPath)
            )
            $process = Start-Process -FilePath $InvokerNodePath -ArgumentList $arguments `
                -RedirectStandardOutput $StdoutPath -RedirectStandardError $StderrPath `
                -Wait -PassThru -WindowStyle Hidden
            return [int]$process.ExitCode
        }
    }

    $token = [guid]::NewGuid().ToString('N')
    $stdoutPath = Join-Path $env:TEMP "blueprint-validation-$token.stdout.json"
    $stderrPath = Join-Path $env:TEMP "blueprint-validation-$token.stderr.log"
    try {
        $exitCode = [int](& $ProcessInvoker $resolvedNode $cliPath $resolvedBlueprint $stdoutPath $stderrPath)
        $stderr = if (Test-Path -LiteralPath $stderrPath) {
            Get-Content -Raw -Encoding UTF8 -LiteralPath $stderrPath
        } else { '' }
        if ($exitCode -eq 2) {
            $detail = if ([string]::IsNullOrWhiteSpace($stderr)) { 'Blueprint CLI rejected the request.' } else { $stderr.Trim() }
            throw $detail
        }
        if ($exitCode -notin @(0, 1)) {
            throw "Blueprint CLI returned unexpected exit code $exitCode."
        }

        $stdout = if (Test-Path -LiteralPath $stdoutPath) {
            Get-Content -Raw -Encoding UTF8 -LiteralPath $stdoutPath
        } else { '' }
        try {
            $parsed = $stdout | ConvertFrom-Json -ErrorAction Stop
        }
        catch {
            throw 'Blueprint CLI returned invalid JSON.'
        }
        $propertyNames = @($parsed.PSObject.Properties.Name)
        foreach ($required in @('valid', 'canGenerate', 'schemaVersion', 'issues', 'summary')) {
            if ($propertyNames -cnotcontains $required) {
                throw "Blueprint CLI result is missing property '$required'."
            }
        }

        return [pscustomobject]@{
            Passed      = [bool]$parsed.valid
            CanGenerate = [bool]$parsed.canGenerate
            Issues      = @($parsed.issues)
            Summary     = [string]$parsed.summary
            ExitCode    = $exitCode
        }
    }
    finally {
        Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
    }
}

Export-ModuleMember -Function Test-BusinessBlueprint
