. "$PSScriptRoot\Assert.ps1"
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot '..\lib\StandardBusinessCredentials.psm1') -Force -DisableNameChecking

Assert-Equal (Test-InitialPasswordPolicy 'StrongPass123!') $true
Assert-Equal (Test-InitialPasswordPolicy 'short1!A') $false
Assert-Equal (Test-InitialPasswordPolicy 'lowercase123!') $false
Assert-Equal (Test-InitialPasswordPolicy 'UPPERCASE123!') $false
Assert-Equal (Test-InitialPasswordPolicy 'NoNumbersHere!') $false
Assert-Equal (Test-InitialPasswordPolicy 'NoSpecial1234A') $false

function New-TestSecureString([string]$Value) {
    ConvertTo-SecureString $Value -AsPlainText -Force
}

$values = [Collections.Generic.Queue[string]]::new()
foreach ($value in @(
    'DispatchPass123!', 'DispatchPass123!',
    'OperatorPass123!', 'OperatorPass123!',
    'ReviewerPass123!', 'ReviewerPass123!',
    'AdminSecurePass123!', 'AdminSecurePass123!'
)) { $values.Enqueue($value) }
$reader = { param($role, $confirmation) New-TestSecureString $values.Dequeue() }
$hasher = {
    param($password)
    $bytes = [Text.Encoding]::UTF8.GetBytes($password)
    $suffix = [Convert]::ToBase64String($bytes)
    "scrypt`$16384`$8`$1`$c2FsdHNhbHRzYWx0MTI=`$$suffix"
}
$result = Read-StandardBusinessCredentials -SecureReader $reader -DigestInvoker $hasher
Assert-Equal (($result.PSObject.Properties.Name | Sort-Object) -join ',') 'administrator,dispatcher,operator,reviewer'
foreach ($role in @('dispatcher', 'operator', 'reviewer', 'administrator')) {
    Assert-Match $result.$role '^scrypt\$16384\$8\$1\$'
}
$serialized = $result | ConvertTo-Json
foreach ($password in @('DispatchPass123!', 'OperatorPass123!', 'ReviewerPass123!', 'AdminSecurePass123!')) {
    Assert-Equal ($serialized.Contains($password)) $false
}

$retryValues = [Collections.Generic.Queue[string]]::new()
foreach ($value in @(
    'DispatchPass123!', 'mismatch-password', 'DispatchPass123!', 'DispatchPass123!',
    'DispatchPass123!', 'DispatchPass123!', 'OperatorUnique123!', 'OperatorUnique123!',
    'ReviewerUnique123!', 'ReviewerUnique123!', 'AdminUniquePass123!', 'AdminUniquePass123!'
)) { $retryValues.Enqueue($value) }
$retryCalls = 0
$retryReader = { param($role, $confirmation) $script:retryCalls++; New-TestSecureString $retryValues.Dequeue() }
$retryResult = Read-StandardBusinessCredentials -SecureReader $retryReader -DigestInvoker $hasher
Assert-Equal $retryCalls 12
Assert-Match $retryResult.operator '^scrypt\$'

$failingValues = [Collections.Generic.Queue[string]]::new()
foreach ($value in @('SecretFailure123!', 'SecretFailure123!')) { $failingValues.Enqueue($value) }
$failureReader = { param($role, $confirmation) New-TestSecureString $failingValues.Dequeue() }
try {
    Read-StandardBusinessCredentials -SecureReader $failureReader -DigestInvoker { param($password) throw 'internal hasher detail' }
    throw 'Expected hashing failure.'
}
catch {
    Assert-Equal ($_.Exception.Message.Contains('SecretFailure123!')) $false
    Assert-Match $_.Exception.Message 'hashing failed'
}

$bundleValues = [Collections.Generic.Queue[string]]::new()
foreach ($value in @(
    'BundleDispatch123!', 'BundleDispatch123!', 'BundleOperator123!', 'BundleOperator123!',
    'BundleReviewer123!', 'BundleReviewer123!', 'BundleAdminPass123!', 'BundleAdminPass123!'
)) { $bundleValues.Enqueue($value) }
$bundle = Read-StandardBusinessCredentialBundle -SecureReader { param($role,$confirmation) New-TestSecureString $bundleValues.Dequeue() } -DigestInvoker $hasher
Assert-Equal (($bundle.Digests.PSObject.Properties.Name | Sort-Object) -join ',') 'administrator,dispatcher,operator,reviewer'
Assert-Equal (($bundle.Secrets.Keys | Sort-Object) -join ',') 'administrator,dispatcher,operator,reviewer'
$environmentResult = Use-StandardBusinessCredentialEnvironment -CredentialSecrets $bundle.Secrets -Action {
    Assert-Equal $env:RZ_E2E_DISPATCHER_PASSWORD 'BundleDispatch123!'
    Assert-Equal $env:RZ_E2E_ADMINISTRATOR_PASSWORD 'BundleAdminPass123!'
    return 'passed'
}
Assert-Equal $environmentResult 'passed'
Assert-Equal ([string]::IsNullOrEmpty($env:RZ_E2E_DISPATCHER_PASSWORD)) $true
foreach($secret in $bundle.Secrets.Values){$secret.Dispose()}
