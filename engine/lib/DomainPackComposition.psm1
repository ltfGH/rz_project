Set-StrictMode -Version Latest

function Invoke-DomainPackComposition {
    param(
        [Parameter(Mandatory)][string]$RequestPath,
        [Parameter(Mandatory)][string]$OutputPath,
        [Parameter(Mandatory)][string]$NodePath,
        [scriptblock]$ProcessInvoker
    )

    if (-not [IO.Path]::IsPathRooted($RequestPath)) { throw 'Request path must be an absolute path.' }
    if (-not [IO.Path]::IsPathRooted($OutputPath)) { throw 'Output path must be an absolute path.' }
    if (-not [IO.Path]::IsPathRooted($NodePath)) { throw 'Node path must be an absolute path.' }
    $request = [IO.Path]::GetFullPath($RequestPath)
    $output = [IO.Path]::GetFullPath($OutputPath)
    $node = [IO.Path]::GetFullPath($NodePath)
    if (-not (Test-Path -LiteralPath $request -PathType Leaf)) { throw "Request file does not exist: $request" }
    if (-not (Test-Path -LiteralPath $node -PathType Leaf)) { throw "Node executable does not exist: $node" }
    $cli = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\domain-packs\bin\domain-pack-cli.cjs'))
    if (-not (Test-Path -LiteralPath $cli -PathType Leaf)) { throw "Domain pack CLI does not exist: $cli" }

    if ($null -eq $ProcessInvoker) {
        $ProcessInvoker = {
            param($InvokerNode, $InvokerCli, $InvokerRequest, $InvokerOutput, $StdoutPath, $StderrPath)
            $arguments = @(
                ('"{0}"' -f $InvokerCli), '--request', ('"{0}"' -f $InvokerRequest),
                '--output', ('"{0}"' -f $InvokerOutput)
            )
            $process = Start-Process -FilePath $InvokerNode -ArgumentList $arguments `
                -RedirectStandardOutput $StdoutPath -RedirectStandardError $StderrPath `
                -Wait -PassThru -WindowStyle Hidden
            return [int]$process.ExitCode
        }
    }

    $token = [guid]::NewGuid().ToString('N')
    $stdoutPath = Join-Path $env:TEMP "domain-compose-$token.stdout.json"
    $stderrPath = Join-Path $env:TEMP "domain-compose-$token.stderr.log"
    try {
        $exitCode = [int](& $ProcessInvoker $node $cli $request $output $stdoutPath $stderrPath)
        $stderr = if (Test-Path -LiteralPath $stderrPath) {
            Get-Content -Raw -Encoding UTF8 -LiteralPath $stderrPath
        } else { '' }
        if ($exitCode -eq 2) {
            $detail = if ([string]::IsNullOrWhiteSpace($stderr)) { 'Domain pack CLI rejected the request.' } else { $stderr.Trim() }
            throw $detail
        }
        if ($exitCode -notin @(0, 1)) { throw "Domain pack CLI returned unexpected exit code $exitCode." }
        $stdout = if (Test-Path -LiteralPath $stdoutPath) {
            Get-Content -Raw -Encoding UTF8 -LiteralPath $stdoutPath
        } else { '' }
        try { $parsed = $stdout | ConvertFrom-Json -ErrorAction Stop }
        catch { throw 'Domain pack CLI returned invalid JSON.' }
        foreach ($property in @('valid', 'canGenerate', 'issues', 'summary', 'outputPath')) {
            if (@($parsed.PSObject.Properties.Name) -cnotcontains $property) {
                throw "Domain pack CLI result is missing property '$property'."
            }
        }
        return [pscustomobject]@{
            Passed      = [bool]$parsed.valid
            CanGenerate = [bool]$parsed.canGenerate
            Issues      = @($parsed.issues)
            Summary     = [string]$parsed.summary
            OutputPath  = if ($null -eq $parsed.outputPath) { $null } else { [string]$parsed.outputPath }
            ExitCode    = $exitCode
        }
    }
    finally {
        Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
    }
}

Export-ModuleMember -Function Invoke-DomainPackComposition
