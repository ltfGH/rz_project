Set-StrictMode -Version Latest

function Test-InitialPasswordPolicy {
    [CmdletBinding()]
    param([AllowEmptyString()][string]$Password)

    return $Password.Length -ge 12 -and
        $Password -cmatch '[A-Z]' -and
        $Password -cmatch '[a-z]' -and
        $Password -match '[0-9]' -and
        $Password -match '[^A-Za-z0-9]'
}

function ConvertFrom-GeneratorSecureString {
    param([Parameter(Mandatory)][Security.SecureString]$Value)

    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Invoke-StandardPasswordDigest {
    param([Parameter(Mandatory)][string]$Password)

    $node = (Get-Command node -ErrorAction Stop).Source
    $scriptPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\desktop-runtime\tools\hash-password.cjs'))
    if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) { throw 'Password hash tool is unavailable.' }
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $node
    $start.Arguments = ('"{0}" --stdin' -f $scriptPath)
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.StandardOutputEncoding = [Text.UTF8Encoding]::new($false)
    $start.StandardErrorEncoding = [Text.UTF8Encoding]::new($false)
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $start
    try {
        if (-not $process.Start()) { throw 'Password hash process did not start.' }
        $process.StandardInput.WriteLine($Password)
        $process.StandardInput.Close()
        $output = $process.StandardOutput.ReadToEnd().Trim()
        [void]$process.StandardError.ReadToEnd()
        $process.WaitForExit()
        if ($process.ExitCode -ne 0 -or $output -notmatch '^scrypt\$16384\$8\$1\$') {
            throw 'Password hash process failed.'
        }
        return $output
    }
    finally { $process.Dispose() }
}

function Read-StandardBusinessCredentials {
    [CmdletBinding()]
    param([scriptblock]$SecureReader, [scriptblock]$DigestInvoker)

    if ($null -eq $SecureReader) {
        $SecureReader = {
            param([string]$Role, [bool]$Confirmation)
            $label = if ($Confirmation) { 'confirm' } else { 'password' }
            Read-Host "$Role $label" -AsSecureString
        }
    }
    if ($null -eq $DigestInvoker) { $DigestInvoker = { param([string]$Password) Invoke-StandardPasswordDigest $Password } }

    $fingerprints = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $digests = [ordered]@{}
    foreach ($role in @('dispatcher', 'operator', 'reviewer', 'administrator')) {
        while ($true) {
            $firstSecure = $null
            $secondSecure = $null
            $first = $null
            $second = $null
            try {
                $firstSecure = & $SecureReader $role $false
                $secondSecure = & $SecureReader $role $true
                if ($firstSecure -isnot [Security.SecureString] -or $secondSecure -isnot [Security.SecureString]) {
                    throw 'Secure password input is required.'
                }
                $first = ConvertFrom-GeneratorSecureString $firstSecure
                $second = ConvertFrom-GeneratorSecureString $secondSecure
                if ($first -cne $second) { Write-Host "Password confirmation did not match for $role."; continue }
                if (-not (Test-InitialPasswordPolicy $first)) { Write-Host "Password policy was not met for $role."; continue }
                $bytes = [Text.Encoding]::UTF8.GetBytes($first)
                $sha256 = [Security.Cryptography.SHA256]::Create()
                try {
                    $fingerprintBytes = $sha256.ComputeHash($bytes)
                    $fingerprint = [Convert]::ToBase64String($fingerprintBytes)
                }
                finally {
                    $sha256.Dispose()
                    [Array]::Clear($bytes, 0, $bytes.Length)
                }
                if (-not $fingerprints.Add($fingerprint)) { Write-Host "Password must be unique for $role."; continue }
                try { $digest = [string](& $DigestInvoker $first) }
                catch { throw "Password hashing failed for role '$role'." }
                if ($digest -notmatch '^scrypt\$16384\$8\$1\$') { throw "Password hashing failed for role '$role'." }
                $digests[$role] = $digest.Trim()
                break
            }
            finally {
                $first = $null
                $second = $null
                if ($null -ne $firstSecure) { $firstSecure.Dispose() }
                if ($null -ne $secondSecure) { $secondSecure.Dispose() }
            }
        }
    }
    return [pscustomobject]$digests
}

Export-ModuleMember -Function Test-InitialPasswordPolicy, Read-StandardBusinessCredentials
