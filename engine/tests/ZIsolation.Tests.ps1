. "$PSScriptRoot\Assert.ps1"

$webCommand = Get-Command Invoke-WebRequest -ErrorAction Stop
$signatureCommand = Get-Command Get-AuthenticodeSignature -ErrorAction Stop

Assert-Equal $webCommand.CommandType 'Cmdlet'
Assert-Equal $signatureCommand.CommandType 'Cmdlet'
