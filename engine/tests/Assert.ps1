Set-StrictMode -Version Latest

function Assert-Equal {
    param($Actual, $Expected)
    if ($Actual -cne $Expected) {
        throw "Expected '$Expected', got '$Actual'."
    }
}

function Assert-Match {
    param([string]$Actual, [string]$Pattern)
    if ($Actual -notmatch $Pattern) {
        throw "Value '$Actual' did not match pattern '$Pattern'."
    }
}

function Assert-Throws {
    param([scriptblock]$Action, [string]$ExpectedMessage)
    try {
        & $Action
    }
    catch {
        if ($_.Exception.Message -notlike "*$ExpectedMessage*") {
            throw "Expected error containing '$ExpectedMessage', got '$($_.Exception.Message)'."
        }
        return
    }
    throw "Expected an error containing '$ExpectedMessage'."
}

