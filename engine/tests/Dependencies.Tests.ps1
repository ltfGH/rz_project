. "$PSScriptRoot\Assert.ps1"
Import-Module "$PSScriptRoot\..\lib\Dependencies.psm1" -Force -DisableNameChecking

$fakeResolver = {
    param([string]$Name)
    switch ($Name) {
        'codex' { 'C:\fake\codex.ps1'; break }
        'node' { 'C:\fake\node.exe'; break }
        'edge' { 'C:\fake\msedge.exe'; break }
        default { $null }
    }
}
$fakeWord = { 'C:\fake\WINWORD.EXE' }
$fakeInno = { 'C:\fake\ISCC.exe' }

$result = Test-GeneratorDependencies -CommandResolver $fakeResolver -WordProbe $fakeWord -InnoResolver $fakeInno
Assert-Equal $result.CodexPath 'C:\fake\codex.ps1'
Assert-Equal $result.NodePath 'C:\fake\node.exe'
Assert-Match $result.EdgePath 'msedge.exe$'
Assert-Equal $result.WordPath 'C:\fake\WINWORD.EXE'
Assert-Equal $result.ISCCPath 'C:\fake\ISCC.exe'

foreach ($missingName in @('codex', 'node', 'edge')) {
    $resolverWithMissingCommand = {
        param([string]$Name)
        if ($Name -eq $missingName) { return $null }
        & $fakeResolver $Name
    }.GetNewClosure()
    Assert-Throws {
        Test-GeneratorDependencies -CommandResolver $resolverWithMissingCommand -WordProbe $fakeWord -InnoResolver $fakeInno
    } $missingName
}

Assert-Throws {
    Test-GeneratorDependencies -CommandResolver $fakeResolver -WordProbe { $null } -InnoResolver $fakeInno
} 'Word'

Assert-Throws {
    Test-GeneratorDependencies -CommandResolver $fakeResolver -WordProbe $fakeWord -InnoResolver { $null }
} 'Inno Setup'

$standardResolver = {
    param([string]$Name)
    switch ($Name) {
        'codex' { 'C:\fake\codex.ps1' }
        'node' { 'C:\fake\node.exe' }
        'npm' { 'C:\fake\npm.cmd' }
        'npx' { 'C:\fake\npx.cmd' }
    }
}
$standard = Test-StandardBusinessDependencies -CommandResolver $standardResolver -WordProbe $fakeWord
Assert-Equal $standard.NpmPath 'C:\fake\npm.cmd'
Assert-Equal $standard.NpxPath 'C:\fake\npx.cmd'
Assert-Equal $standard.WordPath 'C:\fake\WINWORD.EXE'
Assert-Throws { Test-StandardBusinessDependencies -CommandResolver { param($name) if($name -eq 'npx'){$null}else{& $standardResolver $name} } -WordProbe $fakeWord } 'npx'

$engineRoot = Split-Path -Parent $PSScriptRoot
$invalidSignatureCache = Join-Path $engineRoot '工作区\tests-invalid-signature'
try {
    function global:Invoke-WebRequest {
        param([string]$Uri, [string]$OutFile)
        [IO.File]::WriteAllBytes($OutFile, [byte[]](0))
    }
    function global:Get-AuthenticodeSignature {
        param([string]$FilePath)
        [pscustomobject]@{
            Status = $script:signatureStatus
            SignerCertificate = [pscustomobject]@{ Subject = $script:signatureSubject }
        }
    }

    $script:signatureStatus = 'NotSigned'
    $script:signatureSubject = 'O=Pyrsys B.V.'
    Assert-Throws { Install-VerifiedInnoSetup $invalidSignatureCache } '签名无效'
    Assert-Equal (Test-Path -LiteralPath (Join-Path $invalidSignatureCache 'innosetup-6.7.3.exe')) $false

    $script:signatureStatus = 'Valid'
    $script:signatureSubject = 'O=Untrusted Publisher'
    Assert-Throws { Install-VerifiedInnoSetup $invalidSignatureCache } '发布者不匹配'
    Assert-Equal (Test-Path -LiteralPath (Join-Path $invalidSignatureCache 'innosetup-6.7.3.exe')) $false
}
finally {
    Remove-Item Function:\Invoke-WebRequest -Force -ErrorAction SilentlyContinue
    Remove-Item Function:\Get-AuthenticodeSignature -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $invalidSignatureCache) {
        Remove-Item -LiteralPath $invalidSignatureCache -Recurse -Force
    }
}



